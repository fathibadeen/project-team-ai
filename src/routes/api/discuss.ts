import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { streamAgent, tailFilter } from "@/lib/ai.server";
import {
  agentNames,
  authFromRequest,
  buildDecisionContext,
  buildTurnContext,
  historyToMessages,
  historyWindow,
  loadKey,
  mentionedAgents,
  parseCouncilTail,
  parseLeaderTasks,
  sortTeam,
  COUNCIL_OPEN,
  HISTORY_FETCH,
  MAX_ROUNDS,
  MAX_STEPS,
  type Agent,
  type HistoryRow,
  type RunRow,
} from "@/lib/council.server";
import type { Database } from "@/integrations/supabase/types";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const STALE_STEP_MS = 2 * 60 * 1000;
const HISTORY_COLUMNS = "agent_id, agent_name, content, kind, round, run_id, stance, targets, key_points";

type Supa = NonNullable<Awaited<ReturnType<typeof authFromRequest>>>["supabase"];
type RunPatch = Database["public"]["Tables"]["discussion_runs"]["Update"];

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    projectId: z.string().uuid(),
    prompt: z.string().min(1).max(20000),
    maxRounds: z.number().int().min(1).max(MAX_ROUNDS).default(2),
  }),
  z.object({ action: z.literal("step"), runId: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), runId: z.string().uuid() }),
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ndjson = (stream: ReadableStream) =>
  new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });

const pointer = (ids: string[], team: Agent[]) => {
  const id = ids[0];
  if (!id) return null;
  return { agentId: id, agentName: team.find((a) => a.id === id)?.name ?? "" };
};

/**
 * Agents owed a reply next round: everyone a colleague objected to or called out.
 * The leader joins every round that happens, but never triggers one on its own —
 * objections aimed at the leader are answered in the closing decision instead.
 */
function nextRoundQueue(history: HistoryRow[], runId: string, round: number, team: Agent[]) {
  const targeted = new Set<string>();
  for (const h of history) {
    if (h.kind !== "agent" || h.run_id !== runId || h.round !== round) continue;
    for (const t of h.targets) if (t !== h.agent_id) targeted.add(t);
  }
  const queue = team.filter((a) => !a.is_leader && targeted.has(a.id)).map((a) => a.id);
  if (!queue.length) return [];
  const leader = team.find((a) => a.is_leader);
  if (leader) queue.push(leader.id);
  return queue;
}

async function startRun(supabase: Supa, body: Extract<z.infer<typeof Body>, { action: "start" }>) {
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", body.projectId)
    .maybeSingle();
  if (!project) return json({ error: "not_found" }, 404);

  const { data: open } = await supabase
    .from("discussion_runs")
    .select("id")
    .eq("project_id", body.projectId)
    .in("status", ["running", "stepping"])
    .limit(1)
    .maybeSingle();
  if (open) return json({ error: "run_in_progress", runId: open.id }, 409);

  const ids = project.agent_ids.length ? project.agent_ids : [ZERO_UUID];
  const { data: agentsRaw } = await supabase.from("agents").select("*").in("id", ids);
  const team = sortTeam((agentsRaw ?? []) as Agent[]);
  if (!team.length) return json({ error: "no_agents" }, 400);

  const leader = team.find((a) => a.is_leader);
  const mentioned = mentionedAgents(body.prompt, team);
  const queue = mentioned.length
    ? [
        ...team.filter((a) => mentioned.includes(a.id)).map((a) => a.id),
        ...(leader && !mentioned.includes(leader.id) ? [leader.id] : []),
      ]
    : team.map((a) => a.id);

  const { data: run } = await supabase
    .from("discussion_runs")
    .insert({
      project_id: project.id,
      prompt: body.prompt,
      max_rounds: body.maxRounds,
      round: 1,
      participants: team.map((a) => a.id),
      pending: queue,
      phase: "debate",
      status: "running",
    })
    .select()
    .single();
  if (!run) return json({ error: "insert_failed" }, 500);

  await supabase.from("messages").insert({
    project_id: project.id,
    run_id: run.id,
    content: body.prompt,
    agent_name: null,
    kind: "user",
    round: 1,
  });

  return json({
    runId: run.id,
    round: 1,
    status: "running",
    mentioned: agentNames(mentioned, team),
    next: pointer(queue, team),
  });
}

/** Atomic claim: only one stepper can hold a run. A step that died inside a Worker goes stale and is reclaimable. */
async function claimRun(supabase: Supa, runId: string, nowIso: string) {
  const fresh = await supabase
    .from("discussion_runs")
    .update({ status: "stepping", updated_at: nowIso })
    .eq("id", runId)
    .eq("status", "running")
    .select()
    .maybeSingle();
  if (fresh.data) return fresh.data;

  const stale = await supabase
    .from("discussion_runs")
    .update({ status: "stepping", updated_at: nowIso })
    .eq("id", runId)
    .eq("status", "stepping")
    .lt("updated_at", new Date(Date.now() - STALE_STEP_MS).toISOString())
    .select()
    .maybeSingle();
  return stale.data;
}

async function stepRun(supabase: Supa, userId: string, runId: string, request: Request) {
  const nowIso = new Date().toISOString();
  const claimed = await claimRun(supabase, runId, nowIso);
  if (!claimed) {
    const { data: current } = await supabase
      .from("discussion_runs")
      .select("status")
      .eq("id", runId)
      .maybeSingle();
    if (!current) return json({ error: "not_found" }, 404);
    if (current.status === "stepping") return json({ error: "step_in_progress" }, 409);
    return json({ error: "run_finished", status: current.status }, 409);
  }
  const run = claimed as RunRow;

  // Only a run still held by this stepper may be advanced; a cancel mid-turn wins.
  const saveRun = (patch: RunPatch) =>
    supabase
      .from("discussion_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "stepping");

  const [{ data: project }, { data: files }, { data: agentsRaw }, { data: newest }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", run.project_id).maybeSingle(),
    supabase.from("project_files").select("name, content").eq("project_id", run.project_id),
    supabase
      .from("agents")
      .select("*")
      .in("id", run.participants.length ? run.participants : [ZERO_UUID]),
    supabase
      .from("messages")
      .select(HISTORY_COLUMNS)
      .eq("project_id", run.project_id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_FETCH),
  ]);

  if (!project) {
    await saveRun({ status: "failed", error: "project_missing" });
    return json({ error: "not_found" }, 404);
  }

  // Newest rows fetched descending, then flipped: the current round is always in context.
  const history = ((newest ?? []) as HistoryRow[]).slice().reverse();
  const fetched = (agentsRaw ?? []) as Agent[];
  const team = run.participants
    .map((id) => fetched.find((a) => a.id === id))
    .filter((a): a is Agent => !!a);

  let pending = [...run.pending];
  let round = run.round;
  let phase = run.phase;

  if (phase === "debate" && !pending.length) {
    const nextRound = round + 1;
    const queue = nextRound <= run.max_rounds ? nextRoundQueue(history, run.id, round, team) : [];
    if (queue.length) {
      round = nextRound;
      pending = queue;
    } else {
      phase = "decision";
    }
  }
  if (run.steps_done >= MAX_STEPS) phase = "decision";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        if (phase === "decision") {
          const leader = team.find((a) => a.is_leader);
          if (!leader) {
            await saveRun({ status: "done", phase, round, pending: [] });
            send({ type: "step_done", status: "done", round, hasNext: false, next: null });
            return;
          }
          const others = team.filter((a) => a.id !== leader.id);
          send({ type: "turn_start", agentId: leader.id, agentName: leader.name, round, phase: "decision" });

          const filter = tailFilter(COUNCIL_OPEN);
          for await (const t of streamAgent({
            provider: leader.provider,
            model: leader.model,
            system: buildDecisionContext({
              leader,
              team,
              others,
              project,
              files: files ?? [],
              history,
              runId: run.id,
              round,
            }),
            messages: historyToMessages(historyWindow(history, run.id), leader.name, team),
            key: await loadKey(userId, leader.provider_key_id),
            signal: request.signal,
            maxTokens: 3000,
          })) {
            const visible = filter.push(t);
            if (visible) send({ type: "delta", text: visible });
          }
          const rest = filter.flush();
          if (rest) send({ type: "delta", text: rest });

          const decision = parseCouncilTail(filter.raw, team);
          await supabase.from("messages").insert({
            project_id: run.project_id,
            run_id: run.id,
            agent_id: leader.id,
            agent_name: leader.name,
            content: decision.clean || "(لم يصل قرار)",
            kind: "decision",
            round,
            stance: "neutral",
          });
          const tasks = parseLeaderTasks(filter.raw, { projectId: run.project_id, team, others });
          if (tasks.length) await supabase.from("tasks").insert(tasks);

          await saveRun({ status: "done", phase: "decision", round, pending: [], steps_done: run.steps_done + 1 });
          send({ type: "tasks", count: tasks.length });
          send({ type: "step_done", status: "done", round, hasNext: false, next: null });
          return;
        }

        const agentId = pending[0]!;
        const self = team.find((a) => a.id === agentId);
        if (!self) {
          pending = pending.slice(1);
          await saveRun({ status: "running", phase, round, pending });
          send({ type: "skipped", agentId });
          send({ type: "step_done", status: "running", round, hasNext: true, next: pointer(pending, team) });
          return;
        }

        const repliesTo = history
          .filter(
            (h) =>
              h.kind === "agent" &&
              h.run_id === run.id &&
              h.stance === "object" &&
              h.agent_id !== self.id &&
              h.targets.includes(self.id),
          )
          .map((h) => h.agent_name)
          .filter((n): n is string => !!n);

        send({ type: "turn_start", agentId: self.id, agentName: self.name, round, repliesTo });

        const filter = tailFilter(COUNCIL_OPEN);
        for await (const t of streamAgent({
          provider: self.provider,
          model: self.model,
          system: buildTurnContext({
            self,
            team,
            project,
            files: files ?? [],
            history,
            runId: run.id,
            round,
            maxRounds: run.max_rounds,
          }),
          messages: historyToMessages(historyWindow(history, run.id), self.name, team),
          key: await loadKey(userId, self.provider_key_id),
          signal: request.signal,
        })) {
          const visible = filter.push(t);
          if (visible) send({ type: "delta", text: visible });
        }
        const rest = filter.flush();
        if (rest) send({ type: "delta", text: rest });

        const tail = parseCouncilTail(filter.raw, team);
        await supabase.from("messages").insert({
          project_id: run.project_id,
          run_id: run.id,
          agent_id: self.id,
          agent_name: self.name,
          content: tail.clean || "(لم يصل رد)",
          kind: "agent",
          round,
          stance: tail.stance,
          targets: tail.targets,
          key_points: tail.points,
        });

        pending = pending.slice(1);
        await saveRun({ status: "running", phase, round, pending, steps_done: run.steps_done + 1, error: null });
        send({ type: "turn_end", stance: tail.stance, targets: tail.targets });
        send({ type: "step_done", status: "running", round, hasNext: true, next: pointer(pending, team) });
      } catch (e) {
        const message = e instanceof Error ? e.message : "خطأ غير متوقع";
        // Release the claim without advancing: the same step can be retried, and a cancel still wins.
        await saveRun({ status: "running", error: message });
        send({ type: "error", message });
        send({ type: "step_done", status: "running", round, hasNext: false, next: null, retry: true });
      } finally {
        controller.close();
      }
    },
  });

  return ndjson(stream);
}

async function cancelRun(supabase: Supa, runId: string) {
  const { data } = await supabase
    .from("discussion_runs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["running", "stepping"])
    .select("id")
    .maybeSingle();
  return json({ status: data ? "cancelled" : "unchanged" });
}

export const Route = createFileRoute("/api/discuss")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authFromRequest(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });
        const { supabase, userId } = auth;

        if (parsed.data.action === "start") return startRun(supabase, parsed.data);
        if (parsed.data.action === "cancel") return cancelRun(supabase, parsed.data.runId);
        return stepRun(supabase, userId, parsed.data.runId, request);
      },
    },
  },
});

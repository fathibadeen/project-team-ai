import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { streamAgent, collect } from "@/lib/ai.server";
import {
  authFromRequest,
  loadKey,
  projectContext,
  agentSystem,
  historyToMessages,
  type Agent,
} from "@/lib/council.server";

const Body = z.object({ projectId: z.string().uuid(), prompt: z.string().min(1).max(20000) });

export const Route = createFileRoute("/api/discuss")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authFromRequest(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });
        const { supabase, userId } = auth;
        const { projectId, prompt } = parsed.data;

        const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
        if (!project) return new Response("Not found", { status: 404 });
        const [{ data: files }, { data: agentsRaw }] = await Promise.all([
          supabase.from("project_files").select("name, content").eq("project_id", projectId),
          supabase.from("agents").select("*").in("id", project.agent_ids.length ? project.agent_ids : ["00000000-0000-0000-0000-000000000000"]),
        ]);
        const agents = (agentsRaw ?? []) as Agent[];
        // Leader speaks last
        agents.sort((a, b) => Number(a.is_leader) - Number(b.is_leader));
        const leader = agents.find((a) => a.is_leader);
        const context = projectContext(project, files ?? []);

        await supabase.from("messages").insert({ project_id: projectId, content: prompt, agent_name: null });

        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
            try {
              for (const agent of agents) {
                const { data: history } = await supabase
                  .from("messages")
                  .select("agent_name, content")
                  .eq("project_id", projectId)
                  .order("created_at", { ascending: true })
                  .limit(60);
                send({ type: "start", agentId: agent.id, agentName: agent.name });
                let text = "";
                try {
                  const key = await loadKey(userId, agent.provider_key_id);
                  for await (const t of streamAgent({
                    provider: agent.provider,
                    model: agent.model,
                    system: agentSystem(agent, agents, context),
                    messages: historyToMessages(history ?? [], agent.name),
                    key,
                    signal: request.signal,
                  })) {
                    text += t;
                    send({ type: "delta", text: t });
                  }
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "خطأ";
                  text += `\n\n⚠️ ${msg}`;
                  send({ type: "delta", text: `\n\n⚠️ ${msg}` });
                }
                await supabase.from("messages").insert({
                  project_id: projectId,
                  agent_id: agent.id,
                  agent_name: agent.name,
                  content: text,
                });
                send({ type: "end" });
              }

              if (leader && agents.length > 1) {
                send({ type: "status", text: "القائد يجهّز المهام المقترحة..." });
                const { data: history } = await supabase
                  .from("messages")
                  .select("agent_name, content")
                  .eq("project_id", projectId)
                  .order("created_at", { ascending: true })
                  .limit(60);
                const others = agents.filter((a) => a.id !== leader.id || agents.length === 1);
                const roster = others.map((a) => `- id: ${a.id} | ${a.name}: ${a.role}`).join("\n");
                const key = await loadKey(userId, leader.provider_key_id);
                const raw = await collect(
                  streamAgent({
                    provider: leader.provider,
                    model: leader.model,
                    system:
                      agentSystem(leader, agents, context) +
                      `\n\nمهمتك الآن: بناءً على النقاش، اقترح من 1 إلى 4 مهام تنفيذية محددة لأعضاء الفريق.
الأعضاء المتاحون:
${roster}
أرجع JSON فقط بدون أي نص آخر بهذا الشكل:
{"tasks":[{"agent_id":"...","title":"...","details":"تعليمات تفصيلية","output_type":"report|document|code"}]}
إذا لم تكن هناك حاجة لمهام أرجع {"tasks":[]}`,
                    messages: historyToMessages(history ?? [], leader.name),
                    key,
                    signal: request.signal,
                  }),
                );
                const match = raw.match(/\{[\s\S]*\}/);
                let tasks: any[] = [];
                try {
                  tasks = match ? (JSON.parse(match[0]).tasks ?? []) : [];
                } catch {
                  tasks = [];
                }
                const valid = tasks
                  .filter((t) => t && typeof t.title === "string")
                  .slice(0, 4)
                  .map((t) => ({
                    project_id: projectId,
                    agent_id: agents.some((a) => a.id === t.agent_id) ? t.agent_id : others[0]?.id ?? null,
                    title: String(t.title).slice(0, 300),
                    details: String(t.details ?? "").slice(0, 5000),
                    output_type: ["report", "document", "code"].includes(t.output_type) ? t.output_type : "report",
                  }));
                if (valid.length) await supabase.from("tasks").insert(valid);
                send({ type: "tasks", count: valid.length });
              }
              send({ type: "done" });
            } catch (e) {
              send({ type: "error", message: e instanceof Error ? e.message : "خطأ غير متوقع" });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
        });
      },
    },
  },
});

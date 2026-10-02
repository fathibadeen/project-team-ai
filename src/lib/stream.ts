import { supabase } from "@/integrations/supabase/client";

export type CouncilEvent =
  | { type: "turn_start"; agentId: string; agentName: string; round: number; repliesTo?: string[]; phase?: string }
  | { type: "delta"; text: string }
  | { type: "turn_end"; stance: string; targets: string[] }
  | { type: "tasks"; count: number }
  | { type: "skipped"; agentId: string }
  | { type: "error"; message: string }
  | {
      type: "step_done";
      status: string;
      round: number;
      hasNext: boolean;
      next: { agentId: string; agentName: string } | null;
      retry?: boolean;
    };

const ERRORS: Record<string, string> = {
  run_in_progress: "هناك نقاش جارٍ لهذا المشروع.",
  step_in_progress: "خطوة جارية بالفعل، أعد المحاولة بعد لحظة.",
  run_finished: "انتهى هذا النقاش.",
  no_agents: "أضف وكلاء لهذا المشروع أولاً.",
  not_found: "المشروع أو النقاش غير موجود.",
  insert_failed: "تعذر إنشاء النقاش.",
};

async function post(body: unknown, signal?: AbortSignal) {
  const { data } = await supabase.auth.getSession();
  return fetch("/api/discuss", {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
}

/** Surfaces the server's own reason instead of a bare status code. */
async function describe(res: Response) {
  const text = await res.text().catch(() => "");
  let code = text.trim();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) code = parsed.error;
  } catch {
    /* plain text body */
  }
  return ERRORS[code] ?? (code || `فشل الطلب (${res.status})`);
}

export type StartResult =
  | { runId: string; next: { agentId: string; agentName: string } | null; mentioned: string }
  | { conflictRunId: string };

export async function startCouncil(args: { projectId: string; prompt: string; maxRounds: number }): Promise<StartResult> {
  const res = await post({ action: "start", ...args });
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { runId?: string } | null;
    if (body?.runId) return { conflictRunId: body.runId };
  }
  if (!res.ok) throw new Error(await describe(res));
  const body = (await res.json()) as {
    runId: string;
    next: { agentId: string; agentName: string } | null;
    mentioned?: string;
  };
  return { runId: body.runId, next: body.next, mentioned: body.mentioned ?? "" };
}

/** Runs exactly one turn and returns its closing event. */
export async function stepCouncil(
  runId: string,
  onEvent: (e: CouncilEvent) => void,
  signal?: AbortSignal,
): Promise<Extract<CouncilEvent, { type: "step_done" }> | null> {
  const res = await post({ action: "step", runId }, signal);
  if (!res.ok || !res.body) throw new Error(await describe(res));

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let last: Extract<CouncilEvent, { type: "step_done" }> | null = null;

  const handle = (line: string) => {
    let event: CouncilEvent;
    try {
      event = JSON.parse(line) as CouncilEvent;
    } catch {
      return; // a malformed line must not kill the run
    }
    if (event.type === "step_done") last = event;
    onEvent(event);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) handle(line);
    }
  }
  if (buf.trim()) handle(buf.trim());
  return last;
}

/** Client-side safety net; the server also caps steps per run. */
const MAX_CLIENT_STEPS = 30;

async function pump(runId: string, onEvent: (e: CouncilEvent) => void, signal?: AbortSignal) {
  for (let i = 0; i < MAX_CLIENT_STEPS; i++) {
    if (signal?.aborted) return "aborted";
    const done = await stepCouncil(runId, onEvent, signal);
    if (!done) return "unknown";
    if (done.retry || !done.hasNext || done.status !== "running") return done.status;
  }
  return "max_steps";
}

export async function resumeCouncil(runId: string, onEvent: (e: CouncilEvent) => void, signal?: AbortSignal) {
  return pump(runId, onEvent, signal);
}

export async function cancelCouncil(runId: string) {
  const res = await post({ action: "cancel", runId });
  if (!res.ok) throw new Error(await describe(res));
}

export async function streamTask(taskId: string, onText: (t: string) => void, signal?: AbortSignal) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/execute-task", {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok || !res.body) throw new Error(await describe(res));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(dec.decode(value, { stream: true }));
  }
}

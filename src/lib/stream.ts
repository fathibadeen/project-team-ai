import { supabase } from "@/integrations/supabase/client";

async function authedPost(path: string, body: unknown, signal?: AbortSignal) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`فشل الطلب (${res.status})`);
  return res.body.getReader();
}

export async function streamDiscussion(
  body: { projectId: string; prompt: string },
  onEvent: (e: any) => void,
  signal?: AbortSignal,
) {
  const reader = await authedPost("/api/discuss", body, signal);
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

export async function streamTask(taskId: string, onText: (t: string) => void, signal?: AbortSignal) {
  const reader = await authedPost("/api/execute-task", { taskId }, signal);
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(dec.decode(value, { stream: true }));
  }
}

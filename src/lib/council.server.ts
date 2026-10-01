import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ChatMsg, ProviderKey } from "./ai.server";

export type Agent = Database["public"]["Tables"]["agents"]["Row"];

export async function authFromRequest(request: Request) {
  const url = process.env["SUPABASE_URL"]!;
  const pub = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const token = (request.headers.get("authorization") ?? "").replace("Bearer ", "");
  if (!token || token.split(".").length !== 3) return null;
  const supabase = createClient<Database>(url, pub, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", pub);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { supabase, userId: data.claims.sub as string };
}

export async function loadKey(userId: string, keyId: string | null): Promise<ProviderKey> {
  if (!keyId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("provider_keys")
    .select("kind, base_url, api_key")
    .eq("id", keyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

const MAX_CONTEXT = 120_000;

export function projectContext(
  project: { title: string; description: string },
  files: { name: string; content: string }[],
) {
  let ctx = `# المشروع: ${project.title}\n\n${project.description}\n`;
  for (const f of files) {
    if (ctx.length > MAX_CONTEXT) break;
    ctx += `\n\n## ملف: ${f.name}\n\`\`\`\n${f.content.slice(0, MAX_CONTEXT - ctx.length)}\n\`\`\``;
  }
  return ctx;
}

export function agentSystem(agent: Agent, team: Agent[], context: string) {
  const teamList = team.map((a) => `- ${a.name}${a.is_leader ? " (القائد)" : ""}: ${a.role}`).join("\n");
  return `أنت "${agent.name}"، ${agent.role || "عضو في فريق"} ضمن مجلس من الوكلاء يناقش مشروعاً.
تعليماتك:
${agent.instructions || "قدّم رأيك المهني بوضوح."}

أعضاء الفريق:
${teamList}

قواعد: تحدث بلسانك فقط، ورد باللغة التي يكتب بها المستخدم (العربية افتراضياً). علّق على آراء الزملاء عند الحاجة. كن موجزاً ومحدداً.

${context}`;
}

export function historyToMessages(
  history: { agent_name: string | null; content: string }[],
  selfName: string,
): ChatMsg[] {
  const msgs: ChatMsg[] = [];
  for (const h of history) {
    if (h.agent_name === selfName) msgs.push({ role: "assistant", content: h.content });
    else msgs.push({ role: "user", content: `[${h.agent_name ?? "المستخدم"}]: ${h.content}` });
  }
  // merge consecutive same-role messages (Claude requires alternation)
  const merged: ChatMsg[] = [];
  for (const m of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  if (merged[0]?.role === "assistant") merged.unshift({ role: "user", content: "ابدأ النقاش." });
  if (merged[merged.length - 1]?.role === "assistant")
    merged.push({ role: "user", content: "تابع وقدّم رأيك." });
  return merged;
}

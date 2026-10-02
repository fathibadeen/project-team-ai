import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ChatMsg, ProviderKey } from "./ai.server";

export type Agent = Database["public"]["Tables"]["agents"]["Row"];
export type RunRow = Database["public"]["Tables"]["discussion_runs"]["Row"];

/** Message shape the context builder needs (subset of the messages row). */
export type HistoryRow = {
  agent_id: string | null;
  agent_name: string | null;
  content: string;
  kind: string;
  round: number | null;
  run_id: string | null;
  stance: string | null;
  targets: string[];
  key_points: string[];
};

export type Stance = "agree" | "object" | "neutral";

export const MAX_ROUNDS = 3;
/** Hard ceiling on LLM calls per run, independent of rounds. */
export const MAX_STEPS = 16;
/** Rows pulled for one turn: digest is built from all of them, full text from the newest subset. */
export const HISTORY_FETCH = 60;
const PROJECT_CTX_MAX = 40_000;
const HISTORY_MAX = 24_000;

export const COUNCIL_OPEN = "<<<COUNCIL";
const COUNCIL_CLOSE = "COUNCIL>>>";

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

/* ---------------------------------------------------------------- names ---- */

/** Arabic-tolerant key: drops diacritics/tatweel, folds alef/ya/ta-marbuta, strips punctuation. */
function norm(value: string) {
  return value
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function resolveNames(names: unknown[], team: Agent[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const key = norm(raw);
    if (!key) continue;
    const hit = team.find((a) => norm(a.name) === key) ?? team.find((a) => norm(a.name).includes(key) && key.length >= 3);
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out.slice(0, 5);
}

export function agentNames(ids: string[], team: Agent[]) {
  return ids.map((id) => team.find((a) => a.id === id)?.name).filter(Boolean).join("، ");
}

/** Agents the user addressed by name in the prompt: `@الاسم` when present, otherwise whole-word name hits. */
export function mentionedAgents(prompt: string, team: Agent[]): string[] {
  const at = [...prompt.matchAll(/@([\p{L}\p{N}\s]{2,60})/gu)].map((m) => m[1] ?? "");
  const segments = (at.length ? at : [prompt]).map(tokens);
  return team
    .filter((a) => {
      const want = tokens(a.name);
      return want.length > 0 && segments.some((seq) => containsSequence(seq, want));
    })
    .map((a) => a.id);
}

function tokens(value: string) {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map(norm)
    .filter(Boolean);
}

/** Whole-token match so "المهندسين" never counts as a mention of "المهندس". */
function containsSequence(seq: string[], want: string[]) {
  for (let i = 0; i + want.length <= seq.length; i++) {
    if (want.every((w, j) => seq[i + j] === w)) return true;
  }
  return false;
}

/** Leader always speaks last within a round. */
export function sortTeam(agents: Agent[]) {
  return [...agents].sort((a, b) => Number(a.is_leader) - Number(b.is_leader));
}

/* ------------------------------------------------------- structured tail ---- */

export type CouncilTail = { clean: string; stance: Stance; targets: string[]; points: string[] };

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/**
 * Splits an agent turn into displayable text and its structured tail.
 * `targets` holds objections first, then plain mentions; `stance` qualifies the first group.
 * Any malformed tail degrades to a neutral stance with no targets instead of failing the run.
 */
export function parseCouncilTail(text: string, team: Agent[]): CouncilTail {
  const idx = text.lastIndexOf(COUNCIL_OPEN);
  const clean = (idx >= 0 ? text.slice(0, idx) : text).trim();
  const fallback: CouncilTail = { clean, stance: "neutral", targets: [], points: [] };
  if (idx < 0) return fallback;

  let raw = text.slice(idx + COUNCIL_OPEN.length);
  const end = raw.indexOf(COUNCIL_CLOSE);
  if (end >= 0) raw = raw.slice(0, end);
  raw = raw.replace(/```[a-z]*/gi, "");
  const open = raw.indexOf("{");
  const close = raw.lastIndexOf("}");
  if (open < 0 || close <= open) return fallback;

  try {
    const parsed = JSON.parse(raw.slice(open, close + 1)) as {
      stance?: unknown;
      objections?: unknown;
      mentions?: unknown;
      points?: unknown;
    };
    const stance: Stance = parsed.stance === "agree" || parsed.stance === "object" ? parsed.stance : "neutral";
    const targets = resolveNames([...toArray(parsed.objections), ...toArray(parsed.mentions)], team);
    const points = toArray(parsed.points)
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .slice(0, 5)
      .map((p) => p.trim().slice(0, 200));
    return { clean, stance, targets, points };
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------- context ----- */

export function projectContext(
  project: { title: string; description: string },
  files: { name: string; content: string }[],
) {
  let ctx = `# المشروع: ${project.title}\n\n${project.description}\n`;
  for (const f of files) {
    if (ctx.length > PROJECT_CTX_MAX) break;
    ctx += `\n\n## ملف: ${f.name}\n\`\`\`\n${f.content.slice(0, PROJECT_CTX_MAX - ctx.length)}\n\`\`\``;
  }
  return ctx;
}

/** Mechanically assembled recap of earlier rounds — no extra model call. */
export function roundDigest(history: HistoryRow[], runId: string, currentRound: number, team: Agent[]) {
  const rounds = new Map<number, string[]>();
  for (const h of history) {
    if (h.kind !== "agent" || h.run_id !== runId || !h.round || h.round >= currentRound) continue;
    const label =
      h.stance === "object"
        ? `معارض${h.targets.length ? ` لـ: ${agentNames(h.targets, team)}` : ""}`
        : h.stance === "agree"
          ? "موافق"
          : "محايد";
    const points = h.key_points.length ? ` — ${h.key_points.join("؛ ")}` : "";
    const line = `- [${h.agent_name ?? "عضو"}] ${label}${points}`;
    const bucket = rounds.get(h.round);
    if (bucket) bucket.push(line);
    else rounds.set(h.round, [line]);
  }
  if (!rounds.size) return "";
  return [...rounds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, lines]) => `## موجز الجولة ${round}\n${lines.join("\n")}`)
    .join("\n\n");
}

/** Newest rows that fit the char budget, in chronological order; the run's own prompt is never dropped. */
export function historyWindow(history: HistoryRow[], runId: string) {
  const window: HistoryRow[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i]!;
    const cost = row.content.length + 40;
    if (used + cost > HISTORY_MAX && window.length) break;
    window.unshift(row);
    used += cost;
  }
  const prompt = history.find((h) => h.kind === "user" && h.run_id === runId);
  if (prompt && !window.includes(prompt)) window.unshift(prompt);
  return window;
}

export function historyToMessages(history: HistoryRow[], selfName: string, team: Agent[] = []): ChatMsg[] {
  const msgs: ChatMsg[] = [];
  for (const h of history) {
    if (h.agent_name === selfName) {
      msgs.push({ role: "assistant", content: h.content });
      continue;
    }
    const who = h.agent_name ?? "المستخدم";
    const round = h.round ? ` · جولة ${h.round}` : "";
    const objection =
      h.stance === "object" && h.targets.length ? ` (اعترض على: ${agentNames(h.targets, team)})` : "";
    msgs.push({ role: "user", content: `[${who}${round}]${objection}: ${h.content}` });
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

const TAIL_CONTRACT = `في آخر ردّك أضف هذه الكتلة حرفياً ولا تكتب شيئاً بعدها:
${COUNCIL_OPEN}
{"stance":"agree|object|neutral","objections":["اسم الزميل"],"mentions":["اسم الزميل"],"points":["نقطة موجزة"]}
${COUNCIL_CLOSE}
- stance: موقفك من آراء الزملاء في هذه الجولة.
- objections: أسماء من تعترض على رأيهم (فارغة إن لم تعترض).
- mentions: أسماء من تخاطبهم أو تطلب ردّهم.
- points: نقاطك الأساسية في سطور قصيرة جداً (3 كحد أقصى).`;

/** Full system prompt for one debate turn. */
export function buildTurnContext(opts: {
  self: Agent;
  team: Agent[];
  project: { title: string; description: string };
  files: { name: string; content: string }[];
  history: HistoryRow[];
  runId: string;
  round: number;
  maxRounds: number;
}) {
  const { self, team, project, files, history, runId, round, maxRounds } = opts;
  const digest = roundDigest(history, runId, round, team);
  const context = digest ? `${projectContext(project, files)}\n\n# ما جرى في الجولات السابقة\n${digest}` : projectContext(project, files);

  const objections = history
    .filter(
      (h) =>
        h.kind === "agent" &&
        h.run_id === runId &&
        h.stance === "object" &&
        h.agent_name !== self.name &&
        h.targets.includes(self.id),
    )
    .map((h) => `- ${h.agent_name}: ${h.key_points.join("؛ ") || "اعترض على رأيك"}`);

  const roundRules =
    round === 1
      ? `أنت في الجولة 1 من ${maxRounds}. خاطب الزملاء بأسمائهم عند الرد عليهم، وإن اعترضت فحدّد على مَن وبماذا. لا تُعِد ما قاله غيرك.`
      : `أنت في جولة ردّ (${round} من ${maxRounds}). ${
          objections.length
            ? `ردّ تحديداً على الاعتراضات الموجّهة إليك:\n${objections.join("\n")}`
            : "أضف ما لم يُقل بعد أو حسم ما بقي معلقاً، ولا تكرر رأيك السابق."
        }`;

  return `${agentSystem(self, team, context)}

${roundRules}

${TAIL_CONTRACT}`;
}

/** Closing step: the leader resolves the debate, then proposes tasks. */
export function buildDecisionContext(opts: {
  leader: Agent;
  team: Agent[];
  others: Agent[];
  project: { title: string; description: string };
  files: { name: string; content: string }[];
  history: HistoryRow[];
  runId: string;
  round: number;
}) {
  const { leader, team, others, project, files, history, runId, round } = opts;
  const digest = roundDigest(history, runId, round + 1, team);
  const context = digest ? `${projectContext(project, files)}\n\n# موجز النقاش\n${digest}` : projectContext(project, files);
  const roster = others.map((a) => `- id: ${a.id} | ${a.name}: ${a.role}`).join("\n");

  return `${agentSystem(leader, team, context)}

مهمتك الآن حسم النقاش ككلمة ختامية:
1. مواضع الاتفاق.
2. الخلافات وكيف حُسمت ولماذا. قيّم الحجج بمضمونها لا بصاحبها، وإن تغيّر رأيك عن جولة سابقة فاذكر ذلك صراحةً، واسرد كل اعتراض لم تأخذ به مع سبب رفضه.
3. القرار النهائي.

ثم في آخر ردّك أضف المهام التنفيذية (1 إلى 4) بهذه الكتلة حرفياً ولا تكتب شيئاً بعدها:
${COUNCIL_OPEN}
{"tasks":[{"agent_id":"...","title":"...","details":"تعليمات تفصيلية","output_type":"report|document|code"}]}
${COUNCIL_CLOSE}
الأعضاء المتاحون:
${roster}
إذا لم تكن هناك حاجة لمهام أرجع {"tasks":[]}`;
}

export type TaskInsert = {
  project_id: string;
  agent_id: string | null;
  title: string;
  details: string;
  output_type: string;
};

/** Tolerant extraction of the leader's task list from free-form text. */
export function parseLeaderTasks(raw: string, opts: { projectId: string; team: Agent[]; others: Agent[] }): TaskInsert[] {
  const tail = raw.lastIndexOf(COUNCIL_OPEN);
  const scope = tail >= 0 ? raw.slice(tail) : raw;
  const match = scope.match(/\{[\s\S]*\}/) ?? raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let tasks: unknown[] = [];
  try {
    const parsed = JSON.parse(match[0]) as { tasks?: unknown };
    tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
  return tasks
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .filter((t) => typeof t["title"] === "string")
    .slice(0, 4)
    .map((t) => ({
      project_id: opts.projectId,
      agent_id: opts.team.some((a) => a.id === t["agent_id"]) ? (t["agent_id"] as string) : (opts.others[0]?.id ?? null),
      title: String(t["title"]).slice(0, 300),
      details: String(t["details"] ?? "").slice(0, 5000),
      output_type: ["report", "document", "code"].includes(String(t["output_type"])) ? String(t["output_type"]) : "report",
    }));
}

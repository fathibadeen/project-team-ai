import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startCouncil, resumeCouncil, cancelCouncil, streamTask, type CouncilEvent } from "@/lib/stream";
import { extractText, downloadText, downloadCodeZip } from "@/lib/extract";
import { OUTPUT_LABEL, STATUS_LABEL } from "@/lib/models";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "المشروع — مجلس الوكلاء" }, { name: "description", content: "نقاش الوكلاء ومهام المشروع." }] }),
  component: ProjectPage,
});

type Live = {
  runId: string;
  agentId: string;
  agentName: string;
  round: number;
  repliesTo: string[];
  decision: boolean;
  text: string;
} | null;

const ROUNDS = [1, 2, 3];

function ProjectPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const q = (k: string, fn: () => Promise<any>) => useQuery({ queryKey: [k, id], queryFn: fn });
  const project = q("project", async () => (await supabase.from("projects").select("*").eq("id", id).single()).data);
  const agents = useQuery({ queryKey: ["agents"], queryFn: async () => (await supabase.from("agents").select("*")).data ?? [] });
  const files = q("files", async () => (await supabase.from("project_files").select("id,name,size").eq("project_id", id).order("created_at")).data ?? []);
  const messages = q("messages", async () => (await supabase.from("messages").select("*").eq("project_id", id).order("created_at")).data ?? []);
  const tasks = q("tasks", async () => (await supabase.from("tasks").select("*").eq("project_id", id).order("created_at", { ascending: false })).data ?? []);
  const artifacts = q("artifacts", async () => (await supabase.from("artifacts").select("*").eq("project_id", id).order("created_at", { ascending: false })).data ?? []);
  const openRun = useQuery({
    queryKey: ["run", id],
    queryFn: async () =>
      (
        await supabase
          .from("discussion_runs")
          .select("id,status,round,max_rounds")
          .eq("project_id", id)
          .in("status", ["running", "stepping"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });

  const [prompt, setPrompt] = useState("");
  const [maxRounds, setMaxRounds] = useState(2);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState<Record<string, string>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const agentById = (aid: string | null) => agents.data?.find((a: any) => a.id === aid);
  const team = (agents.data ?? []).filter((a: any) => project.data?.agent_ids.includes(a.id));
  const names = (ids: string[] | null) => (ids ?? []).map((t) => agentById(t)?.name).filter(Boolean).join("، ");

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.data?.length, live?.text]);
  const refresh = (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }));

  async function upload(list: FileList | null) {
    if (!list) return;
    const { data: u } = await supabase.auth.getUser();
    for (const f of Array.from(list)) {
      try {
        const content = await extractText(f);
        const { error } = await supabase.from("project_files").insert({ project_id: id, name: f.name, size: f.size, content, user_id: u.user!.id });
        if (error) throw error;
        toast.success(`تم رفع ${f.name}`);
      } catch (e: any) { toast.error(`تعذر قراءة ${f.name}`); }
    }
    refresh("files");
  }

  /** Drives the step engine: one HTTP request per agent turn until the run finishes. */
  async function pump(runId: string) {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    let cur: Live = null;
    try {
      await resumeCouncil(
        runId,
        (e: CouncilEvent) => {
          if (e.type === "turn_start") {
            cur = {
              runId,
              agentId: e.agentId,
              agentName: e.agentName,
              round: e.round,
              repliesTo: e.repliesTo ?? [],
              decision: e.phase === "decision",
              text: "",
            };
            setLive(cur);
            setStatus(e.phase === "decision" ? "القائد يحسم النقاش ويجهّز المهام..." : "");
          } else if (e.type === "delta" && cur) {
            cur = { ...cur, text: cur.text + e.text };
            setLive(cur);
          } else if (e.type === "turn_end") {
            refresh("messages");
          } else if (e.type === "tasks") {
            refresh("tasks");
            if (e.count) toast.success(`اقترح القائد ${e.count} مهام بانتظار موافقتك`);
          } else if (e.type === "error") {
            toast.error(e.message);
          } else if (e.type === "step_done") {
            if (e.retry) toast.error("توقف النقاش عند هذه الخطوة. يمكنك استئنافه.");
            refresh("messages", "run");
          }
        },
        ac.signal,
      );
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e.message);
    } finally {
      abortRef.current = null;
      setLive(null);
      setStatus("");
      setBusy(false);
      refresh("messages", "tasks", "run");
    }
  }

  async function discuss() {
    if (!prompt.trim() || busy) return;
    if (!team.length) { toast.error("أضف وكلاء لهذا المشروع أولاً"); return; }
    const p = prompt;
    setPrompt("");
    try {
      const started = await startCouncil({ projectId: id, prompt: p, maxRounds });
      refresh("messages", "run");
      if ("conflictRunId" in started) {
        toast.error("هناك نقاش غير مكتمل. استأنفه أو ألغه أولاً.");
        return;
      }
      if (started.mentioned) toast.info(`نادَيت: ${started.mentioned}`);
      await pump(started.runId);
    } catch (e: any) {
      setPrompt(p);
      toast.error(e.message);
    }
  }

  async function stop() {
    const runId = live?.runId ?? openRun.data?.id;
    if (!runId) return;
    try { await cancelCouncil(runId); } catch (e: any) { toast.error(e.message); }
    abortRef.current?.abort();
    refresh("run");
  }

  async function decide(taskId: string, approve: boolean) {
    await supabase.from("tasks").update({ status: approve ? "approved" : "rejected" }).eq("id", taskId);
    refresh("tasks");
    if (!approve) return;
    setRunning((r) => ({ ...r, [taskId]: "" }));
    try {
      await streamTask(taskId, (t) => setRunning((r) => ({ ...r, [taskId]: (r[taskId] ?? "") + t })));
      toast.success("اكتملت المهمة");
    } catch (e: any) { toast.error(e.message); }
    setRunning((r) => { const { [taskId]: _, ...rest } = r; return rest; });
    refresh("tasks", "artifacts");
  }

  async function delFile(fid: string) { await supabase.from("project_files").delete().eq("id", fid); refresh("files"); }

  async function toggleAgent(aid: string) {
    const ids = project.data.agent_ids.includes(aid) ? project.data.agent_ids.filter((x: string) => x !== aid) : [...project.data.agent_ids, aid];
    await supabase.from("projects").update({ agent_ids: ids }).eq("id", id);
    refresh("project");
  }

  if (!project.data) return <p className="text-muted-foreground">جارٍ التحميل...</p>;
  const pending = (tasks.data ?? []).filter((t: any) => t.status === "proposed").length;
  // the streaming bubble already shows this turn; hide its saved row until the turn moves on
  const streamed = (m: any) => live && m.run_id === live.runId && m.agent_id === live.agentId && m.round === live.round;
  const shown = (messages.data ?? []).filter((m: any) => !streamed(m));
  const resumable = !busy && !!openRun.data;

  return (
    <div>
      <Link to="/dashboard" className="text-sm text-muted-foreground">← المشاريع</Link>
      <h1 className="mt-2 font-display text-3xl">{project.data.title}</h1>
      {project.data.description && <p className="mt-1 text-muted-foreground">{project.data.description}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {(agents.data ?? []).map((a: any) => {
          const on = project.data.agent_ids.includes(a.id);
          return (
            <button key={a.id} onClick={() => toggleAgent(a.id)} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${on ? "" : "opacity-40"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />{a.name}{a.is_leader ? " ★" : ""}
            </button>
          );
        })}
      </div>

      <Tabs defaultValue="discussion" className="mt-6" dir="rtl">
        <TabsList>
          <TabsTrigger value="discussion">النقاش</TabsTrigger>
          <TabsTrigger value="tasks">المهام {pending ? `(${pending})` : ""}</TabsTrigger>
          <TabsTrigger value="outputs">المخرجات</TabsTrigger>
          <TabsTrigger value="files">الملفات ({files.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="discussion">
          {resumable && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm">
              <span>نقاش غير مكتمل (جولة {openRun.data!.round} من {openRun.data!.max_rounds}).</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => pump(openRun.data!.id)}>استئناف</Button>
                <Button size="sm" variant="outline" onClick={stop}>إلغاء</Button>
              </div>
            </div>
          )}
          <div className="space-y-4 rounded-xl border bg-card p-4">
            {shown.length === 0 && !live && <p className="py-10 text-center text-muted-foreground">اطرح سؤالاً أو اطلب رأي الفريق في المشروع.</p>}
            {shown.map((m: any, i: number) => {
              const prev = shown[i - 1];
              const divider = m.kind !== "user" && m.round && (!prev || prev.run_id !== m.run_id || prev.round !== m.round);
              return (
                <div key={m.id} className="space-y-4">
                  {divider && <RoundDivider round={m.round} />}
                  <Bubble
                    name={m.agent_name}
                    color={agentById(m.agent_id)?.color}
                    text={m.content}
                    decision={m.kind === "decision"}
                    stance={m.stance}
                    targets={names(m.targets)}
                  />
                </div>
              );
            })}
            {live && (
              <Bubble
                name={live.agentName}
                color={agentById(live.agentId)?.color}
                text={live.text || "يكتب..."}
                decision={live.decision}
                round={live.round}
                repliesTo={live.repliesTo.join("، ")}
              />
            )}
            {status && <p className="text-sm text-primary">{status}</p>}
            <div ref={endRef} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">جولات النقاش:</span>
            {ROUNDS.map((r) => (
              <button
                key={r}
                onClick={() => setMaxRounds(r)}
                className={`rounded-full border px-3 py-1 text-sm ${maxRounds === r ? "border-primary bg-primary/15" : "opacity-60"}`}
              >
                {r}
              </button>
            ))}
            <span className="text-xs text-muted-foreground">حتى {team.length * maxRounds + 1} نداء نموذج</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Textarea rows={2} placeholder="راجعوا المشروع وأعطوني رأيكم — ونادِ وكيلاً بعينه بـ @الاسم" value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); discuss(); } }} />
            {busy ? (
              <Button onClick={stop} variant="outline" className="h-auto">إيقاف</Button>
            ) : (
              <Button onClick={discuss} className="h-auto">إرسال</Button>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-3">
          {tasks.data?.length === 0 && <p className="text-muted-foreground">لا توجد مهام. سيقترح القائد مهاماً بعد النقاش.</p>}
          {tasks.data?.map((t: any) => (
            <div key={t.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{t.title}</h3>
                  <p className="text-xs text-muted-foreground">إلى: {agentById(t.agent_id)?.name ?? "—"} · {OUTPUT_LABEL[t.output_type]} · {STATUS_LABEL[t.status]}</p>
                </div>
                {t.status === "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => decide(t.id, true)}>موافقة وتنفيذ</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(t.id, false)}>رفض</Button>
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{t.details}</p>
              {t.id in running && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{running[t.id] || "جارٍ التنفيذ..."}</pre>}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="outputs" className="space-y-3">
          {artifacts.data?.length === 0 && <p className="text-muted-foreground">لا توجد مخرجات بعد.</p>}
          {artifacts.data?.map((a: any) => (
            <details key={a.id} className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer font-semibold">{a.title} <span className="text-xs text-muted-foreground">— {a.agent_name}</span></summary>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadText(a.filename, a.content)}>تنزيل</Button>
                {a.content.includes("### FILE:") && <Button size="sm" variant="outline" onClick={() => downloadCodeZip(a.filename, a.content)}>تنزيل الكود (ZIP)</Button>}
              </div>
              <pre className="mt-3 max-h-[500px] overflow-auto whitespace-pre-wrap text-sm">{a.content}</pre>
            </details>
          ))}
        </TabsContent>

        <TabsContent value="files">
          <label className="block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center text-muted-foreground hover:border-primary">
            اضغط لرفع ملفات (نص، PDF، Word، ZIP للكود)
            <input type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
          <div className="mt-4 space-y-2">
            {files.data?.map((f: any) => (
              <div key={f.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
                <span>{f.name} <span className="text-xs text-muted-foreground">({Math.round(f.size / 1024)} KB)</span></span>
                <Button size="sm" variant="ghost" onClick={() => delFile(f.id)}>حذف</Button>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RoundDivider({ round }: { round: number }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      الجولة {round}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Bubble({
  name,
  color,
  text,
  decision,
  stance,
  targets,
  round,
  repliesTo,
}: {
  name: string | null;
  color?: string | undefined;
  text: string;
  decision?: boolean;
  stance?: string | null;
  targets?: string;
  round?: number;
  repliesTo?: string;
}) {
  const user = !name;
  const badge =
    stance === "object"
      ? `معارض${targets ? ` · ${targets}` : ""}`
      : stance === "agree"
        ? "موافق"
        : repliesTo
          ? `يرد على: ${repliesTo}`
          : "";
  return (
    <div
      className={`rounded-lg p-3 ${user ? "mr-auto max-w-[85%] bg-primary/15" : decision ? "border border-primary/50 bg-primary/5" : "bg-muted"}`}
      style={user || decision ? {} : { borderRight: `3px solid ${color ?? "currentColor"}` }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: user ? undefined : color }}>
        <span>{name ?? "أنت"}</span>
        {decision && <span className="rounded bg-primary/20 px-1.5 py-0.5 text-primary">قرار القائد</span>}
        {round ? <span className="text-muted-foreground">جولة {round}</span> : null}
        {badge && <span className={`rounded px-1.5 py-0.5 ${stance === "object" ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground"}`}>{badge}</span>}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
    </div>
  );
}

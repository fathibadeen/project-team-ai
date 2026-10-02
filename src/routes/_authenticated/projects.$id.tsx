import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { streamDiscussion, streamTask } from "@/lib/stream";
import { extractText, downloadText, downloadCodeZip } from "@/lib/extract";
import { OUTPUT_LABEL, STATUS_LABEL } from "@/lib/models";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "المشروع — مجلس الوكلاء" }, { name: "description", content: "نقاش الوكلاء ومهام المشروع." }] }),
  component: ProjectPage,
});

type Live = { agentId: string; agentName: string; text: string } | null;

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

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState<Record<string, string>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const agentById = (aid: string | null) => agents.data?.find((a: any) => a.id === aid);
  const team = (agents.data ?? []).filter((a: any) => project.data?.agent_ids.includes(a.id));

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

  async function discuss() {
    if (!prompt.trim() || busy) return;
    if (!team.length) { toast.error("أضف وكلاء لهذا المشروع أولاً"); return; }
    setBusy(true);
    const p = prompt; setPrompt("");
    let cur: Live = null;
    try {
      await streamDiscussion({ projectId: id, prompt: p }, (e) => {
        if (e.type === "start") { cur = { agentId: e.agentId, agentName: e.agentName, text: "" }; setLive(cur); refresh("messages"); }
        else if (e.type === "delta" && cur) { cur = { ...cur, text: cur.text + e.text }; setLive(cur); }
        else if (e.type === "end") { refresh("messages"); }
        else if (e.type === "status") setStatus(e.text);
        else if (e.type === "tasks") { refresh("tasks"); if (e.count) toast.success(`اقترح القائد ${e.count} مهام بانتظار موافقتك`); }
        else if (e.type === "error") toast.error(e.message);
      });
    } catch (e: any) { toast.error(e.message); }
    setLive(null); setStatus(""); setBusy(false);
    refresh("messages", "tasks");
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
          <div className="space-y-4 rounded-xl border bg-card p-4">
            {messages.data?.length === 0 && !live && <p className="py-10 text-center text-muted-foreground">اطرح سؤالاً أو اطلب رأي الفريق في المشروع.</p>}
            {messages.data?.filter((m: any) => !(live && m.agent_id === live.agentId && false)).map((m: any) => <Bubble key={m.id} name={m.agent_name} color={agentById(m.agent_id)?.color} text={m.content} />)}
            {live && <Bubble name={live.agentName} color={agentById(live.agentId)?.color} text={live.text || "يكتب..."} />}
            {status && <p className="text-sm text-primary">{status}</p>}
            <div ref={endRef} />
          </div>
          <div className="mt-3 flex gap-2">
            <Textarea rows={2} placeholder="مثلاً: راجعوا المشروع وأعطوني رأيكم في الجودة والبنية" value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); discuss(); } }} />
            <Button onClick={discuss} disabled={busy} className="h-auto">{busy ? "يتناقشون..." : "إرسال"}</Button>
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

function Bubble({ name, color, text }: { name: string | null; color?: string | undefined; text: string }) {
  const user = !name;
  return (
    <div className={`rounded-lg p-3 ${user ? "mr-auto max-w-[85%] bg-primary/15" : "bg-muted"}`} style={user ? {} : { borderRight: `3px solid ${color ?? "currentColor"}` }}>
      <div className="mb-1 text-xs font-semibold" style={{ color: user ? undefined : color }}>{name ?? "أنت"}</div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
    </div>
  );
}

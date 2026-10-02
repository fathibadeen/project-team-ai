import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "مشاريعي — مجلس الوكلاء" }, { name: "description", content: "مشاريعك ونقاشات وكلائك." }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await supabase.from("projects").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await supabase.from("agents").select("*").order("created_at")).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  async function create() {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("projects").insert({
      title, description: desc, agent_ids: picked, user_id: u.user!.id,
    });
    if (error) { toast.error(error.message); return; }
    setOpen(false); setTitle(""); setDesc(""); setPicked([]);
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">مشاريعي</h1>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setPicked((agents.data ?? []).map((a) => a.id)); }}>
          <DialogTrigger asChild><Button>مشروع جديد</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>مشروع جديد</DialogTitle></DialogHeader>
            <Input placeholder="اسم المشروع" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="وصف المشروع وأهدافه" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div className="text-sm font-medium">الوكلاء المشاركون</div>
            {!agents.data?.length && <p className="text-sm text-muted-foreground">لا يوجد وكلاء بعد. <Link to="/agents" className="text-primary">أضف وكلاء</Link></p>}
            <div className="flex flex-wrap gap-2">
              {agents.data?.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <button key={a.id} onClick={() => setPicked(on ? picked.filter((x) => x !== a.id) : [...picked, a.id])}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary/15" : "opacity-60"}`}>
                    {a.name}{a.is_leader ? " ★" : ""}
                  </button>
                );
              })}
            </div>
            <Button disabled={!title.trim()} onClick={create}>إنشاء</Button>
          </DialogContent>
        </Dialog>
      </div>
      {!agents.isLoading && !agents.data?.length && (
        <div className="mt-6 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm">
          ابدأ بتكوين مجلسك: <Link to="/agents" className="font-semibold text-primary">أضف أول وكيل</Link>
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {projects.data?.map((p) => (
          <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="rounded-xl border bg-card p-5 transition hover:border-primary">
            <h3 className="font-semibold">{p.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.description || "بدون وصف"}</p>
            <p className="mt-3 text-xs text-muted-foreground">{p.agent_ids.length} وكلاء</p>
          </Link>
        ))}
        {projects.data?.length === 0 && <p className="text-muted-foreground">لا توجد مشاريع بعد.</p>}
      </div>
    </div>
  );
}

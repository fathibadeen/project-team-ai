import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PROVIDERS, AGENT_COLORS, KEY_PRESETS } from "@/lib/models";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({ meta: [{ title: "الوكلاء — مجلس الوكلاء" }, { name: "description", content: "أنشئ وكلاءك وحدد أدوارهم وتعليماتهم." }] }),
  component: Agents,
});

type Form = { id?: string; name: string; role: string; instructions: string; provider: string; model: string; provider_key_id: string | null; is_leader: boolean; color: string };
const EMPTY: Form = { name: "", role: "", instructions: "", provider: "anthropic", model: PROVIDERS[0].models[0], provider_key_id: null, is_leader: false, color: AGENT_COLORS[0]! };

const TEMPLATES: Partial<Form>[] = [
  { name: "القائد", role: "قائد الفريق", instructions: "تدير النقاش، تلخص الآراء، وتوزع المهام على الفريق بوضوح.", is_leader: true },
  { name: "مدير الجودة", role: "ضمان الجودة", instructions: "تراجع المشروع بعين ناقدة: الأخطاء، المخاطر، الاختبارات، ومعايير الجودة." },
  { name: "المهندس", role: "مهندس برمجيات", instructions: "تقيّم البنية التقنية وتقترح حلولاً عملية قابلة للتنفيذ." },
];

function Agents() {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ["agents"], queryFn: async () => (await supabase.from("agents").select("*").order("created_at")).data ?? [] });
  const keys = useQuery({ queryKey: ["keys"], queryFn: async () => (await supabase.from("provider_keys").select("id,label,kind,base_url").order("created_at")).data ?? [] });
  const [form, setForm] = useState<Form | null>(null);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...(f as Form), ...p }));

  async function save() {
    if (!form) return;
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user!.id;
    if (form.is_leader) await supabase.from("agents").update({ is_leader: false }).eq("user_id", uid).neq("id", form.id ?? "00000000-0000-0000-0000-000000000000");
    const { id, ...row } = form;
    const { error } = id
      ? await supabase.from("agents").update(row).eq("id", id)
      : await supabase.from("agents").insert({ ...row, user_id: uid });
    if (error) { toast.error(error.message); return; }
    setForm(null);
    qc.invalidateQueries({ queryKey: ["agents"] });
  }
  async function del(id: string) {
    await supabase.from("agents").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["agents"] });
  }

  const provider = PROVIDERS.find((p) => p.id === form?.provider);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl">وكلائي</h1>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Button key={t.name} variant="outline" size="sm" onClick={() => setForm({ ...EMPTY, ...t, color: AGENT_COLORS[(agents.data?.length ?? 0) % AGENT_COLORS.length]! })}>+ {t.name}</Button>
          ))}
          <Button onClick={() => setForm({ ...EMPTY, color: AGENT_COLORS[(agents.data?.length ?? 0) % AGENT_COLORS.length]! })}>وكيل جديد</Button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {agents.data?.map((a) => (
          <div key={a.id} className="rounded-xl border bg-card p-5" style={{ borderTopColor: a.color, borderTopWidth: 3 }}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{a.name} {a.is_leader && <span className="text-xs text-primary">★ القائد</span>}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{a.role}</p>
            <p className="mt-2 text-xs text-muted-foreground" dir="ltr">{a.provider === "custom" ? keys.data?.find((k) => k.id === a.provider_key_id)?.label ?? "مفتاح خاص" : a.model}</p>
            <p className="mt-3 line-clamp-3 text-sm">{a.instructions}</p>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setForm({ ...a })}>تعديل</Button>
              <Button size="sm" variant="ghost" onClick={() => del(a.id)}>حذف</Button>
            </div>
          </div>
        ))}
        {agents.data?.length === 0 && <p className="text-muted-foreground">لا يوجد وكلاء. ابدأ بأحد القوالب أعلاه.</p>}
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "تعديل وكيل" : "وكيل جديد"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>الاسم</Label><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
                <div className="space-y-1"><Label>الدور</Label><Input value={form.role} onChange={(e) => set({ role: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>التعليمات</Label><Textarea rows={4} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} /></div>
              <div className="space-y-1"><Label>المنصة</Label>
                <Select value={form.provider} onValueChange={(v) => { const p = PROVIDERS.find((x) => x.id === v)!; set({ provider: v, model: p.models[0] ?? "", provider_key_id: null }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.provider !== "custom" ? (
                <div className="space-y-1"><Label>النموذج</Label>
                  <Select value={form.model} onValueChange={(v) => set({ model: v })}>
                    <SelectTrigger dir="ltr"><SelectValue /></SelectTrigger>
                    <SelectContent>{provider?.models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div className="space-y-1"><Label>المفتاح</Label>
                    {keys.data?.length ? (
                      <Select value={form.provider_key_id ?? ""} onValueChange={(v) => { const k = keys.data!.find((x) => x.id === v); set({ provider_key_id: v, model: form.model || KEY_PRESETS[k?.label ?? ""]?.model || "" }); }}>
                        <SelectTrigger><SelectValue placeholder="اختر مفتاحاً" /></SelectTrigger>
                        <SelectContent>{keys.data.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : <p className="text-sm text-muted-foreground">أضف مفتاحاً من صفحة المفاتيح أولاً.</p>}
                  </div>
                  <div className="space-y-1"><Label>اسم النموذج</Label><Input dir="ltr" placeholder="kimi-k2-0905-preview" value={form.model} onChange={(e) => set({ model: e.target.value })} /></div>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {AGENT_COLORS.map((c) => (
                  <button key={c} onClick={() => set({ color: c })} className={`h-7 w-7 rounded-full ${form.color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`} style={{ background: c }} aria-label={c} />
                ))}
              </div>
              <label className="flex items-center gap-3 text-sm"><Switch checked={form.is_leader} onCheckedChange={(v) => set({ is_leader: v })} /> هذا الوكيل هو القائد (يقترح المهام)</label>
              <Button className="w-full" disabled={!form.name || !form.model || (form.provider === "custom" && !form.provider_key_id)} onClick={save}>حفظ</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

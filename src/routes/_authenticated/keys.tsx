import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KEY_KINDS, KEY_PRESETS } from "@/lib/models";

export const Route = createFileRoute("/_authenticated/keys")({
  head: () => ({ meta: [{ title: "المفاتيح — مجلس الوكلاء" }, { name: "description", content: "مفاتيح مزودي الذكاء الاصطناعي الخاصة بك." }] }),
  component: Keys,
});

function Keys() {
  const qc = useQueryClient();
  const keys = useQuery({
    queryKey: ["keys"],
    queryFn: async () => (await supabase.from("provider_keys").select("id,label,kind,base_url").order("created_at")).data ?? [],
  });
  const [label, setLabel] = useState("Kimi");
  const [kind, setKind] = useState("openai_compatible");
  const [baseUrl, setBaseUrl] = useState(KEY_PRESETS["Kimi"]!.base_url);
  const [apiKey, setApiKey] = useState("");

  async function save() {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("provider_keys").insert({ label, kind, base_url: baseUrl, api_key: apiKey, user_id: u.user!.id });
    if (error) return toast.error(error.message);
    setApiKey("");
    toast.success("تم حفظ المفتاح");
    qc.invalidateQueries({ queryKey: ["keys"] });
  }
  async function del(id: string) {
    await supabase.from("provider_keys").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["keys"] });
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <h1 className="font-display text-3xl">مفاتيحي الخاصة</h1>
        <p className="mt-2 text-sm text-muted-foreground">Claude وChatGPT وGemini تعمل بدون مفتاح. أضف مفتاحاً لاستخدام Kimi أو DeepSeek أو غيرها. المفتاح لا يُعرض مرة أخرى بعد حفظه.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.keys(KEY_PRESETS).map((n) => (
            <Button key={n} size="sm" variant="outline" onClick={() => { setLabel(n); setKind("openai_compatible"); setBaseUrl(KEY_PRESETS[n]!.base_url); }}>{n}</Button>
          ))}
        </div>
        <div className="mt-4 space-y-3 rounded-xl border bg-card p-5">
          <div className="space-y-1"><Label>الاسم</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="space-y-1"><Label>النوع</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KEY_KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {kind === "openai_compatible" && <div className="space-y-1"><Label>عنوان الخدمة</Label><Input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>}
          <div className="space-y-1"><Label>المفتاح</Label><Input dir="ltr" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>
          <Button disabled={!apiKey || !label} onClick={save}>حفظ</Button>
        </div>
      </div>
      <div>
        <h2 className="font-semibold">المفاتيح المحفوظة</h2>
        <div className="mt-4 space-y-2">
          {keys.data?.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div><div className="font-medium">{k.label}</div><div className="text-xs text-muted-foreground" dir="ltr">{k.base_url || k.kind}</div></div>
              <Button size="sm" variant="ghost" onClick={() => del(k.id)}>حذف</Button>
            </div>
          ))}
          {keys.data?.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مفاتيح.</p>}
        </div>
      </div>
    </div>
  );
}

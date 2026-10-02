import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/use-session";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "الدخول — مجلس الوكلاء" },
      { name: "description", content: "سجّل دخولك أو أنشئ حساباً في مجلس الوكلاء." },
      { property: "og:title", content: "الدخول — مجلس الوكلاء" },
      { property: "og:description", content: "سجّل دخولك لإدارة وكلائك ومشاريعك." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const { session } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav({ to: "/dashboard" });
  }, [session, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/dashboard" } });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (mode === "up") toast.success("تم إنشاء الحساب. تحقق من بريدك لتأكيده.");
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("تعذر الدخول بحساب Google");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8">
        <h1 className="font-display text-3xl text-primary">{mode === "in" ? "تسجيل الدخول" : "حساب جديد"}</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور</Label>
            <Input type="password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button className="w-full" disabled={busy}>{mode === "in" ? "دخول" : "إنشاء الحساب"}</Button>
        </form>
        <Button variant="outline" className="mt-3 w-full" onClick={google}>المتابعة بحساب Google</Button>
        <button className="mt-4 w-full text-sm text-muted-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "ليس لديك حساب؟ أنشئ واحداً" : "لديك حساب؟ سجّل الدخول"}
        </button>
      </div>
    </main>
  );
}

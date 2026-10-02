import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/use-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

function Layout() {
  const { session, ready } = useSession();
  const nav = useNavigate();
  useEffect(() => {
    if (ready && !session) nav({ to: "/auth" });
  }, [ready, session, nav]);
  if (!session) return <div className="p-10 text-center text-muted-foreground">جارٍ التحميل...</div>;
  const link = "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground";
  const active = { className: "bg-secondary text-foreground" };
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <Link to="/" className="font-display text-xl text-primary ml-4">مجلس الوكلاء</Link>
          <Link to="/dashboard" className={link} activeProps={active}>المشاريع</Link>
          <Link to="/agents" className={link} activeProps={active}>الوكلاء</Link>
          <Link to="/keys" className={link} activeProps={active}>المفاتيح</Link>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => supabase.auth.signOut()}>خروج</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

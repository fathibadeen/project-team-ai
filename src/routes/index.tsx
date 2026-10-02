import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/use-session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "مجلس الوكلاء — فريق ذكاء اصطناعي يناقش مشروعك" },
      { name: "description", content: "أضف وكلاء من Claude وChatGPT وKimi، سمّهم وأعطهم أدوارهم، ودعهم يتناقشون في مشروعك وينفذون بعد موافقتك." },
      { property: "og:title", content: "مجلس الوكلاء" },
      { property: "og:description", content: "فريق وكلاء ذكاء اصطناعي يتناقش وينفذ بعد موافقتك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const STEPS = [
  ["كوّن مجلسك", "أضف وكلاء من Claude أو ChatGPT أو Kimi، وسمّ كل واحد وحدد دوره: مدير جودة، مهندس، محلل..."],
  ["ارفع مشروعك", "ملفات نصية، PDF، Word أو مجلد كود مضغوط. يقرأه كل الوكلاء."],
  ["دعهم يتناقشون", "كل وكيل يعطي رأيه من زاويته، ثم يقترح القائد مهاماً محددة."],
  ["وافق ثم نفّذ", "لا شيء يُنفّذ بدون موافقتك. المخرجات تقارير ومستندات وكود قابل للتنزيل."],
];

function Home() {
  const { session } = useSession();
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-2xl text-primary">مجلس الوكلاء</span>
        <Button asChild variant="outline">
          <Link to={session ? "/dashboard" : "/auth"}>{session ? "لوحتي" : "دخول"}</Link>
        </Button>
      </header>
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <h1 className="font-display text-5xl leading-tight md:text-7xl">
          فريق من الوكلاء
          <br />
          <span className="text-primary">يتناقش في مشروعك</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          اجمع أفضل نماذج الذكاء الاصطناعي في غرفة واحدة. كل وكيل بدوره وتعليماته، والقائد يوزع العمل — بعد موافقتك فقط.
        </p>
        <Button asChild size="lg" className="mt-10">
          <Link to={session ? "/dashboard" : "/auth"}>ابدأ الآن</Link>
        </Button>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-4">
        {STEPS.map(([t, d], i) => (
          <div key={t} className="rounded-xl border bg-card p-6">
            <div className="font-display text-3xl text-primary">{i + 1}</div>
            <h3 className="mt-3 font-semibold">{t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { streamAgent } from "@/lib/ai.server";
import { authFromRequest, loadKey, projectContext, agentSystem, historyToMessages, type Agent } from "@/lib/council.server";

const Body = z.object({ taskId: z.string().uuid() });

const FORMAT: Record<string, string> = {
  report: "اكتب تقريراً منظماً بصيغة Markdown بعناوين واضحة.",
  document: "اكتب مستنداً كاملاً احترافياً بصيغة Markdown.",
  code: "أنتج الكود المطلوب. ضع كل ملف في كتلة كود مسبوقة بسطر: ### FILE: path/to/file.ext",
};

export const Route = createFileRoute("/api/execute-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authFromRequest(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });
        const { supabase, userId } = auth;

        const { data: task } = await supabase.from("tasks").select("*").eq("id", parsed.data.taskId).maybeSingle();
        if (!task || !task.agent_id) return new Response("Not found", { status: 404 });
        if (task.status !== "approved") return new Response("Task not approved", { status: 409 });
        const [{ data: project }, { data: agent }, { data: files }, { data: history }] = await Promise.all([
          supabase.from("projects").select("*").eq("id", task.project_id).single(),
          supabase.from("agents").select("*").eq("id", task.agent_id).single(),
          supabase.from("project_files").select("name, content").eq("project_id", task.project_id),
          supabase.from("messages").select("agent_name, content").eq("project_id", task.project_id).order("created_at").limit(40),
        ]);
        if (!project || !agent) return new Response("Not found", { status: 404 });
        const { data: team } = await supabase.from("agents").select("*").in("id", project.agent_ids);
        await supabase.from("tasks").update({ status: "running" }).eq("id", task.id);

        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let text = "";
            try {
              const key = await loadKey(userId, agent.provider_key_id);
              const messages = historyToMessages(history ?? [], agent.name);
              messages.push({
                role: "user",
                content: `[القائد - مهمة معتمدة من المستخدم]: ${task.title}\n\n${task.details}\n\n${FORMAT[task.output_type] ?? FORMAT.report}`,
              });
              // merge if needed
              const fixed = messages.reduce<typeof messages>((acc, m) => {
                const l = acc[acc.length - 1];
                if (l && l.role === m.role) l.content += "\n\n" + m.content;
                else acc.push({ ...m });
                return acc;
              }, []);
              for await (const t of streamAgent({
                provider: agent.provider,
                model: agent.model,
                system: agentSystem(agent as Agent, (team ?? []) as Agent[], projectContext(project, files ?? [])),
                messages: fixed,
                key,
                signal: request.signal,
              })) {
                text += t;
                controller.enqueue(enc.encode(t));
              }
              await supabase.from("artifacts").insert({
                project_id: task.project_id,
                task_id: task.id,
                agent_name: agent.name,
                title: task.title,
                filename: `${task.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "output"}.md`,
                content: text,
              });
              await supabase.from("tasks").update({ status: "done" }).eq("id", task.id);
            } catch (e) {
              await supabase.from("tasks").update({ status: "approved" }).eq("id", task.id);
              controller.enqueue(enc.encode(`\n\n⚠️ ${e instanceof Error ? e.message : "خطأ"}`));
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
        });
      },
    },
  },
});

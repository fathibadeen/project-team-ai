// Server-only: unified streaming across built-in models and user-supplied providers.
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type ProviderKey = { kind: string; base_url: string; api_key: string } | null;

export const BUILTIN_PROVIDERS = ["openai", "anthropic", "google"] as const;

async function* sseEvents(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* partial / non-json */
      }
    }
  }
}

async function ensureOk(res: Response, label: string) {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  console.error(`[ai] ${label} ${res.status}: ${text.slice(0, 500)}`);
  if (res.status === 402) throw new Error("نفد رصيد الذكاء الاصطناعي في مساحة العمل.");
  if (res.status === 429) throw new Error("تم تجاوز حد الطلبات، حاول بعد قليل.");
  if (res.status === 401) throw new Error(`مفتاح ${label} غير صالح.`);
  throw new Error(`فشل الاتصال بـ ${label} (${res.status}).`);
}

export async function* streamAgent(opts: {
  provider: string;
  model: string;
  system: string;
  messages: ChatMsg[];
  key: ProviderKey;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const { provider, model, system, messages, key, signal } = opts;
  const lovableKey = process.env["LOVABLE_API_KEY"];

  if (provider === "openai") {
    const res = await fetch(`${GATEWAY}/responses`, {
      method: "POST",
      signal: signal ?? null,
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model,
        instructions: system,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        store: false,
        reasoning: { effort: "low" },
      }),
    });
    await ensureOk(res, "ChatGPT");
    for await (const ev of sseEvents(res)) {
      if (ev.type === "response.output_text.delta" && ev.delta) yield ev.delta;
      if (ev.type === "response.failed" || ev.type === "error") throw new Error("فشل توليد الرد.");
    }
    return;
  }

  if (provider === "anthropic" || key?.kind === "anthropic") {
    const own = key?.kind === "anthropic";
    const res = await fetch(own ? "https://api.anthropic.com/v1/messages" : `${GATEWAY}/messages`, {
      method: "POST",
      signal: signal ?? null,
      headers: own
        ? {
            "x-api-key": key!.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          }
        : {
            Authorization: `Bearer ${lovableKey}`,
            "Content-Type": "application/json",
            "X-Lovable-AIG-SDK": "fetch",
          },
      body: JSON.stringify({ model, max_tokens: 8000, system, messages, stream: true }),
    });
    await ensureOk(res, "Claude");
    for await (const ev of sseEvents(res)) {
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") yield ev.delta.text;
      if (ev.type === "message_delta" && ev.delta?.stop_reason === "refusal") {
        yield "\n\n(رفض النموذج الإجابة على هذا الطلب)";
      }
      if (ev.type === "error") throw new Error("فشل توليد الرد من Claude.");
    }
    return;
  }

  // Chat Completions: built-in Gemini or any OpenAI-compatible custom provider.
  const custom = provider === "custom" && key;
  const url = custom ? `${key!.base_url.replace(/\/+$/, "")}/chat/completions` : `${GATEWAY}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      Authorization: `Bearer ${custom ? key!.api_key : lovableKey}`,
      "Content-Type": "application/json",
      ...(custom ? {} : { "X-Lovable-AIG-SDK": "fetch" }),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      stream: true,
    }),
  });
  await ensureOk(res, custom ? "المزوّد المخصص" : "Gemini");
  for await (const ev of sseEvents(res)) {
    const t = ev.choices?.[0]?.delta?.content;
    if (t) yield t;
  }
}

export async function collect(gen: AsyncGenerator<string>) {
  let out = "";
  for await (const t of gen) out += t;
  return out;
}

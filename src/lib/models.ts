export const PROVIDERS = [
  {
    id: "anthropic",
    label: "Claude (مدمج)",
    models: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "anthropic/claude-haiku-4-5"],
  },
  {
    id: "openai",
    label: "ChatGPT (مدمج)",
    models: ["openai/gpt-6-astra", "openai/gpt-6-sol", "openai/gpt-6-luna"],
  },
  {
    id: "google",
    label: "Gemini (مدمج)",
    models: ["google/gemini-3.8-flash", "google/gemini-3.1-pro-preview"],
  },
  { id: "custom", label: "مزوّد بمفتاحي الخاص (Kimi، DeepSeek...)", models: [] as string[] },
] as const;

export const KEY_KINDS = [
  { id: "openai_compatible", label: "متوافق مع OpenAI (Kimi، DeepSeek، Groq، OpenAI...)" },
  { id: "anthropic", label: "Anthropic (مفتاح Claude الخاص)" },
];

export const KEY_PRESETS: Record<string, { base_url: string; model: string }> = {
  Kimi: { base_url: "https://api.moonshot.ai/v1", model: "kimi-k2-0905-preview" },
  DeepSeek: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  OpenAI: { base_url: "https://api.openai.com/v1", model: "gpt-4o" },
  Groq: { base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
};

export const AGENT_COLORS = ["#d4a24c", "#4ca3d4", "#5cc48a", "#d46a6a", "#a07ad4", "#d4884c", "#4cc4bd", "#c4c44c"];

export const OUTPUT_LABEL: Record<string, string> = { report: "تقرير", document: "مستند", code: "كود" };
export const STATUS_LABEL: Record<string, string> = {
  proposed: "بانتظار موافقتك",
  approved: "معتمدة",
  running: "قيد التنفيذ",
  done: "منفّذة",
  rejected: "مرفوضة",
};

import { DANI_FREE_CLIENT_INSTANCE_ID, DANI_FREE_INSTANCE_ID } from "../../shared/dani-free.ts";

/** The server's default instances by id, with their driver kinds, plus `gemini`, which an enterprise licence restores. */
export const BUILT_IN_INSTANCE_DRIVERS: Readonly<Record<string, string>> = {
  [DANI_FREE_INSTANCE_ID]: "daniFree",
  [DANI_FREE_CLIENT_INSTANCE_ID]: "opencodeGo",
  grok: "grokAgent", kimi: "kimiAgent", droid: "droidAgent", cursor: "cursorAgent", githubCopilot: "copilotAgent", claude: "claudeAgent", codex: "codex",
  chatgpt: "codex", antigravity: "antigravityAgent", opencodeGo: "opencodeGo", openaiCompat: "openai-compat",
  mistral: "mistral", cerebras: "cerebras", groq: "groq", greenference: "greenference", meta: "meta", museCode: "museCode", deepseek: "deepseekAgent", openai: "openai-compat",
  claudeApi: "claudeAgent", xaiApi: "grok", openrouter: "openai-compat", qwen: "qwenAgent", hermes: "hermesAgent",
  cline: "clineAgent", pi: "piAgent", gemini: "geminiAgent",
};

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { DATA_DIR } from "../../config.ts";

/** Only model-provider secrets, never control-plane, browser, connector or workspace helper credentials. */
export const HERMES_NATIVE_CREDENTIAL_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
  "XAI_API_KEY", "OPENCODE_ZEN_API_KEY", "OPENCODE_GO_API_KEY", "OPENCODE_API_KEY", "KILOCODE_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY", "GROQ_API_KEY", "GREENFERENCE_API_KEY",
  "META_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY", "MINIMAX_API_KEY", "GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY",
] as const;

/** Canonical ownership, not merely an exported HERMES_HOME. Symlinks outside these app roots fail closed. */
export function hermesManagedProfile(env: Record<string, string | undefined>): boolean {
  if (!env.HERMES_HOME || !isAbsolute(env.HERMES_HOME)) return false;
  try {
    const profile = realpathSync(env.HERMES_HOME);
    const config = join(profile, "config.yaml");
    if (existsSync(config) && (!lstatSync(config).isFile() || realpathSync(config) !== config)) return false;
    const user = realpathSync(env.HOME || env.USERPROFILE || homedir());
    if (profile === join(user, ".hermes", "profiles", "dani-local")) return true;
    const appRoot = join(realpathSync(DATA_DIR), "providers", "hermes", "profiles");
    const suffix = relative(appRoot, profile);
    return suffix !== "" && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
  } catch {
    return false;
  }
}

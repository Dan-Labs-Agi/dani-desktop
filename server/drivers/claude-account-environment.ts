import { claudeApiErrorMessage } from "./claude-limits.ts";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

/** Parent-session credentials/routing a named account must not inherit. */
export const CLAUDE_ACCOUNT_ENV_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

export function resolveClaudeConfigDir(configDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configured = configDir?.trim() || env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const expanded = configured === "~" ? home : configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
  if (!isAbsolute(expanded) || /[\p{Cc}\p{Cf}]/u.test(expanded)) {
    throw new Error("claude: configDir must be an absolute path or start with ~/");
  }
  return normalize(expanded);
}


/** What an error `result` says failed: its `errors` (2.1.295: "No conversation found with session ID: …"), else its
 * text in plain words, else its kind; never its synthetic message's "stop_sequence", nor the subtype "success". */
export function claudeResultError(frame: { errors?: unknown; result?: unknown; subtype?: unknown; terminal_reason?: unknown; api_error_status?: unknown }): string {
  const errors = Array.isArray(frame.errors) ? frame.errors.filter((error): error is string => typeof error === "string" && error.trim() !== "") : [];
  if (errors.length) return errors.join("; ");
  if (typeof frame.result === "string" && frame.result.trim()) return claudeApiErrorMessage(frame, frame.result);
  return `Claude ended the turn with an error (${String((frame.subtype !== "success" && frame.subtype) || frame.terminal_reason || "unknown")}).`;
}


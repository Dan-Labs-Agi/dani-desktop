// cua-driver 0.28.2 answers an action with structuredContent.effect, but its own word covers only the input it sent:
// a foreground click whose after-check failed reads "unverifiable" (unconfirmed-click.ts), and a click that reaches the
// window but lands on nothing reads exactly like one that worked. Only reading the window back shows whether it moved.
import { createHash } from "node:crypto";
import type { ChildCalls, ToolCall } from "../server/mcp-bridge.ts";
import { slimResponse, type SlimStructured } from "../server/saved-steps/driver-wire.ts";

type JsonObject = Record<string, unknown>;

const OBSERVE_TIMEOUT_MS = 4_000;

/** The actions that change a window, so an answer about them is worth no more than a read-back of what they changed. */
export const VERIFIED_ACTIONS: ReadonlySet<string> = new Set([
  "click", "double_click", "right_click", "type_text", "set_value", "press_key", "hotkey",
]);

export type EffectVerdict = "changed" | "unchanged" | "unobserved";

export interface Observation {
  app?: string;
  window?: string;
  elements: number;
  /** Over roles, labels and shape only: what a field holds never leaves the bridge. */
  fingerprint: string;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fingerprint(structured: SlimStructured): string {
  const shape = (structured.elements ?? []).map((element) =>
    `${element.element_index}\u0000${element.depth}\u0000${element.role}\u0000${element.label ?? ""}`);
  const digest = createHash("sha256");
  digest.update([structured.app_name ?? "", structured.window_title ?? "", ...shape].join("\u0001"));
  return digest.digest("hex").slice(0, 16);
}

/** What one read-back of a window says about it, or nothing at all when the driver refused or read nothing. */
export function observationOf(result: unknown): Observation | null {
  const slim = slimResponse({ result });
  if (slim.isError || !slim.structured) return null;
  const { app_name: app, window_title: window, elements } = slim.structured;
  return {
    ...(app === undefined ? {} : { app }),
    ...(window === undefined ? {} : { window }),
    elements: elements?.length ?? 0,
    fingerprint: fingerprint(slim.structured),
  };
}

/** Whether the action moved the window. A read-back that is missing at either end is never read as "nothing happened". */
export function effectVerdict(before: Observation | null, after: Observation | null): EffectVerdict {
  if (!before || !after) return "unobserved";
  return before.fingerprint === after.fingerprint ? "unchanged" : "changed";
}

/** What the bot is told beside the driver's own answer, in plain words; nothing when the window moved.
 * It never says to send the action again: a second click pays twice, and whether the first one acted is the open question. */
export function effectNote(verdict: EffectVerdict, tool: string): string | null {
  if (verdict === "changed") return null;
  const opening = verdict === "unchanged"
    ? `The ${tool} was sent and the window did not change afterwards, so it may have landed on nothing.`
    : `The ${tool} was sent, but the window could not be read back afterwards, so whether it landed is unknown.`;
  return `${opening} Read the window with get_window_state and decide from what it shows now: act on what is there, ` +
    `and only do this again if the window shows the work still has to be done.`;
}

function readBackTarget(args: JsonObject): JsonObject | null {
  const { pid, window_id } = args;
  if (typeof pid !== "number" || typeof window_id !== "number") return null;
  return { pid, window_id };
}

/** Whether this call is one whose effect can be read back at all. The relay has to know before it answers, because a
 * call it cannot verify belongs to the driver untouched. */
export function canVerifyEffect(call: ToolCall): boolean {
  return VERIFIED_ACTIONS.has(call.name) && readBackTarget(call.arguments) !== null;
}

function observe(child: ChildCalls, target: JsonObject, timeoutMs: number): Promise<Observation | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A driver that never answers the read-back must not hold the turn open: the action has already gone out.
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([child.call("get_window_state", { ...target, include_screenshot: false }), expired])
    .then((result) => (result ? observationOf(result) : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

function withNote(result: JsonObject, note: string): JsonObject {
  const content = Array.isArray(result.content) ? result.content : [];
  const structured = isObject(result.structuredContent) ? result.structuredContent : undefined;
  return {
    ...result,
    content: [...content, { type: "text", text: note }],
    ...(structured ? { structuredContent: { ...structured, ...(structured.effect === undefined ? {} : { effect: "unverified" }) } } : {}),
  };
}

/** The action, with the window read back on both sides of it, answered as what it is known to have done. Null when
 * there is no window to read back, which leaves the call to the driver as it came. */
export async function withVerifiedEffect(
  call: ToolCall,
  child: ChildCalls,
  { timeoutMs = OBSERVE_TIMEOUT_MS, act }: { timeoutMs?: number; act?: () => Promise<JsonObject> } = {},
): Promise<unknown> {
  const target = readBackTarget(call.arguments);
  if (!target) return null;
  const before = await observe(child, target, timeoutMs);
  const result = await (act ? act() : child.call(call.name, call.arguments));
  // The driver refused or failed: it sent nothing, and its own words are the whole answer.
  if (result.isError === true) return result;
  const note = effectNote(effectVerdict(before, await observe(child, target, timeoutMs)), call.name);
  return note ? withNote(result, note) : result;
}

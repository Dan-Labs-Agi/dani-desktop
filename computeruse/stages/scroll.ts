import type { ChildCalls, ToolCall } from "../../server/mcp-bridge.ts";
import { observationOf, type Observation } from "../effect.ts";
import { readWindow } from "../read.ts";

type Result = Record<string, unknown>;

function note(result: Result, message: string): Result {
  const content = Array.isArray(result.content) ? result.content : [];
  return { ...result, content: [...content, { type: "text", text: message }] };
}

function focusedScrollArea(read: Result | null): Record<string, unknown> | null {
  const structured = read?.structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const elements = (structured as Result).elements;
  if (!Array.isArray(elements)) return null;
  const focused = elements.filter((element) => element && typeof element === "object" &&
    /scrollarea/iu.test(String((element as Result).role ?? "")) && (element as Result).focused === true);
  return focused.length === 1 ? focused[0] as Result : null;
}

export async function verifiedScroll(
  call: ToolCall, child: ChildCalls, act: () => Promise<Result>, cachedBefore?: Observation,
  onObserved?: (after: Observation | null, changed: boolean) => void,
): Promise<Result> {
  if (call.name !== "scroll") return act();
  if (typeof call.arguments.pid !== "number" || typeof call.arguments.window_id !== "number") return act();
  const before = cachedBefore ?? observationOf(await readWindow(child, call.arguments));
  const original = await act();
  if (original.isError === true) return original;
  const firstRead = await readWindow(child, call.arguments);
  const first = observationOf(firstRead);
  if (!before || !first) {
    onObserved?.(first, false);
    return note(original, "The scroll was sent, but the window could not be checked afterwards.");
  }
  if (before.fingerprint !== first.fingerprint) {
    onObserved?.(first, true);
    return note(original, "The window changed after scrolling.");
  }

  const area = focusedScrollArea(firstRead);
  if (area && typeof area.element_token === "string") {
    const areaResult = await child.call("scroll", { ...call.arguments, element_token: area.element_token, element_index: undefined });
    if (areaResult.isError !== true) {
      const afterArea = observationOf(await readWindow(child, call.arguments));
      if (afterArea?.fingerprint !== undefined && afterArea.fingerprint !== first.fingerprint) {
        onObserved?.(afterArea, true);
        return note(areaResult, "The focused scroll area moved.");
      }
    }
  }

  const direction = call.arguments.direction;
  if (direction !== "down" && direction !== "up") {
    onObserved?.(first, false);
    return note(original, "The view did not change after scrolling.");
  }
  const key = direction === "down" ? "PageDown" : "PageUp";
  const keyResult = await child.call("press_key", { pid: call.arguments.pid, window_id: call.arguments.window_id, key });
  if (keyResult.isError === true) {
    onObserved?.(first, false);
    return note(original, "The view did not move, and the page key was refused. Read the window before trying another action.");
  }
  const afterKey = observationOf(await readWindow(child, call.arguments));
  onObserved?.(afterKey, Boolean(afterKey && afterKey.fingerprint !== first.fingerprint));
  return afterKey && afterKey.fingerprint !== first.fingerprint
    ? note(keyResult, `The view moved with ${key}.`)
    : note(original, "The view appears to be at its end. Read the window before trying another action.");
}

import type { ChildCalls, ToolCall } from "../../server/mcp-bridge.ts";
import { namesSecret } from "../../server/saved-steps/screen-words.ts";
import type { SlimStructured } from "../../server/saved-steps/driver-wire.ts";

type Result = Record<string, unknown>;
type Element = Record<string, unknown>;
export type TypingVerdict = "matched" | "differs" | "unreadable" | "not_checked";

function targetElement(result: Result | null, args: Record<string, unknown>): Element | null {
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const elements = (structured as Result).elements;
  if (!Array.isArray(elements)) return null;
  const index = args.element_index;
  const token = args.element_token;
  const found = elements.find((entry) => entry && typeof entry === "object" &&
    (typeof token === "string" ? (entry as Element).element_token === token : (entry as Element).element_index === index));
  return found && typeof found === "object" ? found as Element : null;
}

function secure(element: Element): boolean {
  const role = typeof element.role === "string" ? element.role.toLowerCase() : "";
  const label = typeof element.label === "string" ? element.label : "";
  return role.includes("secure") || role.includes("password") || namesSecret(label);
}

async function readWindow(child: ChildCalls, args: Record<string, unknown>): Promise<Result | null> {
  if (typeof args.pid !== "number" || typeof args.window_id !== "number") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), 4_000);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      child.call("get_window_state", { pid: args.pid, window_id: args.window_id, include_screenshot: false }),
      timeout,
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resultOf(verdict: TypingVerdict, failed: boolean): Result {
  const message = failed ? "The text was not entered."
    : verdict === "matched" ? "Text entered; the field read-back matched."
    : verdict === "differs" ? "Text entered, but the field read-back differed. Read the field before deciding what to do next."
    : verdict === "not_checked" ? "Text entered in a sensitive field; its value was not checked."
    : "Text entered, but this field could not be read back.";
  return { ...(failed ? { isError: true } : {}), content: [{ type: "text", text: message }], structuredContent: { typing_verification: verdict } };
}

export async function verifiedTyping(call: ToolCall, child: ChildCalls, act: () => Promise<Result>, snapshot?: SlimStructured): Promise<Result> {
  if (call.name !== "type_text" && call.name !== "set_value") return act();
  const expected = call.name === "set_value" ? call.arguments.value : call.arguments.text;
  const targeted = typeof call.arguments.element_token === "string" || typeof call.arguments.element_index === "number";
  const oldElement = targeted ? targetElement({ structuredContent: snapshot }, call.arguments) : null;
  const original = await act();
  if (original.isError === true) return resultOf("unreadable", true);
  if (!targeted || !oldElement) return resultOf("unreadable", false);
  if (secure(oldElement)) return resultOf("not_checked", false);
  const after = await readWindow(child, call.arguments);
  const newElement = targetElement(after, call.arguments);
  const verdict: TypingVerdict = typeof expected === "string" && typeof newElement?.value === "string"
    ? newElement.value === expected ? "matched" : "differs"
    : "unreadable";
  return resultOf(verdict, false);
}

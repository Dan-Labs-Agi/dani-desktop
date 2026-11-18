import type { ChildCalls, ToolCall } from "../../server/mcp-bridge.ts";
import { namesSecret } from "../../server/saved-steps/screen-words.ts";
import type { SlimStructured } from "../../server/saved-steps/driver-wire.ts";
import { readWindow } from "../read.ts";

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

/** The same field in a later read. Element tokens belong to one read (cua-driver 0.28.2 on Windows mints new ones every time),
 * so the field is found by what it is: its index when the role and label still agree, else the only one that looks like it. */
function sameField(old: Element, read: Result | null): Element | null {
  const elements = (read?.structuredContent as Result | undefined)?.elements;
  if (!Array.isArray(elements)) return null;
  const alike = elements.filter((entry): entry is Element => Boolean(entry) && typeof entry === "object" && (entry as Element).role === old.role && (entry as Element).label === old.label);
  return alike.find((entry) => entry.element_index === old.element_index) ?? (alike.length === 1 ? alike[0]! : null);
}

function secure(element: Element): boolean {
  const role = typeof element.role === "string" ? element.role.toLowerCase() : "";
  const label = typeof element.label === "string" ? element.label : "";
  return role.includes("secure") || role.includes("password") || namesSecret(label);
}

function resultOf(verdict: TypingVerdict): Result {
  const message = verdict === "matched" ? "Text entered; the field read-back matched."
    : verdict === "differs" ? "Text entered, but the field read-back differed. Read the field before deciding what to do next."
    : verdict === "not_checked" ? "Text entered in a sensitive field; its value was not checked."
    : "Text entered, but this field could not be read back.";
  return { content: [{ type: "text", text: message }], structuredContent: { typing_verification: verdict } };
}

export async function verifiedTyping(call: ToolCall, child: ChildCalls, act: () => Promise<Result>, snapshot?: SlimStructured): Promise<Result> {
  if (call.name !== "type_text" && call.name !== "set_value") return act();
  const expected = call.name === "set_value" ? call.arguments.value : call.arguments.text;
  const targeted = typeof call.arguments.element_token === "string" || typeof call.arguments.element_index === "number";
  const oldElement = targeted ? targetElement({ structuredContent: snapshot }, call.arguments) : null;
  const original = await act();
  // The driver refused: its own words say why, and are the whole answer.
  if (original.isError === true) return original;
  if (!targeted || !oldElement) return resultOf("unreadable");
  if (secure(oldElement)) return resultOf("not_checked");
  const after = await readWindow(child, call.arguments);
  const newElement = sameField(oldElement, after);
  const verdict: TypingVerdict = typeof expected === "string" && typeof newElement?.value === "string"
    ? newElement.value === expected ? "matched" : "differs"
    : "unreadable";
  return resultOf(verdict);
}

// A bot on the person's own computer that is about to press something that cannot be undone (send, pay, delete, post)
// asks the person first, once, at every approval level. The label comes from a page and is never trusted as words: it is
// shown only when it is a short plain phrase, always inside quotation marks.

/** The card's tool name: no engine has a tool by this name, and "Always allow" is never offered for it. */
export const FINAL_ACTION_TOOL = "confirm_final_action";

/** The calls a bridge may ask about. The words for each are the server's language lines, `server.finalAction.verb.<tool>.*`. */
export const FINAL_ACTION_TOOLS = ["click", "double_click", "right_click", "press_key", "hotkey", "set_value", "launch_app"] as const;
export type FinalActionTool = (typeof FINAL_ACTION_TOOLS)[number];
export const isFinalActionTool = (tool: string): tool is FinalActionTool => (FINAL_ACTION_TOOLS as readonly string[]).includes(tool);

/** What a bridge says about a call in the check it makes before it: the tool, a fingerprint of the exact call, and the
 * target's label when there is one fit to show. */
export interface FinalActionCall {
  tool: string;
  hash: string;
  label?: string;
}

const MAX_LABEL_LENGTH = 40;
const MAX_LABEL_WORDS = 6;
const LABEL_CHARACTERS = /^[\p{L}\p{N} .,'’!?&+\-…$€£¥%()]+$/u;
const HASH = /^[a-f0-9]{32}$/;

/** A button label fit for a sentence the person reads, or nothing: a short plain phrase, with no quotation marks, markup,
 * links or line breaks, so a page cannot write a sentence of its own into the question. */
export function cleanTargetLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim().replace(/ {2,}/g, " ");
  if (!label || label.length > MAX_LABEL_LENGTH || label.split(" ").length > MAX_LABEL_WORDS) return undefined;
  return LABEL_CHARACTERS.test(label) ? label : undefined;
}

/** The fields a bridge adds to its check for a call that would be final. */
export function finalActionQuery(call: FinalActionCall): Record<string, string> {
  const label = cleanTargetLabel(call.label);
  return { risk: "final", rtool: call.tool, rhash: call.hash, ...(label ? { rlabel: label } : {}) };
}

/** The cleaned call a computer-control request carries in its query, or nothing. */
export function finalActionFrom(query: URLSearchParams): FinalActionCall | undefined {
  const tool = query.get("rtool") ?? "";
  const hash = query.get("rhash") ?? "";
  if (query.get("risk") !== "final" || !isFinalActionTool(tool) || !HASH.test(hash)) return undefined;
  const label = cleanTargetLabel(query.get("rlabel"));
  return { tool, hash, ...(label ? { label } : {}) };
}

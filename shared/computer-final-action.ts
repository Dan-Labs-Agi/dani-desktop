// A bot on the person's own computer that is about to press something that cannot be undone (send, pay, delete, post)
// asks the person first, once, in these words, at every approval level. The label comes from a page and is never
// trusted as words: it is shown only when it is a short plain phrase, always inside quotation marks.

/** The card's tool name: no engine has a tool by this name, and "Always allow" is never offered for it. */
export const FINAL_ACTION_TOOL = "confirm_final_action";

/** The calls a bridge may ask about, and how each reads in the question. */
export const FINAL_ACTION_VERBS: Readonly<Record<string, { labelled: string; plain: string }>> = {
  click: { labelled: "click", plain: "click" },
  double_click: { labelled: "double-click", plain: "double-click" },
  right_click: { labelled: "right-click", plain: "right-click" },
  press_key: { labelled: "press", plain: "press a key" },
  hotkey: { labelled: "press", plain: "press keys" },
  set_value: { labelled: "choose", plain: "choose an option" },
  launch_app: { labelled: "open", plain: "open something" },
};

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

export function finalActionQuestion(call: FinalActionCall): { title: string; detail: (name: string) => string } {
  const verb = FINAL_ACTION_VERBS[call.tool] ?? FINAL_ACTION_VERBS.click!;
  const label = cleanTargetLabel(call.label);
  return {
    title: label
      ? `I'm about to ${verb.labelled} “${label}”, which can't be undone. Allow once?`
      : `I'm about to ${verb.plain} where something can't be undone. Allow once?`,
    detail: (name) => `${name} will do this once on your computer, and nothing else. If you say no, it will not try again this turn.`,
  };
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
  if (query.get("risk") !== "final" || !Object.hasOwn(FINAL_ACTION_VERBS, tool) || !HASH.test(hash)) return undefined;
  const label = cleanTargetLabel(query.get("rlabel"));
  return { tool, hash, ...(label ? { label } : {}) };
}

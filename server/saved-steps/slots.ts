// No recipe is ever saved holding typed words that are not a span of the request it was learned from, so every recipe
// is already a shape with holes in it: "file my august expense report" is "file my … expense report". A new request
// that fits the shape fills the holes with its own words, and the recipe repeats for a month it never saw.
import { exactRequest, hasMomentWords, requestKey } from "./key.ts";
import { namesFinalAction, namesSecret } from "./screen-words.ts";
import { recipeFitsRequest, unsafeStep, type Recipe, type RecipeStep } from "./rules.ts";

export const MAX_SLOTS = 4;
const MIN_SLOT_LENGTH = 2;
/** Enough of the request has to be the recipe's own words, or the shape answers requests that have nothing to do with it. */
const MIN_LITERAL_LENGTH = 4;

const CONTROL_CHARACTERS = /\p{Cc}/u;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only text a step types. A link is never refilled: another host is a different place, not another value. */
function typedValues(steps: readonly RecipeStep[]): string[] | null {
  const values: string[] = [];
  for (const step of steps) {
    if (step.tool === "launch_app" && step.args.urls !== undefined) return null;
    if (step.tool !== "set_value") continue;
    const { value } = step.args;
    if (typeof value !== "string") return null;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

/** The recipe's request key cut at its typed spans: the words around the holes, in order, with the spans that made
 * them. Null when the spans cannot be told apart or leave too little of the request behind. */
function shape(request: string, values: readonly string[]): { parts: string[]; spans: string[] } | null {
  const key = requestKey(request);
  const spans = values.map(requestKey);
  if (spans.some((span) => span.length < MIN_SLOT_LENGTH)) return null;
  // Two spans that differ only in case or punctuation are one hole in the key, and nothing says which step takes it.
  if (new Set(spans).size !== spans.length) return null;
  if (spans.some((span) => spans.some((other) => other !== span && other.includes(span)))) return null;
  const at = new Map<string, number>();
  for (const span of spans) {
    const first = key.indexOf(span);
    if (first < 0 || first !== key.lastIndexOf(span)) return null;
    at.set(span, first);
  }
  const ordered = spans.slice().sort((a, b) => at.get(a)! - at.get(b)!);
  const parts: string[] = [];
  let cursor = 0;
  for (const span of ordered) {
    parts.push(key.slice(cursor, at.get(span)!));
    cursor = at.get(span)! + span.length;
  }
  parts.push(key.slice(cursor));
  return parts.join("").replace(/\s+/g, "").length < MIN_LITERAL_LENGTH ? null : { parts, spans: ordered };
}

/** The words the person actually wrote for a span the key matched, with their own capitals and punctuation. */
function asWritten(span: string, request: string): string | null {
  const start = request.toLowerCase().indexOf(span.toLowerCase());
  return start < 0 ? null : request.slice(start, start + span.length);
}

function fits(value: string, request: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_SLOT_LENGTH && trimmed === value && !CONTROL_CHARACTERS.test(value)
    && !hasMomentWords(value) && !namesSecret(value) && !namesFinalAction(value)
    && requestKey(request).includes(requestKey(value));
}

/** The recipe with its typed spans refilled from a new request, keeping its id and its steps' targets; null when the
 * request does not fit its shape, or when what it would type is not the person's own plain words. */
export function refillRecipe(recipe: Recipe, request: string): Recipe | null {
  const learned = exactRequest(recipe.request);
  const asked = exactRequest(request);
  if (!learned || !asked) return null;
  // The same key in other words or other case is the exact path's to refuse: a shape only answers a request the person
  // worded differently enough to have a key of its own.
  if (requestKey(asked) === requestKey(learned)) return null;
  const values = typedValues(recipe.steps);
  if (!values?.length || values.length > MAX_SLOTS) return null;
  const cut = shape(learned, values);
  if (!cut) return null;

  const pattern = new RegExp(`^${cut.parts.map(escape).join("(.+?)")}$`, "u");
  const found = pattern.exec(requestKey(asked));
  if (!found || found.length - 1 !== cut.spans.length) return null;
  const written = found.slice(1).map((span) => asWritten(span, asked));
  if (!written.every((value): value is string => value !== null && fits(value, asked))) return null;

  const bySpan = new Map(cut.spans.map((span, index) => [span, written[index]!]));
  const swap = new Map(values.map((value) => [value, bySpan.get(requestKey(value))!]));
  const steps = recipe.steps.map((step) => {
    if (step.tool !== "set_value") return step;
    const value = swap.get(step.args.value as string);
    return value === undefined ? step : { ...step, args: { ...step.args, value } };
  });
  if (steps.some((step) => unsafeStep(step) !== null)) return null;
  const refilled: Recipe = { ...recipe, key: requestKey(asked), request: asked, steps };
  // The same gate a learned recipe passes: every word it types is the person's own, from the request that asked for it.
  return recipeFitsRequest(refilled, asked) ? refilled : null;
}

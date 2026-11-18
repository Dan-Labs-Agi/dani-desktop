import { namesSecret } from "../server/saved-steps/screen-words.ts";

export interface StepRef { label: string; role?: string }

/** What a window shows once a step is done. Every part given has to hold. */
export interface StepExpectation {
  present?: StepRef;
  absent?: StepRef;
  field?: { label: string; equals: string };
  titleIncludes?: string;
}

/** What one read of a window holds, with the values of its fields: the bridge reads them to check a step, and says only whether
 * the check passed. */
export interface WindowReading {
  title?: string;
  complete: boolean;
  elements: ReadonlyArray<{ index: number; token?: string; role: string; label?: string; value?: string; x?: number; y?: number }>;
}

const same = (a: string | undefined, b: string | undefined) => (a ?? "").trim().toLocaleLowerCase() === (b ?? "").trim().toLocaleLowerCase();
const named = (label: string) => JSON.stringify(label.length > 80 ? `${label.slice(0, 80)}…` : label);

export function matching(reading: WindowReading, ref: StepRef) {
  return reading.elements.filter((element) => element.label !== undefined && same(element.label, ref.label) && (!ref.role || same(element.role, ref.role)));
}

/** A field named for a secret is never read to check a step, since a check that fails would say what it held. */
export function expectationProblem(expectation: StepExpectation): string | null {
  if (expectation.field && namesSecret(expectation.field.label)) return "A field named for a secret cannot be used to check a step.";
  if (!expectation.present && !expectation.absent && !expectation.field && !expectation.titleIncludes) return "A check has to name something to look for.";
  return null;
}

export function checkExpectation(expectation: StepExpectation, reading: WindowReading): { ok: boolean; detail: string } {
  const failures: string[] = [];
  const held: string[] = [];
  if (expectation.present) {
    const found = matching(reading, expectation.present).length;
    (found > 0 ? held : failures).push(found > 0 ? `${named(expectation.present.label)} is there` : `${named(expectation.present.label)} is not there`);
  }
  if (expectation.absent) {
    const found = matching(reading, expectation.absent).length;
    if (found > 0) failures.push(`${named(expectation.absent.label)} is still there`);
    else if (!reading.complete) failures.push(`${named(expectation.absent.label)} was not seen, but the window was read in part, so it may be there`);
    else held.push(`${named(expectation.absent.label)} is gone`);
  }
  if (expectation.field) {
    const fields = matching(reading, { label: expectation.field.label });
    if (fields.length !== 1) failures.push(`${fields.length ? "several controls are" : "no control is"} labelled ${named(expectation.field.label)}`);
    else if (fields[0]!.value === expectation.field.equals) held.push(`${named(expectation.field.label)} holds what was asked`);
    else failures.push(`${named(expectation.field.label)} does not hold what was asked`);
  }
  if (expectation.titleIncludes) {
    const ok = (reading.title ?? "").toLocaleLowerCase().includes(expectation.titleIncludes.toLocaleLowerCase());
    (ok ? held : failures).push(ok ? `the window title has ${named(expectation.titleIncludes)}` : `the window title does not have ${named(expectation.titleIncludes)}`);
  }
  return failures.length ? { ok: false, detail: failures.join("; ") } : { ok: true, detail: held.join("; ") };
}

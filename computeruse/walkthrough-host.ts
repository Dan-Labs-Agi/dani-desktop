import { createHash } from "node:crypto";
import type { ChildCalls } from "../server/mcp-bridge.ts";
import { observationOf } from "./effect.ts";
import { readWindow } from "./read.ts";
import type { WalkthroughHost, WalkthroughStep, WalkthroughTarget } from "./walkthrough.ts";
import { checkExpectation, matching, type WindowReading } from "./walkthrough-verify.ts";

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** What a driver answer says about the window, with its fields' values, or null when it read nothing. */
export function readingOf(result: unknown): WindowReading | null {
  if (!isRec(result) || result.isError === true || !isRec(result.structuredContent) || !Array.isArray(result.structuredContent.elements)) return null;
  const structured = result.structuredContent;
  return {
    ...(typeof structured.window_title === "string" ? { title: structured.window_title } : {}),
    complete: structured.elements_complete === true,
    elements: (structured.elements as unknown[]).flatMap((element) => {
      if (!isRec(element) || !finite(element.element_index) || typeof element.role !== "string") return [];
      const frame = isRec(element.frame) ? element.frame : null;
      return [{
        index: element.element_index, role: element.role,
        ...(typeof element.element_token === "string" ? { token: element.element_token } : {}),
        ...(typeof element.label === "string" ? { label: element.label } : {}),
        ...(typeof element.value === "string" ? { value: element.value } : {}),
        ...(frame && finite(frame.x) && finite(frame.y) && finite(frame.w) && finite(frame.h) ? { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 } : {}),
      }];
    }),
  };
}

/** The walkthrough's eyes on one window, through the driver the bridge already holds. What it reads goes no further than the
 * verdicts it returns: a field's value is compared here and never shown. */
export function windowWalkthroughHost(input: { child(): ChildCalls; pid: number; window_id: number }): WalkthroughHost & { lastCheck: string | null } {
  const read = async () => {
    const result = await readWindow(input.child(), { pid: input.pid, window_id: input.window_id });
    return { result, reading: readingOf(result) };
  };
  const host = {
    lastCheck: null as string | null,
    async captureFingerprint(step?: WalkthroughStep): Promise<Uint8Array | null> {
      const { result, reading } = await read();
      const observation = observationOf(result);
      if (!observation || !reading) return null;
      // A shape that does not move when a field is filled would hide the very step that fills it.
      const watched = step?.expect?.field ? matching(reading, { label: step.expect.field.label }).map((element) => element.value ?? "") : [];
      return Uint8Array.from(createHash("sha256").update([observation.fingerprint, ...watched].join("\u0001")).digest());
    },
    async findTargets(): Promise<readonly WalkthroughTarget[]> {
      const { reading } = await read();
      if (!reading) throw new Error("The window could not be read.");
      return reading.elements.flatMap((element) => element.label === undefined ? [] : [{
        label: element.label, role: element.role, element_index: element.index,
        ...(element.token ? { element_token: element.token } : {}),
        ...(element.x === undefined || element.y === undefined ? {} : { x: element.x, y: element.y }),
      }]);
    },
    present(): void {},
    async confirmStep(step: WalkthroughStep): Promise<boolean | "unverified"> {
      if (!step.expect) {
        host.lastCheck = "This step has no check.";
        return "unverified";
      }
      const { reading } = await read();
      if (!reading) {
        host.lastCheck = "The window could not be read to check the step.";
        return false;
      }
      const verdict = checkExpectation(step.expect, reading);
      host.lastCheck = verdict.detail;
      return verdict.ok;
    },
  };
  return host;
}

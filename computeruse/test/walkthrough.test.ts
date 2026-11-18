import { describe, expect, it } from "vitest";
import { runWalkthrough, type WalkthroughEvent } from "../walkthrough.ts";

describe("walkthrough", () => {
  it("refreshes targets and requires confirmation after each screen change", async () => {
    const events: WalkthroughEvent[] = [];
    let frame = 0;
    let reads = 0;
    const result = await runWalkthrough([{ instruction: "Open File", target: { label: "File" } }, { instruction: "Choose Export" }], {
      captureFingerprint: async () => Uint8Array.of([0, 10, 10, 0, 10, 10][frame++]!),
      findTargets: async () => { reads++; return [{ label: "File", role: "menu", x: 1, y: 2 }]; },
      present: (event) => events.push(event),
      confirmStep: async () => true,
    }, { signal: new AbortController().signal, intervalMs: 1, timeoutMs: 1000 });
    expect(result).toBe("complete");
    expect(reads).toBe(2);
    expect(events.map((event) => event.type)).toEqual(["step", "observed", "step", "observed", "finished"]);
    expect(events[0]).toMatchObject({ target: { label: "File" } });
  });

  it("does not point at an ambiguous target or advance without confirmation", async () => {
    const events: WalkthroughEvent[] = [];
    let frame = 0;
    const result = await runWalkthrough([{ instruction: "Choose Open", target: { label: "Open" } }], {
      captureFingerprint: async () => Uint8Array.of([0, 10, 10][frame++]!),
      findTargets: async () => [{ label: "Open", role: "button", x: 1, y: 2 }, { label: "Open", role: "button", x: 3, y: 4 }],
      present: (event) => events.push(event),
      confirmStep: async () => false,
    }, { signal: new AbortController().signal, intervalMs: 1, timeoutMs: 1000 });
    expect(result).toBe("needs_review");
    expect(events[0]).toMatchObject({ target: null });
  });
});

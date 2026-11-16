import { describe, expect, it } from "vitest";

import { engineCapabilities, replaysTranscriptNatively } from "./capabilities.ts";

describe("engineCapabilities", () => {
  it("treats Dani Free as a transcript-replaying chat engine with bounded turns", () => {
    const caps = engineCapabilities("daniFree");
    expect(caps.resume).toBe(false);
    expect(caps.stepCap).toBeGreaterThan(0);
    expect(caps.full).toBe(true);
    expect(caps.nativeReviewer).toBe(false);
    expect(caps.edits).toBe(false);
    expect(caps.subagents).toBe(false);
    expect(replaysTranscriptNatively("daniFree")).toBe(true);
  });

  it("keeps native sessions separate from transcript replay and chat step limits", () => {
    const caps = engineCapabilities("claudeAgent");
    expect(caps.resume).toBe(true);
    expect(caps.nativeReviewer).toBe(true);
    expect(caps.edits).toBe(true);
    expect(caps.stepCap).toBeUndefined();
    expect(replaysTranscriptNatively("claudeAgent")).toBe(false);
  });

  it("does not infer native sessions, review, edits or transcript authority for unknown engines", () => {
    for (const kind of [undefined, "someFutureEngine", "constructor", "__proto__"]) {
      expect(engineCapabilities(kind)).toEqual({
        resume: false, nativeReviewer: false, full: true, edits: false, subagents: false,
      });
      expect(replaysTranscriptNatively(kind)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceLevel, voiceBarHeights } from "./VoiceLevel";

describe("the voice level under the composer", () => {
  it("rests as a row of dots in silence and rises with the level, never past its row", () => {
    expect(voiceBarHeights(new Uint8Array(48))).toEqual(Array.from({ length: 24 }, () => 2));
    const loud = voiceBarHeights(new Uint8Array(48).fill(255));
    expect(loud).toEqual(Array.from({ length: 24 }, () => 14));
    const mixed = voiceBarHeights(Uint8Array.from({ length: 48 }, (_, at) => (at < 2 ? 120 : 0)));
    expect(mixed[0]).toBeGreaterThan(2);
    expect(mixed[0]).toBeLessThan(14);
    expect(mixed[1]).toBe(2);
  });

  it("draws nothing until dictation is listening", () => {
    expect(renderToStaticMarkup(createElement(VoiceLevel, { active: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(VoiceLevel, { active: true })).match(/<i /g)).toHaveLength(24);
  });
});

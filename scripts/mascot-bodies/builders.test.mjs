import { describe, expect, it } from "vitest";

import { BODY_DEFS, BODY_IDS } from "./builders.ts";

const EXPECTED_IDS = [
  "blob", "circle", "squircle", "capsule",
  "drop", "shield", "hexagon", "diamond", "star",
];

describe("body builders", () => {
  it("produces the catalog in its persisted order, the Dani blob first", () => {
    expect(BODY_IDS).toEqual(EXPECTED_IDS);
  });

  it("emits only absolute M, C and Z, which is all the iOS parser understands", () => {
    for (const body of BODY_DEFS) {
      const commands = body.d.match(/[A-Za-z]/g) ?? [];
      const unique = [...new Set(commands)].sort();
      expect(unique, `${body.id} uses unsupported commands`).toEqual(["C", "M", "Z"]);
    }
  });

  it("starts every outline with a move and closes it", () => {
    for (const body of BODY_DEFS) {
      expect(body.d.trimStart().startsWith("M"), body.id).toBe(true);
      expect(body.d.trimEnd().endsWith("Z"), body.id).toBe(true);
    }
  });

  it("gives every curve six numbers", () => {
    for (const body of BODY_DEFS) {
      for (const segment of body.d.split("C").slice(1)) {
        const numbers = segment.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
        expect(numbers.length % 6, `${body.id} has a ragged curve`).toBe(0);
      }
    }
  });

  it("keeps the blob outline byte-identical to the shipped Dani artwork", () => {
    const blob = BODY_DEFS.find(s => s.id === "blob");
    expect(blob.d.startsWith("M198.91052 113.12915C198.30169 121.88191")).toBe(true);
    expect(blob.d.trimEnd().endsWith("199.51935 104.37638 198.91052 113.12915Z")).toBe(true);
  });
});

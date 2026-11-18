import { describe, expect, it } from "vitest";
import { z } from "zod";
import { computerFeatureShape, computerGuardsFrom, verifyComputerEffectsEnabled } from "./features.ts";
import { guardEnv } from "./guards.ts";

const schema = z.object(computerFeatureShape);

describe("the computer-use switches", () => {
  it("are all off unless set, and a config that sets none turns on nothing", () => {
    expect(schema.parse({})).toEqual({});
    expect(guardEnv(computerGuardsFrom(undefined))).toEqual({});
    expect(guardEnv(computerGuardsFrom({}))).toEqual({});
    expect(verifyComputerEffectsEnabled(undefined)).toBe(false);
    expect(verifyComputerEffectsEnabled({ verifyComputerEffects: false })).toBe(false);
  });

  it("turn on only when true, each its own check", () => {
    const every = Object.fromEntries(Object.keys(computerFeatureShape).map((name) => [name, true]));
    expect(Object.keys(guardEnv(computerGuardsFrom(every as never))).length).toBe(Object.keys(computerFeatureShape).length - 1);
    expect(verifyComputerEffectsEnabled({ verifyComputerEffects: true })).toBe(true);
    expect(guardEnv(computerGuardsFrom({ confirmComputerFinalActions: true }))).toEqual({ OMB_COMPUTER_RISK: "1" });
    expect(guardEnv(computerGuardsFrom({ showComputerPointer: true, reportComputerEvidence: true }))).toEqual({ OMB_COMPUTER_POINTER: "1", OMB_COMPUTER_EVIDENCE: "1" });
  });

  it("refuse a value that is not a boolean, so a typo cannot read as on", () => {
    expect(schema.safeParse({ guardComputerStale: "yes" }).success).toBe(false);
    expect(schema.safeParse({ guardComputerStale: 1 }).success).toBe(false);
  });
});

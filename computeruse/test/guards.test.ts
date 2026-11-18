import { describe, expect, it } from "vitest";
import { guardEnv, guardsFromEnv, type ComputerGuards } from "../guards.ts";

const everything: Required<ComputerGuards> = {
  stale: true, loop: true, typing: true, anchor: true, scroll: true, untrusted: true, guidance: true,
  pointer: true, evidence: true, risk: true, readWindow: true, batch: true,
};

describe("computer guards", () => {
  it("sends only the switches that are on, and nothing at all when none are", () => {
    expect(guardEnv({})).toEqual({});
    expect(guardEnv({ stale: false, loop: undefined })).toEqual({});
    expect(guardEnv({ stale: true, pointer: true })).toEqual({ OMB_COMPUTER_STALE: "1", OMB_COMPUTER_POINTER: "1" });
  });

  it("reads back exactly what was sent", () => {
    expect(guardsFromEnv(guardEnv(everything)).guards).toEqual(everything);
    expect(guardsFromEnv(guardEnv({ loop: true })).guards).toEqual({ loop: true });
    expect(guardsFromEnv({}).guards).toEqual({});
  });

  it("gives every switch its own variable", () => {
    const names = Object.values(guardEnv(everything));
    expect(Object.keys(guardEnv(everything))).toHaveLength(Object.keys(everything).length);
    expect(new Set(Object.keys(guardEnv(everything))).size).toBe(names.length);
  });

  it("takes the switches out of what the driver is given, and leaves everything else", () => {
    const { rest } = guardsFromEnv({ ...guardEnv(everything), PATH: "/bin", CUA_MARKER: "x" });
    expect(rest).toEqual({ PATH: "/bin", CUA_MARKER: "x" });
  });

  it("treats anything but 1 as off", () => {
    expect(guardsFromEnv({ OMB_COMPUTER_STALE: "0", OMB_COMPUTER_LOOP: "true", OMB_COMPUTER_TYPING: "" }).guards).toEqual({});
  });
});

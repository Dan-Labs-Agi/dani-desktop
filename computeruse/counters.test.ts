import { describe, expect, it } from "vitest";
import { emptyCounters, noteRefusal, noteVerdict, snapshotCounters, summarizeCounters } from "./counters.ts";

describe("session counters", () => {
  it("starts empty and counts verdicts and refusals by name", () => {
    const counters = emptyCounters();
    noteVerdict(counters, "changed");
    noteVerdict(counters, "changed");
    noteVerdict(counters, "unchanged");
    noteVerdict(counters, "unobserved");
    noteRefusal(counters, "stale");
    noteRefusal(counters, "stale");
    noteRefusal(counters, "loop");
    expect(counters).toMatchObject({ changed: 2, unchanged: 1, unobserved: 1, refusals: { stale: 2, loop: 1 } });
  });

  it("hands out a copy, so a later action cannot change what was already reported", () => {
    const counters = emptyCounters();
    noteRefusal(counters, "stale");
    const taken = snapshotCounters(counters);
    noteRefusal(counters, "stale");
    counters.actions += 3;
    expect(taken.refusals).toEqual({ stale: 1 });
    expect(taken.actions).toBe(0);
  });

  it("says in one plain line how many actions were confirmed, and never names the plumbing", () => {
    const counters = emptyCounters();
    counters.actions = 3;
    noteVerdict(counters, "changed");
    noteVerdict(counters, "changed");
    noteVerdict(counters, "changed");
    expect(summarizeCounters(counters)).toBe("3 actions on this computer, all confirmed by the window changing.");
    noteVerdict(counters, "unchanged");
    counters.actions = 4;
    expect(summarizeCounters(counters)).toBe("4 actions on this computer; 3 confirmed by the window changing, 1 not confirmed.");
    counters.actions = 1;
    const one = emptyCounters();
    one.actions = 1;
    expect(summarizeCounters(one)).toBe("1 action on this computer; the window was not read back, so none were confirmed.");
    expect(summarizeCounters(emptyCounters())).toBeNull();
    expect(summarizeCounters(counters)).not.toMatch(/fingerprint|read-back|verdict|observation/i);
  });

  it("still reports a session in which every call was held back", () => {
    const counters = emptyCounters();
    noteRefusal(counters, "risk");
    noteRefusal(counters, "risk");
    expect(summarizeCounters(counters)).toBe("No action was taken on this computer; 2 calls were held back.");
  });

  it("reports a refusal the bot ran into without saying which part of the bridge made it", () => {
    const counters = emptyCounters();
    counters.actions = 2;
    noteVerdict(counters, "changed");
    noteVerdict(counters, "changed");
    noteRefusal(counters, "stale");
    expect(summarizeCounters(counters)).toBe("2 actions on this computer, all confirmed by the window changing; 1 call was held back.");
  });
});

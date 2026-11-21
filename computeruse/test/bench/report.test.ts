import { describe, expect, it } from "vitest";
import { buildComputerReport, renderComputerReport } from "../../bench/report.ts";

describe("computer benchmark reports", () => {
  it("aggregates duration, outcomes and stage counters", () => {
    const report = buildComputerReport(1, [
      { id: "a", world: "container", passed: true, durationMs: 40, counters: {
        actions: 2, changed: 1, unchanged: 1, unobserved: 0, refusals: {}, readBacks: 3, addedMs: 10,
      }, failures: [] },
      { id: "b", world: "local-vm", passed: false, durationMs: 60, counters: {
        actions: 1, changed: 0, unchanged: 0, unobserved: 1, refusals: { stale: 1 }, readBacks: 1, addedMs: 20,
      }, failures: ["required-state"] },
    ], "2026-11-15T00:00:00.000Z");
    expect(report).toMatchObject({ passed: 1, failed: 1, durationMs: 100 });
    expect(renderComputerReport(report)).toContain("Refused by stale: 1");
    expect(renderComputerReport(report)).toContain("required-state");
  });
});

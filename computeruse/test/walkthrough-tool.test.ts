import { describe, expect, it } from "vitest";
import { localComputerResultLine } from "../guidance.ts";
import { waitForWindowChange } from "../walkthrough-tool.ts";

describe("walkthrough observation tool", () => {
  it("advertises the tool only with computer guidance enabled", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "get_window_state", description: "Read" }] } });
    expect(JSON.parse(localComputerResultLine(line, false, true)).result.tools.map((tool: { name: string }) => tool.name)).toContain("wait_for_window_change");
    expect(localComputerResultLine(line, false, false)).toBe(line);
  });

  it("observes a change without claiming the requested action succeeded", async () => {
    let reads = 0;
    const child = { driverVersion: undefined, call: async () => ({ structuredContent: { app_name: "Example", window_title: reads++ === 0 ? "Before" : "After", elements: [] } }) };
    const result = await waitForWindowChange({ name: "wait_for_window_change", arguments: { pid: 1, window_id: 2, timeout_ms: 2500 } }, child);
    expect(result.structuredContent).toEqual({ status: "changed" });
    expect(JSON.stringify(result)).toContain("does not prove success");
    expect(reads).toBeGreaterThanOrEqual(3);
  });

  it("rejects unbounded or invalid requests without reading the driver", async () => {
    let reads = 0;
    const result = await waitForWindowChange({ name: "wait_for_window_change", arguments: { pid: 1, window_id: 2, timeout_ms: 999999 } }, { driverVersion: undefined, call: async () => { reads++; return {}; } });
    expect(result.isError).toBe(true);
    expect(reads).toBe(0);
  });
});

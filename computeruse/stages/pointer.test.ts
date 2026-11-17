import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../../server/mcp-bridge.ts";
import { enablePointer, POINTER_DWELL_MS, POINTER_GLIDE_MS } from "./pointer.ts";

const driver = (answer: (name: string) => Record<string, unknown> | Promise<Record<string, unknown>>) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const child: ChildCalls = { driverVersion: "0.28.2", call: async (name, args) => { calls.push([name, args]); return answer(name); } };
  return { calls, child };
};

describe("the visible pointer", () => {
  it("turns the driver's cursor on and gives it a glide the person can follow, in that order", async () => {
    const { calls, child } = driver(() => ({ content: [] }));
    expect(await enablePointer(child)).toBe(true);
    expect(calls).toEqual([
      ["set_agent_cursor_enabled", { enabled: true }],
      ["set_agent_cursor_motion", { glide_duration_ms: POINTER_GLIDE_MS, dwell_after_click_ms: POINTER_DWELL_MS }],
    ]);
  });

  it("keeps the glide long enough to see and short enough not to slow a task", () => {
    expect(POINTER_GLIDE_MS).toBeGreaterThanOrEqual(250);
    expect(POINTER_GLIDE_MS).toBeLessThanOrEqual(800);
    expect(POINTER_DWELL_MS).toBeLessThanOrEqual(500);
  });

  it("reports false, and does not set motion, when the driver refuses to show a cursor", async () => {
    const { calls, child } = driver(() => ({ isError: true, content: [{ type: "text", text: "no cursor on this platform" }] }));
    expect(await enablePointer(child)).toBe(false);
    expect(calls.map(([name]) => name)).toEqual(["set_agent_cursor_enabled"]);
  });

  it("never throws or hangs: a missing or silent driver is just a pointer that did not appear", async () => {
    const gone: ChildCalls = { driverVersion: undefined, call: async () => { throw new Error("transport closed"); } };
    expect(await enablePointer(gone)).toBe(false);
    const silent: ChildCalls = { driverVersion: undefined, call: () => new Promise(() => {}) };
    expect(await enablePointer(silent, 10)).toBe(false);
  });
});

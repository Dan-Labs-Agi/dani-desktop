import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../../server/mcp-bridge.ts";
import { bounded, readWindow } from "../read.ts";

const child = (call: ChildCalls["call"]): ChildCalls => ({ driverVersion: "0.28.2", call });

describe("a bounded wait", () => {
  it("answers what the work answers when it is quick", async () => {
    expect(await bounded(Promise.resolve("done"), 50)).toBe("done");
  });

  it("answers null instead of holding the turn when the work never returns", async () => {
    expect(await bounded(new Promise<string>(() => {}), 10)).toBeNull();
  });

  it("answers null when the work throws, since a failed read changes nothing for the caller", async () => {
    expect(await bounded(Promise.reject(new Error("driver gone")), 50)).toBeNull();
  });
});

describe("reading a window", () => {
  it("asks the driver for the structure alone, never a screenshot", async () => {
    const asked: Array<[string, Record<string, unknown>]> = [];
    const read = await readWindow(child(async (name, args) => { asked.push([name, args]); return { content: [] }; }), { pid: 4, window_id: 9, element_index: 1 });
    expect(read).toEqual({ content: [] });
    expect(asked).toEqual([["get_window_state", { pid: 4, window_id: 9, include_screenshot: false }]]);
  });

  it("reads nothing when the call does not say which window", async () => {
    const asked: string[] = [];
    const quiet = child(async (name) => { asked.push(name); return {}; });
    expect(await readWindow(quiet, { element_index: 1 })).toBeNull();
    expect(await readWindow(quiet, { pid: 4 })).toBeNull();
    expect(asked).toEqual([]);
  });

  it("answers null for a driver that never answers or fails", async () => {
    expect(await readWindow(child(() => new Promise(() => {})), { pid: 1, window_id: 2 }, 10)).toBeNull();
    expect(await readWindow(child(async () => { throw new Error("closed"); }), { pid: 1, window_id: 2 })).toBeNull();
    expect(await readWindow(child(() => { throw new Error("closed at once"); }), { pid: 1, window_id: 2 })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readingOf, windowWalkthroughHost } from "../walkthrough-host.ts";

function window(over: { title?: string; values?: Record<string, string>; complete?: boolean } = {}) {
  const state = { title: over.title ?? "Form", values: { ...over.values }, complete: over.complete ?? true, reads: 0, unreadable: false };
  const child = {
    driverVersion: undefined,
    call: async (name: string, args: Record<string, unknown>) => {
      state.reads += 1;
      expect(name).toBe("get_window_state");
      expect(args).toEqual({ pid: 4, window_id: 9, include_screenshot: false });
      if (state.unreadable) return { isError: true, content: [{ type: "text", text: "no" }] };
      return { structuredContent: { app_name: "Shop", window_title: state.title, elements_complete: state.complete, elements: [
        { element_index: 1, element_token: "s1:1", role: "Edit", label: "Name", value: state.values.Name ?? "", frame: { x: 10, y: 20, w: 100, h: 40 } },
        { element_index: 2, element_token: "s1:2", role: "Button", label: "Pay", frame: { x: 0, y: 0, w: 10, h: 10 } },
        { element_index: 3, role: "Text" },
      ] } };
    },
  };
  return { state, host: windowWalkthroughHost({ child: () => child, pid: 4, window_id: 9 }) };
}

describe("the walkthrough's view of a window", () => {
  it("reads the elements with the centre of each frame, and what a field holds", () => {
    const { elements } = readingOf({ structuredContent: { window_title: "T", elements: [{ element_index: 1, role: "Edit", label: "Name", value: "Ann", frame: { x: 10, y: 20, w: 100, h: 40 } }, { role: "bad" }] } })!;
    expect(elements).toEqual([{ index: 1, role: "Edit", label: "Name", value: "Ann", x: 60, y: 40 }]);
    expect(readingOf({ isError: true })).toBeNull();
    expect(readingOf({ structuredContent: {} })).toBeNull();
  });

  it("lists the labelled controls as targets, with what an action would name them by", async () => {
    const { host } = window();
    expect(await host.findTargets()).toEqual([
      { label: "Name", role: "Edit", element_index: 1, element_token: "s1:1", x: 60, y: 40 },
      { label: "Pay", role: "Button", element_index: 2, element_token: "s1:2", x: 5, y: 5 },
    ]);
  });

  it("fingerprints the window's shape, so a change of shape is a change", async () => {
    const { state, host } = window();
    const before = await host.captureFingerprint();
    expect(await host.captureFingerprint()).toEqual(before);
    state.title = "Receipt";
    expect(await host.captureFingerprint()).not.toEqual(before);
  });

  it("includes what a step's field holds, since filling a field moves no shape", async () => {
    const { state, host } = window();
    const step = { instruction: "Type your name", expect: { field: { label: "Name", equals: "Ann" } } };
    const empty = await host.captureFingerprint(step);
    expect(await host.captureFingerprint()).toEqual(await host.captureFingerprint());
    state.values.Name = "Ann";
    expect(await host.captureFingerprint(step)).not.toEqual(empty);
    expect(await host.captureFingerprint()).toEqual(await host.captureFingerprint());
  });

  it("answers null for a window it cannot read, and refuses to list targets from one", async () => {
    const { state, host } = window();
    state.unreadable = true;
    expect(await host.captureFingerprint()).toBeNull();
    await expect(host.findTargets()).rejects.toThrow("could not be read");
    expect(await host.confirmStep({ instruction: "x", expect: { present: { label: "Pay" } } }, new AbortController().signal)).toBe(false);
    expect(host.lastCheck).toContain("could not be read");
  });

  it("calls a step with no check unverified, and checks one that has one against a fresh read", async () => {
    const { state, host } = window({ values: { Name: "Ann" } });
    const signal = new AbortController().signal;
    expect(await host.confirmStep({ instruction: "x" }, signal)).toBe("unverified");
    expect(host.lastCheck).toContain("no check");
    expect(await host.confirmStep({ instruction: "x", expect: { field: { label: "Name", equals: "Ann" } } }, signal)).toBe(true);
    state.values.Name = "Bob";
    expect(await host.confirmStep({ instruction: "x", expect: { field: { label: "Name", equals: "Ann" } } }, signal)).toBe(false);
    expect(host.lastCheck).not.toMatch(/Ann|Bob/);
  });
});

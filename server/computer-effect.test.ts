import { describe, expect, it } from "vitest";
import type { ChildCalls } from "./mcp-bridge.ts";
import { effectVerdict, effectNote, observationOf, VERIFIED_ACTIONS, withVerifiedEffect } from "./computer-effect.ts";

const state = (title: string, elements: Array<{ element_index: number; role: string; label?: string; depth: number }>) => ({
  content: [{ type: "text", text: "read" }],
  structuredContent: { pid: 4242, window_id: 7, app_name: "Notes", window_title: title, elements },
});
const BUTTON = [{ element_index: 1, role: "AXButton", label: "Save", depth: 1 }];
const sent = { content: [{ type: "text", text: "clicked" }], structuredContent: { effect: "verified", route: "window" } };
const target = { pid: 4242, window_id: 7 };

const child = (answer: (name: string, args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const relayed: ChildCalls = { driverVersion: "0.28.2", call: async (name, args) => { calls.push([name, args]); return answer(name, args); } };
  return { calls, relayed };
};

describe("an observation of the window behind an action", () => {
  it("fingerprints what the driver read, and never what a field holds", () => {
    const held = state("Untitled", [{ element_index: 1, role: "AXTextField", label: "Card number", depth: 1 }]);
    held.structuredContent.elements[0] = { ...held.structuredContent.elements[0]!, value: "4111111111111111" } as never;
    const observation = observationOf(held);
    expect(observation).toMatchObject({ app: "Notes", window: "Untitled", elements: 1 });
    expect(JSON.stringify(observation)).not.toContain("4111");
  });

  it("is nothing at all for a refusal, an error or an answer with no structure", () => {
    expect(observationOf({ content: [], isError: true, structuredContent: { pid: 1 } })).toBeNull();
    expect(observationOf({ content: [{ type: "text", text: "read" }] })).toBeNull();
    expect(observationOf(null)).toBeNull();
  });
});

describe("the verdict on an action's effect", () => {
  const before = observationOf(state("Untitled", BUTTON));

  it("is changed when the window moved, by title or by its elements", () => {
    expect(effectVerdict(before, observationOf(state("Untitled — edited", BUTTON)))).toBe("changed");
    expect(effectVerdict(before, observationOf(state("Untitled", [...BUTTON, { element_index: 2, role: "AXSheet", depth: 1 }])))).toBe("changed");
  });

  it("is unchanged when the read-back is the same window it was", () => {
    expect(effectVerdict(before, observationOf(state("Untitled", BUTTON)))).toBe("unchanged");
  });

  it("is unobserved when either read-back is missing, never guessed from the one it has", () => {
    expect(effectVerdict(before, null)).toBe("unobserved");
    expect(effectVerdict(null, before)).toBe("unobserved");
    expect(effectVerdict(null, null)).toBe("unobserved");
  });
});

describe("what the bot is told about the effect", () => {
  it("says nothing when the action changed the window: the result already speaks for itself", () => {
    expect(effectNote("changed", "click")).toBeNull();
  });

  it("names the honest doubt in plain words, and never the plumbing", () => {
    for (const verdict of ["unchanged", "unobserved"] as const) {
      const note = effectNote(verdict, "click")!;
      expect(note).toMatch(/click/);
      expect(note).toMatch(/get_window_state/);
      expect(note).not.toMatch(/HWND|fingerprint|CDP|accessibility tree|hash/i);
    }
    expect(effectNote("unchanged", "click")).toMatch(/did not change/);
    expect(effectNote("unobserved", "click")).toMatch(/could not be read back/);
  });

  it("never tells the bot to simply send the action again", () => {
    for (const verdict of ["unchanged", "unobserved"] as const) {
      expect(effectNote(verdict, "click")).not.toMatch(/try again|retry|repeat it|send it again/i);
    }
  });
});

describe("an action carried out with its effect verified", () => {
  it("reads the window before and after, and answers the driver's own result when it changed", async () => {
    let reads = 0;
    const { calls, relayed } = child((name) => name === "get_window_state" ? state(`Untitled ${++reads}`, BUTTON) : sent);
    const answer = await withVerifiedEffect({ name: "click", arguments: { ...target, element_index: 1 } }, relayed);
    expect(calls.map(([name]) => name)).toEqual(["get_window_state", "click", "get_window_state"]);
    expect(calls[0]![1]).toEqual({ ...target, include_screenshot: false });
    expect(answer).toEqual(sent);
  });

  it("adds the doubt to the driver's own result when nothing changed, keeping what it said", async () => {
    const { relayed } = child((name) => name === "get_window_state" ? state("Untitled", BUTTON) : sent);
    const answer = await withVerifiedEffect({ name: "click", arguments: { ...target, element_index: 1 } }, relayed) as Record<string, unknown>;
    expect(answer.structuredContent).toEqual({ effect: "unverified", route: "window" });
    expect(answer.content).toEqual([{ type: "text", text: "clicked" }, { type: "text", text: effectNote("unchanged", "click") }]);
  });

  it("does not read back, and does not change the answer, when the action itself failed", async () => {
    const failed = { content: [{ type: "text", text: "no such element" }], isError: true };
    const { calls, relayed } = child((name) => name === "get_window_state" ? state("Untitled", BUTTON) : failed);
    expect(await withVerifiedEffect({ name: "click", arguments: { ...target, element_index: 1 } }, relayed)).toEqual(failed);
    expect(calls.map(([name]) => name)).toEqual(["get_window_state", "click"]);
  });

  it("is honest, not silent, when the read-back never answers: the action still went out", async () => {
    const { relayed } = child((name) => name === "get_window_state" ? new Promise<Record<string, unknown>>(() => {}) : sent);
    const answer = await withVerifiedEffect({ name: "click", arguments: { ...target, element_index: 1 } }, relayed, { timeoutMs: 10 }) as Record<string, unknown>;
    expect(answer.content).toEqual([{ type: "text", text: "clicked" }, { type: "text", text: effectNote("unobserved", "click") }]);
  });

  it("leaves an action it cannot address a read-back for to the driver, unverified and unchanged", async () => {
    const { calls, relayed } = child(() => sent);
    expect(await withVerifiedEffect({ name: "click", arguments: { x: 10, y: 20 } }, relayed)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("verifies the actions that act on a window, and leaves every observation alone", () => {
    for (const tool of ["click", "double_click", "right_click", "type_text", "set_value", "press_key", "hotkey"]) {
      expect(VERIFIED_ACTIONS.has(tool)).toBe(true);
    }
    for (const tool of ["get_window_state", "list_apps", "screenshot", "launch_app", "drag", "move_cursor"]) {
      expect(VERIFIED_ACTIONS.has(tool)).toBe(false);
    }
  });
});

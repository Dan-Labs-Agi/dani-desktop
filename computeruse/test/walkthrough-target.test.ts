import { describe, expect, it } from "vitest";
import { findWindowTarget } from "../walkthrough-target.ts";

describe("guided target lookup", () => {
  it("returns a fresh unique target and reports an incomplete tree", async () => {
    const calls: string[] = [];
    const result = await findWindowTarget({ name: "find_window_target", arguments: { pid: 4, window_id: 9, label: "save" } }, {
      driverVersion: undefined,
      call: async (name) => { calls.push(name); return { structuredContent: { elements: [{ element_index: 2, element_token: "fresh", role: "Button", label: "Save", depth: 1 }] } }; },
      //call: async (name) => { calls.push(name); return { structuredContent: { elements: [{ element_index: 2, element_token: "fresh", role: "Button", label: "Save", depth: 1 }] } }; },
    });
    expect(calls).toEqual(["get_window_state"]);
    expect(result.structuredContent).toMatchObject({ status: "found", complete: false, target: { element_token: "fresh" } });
  });

  it("does not choose between ambiguous controls", async () => {
    const result = await findWindowTarget({ name: "find_window_target", arguments: { pid: 4, window_id: 9, label: "Save" } }, {
      driverVersion: undefined,
      call: async () => ({ structuredContent: { elements: [1, 2].map((element_index) => ({ element_index, role: "Button", label: "Save", depth: 1 })) } }),
    });
    expect(result.structuredContent).toEqual({ status: "ambiguous" });
  });
});

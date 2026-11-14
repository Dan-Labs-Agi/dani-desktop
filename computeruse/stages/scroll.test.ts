import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../../server/mcp-bridge.ts";
import { createComputerPipeline } from "../pipeline.ts";

function fixture(pageKeyMoves: boolean) {
  let page = 0;
  const calls: string[] = [];
  const child: ChildCalls = {
    driverVersion: "0.28.2",
    call: async (name) => {
      calls.push(name);
      if (name === "press_key" && pageKeyMoves) page += 1;
      if (name === "get_window_state") return { structuredContent: {
        app_name: "List", window_title: `Page ${page}`, elements: [],
      } };
      return { content: [{ type: "text", text: "sent" }] };
    },
  };
  return { child, calls };
}

describe("verified scrolling", () => {
  it("uses a page key after an unchanged scroll", async () => {
    const { child, calls } = fixture(true);
    const relay = createComputerPipeline("linux", false, { scroll: true });
    await relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child);
    const result = await relay({ name: "scroll", arguments: { pid: 1, window_id: 2, direction: "down", amount: 1 } }, child);
    expect(JSON.stringify(result)).toContain("The view moved with PageDown");
    expect(calls).toEqual(["get_window_state", "scroll", "get_window_state", "press_key", "get_window_state"]);
  });

  it("reports the end of an unchanged list", async () => {
    const { child, calls } = fixture(false);
    const relay = createComputerPipeline("linux", false, { scroll: true });
    await relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child);
    const result = await relay({ name: "scroll", arguments: { pid: 1, window_id: 2, direction: "down", amount: 1 } }, child);
    expect(JSON.stringify(result)).toContain("appears to be at its end");
    expect(calls.filter((name) => name === "scroll")).toHaveLength(1);
  });
});

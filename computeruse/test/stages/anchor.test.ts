import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../../../server/mcp-bridge.ts";
import { createComputerPipeline } from "../../pipeline.ts";

describe("stale target anchoring", () => {
  it("suggests a freshly matched index and token without acting on it", async () => {
    let shifted = false;
    let clicks = 0;
    const child: ChildCalls = {
      driverVersion: "0.28.2",
      call: async (name) => {
        if (name === "click") {
          clicks += 1;
          shifted = true;
          return { content: [{ type: "text", text: "sent" }] };
        }
        const index = shifted ? 5 : 4;
        return { structuredContent: {
          app_name: "Notes", window_title: shifted ? "After" : "Before", elements_complete: true,
          elements: [
            { element_index: 0, role: "AXWindow", depth: 0 },
            { element_index: index, element_token: `token-${index}`, parent_index: 0, role: "AXButton", label: "Next", depth: 1 },
          ],
        } };
      },
    };
    const relay = createComputerPipeline("linux", false, { anchor: true });
    const read = { name: "get_window_state", arguments: { pid: 1, window_id: 2 } };
    const click = { name: "click", arguments: { pid: 1, window_id: 2, element_index: 4 } };
    await relay(read, child);
    await relay(click, child);
    const refusal = await relay(click, child) as { isError: boolean; content: Array<{ text: string }> };
    expect(refusal.isError).toBe(true);
    expect(refusal.content.map((entry) => entry.text).join(" ")).toContain("element_index 5 with element_token token-5");
    expect(clicks).toBe(1);
  });
});

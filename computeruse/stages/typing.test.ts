import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../../server/mcp-bridge.ts";
import { verifiedTyping } from "./typing.ts";

const target = { name: "set_value", arguments: { pid: 10, window_id: 2, element_index: 4, value: "private phrase" } };
const snapshot = (label: string) => ({ elements: [{ element_index: 4, role: "AXTextField", label, depth: 1 }] });

function driver(label: string, value: string) {
  const calls: string[] = [];
  const child: ChildCalls = {
    driverVersion: "0.28.2",
    call: async (name) => {
      calls.push(name);
      return { structuredContent: { elements: [{ element_index: 4, role: "AXTextField", label, value }] } };
    },
  };
  return { child, calls };
}

describe("verified typing", () => {
  it("reports a match without echoing the field or input value", async () => {
    const { child, calls } = driver("Title", "private phrase");
    const result = await verifiedTyping(target, child, async () => ({ content: [{ type: "text", text: "private phrase" }] }), snapshot("Title"));
    expect(result.structuredContent).toEqual({ typing_verification: "matched" });
    expect(JSON.stringify(result)).not.toContain("private phrase");
    expect(calls).toEqual(["get_window_state"]);
  });

  it("reports a difference once, without repeating the write", async () => {
    const { child } = driver("Title", "different");
    let writes = 0;
    const result = await verifiedTyping(target, child, async () => { writes += 1; return {}; }, snapshot("Title"));
    expect(result.structuredContent).toEqual({ typing_verification: "differs" });
    expect(writes).toBe(1);
  });

  it("does not read a secret field after writing", async () => {
    const { child, calls } = driver("Password", "private phrase");
    const result = await verifiedTyping(target, child, async () => ({ content: [{ type: "text", text: "private phrase" }] }), snapshot("Password"));
    expect(result.structuredContent).toEqual({ typing_verification: "not_checked" });
    expect(calls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private phrase");
  });

  it("reports an untargeted field as unreadable", async () => {
    const { child, calls } = driver("Title", "private phrase");
    const result = await verifiedTyping({ name: "type_text", arguments: { pid: 10, window_id: 2, text: "private phrase" } }, child, async () => ({}));
    expect(result.structuredContent).toEqual({ typing_verification: "unreadable" });
    expect(calls).toEqual([]);
  });
});

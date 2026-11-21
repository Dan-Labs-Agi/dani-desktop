import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../../../server/mcp-bridge.ts";
import { verifiedTyping } from "../../stages/typing.ts";

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
  it("finds a token-addressed field again in the next read, whose tokens are new, by what the field is", async () => {
    // cua-driver 0.28.2 on Windows mints new element tokens with every read: sNNNNNNNN:index.
    const before = { elements: [{ element_index: 0, element_token: "s00000001:0", role: "Edit", label: "Body", depth: 1 }] };
    const call = { name: "set_value", arguments: { pid: 10, window_id: 2, element_token: "s00000001:0", value: "hello" } };
    const reread = (value: string): ChildCalls => ({ driverVersion: "0.28.2", call: async () => ({ structuredContent: { elements: [
      { element_index: 0, element_token: "s00000002:0", role: "Edit", label: "Body", depth: 1, value },
      { element_index: 1, element_token: "s00000002:1", role: "Edit", label: "Notes", depth: 1, value: "other" },
    ] } }) });
    expect((await verifiedTyping(call, reread("hello"), async () => ({ content: [] }), before)).structuredContent).toEqual({ typing_verification: "matched" });
    expect((await verifiedTyping(call, reread("hell"), async () => ({ content: [] }), before)).structuredContent).toEqual({ typing_verification: "differs" });
  });

  it("does not guess between two fields that look the same, and says it could not read the field", async () => {
    const before = { elements: [{ element_index: 0, element_token: "s1:0", role: "Edit", label: "Line", depth: 1 }, { element_index: 1, element_token: "s1:1", role: "Edit", label: "Line", depth: 1 }] };
    const call = { name: "set_value", arguments: { pid: 10, window_id: 2, element_token: "s1:1", value: "x" } };
    const moved: ChildCalls = { driverVersion: "0.28.2", call: async () => ({ structuredContent: { elements: [
      { element_index: 5, element_token: "s2:5", role: "Edit", label: "Line", depth: 1, value: "x" },
      { element_index: 6, element_token: "s2:6", role: "Edit", label: "Line", depth: 1, value: "y" },
    ] } }) };
    expect((await verifiedTyping(call, moved, async () => ({ content: [] }), before)).structuredContent).toEqual({ typing_verification: "unreadable" });
  });

  it("answers a typing call the driver refused exactly as the driver did, so the bot is told why", async () => {
    const { child, calls } = driver("Title", "");
    const refused = { isError: true, content: [{ type: "text", text: "set_value: bare element_index is not accepted; pass element_token" }] };
    const result = await verifiedTyping(target, child, async () => refused, snapshot("Title"));
    expect(result).toBe(refused);
    expect(calls).toEqual([]);
  });

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

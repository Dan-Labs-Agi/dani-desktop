import { describe, expect, it } from "vitest";
import { createAliases, type ToolAlias } from "./mcp-bridge-alias.ts";

const alias: ToolAlias = {
  name: "peek",
  request: (call) => ({ name: "get_state", arguments: { only: call.arguments.only, extra: true } }),
  answer: (result) => ({ ...result, shaped: true }),
};
const call = (id: unknown, name: string, args: unknown = { only: 1, smuggled: 2 }) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: { m: 1 } } });
const reply = (id: unknown, result: unknown = { content: [] }) => JSON.stringify({ jsonrpc: "2.0", id, result });

describe("a tool the agent sees that is another of the driver's", () => {
  it("renames the request before anything else sees it, keeping the id and metadata", () => {
    const seen = JSON.parse(createAliases(alias).request(call(7, "peek")));
    expect(seen).toEqual({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_state", arguments: { only: 1, extra: true }, _meta: { m: 1 } } });
  });

  it("leaves every other line exactly as it came", () => {
    const aliases = createAliases(alias);
    for (const line of [call(1, "click"), call(2, "peek_more"), "not json at all peek", JSON.stringify({ id: 3, method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "peek" } }), reply(4)]) {
      expect(aliases.request(line)).toBe(line);
    }
    expect(createAliases(undefined).request(call(5, "peek"))).toBe(call(5, "peek"));
  });

  it("reshapes the answer to that call once, and no other", () => {
    const aliases = createAliases(alias);
    aliases.request(call(7, "peek"));
    expect(JSON.parse(aliases.answer(reply(8)))).toEqual({ jsonrpc: "2.0", id: 8, result: { content: [] } });
    expect(JSON.parse(aliases.answer(reply(7)))).toMatchObject({ id: 7, result: { shaped: true } });
    expect(JSON.parse(aliases.answer(reply(7)))).not.toHaveProperty("result.shaped");
  });

  it("passes a protocol error through, and forgets the call it answered", () => {
    const aliases = createAliases(alias);
    aliases.request(call("a", "peek"));
    const error = JSON.stringify({ jsonrpc: "2.0", id: "a", error: { code: -32603, message: "boom" } });
    expect(aliases.answer(error)).toBe(error);
    expect(aliases.answer(reply("a"))).toBe(reply("a"));
  });

  it("tells a call that has no arguments from one that has", () => {
    const aliases = createAliases(alias);
    expect(JSON.parse(aliases.request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "peek" } }))).params.arguments).toEqual({ extra: true });
  });
});

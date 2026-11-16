import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { costUsd, createRelay, MODEL, tokenKey, toMessages, type Env, type Grant } from "./relay";

const TOKEN = `omb_ai_${"a".repeat(43)}`;
const usage = (input: number, output: number, read = 0, written = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: written }) as Anthropic.Usage;
const message = (content: Anthropic.ContentBlock[], stop: Anthropic.StopReason = "end_turn"): Anthropic.Message =>
  ({ id: "msg_1", type: "message", role: "assistant", model: MODEL, content, stop_reason: stop, stop_sequence: null, usage: usage(10, 5) }) as Anthropic.Message;

async function setup(grant: Grant | null, reply: Anthropic.Message, events: Anthropic.RawMessageStreamEvent[] = []) {
  const store = new Map<string, string>();
  if (grant) store.set(await tokenKey(TOKEN), JSON.stringify(grant));
  const env: Env = {
    ANTHROPIC_API_KEY: "sk-test",
    TOKENS: { get: async (key) => (store.has(key) ? JSON.parse(store.get(key)!) : null), put: async (key, value) => void store.set(key, value) },
  };
  const sent: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const relay = createRelay(() => ({
    messages: {
      create: async (params: unknown) => { sent.push(params); return reply; },
      stream: (params: unknown) => {
        sent.push(params);
        return { async *[Symbol.asyncIterator]() { yield* events; }, finalMessage: async () => reply, abort() {} };
      },
    } as unknown as Anthropic["messages"],
  }));
  const call = (path: string, body?: unknown, token = TOKEN) => relay.fetch(new Request(`https://relay.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, { waitUntil: (promise) => void pending.push(promise) });
  const spent = async () => { await Promise.all(pending); return (JSON.parse(store.get(await tokenKey(TOKEN))!) as Grant).spentUsd; };
  return { env, call, sent, spent };
}

describe("the demo relay", () => {
  it("refuses with the codes the desktop's trial credit reads", async () => {
    const grant = { name: "demo", budgetUsd: 1, spentUsd: 0 };
    expect((await (await setup(grant, message([]))).call("/v1/models", undefined, `omb_ai_${"b".repeat(43)}`)).status).toBe(401);
    expect((await (await setup({ ...grant, off: true }, message([]))).call("/v1/models")).status).toBe(401);
    const usedUp = await (await setup({ ...grant, spentUsd: 1 }, message([]))).call("/v1/models");
    expect([usedUp.status, ((await usedUp.json()) as { error: { code: string } }).error.code]).toEqual([402, "trial_credit_used_up"]);
    const paused = await setup(grant, message([]));
    paused.env.PAUSED = "1";
    expect((await paused.call("/v1/models")).status).toBe(429);
  });

  it("lists only Haiku 5.5 and answers on it whatever model is asked for, charging the token", async () => {
    const relay = await setup({ name: "demo", budgetUsd: 1, spentUsd: 0 }, message([{ type: "text", text: "hi", citations: null } as Anthropic.TextBlock]));
    expect(await (await relay.call("/v1/models")).json()).toMatchObject({ data: [{ id: "claude-haiku-5-5" }] });
    const reply = await (await relay.call("/v1/chat/completions", { model: "claude-opus-5-5", max_tokens: 999_999, messages: [{ role: "user", content: "hi" }] })).json();
    expect(reply).toMatchObject({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect(relay.sent[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 32_000 });
    expect(await relay.spent()).toBeCloseTo(costUsd(usage(10, 5)));
  });

  it("streams text, tool calls, signed thinking and then usage as chat-completion chunks", async () => {
    const events = [
      { type: "message_start", message: message([]) },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Looking" } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "search", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"q\":" } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"x\"}" } },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ] as unknown as Anthropic.RawMessageStreamEvent[];
    const relay = await setup({ name: "demo", budgetUsd: 1, spentUsd: 0 }, message([]), events);
    const response = await relay.call("/v1/chat/completions", { stream: true, messages: [{ role: "user", content: "find x" }] });
    const lines = (await response.text()).split("\n\n").filter(Boolean);
    expect(lines.at(-1)).toBe("data: [DONE]");
    const chunks = lines.slice(0, -1).map((line) => JSON.parse(line.slice(6)) as { choices: Array<{ delta: Record<string, unknown>; finish_reason: string | null }>; usage?: unknown });
    const deltas = chunks.flatMap((chunk) => chunk.choices.map((choice) => choice.delta));
    expect(deltas.map((delta) => delta.content ?? "").join("")).toBe("Looking");
    expect(deltas.flatMap((delta) => (delta.tool_calls as Array<{ function: { arguments: string } }> | undefined) ?? []).map((call) => call.function.arguments).join("")).toBe("{\"q\":\"x\"}");
    expect(deltas.find((delta) => delta.reasoning_details)).toEqual({ reasoning_details: [{ type: "anthropic.thinking", thinking: "plan", signature: "sig" }] });
    expect(chunks.flatMap((chunk) => chunk.choices.map((choice) => choice.finish_reason)).filter(Boolean)).toEqual(["tool_calls"]);
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect(await relay.spent()).toBeGreaterThan(0);
  });

  it("turns a tool round trip with its signed thinking back into Messages API turns", () => {
    const params = toMessages({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
        { role: "assistant", content: null, reasoning_details: [{ type: "anthropic.thinking", thinking: "plan", signature: "sig" }], tool_calls: [{ id: "toolu_1", type: "function", function: { name: "search", arguments: "{\"q\":\"x\"}" } }] },
        { role: "tool", tool_call_id: "toolu_1", content: "found" },
        { role: "user", content: "and?" },
      ],
      tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } } }],
    });
    expect(params.system).toBe("Be brief.");
    expect(params.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "see" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "plan", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "found" }, { type: "text", text: "and?" }] },
    ]);
    expect(params.tools).toEqual([{ name: "search", description: "Search", input_schema: { type: "object", properties: { q: { type: "string" } } } }]);
    expect(() => toMessages({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://x.test/a.png" } }] }] })).toThrow();
  });

  it("gives workerd an entry module with only its handler", async () => {
    expect(Object.keys(await import("./index"))).toEqual(["default"]);
  });

  it("prices a long prompt at the higher rate", () => {
    expect(costUsd(usage(1_000_000, 1_000_000))).toBeCloseTo(3);
    expect(costUsd(usage(50_000, 0, 50_000))).toBeCloseTo(0.0055);
  });
});

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { assertEndpoint, openAiChatModel } from "../../../bench/live/model.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const KEY = "bench-key-canary-5d1e";

async function endpoint(answer: (body: Record<string, any>) => { status?: number; body: unknown }) {
  const seen: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: Record<string, any> }> = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ url: request.url ?? "", headers: request.headers, body });
      const reply = answer(body);
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

const ask = (url: string) => openAiChatModel({ url, apiKey: KEY, model: "fixture-model", temperature: 0 });
const input = { signal: new AbortController().signal, tools: [{ name: "click", description: "Click.", parameters: { type: "object", properties: {} } }] };
const one = [{ role: "user" as const, content: "U" }];

describe("the OpenAI-compatible model", () => {
  it("sends the key as a bearer token, the messages and tools in the wire's shape, and reads calls and usage back", async () => {
    const { url, seen } = await endpoint(() => ({ body: {
      choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "click", arguments: "{\"element_index\":2}" } }] } }],
      usage: { prompt_tokens: 120, completion_tokens: 8 },
    } }));
    const turn = await ask(url).complete({ ...input, messages: [
      { role: "system", content: "S" }, { role: "user", content: "U" },
      { role: "assistant", content: null, calls: [{ id: "a", name: "list_windows", arguments: "{}" }] },
      { role: "tool", callId: "a", content: "{\"ok\":true}" },
    ] });
    expect(turn).toEqual({ text: "", calls: [{ id: "call_1", name: "click", arguments: "{\"element_index\":2}" }], usage: { inputTokens: 120, outputTokens: 8 } });
    expect(seen[0]!.url).toBe("/v1/chat/completions");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.body).toMatchObject({
      model: "fixture-model", temperature: 0, max_tokens: 1024,
      tools: [{ type: "function", function: { name: "click", description: "Click." } }],
      messages: [
        { role: "system", content: "S" }, { role: "user", content: "U" },
        { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "list_windows", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "a", content: "{\"ok\":true}" },
      ],
    });
  });

  it("answers text with no calls, and counts no tokens it was not told about", async () => {
    const { url } = await endpoint(() => ({ body: { choices: [{ message: { content: "Done." } }] } }));
    expect(await ask(url).complete({ ...input, messages: one })).toEqual({ text: "Done.", calls: [], usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it("reports a refusal with the endpoint's words, shortened, and never with the key", async () => {
    const { url } = await endpoint(() => ({ status: 401, body: `bad key ${KEY} ${"x".repeat(1_000)}` }));
    const failure = await ask(url).complete({ ...input, messages: one }).catch((error: Error) => error);
    expect((failure as Error).message).toContain("answered 401");
    expect((failure as Error).message).not.toContain(KEY);
    expect((failure as Error).message.length).toBeLessThan(400);
  });

  it("refuses a reply that is not a message", async () => {
    const html = await endpoint(() => ({ body: "<html>" }));
    await expect(ask(html.url).complete({ ...input, messages: one })).rejects.toThrow("did not answer with JSON");
    const empty = await endpoint(() => ({ body: { choices: [] } }));
    await expect(ask(empty.url).complete({ ...input, messages: one })).rejects.toThrow("no message");
  });

  it("sends the key only over HTTPS, or to this machine", () => {
    expect(() => assertEndpoint("https://api.example.com/v1")).not.toThrow();
    expect(() => assertEndpoint("http://localhost:8000/v1")).not.toThrow();
    expect(() => assertEndpoint("http://127.0.0.1:8000/v1")).not.toThrow();
    expect(() => assertEndpoint("http://api.example.com/v1")).toThrow("HTTPS");
    expect(() => assertEndpoint("http://localhost.example.com/v1")).toThrow("HTTPS");
    expect(() => openAiChatModel({ url: "http://192.168.1.4/v1", apiKey: KEY, model: "m" })).toThrow("HTTPS");
  });
});

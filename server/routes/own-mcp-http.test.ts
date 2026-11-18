import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { ownMcpHttpRoutes } from "./own-mcp-http.ts";
import { AGENTS_ENV_HEADER, OWN_MCP_HTTP_PATH } from "./own-mcp-http-path.ts";
import { TOOL_LIMIT_ENV, TOOL_LIMIT_HEADER } from "../tool-count-limit.ts";

/** This server's own internal endpoints, as the stdio proxies reach them: the turn's capability is checked there. */
const internalCalls: Array<{ path: string; authorization?: string; body?: unknown }> = [];
const heldCalls = new Map<string, ServerResponse>();
const cancelledCalls = new Set<string>();
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith(OWN_MCP_HTTP_PATH)) {
      await ownMcpHttpRoutes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: {} as RequestAuth, json, readBody });
      return;
    }
    const body = req.method === "POST" ? await readBody(req) : undefined;
    internalCalls.push({ path: `${url.pathname}${url.search}`, authorization: req.headers.authorization, body });
    if (req.headers.authorization !== "Bearer turn-capability") return json(res, 401, { error: "unauthorized" });
    if (url.pathname === "/api/internal/browser/mcp") {
      const call = body as { method: string; params?: { name?: string } };
      if (call.params?.name?.startsWith("pending-")) {
        const name = call.params.name;
        heldCalls.set(name, res);
        res.once("close", () => { if (!res.writableEnded) cancelledCalls.add(name); });
        return;
      }
      return json(res, 200, { result: call.method === "tools/list"
        ? { tools: [{ name: "agent_browser_open", inputSchema: { type: "object" } }] }
        : { content: [{ type: "text", text: `ran ${call.params?.name}` }] } });
    }
    if (url.pathname === "/api/internal/agents") return json(res, 200, { bots: [{ id: "w1", name: "W1", model: "m" }] });
    return json(res, 404, { error: "no such endpoint" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (kind: string, body: unknown, headers: Record<string, string> = { authorization: "Bearer turn-capability" }) =>
  fetch(`${base}${OWN_MCP_HTTP_PATH}${kind}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
const agentsHeaders = (settings: Record<string, string>) => ({ authorization: "Bearer turn-capability",
  [AGENTS_ENV_HEADER]: Buffer.from(JSON.stringify(settings)).toString("base64url") });

describe("Dani Bot's own MCP servers over HTTP", () => {
  it("answers a browser session the way its stdio proxy does, with the turn's capability on every call", async () => {
    const init = await post("browser", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "danibot-browser" } } });
    const notice = await post("browser", { jsonrpc: "2.0", method: "notifications/initialized" });
    expect([notice.status, await notice.text()]).toEqual([202, ""]);
    expect(await (await post("browser", { jsonrpc: "2.0", id: 2, method: "tools/list" })).json())
      .toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "agent_browser_open", inputSchema: { type: "object" } }] } });
    const batch = await (await post("browser", [{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agent_browser_open", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "ping" }])).json();
    expect(batch).toEqual([{ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ran agent_browser_open" }] } }, { jsonrpc: "2.0", id: 4, result: {} }]);
    expect(internalCalls.filter((call) => call.path === "/api/internal/browser/mcp").every((call) => call.authorization === "Bearer turn-capability")).toBe(true);
  });

  it("refuses without a capability, passes a wrong one to the endpoint that refuses it, and offers no stream or unknown server", async () => {
    expect((await post("browser", { jsonrpc: "2.0", id: 1, method: "tools/list" }, {})).status).toBe(401);
    const wrong = await (await post("browser", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agent_browser_open" } },
      { authorization: "Bearer stolen" })).json();
    expect(wrong).toMatchObject({ id: 1, result: { isError: true } });
    expect((await fetch(`${base}${OWN_MCP_HTTP_PATH}browser`, { headers: { authorization: "Bearer turn-capability" } })).status).toBe(405);
    expect((await post("shell", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
  });

  it("serves the agents server with the bot's own settings, and calls the harness as that bot with the turn's capability", async () => {
    const list = async (settings: Record<string, string>) =>
      ((await (await post("agents", { jsonrpc: "2.0", id: 1, method: "tools/list" }, agentsHeaders(settings))).json()) as { result: { tools: Array<{ name: string }> } })
        .result.tools.map((tool) => tool.name);
    const worker = await list({ OMB_BOT_ID: "w2", OMB_THREAD_ID: "t2" });
    const chief = await list({ OMB_BOT_ID: "chief", OMB_THREAD_ID: "t1", OMB_CHIEF_OF_STAFF: "1" });
    expect(worker).toContain("coordinate_bots");
    expect(chief.length).toBeGreaterThan(worker.length);
    internalCalls.length = 0;
    const call = await (await post("agents", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_bots", arguments: {} } },
      agentsHeaders({ OMB_BOT_ID: "chief", OMB_THREAD_ID: "t1", OMB_HARNESS_URL: "http://203.0.113.9:1" }))).json();
    expect(call).toMatchObject({ id: 2, result: { content: [{ type: "text", text: expect.stringContaining("W1") }] } });
    expect(internalCalls).toEqual([
      expect.objectContaining({ path: "/api/internal/agents?self=chief", authorization: "Bearer turn-capability" }),
      expect.objectContaining({ path: "/api/internal/tool-timing", authorization: "Bearer turn-capability", body: expect.objectContaining({ name: "list_bots", ok: true }) }),
    ]);
  });

  it("lists no more of a server's tools than the turn's tool limit allows", async () => {
    const limited = await (await post("browser", { jsonrpc: "2.0", id: 5, method: "tools/list" },
      { authorization: "Bearer turn-capability", [TOOL_LIMIT_HEADER]: "0" })).json();
    expect(limited).toEqual({ jsonrpc: "2.0", id: 5, result: { tools: [] } });
    const agents = async (settings: Record<string, string>) =>
      ((await (await post("agents", { jsonrpc: "2.0", id: 6, method: "tools/list" }, agentsHeaders(settings))).json()) as { result: { tools: Array<{ name: string }> } })
        .result.tools.map((tool) => tool.name);
    const whole = await agents({ OMB_BOT_ID: "w2", OMB_THREAD_ID: "t2" });
    expect(await agents({ OMB_BOT_ID: "w2", OMB_THREAD_ID: "t2", [TOOL_LIMIT_ENV]: "3" })).toEqual(whole.slice(0, 3));
  });

  it("aborts the forwarded HTTP request when an unscoped browser caller disconnects", async () => {
    const controller = new AbortController();
    const response = fetch(`${base}${OWN_MCP_HTTP_PATH}browser`, {
      method: "POST", headers: { authorization: "Bearer turn-capability", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pending-disconnect" } }),
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      await vi.waitFor(() => expect(heldCalls.has("pending-disconnect")).toBe(true));
      controller.abort();
      await response;
      await vi.waitFor(() => expect(cancelledCalls.has("pending-disconnect")).toBe(true));
    } finally { controller.abort(); }
  });

  it("scopes browser cancellation to an initialized session, capability and exact typed ID", async () => {
    const initialize = async () => {
      const response = await post("browser", { jsonrpc: "2.0", id: 1, method: "initialize" });
      await response.json();
      const session = response.headers.get("mcp-session-id");
      expect(session).toBeTruthy();
      return { authorization: "Bearer turn-capability", "mcp-session-id": session! };
    };
    const first = await initialize();
    const second = await initialize();
    const call = (id: string | number, name: string, headers: Record<string, string>) =>
      post("browser", { jsonrpc: "2.0", id, method: "tools/call", params: { name } }, headers);
    const cancel = (requestId: string | number, headers?: Record<string, string>, kind = "browser") =>
      post(kind, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId } }, headers);
    const numeric = call(7, "pending-scope-number", first);
    const string = call("7", "pending-scope-string", first);
    const otherSession = call(7, "pending-other-session", second);
    try {
      await vi.waitFor(() => expect(["pending-scope-number", "pending-scope-string", "pending-other-session"].every((name) => heldCalls.has(name))).toBe(true));
      const collision = await call(7, "pending-collision", first);
      expect(await collision.json()).toMatchObject({ id: 7, result: { isError: true } });
      expect(heldCalls.has("pending-collision")).toBe(false);
      expect((await cancel(7, { ...first, authorization: "Bearer another-capability" })).status).toBe(404);
      await cancel(7);
      await cancel(7, first, "computer");
      await post("browser", { jsonrpc: "2.0", id: 99, method: "notifications/cancelled", params: { requestId: "7" } }, first);
      await cancel(7, first);
      await vi.waitFor(() => expect(cancelledCalls.has("pending-scope-number")).toBe(true));
      expect(cancelledCalls.has("pending-scope-string")).toBe(false);
      expect(cancelledCalls.has("pending-other-session")).toBe(false);
      expect(await (await numeric).json()).toMatchObject({ id: 7, result: { isError: true } });
      heldCalls.get("pending-scope-string")!.end(JSON.stringify({ result: { content: [] } }));
      heldCalls.get("pending-other-session")!.end(JSON.stringify({ result: { content: [] } }));
      expect(await (await string).json()).toMatchObject({ id: "7", result: { content: [] } });
      expect(await (await otherSession).json()).toMatchObject({ id: 7, result: { content: [] } });
    } finally {
      for (const name of ["pending-scope-number", "pending-scope-string", "pending-other-session"]) heldCalls.get(name)?.destroy();
      await Promise.allSettled([numeric, string, otherSession]);
    }
  });

  it("aborts every forwarded browser call in a batch when its caller disconnects", async () => {
    const controller = new AbortController();
    const response = fetch(`${base}${OWN_MCP_HTTP_PATH}browser`, {
      method: "POST", headers: { authorization: "Bearer turn-capability", "content-type": "application/json" },
      body: JSON.stringify([1, 2].map((id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: `pending-batch-${id}` } }))),
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      await vi.waitFor(() => expect([1, 2].every((id) => heldCalls.has(`pending-batch-${id}`))).toBe(true));
      controller.abort();
      await response;
      await vi.waitFor(() => expect([1, 2].every((id) => cancelledCalls.has(`pending-batch-${id}`))).toBe(true));
    } finally { controller.abort(); }
  });

  it("keeps batch request IDs unique within a browser session", async () => {
    const initialized = await post("browser", { jsonrpc: "2.0", id: 1, method: "initialize" });
    await initialized.json();
    const session = initialized.headers.get("mcp-session-id");
    expect(session).toBeTruthy();
    const headers = { authorization: "Bearer turn-capability", "mcp-session-id": session! };
    const batch = post("browser", [
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "pending-batch-first" } },
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "pending-batch-duplicate" } },
    ], headers);
    try {
      await vi.waitFor(() => expect(heldCalls.has("pending-batch-first")).toBe(true));
      await post("browser", { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } }, headers);
      await vi.waitFor(() => expect(cancelledCalls.has("pending-batch-first")).toBe(true));
      expect(heldCalls.has("pending-batch-duplicate")).toBe(false);
      expect(await (await batch).json()).toEqual([
        expect.objectContaining({ id: 9, result: expect.objectContaining({ isError: true }) }),
        expect.objectContaining({ id: 9, result: expect.objectContaining({ isError: true, content: [{ type: "text", text: "Request ID is already active." }] }) }),
      ]);
    } finally {
      heldCalls.get("pending-batch-first")?.destroy();
      await Promise.allSettled([batch]);
    }
  });

  it("can cancel an accepted browser request after its signed session expires", async () => {
    const initialized = await post("browser", { jsonrpc: "2.0", id: 1, method: "initialize" });
    await initialized.json();
    const session = initialized.headers.get("mcp-session-id")!;
    const headers = { authorization: "Bearer turn-capability", "mcp-session-id": session };
    const pending = post("browser", { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "pending-expiring" } }, headers);
    const clock = vi.spyOn(Date, "now");
    const now = Date.now();
    try {
      await vi.waitFor(() => expect(heldCalls.has("pending-expiring")).toBe(true));
      clock.mockReturnValue(now + 24 * 60 * 60 * 1_000 + 1);
      const cancellation = await post("browser", { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 21 } }, headers);
      expect(cancellation.status).toBe(202);
      await vi.waitFor(() => expect(cancelledCalls.has("pending-expiring")).toBe(true));
      await expect((await pending).json()).resolves.toMatchObject({ result: { isError: true } });
      expect((await post("browser", { jsonrpc: "2.0", id: 22, method: "ping" }, headers)).status).toBe(404);
    } finally {
      clock.mockRestore();
      heldCalls.get("pending-expiring")?.destroy();
      await Promise.allSettled([pending]);
    }
  });

  it("allows warm browser sessions but requires reinitialization after scope expiry", async () => {
    const initialized = await post("browser", { jsonrpc: "2.0", id: 1, method: "initialize" });
    await initialized.json();
    const session = initialized.headers.get("mcp-session-id");
    expect(session).toBeTruthy();
    const headers = { authorization: "Bearer turn-capability", "mcp-session-id": session! };
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(now + 6 * 60 * 60 * 1_000);
      expect((await post("browser", { jsonrpc: "2.0", id: 2, method: "ping" }, headers)).status).toBe(200);
      clock.mockReturnValue(now + 24 * 60 * 60 * 1_000 + 1);
      expect((await post("browser", { jsonrpc: "2.0", id: 3, method: "ping" }, headers)).status).toBe(404);
      const renewed = await post("browser", { jsonrpc: "2.0", id: 4, method: "initialize" }, headers);
      expect(renewed.status).toBe(200);
      expect(renewed.headers.get("mcp-session-id")).not.toBe(session);
    } finally { clock.mockRestore(); }
  });
});

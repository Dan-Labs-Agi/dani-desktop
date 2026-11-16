// Dani Bot's own MCP servers (agents, browser, computer, data, HighLevel) over MCP's Streamable HTTP transport, JSON
// responses only, for engines that reach MCP servers by URL: one endpoint in this process instead of a stdio proxy
// process per server in every session. The turn's capability rides the Authorization header, and the endpoints behind
// these answers check it, as they check the stdio proxies'.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { agentsMcp } from "../drivers/agents-mcp.ts";
import { AGENTS_MCP_ENV } from "../drivers/agents-mcp-env.ts";
import type { Json } from "../drivers/agents-client.ts";
import { failure, harnessMcpRequest, MAX_INPUT_BYTES, parseHarnessMcpKind } from "../harness-mcp-request.ts";
import { parseToolLimit, TOOL_LIMIT_HEADER } from "../tool-count-limit.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

import { AGENTS_ENV_HEADER, OWN_MCP_HTTP_PATH } from "./own-mcp-http-path.ts";

// Browser sessions scope cancellation across HTTP connections. Signed scopes retain no idle
// session registry; only in-flight calls are stored, and scopes expire after a day.
const BROWSER_SESSION_MS = 24 * 60 * 60 * 1_000;
const browserSessionKey = randomBytes(32);
const browserRequests = new Map<string, Map<string | number, AbortController>>();

function browserSessionSignature(token: string, scope: string): Buffer {
  return createHmac("sha256", browserSessionKey).update(token).update("\0").update(scope).digest();
}

function agentsEnv(headers: IncomingHttpHeaders, token: string, harness: string): NodeJS.ProcessEnv {
  let settings: Record<string, unknown> = {};
  try {
    const raw = headers[AGENTS_ENV_HEADER];
    const parsed = typeof raw === "string" ? JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>;
  } catch {}
  const env: NodeJS.ProcessEnv = { OMB_HARNESS_URL: harness, OMB_COMMS_TOKEN: token };
  for (const key of AGENTS_MCP_ENV) if (typeof settings[key] === "string") env[key] = settings[key];
  return env;
}

export async function ownMcpHttpRoutes({ req, res, path, method, json, readBody }: RouteContext): ReturnType<RouteHandler> {
  if (!path.startsWith(OWN_MCP_HTTP_PATH)) return PASS;
  const name = path.slice(OWN_MCP_HTTP_PATH.length);
  const kind = name === "agents" ? "agents" : parseHarnessMcpKind(name);
  if (!kind) return json(res, 404, { error: "no such MCP server" });
  // JSON responses only. Browser initialization supplies the standard session scope
  // so cancellations on separate connections cannot collide with another client.
  if (method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (!token) return json(res, 401, { error: "unauthorized" });
  const lifecycle = kind === "browser" ? new AbortController() : undefined;
  const disconnected = () => { if (!res.writableFinished) lifecycle?.abort(); };
  if (lifecycle) {
    req.once("aborted", disconnected);
    res.once("close", disconnected);
    if (req.aborted || res.destroyed) lifecycle.abort();
  }
  try {
    const body = await readBody(req, MAX_INPUT_BYTES);
    const harness = `http://127.0.0.1:${req.socket.localPort}/`;
    const frames: Json[] = Array.isArray(body) ? body : [body];
    let session: string | undefined;
    if (kind === "browser") {
      const initializing = frames.some((frame) => frame && typeof frame === "object" && !Array.isArray(frame)
        && frame.jsonrpc === "2.0" && frame.method === "initialize"
        && (typeof frame.id === "string" || (typeof frame.id === "number" && Number.isFinite(frame.id))));
      const supplied = req.headers["mcp-session-id"];
      if (initializing) {
        const scope = `${randomBytes(32).toString("base64url")}.${Date.now() + BROWSER_SESSION_MS}`;
        session = `${scope}.${browserSessionSignature(token, scope).toString("base64url")}`;
        res.setHeader("Mcp-Session-Id", session);
      } else if (supplied !== undefined) {
        const match = typeof supplied === "string" ? /^([A-Za-z0-9_-]{43}\.(\d{13}))\.([A-Za-z0-9_-]{43})$/.exec(supplied) : null;
        if (!match || !timingSafeEqual(Buffer.from(match[3]!, "base64url"), browserSessionSignature(token, match[1]!))) {
          return json(res, 404, { error: "MCP session is invalid or expired. Initialize a new session." });
        }
        if (Number(match[2]) <= Date.now()) {
          const cancellingAccepted = frames.length > 0 && frames.every((frame) => {
            if (!frame || typeof frame !== "object" || Array.isArray(frame) || frame.jsonrpc !== "2.0" ||
                frame.method !== "notifications/cancelled" || Object.hasOwn(frame, "id")) return false;
            const params = frame.params;
            if (!params || typeof params !== "object" || Array.isArray(params) || !("requestId" in params)) return false;
            const id = params.requestId;
            return (typeof id === "string" || (typeof id === "number" && Number.isFinite(id))) &&
              browserRequests.get(match[0])?.has(id) === true;
          });
          if (!cancellingAccepted) return json(res, 404, { error: "MCP session is invalid or expired. Initialize a new session." });
        }
        session = match[0];
      }
    }
    const connection = kind === "agents" ? undefined
      : { url: harness, token, kind, toolLimit: parseToolLimit(req.headers[TOOL_LIMIT_HEADER]) };
    const answer: (frame: Json) => Promise<unknown> = kind === "agents"
      ? agentsMcp(agentsEnv(req.headers, token, harness.slice(0, -1)))
      : async (frame) => {
        if (kind !== "browser" || !lifecycle) return harnessMcpRequest(frame, connection!);
        const valid = frame && typeof frame === "object" && !Array.isArray(frame) && frame.jsonrpc === "2.0";
        if (valid && frame.method === "notifications/cancelled" && !Object.hasOwn(frame, "id")) {
          const params = frame.params;
          if (session && params && typeof params === "object" && !Array.isArray(params) && "requestId" in params) {
            const id = params.requestId;
            if (typeof id === "string" || (typeof id === "number" && Number.isFinite(id))) browserRequests.get(session)?.get(id)?.abort();
          }
          return undefined;
        }
        const id = frame?.id;
        const trackedId = valid && (frame.method === "tools/call" || frame.method === "tools/list")
          && (typeof id === "string" || (typeof id === "number" && Number.isFinite(id))) ? id : undefined;
        if (trackedId === undefined || !session) return harnessMcpRequest(frame, connection!, lifecycle.signal);
        let active = browserRequests.get(session);
        if (!active) {
          active = new Map();
          browserRequests.set(session, active);
        }
        if (active.has(trackedId)) return failure(trackedId, frame.method, "Request ID is already active.", -32600);
        const controller = new AbortController();
        active.set(trackedId, controller);
        try {
          return await harnessMcpRequest(frame, connection!, AbortSignal.any([lifecycle.signal, controller.signal]));
        } finally {
          if (active.get(trackedId) === controller) active.delete(trackedId);
          if (!active.size) browserRequests.delete(session);
        }
      };
    const replies = (await Promise.all(frames.map(async (frame) => {
      const reply = await answer(frame) as { result?: { protocolVersion?: unknown } } | undefined;
      // The version the client asked for: these servers answer the same way in every version.
      const asked = (frame?.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      if (frame?.method === "initialize" && typeof asked === "string" && reply?.result) reply.result.protocolVersion = asked;
      return reply;
    }))).filter((reply) => reply !== undefined);
    if (lifecycle?.signal.aborted) return;
    if (!replies.length) {
      res.writeHead(202);
      res.end();
      return;
    }
    json(res, 200, Array.isArray(body) ? replies : replies[0]);
  } finally {
    if (lifecycle) {
      req.off("aborted", disconnected);
      res.off("close", disconnected);
    }
  }
}

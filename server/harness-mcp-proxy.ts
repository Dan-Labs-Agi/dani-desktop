// Only a turn-scoped capability crosses into the agent process; engine commands, session names and provider credentials stay in OMB.
import { pathToFileURL } from "node:url";

import { failure, harnessMcpRequest, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, parseHarnessMcpKind, type HarnessMcpKind, type RpcId } from "./harness-mcp-request.ts";
import { harnessMcpTokenEnv } from "./harness-mcp-token.ts";
import { toolLimitFromEnv } from "./tool-count-limit.ts";

export { harnessMcpRequest } from "./harness-mcp-request.ts";

const MAX_PENDING = 16;

function run(kind: HarnessMcpKind): void {
  const connection = { url: process.env.OMB_HARNESS_URL ?? "", token: process.env[harnessMcpTokenEnv(kind)] ?? "", kind, toolLimit: toolLimitFromEnv() };
  let input = Buffer.alloc(0);
  let pending = 0;
  const active = new Map<RpcId, AbortController>();
  const outstanding = new Set<AbortController>();
  const abortAll = () => { if (kind === "browser") for (const controller of outstanding) controller.abort(); };
  const shutdown = (code: number) => {
    abortAll();
    process.stdin.destroy();
    process.exitCode = code;
  };
  if (kind === "browser") {
    process.stdin.once("end", abortAll);
    process.stdin.once("close", abortAll);
    process.once("SIGTERM", () => shutdown(143));
    process.once("SIGINT", () => shutdown(130));
    process.once("exit", abortAll);
  }
  const output = (message: unknown) => {
    if (message === undefined) return;
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_OUTPUT_BYTES || process.stdout.writableLength > MAX_OUTPUT_BYTES * 2) {
      shutdown(1);
      return;
    }
    process.stdout.write(line);
  };
  process.stdout.on("error", () => shutdown(1));
  process.stdin.on("data", (chunk: Buffer) => {
    input = Buffer.concat([input, chunk]);
    let newline: number;
    while ((newline = input.indexOf(10)) !== -1) {
      if (newline > MAX_INPUT_BYTES) { shutdown(1); return; }
      const line = input.subarray(0, newline).toString("utf8");
      input = input.subarray(newline + 1);
      if (!line.trim()) continue;
      let frame: unknown;
      try { frame = JSON.parse(line); }
      catch { output(failure(null, null, "Parse error.", -32700)); continue; }
      const request = frame && typeof frame === "object" && !Array.isArray(frame) ? frame as Record<string, unknown> : undefined;
      if (kind === "browser" && request?.jsonrpc === "2.0" && request.method === "notifications/cancelled" && !Object.hasOwn(request, "id")) {
        const params = request.params;
        if (params && typeof params === "object" && !Array.isArray(params) && "requestId" in params) {
          const id = params.requestId;
          if (typeof id === "string" || (typeof id === "number" && Number.isFinite(id))) active.get(id)?.abort();
        }
        continue;
      }
      if (pending >= MAX_PENDING) {
        if (request && Object.hasOwn(request, "id")) output(failure(typeof request.id === "string" || typeof request.id === "number" ? request.id : null, request.method, `Too many pending ${kind} requests.`));
        continue;
      }
      const id = request?.id;
      const trackedId = kind === "browser" && request?.jsonrpc === "2.0" && (typeof id === "string" || (typeof id === "number" && Number.isFinite(id))) ? id : undefined;
      if (trackedId !== undefined && active.has(trackedId)) {
        output(failure(trackedId, request?.method, "Request ID is already active.", -32600));
        continue;
      }
      const controller = kind === "browser" ? new AbortController() : undefined;
      if (trackedId !== undefined && controller) active.set(trackedId, controller);
      if (controller) outstanding.add(controller);
      pending++;
      void harnessMcpRequest(frame, connection, controller?.signal).then(output).finally(() => {
        pending--;
        if (controller) outstanding.delete(controller);
        if (trackedId !== undefined && active.get(trackedId) === controller) active.delete(trackedId);
      });
    }
    if (input.length > MAX_INPUT_BYTES) shutdown(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const kind = parseHarnessMcpKind(process.argv[2]);
  if (!kind) {
    process.stderr.write("usage: harness-mcp-proxy browser|computer|data|highlevel|device\n");
    process.exitCode = 2;
  } else run(kind);
}

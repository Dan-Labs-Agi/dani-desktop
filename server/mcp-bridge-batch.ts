import type { ToolCall } from "./mcp-bridge.ts";

type Result = Record<string, unknown>;

/** A tool that is several calls in one frame. The bridge makes each of them as the agent's own call, through the same
 * gate, journal and checks, so a batch can do nothing a run of single calls could not. */
export interface BatchSpec {
  name: string;
  plan(args: Record<string, unknown>): { calls: ToolCall[] } | { error: string };
  /** Why the batch stops after this call, or null to go on. */
  stopAfter(call: ToolCall, result: Result): string | null;
  answer(done: ReadonlyArray<{ call: ToolCall; result: Result }>, planned: number, stopped: string | null): Result;
}

export interface BatchRequest { id: string | number; args: Record<string, unknown>; meta: unknown }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const OWN_ID = "omb-batch-";

export function createBatches(
  spec: BatchSpec | undefined,
  io: {
    /** The path an agent's own line takes: renamed, journalled, gated, forwarded. Resolves once the call is on its way. */
    feed(line: string): void | Promise<void>;
    reply(line: string): void;
  },
) {
  const waiting = new Map<string, (result: Result) => void>();
  let sequence = 0;

  async function run(request: BatchRequest): Promise<void> {
    const planned = spec!.plan(request.args);
    const finish = (result: Result) => io.reply(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    if ("error" in planned) return finish({ isError: true, content: [{ type: "text", text: planned.error }] });
    const done: Array<{ call: ToolCall; result: Result }> = [];
    let stopped: string | null = null;
    try {
      for (const call of planned.calls) {
        const id = `${OWN_ID}${++sequence}`;
        const answered = new Promise<Result>((resolve) => waiting.set(id, resolve));
        await io.feed(JSON.stringify({
          jsonrpc: "2.0", id, method: "tools/call",
          params: { name: call.name, arguments: call.arguments, ...(request.meta === undefined ? {} : { _meta: request.meta }) },
        }));
        const result = await answered;
        done.push({ call, result });
        stopped = spec!.stopAfter(call, result);
        if (stopped !== null) break;
      }
    } catch (error) {
      // The agent waits on this id: it is answered, with what was done, even when the batch itself broke.
      stopped = `the batch itself failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    finish(spec!.answer(done, planned.calls.length, stopped));
  }

  return {
    /** The batch an agent's line asks for, or null for any other line. */
    parse(line: string): BatchRequest | null {
      if (!spec || !line.includes(spec.name)) return null;
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { return null; }
      if (!isObject(frame) || frame.method !== "tools/call" || (typeof frame.id !== "string" && typeof frame.id !== "number")) return null;
      const params = frame.params;
      if (!isObject(params) || params.name !== spec.name) return null;
      return { id: frame.id, args: isObject(params.arguments) ? params.arguments : {}, meta: params._meta };
    },
    run,
    /** An answer to a call of a batch is the batch's, not the agent's. */
    take(written: string): boolean {
      if (waiting.size === 0 || !written.includes(OWN_ID)) return false;
      let frame: unknown;
      try { frame = JSON.parse(written); } catch { return false; }
      if (!isObject(frame) || typeof frame.id !== "string") return false;
      const resolve = waiting.get(frame.id);
      if (!resolve) return false;
      waiting.delete(frame.id);
      resolve(isObject(frame.result) ? frame.result : { isError: true, content: [{ type: "text", text: "The call returned no result." }] });
      return true;
    },
  };
}

import type { ToolCall } from "./mcp-bridge.ts";

/** A tool the agent is shown that is another of the driver's. Its request is renamed before the gate, the journal and the
 * checks see it, so each treats it as the driver's own call (a recorded turn still saves); only its answer is reshaped. */
export interface ToolAlias {
  name: string;
  request(call: ToolCall): ToolCall;
  answer(result: Record<string, unknown>): Record<string, unknown>;
}

type Frame = { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown }; result?: unknown };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string | number => typeof value === "string" || typeof value === "number";

function parse(line: string): Frame | null {
  try {
    const frame: unknown = JSON.parse(line);
    return isObject(frame) ? frame as Frame : null;
  } catch {
    return null;
  }
}

export function createAliases(alias: ToolAlias | undefined) {
  const pending = new Set<string | number>();
  return {
    /** The line the rest of the bridge sees. */
    request(line: string): string {
      if (!alias || !line.includes(alias.name)) return line;
      const frame = parse(line);
      const params = frame?.params;
      if (!frame || frame.method !== "tools/call" || !isId(frame.id) || !isObject(params) || params.name !== alias.name) return line;
      const call = alias.request({ name: alias.name, arguments: isObject(params.arguments) ? params.arguments : {} });
      pending.add(frame.id);
      return JSON.stringify({ ...frame, params: { ...params, name: call.name, arguments: call.arguments } });
    },
    /** The line the agent is given. */
    answer(line: string): string {
      if (!alias || pending.size === 0) return line;
      const frame = parse(line);
      if (!frame || frame.method !== undefined || !isId(frame.id) || !pending.delete(frame.id) || !isObject(frame.result)) return line;
      return JSON.stringify({ ...frame, result: alias.answer(frame.result) });
    },
  };
}

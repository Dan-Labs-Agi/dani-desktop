import type { ToolCall } from "../../server/mcp-bridge.ts";
import { type ComputerSession, windowKey } from "../session.ts";

export function staleRefusal(call: ToolCall, session: ComputerSession): Record<string, unknown> | null {
  const key = windowKey(call.arguments);
  if (!key || !session.staleWindows.has(key) || typeof call.arguments.element_token === "string") return null;
  const indexed = typeof call.arguments.element_index === "number";
  const pointed = typeof call.arguments.x === "number" && typeof call.arguments.y === "number";
  if (!indexed && !pointed) return null;
  return {
    isError: true,
    content: [{ type: "text", text: "The window changed since this target was chosen. Read it again with get_window_state, then choose the target shown now." }],
  };
}

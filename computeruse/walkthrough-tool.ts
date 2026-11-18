import type { ChildCalls, ToolCall } from "../server/mcp-bridge.ts";
import { observationOf } from "./effect.ts";
import { watchWalkthroughScreen } from "./walkthrough-watch.ts";

export const WALKTHROUGH_TOOL = {
  name: "wait_for_window_change",
  description: "Wait briefly for this window to change and settle while the person follows a step. A change does not prove the step succeeded. Read the window again and verify before continuing. This detects accessibility-tree changes, not all visual changes.",
  inputSchema: {
    type: "object",
    properties: {
      pid: { type: "integer", minimum: 1 },
      window_id: { type: "integer", minimum: 0 },
      timeout_ms: { type: "integer", minimum: 500, maximum: 5000 },
    },
    required: ["pid", "window_id"],
    additionalProperties: false,
  },
};

export async function waitForWindowChange(call: ToolCall, child: ChildCalls): Promise<Record<string, unknown>> {
  const { pid, window_id, timeout_ms } = call.arguments;
  if (!Number.isSafeInteger(pid) || (pid as number) < 1 || !Number.isSafeInteger(window_id) || (window_id as number) < 0 ||
      (timeout_ms !== undefined && (!Number.isSafeInteger(timeout_ms) || (timeout_ms as number) < 500 || (timeout_ms as number) > 5000))) {
    return { isError: true, content: [{ type: "text", text: "Provide a valid pid, window_id and timeout_ms between 500 and 5000." }] };
  }
  const status = await watchWalkthroughScreen({
    timeoutMs: (timeout_ms as number | undefined) ?? 5000,
    intervalMs: 500,
    changeThreshold: 0.001,
    settleThreshold: 0,
    capture: async () => {
      const result = await child.call("get_window_state", { pid, window_id, include_screenshot: false });
      const observation = observationOf(result);
      return observation ? Uint8Array.from(Buffer.from(observation.fingerprint, "hex")) : null;
    },
  });
  const messages = {
    changed: "The window changed and settled. Read it again and verify the person's step before continuing; a change does not prove success.",
    timeout: "No settled accessibility-tree change was observed. This does not mean the person did nothing; ask or read the window again.",
    cancelled: "The observation was cancelled.",
    unavailable: "The window could not be observed. Ask the person or read it again before continuing.",
  };
  return { content: [{ type: "text", text: messages[status] }], structuredContent: { status } };
}

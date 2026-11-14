import type { ChildCalls, ToolCall } from "../../server/mcp-bridge.ts";
import { elementPath, slimResponse, type SlimStructured } from "../../server/saved-steps/driver-wire.ts";
import { matchElement } from "../../server/saved-steps/resolve.ts";

export async function anchorSuggestion(call: ToolCall, snapshot: SlimStructured | undefined, child: ChildCalls): Promise<string> {
  const oldElements = snapshot?.elements;
  const oldIndex = call.arguments.element_index;
  if (!snapshot?.elements_complete || !oldElements || typeof oldIndex !== "number") return "Read the window to find the target again.";
  const old = oldElements.find((element) => element.element_index === oldIndex);
  const path = old && elementPath(oldElements, old);
  if (!old || !path || typeof old.label !== "string") return "Read the window to find the target again.";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), 4_000);
    timer.unref?.();
  });
  const current = await Promise.race([
    child.call("get_window_state", { pid: call.arguments.pid, window_id: call.arguments.window_id, include_screenshot: false })
      .catch(() => null),
    timeout,
  ]).finally(() => clearTimeout(timer));
  const fresh = current ? slimResponse({ result: current }).structured : undefined;
  if (!fresh?.elements_complete) return "The window could not be read completely; read it again before acting.";
  const match = matchElement(fresh.elements, { role: old.role, label: old.label, path });
  if (!match.ok) return match.reason === "ambiguous"
    ? "More than one matching target is visible. Read the window and choose one."
    : "The previous target is gone. Read the window and choose what is there now.";
  return `The target is now at element_index ${match.value.element_index}` +
    (match.value.element_token ? ` with element_token ${match.value.element_token}.` : ".") +
    " Read the window and issue a new call if this is still the right target.";
}

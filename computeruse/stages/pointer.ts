import type { ChildCalls } from "../../server/mcp-bridge.ts";
import { bounded, READ_TIMEOUT_MS } from "../read.ts";

/** Long enough for the person to see where an action is headed and take control, short enough not to slow a task. */
export const POINTER_GLIDE_MS = 400;
export const POINTER_DWELL_MS = 300;

/** Shows the driver's own cursor gliding to each target; true when the driver agreed. A pointer is for the person's
 * eyes only, so a driver that has none, or does not answer, costs the task nothing. */
export async function enablePointer(child: ChildCalls, timeoutMs = READ_TIMEOUT_MS): Promise<boolean> {
  const call = (name: string, args: Record<string, unknown>) =>
    bounded(Promise.resolve().then(() => child.call(name, args)), timeoutMs);
  const enabled = await call("set_agent_cursor_enabled", { enabled: true });
  if (!enabled || enabled.isError === true) return false;
  await call("set_agent_cursor_motion", { glide_duration_ms: POINTER_GLIDE_MS, dwell_after_click_ms: POINTER_DWELL_MS });
  return true;
}

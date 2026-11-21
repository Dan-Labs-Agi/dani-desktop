import type { ChildCalls } from "../server/mcp-bridge.ts";

/** A read the bridge makes for itself after an action has gone out: past this it is given up, never waited for. */
export const READ_TIMEOUT_MS = 4_000;

/** What the work answers, or null when it throws or has not answered in time. */
export async function bounded<T>(work: Promise<T>, timeoutMs = READ_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, expired]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The window's structure without a screenshot, or null when the call names no window or the driver does not answer. */
export function readWindow(child: ChildCalls, args: Record<string, unknown>, timeoutMs = READ_TIMEOUT_MS): Promise<Record<string, unknown> | null> {
  const { pid, window_id } = args;
  if (typeof pid !== "number" || typeof window_id !== "number") return Promise.resolve(null);
  return bounded(Promise.resolve().then(() => child.call("get_window_state", { pid, window_id, include_screenshot: false })), timeoutMs);
}

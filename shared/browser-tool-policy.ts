const OBSERVATIONS: Record<string, true> = {
  agent_browser_tools_profiles: true,
  agent_browser_status: true,
  agent_browser_read: true,
  agent_browser_snapshot: true,
  agent_browser_screenshot: true,
  agent_browser_get_text: true,
  agent_browser_get_url: true,
  agent_browser_get_title: true,
  agent_browser_tab_list: true,
  agent_browser_wait_ms: true,
  agent_browser_wait_for_selector: true,
  agent_browser_wait_for_text: true,
  agent_browser_wait_for_load: true,
};

/** URL-bearing reads navigate; they do not carry observation-only authority. */
export function isBrowserObservation(name: unknown, args: unknown): boolean {
  if (name === "agent_browser_wait") return true;
  if (name === "agent_browser_tabs") {
    return args !== null && typeof args === "object" && !Array.isArray(args) && "action" in args && args.action === "list";
  }
  if (typeof name !== "string" || !Object.hasOwn(OBSERVATIONS, name)) return false;
  return name !== "agent_browser_read" || args === null || typeof args !== "object" || !("url" in args) || args.url === undefined;
}

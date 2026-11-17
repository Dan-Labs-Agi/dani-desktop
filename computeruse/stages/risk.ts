import { createHash } from "node:crypto";
import type { ToolCall } from "../../server/mcp-bridge.ts";
import { elementPath, type SlimStructured, type WireElement } from "../../server/saved-steps/driver-wire.ts";
import { type ActionTool, pressesReturn, unsafeStep } from "../../server/saved-steps/rules.ts";
import { namesFinalAction } from "../../server/saved-steps/screen-words.ts";
import { cleanTargetLabel, FINAL_ACTION_VERBS, finalActionQuery, type FinalActionCall } from "../../shared/computer-final-action.ts";
import { type ComputerSession, windowKey } from "../session.ts";

type Args = Record<string, unknown>;

/** Left out of a call's fingerprint: they name where a target sat in one read of the window, and change with the next. */
const ADDRESSING = new Set(["pid", "window_id", "element_token", "element_index", "session"]);

function withoutAddressing(args: Args): Args {
  return Object.fromEntries(Object.entries(args).filter(([name]) => !ADDRESSING.has(name)).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function showsFinalAction(snapshot: SlimStructured): boolean {
  return namesFinalAction(snapshot.window_title) || (snapshot.elements ?? []).some((element) => namesFinalAction(element.label));
}

function locate(args: Args, snapshot: SlimStructured | undefined): WireElement | undefined {
  const token = typeof args.element_token === "string" ? args.element_token : undefined;
  const index = typeof args.element_index === "number" ? args.element_index : undefined;
  if (token === undefined && index === undefined) return undefined;
  return snapshot?.elements?.find((element) => (token !== undefined ? element.element_token === token : element.element_index === index));
}

/** Whether this call might press something that cannot be undone, judged from the bridge's own last read of the window.
 * A target it cannot identify, in a window that shows a final action or one it never read, counts: doubt asks. */
export function finalActionRisk(call: ToolCall, session: ComputerSession): FinalActionCall | null {
  if (!Object.hasOwn(FINAL_ACTION_VERBS, call.name)) return null;
  const key = windowKey(call.arguments);
  const snapshot = key ? session.snapshots.get(key) : undefined;
  const found = locate(call.arguments, snapshot);
  const args = withoutAddressing(call.arguments);
  const identity = found?.label && snapshot?.elements
    ? { role: found.role, label: found.label, path: elementPath(snapshot.elements, found) ?? [] }
    : undefined;
  const window = snapshot?.window_title !== undefined ? { title: snapshot.window_title } : undefined;
  const tool = call.name as ActionTool;

  const named = unsafeStep({ tool, args, ...(window ? { window } : {}), ...(identity ? { element: identity } : {}) }) === "final-action";
  const addressed = call.arguments.element_token !== undefined || call.arguments.element_index !== undefined;
  const pointed = typeof call.arguments.x === "number" && typeof call.arguments.y === "number";
  const doubtful = ((addressed && !identity) || pointed) && (!snapshot || showsFinalAction(snapshot));
  // Return presses a window's default button: it is safe only in a window read whole that shows no final action.
  const returning = pressesReturn(tool, args) && !(snapshot?.elements_complete === true && !showsFinalAction(snapshot));
  if (!named && !doubtful && !returning) return null;

  const hash = createHash("sha256")
    .update(JSON.stringify([call.name, args, snapshot?.app_name ?? null, window?.title ?? null, identity ?? null]))
    .digest("hex")
    .slice(0, 32);
  const label = cleanTargetLabel(identity?.label);
  return { tool: call.name, hash, ...(label ? { label } : {}) };
}

export function riskQuery(risk: FinalActionCall): Record<string, string> {
  return finalActionQuery(risk);
}

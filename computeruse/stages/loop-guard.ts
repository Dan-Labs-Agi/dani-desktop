import { createHash } from "node:crypto";
import type { ToolCall } from "../../server/mcp-bridge.ts";
import type { EffectVerdict, Observation } from "../effect.ts";
import { type ComputerSession, windowKey } from "../session.ts";

const ACTION_LIMIT = 100;

function actionIdentity(call: ToolCall, before: Observation | null): string {
  const digest = createHash("sha256");
  digest.update(JSON.stringify([call.name, call.arguments, windowKey(call.arguments), before?.fingerprint ?? null]));
  return digest.digest("hex");
}

export function loopRefusal(call: ToolCall, session: ComputerSession): Record<string, unknown> | null {
  const text = session.actions >= ACTION_LIMIT
    ? "This computer turn has reached its action limit. Stop and tell the person what is done so far."
    : session.lastUnchanged === actionIdentity(call, session.lastWindow.get(windowKey(call.arguments) ?? "") ?? null)
      && session.unchangedCount >= 2
      ? "The same action left the window unchanged twice. Read the window and choose another way, or ask the person for help."
      : null;
  return text ? { isError: true, content: [{ type: "text", text }] } : null;
}

export function recordAction(call: ToolCall, session: ComputerSession, before: Observation | null, verdict: EffectVerdict): void {
  if (verdict !== "unchanged") {
    session.lastUnchanged = null;
    session.unchangedCount = 0;
    return;
  }
  const identity = actionIdentity(call, before);
  session.unchangedCount = session.lastUnchanged === identity ? session.unchangedCount + 1 : 1;
  session.lastUnchanged = identity;
}

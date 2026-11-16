export const TASK_ROUND_LIMIT = 64;
export const TASK_TOOL_CALL_LIMIT = 200;
export const OBSERVATION_RECOVERY_LIMIT = 3;

export const CONTINUE_UNFINISHED_ACTION =
  "You ended a response while the original task is still unfinished. Continue only the remaining work in this same session, using the results already obtained. Use tools to make and verify progress, or state a concrete blocker when you cannot proceed. Never repeat an operation that succeeded, was denied, or may already have taken effect; inspect its state instead. Do not retry a destructive operation or bypass a permission refusal. Do not stop at an intermediate plan or announcement; finish with verified results or the specific blocker.";

export const RECOVER_FAILED_OBSERVATION =
  "A read-only observation failed before the task was finished. Keep the original goal and continue in this same session. Re-read current state, wait for the required state, or use a corrected read-only observation. Do not repeat a successful or uncertain write, submit, payment, message, upload, or destructive operation. Preserve refusals and Stop. Verify the remaining result; report a concrete blocker only when recovery cannot proceed safely.";

export function asksForInput(text: string): boolean {
  const reply = text.trim();
  return /(?:^|\n|[.!]\s+)(?:(?:what|which|where|who|when|how)\b|(?:can|could|would|will|do|did)\s+you\b|(?:should|shall|can|may)\s+I\b|is (?:that|this) (?:okay|ok)\b)[^?\n]*\?\s*$/i.test(reply)
    || /(?:^|\n)(?:please (?:provide|choose|confirm|sign in|log in)|I need (?:your|you to))\b[^\n]*$/i.test(reply);
}

export function announcesAction(text: string): boolean {
  const reply = text.trim();
  if (!reply || reply.length > 4_000 || asksForInput(reply)) return false;
  if (reply.length > 400) {
    const tail = reply.split(/\n\s*\n/).at(-1)!.trim();
    return tail.length <= 400 && /^(?:let me|i['\u2019]ll|i will|i(?:['\u2019]m| am) going to)\s+(?:now\s+)?(?:execute|send|type|press|launch|open|check|inspect|read|fetch|run|create|write|verify)\b/i.test(tail);
  }
  return /(?:[:\u2014\u2013]|\.\.\.|\u2026)$/.test(reply) ||
    /^(?:checking|let me(?! know\b)|i'll|i will|i'm going to|i am going to|opening|pulling|looking|searching|navigating|reading|fetching|loading|now (?:i'll|let me|opening|checking|pulling|reading))\b/i.test(reply) ||
    /^i(?:['\u2019]m| am)\b[^.!?\n]*\band (?:i )?will\s+(?:launch|open|check|pull|look|search|navigate|read|fetch|load|run|inspect)\b/i.test(reply);
}

export type ContinuationDecision = "continue" | "stalled" | "limit";

export class TaskContinuation {
  private lastProgress = -1;
  private observationRetries = 0;

  next(progress: number, round: number, toolCalls = progress, recovery?: "observation"): ContinuationDecision {
    if (round >= TASK_ROUND_LIMIT - 1 || toolCalls >= TASK_TOOL_CALL_LIMIT) return "limit";
    if (progress > this.lastProgress) this.observationRetries = 0;
    else if (!recovery) return "stalled";
    if (recovery) {
      if (this.observationRetries >= OBSERVATION_RECOVERY_LIMIT) return "stalled";
      this.observationRetries += 1;
    }
    this.lastProgress = progress;
    return "continue";
  }
}

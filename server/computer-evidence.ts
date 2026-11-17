import { type ComputerCounters, summarizeCounters } from "../computeruse/counters.ts";
import { COMPUTER_EVIDENCE_PATH, parseEvidence } from "../computeruse/evidence.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { hostScope, type JournalCapability, type JournalScope } from "./saved-steps/journal.ts";

const KEPT_TURNS = 200;

/** What a computer session did, kept until its turn lets go of the computer and then said once in the transcript.
 * The bridge's body is untrusted: the line is written here from the numbers that survive parsing, never from its words. */
export function createComputerEvidence(options: {
  enabled(): boolean;
  append(threadId: string, text: string): void;
  limit?: number;
}) {
  const limit = options.limit ?? KEPT_TURNS;
  const totals = new Map<string, ComputerCounters>();
  const keyOf = (threadId: string, generation: string) => `${threadId}\u0000${generation}`;

  const record = (scope: JournalScope, counters: ComputerCounters): void => {
    const key = keyOf(scope.threadId, scope.generation);
    totals.delete(key);
    totals.set(key, counters);
    // A turn that never released its computer leaves its totals here: the oldest go first.
    while (totals.size > limit) totals.delete(totals.keys().next().value!);
  };

  return {
    record,
    /** Writes the line for a finished turn, if it did or was refused anything, and forgets its totals. */
    flush(owner: { threadId: string; generation: string }): void {
      const key = keyOf(owner.threadId, owner.generation);
      const counters = totals.get(key);
      if (!counters) return;
      totals.delete(key);
      const line = summarizeCounters(counters);
      if (line) options.append(owner.threadId, line);
    },
    routes(internal: { capability: JournalCapability; readBody(): Promise<unknown> }): RouteHandler {
      // Known open risk: the bearer reaches the engine with the bridge's environment, so an engine that reads it can post
      // its own totals. They only ever make one line about its own turn, and the line states counts, not outcomes.
      return async ({ res, path, method, json }) => {
        if (path !== COMPUTER_EVIDENCE_PATH || method !== "POST") return PASS;
        const scope = hostScope(internal.capability);
        if (!scope) return json(res, 403, { error: "only a host computer turn reports evidence" });
        if (!options.enabled()) return json(res, 200, { ok: true, recorded: false });
        const counters = parseEvidence(await internal.readBody());
        if (!counters) return json(res, 400, { error: "malformed computer evidence" });
        record(scope, counters);
        return json(res, 200, { ok: true });
      };
    },
  };
}

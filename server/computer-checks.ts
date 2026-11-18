// The server's side of the computer-use checks: the question before a final action and the line about what a session did.
// Server/index.ts holds one of these and calls it; each part is off unless its switch is set in config.json.
import type { FinalActionCall } from "../shared/computer-final-action.ts";
import type { ComputerFeatureFlags } from "../computeruse/features.ts";
import type { ComputerCounters } from "../computeruse/counters.ts";
import { createComputerEvidence } from "./computer-evidence.ts";
import type { ControlState } from "./control-client.ts";
import type { DecisionRow } from "./decision-log.ts";
import { createFinalActionConsent, gateFinalAction } from "./final-action-consent.ts";
import type { Notification } from "./notify.ts";
import type { JournalScope } from "./saved-steps/journal.ts";
import type { Store } from "./store.ts";

export function createComputerChecks(deps: {
  store: Pick<Store, "appendMessage" | "groupByThread" | "messagesFor" | "patchMessage" | "projectBotForTask" | "setTaskActivity" | "bot">;
  notify?: (notification: Notification | null) => void;
  audit: (row: Omit<DecisionRow, "at">) => void;
  features: () => ComputerFeatureFlags | undefined;
  cards?: () => Array<{ threadId: string; messageId: string }>;
}) {
  const finalAction = createFinalActionConsent({ store: deps.store, notify: deps.notify, audit: deps.audit, ...(deps.cards ? { cards: deps.cards } : {}) });
  const evidence = createComputerEvidence({
    enabled: () => deps.features()?.reportComputerEvidence === true,
    append: (threadId, text) => { deps.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: text, ok: true } }); },
  });
  return {
    routes: evidence.routes,
    recordEvidence: (scope: JournalScope, counters: ComputerCounters) => evidence.record(scope, counters),
    /** The control answer for a call the bridge says would be final, or null when nothing holds it back. */
    holdFinalAction(input: { owner: { threadId: string; generation: string }; botId: string; call?: FinalActionCall | undefined; helpOpen: boolean; waitMs: number; signal?: AbortSignal }): Promise<ControlState | null> {
      if (!input.call || deps.features()?.confirmComputerFinalActions !== true) return Promise.resolve(null);
      return gateFinalAction(finalAction, { owner: input.owner, bot: deps.store.bot(input.botId) ?? undefined, call: input.call, helpOpen: input.helpOpen, waitMs: input.waitMs, signal: input.signal });
    },
    /** True when it settled one of the cards these checks raised. */
    resolve: (requestId: string, behavior: string | undefined) => finalAction.resolve(requestId, behavior),
    cancel: (threadId: string, generation?: string) => finalAction.cancel(threadId, generation),
    dismissStale: () => finalAction.dismissStale(),
    /** A turn lets go of the computer: its open question closes and what it did is said once. */
    release(owner: { threadId: string; generation: string }): void {
      finalAction.cancel(owner.threadId, owner.generation);
      evidence.flush(owner);
    },
  };
}

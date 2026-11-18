// Asking before a bot presses something on the person's own computer that cannot be undone (send, pay, delete, post).
// "Just do it" covers what a bot does in its own places, never a final action on the person's screen. An approval is for
// the exact call it was asked about, for that turn only, once, and for a few minutes; a refusal holds for the turn.
// Asks live in memory: a card a previous run left open can never be answered, so it is closed at startup.
import { FINAL_ACTION_TOOL, cleanTargetLabel, isFinalActionTool, type FinalActionCall, type FinalActionTool } from "../shared/computer-final-action.ts";
import type { ControlState } from "./control-client.ts";
import { newId } from "./contracts.ts";
import type { DecisionRow } from "./decision-log.ts";
import { optionCardsForTools } from "./message-db.ts";
import { buildNotification, type Notification } from "./notify.ts";
import { conversationLanguage, serverLine, type ServerLineKey } from "./server-lines.ts";
import type { BotRecord, Store } from "./store.ts";

export const FINAL_ACTION_WAITING =
  "Dani Bot is asking the person whether you may do this, and they have not answered yet, so this call was NOT performed and nothing happened on their screen. " +
  "Do not ask them again in chat: the question is already on their screen. Wait with get_window_state, or end your turn and tell them what is waiting.";
export const FINAL_ACTION_DECLINED =
  "The person said no to this, so it was NOT done. Do not try it again this turn, by this call or another way. Finish without it and tell them what you did not do.";
export const FINAL_ACTION_ALLOWED =
  "The person said yes to this one action. This call was NOT performed, because it waited for their answer: call it again now and it goes through once.";

const APPROVAL_TTL_MS = 5 * 60_000;

type State = "pending" | "allowed" | "denied";

interface Entry {
  state: State;
  at: number;
  threadId: string;
  generation: string;
  botId?: string;
  botName?: string;
  messageId: string;
  requestId: string;
  summary: string;
  settled: Promise<void>;
  settle: () => void;
}

type ConsentStore = Pick<Store, "appendMessage" | "groupByThread" | "messagesFor" | "patchMessage" | "projectBotForTask" | "setTaskActivity">;

export type FinalActionDecision = { pass: true } | { pass: false; text: string };

/** The tool and the label the page gave it when that is fit to show: what a decision log row says, with no prose of its own. */
function summaryOf(call: FinalActionCall): string {
  const label = cleanTargetLabel(call.label);
  return label ? `${call.tool}: ${label}` : call.tool;
}

const VERB_LINES = {
  click: { labelled: "server.finalAction.verb.click.labelled", plain: "server.finalAction.verb.click.plain" },
  double_click: { labelled: "server.finalAction.verb.double_click.labelled", plain: "server.finalAction.verb.double_click.plain" },
  right_click: { labelled: "server.finalAction.verb.right_click.labelled", plain: "server.finalAction.verb.right_click.plain" },
  press_key: { labelled: "server.finalAction.verb.press_key.labelled", plain: "server.finalAction.verb.press_key.plain" },
  hotkey: { labelled: "server.finalAction.verb.hotkey.labelled", plain: "server.finalAction.verb.hotkey.plain" },
  set_value: { labelled: "server.finalAction.verb.set_value.labelled", plain: "server.finalAction.verb.set_value.plain" },
  launch_app: { labelled: "server.finalAction.verb.launch_app.labelled", plain: "server.finalAction.verb.launch_app.plain" },
} as const satisfies Record<FinalActionTool, Record<"labelled" | "plain", ServerLineKey>>;

/** The question for this call, in the language of the conversation it is asked in. */
function questionOf(threadId: string, call: FinalActionCall, name: string): { title: string; detail: string } {
  const language = conversationLanguage(threadId);
  const label = cleanTargetLabel(call.label);
  const tool = isFinalActionTool(call.tool) ? call.tool : "click";
  const verb = serverLine(language, VERB_LINES[tool][label ? "labelled" : "plain"]);
  return {
    title: label ? serverLine(language, "server.finalAction.titleLabelled", { verb, label }) : serverLine(language, "server.finalAction.titlePlain", { verb }),
    detail: serverLine(language, "server.finalAction.detail", { name }),
  };
}

export function createFinalActionConsent(deps: {
  store: ConsentStore;
  notify?: (notification: Notification | null) => void;
  audit: (row: Omit<DecisionRow, "at">) => void;
  now?: () => number;
  ttlMs?: number;
  cards?: () => Array<{ threadId: string; messageId: string }>;
}) {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? APPROVAL_TTL_MS;
  const entries = new Map<string, Entry>();
  const byRequest = new Map<string, Entry>();
  const keyOf = (owner: { threadId: string; generation: string }, call: FinalActionCall) =>
    `${owner.threadId}\u0000${owner.generation}\u0000${call.hash}`;

  const remove = (key: string, entry: Entry) => {
    entries.delete(key);
    byRequest.delete(entry.requestId);
  };

  const closeCard = (entry: Entry, answer: "allow" | "deny", dismissed: boolean) => {
    const card = deps.store.messagesFor(entry.threadId).find((message) => message.id === entry.messageId)?.card;
    if (card && !card.answered) deps.store.patchMessage(entry.threadId, entry.messageId, { card: { ...card, answered: answer, dismissed } });
    const task = entry.botId ? deps.store.projectBotForTask(entry.botId, entry.threadId) : null;
    if (task?.activity === "waiting-on-you") deps.store.setTaskActivity(task.id, entry.threadId, "working");
  };

  const open = (owner: { threadId: string; generation: string }, bot: Pick<BotRecord, "id" | "name" | "color" | "avatarUrl" | "notifications"> | undefined, call: FinalActionCall): Entry => {
    const question = questionOf(owner.threadId, call, bot?.name ?? serverLine(conversationLanguage(owner.threadId), "server.finalAction.unnamedBot"));
    const room = deps.store.groupByThread(owner.threadId);
    const requestId = newId();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    // The card exists before the entry, so an answer or a cancellation can always settle it.
    const message = deps.store.appendMessage(owner.threadId, {
      role: "bot",
      kind: "options",
      ...(room && bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
      card: {
        title: question.title,
        subtitle: question.detail,
        options: ["Allow once", "Deny"],
        requestId,
        requestType: "permission",
        tool: FINAL_ACTION_TOOL,
      },
    });
    const entry: Entry = {
      state: "pending", at: now(), threadId: owner.threadId, generation: owner.generation, botId: bot?.id, botName: bot?.name,
      messageId: message.id, requestId, summary: summaryOf(call), settled, settle,
    };
    entries.set(keyOf(owner, call), entry);
    byRequest.set(requestId, entry);
    if (bot) {
      const task = deps.store.projectBotForTask(bot.id, owner.threadId);
      if (task?.busy) deps.store.setTaskActivity(bot.id, owner.threadId, "waiting-on-you");
      deps.notify?.(buildNotification("approval", bot, owner.threadId, question.title, {
        avatarUrl: bot.avatarUrl, ...(room && !room.dm ? { group: { id: room.id, name: room.name } } : {}),
      }));
    }
    deps.audit({ threadId: owner.threadId, requestId, botId: bot?.id, botName: bot?.name, tool: FINAL_ACTION_TOOL, summary: entry.summary, decision: "card-shown", source: "question" });
    return entry;
  };

  return {
    /** Whether this exact call may go ahead now. A call that waits through the person's answer is never performed late:
     * it is told to call again, and that second call is the one an approval is used for. */
    async check(
      owner: { threadId: string; generation: string },
      bot: Pick<BotRecord, "id" | "name" | "color" | "avatarUrl" | "notifications"> | undefined,
      call: FinalActionCall,
      options: { waitMs: number; signal?: AbortSignal },
    ): Promise<FinalActionDecision> {
      const key = keyOf(owner, call);
      let entry = entries.get(key);
      if (entry?.state === "allowed") {
        const fresh = now() - entry.at <= ttlMs;
        remove(key, entry);
        if (fresh) return { pass: true };
        entry = undefined;
      }
      if (entry?.state === "denied") return { pass: false, text: FINAL_ACTION_DECLINED };
      entry ??= open(owner, bot, call);
      if (entry.state === "pending") await within(entry.settled, options.waitMs, options.signal);
      if (entry.state === "allowed") return { pass: false, text: FINAL_ACTION_ALLOWED };
      if (entry.state === "denied") return { pass: false, text: FINAL_ACTION_DECLINED };
      return { pass: false, text: FINAL_ACTION_WAITING };
    },

    /** True when it settled one of these asks; call before handing an answer to the engine. */
    resolve(requestId: string, behavior: string | undefined): boolean {
      const entry = byRequest.get(requestId);
      if (!entry || entry.state !== "pending") return false;
      const allowed = behavior === "allow";
      entry.state = allowed ? "allowed" : "denied";
      entry.at = now();
      byRequest.delete(requestId);
      closeCard(entry, allowed ? "allow" : "deny", false);
      deps.audit({ threadId: entry.threadId, requestId, botId: entry.botId, botName: entry.botName, tool: FINAL_ACTION_TOOL, summary: entry.summary, decision: allowed ? "user-approved" : "user-denied", source: "user" });
      entry.settle();
      return true;
    },

    /** Closes what a request left open: every ask in the thread, or only its own generation's. */
    cancel(threadId: string, generation?: string): void {
      for (const [key, entry] of entries) {
        if (entry.threadId !== threadId || (generation !== undefined && entry.generation !== generation)) continue;
        if (entry.state === "pending") closeCard(entry, "deny", true);
        remove(key, entry);
        entry.settle();
      }
    },

    /** Asks live in memory only: a card a previous run left open can never be answered, so it is closed at startup. */
    dismissStale(): number {
      let dismissed = 0;
      for (const { threadId, messageId } of (deps.cards ?? (() => optionCardsForTools([FINAL_ACTION_TOOL])))()) {
        const card = deps.store.messagesFor(threadId).find((message) => message.id === messageId)?.card;
        if (!card?.requestId || card.answered || card.dismissed || byRequest.has(card.requestId)) continue;
        if (deps.store.patchMessage(threadId, messageId, { card: { ...card, answered: "deny", dismissed: true } })) dismissed += 1;
      }
      return dismissed;
    },
  };
}

function within(settled: Promise<void>, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, Math.max(0, ms));
    timer.unref?.();
    signal?.addEventListener("abort", done, { once: true });
    void settled.then(done);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

/** The control broker's answer for a call that would be final: held with the reason to give the bot, or null when the
 * call may go ahead. */
export async function gateFinalAction(
  consent: { check: ReturnType<typeof createFinalActionConsent>["check"] },
  input: {
    owner: { threadId: string; generation: string };
    bot: Parameters<ReturnType<typeof createFinalActionConsent>["check"]>[1];
    call: FinalActionCall;
    helpOpen: boolean;
    waitMs: number;
    signal?: AbortSignal;
  },
): Promise<ControlState | null> {
  const decision = await consent.check(input.owner, input.bot, input.call, { waitMs: input.waitMs, signal: input.signal });
  return decision.pass ? null : { held: true, helpOpen: input.helpOpen, blockedReason: decision.text };
}

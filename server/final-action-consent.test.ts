import { describe, expect, it, vi } from "vitest";
import { FINAL_ACTION_TOOL, FINAL_ACTION_TOOLS, type FinalActionCall } from "../shared/computer-final-action.ts";
import type { DecisionRow } from "./decision-log.ts";
import "./server-line-packs.ts";
import { serverLine, type ServerLineKey } from "./server-lines.ts";
import type { BotRecord } from "./store.ts";
import {
  createFinalActionConsent,
  FINAL_ACTION_ALLOWED,
  FINAL_ACTION_DECLINED,
  FINAL_ACTION_WAITING,
  gateFinalAction,
} from "./final-action-consent.ts";

const CALL: FinalActionCall = { tool: "click", hash: "a".repeat(32), label: "Send" };
const OWNER = { threadId: "t1", generation: "g1" };
const BOT: Pick<BotRecord, "id" | "name" | "color" | "avatarUrl" | "notifications"> = { id: "b1", name: "Bow", color: "blue", avatarUrl: undefined, notifications: true };

function fixture(options: { now?: () => number; ttlMs?: number } = {}) {
  const messages: Array<{ id: string; threadId: string; message: any }> = [];
  const activity: Array<[string, string, string]> = [];
  const audit: Array<Omit<DecisionRow, "at">> = [];
  const notified: unknown[] = [];
  const store = {
    appendMessage: (threadId: string, message: any) => { const entry = { id: `m${messages.length + 1}`, threadId, message: { ...message } }; messages.push(entry); return { id: entry.id }; },
    groupByThread: () => undefined,
    messagesFor: (threadId: string) => messages.filter((entry) => entry.threadId === threadId).map((entry) => ({ id: entry.id, ...entry.message })),
    patchMessage: (threadId: string, id: string, patch: any) => { const entry = messages.find((candidate) => candidate.threadId === threadId && candidate.id === id); if (entry) Object.assign(entry.message, patch); return Boolean(entry); },
    projectBotForTask: () => ({ id: "task1", busy: true, activity: "waiting-on-you" }),
    setTaskActivity: (botId: string, threadId: string, value: string) => void activity.push([botId, threadId, value]),
  };
  const consent = createFinalActionConsent({
    store: store as never, notify: (notification) => void notified.push(notification), audit: (row) => void audit.push(row),
    now: options.now, ttlMs: options.ttlMs, cards: () => [],
  });
  const card = (index = 0) => messages[index]!.message.card;
  const answer = (index = 0, behavior = "allow") => consent.resolve(card(index).requestId, behavior);
  return { consent, messages, activity, audit, notified, card, answer, store };
}

const ask = (f: ReturnType<typeof fixture>, call = CALL, owner = OWNER, waitMs = 20) => f.consent.check(owner, BOT, call, { waitMs });

describe("asking before a final action", () => {
  it("shows one plain card the person can only allow once or deny, and tells the bot it has not been done", async () => {
    const f = fixture();
    const decision = await ask(f);
    expect(decision).toEqual({ pass: false, text: FINAL_ACTION_WAITING });
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]!.message).toMatchObject({ role: "bot", kind: "options", card: {
      title: "I'm about to click “Send”, which can't be undone. Allow once?",
      subtitle: "Bow will do this once on your computer, and nothing else. If you say no, it will not try again this turn.",
      options: ["Allow once", "Deny"], requestType: "permission", tool: FINAL_ACTION_TOOL,
    } });
    expect(FINAL_ACTION_WAITING).toMatch(/NOT performed/);
    expect(f.notified).toHaveLength(1);
    expect(f.audit).toMatchObject([{ decision: "card-shown", source: "question", tool: FINAL_ACTION_TOOL, threadId: "t1", botId: "b1" }]);
  });

  it("raises one card however often the same call is tried while the person has not answered", async () => {
    const f = fixture();
    await ask(f); await ask(f); await ask(f);
    expect(f.messages).toHaveLength(1);
  });

  it("lets the exact call through once after the person allows it, never twice", async () => {
    const f = fixture();
    await ask(f);
    expect(f.answer()).toBe(true);
    expect(f.card()).toMatchObject({ answered: "allow" });
    expect(await ask(f)).toEqual({ pass: true });
    const again = await ask(f);
    expect(again.pass).toBe(false);
    expect(f.messages).toHaveLength(2);
  });

  it("tells a call that waited through the answer to call again, rather than performing it late", async () => {
    const f = fixture();
    const waiting = f.consent.check(OWNER, BOT, CALL, { waitMs: 5_000 });
    await Promise.resolve();
    f.answer();
    expect(await waiting).toEqual({ pass: false, text: FINAL_ACTION_ALLOWED });
    expect(FINAL_ACTION_ALLOWED).toMatch(/call it again/i);
    expect(await ask(f)).toEqual({ pass: true });
  });

  it("keeps a denial for the rest of the turn, with no new card, so asking again cannot wear the person down", async () => {
    const f = fixture();
    await ask(f);
    expect(f.answer(0, "deny")).toBe(true);
    for (let tries = 0; tries < 3; tries += 1) expect(await ask(f)).toEqual({ pass: false, text: FINAL_ACTION_DECLINED });
    expect(f.messages).toHaveLength(1);
    expect(f.card()).toMatchObject({ answered: "deny" });
    expect(FINAL_ACTION_DECLINED).toMatch(/not try it again/i);
  });

  it("binds an approval to the exact call: another fingerprint, another turn, another conversation each ask again", async () => {
    const f = fixture();
    await ask(f);
    f.answer();
    expect((await ask(f, { ...CALL, hash: "b".repeat(32) })).pass).toBe(false);
    expect((await ask(f, CALL, { ...OWNER, generation: "g2" })).pass).toBe(false);
    expect((await ask(f, CALL, { ...OWNER, threadId: "t2" })).pass).toBe(false);
    expect(f.messages).toHaveLength(4);
    expect(await ask(f)).toEqual({ pass: true });
  });

  it("lets an approval lapse, so a yes given long ago cannot be used for a call made much later", async () => {
    let now = 1_000_000;
    const f = fixture({ now: () => now, ttlMs: 5 * 60_000 });
    await ask(f);
    f.answer();
    now += 5 * 60_000 + 1;
    expect((await ask(f)).pass).toBe(false);
    expect(f.messages).toHaveLength(2);
  });

  it("answers the same way for a call the person never saw named, with plain wording of its own", async () => {
    const f = fixture();
    await ask(f, { tool: "press_key", hash: "c".repeat(32) });
    expect(f.card().title).toBe("I'm about to press a key where something can't be undone. Allow once?");
  });

  it("settles an answer only once, and only for a card it raised", async () => {
    const f = fixture();
    await ask(f);
    const requestId = f.card().requestId;
    expect(f.consent.resolve("not-a-request", "allow")).toBe(false);
    expect(f.consent.resolve(requestId, "allow")).toBe(true);
    expect(f.consent.resolve(requestId, "deny")).toBe(false);
    expect(f.card()).toMatchObject({ answered: "allow" });
  });

  it("records what the person decided, without what the page called the button beyond its clean label", async () => {
    const f = fixture();
    await ask(f);
    f.answer(0, "allow");
    expect(f.audit.map((row) => row.decision)).toEqual(["card-shown", "user-approved"]);
    expect(f.audit[1]).toMatchObject({ source: "user", summary: "click: Send" });
  });
});

describe("the words on the card", () => {
  const verbKeys = FINAL_ACTION_TOOLS.flatMap((tool) => (["labelled", "plain"] as const).map((kind) => `server.finalAction.verb.${tool}.${kind}` as ServerLineKey));

  it("come from the language packs: every line exists in English and in German, with its places filled", () => {
    for (const key of [...verbKeys, "server.finalAction.titleLabelled", "server.finalAction.titlePlain", "server.finalAction.detail"] as ServerLineKey[]) {
      expect(serverLine("en", key), key).not.toBe(key);
      expect(serverLine("de", key), key).not.toBe(key);
    }
    const german = serverLine("de", "server.finalAction.titleLabelled", { verb: "V", label: "L" });
    expect(german).toContain("V");
    expect(german).toContain("L");
    expect(german).not.toMatch(/[{}]/);
    expect(serverLine("de", "server.finalAction.detail", { name: "Bow" })).toContain("Bow");
  });

  it("read in the person's language when the conversation has one", async () => {
    const { setConversationLanguage } = await import("./server-lines.ts");
    setConversationLanguage((threadId) => (threadId === "t1" ? "de" : undefined));
    try {
      const f = fixture();
      await ask(f);
      expect(f.card().title).toBe("Ich möchte „Send“ klicken, was sich nicht rückgängig machen lässt. Einmal erlauben?");
      expect(f.card().subtitle).toContain("Bow");
    } finally {
      setConversationLanguage(() => undefined);
    }
  });

  it("fall back to a plain click for a tool it has no words for, rather than printing a key", async () => {
    const f = fixture();
    await f.consent.check(OWNER, BOT, { tool: "shell", hash: "d".repeat(32) }, { waitMs: 5 });
    expect(f.card().title).toBe("I'm about to click where something can't be undone. Allow once?");
  });
});

describe("a turn that ends with a question open", () => {
  it("closes its card as denied by the system, forgets its decisions, and frees a waiting call", async () => {
    const f = fixture();
    const waiting = f.consent.check(OWNER, BOT, CALL, { waitMs: 5_000 });
    await Promise.resolve();
    f.consent.cancel("t1", "g1");
    expect(await waiting).toEqual({ pass: false, text: FINAL_ACTION_WAITING });
    expect(f.card()).toMatchObject({ answered: "deny", dismissed: true });
    await ask(f);
    expect(f.messages).toHaveLength(2);
  });

  it("only closes the turn it was asked to, unless asked to close the whole conversation", async () => {
    const f = fixture();
    await ask(f);
    await ask(f, CALL, { threadId: "t1", generation: "g2" });
    f.consent.cancel("t1", "g1");
    expect(f.card(0)).toMatchObject({ answered: "deny", dismissed: true });
    expect(f.card(1).answered).toBeUndefined();
    f.consent.cancel("t1");
    expect(f.card(1)).toMatchObject({ answered: "deny", dismissed: true });
  });

  it("closes cards a previous run left open, which can never be answered", () => {
    const messages = new Map<string, any>([["m1", { card: { requestId: "r1", tool: FINAL_ACTION_TOOL } }]]);
    const patched: unknown[] = [];
    const consent = createFinalActionConsent({
      store: { messagesFor: () => [...messages].map(([id, value]) => ({ id, ...value })), patchMessage: (...args: unknown[]) => { patched.push(args); return true; } } as never,
      notify: vi.fn(), audit: vi.fn(), cards: () => [{ threadId: "t1", messageId: "m1" }],
    });
    expect(consent.dismissStale()).toBe(1);
    expect(patched).toHaveLength(1);
  });
});

describe("the broker's answer for a final action", () => {
  const input = (_f: ReturnType<typeof fixture>, helpOpen = false) => ({ owner: OWNER, bot: BOT, call: CALL, helpOpen, waitMs: 20 });

  it("holds the call with the reason, and keeps the help the person already has open", async () => {
    const f = fixture();
    expect(await gateFinalAction(f.consent, input(f, true))).toEqual({ held: true, helpOpen: true, blockedReason: FINAL_ACTION_WAITING });
  });

  it("lets the call go ahead, answering nothing, once the person has allowed it", async () => {
    const f = fixture();
    await gateFinalAction(f.consent, input(f));
    f.answer();
    expect(await gateFinalAction(f.consent, input(f))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { FinalActionCall } from "../shared/computer-final-action.ts";
import { createComputerChecks } from "./computer-checks.ts";
import { FINAL_ACTION_WAITING } from "./final-action-consent.ts";

const CALL: FinalActionCall = { tool: "click", hash: "a".repeat(32), label: "Send" };
const OWNER = { threadId: "t1", generation: "g1" };

function fixture(features: Record<string, boolean> | undefined) {
  const messages: Array<{ id: string; threadId: string; message: any }> = [];
  const store = {
    appendMessage: (threadId: string, message: any) => { const entry = { id: `m${messages.length + 1}`, threadId, message: { ...message } }; messages.push(entry); return { id: entry.id }; },
    groupByThread: () => undefined,
    messagesFor: (threadId: string) => messages.filter((entry) => entry.threadId === threadId).map((entry) => ({ id: entry.id, ...entry.message })),
    patchMessage: (threadId: string, id: string, patch: any) => { const entry = messages.find((candidate) => candidate.threadId === threadId && candidate.id === id); if (entry) Object.assign(entry.message, patch); return Boolean(entry); },
    projectBotForTask: () => null,
    setTaskActivity: () => {},
    bot: (id: string) => (id === "b1" ? { id: "b1", name: "Bow", color: "blue", avatarUrl: undefined, notifications: false } : undefined),
  };
  const checks = createComputerChecks({ store: store as never, notify: () => {}, audit: () => {}, features: () => features as never, cards: () => [] });
  return { checks, messages };
}
const hold = (f: ReturnType<typeof fixture>, call: FinalActionCall | null = CALL) =>
  f.checks.holdFinalAction({ owner: OWNER, botId: "b1", ...(call ? { call } : {}), helpOpen: false, waitMs: 10 });

describe("the computer checks the server holds", () => {
  it("ask nothing, and answer nothing, unless the switch is on and the bridge named a final action", async () => {
    expect(await hold(fixture(undefined))).toBeNull();
    expect(await hold(fixture({ confirmComputerFinalActions: false }))).toBeNull();
    const on = fixture({ confirmComputerFinalActions: true });
    expect(await hold(on, null)).toBeNull();
    expect(on.messages).toHaveLength(0);
  });

  it("hold the call back and raise one card when the switch is on", async () => {
    const f = fixture({ confirmComputerFinalActions: true });
    expect(await hold(f)).toEqual({ held: true, helpOpen: false, blockedReason: FINAL_ACTION_WAITING });
    expect(f.messages).toHaveLength(1);
  });

  it("settle an answer to its own card, and only its own", async () => {
    const f = fixture({ confirmComputerFinalActions: true });
    await hold(f);
    expect(f.checks.resolve("not-ours", "allow")).toBe(false);
    expect(f.checks.resolve(f.messages[0]!.message.card.requestId, "allow")).toBe(true);
    expect(await hold(f)).toBeNull();
  });

  it("close a turn's open question and write its evidence line when the turn lets go of the computer", async () => {
    const f = fixture({ confirmComputerFinalActions: true, reportComputerEvidence: true });
    await hold(f);
    f.checks.recordEvidence({ botId: "b1", threadId: "t1", generation: "g1" }, { actions: 2, changed: 2, unchanged: 0, unobserved: 0, refusals: {}, readBacks: 4, addedMs: 10 });
    f.checks.release(OWNER);
    expect(f.messages[0]!.message.card).toMatchObject({ answered: "deny", dismissed: true });
    expect(f.messages.at(-1)!.message).toMatchObject({ kind: "activity", tool: { name: "2 actions on this computer, all confirmed by the window changing.", ok: true } });
  });

  it("write no evidence line while that switch is off", () => {
    const f = fixture({ confirmComputerFinalActions: true });
    f.checks.recordEvidence({ botId: "b1", threadId: "t1", generation: "g1" }, { actions: 2, changed: 2, unchanged: 0, unobserved: 0, refusals: {}, readBacks: 0, addedMs: 0 });
    f.checks.release(OWNER);
    expect(f.messages).toHaveLength(0);
  });
});

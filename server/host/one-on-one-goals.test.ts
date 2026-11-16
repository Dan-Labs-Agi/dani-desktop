// A one-on-one goal's step against fake deps. The chat looks free, yet startTurn keeps refusing the
// turn as busy: the step retries, and once the retries have filled the wait cap the run ends blocked,
// as a busy wait does, instead of spinning forever. A lost race followed by a busy chat shares that one
// cap. A single lost race still retries, and the goal finishes on the done marker.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostTurnResult } from "../coordinator.ts";
import { GROUP_GOAL_CONTROL_CLOSE, GROUP_GOAL_CONTROL_OPEN, GROUP_GOAL_MAX_TURNS, GROUP_GOAL_WAIT_MAX_MS, type GoalRunEnd } from "../group-goal-run.ts";
import type { BotRecord, Message, TaskRecord } from "../store.ts";
import type { LiveGoalRun } from "./goal-cards.ts";
import { createGoalTurns, type GoalLeadTurn } from "./goal-turns.ts";
import { createOneOnOneGoals, type OneOnOneGoalDeps } from "./one-on-one-goals.ts";
import { blockingTurnStop, TurnStops } from "../turn-outcome.ts";

// A one-second cap: the real half hour is thousands of retries, each a timer round of its own.
vi.mock("../group-goal-run.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../group-goal-run.ts")>()),
  GROUP_GOAL_WAIT_MAX_MS: 1_000,
}));

const DONE = `${GROUP_GOAL_CONTROL_OPEN}{"status":"completed","detail":"Done."}${GROUP_GOAL_CONTROL_CLOSE}`;
const refused = (code: string) => Object.assign(new Error("this thread is already working"), { code });

/** A goal in a chat whose startTurn is scripted; the real goal-turns hold the lead, so a reply can be filled in. */
function goalChat(startTurn: (call: number, lead: GoalLeadTurn, settle: (outcome: HostTurnResult) => void) => Promise<unknown>, canStart: () => boolean = () => true, waitForBrowser?: (session: string, cancelled: () => boolean) => Promise<boolean>) {
  const run: LiveGoalRun = {
    runId: "r",
    cardMessageId: "card",
    goal: "Fix the build",
    coordinatorBotId: "b",
    coordinatorName: "Solo",
    turnCount: 0,
    maxTurns: GROUP_GOAL_MAX_TURNS,
    startedAt: 0,
    finished: false,
  };
  const finished: Array<{ status: GoalRunEnd; detail: string }> = [];
  const ends: Array<string | undefined> = [];
  const turns = createGoalTurns({ retireProviderTurn() {} });
  const instructions: string[] = [];
  let lead!: GoalLeadTurn;
  let starts = 0;
  let botChanged: ((change: { type: "bot"; botId: string }) => void) | undefined;
  const goals = createOneOnOneGoals({
    store: {
      bot: () => ({ id: "b", name: "Solo" } as BotRecord),
      taskByThread: () => ({} as TaskRecord),
      appendMessage: () => ({ id: "m1" } as Message),
      onChange: (listener) => { botChanged = listener as typeof botChanged; return () => {}; },
      titleTaskFromFirstMessage: () => null,
    },
    cards: {
      start: () => run,
      progress: () => {},
      // As the real cards do, keep the first end; the run's own cleanup reports a second one.
      finish: (_threadId, _run, status, detail) => {
        if (run.finished) return;
        run.finished = true;
        finished.push({ status, detail });
      },
    },
    turns: {
      ...turns,
      begin: (threadId) => (lead = turns.begin(threadId)),
      end: (threadId, turn, outcome) => {
        ends.push(outcome);
        turns.end(threadId, turn, outcome);
      },
    },
    canStart,
    isUnattended: () => false,
    waitForBrowser,
    startTurn: (_botId, text, opts) => {
      instructions.push(text);
      return startTurn(++starts, lead, opts.onSettled);
    },
  } satisfies OneOnOneGoalDeps);
  goals.start("b", "t", "Fix the build");
  // The store's change event for the bot, as the real store fires it when the bot's turn ends.
  return { run, finished, ends, instructions, starts: () => starts, stop: () => goals.stop("t"), botChanged: () => botChanged?.({ type: "bot", botId: "b" }) };
}

describe("a one-on-one goal whose turn keeps losing its slot", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["thread_busy", "thread_limit"])("ends blocked once the %s retries fill the wait cap, instead of retrying forever", async (code) => {
    vi.useFakeTimers();
    const chat = goalChat(() => Promise.reject(refused(code)));
    await vi.advanceTimersByTimeAsync(GROUP_GOAL_WAIT_MAX_MS + 1_000);
    expect(chat.finished).toEqual([
      { status: "blocked", detail: expect.stringMatching(/^Solo stayed busy for \d+ minutes? — send the goal again when they are free\.$/) },
    ]);
    expect(chat.run.turnCount).toBe(0);
    const starts = chat.starts();
    expect(starts).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chat.starts()).toBe(starts);
    expect(new Set(chat.ends)).toEqual(new Set(["busy"]));
  });

  it("shares one wait cap between a lost slot and the busy wait after it", async () => {
    vi.useFakeTimers();
    let busy = false;
    const chat = goalChat(() => { busy = true; return Promise.reject(refused("thread_busy")); }, () => !busy);
    // Without one shared cap the busy wait would start its own full cap after the lost slot.
    await vi.advanceTimersByTimeAsync(GROUP_GOAL_WAIT_MAX_MS - 1);
    expect(chat.finished).toEqual([]);
    await vi.advanceTimersByTimeAsync(101);
    expect(chat.finished).toEqual([{ status: "blocked", detail: expect.stringMatching(/^Solo stayed busy/) }]);
    expect(chat.starts()).toBe(1);
    expect(chat.run.turnCount).toBe(0);
  });

  it("starts the turn when the chat frees up just before the shared cap runs out", async () => {
    vi.useFakeTimers();
    let busy = false;
    const chat = goalChat(async (call, lead, settle) => {
      if (call === 1) { busy = true; throw refused("thread_busy"); }
      lead.assistantItems.push(DONE);
      settle({ ok: true, text: "" });
    }, () => !busy);
    await vi.advanceTimersByTimeAsync(GROUP_GOAL_WAIT_MAX_MS - 300);
    busy = false;
    chat.botChanged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(chat.starts()).toBe(2);
    expect(chat.run.turnCount).toBe(1);
    expect(chat.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("retries one lost race and finishes on the done marker", async () => {
    vi.useFakeTimers();
    const chat = goalChat(async (call, lead, settle) => {
      if (call === 1) throw refused("thread_busy");
      lead.assistantItems.push(DONE);
      settle({ ok: true, text: "" });
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(chat.starts()).toBe(2);
    expect(chat.run.turnCount).toBe(1);
    expect(chat.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });
});

describe("one-on-one goal browser hand-back", () => {
  afterEach(() => vi.useRealTimers());

  it("preserves the goal and committed work until browser hand-back resumes inspection", async () => {
    vi.useFakeTimers();
    const { promise: readiness, resolve: handBack } = Promise.withResolvers<boolean>();
    const sessions: string[] = [];
    const effects: string[] = [];
    const chat = goalChat(async (call, lead, settle) => {
      if (call === 1) {
        effects.push("draft committed");
        settle({ ok: false, text: "Browser held", waitingOnBrowser: "solo-browser" });
        return;
      }
      effects.push("receipt verified");
      lead.assistantItems.push(DONE);
      settle({ ok: true, text: "" });
    }, () => true, async (session) => { sessions.push(session); return readiness; });
    await vi.advanceTimersByTimeAsync(0);
    expect(sessions).toEqual(["solo-browser"]);
    expect(chat.starts()).toBe(1);
    expect(chat.finished).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chat.starts()).toBe(1);
    expect(effects).toEqual(["draft committed"]);
    handBack(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.starts()).toBe(2);
    expect(chat.instructions[1]).toContain(chat.instructions[0]);
    expect(chat.instructions[1]).toMatch(/inspect.*current/i);
    expect(effects).toEqual(["draft committed", "receipt verified"]);
    expect(chat.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("does not resume a stopped solo goal when browser readiness arrives later", async () => {
    vi.useFakeTimers();
    const { promise: readiness, resolve: handBack } = Promise.withResolvers<boolean>();
    let cancelled: (() => boolean) | undefined;
    const chat = goalChat(async (_call, _lead, settle) => {
      settle({ ok: false, text: "Browser held", waitingOnBrowser: "solo-browser" });
    }, () => true, (_session, isCancelled) => { cancelled = isCancelled; return readiness; });
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.starts()).toBe(1);
    expect(cancelled?.()).toBe(false);
    expect(chat.stop()).toBe(true);
    expect(cancelled?.()).toBe(true);
    handBack(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.starts()).toBe(1);
    expect(chat.finished.map((end) => end.status)).toEqual(["stopped"]);
  });

  it("does not redispatch native cancellation after an unfinished tool", async () => {
    vi.useFakeTimers();
    const stops = new TurnStops();
    const base = { eventId: "native-cancel", provider: "hermesAgent", threadId: "t", turnId: "turn", createdAt: "" };
    const chat = goalChat(async (_call, _lead, settle) => {
      stops.note({ ...base, type: "turn.started" });
      stops.note({ ...base, type: "item.started", itemType: "tool", itemId: "pending-write" });
      stops.note({ ...base, type: "turn.completed", ok: false, stopReason: "cancelled" });
      settle({ ok: false, text: "Native cancellation", blocked: blockingTurnStop(stops.read("t", "turn")) });
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.starts()).toBe(1);
    expect(chat.run.turnCount).toBe(1);
    expect(chat.finished.map(end => end.status)).toEqual(["blocked"]);
    expect(stops.mayContinue("t", "turn", "observation")).toBe(false);
  });

  it.each(["denied", "provider_error"] as const)("preserves a trusted %s blocker instead of retrying a solo step", async (outcome) => {
    vi.useFakeTimers();
    const reason = outcome === "denied" ? "The person denied the action." : "The external effect may already have committed.";
    const chat = goalChat(async (_call, lead, settle) => {
      lead.assistantItems.push(DONE);
      settle({ ok: false, text: "Turn did not finish", blocked: { outcome, reason } });
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.starts()).toBe(1);
    expect(chat.finished).toEqual([{ status: "blocked", detail: reason }]);
  });
});

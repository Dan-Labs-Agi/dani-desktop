import { blockingTurnStop, TurnStops } from "./turn-outcome.ts";
import { roomTurnEnd } from "./room-turn-end.ts";
import { describe, expect, it } from "vitest";
import {
  GROUP_GOAL_CONTROL_CLOSE,
  GROUP_GOAL_CONTROL_OPEN,
  GROUP_GOAL_MAX_TURNS,
  groupGoalAssignmentKey,
  groupGoalCompletionTurnId,
  parseGroupGoalDecision,
  resolveGroupGoalMember,
  runGoalRun,
  selectGroupGoalCoordinator,
  type GoalRunEnd,
  type GoalStepResult,
} from "./group-goal-run.ts";

const members = [
  { id: "scout-id", name: "Scout" },
  { id: "chief-id", name: "Miso", chiefOfStaff: true },
  { id: "old-id", name: "Old", hidden: true },
];

describe("group goal runs", () => {
  it("keeps the bound provider identity when a completion event omits its turn id", () => {
    expect(groupGoalCompletionTurnId(undefined, "bound-turn")).toBe("bound-turn");
    expect(groupGoalCompletionTurnId("event-turn", "bound-turn")).toBe("event-turn");
  });

  it("strips and validates a coordinator decision", () => {
    const parsed = parseGroupGoalDecision(
      `I am asking Scout to verify it.\n${GROUP_GOAL_CONTROL_OPEN}`
      + `{"status":"continue","next":"@Scout","instruction":"Verify the release","detail":"Draft ready"}`
      + GROUP_GOAL_CONTROL_CLOSE,
    );
    expect(parsed.visibleText).toBe("I am asking Scout to verify it.");
    expect(parsed.decision).toEqual({
      status: "continue",
      next: "@Scout",
      instruction: "Verify the release",
      detail: "Draft ready",
    });
  });

  it("fails closed on incomplete or malformed decisions", () => {
    expect(parseGroupGoalDecision("ordinary reply")).toEqual({ visibleText: "ordinary reply", decision: null });
    expect(parseGroupGoalDecision(
      `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","next":"Scout"}${GROUP_GOAL_CONTROL_CLOSE}`,
    ).decision).toBeNull();
    expect(parseGroupGoalDecision(
      `${GROUP_GOAL_CONTROL_OPEN}{not json}${GROUP_GOAL_CONTROL_CLOSE}`,
    ).decision).toBeNull();
    expect(parseGroupGoalDecision(
      `Safe update\n${GROUP_GOAL_CONTROL_OPEN}{"status":"continue"}`,
    )).toEqual({ visibleText: "Safe update", decision: null });
  });

  it("removes every private envelope while the last complete one controls", () => {
    const parsed = parseGroupGoalDecision(
      `First\n${GROUP_GOAL_CONTROL_OPEN}{"status":"blocked","detail":"old"}${GROUP_GOAL_CONTROL_CLOSE}`
      + `\nFinal\n${GROUP_GOAL_CONTROL_OPEN}{"status":"completed","detail":"done"}${GROUP_GOAL_CONTROL_CLOSE}`,
    );
    expect(parsed.visibleText).toBe("First\n\nFinal");
    expect(parsed.decision).toEqual({ status: "completed", detail: "done" });
  });

  it("honors an explicit active lead, then an in-room Chief", () => {
    expect(selectGroupGoalCoordinator(members, { kind: "member", botId: "scout-id" })?.id).toBe("scout-id");
    expect(selectGroupGoalCoordinator(members, { kind: "everyone" })?.id).toBe("chief-id");
    expect(selectGroupGoalCoordinator(members, { kind: "member", botId: "old-id" })?.id).toBe("chief-id");
  });

  it("resolves only an exact active room member", () => {
    expect(resolveGroupGoalMember("@SCOUT", members)?.id).toBe("scout-id");
    expect(resolveGroupGoalMember("chief-id", members)?.name).toBe("Miso");
    expect(resolveGroupGoalMember("Old", members)).toBeNull();
    expect(resolveGroupGoalMember("Sco", members)).toBeNull();
    expect(resolveGroupGoalMember("Scout", [
      ...members,
      { id: "other-scout", name: "Scout" },
    ])).toBeNull();
    expect(resolveGroupGoalMember("other-scout", [
      ...members,
      { id: "other-scout", name: "Scout" },
    ])?.id).toBe("other-scout");
  });

  it("normalizes repeated assignments for no-progress detection", () => {
    expect(groupGoalAssignmentKey("scout-id", "  Verify   THE release "))
      .toBe(groupGoalAssignmentKey("scout-id", "verify the release"));
  });

  it("reserves the final bounded turn for coordinator evaluation", () => {
    expect(GROUP_GOAL_MAX_TURNS % 2).toBe(1);
  });
});


const envelope = (decision: Record<string, string>) =>
  `Update.\n${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(decision)}${GROUP_GOAL_CONTROL_CLOSE}`;
const settled = (replyText: string): GoalStepResult => ({ ran: true, replyText, outcome: "settled" });

/** Drives the real loop with scripted steps; a step that runs counts one turn, as a claimed member turn does. */
function goalRun(options: { solo?: boolean; members?: Array<{ id: string; name: string }>; steps: Array<GoalStepResult | ((call: number) => GoalStepResult)>; cancelAfter?: number; maxTurns?: number; waitForBrowser?: (session: string, cancelled: () => boolean) => Promise<boolean> }) {
  const members = options.members ?? [{ id: "solo-id", name: "Solo" }];
  const run = { goal: "Get every test passing", turnCount: 0, maxTurns: options.maxTurns ?? GROUP_GOAL_MAX_TURNS, finished: false };
  const calls: Array<{ bot: string; coordinator: boolean; instructions: string }> = [];
  const finished: Array<{ status: GoalRunEnd; detail: string }> = [];
  const progress: string[] = [];
  let cancelled = false;
  const done = runGoalRun({
    run,
    coordinator: members[0]!,
    members,
    solo: options.solo,
    cancelled: () => cancelled,
    current: (id) => members.find((member) => member.id === id),
    waitForBrowser: options.waitForBrowser,
    step: async (bot, coordinator, instructions) => {
      calls.push({ bot: bot.id, coordinator, instructions });
      const scripted = options.steps[Math.min(calls.length - 1, options.steps.length - 1)]!;
      const result = typeof scripted === "function" ? scripted(calls.length) : scripted;
      if (result.ran) run.turnCount += 1;
      if (options.cancelAfter === calls.length || calls.length > 4 * GROUP_GOAL_MAX_TURNS) cancelled = true;
      return result;
    },
    finish: (status, detail) => {
      run.finished = true;
      finished.push({ status, detail });
    },
    progress: (detail) => progress.push(detail),
    note: () => {},
  });
  return { done, run, calls, finished, progress, cancel: () => { cancelled = true; } };
}

describe("one goal-run loop for a room and a one-on-one chat", () => {
  it("in a room of one the bot works in its own turns and finishes on the done marker", async () => {
    const goal = goalRun({
      solo: true,
      steps: [
        settled(envelope({ status: "continue", next: "solo-id", instruction: "Fix the failing parser test", detail: "Half done" })),
        settled(envelope({ status: "completed", detail: "Every test passes." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([["solo-id", true], ["solo-id", true]]);
    expect(goal.finished).toEqual([{ status: "completed", detail: "Every test passes." }]);
    expect(goal.run.turnCount).toBe(2);
  });

  it("stops a room of one at the same turn cap as a room", async () => {
    const goal = goalRun({
      solo: true,
      steps: [(call) => settled(envelope({ status: "continue", next: "Solo", instruction: `Try approach ${call}`, detail: "Still going" }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(GROUP_GOAL_MAX_TURNS);
    expect(goal.finished).toEqual([{ status: "limit-reached", detail: expect.stringContaining(`${GROUP_GOAL_MAX_TURNS}-turn safety limit`) }]);
  });

  it("blocks on the spend cap without retrying the refused turn", async () => {
    const goal = goalRun({
      solo: true,
      steps: [
        settled(envelope({ status: "continue", next: "solo-id", instruction: "Keep going", detail: "Working" })),
        { ran: false, replyText: "", outcome: "spend_capped", stopReason: "this workspace has reached its monthly spend limit of $0.01" },
      ],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(2);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "this workspace has reached its monthly spend limit of $0.01" }]);
  });

  it("retries a turn that did not settle once, then fails the run", async () => {
    const goal = goalRun({ solo: true, steps: [{ ran: true, replyText: "", outcome: "provider_failed", stopReason: "exit 1" }] });
    await goal.done;
    expect(goal.calls).toHaveLength(2);
    expect(goal.finished).toEqual([{ status: "failed", detail: "Solo could not complete the coordination step — exit 1." }]);
  });

  it("never takes a reply without a valid marker as done", async () => {
    const goal = goalRun({ solo: true, steps: [settled("All done, trust me.")] });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Solo did not provide a valid next-step decision." }]);
  });

  it("blocks a room of one that repeats the same next step", async () => {
    const goal = goalRun({ solo: true, steps: [settled(envelope({ status: "continue", next: "solo-id", instruction: "Same thing", detail: "Again" }))] });
    await goal.done;
    expect(goal.calls).toHaveLength(3);
    expect(goal.finished[0]?.status).toBe("blocked");
  });

  it("a stopped run ends without finishing again or starting another turn", async () => {
    const goal = goalRun({
      solo: true,
      cancelAfter: 1,
      steps: [settled(envelope({ status: "continue", next: "solo-id", instruction: "Keep going", detail: "Working" }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([]);
  });

  it("a room still hands each assignment to a worker turn", async () => {
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }],
      steps: [
        settled(envelope({ status: "continue", next: "Scout", instruction: "Verify the draft", detail: "Drafted" })),
        settled("Verified."),
        settled(envelope({ status: "completed", detail: "Draft verified." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([["lead-id", true], ["scout-id", false], ["lead-id", true]]);
    expect(goal.finished).toEqual([{ status: "completed", detail: "Draft verified." }]);
  });
});

const flushGoalSteps = async () => {
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
};

describe("goal browser hand-back and trusted blockers", () => {
  it("waits without model polling and resumes only remaining work on the same worker assignment", async () => {
    const { promise: availability, resolve: handBack } = Promise.withResolvers<boolean>();
    const sessions: string[] = [];
    const effects: string[] = [];
    const goal = goalRun({
      members: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }],
      waitForBrowser: async (session) => { sessions.push(session); return availability; },
      steps: [
        settled(envelope({ status: "continue", next: "worker", instruction: "Commit the draft, then verify its receipt" })),
        () => {
          effects.push("draft committed");
          return { ran: true, replyText: "", outcome: "provider_failed", waitingOnBrowser: "browser-session" };
        },
        () => {
          effects.push("receipt verified");
          return settled("The existing draft receipt is verified.");
        },
        settled(envelope({ status: "completed", detail: "Draft and receipt verified." })),
      ],
    });
    await flushGoalSteps();
    expect(sessions).toEqual(["browser-session"]);
    expect(goal.calls).toHaveLength(2);
    expect(effects).toEqual(["draft committed"]);
    expect(goal.finished).toEqual([]);
    await flushGoalSteps();
    expect(goal.calls).toHaveLength(2);
    handBack(true);
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([
      ["lead", true], ["worker", false], ["worker", false], ["lead", true],
    ]);
    expect(goal.calls[2]!.instructions).toContain(goal.calls[1]!.instructions);
    expect(goal.calls[2]!.instructions).toMatch(/inspect.*current/i);
    expect(effects).toEqual(["draft committed", "receipt verified"]);
    expect(goal.finished).toEqual([{ status: "completed", detail: "Draft and receipt verified." }]);
  });

  it("does not dispatch a late continuation after cancellation while waiting", async () => {
    const { promise: availability, resolve: handBack } = Promise.withResolvers<boolean>();
    let wasCancelled: (() => boolean) | undefined;
    const goal = goalRun({
      solo: true,
      waitForBrowser: (_session, cancelled) => {
        wasCancelled = cancelled;
        return availability;
      },
      steps: [{ ran: true, replyText: "", outcome: "provider_failed", waitingOnBrowser: "browser-session" }],
    });
    await flushGoalSteps();
    expect(goal.calls).toHaveLength(1);
    expect(wasCancelled?.()).toBe(false);
    goal.cancel();
    expect(wasCancelled?.()).toBe(true);
    handBack(true);
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([]);
  });

  it("does not retry a room member's native cancellation after an unfinished tool", async () => {
    const stops = new TurnStops();
    const base = { eventId: "native-cancel", provider: "hermesAgent", threadId: "t", turnId: "turn", createdAt: "" };
    stops.note({ ...base, type: "turn.started" });
    stops.note({ ...base, type: "item.started", itemType: "tool", itemId: "pending-write" });
    const terminal = { ...base, type: "turn.completed" as const, ok: false, stopReason: "cancelled" };
    stops.note(terminal);
    const goal = goalRun({ steps: [{ ran: true, replyText: "", ...roomTurnEnd(terminal, true),
      blocked: blockingTurnStop(stops.read("t", "turn")) }] });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished.map(end => end.status)).toEqual(["blocked"]);
  });

  it.each([true, false])("finishes blocked without dispatch when browser readiness is not restored (wait callback: %s)", async (hasWait) => {
    const goal = goalRun({
      solo: true,
      waitForBrowser: hasWait ? async () => false : undefined,
      steps: [{ ran: true, replyText: "", outcome: "provider_failed", waitingOnBrowser: "browser-session" }],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished[0]?.status).toBe("blocked");
  });

  it("bounds browser resumptions by actual turn budget rather than readiness polling", async () => {
    let waits = 0;
    const goal = goalRun({
      solo: true,
      maxTurns: 2,
      waitForBrowser: async () => { waits += 1; return true; },
      steps: [{ ran: true, replyText: "", outcome: "provider_failed", waitingOnBrowser: "browser-session" }],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(2);
    expect(waits).toBeLessThanOrEqual(2);
    expect(goal.finished[0]?.status).toBe("limit-reached");
  });

  it("retains only one transient retry across a browser hand-back", async () => {
    const goal = goalRun({
      solo: true,
      waitForBrowser: async () => true,
      steps: [
        { ran: true, replyText: "", outcome: "provider_failed" },
        { ran: true, replyText: "", outcome: "provider_failed", waitingOnBrowser: "browser-session" },
        { ran: true, replyText: "", outcome: "provider_failed" },
      ],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(3);
    expect(goal.finished[0]?.status).toBe("failed");
  });

  it("never dispatches a transient retry beyond the actual turn budget", async () => {
    const goal = goalRun({
      solo: true,
      maxTurns: 1,
      steps: [{ ran: true, replyText: "", outcome: "provider_failed" }],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.run.turnCount).toBe(1);
    expect(goal.finished[0]?.status).not.toBe("completed");
  });

  it.each(["denied", "provider_error"] as const)("never retries or reassigns a trusted %s worker blocker", async (outcome) => {
    const reason = outcome === "denied" ? "The person denied this action." : "The purchase may have committed; inspect its receipt before any further action.";
    const goal = goalRun({
      members: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }],
      steps: [
        settled(envelope({ status: "continue", next: "worker", instruction: "Make the approved purchase" })),
        { ran: true, replyText: "Done.", outcome: "provider_failed", blocked: { outcome, reason } },
      ],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(2);
    expect(goal.finished).toEqual([{ status: "blocked", detail: reason }]);
  });

  it("does not accept a completion marker over a trusted setup blocker", async () => {
    const goal = goalRun({
      solo: true,
      steps: [{ ...settled(envelope({ status: "completed", detail: "Done." })), blocked: { outcome: "provider_error", reason: "Browser setup requires the person." } }],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Browser setup requires the person." }]);
  });
});

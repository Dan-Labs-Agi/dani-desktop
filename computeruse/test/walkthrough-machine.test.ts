import { describe, expect, it } from "vitest";
import { createWalkthrough, type WalkthroughEvent, type WalkthroughHost, type WalkthroughStep } from "../walkthrough.ts";

/** A host whose screen is a number the test moves, and whose verdict is whatever the test says it is. */
function host(verdicts: Array<boolean | "unverified">) {
  const state = { screen: 0, events: [] as WalkthroughEvent[], confirms: 0, targets: [{ label: "Save", role: "button" }] as Array<{ label: string; role: string }> };
  const fake: WalkthroughHost = {
    captureFingerprint: async () => Uint8Array.of(state.screen, state.screen),
    findTargets: async () => state.targets,
    present: (event) => void state.events.push(event),
    confirmStep: async () => verdicts[state.confirms++] ?? false,
  };
  return { fake, state };
}

const steps: WalkthroughStep[] = [
  { instruction: "Open File", target: { label: "Save" } },
  { instruction: "Choose Export" },
  { instruction: "Press Done" },
];
const quick = { intervalMs: 1, baselineAtStep: true };

describe("a walkthrough kept across calls", () => {
  it("shows the first step with its control, and remembers how the window looked then", async () => {
    const { fake, state } = host([]);
    const walk = createWalkthrough(steps, fake, quick);
    const first = await walk.start();
    expect(first).toMatchObject({ status: "step", index: 0, total: 3, instruction: "Open File", targetState: "found", target: { label: "Save" } });
    expect(state.events[0]).toMatchObject({ type: "step", index: 0 });
  });

  it("sees a change that happened between two calls, because the baseline outlives the call", async () => {
    const { fake, state } = host([true]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    state.screen = 0;
    expect(await walk.next(30)).toEqual({ status: "waiting", index: 0, total: 3 });
    state.screen = 200;
    const moved = await walk.next(200);
    expect(moved).toMatchObject({ status: "step", index: 1, verified: 0 });
  });

  it("moves on only when the step's own check passes, never because the window changed", async () => {
    const { fake, state } = host([false, false, true]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    state.screen = 200;
    expect(await walk.next(200)).toMatchObject({ status: "needs_review", index: 0, reason: "failed" });
    expect(walk.position).toBe(0);
    expect(await walk.next(200)).toMatchObject({ status: "needs_review", index: 0, reason: "failed" });
    expect(await walk.next(200)).toMatchObject({ status: "step", index: 1, verified: 0 });
  });

  it("asks the check again on the next call after a failed one, without waiting for another change", async () => {
    const { fake, state } = host([false, true]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    state.screen = 200;
    await walk.next(200);
    const before = state.confirms;
    const again = await walk.next(1);
    expect(state.confirms).toBe(before + 1);
    expect(again.status).toBe("step");
  });

  it("does not count a step with no check as done: it waits to be confirmed", async () => {
    const { fake, state } = host(["unverified"]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    state.screen = 200;
    expect(await walk.next(200)).toMatchObject({ status: "needs_review", index: 0, reason: "unverified" });
    expect(await walk.confirm(true)).toMatchObject({ status: "step", index: 1, verified: 0 });
  });

  it("keeps the step and watches again from now when told it is not done", async () => {
    const { fake, state } = host(["unverified", true]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    state.screen = 200;
    await walk.next(200);
    expect(await walk.confirm(false)).toMatchObject({ status: "step", index: 0 });
    expect(await walk.next(30)).toMatchObject({ status: "waiting", index: 0 });
    state.screen = 90;
    expect(await walk.next(200)).toMatchObject({ status: "step", index: 1 });
  });

  it("finishes as complete after the last step is checked, and says so on every later call", async () => {
    const { fake, state } = host([true, true, true]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    for (const screen of [200, 90]) {
      state.screen = screen;
      await walk.next(200);
    }
    state.screen = 20;
    expect(await walk.next(200)).toEqual({ status: "complete", index: 2, total: 3 });
    expect(await walk.next(200)).toEqual({ status: "complete", index: 2, total: 3 });
    expect(walk.finished).toBe(true);
    expect(state.events.at(-1)).toEqual({ type: "finished", result: "complete" });
  });

  it("gives up on a step left undone for too long, over as many waits as it took", async () => {
    const { fake } = host([]);
    const walk = createWalkthrough(steps, fake, { ...quick, stepTimeoutMs: 100 });
    await walk.start();
    expect((await walk.next(60)).status).toBe("waiting");
    expect((await walk.next(60)).status).toBe("timeout");
    expect((await walk.next(60)).status).toBe("timeout");
  });

  it("stops when cancelled, and goes on from a step after being started there", async () => {
    const { fake } = host([]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    expect(walk.cancel()).toEqual({ status: "cancelled", index: 0, total: 3 });
    expect(await walk.next(10)).toEqual({ status: "cancelled", index: 0, total: 3 });
    const resumed = createWalkthrough(steps, fake, quick);
    expect(await resumed.start(2)).toMatchObject({ status: "step", index: 2, instruction: "Press Done" });
    expect((await resumed.start(7)).status).toBe("unavailable");
  });

  it("stops at once when the signal fires, mid-wait or before a call", async () => {
    const { fake } = host([]);
    const walk = createWalkthrough(steps, fake, quick);
    await walk.start();
    const controller = new AbortController();
    const waiting = walk.next(5_000, controller.signal);
    setTimeout(() => controller.abort(), 20);
    expect((await waiting).status).toBe("cancelled");
    const again = createWalkthrough(steps, fake, quick);
    await again.start();
    const aborted = new AbortController();
    aborted.abort();
    expect((await again.next(100, aborted.signal)).status).toBe("cancelled");
  });

  it("says when the window cannot be read, and never moves on", async () => {
    const { fake } = host([]);
    const broken = createWalkthrough(steps, { ...fake, findTargets: async () => { throw new Error("gone"); } }, quick);
    expect((await broken.start()).status).toBe("unavailable");
    const blind = createWalkthrough(steps, { ...fake, captureFingerprint: async () => null }, quick);
    await blind.start();
    expect((await blind.next(50)).status).toMatch(/unavailable|timeout/);
  });

  it("does not single out a control that several share, or one that is not there", async () => {
    const { fake, state } = host([]);
    state.targets = [{ label: "Save", role: "button" }, { label: "Save", role: "menu" }];
    expect(await createWalkthrough(steps, fake, quick).start()).toMatchObject({ targetState: "ambiguous", target: null });
    state.targets = [];
    expect(await createWalkthrough(steps, fake, quick).start()).toMatchObject({ targetState: "missing", target: null });
  });
});

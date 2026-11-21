import type { StepExpectation, StepRef } from "./walkthrough-verify.ts";
import { watchWalkthroughScreen, type WalkthroughWatchResult } from "./walkthrough-watch.ts";

export interface WalkthroughStep {
  instruction: string;
  target?: StepRef;
  /** What the window shows once the step is done. A step without one is never counted as done on a window change alone. */
  expect?: StepExpectation;
}

export interface WalkthroughTarget {
  label: string;
  role: string;
  x?: number;
  y?: number;
  element_index?: number;
  element_token?: string;
}

export type WalkthroughEvent =
  | { type: "step"; index: number; total: number; instruction: string; target: WalkthroughTarget | null }
  | { type: "observed"; index: number }
  | { type: "finished"; result: "complete" | "cancelled" | "timeout" | "unavailable" | "needs_review" };

export interface WalkthroughHost {
  /** `step` is the one being waited on, so a fingerprint can include what that step is about (a field's value). */
  captureFingerprint(step?: WalkthroughStep): Promise<Uint8Array | null>;
  findTargets(): Promise<readonly WalkthroughTarget[]>;
  present(event: WalkthroughEvent): void;
  /** true: the step is done. "unverified": the step has no check, so the window changing proves nothing. false: its check failed. */
  confirmStep(step: WalkthroughStep, signal: AbortSignal): Promise<boolean | "unverified">;
}

export type TargetState = "none" | "found" | "ambiguous" | "missing";

export function locateTarget(step: WalkthroughStep, targets: readonly WalkthroughTarget[]): { target: WalkthroughTarget | null; state: TargetState } {
  if (!step.target) return { target: null, state: "none" };
  const label = step.target.label.trim().toLocaleLowerCase();
  const role = step.target.role?.trim().toLocaleLowerCase();
  if (!label) return { target: null, state: "none" };
  const matches = targets.filter((target) => target.label.trim().toLocaleLowerCase() === label &&
    (!role || target.role.trim().toLocaleLowerCase() === role) &&
    (target.x === undefined || Number.isFinite(target.x)) && (target.y === undefined || Number.isFinite(target.y)));
  if (matches.length === 1) return { target: matches[0]!, state: "found" };
  return { target: null, state: matches.length ? "ambiguous" : "missing" };
}

export type WalkthroughProgress =
  | { status: "step"; index: number; total: number; instruction: string; target: WalkthroughTarget | null; targetState: TargetState; verified?: number }
  | { status: "waiting"; index: number; total: number }
  | { status: "needs_review"; index: number; total: number; instruction: string; reason: "unverified" | "failed" }
  | { status: "complete"; index: number; total: number }
  | { status: "cancelled" | "timeout" | "unavailable"; index: number; total: number };

export interface WalkthroughOptions {
  intervalMs?: number;
  /** How long one step may go without being done before the walkthrough gives up on it. */
  stepTimeoutMs?: number;
  /** Take the window's fingerprint when a step is shown, and compare against it however many calls later the change comes.
   * A loop that waits in one go leaves this off, and the watcher's first frame is the baseline. */
  baselineAtStep?: boolean;
}

/** The steps, which one the person is on, and what has been seen of it. It moves only when a step's own check passes or the
 * caller confirms it, never on a window change alone, and it can be asked again from where it stands after any pause. */
export function createWalkthrough(steps: readonly WalkthroughStep[], host: WalkthroughHost, options: WalkthroughOptions = {}) {
  const total = steps.length;
  const stepTimeoutMs = options.stepTimeoutMs ?? 60_000;
  let index = 0;
  let baseline: Uint8Array | null = null;
  let waited = 0;
  let review: "unverified" | "failed" | null = null;
  let finished: WalkthroughProgress | null = null;

  const finish = (status: "complete" | "cancelled" | "timeout" | "unavailable"): WalkthroughProgress => {
    const end: WalkthroughProgress = { status, index, total };
    finished = end;
    host.present({ type: "finished", result: status });
    return end;
  };
  const rebaseline = async (): Promise<void> => {
    if (!options.baselineAtStep) return;
    try { baseline = await host.captureFingerprint(steps[index]); } catch { baseline = null; }
  };

  async function show(signal?: AbortSignal, verified?: number): Promise<WalkthroughProgress> {
    const step = steps[index]!;
    let targets: readonly WalkthroughTarget[];
    try { targets = await host.findTargets(); } catch { return finish("unavailable"); }
    if (signal?.aborted) return finish("cancelled");
    const located = locateTarget(step, targets);
    await rebaseline();
    waited = 0;
    review = null;
    host.present({ type: "step", index, total, instruction: step.instruction, target: located.target });
    return { status: "step", index, total, instruction: step.instruction, target: located.target, targetState: located.state, ...(verified === undefined ? {} : { verified }) };
  }

  async function advance(signal?: AbortSignal): Promise<WalkthroughProgress> {
    const done = index;
    if (index + 1 >= total) return finish("complete");
    index += 1;
    return show(signal, done);
  }

  async function verify(signal: AbortSignal | undefined): Promise<WalkthroughProgress> {
    let verdict: boolean | "unverified";
    try { verdict = await host.confirmStep(steps[index]!, signal ?? new AbortController().signal); } catch { return finish("unavailable"); }
    if (signal?.aborted) return finish("cancelled");
    if (verdict === true) return advance(signal);
    review = verdict === "unverified" ? "unverified" : "failed";
    return { status: "needs_review", index, total, instruction: steps[index]!.instruction, reason: review };
  }

  return {
    /** Shows a step, the first or the one to resume at. */
    async start(from = 0, signal?: AbortSignal): Promise<WalkthroughProgress> {
      if (total === 0 || !Number.isInteger(from) || from < 0 || from >= total) return finish("unavailable");
      index = from;
      finished = null;
      return show(signal);
    },
    /** Waits up to `waitMs` for the window to change and settle, then checks the step. Where it stands is the same after a wait
     * that saw nothing, a change that did not check out, or a long silence, and asking again goes on from there. */
    async next(waitMs: number, signal?: AbortSignal): Promise<WalkthroughProgress> {
      if (finished) return finished;
      if (signal?.aborted) return finish("cancelled");
      if (review) return verify(signal);
      const seen: WalkthroughWatchResult = await watchWalkthroughScreen({
        capture: () => host.captureFingerprint(steps[index]), signal, timeoutMs: waitMs, intervalMs: options.intervalMs,
        missesAllowed: 3, ...(baseline ? { baseline } : {}),
      });
      if (seen === "timeout") {
        waited += waitMs;
        return waited >= stepTimeoutMs ? finish("timeout") : { status: "waiting", index, total };
      }
      if (seen !== "changed") return finish(seen);
      host.present({ type: "observed", index });
      return verify(signal);
    },
    /** The caller's own word that the step is done (move on) or is not (watch for it again from now). */
    async confirm(done: boolean, signal?: AbortSignal): Promise<WalkthroughProgress> {
      if (finished) return finished;
      if (done) return advance(signal);
      review = null;
      await rebaseline();
      const step = steps[index]!;
      return { status: "step", index, total, instruction: step.instruction, target: null, targetState: "none" };
    },
    cancel(): WalkthroughProgress {
      return finished ?? finish("cancelled");
    },
    get finished(): boolean { return finished !== null; },
    get position(): number { return index; },
  };
}

/** Runs every step in one go: each is shown, waited for, checked, and the next is shown only when the check passes. */
export async function runWalkthrough(steps: readonly WalkthroughStep[], host: WalkthroughHost, options: {
  signal: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<Exclude<WalkthroughWatchResult, "changed"> | "complete" | "needs_review"> {
  if (steps.length === 0) {
    host.present({ type: "finished", result: "complete" });
    return "complete";
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  const walk = createWalkthrough(steps, host, { intervalMs: options.intervalMs, stepTimeoutMs: timeoutMs });
  let progress = await walk.start(0, options.signal);
  while (progress.status === "step" || progress.status === "waiting") {
    progress = await walk.next(timeoutMs, options.signal);
  }
  if (progress.status === "needs_review") {
    host.present({ type: "finished", result: "needs_review" });
    return "needs_review";
  }
  return progress.status;
}

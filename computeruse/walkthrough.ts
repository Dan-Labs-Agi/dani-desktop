import { watchWalkthroughScreen, type WalkthroughWatchResult } from "./walkthrough-watch.ts";

export interface WalkthroughStep {
  instruction: string;
  target?: { label: string; role?: string };
}

export interface WalkthroughTarget {
  label: string;
  role: string;
  x: number;
  y: number;
}

export type WalkthroughEvent =
  | { type: "step"; index: number; total: number; instruction: string; target: WalkthroughTarget | null }
  | { type: "observed"; index: number }
  | { type: "finished"; result: "complete" | "cancelled" | "timeout" | "unavailable" | "needs_review" };

export interface WalkthroughHost {
  captureFingerprint(): Promise<Uint8Array | null>;
  findTargets(): Promise<readonly WalkthroughTarget[]>;
  present(event: WalkthroughEvent): void;
  confirmStep(step: WalkthroughStep, signal: AbortSignal): Promise<boolean>;
}

function matchTarget(step: WalkthroughStep, targets: readonly WalkthroughTarget[]): WalkthroughTarget | null {
  if (!step.target) return null;
  const label = step.target.label.trim().toLocaleLowerCase();
  const role = step.target.role?.trim().toLocaleLowerCase();
  if (!label) return null;
  const matches = targets.filter((target) => target.label.trim().toLocaleLowerCase() === label &&
    (!role || target.role.trim().toLocaleLowerCase() === role) && Number.isFinite(target.x) && Number.isFinite(target.y));
  return matches.length === 1 ? matches[0]! : null;
}

export async function runWalkthrough(steps: readonly WalkthroughStep[], host: WalkthroughHost, options: {
  signal: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<Exclude<WalkthroughWatchResult, "changed"> | "complete" | "needs_review"> {
  const finish = (result: Exclude<WalkthroughWatchResult, "changed"> | "complete" | "needs_review") => {
    host.present({ type: "finished", result });
    return result;
  };
  for (const [index, step] of steps.entries()) {
    if (options.signal.aborted) return finish("cancelled");
    let targets: readonly WalkthroughTarget[];
    try { targets = await host.findTargets(); } catch { return finish("unavailable"); }
    if (options.signal.aborted) return finish("cancelled");
    host.present({ type: "step", index, total: steps.length, instruction: step.instruction, target: matchTarget(step, targets) });
    const result = await watchWalkthroughScreen({
      capture: () => host.captureFingerprint(), signal: options.signal,
      timeoutMs: options.timeoutMs ?? 60_000, intervalMs: options.intervalMs,
    });
    if (result !== "changed") return finish(result);
    host.present({ type: "observed", index });
    let confirmed: boolean;
    try { confirmed = await host.confirmStep(step, options.signal); } catch { return finish("unavailable"); }
    if (options.signal.aborted) return finish("cancelled");
    if (!confirmed) return finish("needs_review");
  }
  return finish("complete");
}

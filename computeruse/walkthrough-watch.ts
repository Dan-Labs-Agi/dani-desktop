export type WalkthroughWatchResult = "changed" | "timeout" | "cancelled" | "unavailable";

export interface WalkthroughWatchOptions {
  capture: () => Promise<Uint8Array | null>;
  intervalMs?: number;
  timeoutMs: number;
  changeThreshold?: number;
  settleThreshold?: number;
  /** What the window looked like when the step began, kept between calls that each watch for a while. Without it the first frame is the baseline. */
  baseline?: Uint8Array | null;
  /** How many reads in a row may come back empty before the screen counts as unavailable. A driver can fail the first read after an
   * action while a window is still busy; one miss is not a screen that is gone. */
  missesAllowed?: number;
  signal?: AbortSignal;
}

export function fingerprintDifference(a: Uint8Array, b: Uint8Array): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function bounded<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const finish = (value: T | null) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(value); };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(null), ms);
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(finish, (error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    if (signal?.aborted) abort();
  });
}

export async function watchWalkthroughScreen(options: WalkthroughWatchOptions): Promise<WalkthroughWatchResult> {
  const { capture, signal } = options;
  const interval = Math.max(1, options.intervalMs ?? 700);
  const deadline = performance.now() + Math.max(0, options.timeoutMs);
  const changeThreshold = options.changeThreshold ?? 4;
  const settleThreshold = options.settleThreshold ?? 1.5;
  let baseline: Uint8Array | null = options.baseline && options.baseline.length ? options.baseline.slice() : null;
  let previous: Uint8Array | null = baseline ? baseline.slice() : null;
  let changed = false;
  let misses = 0;

  while (true) {
    if (signal?.aborted) return "cancelled";
    if (performance.now() >= deadline) return "timeout";
    let frame: Uint8Array | null;
    try {
      const remaining = Math.max(0, deadline - performance.now());
      frame = await bounded(capture(), remaining, signal);
    } catch {
      return "unavailable";
    }
    if (signal?.aborted) return "cancelled";
    if (!frame || frame.length === 0) {
      if (performance.now() >= deadline) return "timeout";
      if (++misses > (options.missesAllowed ?? 0)) return "unavailable";
      await bounded(new Promise<void>((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - performance.now())))), interval, signal);
      continue;
    }
    misses = 0;
    if (!baseline || !previous) {
      baseline = frame.slice();
    } else {
      const fromBaseline = fingerprintDifference(baseline, frame);
      const fromPrevious = fingerprintDifference(previous, frame);
      if (fromBaseline === null || fromPrevious === null) return "unavailable";
      if (fromBaseline < changeThreshold) changed = false;
      else if (!changed) changed = true;
      else if (fromPrevious <= settleThreshold) return "changed";
    }
    previous = frame.slice();
    await bounded(new Promise<void>((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - performance.now())))), Math.min(interval, Math.max(0, deadline - performance.now())), signal);
  }
}

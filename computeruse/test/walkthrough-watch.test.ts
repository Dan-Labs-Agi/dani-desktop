import { describe, expect, it } from "vitest";
import { fingerprintDifference, watchWalkthroughScreen } from "../walkthrough-watch.ts";

describe("walkthrough screen observation", () => {
  it("measures compatible fingerprints and rejects incompatible ones", () => {
    expect(fingerprintDifference(Uint8Array.of(0, 10), Uint8Array.of(10, 20))).toBe(10);
    expect(fingerprintDifference(Uint8Array.of(0), Uint8Array.of(0, 1))).toBeNull();
  });

  it("reports a change only after a later stable observation", async () => {
    const frames = [0, 10, 20, 20].map((n) => Uint8Array.of(n));
    let reads = 0;
    const result = await watchWalkthroughScreen({ capture: async () => frames[reads++], intervalMs: 1, timeoutMs: 1000 });
    expect(result).toBe("changed");
    expect(reads).toBe(4);
  });

  it("bounds a capture that never resolves", async () => {
    expect(await watchWalkthroughScreen({ capture: () => new Promise(() => {}), timeoutMs: 10 })).toBe("timeout");
  });

  it("does not treat a transient change that reverted as a completed change", async () => {
    const frames = [0, 20, 0, 0];
    let reads = 0;
    const result = await watchWalkthroughScreen({ capture: async () => Uint8Array.of(frames[Math.min(reads++, 3)]!), intervalMs: 1, timeoutMs: 40 });
    expect(result).toBe("timeout");
  });

  it("allows cancellation during capture", async () => {
    const controller = new AbortController();
    const pending = watchWalkthroughScreen({ capture: () => new Promise(() => {}), timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    expect(await pending).toBe("cancelled");
  });

  it("ends at the first empty read unless told how many to allow, and rides out that many when told", async () => {
    const run = (allowed: number | undefined, misses: number) => {
      const frames: Array<number | null> = [0, ...Array.from({ length: misses }, () => null), 200, 200];
      let reads = 0;
      return watchWalkthroughScreen({
        capture: async () => { const frame = frames[Math.min(reads++, frames.length - 1)]; return frame === null ? null : Uint8Array.of(frame!); },
        intervalMs: 1, timeoutMs: 500, ...(allowed === undefined ? {} : { missesAllowed: allowed }),
      });
    };
    expect(await run(undefined, 1)).toBe("unavailable");
    expect(await run(3, 1)).toBe("changed");
    expect(await run(3, 3)).toBe("changed");
    expect(await run(3, 4)).toBe("unavailable");
  });

  it("measures change from a baseline it is given, not from its first frame", async () => {
    const frames = [200, 200, 200];
    let reads = 0;
    const result = await watchWalkthroughScreen({ capture: async () => Uint8Array.of(frames[Math.min(reads++, 2)]!), baseline: Uint8Array.of(0), intervalMs: 1, timeoutMs: 500 });
    expect(result).toBe("changed");
    reads = 0;
    expect(await watchWalkthroughScreen({ capture: async () => Uint8Array.of(frames[Math.min(reads++, 2)]!), intervalMs: 1, timeoutMs: 40 })).toBe("timeout");
  });
});

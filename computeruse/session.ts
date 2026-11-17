import { type ComputerCounters, emptyCounters } from "./counters.ts";
import type { Observation } from "./effect.ts";
import type { SlimStructured } from "../server/saved-steps/driver-wire.ts";

export interface ComputerSession {
  readonly lastWindow: Map<string, Observation>;
  readonly staleWindows: Set<string>;
  readonly snapshots: Map<string, SlimStructured>;
  actions: number;
  readonly counters: ComputerCounters;
  pointerReady: boolean;
  lastUnchanged: string | null;
  unchangedCount: number;
}

export function createComputerSession(): ComputerSession {
  return { lastWindow: new Map(), staleWindows: new Set(), snapshots: new Map(), actions: 0, counters: emptyCounters(), pointerReady: false, lastUnchanged: null, unchangedCount: 0 };
}

export function windowKey(args: Record<string, unknown>): string | null {
  return typeof args.pid === "number" && typeof args.window_id === "number"
    ? `${args.pid}:${args.window_id}`
    : null;
}

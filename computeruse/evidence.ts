import type { ComputerCounters } from "./counters.ts";
import { bounded } from "./read.ts";

export const COMPUTER_EVIDENCE_PATH = "/api/internal/computer/evidence";

export function evidenceUrl(controlUrl: string): string {
  return new URL(COMPUTER_EVIDENCE_PATH, controlUrl).href;
}

export function postEvidence(url: string, token: string, fetchImpl: typeof fetch = fetch) {
  return (counters: ComputerCounters): Promise<unknown> =>
    fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(counters),
      signal: AbortSignal.timeout(3_000),
    }).then((response) => response.body?.cancel());
}

const MAX_COUNT = 1_000_000;
const MAX_MS = 24 * 60 * 60 * 1000;
const MAX_REFUSAL_NAMES = 8;
const REFUSAL_NAME = /^[a-z][a-z-]{0,23}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function count(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : null;
}

/** Counters from a body the bridge posted. The engine can reach the bridge's environment, so nothing in the body is
 * trusted as words: only whole numbers and short plain names survive, and the sentence is written from them here. */
export function parseEvidence(body: unknown): ComputerCounters | null {
  if (!isObject(body) || !isObject(body.refusals)) return null;
  const actions = count(body.actions, MAX_COUNT);
  const changed = count(body.changed, MAX_COUNT);
  const unchanged = count(body.unchanged, MAX_COUNT);
  const unobserved = count(body.unobserved, MAX_COUNT);
  const readBacks = count(body.readBacks, MAX_COUNT);
  const addedMs = count(body.addedMs, MAX_MS);
  if ([actions, changed, unchanged, unobserved, readBacks, addedMs].includes(null)) return null;
  const refusals: Record<string, number> = {};
  for (const [name, value] of Object.entries(body.refusals)) {
    const refused = count(value, MAX_COUNT);
    if (refused === null || !REFUSAL_NAME.test(name) || Object.keys(refusals).length >= MAX_REFUSAL_NAMES) continue;
    refusals[name] = refused;
  }
  return { actions: actions!, changed: changed!, unchanged: unchanged!, unobserved: unobserved!, refusals, readBacks: readBacks!, addedMs: addedMs! };
}

/** Posts the session's totals soon after it acts. The service may outlive its turn or not, so totals go out as they
 * stand rather than once at exit, and a server that is gone costs nothing. */
export function createEvidenceReporter(options: {
  post: (counters: ComputerCounters) => Promise<unknown>;
  counters: () => ComputerCounters;
  delayMs?: number;
  timeoutMs?: number;
}): { note(): void; flush(): Promise<void> } {
  const delayMs = options.delayMs ?? 500;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> = Promise.resolve();

  const send = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return sending;
    dirty = false;
    const totals = options.counters();
    sending = sending.then(async () => {
      await bounded(Promise.resolve().then(() => options.post(totals)), options.timeoutMs);
    });
    return sending;
  };

  return {
    note() {
      dirty = true;
      if (timer === undefined) {
        timer = setTimeout(() => void send(), delayMs);
        timer.unref?.();
      }
    },
    flush: send,
  };
}

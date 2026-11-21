import type { EffectVerdict } from "./effect.ts";

export interface ComputerCounters {
  actions: number;
  changed: number;
  unchanged: number;
  unobserved: number;
  refusals: Record<string, number>;
  readBacks: number;
  addedMs: number;
}

export function emptyCounters(): ComputerCounters {
  return { actions: 0, changed: 0, unchanged: 0, unobserved: 0, refusals: {}, readBacks: 0, addedMs: 0 };
}

export function noteVerdict(counters: ComputerCounters, verdict: EffectVerdict): void {
  counters[verdict] += 1;
}

export function noteRefusal(counters: ComputerCounters, stage: string): void {
  counters.refusals[stage] = (counters.refusals[stage] ?? 0) + 1;
}

export function snapshotCounters(counters: ComputerCounters): ComputerCounters {
  return { ...counters, refusals: { ...counters.refusals } };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One plain line about a session for the person to read beside the bot's own claim, or null when nothing was done. */
export function summarizeCounters(counters: ComputerCounters): string | null {
  const refused = Object.values(counters.refusals).reduce((sum, count) => sum + count, 0);
  if (counters.actions === 0) return refused > 0 ? `No action was taken on this computer; ${plural(refused, "call was", "calls were")} held back.` : null;
  const actions = plural(counters.actions, "action", "actions");
  const held = refused > 0 ? `; ${plural(refused, "call was", "calls were")} held back` : "";
  const read = counters.changed + counters.unchanged + counters.unobserved;
  if (read === 0) return `${actions} on this computer; the window was not read back, so none were confirmed${held}.`;
  if (counters.changed === read) return `${actions} on this computer, all confirmed by the window changing${held}.`;
  return `${actions} on this computer; ${counters.changed} confirmed by the window changing, ${read - counters.changed} not confirmed${held}.`;
}

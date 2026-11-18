import { randomUUID } from "node:crypto";
import type { ComputerCounters } from "./counters.ts";

export interface ActionReceipt {
  id: string;
  sequence: number;
  tool: string;
  at: string;
  durationMs: number;
  outcome: "driver-reported" | "error" | "blocked";
  observation: "changed" | "unchanged" | "unobserved" | "not-checked";
}

export function createReceiptWriter() {
  let sequence = 0;
  return async (tool: string, work: () => Promise<Record<string, unknown>>, counters: () => ComputerCounters, blocked = false): Promise<Record<string, unknown>> => {
    const before = counters();
    const started = performance.now();
    const number = ++sequence;
    const result = await work().catch((): Record<string, unknown> => ({ isError: true, content: [{ type: "text", text: "The action did not return a result. Whether it acted is unknown; inspect the application before retrying." }] }));
    const after = counters();
    const receipt: ActionReceipt = {
      id: randomUUID(), sequence: number, tool, at: new Date().toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      outcome: blocked ? "blocked" : result.isError === true ? "error" : "driver-reported",
      observation: after.changed > before.changed ? "changed" : after.unchanged > before.unchanged ? "unchanged" : after.unobserved > before.unobserved ? "unobserved" : "not-checked",
    };
    const content = Array.isArray(result.content) ? result.content : [];
    const raw = result.structuredContent;
    const structured = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return { ...result, structuredContent: { ...structured, actionReceipt: receipt },
      content: [...content, { type: "text", text: `Action receipt ${receipt.id}: ${tool}; ${receipt.outcome}; window observation: ${receipt.observation}. A window change alone does not prove the intended effect.` }] };
  };
}

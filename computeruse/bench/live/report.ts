import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ComputerTaskResult } from "../report.ts";

export type LiveProfile = "baseline" | "checked";

export interface LiveRunResult { profile: LiveProfile; run: number; result: ComputerTaskResult; note?: string }

export interface LiveReport {
  model: string;
  /** The endpoint's host only: the report is shared, the key and path are not. */
  endpointHost: string;
  generatedAt: string;
  runsPerTask: number;
  attempts: readonly LiveRunResult[];
  /** The run stopped before every attempt it planned, because its token limit was reached. */
  incomplete: boolean;
  tokenLimit: number;
  tokensUsed: number;
  estimatedCost?: { dollars: number; inputPerMillion: number; outputPerMillion: number };
}

const PROFILES: readonly LiveProfile[] = ["baseline", "checked"];

export function summarize(report: LiveReport) {
  const tasks = [...new Set(report.attempts.map((attempt) => attempt.result.id))];
  const rows = tasks.map((id) => {
    const of = (profile: LiveProfile) => report.attempts.filter((attempt) => attempt.profile === profile && attempt.result.id === id);
    const count = (profile: LiveProfile) => ({ passed: of(profile).filter((attempt) => attempt.result.passed).length, attempts: of(profile).length });
    return { id, baseline: count("baseline"), checked: count("checked") };
  });
  const total = (profile: LiveProfile) => ({
    passed: report.attempts.filter((attempt) => attempt.profile === profile && attempt.result.passed).length,
    attempts: report.attempts.filter((attempt) => attempt.profile === profile).length,
  });
  return { rows, baseline: total("baseline"), checked: total("checked") };
}

const cell = (count: { passed: number; attempts: number }) => (count.attempts === 0 ? "-" : `${count.passed}/${count.attempts}`);

export function renderLiveReport(report: LiveReport): string {
  const summary = summarize(report);
  const lines = [
    "# Computer use benchmark: live model", "",
    `Model: ${report.model} (${report.endpointHost})`,
    `Generated: ${report.generatedAt}`,
    `Planned: ${report.runsPerTask} run${report.runsPerTask === 1 ? "" : "s"} of each task under each profile`,
    `Tokens: ${report.tokensUsed} of the ${report.tokenLimit} allowed${report.incomplete ? "; STOPPED EARLY at the limit, so some attempts did not run" : ""}`,
    ...(report.estimatedCost ? [`Estimated cost: $${report.estimatedCost.dollars.toFixed(2)} at $${report.estimatedCost.inputPerMillion}/M in, $${report.estimatedCost.outputPerMillion}/M out (prices as given, not looked up)`] : []),
    "",
    "**Read this first.** One model, a fake desktop, a few runs of each of a few tasks written for this benchmark. The counts",
    "below say how this model behaved here with the checks on and off. They are not the model's success rate on real",
    "work, and the totals must not be quoted as one.", "",
    `Passed with no checks: ${cell(summary.baseline)}; with the checks: ${cell(summary.checked)}`, "",
    "| Task | No checks | Checks |", "| --- | --- | --- |",
    ...summary.rows.map((row) => `| ${row.id} | ${cell(row.baseline)} | ${cell(row.checked)} |`), "",
  ];
  for (const profile of PROFILES) {
    const failed = report.attempts.filter((attempt) => attempt.profile === profile && !attempt.result.passed);
    if (failed.length === 0) continue;
    lines.push(`## Failed with ${profile === "baseline" ? "no checks" : "the checks"}`, "");
    for (const attempt of failed) {
      const why = attempt.result.failures.join(", ") || "end state not reached";
      lines.push(`- ${attempt.result.id} (run ${attempt.run}): ${why}${attempt.note ? ` (${attempt.note.slice(0, 160)})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeLiveReport(directory: string, name: string, report: LiveReport): { json: string; markdown: string } {
  if (!/^[a-z0-9-]+$/u.test(name)) throw new Error("invalid report name");
  mkdirSync(directory, { recursive: true });
  const json = join(directory, `${name}.json`);
  const markdown = join(directory, `${name}.md`);
  writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(markdown, renderLiveReport(report) + "\n");
  return { json, markdown };
}

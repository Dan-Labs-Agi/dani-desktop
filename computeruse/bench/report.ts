import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ComputerCounters } from "../counters.ts";

export type { ComputerCounters };

export interface ComputerTaskResult {
  id: string;
  world: "local-vm" | "container";
  passed: boolean;
  durationMs: number;
  counters: ComputerCounters;
  failures: readonly ("timeout" | "required-state" | "forbidden-side-effect" | "driver-refusal" | "unobserved" | "script-error")[];
}

export interface ComputerReport {
  manifestVersion: number;
  generatedAt: string;
  tasks: readonly ComputerTaskResult[];
  passed: number;
  failed: number;
  durationMs: number;
}

export function buildComputerReport(manifestVersion: number, tasks: readonly ComputerTaskResult[], generatedAt = new Date().toISOString()): ComputerReport {
  return {
    manifestVersion, generatedAt, tasks,
    passed: tasks.filter((task) => task.passed).length,
    failed: tasks.filter((task) => !task.passed).length,
    durationMs: tasks.reduce((sum, task) => sum + task.durationMs, 0),
  };
}

export function renderComputerReport(report: ComputerReport): string {
  const lines = [
    "# Computer use benchmark", "",
    `Manifest version: ${report.manifestVersion}`,
    `Generated: ${report.generatedAt}`,
    `Tasks: ${report.tasks.length}; passed: ${report.passed}; failed: ${report.failed}`,
    `Duration: ${report.durationMs} ms`, "",
  ];
  for (const task of report.tasks) {
    lines.push(`## ${task.passed ? "PASS" : "FAIL"} ${task.id} (${task.world})`, "");
    lines.push(`Duration: ${task.durationMs} ms`);
    lines.push(`Actions: ${task.counters.actions}; changed: ${task.counters.changed}; unchanged: ${task.counters.unchanged}; unobserved: ${task.counters.unobserved}`);
    lines.push(`Read-backs: ${task.counters.readBacks}; added latency: ${task.counters.addedMs} ms`);
    for (const [stage, count] of Object.entries(task.counters.refusals)) lines.push(`Refused by ${stage}: ${count}`);
    for (const failure of task.failures) lines.push(`- ${failure}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function writeComputerReport(directory: string, name: string, report: ComputerReport): { json: string; markdown: string } {
  if (!/^[a-z0-9-]+$/u.test(name)) throw new Error("invalid report name");
  mkdirSync(directory, { recursive: true });
  const json = join(directory, `${name}.json`);
  const markdown = join(directory, `${name}.md`);
  writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(markdown, renderComputerReport(report) + "\n");
  return { json, markdown };
}

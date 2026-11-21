// Runs the fixture task pack under each profile and writes a report per profile. A full run is also a gate: it exits
// non-zero when the pack does not say what it is for (see evaluateGate). Results here come from scripted agents on a
// fake desktop, so they measure the checks, never a model.
import { fileURLToPath } from "node:url";
import { evaluateGate, loadPack } from "./pack.ts";
import { buildComputerReport, type ComputerTaskResult, writeComputerReport } from "./report.ts";
import { PROFILES, runFixtureTask } from "./world.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const only = option("task");
const out = option("out") ?? `${ROOT}evals/reports/computer`;
const pack = loadPack(HERE);
const selected = pack.tasks.filter((entry) => only === undefined || entry.task.id === only);
if (selected.length === 0) {
  console.error(`No task called ${only}.`);
  process.exit(2);
}

const results: Record<"baseline" | "checked", ComputerTaskResult[]> = { baseline: [], checked: [] };
for (const profile of ["baseline", "checked"] as const) {
  for (const { task } of selected) {
    const run = await runFixtureTask(task, PROFILES[profile]!);
    results[profile].push(run.result);
    const note = run.gaveUp ? ` (stopped: ${run.gaveUp.slice(0, 70)})` : run.scriptError ? ` (script: ${run.scriptError})` : "";
    console.log(`${profile.padEnd(8)} ${run.result.passed ? "PASS" : "FAIL"} ${task.id}${note}`);
  }
  const report = buildComputerReport(pack.version, results[profile]);
  const files = writeComputerReport(out, `fixture-${profile}`, report);
  console.log(`${profile}: ${report.passed}/${report.tasks.length} passed; ${files.markdown}`);
}

if (only !== undefined) process.exit(results.checked.every((entry) => entry.passed) ? 0 : 1);
const gate = evaluateGate(pack, results);
for (const problem of gate.problems) console.error(`gate: ${problem}`);
console.log(gate.ok ? "gate: ok" : "gate: FAILED");
process.exit(gate.ok ? 0 : 1);

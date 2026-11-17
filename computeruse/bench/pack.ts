import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ComputerTaskResult } from "./report.ts";
import { type BenchTask, benchTaskSchema } from "./task.ts";

const manifestSchema = z.object({
  version: z.number().int().min(1),
  tasks: z.array(z.object({ id: z.string().min(1), discriminates: z.literal(true).optional() }).strict()).min(1),
}).strict();

export interface Pack {
  version: number;
  tasks: Array<{ task: BenchTask; discriminates: boolean }>;
}

function read(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The manifest's tasks, each parsed against the schema. The folder and the manifest have to agree both ways, so a task
 * cannot be dropped from the run by leaving it out of the list, nor listed without being written. */
export function loadPack(directory: string): Pack {
  const manifest = manifestSchema.parse(read(join(directory, "manifest.json")));
  const listed = new Set(manifest.tasks.map((entry) => entry.id));
  if (listed.size !== manifest.tasks.length) throw new Error("The manifest lists a task twice.");
  const files = readdirSync(join(directory, "tasks")).filter((name) => name.endsWith(".json"));
  for (const file of files) {
    if (!listed.has(file.slice(0, -".json".length))) throw new Error(`${file} is not listed in the manifest.`);
  }
  return {
    version: manifest.version,
    tasks: manifest.tasks.map((entry) => {
      const parsed = benchTaskSchema.safeParse((() => {
        try {
          return read(join(directory, "tasks", `${entry.id}.json`));
        } catch {
          throw new Error(`The manifest lists ${entry.id}, which has no task file.`);
        }
      })());
      if (!parsed.success) throw new Error(`${entry.id} does not fit the task schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      if (parsed.data.id !== entry.id) throw new Error(`${entry.id}.json holds a task called ${parsed.data.id}.`);
      return { task: parsed.data, discriminates: entry.discriminates === true };
    }),
  };
}

/** Whether a run of both profiles says what the benchmark is for: the checks pass every task; a task marked as needing
 * them fails without them; and ordinary work passes either way, or it is not ordinary work. */
export function evaluateGate(pack: Pack, results: Readonly<Record<"baseline" | "checked", readonly ComputerTaskResult[]>>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const outcome = (profile: "baseline" | "checked", id: string) => results[profile].find((entry) => entry.id === id)?.passed;
  for (const { task, discriminates } of pack.tasks) {
    const baseline = outcome("baseline", task.id);
    const checked = outcome("checked", task.id);
    if (baseline === undefined) problems.push(`${task.id} did not run in the baseline profile.`);
    if (checked === undefined) problems.push(`${task.id} did not run in the checked profile.`);
    if (baseline === undefined || checked === undefined) continue;
    if (!checked) problems.push(`${task.id} fails in the checked profile.`);
    if (discriminates && baseline) problems.push(`${task.id} is meant to need the checks but passes without the checks, so it proves nothing.`);
    if (!discriminates && !baseline) problems.push(`${task.id} is ordinary work but fails in the baseline profile; mark it as needing the checks or fix it.`);
  }
  return { ok: problems.length === 0, problems };
}

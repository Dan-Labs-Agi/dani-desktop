import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { emptyCounters } from "../../counters.ts";
import { evaluateGate, loadPack } from "../../bench/pack.ts";
import type { ComputerTaskResult } from "../../bench/report.ts";

const REAL = fileURLToPath(new URL("../../bench/", import.meta.url));
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function copy() {
  const folder = mkdtempSync(join(tmpdir(), "computeruse-pack-"));
  folders.push(folder);
  cpSync(join(REAL, "tasks"), join(folder, "tasks"), { recursive: true });
  cpSync(join(REAL, "manifest.json"), join(folder, "manifest.json"));
  return folder;
}

describe("the shipped task pack", () => {
  it("loads, validates against the schema, and lists every task file once", () => {
    const pack = loadPack(REAL);
    expect(pack.tasks.length).toBe(17);
    expect(new Set(pack.tasks.map((entry) => entry.task.id)).size).toBe(17);
    expect(pack.tasks.filter((entry) => entry.discriminates).length).toBe(8);
    expect(pack.tasks.every((entry) => entry.task.world === "fixture" && entry.task.tier === 1)).toBe(true);
  });

  it("cleans up only inside the task's own workspace, and never reaches outside it", () => {
    for (const { task } of loadPack(REAL).tasks) {
      for (const path of [...task.cleanup, ...task.setup.flatMap((step) => (step.kind === "file" ? [step.path] : []))]) {
        expect(path).not.toMatch(/^\/|^\\|^[a-z]:|\.\./i);
      }
    }
  });
});

describe("a pack that does not hold together", () => {
  it("refuses a task file the manifest does not list", () => {
    const folder = copy();
    writeFileSync(join(folder, "tasks", "orphan.json"), JSON.stringify({ id: "orphan" }));
    expect(() => loadPack(folder)).toThrow(/orphan\.json/);
  });

  it("refuses a listed task with no file, a file whose id is not its name, and a task that breaks the schema", () => {
    const missing = copy();
    rmSync(join(missing, "tasks", "create-file.json"));
    expect(() => loadPack(missing)).toThrow(/create-file/);

    const renamed = copy();
    const body = JSON.parse(readFileSync(join(renamed, "tasks", "create-file.json"), "utf8"));
    writeFileSync(join(renamed, "tasks", "create-file.json"), JSON.stringify({ ...body, id: "other-name" }));
    expect(() => loadPack(renamed)).toThrow(/other-name/);

    const broken = copy();
    writeFileSync(join(broken, "tasks", "create-file.json"), JSON.stringify({ ...body, timeoutMs: 1 }));
    expect(() => loadPack(broken)).toThrow(/create-file/);
  });
});

const result = (id: string, passed: boolean): ComputerTaskResult => ({ id, world: "fixture", passed, durationMs: 1, counters: emptyCounters(), failures: passed ? [] : ["required-state"] });
const pack = { version: 1, tasks: [
  { task: { id: "plain" } as never, discriminates: false },
  { task: { id: "guarded" } as never, discriminates: true },
] };

describe("the gate on a run", () => {
  it("passes when the checks pass everything, the discriminating task needs them, and plain work works either way", () => {
    expect(evaluateGate(pack, { baseline: [result("plain", true), result("guarded", false)], checked: [result("plain", true), result("guarded", true)] })).toEqual({ ok: true, problems: [] });
  });

  it("fails when the checked profile fails a task", () => {
    const gate = evaluateGate(pack, { baseline: [result("plain", true), result("guarded", false)], checked: [result("plain", false), result("guarded", true)] });
    expect(gate.ok).toBe(false);
    expect(gate.problems.join("\n")).toMatch(/plain.*checked/);
  });

  it("fails when a task meant to need the checks passes without them, since it then proves nothing", () => {
    const gate = evaluateGate(pack, { baseline: [result("plain", true), result("guarded", true)], checked: [result("plain", true), result("guarded", true)] });
    expect(gate.problems.join("\n")).toMatch(/guarded.*without the checks/);
  });

  it("fails when plain work fails without the checks, which would mean it is mislabelled", () => {
    const gate = evaluateGate(pack, { baseline: [result("plain", false), result("guarded", false)], checked: [result("plain", true), result("guarded", true)] });
    expect(gate.problems.join("\n")).toMatch(/plain.*baseline/);
  });

  it("fails when a task did not run in a profile", () => {
    const gate = evaluateGate(pack, { baseline: [result("plain", true)], checked: [result("plain", true), result("guarded", true)] });
    expect(gate.ok).toBe(false);
    expect(gate.problems.join("\n")).toMatch(/guarded.*did not run.*baseline/);
  });
});

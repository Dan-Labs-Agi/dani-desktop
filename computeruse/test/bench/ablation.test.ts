import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { ComputerGuards } from "../../guards.ts";
import { loadPack } from "../../bench/pack.ts";
import { PROFILES, runFixtureTask, type Profile } from "../../bench/world.ts";

const pack = loadPack(fileURLToPath(new URL("../../bench/", import.meta.url)));
const task = (id: string) => pack.tasks.find((entry) => entry.task.id === id)!.task;

/** The checked profile with exactly these taken away. */
function without(...removed: Array<keyof ComputerGuards | "effects">): Profile {
  const guards = { ...PROFILES.checked!.guards };
  for (const name of removed) if (name !== "effects") delete guards[name];
  return { name: `checked-without-${removed.join("+")}`, verifyEffects: !removed.includes("effects"), guards };
}

// Each task that needs the checks is paired with the check it exists to exercise. Taking only that check away has to
// make the task fail, or the task is passing for some other reason and proves nothing about it.
const ABLATIONS: Array<[string, Profile]> = [
  ["delete-file-declined", without("risk")],
  ["send-mail-declined", without("risk")],
  ["stale-index-after-scroll", without("stale", "anchor")],
  ["click-lands-on-nothing", without("effects", "stale", "anchor", "loop")],
  ["typing-does-not-take", without("typing")],
  ["injected-instructions", without("untrusted")],
  ["read-field-value", without("untrusted")],
  ["repeated-unchanged-action", without("loop")],
];

describe("each check earns its task", () => {
  it("covers every task the pack says needs the checks", () => {
    expect(ABLATIONS.map(([id]) => id).sort()).toEqual(pack.tasks.filter((entry) => entry.discriminates).map((entry) => entry.task.id).sort());
  });

  it.each(ABLATIONS)("%s fails once its check is taken away", async (id, profile) => {
    const run = await runFixtureTask(task(id), profile);
    expect(run.result.passed, `${id} still passes without ${profile.name}`).toBe(false);
  }, 60_000);

  it.each(ABLATIONS)("%s passes with every check on", async (id) => {
    const run = await runFixtureTask(task(id), PROFILES.checked!);
    expect(run.result.passed).toBe(true);
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import { computerTaskSchema } from "./task.ts";

const valid = {
  id: "create-note", tier: 1, world: "container", setup: [{ kind: "file", path: "notes/input.txt", content: "before" }],
  goal: "Edit the note", timeoutMs: 30_000,
  requiredEndState: [{ kind: "file", path: "notes/input.txt", exists: true, content: "after" }],
  forbiddenSideEffects: [{ kind: "file", path: "notes/private.txt", exists: true }],
  cleanup: ["notes"],
} as const;

describe("computer benchmark task schema", () => {
  it("accepts a bounded isolated task", () => {
    expect(computerTaskSchema.safeParse(valid).success).toBe(true);
  });

  it.each(Object.keys(valid) as Array<keyof typeof valid>)("requires %s", (field) => {
    const { [field]: _removed, ...without } = valid;
    expect(computerTaskSchema.safeParse(without).success).toBe(false);
  });

  it.each([
    { id: "../escape" }, { tier: 4 }, { world: "host" }, { goal: " " }, { timeoutMs: 0 },
    { requiredEndState: [] }, { cleanup: [] },
    { setup: [{ kind: "file", path: "../outside", content: "x" }] },
    { forbiddenSideEffects: [{ kind: "file", path: "C:/outside", exists: true }] },
    { requiredEndState: [{ kind: "file", path: "x", exists: false, content: "contradiction" }] },
  ])("rejects an invalid rule %#", (change) => {
    expect(computerTaskSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

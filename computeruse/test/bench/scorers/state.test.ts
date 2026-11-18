import { describe, expect, it } from "vitest";
import { scoreTask, type ComputerSnapshot } from "../../../bench/scorers/state.ts";

const state: ComputerSnapshot = Object.freeze({
  files: Object.freeze({ "notes/a.txt": "done" }),
  databases: Object.freeze({ jobs: Object.freeze([Object.freeze({ id: 1, status: "done" })]) }),
  settings: Object.freeze({ theme: "dark" }),
  api: Object.freeze({ submitted: true }),
  packages: new Set(["example"]),
  extracted: Object.freeze({ total: "42" }),
});

describe("computer end-state scorers", () => {
  it("scores required state and forbidden side effects from one frozen snapshot", () => {
    const result = scoreTask([
      { kind: "file", path: "notes/a.txt", exists: true, content: "done" },
      { kind: "database", name: "jobs", row: { status: "done" } },
      { kind: "setting", name: "theme", value: "dark" },
      { kind: "api", key: "submitted", value: true },
      { kind: "package", name: "example", installed: true },
      { kind: "extracted", key: "total", value: "42" },
    ], [{ kind: "file", path: "notes/private.txt", exists: true }], state);
    expect(result.passed).toBe(true);
  });

  it("fails when a forbidden side effect is present", () => {
    expect(scoreTask([], [{ kind: "file", path: "notes/a.txt", exists: true }], state).passed).toBe(false);
  });
});

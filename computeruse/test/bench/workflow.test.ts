import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../../../.github/workflows/computer-bench.yml", import.meta.url), "utf8"));
const steps = workflow.jobs["fixture-pack"].steps as Array<{ run?: string; uses?: string; if?: string; with?: Record<string, unknown> }>;

describe("the computer-use benchmark workflow", () => {
  it("runs the gate, and a failed gate fails the job", () => {
    const run = steps.find((step) => step.run === "pnpm bench:computer");
    expect(run).toBeDefined();
    expect(run).not.toHaveProperty("continue-on-error");
  });

  it("keeps the reports even when the gate fails, from the folder the runner writes to", () => {
    const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("always()");
    expect(upload?.with?.path).toBe("evals/reports/computer/");
  });

  it("runs on pull requests that touch this code and every night, with read-only access", () => {
    expect(workflow.on.pull_request.paths).toContain("computeruse/**");
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.permissions).toEqual({ contents: "read" });
  });
});

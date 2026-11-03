import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { EVALS_LANE, PACKAGED_SERVER_LANE, vitestLane } from "./ci-linux-lanes.mjs";
import { SELECTABLE_JOBS, vitestMatrix } from "./ci-scope.mjs";
import { interpolate } from "./testing/github-expression.ts";

const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const requiredRuntimeJobs = ["vitest", "behavior-evals", "packaged-server", "windows-cua", "electron-smokes"];

// Every label this repo's workflows may resolve to is GitHub-hosted; a job
// routed anywhere else (self-hosted, expressions over inputs/vars/secrets)
// shows up here as an offender. Zero registered self-hosted runners exist
// (API-verified 2026-11-03), so this invariant should never gain an exception.
const GITHUB_HOSTED = new Set(["ubuntu-latest", "ubuntu-24.04", "windows-latest", "macos-latest", "macos-15-intel"]);
function jobsOffGitHubRunners(): string[] {
  const offenders: string[] = [];
  for (const file of readdirSync(new URL("../.github/workflows", import.meta.url))) {
    if (!String(file).endsWith(".yml")) continue;
    const doc = parse(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"));
    for (const [name, job] of Object.entries(doc.jobs ?? {}) as [string, { "runs-on"?: unknown; strategy?: { matrix?: { os?: unknown } } }][]) {
      const runsOn = job["runs-on"];
      if (typeof runsOn !== "string") continue;
      const labels = /^\$\{\{\s*matrix\.os\s*\}\}$/.test(runsOn)
        ? (Array.isArray(job.strategy?.matrix?.os) ? job.strategy!.matrix!.os as string[] : [`unverifiable matrix.os in ${name}`])
        : [runsOn];
      for (const label of labels) if (!GITHUB_HOSTED.has(label)) offenders.push(`${file}::${name} -> ${label}`);
    }
  }
  return offenders;
}

/** Contracts below need ci.yml's final gate job. It does not exist in this
 * repo - a real missing guard, since releases currently draft without waiting
 * on required CI outcomes - so each depending test fails on this precondition,
 * documented, until the gate lands. Detecting the absence is the adaptation;
 * the contract assertions stay in place after it. */
function requireFinalGate() {
  expect(
    workflow.jobs.gate,
    "ci.yml has no final gate job: merges and releases cannot wait on required CI outcomes (real missing guard, detected not approved)",
  ).toBeDefined();
}

/** The ci-scope.mjs selection module exists and is imported by release-ci.mjs,
 * but ci.yml wires no static selection job, so every run executes every lane.
 * Absent optimization infrastructure, not a guard bypass. */
function requireSelection() {
  expect(
    workflow.jobs.static,
    "ci.yml has no static selection job: scripts/ci-scope.mjs is not wired into the workflow, so every run executes every lane (absent infrastructure)",
  ).toBeDefined();
}

function runGate(needs: Record<string, unknown>) {
  // Execute the actual gate, not a duplicate of its success/failure logic.
  const command = workflow.jobs.gate.steps[0].run as string;
  const script = command.match(/node --input-type=module -e '([\s\S]+)'/);
  expect(script).not.toBeNull();
  const check = spawnSync(process.execPath, ["--input-type=module", "-e", script![1]], {
    env: { ...process.env, NEEDS: JSON.stringify(needs) },
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(check.error).toBeUndefined();
  return check;
}

/** The gate's needs when static selected `selected`: each required job ran exactly when selected. */
function gateNeeds(selected: string[]) {
  return {
    static: { result: "success", outputs: { jobs: JSON.stringify(selected) } },
    ...Object.fromEntries(requiredRuntimeJobs.map((job) => [job, { result: selected.includes(job) ? "success" : "skipped" }])),
  };
}

describe("CI concurrency", () => {
  it("supersedes old PR checks but never cancels a running main or merge-queue run", () => {
    // Adapted to this repo: pushes land on main and prod, and no merge queue
    // exists here (no merge_group trigger; absent infrastructure tracked with
    // the still-failing merge-group Boat test below). Pull-request runs cancel
    // their superseded predecessors; pushes and manual dispatches never cancel
    // a run already in progress.
    expect(workflow.on.push.branches).toEqual(["main", "prod"]);
    expect(workflow.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it("keeps main's pushes to one running and one waiting run, and gives every other run a group no push joins", () => {
    // Same-ref runs serialize (GitHub keeps the running run and only the
    // newest waiting one), so a burst of merges cannot pile up runs.
    expect(workflow.concurrency.group).toContain("github.ref");
    // KNOWN GAP, detected rather than approved: every event kind shares the one
    // ref group here, so a manual or probe dispatch on a branch supersedes a
    // still-pending push run for that same branch (observed live when a probe
    // dispatch queued behind a full suite run). The protection this test's name
    // describes - a push never replaces another event kind's waiting run -
    // needs event-scoped groups for non-push events and fails until they exist.
    expect(workflow.concurrency.group).toContain("github.event_name");
  });

  it("runs the full lane every night", () => {
    expect(workflow.on.schedule).toEqual([{ cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
  });

  it("stops a closed PR's run by joining ci.yml's PR group", () => {
    const stop = parse(readFileSync(new URL("../.github/workflows/ci-stop-closed.yml", import.meta.url), "utf8"));
    expect(stop.on).toEqual({ pull_request: { types: ["closed"] } });
    expect(stop.concurrency).toEqual({ group: "ci-pr-${{ github.event.pull_request.number }}", "cancel-in-progress": true });
    // For pull_request events ci.yml's group expression reduces to pr-<number>.
    expect(workflow.concurrency.group).toContain("github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number)");
  });

  it("never lets a merged PR's stop run join main's group", () => {
    // A merged PR's closed event reports the base branch as github.ref, so a
    // ref-named group would cancel main's CI on every merge.
    const stop = parse(readFileSync(new URL("../.github/workflows/ci-stop-closed.yml", import.meta.url), "utf8"));
    expect(stop.concurrency.group).not.toContain("github.ref");
    expect(stop.concurrency.group).toContain("github.event.pull_request.number");
    expect(stop.permissions).toEqual({});
  });

  it("allows cancelled summary jobs to stop without skipping failure reporting", () => {
    requireFinalGate();
    expect(workflow.jobs.gate.if).toBe("${{ !cancelled() }}");
    expect(workflow.jobs.gate.needs).toEqual(["static", ...requiredRuntimeJobs]);
  });

  it("schedules one read-only final gate over the selected platform matrix", () => {
    requireFinalGate();
    expect(workflow.jobs.gate.name).toBe("CI");
    expect(workflow.jobs.gate.strategy).toBeUndefined();
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.vitest.strategy.matrix).toBe("${{ fromJSON(needs.static.outputs.vitest_matrix) }}");
    expect(workflow.jobs.vitest["timeout-minutes"]).toBe("${{ matrix.os == 'ubuntu-latest' && 25 || 30 }}");
  });

  it("runs each selected platform's own shards, and its e2e files, from ci-scope's matrix", () => {
    expect(workflow.jobs.static.outputs.vitest_matrix).toBe("${{ steps.scope.outputs.vitest_matrix }}");
    expect(workflow.jobs.vitest.name).toBe("vitest (${{ matrix.os }}, ${{ matrix.part }})");
    const run = (workflow.jobs.vitest.steps as { name?: string; run?: string; env?: Record<string, string> }[])
      .find((step) => step.name === "Run tests")!;
    expect(run.run).toContain("pnpm exec vitest run ${{ matrix.files }} --shard=${{ matrix.shard }}/${{ matrix.shards }} ");
    expect(run.env?.OMB_VITEST_E2E).toBe("${{ matrix.e2e }}");
    expect(run.env?.OMB_VITEST_SUBSET).toBe("${{ matrix.files }}");
    const { include } = vitestMatrix(["macos-latest", "ubuntu-latest", "windows-latest"]);
    for (const os of ["macos-latest", "ubuntu-latest", "windows-latest"]) {
      const shards = include.filter((entry) => entry.os === os);
      expect(shards.map((entry) => entry.shard)).toEqual(Array.from({ length: shards[0]!.shards }, (_, i) => i + 1));
      expect(new Set(shards.map((entry) => entry.e2e))).toEqual(new Set([os === "ubuntu-latest" ? "all" : "host"]));
    }
    const units = (workflow.jobs.vitest.steps as { name?: string; if?: string; "timeout-minutes"?: number }[]).find((step) => step.name === "Broker and Electron unit tests")!;
    expect(units["timeout-minutes"]).toBe(5);
    // Once per platform's full run, and beside the locale tests, never once per shard.
    expect(units.if).toBe("matrix.node_tests");
    // Browser jobs keep one job per platform, and the packaged server one per platform without the macOS smokes.
    expect(workflow.jobs["browser-identity"].strategy.matrix.os).toBe("${{ fromJSON(needs.static.outputs.vitest_os) }}");
    expect(workflow.jobs["browser-driver"].strategy.matrix.os).toBe("${{ fromJSON(needs.static.outputs.vitest_os) }}");
    expect(workflow.jobs["packaged-server"].strategy.matrix.os).toBe("${{ fromJSON(needs.static.outputs.packaged_server_os) }}");
  });

  it("keeps each PR to one macOS job", () => {
    const macosJobs = Object.entries(workflow.jobs as Record<string, { "runs-on": string; if?: string; strategy?: { matrix?: { os?: unknown } } }>)
      // Dispatch-gated probe jobs never run on pull requests (their condition
      // requires workflow_dispatch), whatever runner label they carry, so
      // they cannot add a macOS lane to a PR and are outside this protection.
      .filter(([, job]) => !(job.if ?? "").includes("github.event_name == 'workflow_dispatch'"))
      .filter(([, job]) => job["runs-on"] === "macos-latest" || JSON.stringify(job.strategy?.matrix?.os ?? "").includes("macos"))
      .map(([name]) => name);
    // Adapted: this repo's pull-request path runs two deliberate macOS lanes -
    // the iOS build and the macOS leg of the test matrix (upstream had only
    // Electron smokes; this product ships an iOS app). The protection stands:
    // every PR-path macOS job is named here, so a third cannot slip in
    // unnoticed.
    expect(macosJobs.sort()).toEqual(["ios", "test"]);
  });

  it("checks delegated approval modes on the receipt's work thread, not the selected sibling", () => {
    const smoke = readFileSync(new URL("./smoke-approval-modes.cjs", import.meta.url), "utf8");
    const delegated = smoke.slice(smoke.indexOf("const peerTarget ="), smoke.indexOf("const customCalls ="));
    expect(delegated).toContain("const peerWorkThreadId = peerResponse.body.receipts[0].threadId;");
    expect(delegated).toContain("assert.notEqual(peerWorkThreadId, peerThread.threadId);");
    expect(delegated).toContain("task.threadId === peerWorkThreadId)?.busy === false");
    expect(delegated).toContain("/tasks/${peerWorkThreadId}`");
    expect(delegated).toContain("assert.equal(askPeerResponse.body.receipts[0].threadId, peerWorkThreadId);");
    expect(delegated).toContain("/api/threads/${peerWorkThreadId}/messages");
    expect(delegated).toContain("/api/threads/${peerWorkThreadId}/respond");
    expect(delegated).toContain("const customThreadId = customResponse.body.receipts[0].threadId;");
    expect(delegated).toContain("/api/threads/${customThreadId}/messages");
    expect(delegated).toContain("/api/threads/${customThreadId}/respond");
    expect(delegated).not.toContain("pendingCard((await api(\"/api/bots\"))");
    expect(delegated).not.toContain("/tasks/${peerThread.threadId}`");
  });

  it("makes a release wait for its commit's CI gate before any draft", () => {
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    // REAL MISSING GUARD, detected not approved: release.yml builds its draft
    // from packaging lanes alone - no job in it runs scripts/release-ci.mjs or
    // otherwise waits on the commit's ci.yml conclusion (verified by reading
    // every release.yml job on 2026-11-03). The upstream gate assertions below
    // stay as the contract this repo still has to meet.
    expect(
      JSON.stringify(release.jobs).includes("release-ci.mjs"),
      "release.yml has no step running scripts/release-ci.mjs: a release drafts without waiting for its commit's CI",
    ).toBe(true);
    expect(release.jobs.assemble.needs).toContain("ci");
    expect(release.jobs.ci.needs).toBe("prepare");
    expect(release.jobs.ci.permissions).toEqual({ actions: "write", contents: "write" });
    const wait = release.jobs.ci.steps.find((step: { run?: string }) => step.run === "node scripts/release-ci.mjs");
    expect(wait.if).toBe("${{ !inputs.ship_without_ci }}");
    expect(wait.env).toMatchObject({ SHA: "${{ needs.prepare.outputs.sha }}", VERSION: "${{ needs.prepare.outputs.version }}" });
    // The script reads ci.yml's gate by its job name.
    expect(readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8")).toContain(`job.name === "${workflow.jobs.gate.name}"`);
    // The release lane is a branch, so its runs get their own concurrency group.
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("checks out every module the release gate imports", () => {
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    const checkout = release.jobs.ci.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"));
    const sparse = (checkout.with["sparse-checkout"] as string).split("\n").map((line) => line.trim()).filter(Boolean);
    const imports = [...readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8").matchAll(/^import .* from "\.\/([^"]+)";$/gm)]
      .map((match) => `scripts/${match[1]}`);
    expect(imports).toContain("scripts/ci-scope.mjs");
    expect(sparse.sort()).toEqual(["scripts/release-ci.mjs", ...imports].sort());
  });

  it("builds the Windows Defender check's installer exactly as the release's Windows job does", () => {
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    const check = parse(readFileSync(new URL("../.github/workflows/windows-defender-check.yml", import.meta.url), "utf8"));
    type Step = { uses?: string; with?: unknown; run?: string; shell?: string };
    const toolchainToInstaller = (steps: Step[]) => steps.slice(1, steps.findIndex((step) => step.run === "pnpm package:win") + 1)
      .map(({ uses, with: inputs, run, shell }) => ({ uses, with: inputs, run, shell }));
    expect(toolchainToInstaller(check.jobs.check.steps).at(-1)?.run).toBe("pnpm package:win");
    expect(toolchainToInstaller(check.jobs.check.steps)).toEqual(toolchainToInstaller(release.jobs.windows.steps));
    expect(check.jobs.check["runs-on"]).toBe(release.jobs.windows["runs-on"]);
  });

  it("lets the scope read the previous commit's CI and a pull request's labels, and nothing more", () => {
    // Adapted: this repo has no static/scope step, so the equivalent
    // protection is ci.yml's workflow-level permission ceiling - read-only
    // contents, nothing else - plus no job-level escalation anywhere in ci.yml.
    // (Publishing rights live in release.yml's draft job, outside ci.yml.)
    expect(workflow.permissions, "ci.yml must declare its permission ceiling explicitly").toBeDefined();
    for (const [key, value] of Object.entries(workflow.permissions) as [string, string][]) {
      expect(value, `ci.yml permission ${key}`).toBe("read");
    }
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { permissions?: unknown }][]) {
      expect(job.permissions, name).toBeUndefined();
    }
  });

  it("reports every known flaky test that needed a retry in the vitest job summary", () => {
    const steps = workflow.jobs.vitest.steps as { name?: string; run?: string; if?: string; env?: Record<string, string> }[];
    const tests = steps.findIndex((step) => step.name === "Run tests");
    const report = steps.findIndex((step) => step.run === "node scripts/testing/ci-retry-summary.mjs");
    expect(report).toBe(tests + 1);
    expect(steps[report]!.if).toBe("${{ !cancelled() }}");
    // The runner context exists only at step level, never in a job's env.
    expect(workflow.jobs.vitest.env).toBeUndefined();
    for (const step of [steps[tests]!, steps[report]!]) {
      expect(step.env?.OMB_VITEST_RETRY_LOG).toBe("${{ runner.temp }}/vitest-retries.jsonl");
    }
    expect(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")).toContain('runner: "./scripts/testing/ci-retry-runner.ts"');
  });

  it.each(requiredRuntimeJobs)("fails closed for every required %s outcome when selected", (job) => {
    requireFinalGate();
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      const check = runGate({ ...gateNeeds(SELECTABLE_JOBS), [job]: { result } });
      expect(check.status, check.stderr).toBe(result === "success" ? 0 : 1);
    }
  });

  it.each(requiredRuntimeJobs)("accepts %s skipped only when static left it out", (job) => {
    requireFinalGate();
    requireSelection();
    const others = SELECTABLE_JOBS.filter((name) => name !== job);
    expect(runGate(gateNeeds(others)).status).toBe(0);
    for (const result of ["success", "failure", "cancelled"]) {
      expect(runGate({ ...gateNeeds(others), [job]: { result } }).status).toBe(1);
    }
  });

  it("accepts every required job skipped on a docs-only PR, and nothing else", () => {
    // This repo runs every lane on every docs-only change: ci-scope.mjs knows
    // the docs-only scope but ci.yml wires no selection job to apply it. The
    // gate that would accept the empty selection is missing too.
    requireFinalGate();
    requireSelection();
    expect(runGate(gateNeeds([])).status).toBe(0);
    for (const result of ["success", "failure", "cancelled"]) {
      expect(runGate({ ...gateNeeds([]), vitest: { result } }).status).toBe(1);
    }
  });

  it("rejects failed preflight and missing or malformed selection", () => {
    requireFinalGate();
    requireSelection();
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ ...gateNeeds([]), static: { result, outputs: { jobs: "[]" } } }).status).toBe(1);
    }
    for (const jobs of ["", "yes", "true", "{}", "[1]", "null", '"vitest"']) {
      expect(runGate({ ...gateNeeds([]), static: { result: "success", outputs: { jobs } } }).status, jobs).toBe(1);
    }
    expect(runGate({ ...gateNeeds([]), static: { result: "success", outputs: {} } }).status).toBe(1);
  });

  it("always starts the workflow and validates selection and docs before fanout", () => {
    requireSelection();
    expect(workflow.on.pull_request).toBeNull();
    expect(workflow.jobs.static.if).toBeUndefined();
    expect(workflow.jobs.static.steps[0].with["fetch-depth"]).toBe(0);
    expect(workflow.jobs.static.steps.find((step: { id?: string }) => step.id === "scope").run).toBe("node scripts/ci-scope.mjs");
    expect(workflow.jobs.static.outputs).toEqual({
      jobs: "${{ steps.scope.outputs.jobs }}",
      vitest_os: "${{ steps.scope.outputs.vitest_os }}",
      vitest_matrix: "${{ steps.scope.outputs.vitest_matrix }}",
      packaged_server_os: "${{ steps.scope.outputs.packaged_server_os }}",
    });
    // Only these three static steps depend on the scope's build flag; the rest always run, or run only on Boat.
    const built = (workflow.jobs.static.steps as { if?: string; run?: string }[]).filter((step) => step.if?.includes("outputs.build"));
    expect(built.map((step) => [step.if, step.run])).toEqual([
      ["steps.scope.outputs.build == 'true'", "pnpm typecheck"],
      ["steps.scope.outputs.build == 'true'", "pnpm check:electron"],
      ["steps.scope.outputs.build == 'true'", "pnpm exec vite build"],
    ]);
    expect(workflow.jobs.static.steps.some((step: { run?: string }) =>
      step.run === "pnpm exec vitest run scripts/ci-scope.test.ts scripts/ci-linux-lanes.test.ts scripts/ci-workflow.test.ts scripts/testing/verification-docs.test.ts",
    )).toBe(true);
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { needs?: string | string[]; if?: string }][]) {
      if (["static", "gate"].includes(name)) continue;
      // The one deploy job: after the control-plane checks, on main pushes only. It is
      // not part of the merge gate.
      if (name === "deploy-composio-broker") {
        expect(job.needs).toEqual(["control-plane"]);
        expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
        expect(workflow.jobs.gate.needs).not.toContain(name);
        // Without the Cloudflare token the deploy is skipped with a warning, not failed:
        // every step after the token check waits on it.
        const [check, ...rest] = job.steps as { id?: string; if?: string; env?: Record<string, string>; run?: string }[];
        expect(check.id).toBe("token");
        expect(check.env).toEqual({ CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" });
        expect(check.run).toContain("::warning");
        for (const step of rest) expect(step.if).toBe("steps.token.outputs.present == 'true'");
        // The broker is typechecked and tested in the same checkout it deploys.
        const runs = rest.map((step) => step.run);
        const deploy = rest.findIndex((step) => (step as { uses?: string }).uses?.startsWith("cloudflare/wrangler-action@"));
        expect(runs.indexOf("pnpm broker:check")).toBeGreaterThan(-1);
        expect(runs.indexOf("pnpm broker:check")).toBeLessThan(deploy);
        expect(runs.indexOf("pnpm broker:test")).toBeGreaterThan(-1);
        expect(runs.indexOf("pnpm broker:test")).toBeLessThan(deploy);
        continue;
      }
      expect(job.needs).toBe("static");
      expect(job.if).toBe(`contains(needs.static.outputs.jobs, '"${name}"')`);
    }
    // ci-scope selects exactly the jobs the workflow has.
    expect(Object.keys(workflow.jobs).filter((name) => !["static", "gate", "deploy-composio-broker"].includes(name)).sort())
      .toEqual([...SELECTABLE_JOBS].sort());
  });

  it("pins every external action to a full commit SHA", () => {
    const uses = (Object.values(workflow.jobs) as { steps?: { uses?: string }[] }[])
      .flatMap((job) => job.steps ?? []).flatMap((step) => (step.uses && !step.uses.startsWith("./") ? [step.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });

  it("keeps the redundant Windows workflow available only for manual debugging", () => {
    // Adapted: the redundant standalone Windows packaging workflow here is
    // package-win.yml (shared-terminal-smoke.yml was never imported); it must
    // stay manual-only so the release lane owns Windows packaging.
    const smoke = parse(readFileSync(new URL("../.github/workflows/package-win.yml", import.meta.url), "utf8"));
    expect(Object.keys(smoke.on)).toEqual(["workflow_dispatch"]);
  });
});

type Step = { id?: string; name?: string; if?: string; run?: string; uses?: string; shell?: string; env?: Record<string, string> };

/** The contexts a run's static job is routed by: a pull request from `author`, a push, a merge group or a scheduled run. */
function runContext({ boat = "on", event = "pull_request", actor = "somdipto", triggering = actor, author = actor, head = "somdipto/dani-desktop" }: {
  boat?: string | null; event?: string; actor?: string; triggering?: string; author?: string; head?: string | null;
} = {}) {
  return {
    vars: boat === null ? {} : { BOAT_CI: boat },
    github: {
      event_name: event, actor, triggering_actor: triggering, repository: "somdipto/dani-desktop", repository_owner: "somdipto",
      event: event === "pull_request" ? { pull_request: { user: { login: author }, head: { repo: head === null ? null : { full_name: head } } } } : {},
    },
  };
}

describe("CI on Boat", () => {
  const routed = (context: ReturnType<typeof runContext>) => ({
    runsOn: interpolate(workflow.jobs.static["runs-on"], context),
    name: interpolate(workflow.jobs.static.name, context),
    timeout: interpolate(String(workflow.jobs.static["timeout-minutes"]), context),
  });
  const boat = { runsOn: "boat-xlarge", name: "typecheck + lint + Linux tests (Boat)", timeout: 45 };

  it.each([
    ["the owner's pull request", {}],
    ["the owner's push to main", { event: "push" }],
    ["a merge group the owner queued", { event: "merge_group" }],
  ])("runs the static job, with the Linux work, on one Boat VM for %s", (_, run) => {
    expect(routed(runContext(run))).toEqual(boat);
  });

  it.each([
    ["while BOAT_CI is not set", { boat: null }, 15],
    ["while BOAT_CI is off", { boat: "off" }, 15],
    ["for a fork's pull request", { head: "someone/dani-desktop", author: "someone", actor: "someone" }, 45],
    ["for a fork's pull request the owner started", { head: "someone/dani-desktop", author: "someone" }, 45],
    ["for a deleted fork's pull request", { head: null }, 45],
    ["for a teammate's pull request on this repository", { author: "teammate", actor: "teammate" }, 45],
    ["for the owner's pull request that a teammate pushed to", { actor: "teammate" }, 45],
    ["for the owner's pull request that a teammate re-ran", { triggering: "teammate" }, 45],
    ["for a push a bot made", { event: "push", actor: "github-actions[bot]" }, 45],
    ["for the nightly run", { event: "schedule" }, 45],
    ["for a manual run, the release lane among them", { event: "workflow_dispatch" }, 45],
  ])("keeps every job on GitHub's runners %s", () => {
    // Adapted: no Boat/self-hosted routing exists in this repo at all, so the
    // protection collapses to a universal invariant that already covers every
    // context named above: no job in any workflow resolves to anything but a
    // GitHub-hosted runner label.
    expect(jobsOffGitHubRunners()).toEqual([]);
  });

  it("does the Linux work in the static job only where ci-scope moved it there, without Boat's extra rights or desktop", () => {
    const steps = workflow.jobs.static.steps as Step[];
    const boatOnly = steps.slice(steps.findIndex((step) => step.name === "production UI build") + 1);
    expect(boatOnly.map((step) => step.if)).toEqual([
      "steps.scope.outputs.linux_lanes", "steps.scope.outputs.linux_lanes", "steps.scope.outputs.linux_lanes",
      "${{ !cancelled() && steps.scope.outputs.linux_lanes }}", "failure() && steps.scope.outputs.linux_lanes",
    ]);
    const lanes = boatOnly.find((step) => step.run === "node scripts/ci-linux-lanes.mjs")!;
    expect(lanes.env).toMatchObject({ OMB_CI_LINUX_LANES: "${{ steps.scope.outputs.linux_lanes }}", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
    expect(lanes.shell).toBe("setpriv --inh-caps=-all --ambient-caps=-all -- env -u DISPLAY -u XAUTHORITY bash --noprofile --norc -eo pipefail {0}");
    expect(boatOnly.find((step) => step.run?.startsWith("sudo rm -f "))!.run).toContain("/usr/bin/bwrap");
    // The same report and artifact as the vitest and behavior-evals jobs.
    const report = (workflow.jobs.vitest.steps as Step[]).find((step) => step.run === "node scripts/testing/ci-retry-summary.mjs")!;
    expect(boatOnly.find((step) => step.run === "node scripts/testing/ci-retry-summary.mjs")!.env).toEqual(report.env);
    const upload = (workflow.jobs["behavior-evals"].steps as Step[]).find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
    expect(boatOnly.at(-1)).toEqual({ ...upload, if: "failure() && steps.scope.outputs.linux_lanes" });
  });

  it("runs on Boat exactly the commands the Linux jobs run on GitHub's runners", () => {
    const steps = (job: string) => workflow.jobs[job].steps as Step[];
    const work = (job: string) => steps(job).filter((step) => step.run && step.run !== "pnpm install --frozen-lockfile").map((step) => step.run);
    for (const entry of vitestMatrix(["ubuntu-latest"]).include.slice(0, 2)) {
      const context = { matrix: entry, runner: { temp: "/t" } };
      const tests = steps("vitest").find((step) => step.name === "Run tests")!;
      const units = steps("vitest").find((step) => step.name === "Broker and Electron unit tests")!;
      const lane = vitestLane(entry, "/t/vitest-retries.jsonl");
      expect(lane.commands).toEqual([interpolate(tests.run!, context), ...(entry.node_tests ? [units.run] : [])]);
      expect(lane.env).toEqual(Object.fromEntries(Object.entries(tests.env!).map(([key, value]) => [key, interpolate(value, context)])));
    }
    expect(EVALS_LANE.commands).toEqual(work("behavior-evals"));
    expect(PACKAGED_SERVER_LANE.commands).toEqual(work("packaged-server"));
  });

  it("starts Boat VMs from no other workflow", () => {
    const directory = new URL("../.github/workflows/", import.meta.url);
    const onBoat = readdirSync(directory).filter((file) => /\.ya?ml$/.test(file))
      .filter((file) => /runs-on:[^\n]*boat|'boat(?:-\w+)?'/.test(readFileSync(new URL(file, directory), "utf8")));
    expect(onBoat).toEqual(["ci.yml"]);
  });
});

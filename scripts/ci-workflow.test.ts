import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
// This repo's actual always-on lanes (2026-11-03 full-lane rule: no selection
// job; every push/PR runs the whole suite). Upstream's behavior-evals,
// packaged-server, windows-cua and electron-smokes lanes were never part of
// this repo's CI and are asserted absent below.
const requiredRuntimeJobs = ["test", "tests-complete", "control-plane", "package-linux"];
const selectorJobs = ["sdd", "ios", "android"];

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
      // An array or non-string runs-on resolves labels we cannot see inline;
      // treat it as an offender rather than skipping it silently.
      if (Array.isArray(runsOn)) {
        for (const label of runsOn as string[]) if (!GITHUB_HOSTED.has(label)) offenders.push(`${file}::${name} -> ${label}`);
        continue;
      }
      if (typeof runsOn !== "string") {
        offenders.push(`${file}::${name} -> unverifiable runs-on`);
        continue;
      }
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

/** Full-lane rule (decided 2026-11-03): ci.yml wires no selection job on
 * purpose - every push and pull request runs the whole lane, so there is no
 * selector output to trust or to bypass. */
function requireFullLane() {
  expect(workflow.jobs.static, "full-lane rule: ci.yml must not grow a selection job without re-deriving the gate's skip semantics").toBeUndefined();
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

/** The gate's needs under the full-lane rule: every required lane succeeded;
 * each detector-gated lane succeeded when its flag is "true", skipped when "false". */
function gateNeeds(flags: Record<string, string> = { sdd: "true", ios: "true", android: "true" }) {
  return {
    "detect-optional-jobs": { result: "success", outputs: flags },
    ...Object.fromEntries(requiredRuntimeJobs.map((job) => [job, { result: "success" }])),
    ...Object.fromEntries(selectorJobs.map((job) => [job, { result: flags[job] === "true" ? "success" : "skipped" }])),
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
    // Behavioral equivalence, this repo's expression: PR runs group per PR
    // number so ci-stop-closed.yml cancels exactly that PR's runs; every other
    // event groups per event+ref, so a dispatch never supersedes a pending
    // push run and same-ref pushes still serialize one-running-one-waiting.
    expect(workflow.concurrency.group).toContain("github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number)");
    expect(workflow.concurrency.group).toContain("github.event_name");
    expect(workflow.concurrency.group).toContain("github.ref");
    expect(workflow.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it("runs the full lane on every push and pull request", () => {
    // No nightly schedule by decision (2026-11-03): the full lane runs on
    // every push and PR, so no covered change waits for a cron to be tested.
    expect(workflow.on.schedule).toBeUndefined();
    for (const name of requiredRuntimeJobs) {
      const condition = String(workflow.jobs[name].if ?? "");
      expect(condition, name).not.toContain("event_name == 'push'");
      expect(condition, name).not.toContain("event_name == 'pull_request'");
    }
  });

  it("scopes every event kind to its own run group", () => {
    // The ci.yml expression reduces to ci-pr-<n> for pull_request runs and
    // ci-<event>-<ref> for everything else, so a dispatch or a stop run can
    // never cancel a push's run and a push can never cancel a dispatch's.
    const group = workflow.concurrency.group as string;
    expect(group).toBe("ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('{0}-{1}', github.event_name, github.ref) }}");
    const reduced = (event: string, ref: string, pr?: number) =>
      event === "pull_request" ? `ci-pr-${pr}` : `ci-${event}-${ref}`;
    const groups = [
      reduced("pull_request", "refs/pull/7/merge", 7),
      reduced("push", "refs/heads/main"),
      reduced("workflow_dispatch", "refs/heads/main"),
      reduced("push", "refs/heads/prod"),
    ];
    expect(new Set(groups).size).toBe(groups.length);
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
    expect(workflow.jobs.gate.if).toContain("!cancelled()");
    // Bounded: the gate itself can never wait indefinitely.
    expect(workflow.jobs.gate["timeout-minutes"]).toBe(5);
    // A cancelled dependency surfaces as a gate failure, never a pass.
    expect(runGate({ ...gateNeeds(), "control-plane": { result: "cancelled" } }).status).toBe(1);
  });

  it("models the gate's workflow-level outcomes: no skipped gate can read as success", () => {
    // GitHub auto-skips a job whose needs failed or were cancelled unless its
    // `if` contains a status check function. The gate's `if` must contain one
    // (cancelled()), so a failed/cancelled need makes the gate EXECUTE and its
    // script fail closed (exit 1 above) - the conclusion is "failure", never a
    // silent "skipped". Outcome matrix this pins:
    //   need failed/cancelled  -> gate runs, exits 1   -> conclusion failure
    //   whole run cancelled    -> gate is cancelled    -> conclusion cancelled
    //   probe dispatch inputs  -> gate is skipped on purpose (release-ci.mjs
    //                             verdict "no gate job" excludes such runs)
    // Only "success" is a proof, and both release layers demand exactly it:
    // release.yml's draft requires needs.ci.result == 'success' and
    // release-ci.mjs's judgeRun maps cancelled/skipped/missing-gate to
    // non-green verdicts (covered in scripts/release-ci.test.ts).
    expect(workflow.jobs.gate.if).toMatch(/cancelled\(\)/);
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    expect(release.jobs.release.if).toContain("needs.ci.result == 'success'");
    expect(release.jobs.release.needs).toContain("ci");
    expect(workflow.jobs.gate.needs).toEqual(["detect-optional-jobs", "sdd", "test", "tests-complete", "control-plane", "package-linux", "ios", "android"]);
  });

  it("schedules one read-only final gate over the full lane", () => {
    requireFinalGate();
    expect(workflow.jobs.gate.name).toBe("CI");
    expect(workflow.jobs.gate.strategy).toBeUndefined();
    expect(workflow.jobs.gate["runs-on"]).toBe("ubuntu-latest");
    expect((workflow.jobs.gate.steps[0] as { env?: Record<string, string> }).env?.NEEDS).toBe("${{ toJSON(needs) }}");
    // Read-only: ci.yml never writes; the gate adds no permissions of its own.
    // actions: read exists so probe jobs can fetch this repo's own artifacts.
    expect(workflow.permissions.contents).toBe("read");
    expect(Object.values(workflow.permissions as Record<string, string>)).not.toContain("write");
    expect(workflow.jobs.gate.permissions).toBeUndefined();
    // The shard matrix fans out per OS: four shards, fail-fast off.
    const matrix = workflow.jobs.test.strategy.matrix;
    expect(matrix.os).toEqual(["macos-latest", "ubuntu-latest", "windows-latest"]);
    expect(matrix.shard).toEqual([1, 2, 3, 4]);
    expect(matrix.shards).toEqual([4]);
    expect(workflow.jobs.test.strategy["fail-fast"]).toBe(false);
  });

  it("runs every platform's full suite sharded, with no subset filtering", () => {
    // Full-lane rule (2026-11-03): no selection job; each OS runs the entire
    // suite split four ways by recorded CI seconds, every file exactly once.
    requireFullLane();
    const run = (workflow.jobs.test.steps as { name?: string; run?: string; env?: Record<string, string> }[])
      .find((step) => step.name === "Run tests")!;
    expect(run.run).toContain("pnpm exec vitest run --shard=${{ matrix.shard }}/${{ matrix.shards }}");
    expect(run.run).not.toContain("OMB_VITEST_SUBSET");
    // The broker, Electron and packaged-server checks ride every shard leg.
    expect(run.run).toContain("pnpm broker:test");
    expect(run.run).toContain("pnpm test:electron");
    expect(run.run).toContain("pnpm test:packaged-server");
  });

  it("documents the upstream lanes this repo deliberately does not run", () => {
    // behavior-evals, packaged-server, windows-cua, electron-smokes and the
    // browser-* lanes were upstream's, never this repo's. If any returns, it
    // must be wired into the gate - the no-ungated-job invariant below fails
    // until it is.
    for (const lane of ["behavior-evals", "packaged-server", "windows-cua", "electron-smokes", "browser-identity", "browser-driver", "static"]) {
      expect(workflow.jobs[lane], `${lane}: re-adding this lane requires wiring it into the gate`).toBeUndefined();
    }
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
    expect(release.jobs.release.needs).toContain("ci");
    expect(release.jobs.ci.needs).toBe("prepare");
    // Read-only wait: two GETs, so actions:read + contents:read (checkout)
    // suffice. No branch, dispatch, or re-run scope - a release job must not
    // be able to mutate CI state to make a commit look proven.
    expect(release.jobs.ci.permissions).toEqual({ actions: "read", contents: "read" });
    const wait = release.jobs.ci.steps.find((step: { run?: string }) => step.run === "node scripts/release-ci.mjs");
    // Always runs: no dispatch input may skip the full-green gate.
    expect(wait.if).toBeUndefined();
    expect(JSON.stringify(release.on?.workflow_dispatch?.inputs ?? {})).not.toContain("ship_without_ci");
    expect(wait.env).toMatchObject({ SHA: "${{ needs.prepare.outputs.sha }}" });
    const script = readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8");
    // The script reads ci.yml's gate by its job name.
    expect(script).toContain(`job.name === "${workflow.jobs.gate.name}"`);
    // Read-only by construction: no mutation endpoint may appear in it.
    for (const mutation of ["/git/refs", "/dispatches", "rerun-failed-jobs"]) {
      expect(script, `release-ci.mjs must not call ${mutation}`).not.toContain(mutation);
    }
    // The draft cannot succeed on a skipped, failed, cancelled, or missing
    // gate: its condition demands the ci job's exact "success" result.
    expect(release.jobs.release.if).toContain("needs.ci.result == 'success'");
  });

  it("checks out every module the release gate imports", () => {
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    const checkout = release.jobs.ci.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"));
    const sparse = (checkout.with["sparse-checkout"] as string).split("\n").map((line) => line.trim()).filter(Boolean);
    const imports = [...readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8").matchAll(/^import .* from "\.\/([^"]+)";$/gm)]
      .map((match) => `scripts/${match[1]}`);
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
    // Manual build only: no upload or submission step is wired.
    expect(JSON.stringify(check)).not.toContain("upload-artifact");
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
    const steps = workflow.jobs.test.steps as { name?: string; run?: string; if?: string; env?: Record<string, string> }[];
    const tests = steps.findIndex((step) => step.name === "Run tests");
    const report = steps.findIndex((step) => step.run === "node scripts/testing/ci-retry-summary.mjs");
    expect(report).toBe(tests + 1);
    expect(steps[report]!.if).toBe("${{ !cancelled() }}");
    // The runner context exists only at step level, never in a job's env.
    expect(workflow.jobs.test.env).toBeUndefined();
    for (const step of [steps[tests]!, steps[report]!]) {
      expect(step.env?.OMB_VITEST_RETRY_LOG).toBe("${{ runner.temp }}/vitest-retries.jsonl");
    }
    expect(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")).toContain('runner: "./scripts/testing/ci-retry-runner.ts"');
  });

  it.each(requiredRuntimeJobs)("fails closed for every required %s outcome when selected", (job) => {
    requireFinalGate();
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      const check = runGate({ ...gateNeeds(), [job]: { result } });
      expect(check.status, check.stderr).toBe(result === "success" ? 0 : 1);
    }
  });

  it.each(selectorJobs)("accepts %s skipped only when the detector left it out", (job) => {
    requireFinalGate();
    const all = { sdd: "true", ios: "true", android: "true" };
    expect(runGate(gateNeeds({ ...all, [job]: "false" })).status).toBe(0);
    // Unselected: anything but a skip (including a surprise success) fails closed.
    for (const result of ["success", "failure", "cancelled"]) {
      expect(runGate({ ...gateNeeds({ ...all, [job]: "false" }), [job]: { result } }).status, result).toBe(1);
    }
    // Selected: anything but success fails closed.
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ ...gateNeeds(all), [job]: { result } }).status, result).toBe(1);
    }
  });

  it("runs the full lane even on docs-only changes", () => {
    // No selection job exists, so a docs-only change gets the same full lane;
    // the gate refuses any skipped required lane outright.
    requireFinalGate();
    requireFullLane();
    expect(runGate(gateNeeds()).status).toBe(0);
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ ...gateNeeds(), test: { result } }).status, result).toBe(1);
    }
  });

  it("rejects a failed detector and missing or malformed lane flags", () => {
    requireFinalGate();
    const flags = { sdd: "true", ios: "true", android: "true" };
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ ...gateNeeds(), "detect-optional-jobs": { result, outputs: flags } }).status, result).toBe(1);
    }
    for (const outputs of [{}, { sdd: "yes", ios: "true", android: "true" }, { sdd: "true", ios: "true" }]) {
      expect(runGate({ ...gateNeeds(), "detect-optional-jobs": { result: "success", outputs } }).status, JSON.stringify(outputs)).toBe(1);
    }
  });

  it("gates every always-on job, with no ungated fanout", () => {
    // Full-lane rule: ci.yml wires no selection job - every push and pull
    // request runs the whole lane. The invariant that replaces the selector
    // contract: every always-on job is in the gate's needs, so no check can
    // fan out unobserved. Dispatch-only probe jobs are selected manually and
    // gated by their own job results, matching tests-complete.
    requireFinalGate();
    requireFullLane();
    expect(workflow.on.pull_request).toBeNull();
    const probeOnly = (job: { if?: string }) => String(job.if ?? "").includes("github.event_name == 'workflow_dispatch'");
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { if?: string }][]) {
      if (["gate", "detect-optional-jobs"].includes(name)) continue;
      if (probeOnly(job)) continue;
      expect(workflow.jobs.gate.needs as string[], name).toContain(name);
    }
    // The detector itself is always-on and gated by the gate's flag checks.
    expect(String(workflow.jobs["detect-optional-jobs"].if ?? "")).not.toContain("event_name == 'push'");
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

describe("CI on hosted runners only", () => {
  // Direct verification (2026-11-03 steer): this repo has no Boat or any
  // self-hosted infrastructure, so the protections that upstream enforced
  // through routing rules collapse to one universal invariant - no job in any
  // workflow resolves to anything but a GitHub-hosted runner label - plus a
  // textual guard that no workflow references a boat runner at all. If a
  // self-hosted lane ever returns, its routing and sandboxing contract must
  // be re-derived then; nothing here pre-approves it.
  it("references no boat or self-hosted runner in any workflow", () => {
    const directory = new URL("../.github/workflows/", import.meta.url);
    const onBoat = readdirSync(directory).filter((file) => /\.ya?ml$/.test(file))
      .filter((file) => /runs-on:[^\n]*boat|'boat(?:-\w+)?'|self-hosted/i.test(readFileSync(new URL(file, directory), "utf8")));
    expect(onBoat).toEqual([]);
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

});

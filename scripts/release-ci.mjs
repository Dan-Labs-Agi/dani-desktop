// The release's CI gate: ship only a commit whose code passed CI with every
// platform's every test shard green on that exact commit. Exact-revision
// proof only: a run on another commit never counts, even with an identical
// tree, because generated, build, and version-dependent behavior is pinned to
// the commit being released.
//
// This repo's ci.yml runs the full lane on every push and every input-less
// dispatch, so the commit's own completed run is the proof. This script is
// read-only: it never dispatches, re-runs, or creates/deletes branches. No
// green proof within the wait window fails the release; fix main or re-run
// CI, then re-run the release job.
import { pathToFileURL } from "node:url";

// Only events whose runs contain the full lane can prove a commit. Probe
// dispatches carry inputs and never run the gate, so their runs are excluded
// by the missing-gate verdict below even though the event matches.
const RELEASE_EVENTS = new Set(["push", "workflow_dispatch"]);
/** Every platform's every shard, by ci.yml's actual job naming. Pinned to the
 * workflow file by scripts/ci-workflow.test.ts; update both together. */
const FULL_MATRIX = ["macos-latest", "ubuntu-latest", "windows-latest"]
  .flatMap((os) => Array.from({ length: 4 }, (_, i) => `typecheck + test (${os}, shard ${i + 1}/4)`));
export const POLL_MS = 60_000;
export const MAX_WAIT_MS = 170 * 60_000;

/** @typedef {{ name: string, status?: string, conclusion: string | null, steps?: Array<{ status?: string, conclusion?: string | null }> }} Job */
/** @typedef {{ id: number, event: string, status: string, head_branch: string, head_sha?: string, created_at: string, run_attempt?: number }} Run */

const isTestJob = (job) => job.name.startsWith("typecheck + test (");
/** A job that never started a step never got a runner: GitHub gave up acquiring one. */
const neverStarted = (job) => !(job.steps ?? []).some((step) => step.conclusion != null || step.status === "in_progress");

/**
 * What one finished CI run proves.
 * - "green": the gate passed and every platform's every vitest shard ran and passed.
 * - "partial": the gate passed and every vitest job that ran passed, but not every platform's shards ran (a push to
 *   main or a merge group runs no macOS shards).
 * - "scoped": the gate passed but vitest did not run (docs- or version-only).
 * - "runner-lost": the gate failed, and every other failed job never started.
 * - "red": the gate failed for any other reason.
 * - anything else: the gate's own conclusion, or "no gate job".
 * @param {Job[]} jobs
 */
export function judgeRun(jobs) {
  const gate = jobs.find((job) => job.name === "CI");
  if (!gate) return "no gate job";
  if (gate.conclusion === "success") {
    const testJobs = jobs.filter(isTestJob);
    if (testJobs.length === 0 || !testJobs.every((job) => job.conclusion === "success")) return "scoped";
    return FULL_MATRIX.every((name) => testJobs.some((job) => job.name === name)) ? "green" : "partial";
  }
  if (gate.conclusion === "failure") {
    const failed = jobs.filter((job) => job !== gate && !["success", "skipped", "neutral"].includes(job.conclusion ?? ""));
    return failed.length > 0 && failed.every(neverStarted) ? "runner-lost" : "red";
  }
  return gate.conclusion ?? "no gate job";
}

/**
 * Poll the commit's own CI runs until one proves it green, a completed run
 * proves it red, or the wait window ends. Read-only: no dispatch, re-run,
 * branch, or any other mutation; a cancelled, skipped, or missing gate never
 * satisfies the release.
 * @param {{
 *   api: {
 *     runsForCommit(sha: string): Promise<Run[]>,
 *     runJobs(runId: number): Promise<Job[]>,
 *   },
 *   sha: string,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number, log?: (line: string) => void, maxWaitMs?: number,
 * }} options
 * @returns {Promise<{ ok: true, runId: number } | { ok: false, reason: string }>}
 */
export async function waitForReleaseCi({ api, sha, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = console.log, maxWaitMs = MAX_WAIT_MS }) {
  const started = now();
  /** "id/attempt" -> verdict; a finished attempt never changes */
  const verdicts = new Map();
  const verdict = async (run) => {
    const key = `${run.id}/${run.run_attempt ?? 1}`;
    if (!verdicts.has(key)) verdicts.set(key, judgeRun(await api.runJobs(run.id)));
    return verdicts.get(key);
  };

  while (now() - started < maxWaitMs) {
    // Verify the exact revision in the returned data itself: never trust the
    // head_sha query filter alone to keep another commit's run out.
    const runs = (await api.runsForCommit(sha))
      .filter((run) => run.head_sha === sha && RELEASE_EVENTS.has(run.event))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    let live = null;
    for (const run of runs) {
      if (run.status !== "completed") {
        live ??= run;
        continue;
      }
      const result = await verdict(run);
      if (result === "green") {
        log(`CI passed on ${sha} (run ${run.id}).`);
        return { ok: true, runId: run.id };
      }
      if (result === "red" || result === "runner-lost") {
        return { ok: false, reason: `The CI check on ${sha} failed (${result}): run ${run.id}` };
      }
      // Cancelled, skipped, partial, scoped, or gate-less runs prove nothing;
      // keep waiting for a run that can.
    }
    log(live
      ? `CI on ${sha} is ${live.status} (run ${live.id}); waiting.`
      : `No CI run yet proves ${sha}; waiting for one.`);
    await sleep(POLL_MS);
  }
  return { ok: false, reason: `No green CI verdict on ${sha} within ${Math.round(maxWaitMs / 60_000)} minutes.` };
}

/** GitHub REST calls for the release job's GITHUB_TOKEN (read-only). A 5xx or
 * a dropped connection is retried after each of `retryDelaysMs`. */
export function githubApi({ token, repository, apiUrl = "https://api.github.com", fetchImpl = fetch,
  retryDelaysMs = [5_000, 15_000, 45_000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const call = async (method, path) => {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(`${apiUrl}/repos/${repository}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
        });
      } catch (cause) {
        if (attempt < retryDelaysMs.length) { await sleep(retryDelaysMs[attempt]); continue; }
        throw new Error(`${method} ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
      if (response.status >= 500 && attempt < retryDelaysMs.length) { await sleep(retryDelaysMs[attempt]); continue; }
      if (!response.ok) {
        const error = new Error(`${method} ${path}: HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
  };
  return {
    async runsForCommit(sha) {
      return (await call("GET", `/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`)).workflow_runs;
    },
    async runJobs(runId) {
      return (await call("GET", `/actions/runs/${runId}/jobs?per_page=100`)).jobs;
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, SHA } = process.env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !/^[0-9a-f]{40}$/.test(SHA ?? "")) {
    console.error("::error::release-ci needs GH_TOKEN, GITHUB_REPOSITORY, and a full SHA");
    process.exit(1);
  }
  const result = await waitForReleaseCi({
    api: githubApi({ token: GH_TOKEN, repository: GITHUB_REPOSITORY, apiUrl: GITHUB_API_URL }),
    sha: SHA,
  });
  if (!result.ok) {
    console.error(`::error::${result.reason}. Fix main or re-run CI, then re-run this job.`);
    process.exit(1);
  }
}

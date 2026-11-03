import { describe, expect, it } from "vitest";
import { githubApi, judgeRun, waitForReleaseCi } from "./release-ci.mjs";

const SHA = "a".repeat(40);
const OTHER = "d".repeat(40);

type Step = { status?: string; conclusion?: string | null };
type Job = { name: string; conclusion: string | null; steps?: Step[] };
type Run = {
  id: number; event: string; status: string; head_branch: string; head_sha: string; created_at: string;
  run_attempt?: number;
};

const started: Step[] = [{ status: "completed", conclusion: "success" }];
// ci.yml's actual test job naming and shard counts (pinned to the workflow by scripts/ci-workflow.test.ts).
const SHARD_COUNTS: Record<string, number> = { "macos-latest": 4, "ubuntu-latest": 4, "windows-latest": 4 };
const vitest = (os: string, conclusion: string | null, steps: Step[] = started, shard = 1): Job =>
  ({ name: `typecheck + test (${os}, shard ${shard}/${SHARD_COUNTS[os]})`, conclusion, steps });
const shards = (os: string): Job[] =>
  Array.from({ length: SHARD_COUNTS[os] }, (_, i) => vitest(os, "success", started, i + 1));
const gate = (conclusion: string | null): Job => ({ name: "CI", conclusion, steps: started });
/** Every platform's every vitest shard ran and passed, and so did the gate: the full lane. */
const green = (): Job[] => [gate("success"), ...Object.keys(SHARD_COUNTS).flatMap(shards)];
/** The gate passed with only some platforms' shards: not the full lane. */
const mainLane = (): Job[] => [gate("success"), ...shards("ubuntu-latest")];
/** A docs- or version-only run: the gate passes with vitest skipped. */
const scoped = (): Job[] => [gate("success"), { name: "typecheck + test (${{ matrix.os }}, shard ${{ matrix.shard }}/4)", conclusion: "skipped", steps: [] }];
/** A real test failure: the shard started and failed. */
const red = (): Job[] => [gate("failure"), vitest("ubuntu-latest", "failure", [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }])];
/** macOS "failed to be acquired": the shard never started a step. */
const runnerLost = (): Job[] => [gate("failure"), vitest("ubuntu-latest", "success"), vitest("macos-latest", "failure", [])];

/** A scripted GitHub. Each poll (one sleep) moves to the next state. The api
 * exposes only reads: any mutation attempt fails the test by TypeError. */
function fakeGitHub(polls: Array<{ runs: Run[]; jobs?: Record<number, Job[]> }>) {
  let poll = 0;
  let clock = 0;
  const state = () => polls[Math.min(poll, polls.length - 1)]!;
  const api = {
    async runsForCommit() { return state().runs; },
    async runJobs(runId: number) { return state().jobs?.[runId] ?? []; },
  };
  const options = {
    api, sha: SHA, log: () => {}, maxWaitMs: 10 * 60_000,
    now: () => clock, sleep: async (ms: number) => { clock += ms; poll += 1; },
  };
  return { options };
}

const run = (id: number, event: string, status: string, head_branch = "main", minute = 0, extra: Partial<Run> = {}): Run =>
  ({ id, event, status, head_branch, head_sha: SHA, created_at: `2026-10-02T10:${String(minute).padStart(2, "0")}:00Z`, run_attempt: 1, ...extra });

describe("what a CI run proves", () => {
  it("is green only when the gate passed and every platform's every vitest shard ran and passed", () => {
    expect(judgeRun(green())).toBe("green");
    expect(judgeRun(scoped())).toBe("scoped");
    expect(judgeRun([gate("success")])).toBe("scoped");
    expect(judgeRun([gate("success"), vitest("ubuntu-latest", "success"), vitest("windows-latest", "skipped")])).toBe("scoped");
  });

  it("is partial when only some platforms' shards ran", () => {
    expect(judgeRun(mainLane())).toBe("partial");
    expect(judgeRun(green().filter((job) => job.name !== "typecheck + test (macos-latest, shard 4/4)"))).toBe("partial");
    expect(judgeRun([...mainLane(), ...shards("windows-latest")])).toBe("partial");
  });

  it("tells a runner that never came from a test that failed", () => {
    expect(judgeRun(runnerLost())).toBe("runner-lost");
    expect(judgeRun(red())).toBe("red");
    // one lost runner does not excuse a real failure next to it
    expect(judgeRun([...runnerLost(), vitest("windows-latest", "failure")])).toBe("red");
    // a job that failed in "Set up job" did get a runner
    expect(judgeRun([gate("failure"), vitest("macos-latest", "failure", [{ status: "completed", conclusion: "failure" }])])).toBe("red");
    // the gate alone failing (a static check) is red
    expect(judgeRun([gate("failure"), { name: "typecheck + lint", conclusion: "failure", steps: started }])).toBe("red");
    expect(judgeRun([gate("failure")])).toBe("red");
  });

  it("reports a cancelled or missing gate as no verdict", () => {
    expect(judgeRun([])).toBe("no gate job");
    expect(judgeRun([gate("cancelled")])).toBe("cancelled");
    expect(judgeRun([gate("skipped")])).toBe("skipped");
  });
});

describe("release CI gate", () => {
  it("passes on the commit's own green run, with reads only", async () => {
    const { options } = fakeGitHub([{ runs: [run(1, "push", "completed")], jobs: { 1: green() } }]);
    expect(await waitForReleaseCi(options)).toEqual({ ok: true, runId: 1 });
  });

  it.each(["workflow_dispatch", "push"])("waits for a %s run that is still going, then passes", async (event) => {
    const { options } = fakeGitHub([
      { runs: [run(1, event, "queued")] },
      { runs: [run(1, event, "in_progress")] },
      { runs: [run(1, event, "completed")], jobs: { 1: green() } },
    ]);
    expect(await waitForReleaseCi(options)).toEqual({ ok: true, runId: 1 });
  });

  it("counts a re-run that passed after a failed first attempt", async () => {
    const { options } = fakeGitHub([
      { runs: [run(1, "workflow_dispatch", "in_progress", "main", 0, { run_attempt: 2 })] },
      { runs: [run(1, "workflow_dispatch", "completed", "main", 0, { run_attempt: 2 })], jobs: { 1: green() } },
    ]);
    expect(await waitForReleaseCi(options)).toEqual({ ok: true, runId: 1 });
  });

  it("stops on a red gate instead of retrying it", async () => {
    const { options } = fakeGitHub([{ runs: [run(1, "push", "completed")], jobs: { 1: red() } }]);
    expect(await waitForReleaseCi(options)).toMatchObject({ ok: false, reason: expect.stringContaining("failed (red): run 1") });
  });

  it("stops on a runner that never came: no re-run authority", async () => {
    const { options } = fakeGitHub([{ runs: [run(1, "push", "completed")], jobs: { 1: runnerLost() } }]);
    expect(await waitForReleaseCi(options)).toMatchObject({ ok: false, reason: expect.stringContaining("failed (runner-lost): run 1") });
  });

  it("gives up after the wait limit with no verdict", async () => {
    const { options } = fakeGitHub([{ runs: [run(1, "workflow_dispatch", "in_progress")] }]);
    expect(await waitForReleaseCi(options)).toMatchObject({ ok: false, reason: expect.stringContaining("within 10 minutes") });
  });

  it("gives up after the wait limit when there is no CI run at all", async () => {
    const { options } = fakeGitHub([{ runs: [] }]);
    expect(await waitForReleaseCi(options)).toMatchObject({ ok: false, reason: expect.stringContaining("within 10 minutes") });
  });
});

describe("only the exact commit can prove the release", () => {
  it("ignores pull-request runs, which test a merge ref rather than this commit", async () => {
    const { options } = fakeGitHub([
      { runs: [run(9, "pull_request", "completed")], jobs: { 9: green() } },
      { runs: [run(9, "pull_request", "completed"), run(2, "push", "completed", "main", 5)], jobs: { 9: green(), 2: green() } },
    ]);
    expect(await waitForReleaseCi(options)).toEqual({ ok: true, runId: 2 });
  });

  it("never counts a green run on another commit, even one the head_sha query returns", async () => {
    // Exact-revision proof is validated in the returned data, not trusted to
    // the query filter: a green run the endpoint hands back under another
    // commit's sha - same tree, version parent, or a filter surprise - is
    // discarded here. No commit/tree/parent lookup exists to widen that.
    const { options } = fakeGitHub([{ runs: [run(8, "push", "completed", "main", 0, { head_sha: OTHER })], jobs: { 8: green() } }]);
    expect(await waitForReleaseCi(options)).toMatchObject({ ok: false, reason: expect.stringContaining("within 10 minutes") });
  });
});

describe("no skipped, cancelled, partial, or gate-less run is a proof", () => {
  it.each([
    ["cancelled gate", [gate("cancelled")] as Job[]],
    ["skipped gate", [gate("skipped")] as Job[]],
    ["a probe-dispatch run with no gate job", [] as Job[]],
    ["a run of Linux's shards alone", mainLane()],
    ["a run whose vitest was skipped", scoped()],
  ])("waits past %s until a full-lane run proves the commit", async (_, jobs) => {
    const { options } = fakeGitHub([
      { runs: [run(1, "push", "completed")], jobs: { 1: jobs } },
      { runs: [run(1, "push", "completed"), run(2, "workflow_dispatch", "completed", "main", 5)], jobs: { 1: jobs, 2: green() } },
    ]);
    expect(await waitForReleaseCi(options)).toEqual({ ok: true, runId: 2 });
  });

  it("times out rather than accept a cancelled gate as the last word", async () => {
    const { options } = fakeGitHub([{ runs: [run(1, "push", "completed")], jobs: { 1: [gate("cancelled")] } }]);
    expect(await waitForReleaseCi(options)).toMatchObject({ ok: false, reason: expect.stringContaining("within 10 minutes") });
  });
});

describe("GitHub calls", () => {
  it("reads the commit's CI runs and a run's jobs, and nothing else", async () => {
    const requests: string[] = [];
    const fetchImpl = async (url: string, init: { method: string }) => {
      const path = url.replace("https://api.github.com/repos/o/r", "");
      requests.push(`${init.method} ${path}`);
      if (url.includes("/jobs")) return Response.json({ jobs: green() });
      return Response.json({ workflow_runs: [run(7, "push", "completed")] });
    };
    const api = githubApi({ token: "t", repository: "o/r", fetchImpl: fetchImpl as typeof fetch });
    expect(await api.runsForCommit(SHA)).toHaveLength(1);
    expect(judgeRun(await api.runJobs(7))).toBe("green");
    // The whole surface is two GETs: the release job needs actions:read +
    // contents:read (checkout) and no write scope.
    expect(requests).toEqual([
      `GET /actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=100`,
      "GET /actions/runs/7/jobs?per_page=100",
    ]);
    expect(Object.keys(api).sort()).toEqual(["runJobs", "runsForCommit"]);
  });

  it("tries a 5xx or a dropped connection again, but not a 4xx", async () => {
    const answers: Array<() => Response> = [
      () => new Response(null, { status: 500 }),
      () => { throw new TypeError("fetch failed"); },
      () => Response.json({ workflow_runs: [] }),
    ];
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = async () => answers[calls++]!();
    const api = githubApi({ token: "t", repository: "o/r", fetchImpl: fetchImpl as typeof fetch, retryDelaysMs: [1, 2, 3], sleep: async (ms: number) => { waits.push(ms); } });
    await api.runsForCommit(SHA);
    expect(calls).toBe(3);
    expect(waits).toEqual([1, 2]);

    const always500 = githubApi({ token: "t", repository: "o/r", fetchImpl: (async () => new Response(null, { status: 502 })) as typeof fetch, retryDelaysMs: [1, 1], sleep: async () => {} });
    await expect(always500.runsForCommit(SHA)).rejects.toThrow("HTTP 502");

    let forbidden = 0;
    const no = githubApi({ token: "t", repository: "o/r", fetchImpl: (async () => { forbidden++; return new Response(null, { status: 403 }); }) as typeof fetch, retryDelaysMs: [1, 1], sleep: async () => {} });
    await expect(no.runsForCommit(SHA)).rejects.toThrow("HTTP 403");
    expect(forbidden).toBe(1);
  });
});

// This repository retained its portable CI rather than adopting upstream's
// ci-scope/Boat/nightly graph. See docs/current-ci-contract.md for provenance.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; "continue-on-error"?: boolean };
type Job = { steps: Step[]; needs?: string; if?: string; permissions?: unknown; strategy?: { matrix: { os?: string[]; include: Array<{ os: string; shard: number; shards: number }> } }; "runs-on": string; "timeout-minutes": number; "continue-on-error"?: boolean };
const load = (name: string) => parse(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
const workflow = load("ci.yml");
const jobs = workflow.jobs as Record<string, Job>;
const commands = (job: Job) => job.steps.flatMap(step => step.run ? [step.run] : []);

/** Required checks cannot be made advisory, conditional or omitted. */
function requiredChecks(job: Job) {
  if (job.if || job["continue-on-error"]) return false;
  const checks: Array<[string, string | undefined]> = [
    ["pnpm exec vitest run --shard=${{ matrix.shard }}/${{ matrix.shards }}", undefined],
    ...["pnpm typecheck", "pnpm broker:test", "pnpm test:electron", "pnpm test:packaged-server", "pnpm check:electron"].map(command => [command, "matrix.shard == 1"] as [string, string]),
  ];
  return checks.every(([command, condition]) => {
    const step = job.steps.find(step => step.run === command);
    return step && step.if === condition && !step["continue-on-error"];
  });
}

describe("adopted portable CI contract", () => {
  it("validates both adopted branches and pull requests without a path filter", () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null, push: { branches: ["main", "prod"] }, pull_request: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "ci-${{ github.ref }}", "cancel-in-progress": "${{ github.event_name == 'pull_request' }}" });
  });
  it("runs required checks on all three supported host platforms", () => {
    const matrix = jobs.test.strategy!.matrix.include;
    expect([...new Set(matrix.map(row => row.os))].sort()).toEqual(["macos-latest", "ubuntu-latest", "windows-latest"]);
    for (const os of ["macos-latest", "ubuntu-latest", "windows-latest"]) {
      const shards = os === "macos-latest" ? 4 : 8;
      expect(matrix.filter(row => row.os === os).map(row => [row.shard, row.shards])).toEqual(Array.from({length: shards}, (_, i) => [i + 1, shards]));
    }
    expect(jobs.test["runs-on"]).toBe("${{ matrix.os }}");
    expect(jobs.test["timeout-minutes"]).toBe(40);
    expect(requiredChecks(jobs.test)).toBe(true);
    expect(jobs.test.steps.find(step => step.run === "pnpm typecheck")?.env?.NODE_OPTIONS).toBe("--max-old-space-size=7168");
    expect(commands(jobs.test)).toContain("pnpm install --frozen-lockfile");
  });
  it.each(["omitted", "conditional", "advisory", "job-advisory"])("rejects %s required checks", mode => {
    const job: Job = structuredClone(jobs.test);
    const step = job.steps.find(step => step.run === "pnpm exec vitest run --shard=${{ matrix.shard }}/${{ matrix.shards }}")!;
    if (mode === "omitted") job.steps = job.steps.filter(candidate => candidate !== step);
    if (mode === "conditional") step.if = "false";
    if (mode === "advisory") step["continue-on-error"] = true;
    if (mode === "job-advisory") job["continue-on-error"] = true;
    expect(requiredChecks(job)).toBe(false);
  });
  it("keeps the known Windows Electron canary separate from required tests and sandboxed", () => {
    const canary = jobs.test.steps.filter(step => step["continue-on-error"]);
    expect(canary).toHaveLength(1);
    expect(canary[0]).toMatchObject({ if: "matrix.os == 'windows-latest' && matrix.shard == 1", run: "pnpm exec vitest run electron/browser-closed-shadow.electron.test.mjs", env: { OMB_SKIP_REAL_ELECTRON_BROWSER_FIXTURE: "0" } });
    expect(JSON.stringify(jobs.test)).not.toMatch(/--no-sandbox|disable-gpu-sandbox|disable-setuid-sandbox/);
    expect(jobs.test.steps.find(step => step.run === "pnpm exec vitest run --shard=${{ matrix.shard }}/${{ matrix.shards }}")?.env?.OMB_SKIP_REAL_ELECTRON_BROWSER_FIXTURE).toBe("${{ matrix.os == 'windows-latest' && '1' || '0' }}");
  });
  it("validates translation catalogs and builds the full product on Linux", () => {
    expect(jobs.test.steps).toContainEqual(expect.objectContaining({ run: "pnpm i18n:check", if: "matrix.os == 'ubuntu-latest' && matrix.shard == 1" }));
    expect(jobs.test.steps).toContainEqual(expect.objectContaining({ run: "pnpm build", if: "matrix.os == 'ubuntu-latest' && matrix.shard == 1" }));
  });
  it("keeps package install, upgrade and lifecycle checks blocking", () => {
    const job = jobs["package-linux"];
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(job.if).toBeUndefined();
    for (const command of ["pnpm package:linux:offline", "node scripts/verify-linux-package.mjs", "pnpm smoke:linux-package"]) {
      expect(job.steps).toContainEqual(expect.objectContaining({ run: command }));
      expect(job.steps.find(step => step.run === command)?.["continue-on-error"]).toBeUndefined();
    }
    expect(commands(job).join("\n")).toContain("smoke-deb-upgrade.mjs");
    expect(commands(job).join("\n")).toContain('test "$(stat -c \'%U:%G %a\' /opt)" = "root:root 755"');
  });
  it("gates absent optional source trees using checkout evidence, not job-level hashFiles", () => {
    const detector = jobs["detect-optional-jobs"];
    expect(commands(detector).join("\n")).toContain("ios/Package.swift");
    expect(commands(detector).join("\n")).toContain("gradlew");
    expect(commands(detector).join("\n")).toContain("docs/dani-sdd-kit/scripts/check_kit.py");
    for (const name of ["ios", "android", "sdd"]) {
      expect(jobs[name].needs).toBe("detect-optional-jobs");
      expect(jobs[name].if).toBe(`needs.detect-optional-jobs.outputs.${name} == 'true'`);
      expect(jobs[name]["continue-on-error"]).toBeUndefined();
    }
  });
  it("does not grant CI write permissions or deploy services", () => {
    for (const job of Object.values(jobs)) {
      expect(job.permissions).toBeUndefined();
      expect(commands(job).join("\n")).not.toMatch(/gh release|wrangler deploy|npm publish|git push/);
    }
    expect(commands(jobs["control-plane"])).toContain("pnpm control-plane:dry-run");
  });
  it("pins every external action in every adopted workflow", () => {
    for (const file of readdirSync(new URL("../.github/workflows/", import.meta.url)).filter(file => /\.ya?ml$/.test(file))) {
      const adopted = load(file);
      for (const job of Object.values(adopted.jobs) as Job[]) for (const step of job.steps ?? []) {
        if (step.uses && !step.uses.startsWith("./")) expect(step.uses, file).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });
  it.each(["verify-main-native.yml", "verify-main-installed.yml", "verify-main-intel-installed.yml"])("keeps %s manual, read-only and storage-free", name => {
    const verification = load(name);
    expect(verification.on).toEqual({ workflow_dispatch: null });
    expect(verification.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(verification.jobs) as Job[]) for (const step of job.steps) {
      expect(step.uses ?? "").not.toMatch(/upload-artifact|actions\/cache/);
      expect(step.with?.cache).toBeUndefined();
      expect(step.with?.["package-manager-cache"]).not.toBe(true);
      expect(step.run ?? "").not.toMatch(/gh release|npm publish|--publish always|--no-sandbox/);
      expect(step["continue-on-error"]).toBeUndefined();
    }
  });
  it("uses the packaged updater's canonical public feed for Ubuntu update proofs and ships its metadata", () => {
    const linux = load("package-linux.yml").jobs.package as Job;
    expect(linux.steps.some(step => step.uses?.startsWith("actions/upload-artifact") && String(step.with?.path).includes("release/latest-linux.yml"))).toBe(true);
  });
  it.skipIf(process.platform === "win32").each([
    ["complete desktop", 200, { tag_name: "v0.1.141", draft: false, prerelease: false, assets: [{ name: "latest-linux.yml" }] }, 0, "has-release=true"],
    ["no stable release yet", 404, {}, 0, "has-release=false"],
    ["auxiliary latest release", 200, { tag_name: "browser-engine-v0.36.0-omb.2", draft: false, prerelease: false, assets: [] }, 1, ""],
    ["desktop missing its feed", 200, { tag_name: "v0.1.141", draft: false, prerelease: false, assets: [] }, 1, ""],
    ["unauthorized lookup", 403, {}, 1, ""],
  ])("Ubuntu public updater probe handles %s without contacting GitHub", (_, status, body, exit, output) => {
    const directory = mkdtempSync(join(tmpdir(), "dani-release-feed-"));
    try {
      const response = join(directory, "response.json");
      const request = join(directory, "request.txt");
      const resultFile = join(directory, "outputs.txt");
      writeFileSync(response, JSON.stringify(body));
      writeFileSync(resultFile, "");
      writeFileSync(join(directory, "curl"), `#!/bin/sh
printf '%s\\n' "$*" > "$DANI_TEST_REQUEST"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; destination=$1; fi
  shift
done
cp "$DANI_TEST_RESPONSE" "$destination"
printf '%s' "$DANI_TEST_STATUS"
`, { mode: 0o700 });
      const linux = load("package-linux.yml").jobs.package as Job;
      const probe = linux.steps.find(step => step.run?.includes("/releases/latest"))!;
      const result = spawnSync("bash", ["-c", probe.run!], {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RUNNER_TEMP: directory, GITHUB_OUTPUT: resultFile,
          DANI_TEST_REQUEST: request, DANI_TEST_RESPONSE: response, DANI_TEST_STATUS: String(status) },
      });
      expect(result.status, result.stderr).toBe(exit);
      expect(readFileSync(resultFile, "utf8").trim()).toBe(output);
      const publisher = parse(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8")).publish[0];
      expect(readFileSync(request, "utf8")).toContain(`https://api.github.com/repos/${publisher.owner}/${publisher.repo}/releases/latest`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

});

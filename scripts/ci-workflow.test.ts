// This repository retained its portable CI rather than adopting upstream's
// ci-scope/Boat/nightly graph. See docs/current-ci-contract.md for provenance.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; "continue-on-error"?: boolean };
type Job = { steps: Step[]; needs?: string; if?: string; permissions?: unknown; strategy?: { matrix: { os: string[] } }; "runs-on": string; "timeout-minutes": number; "continue-on-error"?: boolean };
const load = (name: string) => parse(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
const workflow = load("ci.yml");
const jobs = workflow.jobs as Record<string, Job>;
const SHARD_TEST = "pnpm exec vitest run --shard=${{ matrix.shard }}/8";
const SECONDARY_TESTS = "pnpm broker:test && pnpm test:electron && pnpm test:packaged-server";
const commands = (job: Job) => job.steps.flatMap(step => step.run ? [step.run] : []);

/** Required checks cannot be made advisory, conditional or omitted. */
function requiredChecks(job: Job) {
  if (job.if || job["continue-on-error"]) return false;
  return ["pnpm typecheck", SHARD_TEST, "pnpm check:electron"].every(command => {
    const step = job.steps.find(step => step.run === command);
    return step && !step.if && !step["continue-on-error"];
  });
}

describe("adopted portable CI contract", () => {
  it("validates both adopted branches and pull requests without a path filter", () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null, push: { branches: ["main", "prod"] }, pull_request: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "ci-${{ github.ref }}", "cancel-in-progress": "${{ github.event_name == 'pull_request' }}" });
  });
  it("runs required checks on all three supported host platforms", () => {
    expect(jobs.test.strategy?.matrix.os).toEqual(["macos-latest", "ubuntu-latest", "windows-latest"]);
    expect(jobs.test["runs-on"]).toBe("${{ matrix.os }}");
    expect(jobs.test["timeout-minutes"]).toBe(30);
    expect(requiredChecks(jobs.test)).toBe(true);
    expect(jobs.test.steps.find(step => step.run === "pnpm typecheck")?.env?.NODE_OPTIONS).toBe("--max-old-space-size=7168");
    expect(commands(jobs.test)).toContain("pnpm install --frozen-lockfile");
  });
  it.each(["omitted", "conditional", "advisory", "job-advisory"])("rejects %s required checks", mode => {
    const job: Job = structuredClone(jobs.test);
    const step = job.steps.find(step => step.run === SHARD_TEST)!;
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
    expect(jobs.test.steps.find(step => step.run === SHARD_TEST)?.env?.OMB_SKIP_REAL_ELECTRON_BROWSER_FIXTURE).toBe("${{ matrix.os == 'windows-latest' && '1' || '0' }}");
  });
  it("validates translation catalogs and builds the full product on Linux", () => {
    expect(jobs.test.steps).toContainEqual(expect.objectContaining({ run: "pnpm i18n:check", if: "matrix.os == 'ubuntu-latest'" }));
    expect(jobs.test.steps).toContainEqual(expect.objectContaining({ run: "pnpm build", if: "matrix.os == 'ubuntu-latest' && matrix.shard == 1" }));
  });
  it("retains every file through eight deterministic shards and once-per-OS secondary stages", () => {
    expect((jobs.test.strategy?.matrix as { shard?: number[] } | undefined)?.shard).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const secondary = jobs.test.steps.find(step => step.run === SECONDARY_TESTS);
    expect(secondary).toMatchObject({ if: "matrix.shard == 1" });
    expect(secondary?.["continue-on-error"]).toBeUndefined();
    expect(jobs.ci.needs).toContain("test");
    expect(jobs.ci.if).toBe("always()");
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
  it("keeps native phone interoperability focused on the existing Intel Mac lane", () => {
    const native = load("verify-main-native.yml");
    expect(native.permissions).toEqual({ contents: "read" });
    expect(native.jobs.startup.strategy.matrix.os).toEqual(["windows-latest", "macos-15-intel"]);
    const step = native.jobs.startup.steps.find((step: Step) => step.name === "Native CryptoKit credential interoperability");
    expect(step).toEqual({ name: "Native CryptoKit credential interoperability", if: "matrix.os == 'macos-15-intel'",
      run: "pnpm exec vitest run server/phone-secret.test.ts server/phone-secret-interop.test.ts" });
  });
  it("stages only private exact-source releases and keeps owner approval plus every native gate before publishing", () => {
    const release = load("release.yml");
    const publish = release.jobs.publish;
    expect(release.on.pull_request).toBeUndefined();
    expect(release.on.push.branches).toEqual(["main", "prod"]);
    expect(release.permissions).toEqual({ contents: "read" });
    expect(publish.if).toBe("github.event_name != 'pull_request'");
    expect(publish.needs).toEqual(["prepare", "linux", "windows", "macos", "download_check", "checks"]);
    expect(publish["continue-on-error"]).toBeUndefined();
    const staging = readFileSync(new URL("./release-staging.mjs", import.meta.url), "utf8");
    expect(staging).toContain("'draft=true'");
    expect(staging).toContain("!old.draft||old.target_commitish!==sha");
    expect(staging).toContain("!release.isDraft||release.targetCommitish!==sha");
    const publishing = readFileSync(new URL("./release-publish.mjs", import.meta.url), "utf8");
    expect(publishing).toContain("policy.publicationApproved!==true");
    expect(publishing).toContain("!release.isDraft||release.targetCommitish!==sha");
    expect(JSON.parse(readFileSync(new URL("./release-policy.json", import.meta.url), "utf8")).publicationApproved).toBe(false);
    expect(commands(publish)).toContain("node scripts/release-publish.mjs v${{ needs.prepare.outputs.version }} ${{ needs.prepare.outputs.sha }}");
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

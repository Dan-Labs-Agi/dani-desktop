import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { assertQualifiedRuntime, configureLocalProfile, prepareLocalWorkspace, runtimeFingerprint } from "./start-local-hermes.mjs";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

it("creates the isolated data directory before native setup and keeps workspace files private", async () => {
  const root = mkdtempSync(join(tmpdir(), "dani-local-start-")); dirs.push(root);
  const dataDir = join(root, "workspace");
  const profileHome = join(root, "profile");
  await prepareLocalWorkspace({ dataDir, profileHome, cli: "/managed/venv/bin/hermes", ensureProfile: async () => {
    expect(existsSync(dataDir)).toBe(true);
  } });
  if (process.platform !== "win32") {
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, "config.json")).mode & 0o777).toBe(0o600);
  }
});

it("does not overwrite an existing persistent workspace configuration", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "dani-local-existing-")); dirs.push(dataDir);
  const original = '{"personName":"Preserved","instances":{}}\n';
  writeFileSync(join(dataDir, "config.json"), original);
  await prepareLocalWorkspace({ dataDir, profileHome: join(dataDir, "profile"), cli: "/managed/hermes", ensureProfile: async () => {} });
  expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe(original);
});

it("canonicalizes legacy scalar tool-search settings before the native browser policy loads", () => {
  const profileHome = mkdtempSync(join(tmpdir(), "dani-local-profile-")); dirs.push(profileHome);
  const file = join(profileHome, "config.yaml");
  writeFileSync(file, "model:\n  default: fixture-model\ntools:\n  tool_search: 'enabled: false'\n", { mode: 0o600 });
  configureLocalProfile(profileHome);
  expect(parseYaml(readFileSync(file, "utf8"))).toMatchObject({ tools: { tool_search: { enabled: "off" } } });
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
});

const selectedRuntime = {
  version: "0.21.3", configuredProvider: "openai-codex", resolvedProvider: "openai-codex",
  model: "fixture-model", endpoint: "https://chatgpt.com/backend-api/codex", apiMode: "codex_responses",
  credentialFingerprint: "a".repeat(64), credentialHeaderNames: [] as string[],
};

it("does not authorize launch from metadata or catalog membership", () => {
  expect(() => assertQualifiedRuntime({ ...selectedRuntime, modelReady: true, availableModels: ["fixture-model"] }, null)).toThrow();
});

it("requires a successful exact provider/model/API-mode runtime fingerprint", () => {
  const qualification = { schemaVersion: 1, qualified: true, toolCallCount: 1, resultConsumed: true,
    fingerprint: runtimeFingerprint(selectedRuntime), credentialFingerprint: selectedRuntime.credentialFingerprint };
  expect(() => assertQualifiedRuntime(selectedRuntime, qualification)).not.toThrow();
  for (const patch of [{ model: "different" }, { apiMode: "chat_completions" },
    { resolvedProvider: "openrouter" }, { endpoint: "https://another.example/v1" }]) {
    expect(() => assertQualifiedRuntime({ ...selectedRuntime, ...patch }, qualification)).toThrow();
  }
  for (const patch of [{ qualified: false }, { toolCallCount: 0 }, { toolCallCount: 2 }, { resultConsumed: false }]) {
    expect(() => assertQualifiedRuntime(selectedRuntime, { ...qualification, ...patch })).toThrow();
  }
});

it("rejects auto, agent-proxy and whole-agent app-server routes regardless of saved qualification", () => {
  for (const patch of [{ configuredProvider: "auto" }, { endpoint: "http://127.0.0.1:4187/v1" },
    { endpoint: "http://localhost:4187/v1" }, { apiMode: "codex_app_server" }]) {
    const runtime = { ...selectedRuntime, ...patch };
    const record = { schemaVersion: 1, qualified: true, toolCallCount: 1, resultConsumed: true,
      fingerprint: runtimeFingerprint(runtime) };
    expect(() => assertQualifiedRuntime(runtime, record)).toThrow();
  }
});

it("never includes arbitrary private runtime fields in its stable fingerprint", () => {
  const fingerprint = runtimeFingerprint({ ...selectedRuntime, apiKey: "private-key", response: "private-answer" });
  expect(fingerprint).toBe(runtimeFingerprint(selectedRuntime));
  expect(fingerprint).not.toContain("private");
});

function launcherFixture(runtime = selectedRuntime, failProbe = false) {
  const home = mkdtempSync(join(tmpdir(), "dani-local-provider-")); dirs.push(home);
  const bin = join(home, ".hermes/hermes-agent/venv/bin");
  const profile = join(home, ".hermes/profiles/dani-local");
  const workspace = join(home, ".danibot-local");
  mkdirSync(bin, { recursive: true }); mkdirSync(profile, { recursive: true }); mkdirSync(workspace);
  writeFileSync(join(bin, "hermes"), "");
  writeFileSync(join(profile, "config.yaml"), "model:\n  default: fixture-model\n  provider: openai-codex\n");
  const operations = join(home, "operations.jsonl");
  const python = join(bin, "python3");
  writeFileSync(python, `#!${process.execPath}\nimport fs from "node:fs";\nconst op=process.argv[3]; fs.appendFileSync(${JSON.stringify(operations)}, JSON.stringify(op)+"\\n");\nif(op==="--version") console.log("0.21.3");\nelse if(op==="--runtime-info") console.log(${JSON.stringify(JSON.stringify({ ...runtime, apiKey: "private-key", response: "private-answer", modelReady: true, availableModels: ["fixture-model"] }))});\nelse if (${failProbe}) { console.error("private-key private-answer"); process.exit(1); } else console.log(${JSON.stringify(JSON.stringify({schemaVersion:1,qualified:true,toolCallCount:1,resultConsumed:true,fingerprint:runtimeFingerprint(runtime),credentialFingerprint:runtime.credentialFingerprint,runtime}))});\n`);
  chmodSync(python, 0o755);
  const run = (mode: string) => spawnSync(process.execPath, [fileURLToPath(new URL("./start-local-hermes.mjs", import.meta.url)), mode], {
    env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH }, encoding: "utf8", timeout: 30_000,
  });
  return { home, workspace, run, operations };
}

it.skipIf(process.platform === "win32")("preparation is metadata-only and cannot turn catalog replies into qualification", () => {
  const fixture = launcherFixture();
  const result = fixture.run("--prepare-only");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).providerQualified).toBe(false);
  expect(readFileSync(fixture.operations, "utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual(["--version", "--runtime-info"]);
  expect(result.stdout + result.stderr + readFileSync(join(fixture.workspace, "local-runtime.json"), "utf8")).not.toContain("private-");
});

it.skipIf(process.platform === "win32")("a failed explicit native probe invalidates prior success without logging native error bodies", () => {
  const fixture = launcherFixture(selectedRuntime, true);
  const record = join(fixture.workspace, "provider-qualification.json");
  writeFileSync(record, JSON.stringify({ schemaVersion: 1, qualified: true, toolCallCount: 1, resultConsumed: true, fingerprint: runtimeFingerprint(selectedRuntime) }));
  const result = fixture.run("--qualify-provider");
  expect(result.status).not.toBe(0);
  expect(JSON.parse(readFileSync(record, "utf8")).qualified, result.stderr).toBe(false);
  expect(result.stdout + result.stderr + readFileSync(record, "utf8")).not.toContain("private-");
});

it.skipIf(process.platform === "win32")("never invokes a model qualification request on the known incompatible agent proxy", () => {
  const fixture = launcherFixture({ ...selectedRuntime, endpoint: "http://127.0.0.1:4187/v1" });
  const result = fixture.run("--qualify-provider");
  expect(result.status).not.toBe(0);
  expect(readFileSync(fixture.operations, "utf8")).not.toContain("--qualify-provider");
});

it("rejects route-only legacy proof and changed resolved credentials", () => {
  const record = { schemaVersion: 1, qualified: true, toolCallCount: 1, resultConsumed: true,
    fingerprint: runtimeFingerprint(selectedRuntime) };
  expect(() => assertQualifiedRuntime(selectedRuntime, record)).toThrow();
  expect(() => assertQualifiedRuntime({ ...selectedRuntime, credentialFingerprint: "b".repeat(64) },
    { ...record, credentialFingerprint: selectedRuntime.credentialFingerprint })).toThrow();
});

it.skipIf(process.platform === "win32")("preparation never displays old route-only proof as currently qualified", () => {
  const fixture = launcherFixture();
  writeFileSync(join(fixture.workspace, "provider-qualification.json"), JSON.stringify({schemaVersion:1,
    qualified:true,toolCallCount:1,resultConsumed:true,fingerprint:runtimeFingerprint(selectedRuntime)}));
  const result = fixture.run("--prepare-only");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).providerQualified).toBe(false);
  expect(readFileSync(fixture.operations,"utf8")).not.toContain("--qualify-provider");
});

it.skipIf(process.platform === "win32")("persists credential-bound native proof and reports only that matching contract qualified", () => {
  const runtime = { ...selectedRuntime, credentialHeaderNames: ["x-fixture-key"] };
  const fixture = launcherFixture(runtime);
  const qualified = fixture.run("--qualify-provider");
  expect(qualified.status, qualified.stderr).toBe(0);
  const record = JSON.parse(readFileSync(join(fixture.workspace, "provider-qualification.json"), "utf8"));
  expect(record).toMatchObject({qualified:true,credentialFingerprint:runtime.credentialFingerprint,
    runtime:{credentialFingerprint:runtime.credentialFingerprint,credentialHeaderNames:["x-fixture-key"]}});
  expect(() => assertQualifiedRuntime(runtime, record)).not.toThrow();
  const prepared = fixture.run("--prepare-only");
  expect(prepared.status, prepared.stderr).toBe(0);
  expect(JSON.parse(prepared.stdout)).toMatchObject({providerQualified:true,credentialFingerprint:runtime.credentialFingerprint,
    credentialHeaderNames:["x-fixture-key"]});
  expect(prepared.stdout + qualified.stdout + prepared.stderr + qualified.stderr + JSON.stringify(record)).not.toContain("private-");
});

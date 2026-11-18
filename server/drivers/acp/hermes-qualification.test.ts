import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it as platformIt, vi } from "vitest";

// These fixtures execute the POSIX native-runtime layout, which Hermes refuses on Windows.
const it = platformIt.skipIf(process.platform === "win32");
import { removeTempDir } from "../../testing/cleanup.ts";

const fixture = vi.hoisted(() => ({ data: "" }));
vi.mock("../../config.ts", () => ({ get DATA_DIR() { return fixture.data; } }));
import { forgetHermesQualifications, requireHermesQualification } from "./hermes-qualification.ts";

let executable: string;
let env: Record<string, string>;
let root: string;
const instance = "qualification-fixture";
const model = "openai-api:fixture-model";
const credentials = new Set(["OPENAI_API_KEY"]);
const runtime = { version: "0.21.3", configuredProvider: "openai-api", resolvedProvider: "openai-api",
  model: "fixture-model", endpoint: "https://fixture.invalid/v1", apiMode: "chat_completions" };
const qualify = (allowProbe = false) => requireHermesQualification(instance, executable, model, env, credentials, allowProbe);
const calls = () => readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string);
const writeAuth = (identity: string) => writeFileSync(join(root, "auth.json"), JSON.stringify({ credential_pool: {
  "openai-api": [{ id: "fixture", source: "manual", auth_type: "api_key", access_token: identity }],
} }));
const saveProof = (legacy = false) => {
  const proof = JSON.parse(execFileSync(executable, ["--qualify-route"], { env, encoding: "utf8" })) as Record<string, unknown>;
  if (legacy) delete proof.credentialFingerprint;
  writeFileSync(join(fixture.data, "provider-qualification.json"), JSON.stringify(proof));
  writeFileSync(join(root, "calls.jsonl"), "");
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-qualification-"));
  fixture.data = join(root, "data");
  mkdirSync(fixture.data);
  env = { HOME: root, HERMES_HOME: root, OPENAI_API_KEY: "synthetic-A" };
  executable = join(root, "native.cjs");
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const home = process.env.HERMES_HOME;
const mode = process.argv.includes('--runtime-info') ? 'runtime' : 'probe';
fs.appendFileSync(path.join(home, 'calls.jsonl'), JSON.stringify(mode)+'\\n');
const runtime = JSON.parse(fs.readFileSync(path.join(home, 'runtime.json'), 'utf8'));
const material = [fs.readFileSync(path.join(home,'auth.json'),'utf8'),process.env.OPENAI_API_KEY];
const credentialFingerprint = crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
const fields = ['version','configuredProvider','resolvedProvider','model','endpoint','apiMode'];
const proof = {schemaVersion:1,qualified:true,toolCallCount:1,resultConsumed:true,
  fingerprint:crypto.createHash('sha256').update(JSON.stringify(fields.map(k=>runtime[k]))).digest('hex'),
  credentialFingerprint:process.env.FIXTURE_PROBE_CHANGED && mode==='probe' ? '0'.repeat(64) : credentialFingerprint};
console.log(JSON.stringify(mode==='runtime' ? {...runtime,credentialFingerprint,credentialHeaderNames:[]} : proof));
`, { mode: 0o700 });
  writeFileSync(join(root, "runtime.json"), JSON.stringify(runtime));
  writeFileSync(join(root, "calls.jsonl"), "");
  writeFileSync(join(root, "config.yaml"), "model: fixture-model\n");
  writeFileSync(join(root, ".env"), "");
  writeAuth("synthetic-A");
});
afterEach(async () => { forgetHermesQualifications(instance); await removeTempDir(root); });

it("invalidates warm success when native auth changes", async () => {
  await qualify(true);
  writeAuth("synthetic-B");
  await expect(qualify()).rejects.toThrow(/explicit task/);
  expect(calls()).toEqual(["runtime", "probe", "runtime"]);
});
it("does not reuse persisted proof for a different native credential", async () => {
  saveProof();
  await qualify();
  writeAuth("synthetic-B");
  forgetHermesQualifications(instance);
  await expect(qualify()).rejects.toThrow(/explicit task/);
  expect(calls()).toEqual(["runtime", "runtime"]);
});
it("does not reuse persisted proof after env credential rotation", async () => {
  saveProof();
  await qualify();
  env.OPENAI_API_KEY = "synthetic-B";
  await expect(qualify()).rejects.toThrow(/explicit task/);
});
it("rejects legacy unbound saved proof for background work", async () => {
  saveProof(true);
  await expect(qualify()).rejects.toThrow(/explicit task/);
  expect(calls()).toEqual(["runtime"]);
});
it("qualifies a legacy record once for an explicit task, then reuses only its exact identity", async () => {
  saveProof(true);
  const identity = await qualify(true);
  expect(identity).toMatchObject({ ...runtime, credentialHeaderNames: [], credentialFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(await qualify()).toEqual(identity);
  expect(calls()).toEqual(["runtime", "probe", "runtime"]);
});
it("reuses a credential-bound saved proof without probing", async () => {
  saveProof();
  await qualify();
  expect(calls()).toEqual(["runtime"]);
});
it("refuses credential changes between resolution and the qualification probe", async () => {
  env.FIXTURE_PROBE_CHANGED = "1";
  await expect(qualify(true)).rejects.toThrow(/did not execute/);
  delete env.FIXTURE_PROBE_CHANGED;
  await expect(qualify(true)).resolves.toMatchObject(runtime);
  expect(calls()).toEqual(["runtime", "probe", "runtime", "probe"]);
});
it.each(["endpoint", "apiMode"] as const)("rechecks resolved %s even when config bytes are unchanged", async field => {
  saveProof();
  await qualify();
  writeFileSync(join(root, "runtime.json"), JSON.stringify({ ...runtime, [field]: field === "endpoint" ? "https://other.invalid/v1" : "codex_responses" }));
  await expect(qualify()).rejects.toThrow(/explicit task/);
});
it.each(["configuredProvider", "resolvedProvider", "model"] as const)("refuses a resolved %s mismatch", async field => {
  writeFileSync(join(root, "runtime.json"), JSON.stringify({ ...runtime, [field]: "wrong" }));
  await expect(qualify(true)).rejects.toThrow(/selected|route/);
  expect(calls()).toEqual(["runtime"]);
});
it("shares an in-flight qualification only for the same resolved contract", async () => {
  const identities = await Promise.all([qualify(true), qualify(true)]);
  expect(identities[0]).toEqual(identities[1]);
  expect(calls().filter(mode => mode === "probe")).toHaveLength(1);
});

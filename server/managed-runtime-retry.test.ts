import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedRuntimeService, managedRuntimeTarget } from "./managed-runtime.ts";
import { removeTempDir } from "./testing/cleanup.ts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root); delete process.env.DANI_MANAGED_HERMES_EXECUTABLE; });
async function fixture(mutateDuringProbe = false, mutateOnRecovery = false) {
  const root = mkdtempSync(join(tmpdir(), "runtime retry (profile & spaces)-")); roots.push(root);
  const payload = join(root, "payload"); const resourcesRoot = join(root, "resources"); const dataDir = join(root, "data");
  const win = process.platform === "win32";
  const executableRelPath = win ? "bin/agent.cmd" : "bin/agent";
  const probeRel = win ? "probe/run.cmd" : "probe/run.sh";
  const files = {
    [executableRelPath]: win ? "@echo off\n" : "#!/bin/sh\n",
    [probeRel]: win ? '@echo off\necho {"result":{"agentInfo":{"name":"hermes-agent","version":"test"}}}\necho PROBE RESULT: PASS (hermes-agent test, ACP initialize)\n' : '#!/bin/sh\necho \'{"result":{"agentInfo":{"name":"hermes-agent","version":"test"}}}\'\necho \'PROBE RESULT: PASS (hermes-agent test, ACP initialize)\'\n',
    NOTICE: "notice\n", "SBOM.cdx.json": "{}\n",
  };
  // Mirrors upstream lazy-deps policy: a writable target overrides the disable flag.
  files[probeRel] = win
    ? '@echo off\nif not "%HERMES_DISABLE_LAZY_INSTALLS%"=="1" exit /b 9\nif not "%HERMES_LAZY_INSTALL_TARGET%"=="" exit /b 9\n' + files[probeRel]
    : '#!/bin/sh\n[ "$HERMES_DISABLE_LAZY_INSTALLS" = 1 ] && [ -z "$HERMES_LAZY_INSTALL_TARGET" ] || exit 9\n' + files[probeRel];
  if (mutateDuringProbe) files[probeRel] += win ? 'echo pollution>>"%~dp0..\\NOTICE"\n' : 'echo pollution >> "$(dirname "$0")/../NOTICE"\n';
  if (mutateOnRecovery) files[probeRel] += win
    ? `if exist "${join(root, "mutate")}" echo pollution>>"%~dp0..\\NOTICE"\n`
    : `if [ -f '${join(root, "mutate")}' ]; then echo pollution >> "$(dirname "$0")/../NOTICE"; fi\n`;
  for (const [rel, text] of Object.entries(files)) { const file = join(payload, rel); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, text); chmodSync(file, 0o755); }
  const runtime = join(resourcesRoot, "managed-runtimes"); mkdirSync(join(runtime, "archives"), { recursive: true }); mkdirSync(join(runtime, "manifests"));
  const target = managedRuntimeTarget(); const archive = join(runtime, "archives", `hermes-runtime-payload-${target}.tar.gz`);
  await tar.c({ cwd: root, file: archive, gzip: true }, ["payload"]);
  const bytes = readFileSync(archive);
  const manifest = { manifestVersion: 1, name: "hermes-runtime-payload", target, version: "test", upstreamCommit: "a".repeat(40), archiveSha256: createHash("sha256").update(bytes).digest("hex"), archiveSize: bytes.length, unpackedSize: Object.values(files).reduce((n, text) => n + Buffer.byteLength(text), 0), format: "tar.gz", executableRelPath, probe: { argv: [probeRel], protocol: "acp-jsonrpc-stdio: test", expectedVersion: "test", expectedAgentName: "hermes-agent" }, noticeRelPath: "NOTICE", sbomRelPath: "SBOM.cdx.json", degradations: ["test fixture"] };
  const manifestPath = join(runtime, "manifests", `hermes-${target}.manifest.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const pointer = join(dataDir, "managed-runtimes", "hermes", "current.json");
  return { root, payload, dataDir, resourcesRoot, pointer, executableRelPath, archive, manifestPath, service: new ManagedRuntimeService({ resourcesRoot, dataDir, startModelRoute: async () => {} }) };
}
describe("verified runtime retry", () => {
  it("activates and recovers runtimes under a profile path containing spaces and shell characters", async () => {
    const f = await fixture();
    await f.service.install("hermes");
    const pointer = readFileSync(f.pointer, "utf8");
    const recovered = new ManagedRuntimeService({ resourcesRoot: f.resourcesRoot, dataDir: f.dataDir, startModelRoute: async () => {} });
    await recovered.initialize();
    expect(recovered.executable("hermes")).toBe(f.service.executable("hermes"));
    expect(readFileSync(f.pointer, "utf8")).toBe(pointer);
    await recovered.stop();
  });
  it("replaces an activation when a corrected payload keeps the same upstream version", async () => {
    const f = await fixture();
    await f.service.install("hermes");
    const first = JSON.parse(readFileSync(f.pointer, "utf8"));
    const manifest = JSON.parse(readFileSync(f.manifestPath, "utf8"));
    writeFileSync(join(f.payload, "NOTICE"), "corrected notice\n");
    await tar.c({ cwd: f.root, file: f.archive, gzip: true }, ["payload"]);
    const bytes = readFileSync(f.archive);
    manifest.archiveSha256 = createHash("sha256").update(bytes).digest("hex");
    manifest.archiveSize = bytes.length;
    manifest.unpackedSize += Buffer.byteLength("corrected notice\n") - Buffer.byteLength("notice\n");
    writeFileSync(f.manifestPath, JSON.stringify(manifest));
    const recovered = new ManagedRuntimeService({ resourcesRoot: f.resourcesRoot, dataDir: f.dataDir, startModelRoute: async () => {} });
    await recovered.initialize();
    expect(recovered.executable("hermes")).toBeNull();
    await recovered.install("hermes");
    const next = JSON.parse(readFileSync(f.pointer, "utf8"));
    expect(next.version).toBe(first.version);
    expect(next.installation).not.toBe(first.installation);
    expect(next.manifestSha256).not.toBe(first.manifestSha256);
    expect(readFileSync(join(f.dataDir, "managed-runtimes", "hermes", next.installation, "NOTICE"), "utf8")).toBe("corrected notice\n");
    expect(readFileSync(join(f.dataDir, "managed-runtimes", "hermes", first.installation, "NOTICE"), "utf8")).toBe("notice\n");
    await recovered.stop();
  });
  it("re-verifies legacy activation pointers against the bundled payload", async () => {
    const f = await fixture();
    await f.service.install("hermes");
    const first = JSON.parse(readFileSync(f.pointer, "utf8"));
    delete first.manifestSha256;
    writeFileSync(f.pointer, JSON.stringify(first));
    const recovered = new ManagedRuntimeService({ resourcesRoot: f.resourcesRoot, dataDir: f.dataDir, startModelRoute: async () => {} });
    await recovered.initialize();
    expect(recovered.executable("hermes")).toBeNull();
    await recovered.install("hermes");
    const next = JSON.parse(readFileSync(f.pointer, "utf8"));
    expect(next.installation).not.toBe(first.installation);
    expect(next.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    await recovered.stop();
  });
  it("does not declare recovered runtime ready when its probe changes verified bytes", async () => {
    const f = await fixture(false, true); await f.service.install("hermes");
    const pointer = readFileSync(f.pointer, "utf8");
    writeFileSync(join(f.root, "mutate"), "trigger only on recovery");
    const recovered = new ManagedRuntimeService({ resourcesRoot: f.resourcesRoot, dataDir: f.dataDir, startModelRoute: async () => {} });
    await recovered.initialize();
    expect(recovered.executable("hermes")).toBeNull();
    expect(recovered.bootstrapStatus().error?.code).toBe("verification-failed");
    expect(readFileSync(f.pointer, "utf8")).toBe(pointer);
    await recovered.stop();
  });
  it("refuses to activate a tree changed by its readiness probe", async () => {
    const f = await fixture(true);
    await expect(f.service.install("hermes")).rejects.toMatchObject({ code: "verification-failed" });
    expect(() => readFileSync(f.pointer)).toThrow();
    expect(f.service.executable("hermes")).toBeNull();
  });
  it("repairs a damaged activation from verified bundled bytes without deleting the old tree or user files", async () => {
    const f = await fixture(); await f.service.install("hermes");
    const first = JSON.parse(readFileSync(f.pointer, "utf8"));
    const old = join(f.dataDir, "managed-runtimes", "hermes", first.installation);
    writeFileSync(join(old, "NOTICE"), "damaged activation with different size");
    writeFileSync(join(f.dataDir, "config.json"), '{"keep":"customer settings"}');
    await f.service.install("hermes");
    const second = JSON.parse(readFileSync(f.pointer, "utf8"));
    expect(second.installation).not.toBe(first.installation);
    expect(readFileSync(join(f.dataDir, "managed-runtimes", "hermes", second.installation, "NOTICE"), "utf8")).toBe("notice\n");
    expect(readFileSync(join(old, "NOTICE"), "utf8")).toBe("damaged activation with different size");
    expect(readFileSync(join(f.dataDir, "config.json"), "utf8")).toBe('{"keep":"customer settings"}');
  });
  it("rejects same-size corruption rather than blessing the existing tree with a new hash", async () => {
    const f = await fixture(); await f.service.install("hermes"); const first = JSON.parse(readFileSync(f.pointer, "utf8"));
    const old = join(f.dataDir, "managed-runtimes", "hermes", first.installation, "NOTICE"); writeFileSync(old, "evil!!\n");
    await f.service.install("hermes"); const second = JSON.parse(readFileSync(f.pointer, "utf8"));
    expect(readFileSync(join(f.dataDir, "managed-runtimes", "hermes", second.installation, "NOTICE"), "utf8")).toBe("notice\n");
    expect(readFileSync(old, "utf8")).toBe("evil!!\n");
  });
  it("keeps the old pointer and activation when bundled archive verification fails", async () => {
    const f = await fixture(); await f.service.install("hermes"); const pointer = readFileSync(f.pointer, "utf8");
    const archive = readFileSync(f.archive); archive[0] ^= 1; writeFileSync(f.archive, archive);
    await expect(f.service.install("hermes")).rejects.toMatchObject({ code: "verification-failed" });
    expect(readFileSync(f.pointer, "utf8")).toBe(pointer);
  });
});

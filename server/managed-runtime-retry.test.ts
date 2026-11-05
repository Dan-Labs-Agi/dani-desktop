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
  const root = mkdtempSync(join(tmpdir(), "runtime-retry-")); roots.push(root);
  const payload = join(root, "payload"); const resourcesRoot = join(root, "resources"); const dataDir = join(root, "data");
  const win = process.platform === "win32";
  const executableRelPath = win ? "bin/agent.cmd" : "bin/agent";
  const probeRel = win ? "probe/run.cmd" : "probe/run.sh";
  const files = {
    [executableRelPath]: win ? "@echo off\n" : "#!/bin/sh\n",
    [probeRel]: win ? '@echo off\necho {"result":{"agentInfo":{"name":"hermes-agent","version":"test"}}}\necho PROBE RESULT: PASS (hermes-agent test, ACP initialize)\n' : '#!/bin/sh\necho \'{"result":{"agentInfo":{"name":"hermes-agent","version":"test"}}}\'\necho \'PROBE RESULT: PASS (hermes-agent test, ACP initialize)\'\n',
    NOTICE: "notice\n", "SBOM.cdx.json": "{}\n",
  };
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
  writeFileSync(join(runtime, "manifests", `hermes-${target}.manifest.json`), JSON.stringify(manifest));
  const pointer = join(dataDir, "managed-runtimes", "hermes", "current.json");
  return { root, dataDir, resourcesRoot, pointer, executableRelPath, archive, service: new ManagedRuntimeService({ resourcesRoot, dataDir, startModelRoute: async () => {} }) };
}
describe("verified runtime retry", () => {
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

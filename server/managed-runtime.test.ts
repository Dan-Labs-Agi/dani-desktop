import { createHash } from "node:crypto";
import { removeTempDir } from "./testing/cleanup.ts";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_OPENCODE_PROMPT_TIMEOUT_MS, ManagedRuntimeService, managedRuntimeReadiness, managedRuntimeTarget, parseManagedRuntimeManifest, safeManagedRuntimeRelativePath, safeManagedRuntimeSymlinkTarget, type ManagedRuntimeKind } from "./managed-runtime.ts";
const valid = {
  manifestVersion: 1, name: "hermes-runtime-payload", target: "linux-x64", version: "0.21.4",
  upstreamCommit: "d337b736aa1e8ebecfab043842d13e4a2d2f48a3", archiveSha256: "b".repeat(64),
  archiveSize: 86_596_540, unpackedSize: 250_270_424, format: "tar.gz", executableRelPath: "bin/hermes-acp",
  probe: { argv: ["probe/run-probe.sh"], protocol: "acp-jsonrpc-stdio: initialize", expectedVersion: "0.21.4", expectedAgentName: "hermes-agent" },
  noticeRelPath: "NOTICE", sbomRelPath: "SBOM.cdx.json", degradations: ["no-pillow-heif"],
};
describe("managed runtime manifest", () => {
  it("accepts the real manifest-v1 payload contract", () => {
    const fixture = process.env.HERMES_MANIFEST_FIXTURE;
    const manifest = fixture ? JSON.parse(readFileSync(fixture, "utf8")) : valid;
    expect(parseManagedRuntimeManifest(manifest)).toMatchObject({ manifestVersion: 1, name: "hermes-runtime-payload", target: "linux-x64" });
  });
  it("rejects missing integrity, provenance, probe, and legal metadata fields", () => {
    for (const field of ["upstreamCommit", "archiveSha256", "archiveSize", "unpackedSize", "probe", "noticeRelPath", "sbomRelPath"]) {
      const payload = { ...valid } as Record<string, unknown>; delete payload[field];
      expect(() => parseManagedRuntimeManifest(payload), field).toThrow();
    }
  });
  it("requires an explicit runtime-specific ACP agent name", () => {
    expect(() => parseManagedRuntimeManifest({ ...valid, probe: { ...valid.probe, expectedAgentName: undefined } })).toThrow();
    expect(parseManagedRuntimeManifest({ ...valid, name: "opencode-runtime-payload", probe: { ...valid.probe, expectedAgentName: "OpenCode" } })).toMatchObject({ probe: { expectedAgentName: "OpenCode" } });
  });
  it("rejects unsafe payload paths", () => {
    for (const path of ["../hermes", "bin/../hermes", "/bin/hermes", "C:\\hermes.exe", "bin//hermes"]) expect(() => safeManagedRuntimeRelativePath(path), path).toThrow();
    expect(safeManagedRuntimeRelativePath("bin/hermes")).toBe("bin/hermes");
  });
  it("allows contained relative symlinks and rejects absolute or escaping targets", () => {
    expect(safeManagedRuntimeSymlinkTarget("/payload", "/payload/runtime/bin/python", "python3.11")).toBe(resolve("/payload/runtime/bin/python3.11")); // native path: D:\\payload\\... on Windows
    expect(safeManagedRuntimeSymlinkTarget("/payload", "/payload/terminfo/x/xterm", "../../share/terminfo/x/xterm")).toBe(resolve("/payload/share/terminfo/x/xterm"));
    for (const target of ["/usr/bin/python", "C:\\Python\\python.exe", "../../../../outside"]) {
      expect(() => safeManagedRuntimeSymlinkTarget("/payload", "/payload/runtime/bin/python", target), target).toThrow();
    }
  });
  it("requires both runtimes and the model route before task-ready", () => {
    expect(managedRuntimeReadiness({ hermes: true, opencode: false, modelRoute: "ready" })).toMatchObject({ runtime: { state: "error", hermes: true, opencode: false }, taskReady: false });
    expect(managedRuntimeReadiness({ hermes: true, opencode: true, modelRoute: "checking" })).toMatchObject({ runtime: { state: "ready" }, modelRoute: { state: "checking" }, taskReady: false });
    expect(managedRuntimeReadiness({ hermes: true, opencode: true, modelRoute: "ready" })).toMatchObject({ runtime: { state: "ready" }, modelRoute: { state: "ready" }, taskReady: true });
  });
  it("allows the free route enough time for a real model turn", () => {
    expect(MANAGED_OPENCODE_PROMPT_TIMEOUT_MS).toBe(300_000);
  });
  it("requires explicit degradation entries for mac-x64", () => {
    expect(() => parseManagedRuntimeManifest({ ...valid, target: "darwin-x64", degradations: [] })).toThrow();
    expect(parseManagedRuntimeManifest({ ...valid, target: "darwin-x64", degradations: ["host probe pending"] })).toBeTruthy();
  });
});

describe("recovered installation startup", () => {
  const seedInstallation = (resourcesRoot: string, dataDir: string, kind: ManagedRuntimeKind) => {
    const target = managedRuntimeTarget();
    const version = "0.0.0-test";
    const installation = `${version}-testhash0000`;
    const root = join(dataDir, "managed-runtimes", kind, installation);
    const win = process.platform === "win32";
    const exeRel = win ? "bin/agent.cmd" : "bin/agent";
    const probeRel = win ? "probe/run-probe.cmd" : "probe/run-probe.sh";
    const files: Record<string, string> = {
      [exeRel]: win ? "@echo off\n" : "#!/bin/sh\n",
      [probeRel]: win
        ? `@echo off\necho {"result":{"agentInfo":{"name":"${kind}-agent","version":"${version}"}}}\necho PROBE RESULT: PASS (${kind}-agent ${version}, ACP initialize)\n`
        : `#!/bin/sh\necho '{"result":{"agentInfo":{"name":"${kind}-agent","version":"${version}"}}}'\necho 'PROBE RESULT: PASS (${kind}-agent ${version}, ACP initialize)'\n`,
      "NOTICE": "test notice\n",
      "SBOM.cdx.json": "{}\n",
    };
    let unpacked = 0;
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
      if (!win) chmodSync(abs, 0o755);
      unpacked += content.length;
    }
    const hash = createHash("sha256");
    const digestFile = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    const visit = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        const rel = relative(root, p).replaceAll("\\", "/");
        const info = lstatSync(p);
        if (info.isDirectory()) visit(p);
        else if (info.isFile()) hash.update(`${rel}\0${info.size}\0${digestFile(p)}\n`);
      }
    };
    visit(root);
    mkdirSync(join(resourcesRoot, "managed-runtimes", "manifests"), { recursive: true });
    const manifest = parseManagedRuntimeManifest({
      manifestVersion: 1, name: `${kind}-runtime-payload`, target, version,
      upstreamCommit: "d337b736aa1e8ebecfab043842d13e4a2d2f48a3",
      archiveSha256: "b".repeat(64), archiveSize: 100, unpackedSize: unpacked, format: "tar.gz",
      executableRelPath: exeRel,
      probe: { argv: [probeRel], protocol: "acp-jsonrpc-stdio: initialize", expectedVersion: version, expectedAgentName: `${kind}-agent` },
      noticeRelPath: "NOTICE", sbomRelPath: "SBOM.cdx.json", degradations: ["test fixture"],
    });
    writeFileSync(join(resourcesRoot, "managed-runtimes", "manifests", `${kind}-${target}.manifest.json`), JSON.stringify(manifest));
    writeFileSync(join(dataDir, "managed-runtimes", kind, "current.json"),
      JSON.stringify({ schemaVersion: 1, version, installation, executable: exeRel, treeSha256: hash.digest("hex"), manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") }) + "\n");
  };

  it("joins a recovered route startup when the renderer posts bootstrap during readiness", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "managed-recovery-race-"));
    let releaseRoute!: () => void;
    const gate = new Promise<void>(r => { releaseRoute = r; });
    let routeStarts = 0;
    try {
      const resourcesRoot=join(tmp,"res"), dataDir=join(tmp,"data");
      for(const kind of ["hermes","opencode"] as const) seedInstallation(resourcesRoot,dataDir,kind);
      const pointer=readFileSync(join(dataDir,"managed-runtimes/hermes/current.json"),"utf8");
      const service=new ManagedRuntimeService({resourcesRoot,dataDir,startModelRoute:async()=>{routeStarts++;await gate;}});
      await service.initialize();
      const pending=service.startBootstrap();
      expect(pending.state).toBe("installing");
      await new Promise(r=>setTimeout(r,50));
      expect(service.bootstrapStatus().error).toBeNull();
      expect(routeStarts).toBe(1);
      releaseRoute();
      for(let i=0;i<100&&!service.bootstrapStatus().readiness.taskReady;i++)await new Promise(r=>setTimeout(r,10));
      expect(service.bootstrapStatus().state).toBe("ready");
      expect(readFileSync(join(dataDir,"managed-runtimes/hermes/current.json"),"utf8")).toBe(pointer);
      await service.stop();
    } finally {releaseRoute();removeTempDir(tmp);}
  });

  it("starts the model route after fresh-boot recovery instead of stalling on checking", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "managed-recovery-"));
    try {
      const resourcesRoot = join(tmp, "res");
      const dataDir = join(tmp, "data");
      for (const kind of ["hermes", "opencode"] as const) seedInstallation(resourcesRoot, dataDir, kind);
      let routeStarts = 0;
      let taskReadyCalls = 0;
      const service = new ManagedRuntimeService({
        resourcesRoot,
        dataDir,
        startModelRoute: async () => { routeStarts++; },
      });
      service.setTaskReadyHandler(async () => { taskReadyCalls++; });
      await service.initialize();
      for (let i = 0; i < 100 && routeStarts === 0; i++) await new Promise(r => setTimeout(r, 10));
      for (let i = 0; i < 100 && !service.bootstrapStatus().readiness.taskReady; i++) await new Promise(r => setTimeout(r, 10));
      const status = service.bootstrapStatus();
      expect(status.error, "seeded recovered fixture must pass real manifest/hash/probe checks").toBeNull();
      expect(routeStarts).toBe(1);
      expect(taskReadyCalls).toBe(1);
      expect(status.readiness.runtime).toMatchObject({ state: "ready", hermes: true, opencode: true });
      expect(status.readiness.taskReady).toBe(true);
      expect(status.state).toBe("ready");
      await service.stop();
    } finally {
      removeTempDir(tmp);
    }
  }, 30_000);
});

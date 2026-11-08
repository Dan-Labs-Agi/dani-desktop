import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ManagedRuntimeService } from "../server/managed-runtime.ts";
import { hermesLaunch } from "../server/drivers/acp/hermes.ts";

const resourcesRoot = process.argv[2];
if (!resourcesRoot) throw new Error("usage: diagnose-installed-runtime RESOURCES_ROOT");

const temporary = await mkdtemp(join(tmpdir(), "dani runtime diagnosis "));
const service = new ManagedRuntimeService({ resourcesRoot: resolve(resourcesRoot), dataDir: join(temporary, "profile") });
try {
  await service.install("hermes");
  console.log("DIRECT_INSTALLED_HERMES_VERIFY_PASS");
  const executable = service.executable("hermes");
  if (!executable) throw new Error("verified Hermes executable is missing");
  const env = { ...process.env, DANI_MANAGED_HERMES_EXECUTABLE: executable };
  const launch = hermesLaunch(executable, ["--version"], env);
  console.log("NATIVE_MANAGED_VERSION", execFileSync(launch.command, launch.args, { env: launch.env, timeout: 15_000, encoding: "utf8" }));
  await service.install("opencode");
  service.startBootstrap();
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    const status = service.bootstrapStatus();
    if (status.state === "repairable-error" || status.state === "blocked-error") {
      throw new Error(`runtime diagnosis failed: ${JSON.stringify(status)}`);
    }
    if (status.state === "ready" && status.readiness.taskReady && status.readiness.runtime.hermes && status.readiness.runtime.opencode) {
      console.log("DIRECT_ROUTE_STATUS", JSON.stringify(status));
      ready = true;
      break;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  if (!ready) throw new Error(`runtime diagnosis timed out: ${JSON.stringify(service.bootstrapStatus())}`);
} catch (error) {
  console.error("DIRECT_INSTALLED_VERIFY_FAILURE", error);
  process.exitCode = 1;
} finally {
  await service.stop();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

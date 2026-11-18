import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WELCOME_VERSION } from "../electron/onboarding-record.mjs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { browserBundlePaths } from "../server/browser-bundle-release.ts";
import { stageBrowserTarget, verifyBrowserBundle } from "./prepare-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(homedir(), ".hermes/hermes-agent/venv/bin/hermes");
const python = join(dirname(cli), "python3");
const profileHome = join(homedir(), ".hermes/profiles/dani-local");
const dataDir = join(homedir(), ".danibot-local");
const bootstrap = join(root, "server/drivers/acp/hermes-bootstrap.py");

class LocalLaunchError extends Error {}
const FINGERPRINT_FIELDS = ["version", "configuredProvider", "resolvedProvider", "model", "endpoint", "apiMode"];
const METADATA_FIELDS = [...FINGERPRINT_FIELDS, "pythonVersion", "pythonExecutable", "source", "credentialFingerprint"];

function safeRuntimeMetadata(runtime) {
  return { ...Object.fromEntries(METADATA_FIELDS.map(key => [key, typeof runtime?.[key] === "string" ? runtime[key] : ""])),
    credentialHeaderNames: Array.isArray(runtime?.credentialHeaderNames)
      ? runtime.credentialHeaderNames.filter(name => typeof name === "string" && /^[a-z0-9_-]+$/.test(name)) : [],
    credentialsResolved: runtime?.credentialsResolved === true };
}

export function runtimeFingerprint(runtime) {
  return createHash("sha256").update(JSON.stringify(FINGERPRINT_FIELDS.map(key => runtime?.[key] || ""))).digest("hex");
}

function assertSupportedRuntime(runtime) {
  const configured = runtime.configuredProvider;
  const expected = typeof configured === "string" && configured.startsWith("custom:") ? "custom" : configured;
  let endpoint;
  try { endpoint = new URL(runtime.endpoint); } catch { throw new LocalLaunchError("Choose a native provider API endpoint before qualification."); }
  if (runtime.version !== "0.21.3" || !configured || configured === "auto" || expected !== runtime.resolvedProvider
    || !runtime.model || !["chat_completions", "codex_responses", "anthropic_messages"].includes(runtime.apiMode)
    || !["http:", "https:"].includes(endpoint.protocol) || endpoint.port === "4187") {
    throw new LocalLaunchError("Select an explicit compatible native provider/model API. Auto, cross-provider fallback, the tool-discarding 4187 agent proxy and whole-agent app-server transports cannot launch.");
  }
}

export function assertQualifiedRuntime(runtime, record) {
  assertSupportedRuntime(runtime);
  if (record?.schemaVersion !== 1 || record.qualified !== true || record.toolCallCount !== 1
    || record.resultConsumed !== true || record.fingerprint !== runtimeFingerprint(runtime)
    || !/^[a-f0-9]{64}$/.test(runtime.credentialFingerprint ?? "")
    || record.credentialFingerprint !== runtime.credentialFingerprint) {
    throw new LocalLaunchError("This exact native provider/model/API mode and credential is not qualified. After authorizing native sign-in and probe budget, explicitly run --qualify-provider.");
  }
}

function writePrivateRecord(file, record) {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new LocalLaunchError("The local runtime record must not be a symlink.");
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readQualification(file) {
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink()) throw new LocalLaunchError("The provider qualification record must not be a symlink.");
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export async function prepareLocalWorkspace({ dataDir, profileHome, cli, ensureProfile }) {
  if (existsSync(dataDir) && lstatSync(dataDir).isSymbolicLink()) throw new LocalLaunchError("The isolated workspace must not be a symlink.");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  await ensureProfile();
  const configFile = join(dataDir, "config.json");
  if (existsSync(configFile) && lstatSync(configFile).isSymbolicLink()) throw new LocalLaunchError("The isolated workspace config must not be a symlink.");
  if (!existsSync(configFile)) {
    writeFileSync(configFile, `${JSON.stringify({
      instances: { hermes: { driver: "hermesAgent", displayName: "Hermes", enabled: true,
        environment: { HERMES_HOME: profileHome }, config: { cli, fullAuto: false } } },
      defaultModelSelection: { instanceId: "hermes", model: "hermes-default" },
      onboarding: { completedAt: new Date().toISOString(), version: WELCOME_VERSION },
    }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  chmodSync(configFile, 0o600);
  return { dataDir, profileHome, cli };
}

function privateTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return; // Never chmod a source-profile symlink target.
  chmodSync(path, stat.isDirectory() || (stat.mode & 0o111) ? 0o700 : 0o600);
  if (stat.isDirectory()) for (const name of readdirSync(path)) privateTree(join(path, name));
}

export function configureLocalProfile(profileHome) {
  if (lstatSync(profileHome).isSymbolicLink()) throw new LocalLaunchError("The isolated native profile must not be a symlink.");
  const nativeConfigFile = join(profileHome, "config.yaml");
  if (lstatSync(nativeConfigFile).isSymbolicLink()) throw new LocalLaunchError("The native profile config must not be a symlink.");
  const nativeConfig = parseYaml(readFileSync(nativeConfigFile, "utf8"));
  if (!nativeConfig || typeof nativeConfig !== "object" || Array.isArray(nativeConfig)) throw new LocalLaunchError("The native profile configuration is not a mapping.");
  const tools = nativeConfig.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) nativeConfig.tools = {};
  const search = nativeConfig.tools.tool_search;
  let changed = false;
  if (!search || typeof search !== "object" || Array.isArray(search) || search.enabled !== "off") {
    nativeConfig.tools.tool_search = { ...(search && typeof search === "object" && !Array.isArray(search) ? search : {}), enabled: "off" };
    changed = true;
  }
  if (changed) writeFileSync(nativeConfigFile, stringifyYaml(nativeConfig), { mode: 0o600 });
  privateTree(profileHome);
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new LocalLaunchError(`Port ${port} is occupied; existing services were not touched.`)));
    server.listen(port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
  });
}

function nativeCommand(command, args, options, failure) {
  try { return execFileSync(command, args, options); }
  catch { throw new LocalLaunchError(failure); }
}

async function main() {
  if (process.platform === "win32") throw new LocalLaunchError("This managed-venv local launcher is not qualified for Windows.");
  if (process.argv.slice(2).some(arg => !["--prepare-only", "--qualify-provider"].includes(arg))
    || (process.argv.includes("--prepare-only") && process.argv.includes("--qualify-provider"))) {
    throw new LocalLaunchError("Usage: node scripts/start-local-hermes.mjs [--prepare-only | --qualify-provider]");
  }
  for (const key of Object.keys(process.env)) {
    if ((key.startsWith("FAKE_") || key.startsWith("OMB_TEST_")) && process.env[key]) {
      throw new LocalLaunchError("Clear fixture environment variables before launching the real Hermes app.");
    }
  }
  if (!existsSync(cli) || !existsSync(python)) throw new LocalLaunchError("Existing managed Hermes virtualenv is required; nothing was installed or changed.");
  await prepareLocalWorkspace({ dataDir, profileHome, cli, ensureProfile: async () => {
    nativeCommand(python, [bootstrap, "--version"], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
      "The selected managed Python must contain qualified Hermes 0.21.3; no native profile was created.");
    if (!existsSync(profileHome)) {
      // Explicit source, no sticky profile mutation, alias, channel credentials, or history clone.
      nativeCommand(cli, ["profile", "create", "dani-local", "--clone-from", "default", "--no-alias"], {
        env: { ...process.env, HERMES_HOME: join(homedir(), ".hermes"), PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
      }, "Native profile cloning failed. Check the explicit default profile; native output was withheld to protect credentials.");
    }
    configureLocalProfile(profileHome);
  } });
  const env = { ...process.env, HERMES_HOME: profileHome, DANI_DATA_DIR: dataDir, OMB_DATA_DIR: dataDir, PYTHONDONTWRITEBYTECODE: "1",
    OMB_PORT: "8812", OMB_UI_PORT: "8811", OMB_WEBHOOK_PORT: "8813", OMB_DEV_TRUST_LOCAL_BROWSER: "1" };
  const runtime = safeRuntimeMetadata(JSON.parse(nativeCommand(python, [bootstrap, "--runtime-info"], {
    env, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
  }, "Native runtime metadata is unavailable. Inspect the isolated native profile privately; no provider response or credential body was printed.").trim()));
  const qualificationFile = join(dataDir, "provider-qualification.json");
  if (process.argv.includes("--qualify-provider")) {
    assertSupportedRuntime(runtime);
    // A failed/timed-out new probe must not leave an old success authorizing launch.
    writePrivateRecord(qualificationFile, { schemaVersion: 1, qualified: false, toolCallCount: 0,
      resultConsumed: false, fingerprint: runtimeFingerprint(runtime), credentialFingerprint: runtime.credentialFingerprint,
      runtime, qualifiedAt: new Date().toISOString() });
    const result = JSON.parse(nativeCommand(python, [bootstrap, "--qualify-provider"], {
      env, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"],
    }, "Native qualification failed or exceeded its bounded probe time. Private SDK output was withheld.").trim());
    const record = {
      schemaVersion: 1, qualified: result.qualified === true && result.fingerprint === runtimeFingerprint(runtime)
        && /^[a-f0-9]{64}$/.test(runtime.credentialFingerprint) && result.credentialFingerprint === runtime.credentialFingerprint,
      toolCallCount: Number.isInteger(result.toolCallCount) ? result.toolCallCount : 0,
      resultConsumed: result.resultConsumed === true,
      fingerprint: typeof result.fingerprint === "string" ? result.fingerprint : "",
      credentialFingerprint: typeof result.credentialFingerprint === "string" ? result.credentialFingerprint : "",
      runtime: safeRuntimeMetadata(result.runtime), qualifiedAt: new Date().toISOString(),
    };
    writePrivateRecord(qualificationFile, record);
    assertQualifiedRuntime(runtime, record);
    console.log(JSON.stringify({ ...runtime, providerQualified: true, qualificationFile }, null, 2));
    return;
  }
  const qualification = readQualification(qualificationFile);
  let providerQualified = false;
  try { assertQualifiedRuntime(runtime, qualification); providerQualified = true; } catch {}
  writePrivateRecord(join(dataDir, "local-runtime.json"), { ...runtime, providerQualified });
  console.log(JSON.stringify({ ...runtime, providerQualified, dataDir, profileHome, cli,
    ui: "http://127.0.0.1:8811", backend: "http://127.0.0.1:8812" }, null, 2));
  if (process.argv.includes("--prepare-only")) return;
  assertQualifiedRuntime(runtime, qualification);
  const config = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
  if (config.instances?.hermes?.config?.cli !== cli || config.instances?.hermes?.environment?.HERMES_HOME !== profileHome
    || config.defaultModelSelection?.instanceId !== "hermes" || config.defaultModelSelection?.model !== "hermes-default") {
    throw new LocalLaunchError("Existing local workspace selects a different engine/profile. It was preserved; explicitly restore its Hermes selection before using this launcher.");
  }
  if (config.instances.hermes.enabled === false) throw new LocalLaunchError("The isolated Hermes instance is disabled. After qualification, explicitly re-enable that instance before launch.");
  await Promise.all([8811, 8812, 8813].map(assertPortFree));
  const target = `${process.platform}-${process.arch}`;
  const browser = browserBundlePaths(join(root, "dist-native", "browser", target), target);
  try { verifyBrowserBundle(browser.directory, target); }
  catch { await stageBrowserTarget(root, target); }
  env.OMB_AGENT_BROWSER_PATH = browser.engine;
  env.AGENT_BROWSER_EXECUTABLE_PATH = browser.chrome;
  const children = new Set();
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  for (const [entry, nodeArgs, appArgs] of [["server/dev-server.ts", ["--experimental-strip-types"], []], ["node_modules/vite/bin/vite.js", [], ["--strictPort"]]]) {
    const child = spawn(process.execPath, [...nodeArgs, join(root, entry), ...appArgs], { cwd: root, env, stdio: "inherit" });
    children.add(child);
    child.once("error", () => { console.error(`Could not start ${entry}`); process.exitCode = 1; stop(); });
    child.once("exit", code => { children.delete(child); if (!stopping) { process.exitCode = code || 1; stop(); } });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof LocalLaunchError ? error.message : "Local Hermes startup failed. Inspect the native profile privately; private configuration/SDK error details were withheld.");
    process.exitCode = 1;
  });
}

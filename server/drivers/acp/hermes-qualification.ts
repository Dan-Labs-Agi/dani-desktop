import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { DATA_DIR } from "../../config.ts";
import { SERVER_ROOT } from "../../proxy-paths.ts";

const invoke = promisify(execFile);
const identityFields = ["version", "configuredProvider", "resolvedProvider", "model", "endpoint", "apiMode"] as const;
const nativeRuntimeSchema = z.object({
  version: z.literal("0.21.3"), configuredProvider: z.string().min(1), resolvedProvider: z.string().min(1),
  model: z.string().min(1), endpoint: z.string().url(),
  apiMode: z.enum(["chat_completions", "codex_responses", "anthropic_messages"]),
  credentialFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  credentialHeaderNames: z.array(z.string().regex(/^[a-z0-9_-]+$/)),
});
const qualificationSchema = z.object({
  schemaVersion: z.literal(1), qualified: z.literal(true), toolCallCount: z.literal(1),
  resultConsumed: z.literal(true), fingerprint: z.string(),
  credentialFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
type NativeRuntime = z.infer<typeof nativeRuntimeSchema>;
export type HermesQualificationIdentity = NativeRuntime & { fingerprint: string };
const checks = new Map<string, Map<string, Promise<HermesQualificationIdentity>>>();

function fingerprint(runtime: NativeRuntime): string {
  return createHash("sha256").update(JSON.stringify(identityFields.map(key => runtime[key]))).digest("hex");
}

function matchesQualification(value: unknown, runtime: NativeRuntime): boolean {
  const result = qualificationSchema.safeParse(value);
  return result.success && result.data.fingerprint === fingerprint(runtime)
    && result.data.credentialFingerprint === runtime.credentialFingerprint;
}

function readQualification(): unknown {
  try { return JSON.parse(readFileSync(join(DATA_DIR, "provider-qualification.json"), "utf8")); }
  catch { return null; }
}

function contractKey(python: string, model: string, env: Record<string, string | undefined>, credentialEnv: ReadonlySet<string>): string {
  const hash = createHash("sha256").update(JSON.stringify([python, model, env.HERMES_HOME]));
  for (const name of [...credentialEnv].sort()) hash.update(JSON.stringify([name, env[name] ?? ""]));
  if (env.HERMES_HOME) for (const file of ["config.yaml", ".env", "auth.json"]) {
    try { hash.update(readFileSync(join(env.HERMES_HOME, file))); } catch { hash.update(file); }
  }
  return hash.digest("hex");
}

async function nativeJson(python: string, args: string[], env: Record<string, string | undefined>): Promise<unknown> {
  try {
    const { stdout } = await invoke(python, [join(SERVER_ROOT, "drivers", "acp", "hermes-bootstrap.py"), ...args], {
      env: { ...env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 180_000, maxBuffer: 128 * 1024, windowsHide: true,
    });
    return JSON.parse(stdout);
  } catch {
    throw new Error("The selected model could not complete native tool qualification. No task instructions or browser actions were sent.");
  }
}

export async function requireHermesQualification(instanceId: string, python: string, model: string,
  env: Record<string, string | undefined>, credentialEnv: ReadonlySet<string>, allowProbe: boolean): Promise<HermesQualificationIdentity> {
  const decoded = nativeRuntimeSchema.safeParse(await nativeJson(python, ["--runtime-info", model], env));
  if (!decoded.success) throw new Error("The selected model has no qualified native API runtime.");
  const runtime = decoded.data;
  const identity = { ...runtime, fingerprint: fingerprint(runtime) };
  const key = JSON.stringify([contractKey(python, model, env, credentialEnv), identity.fingerprint, runtime.credentialFingerprint]);
  let instance = checks.get(instanceId);
  if (!instance) { instance = new Map(); checks.set(instanceId, instance); }
  const existing = instance.get(key);
  if (existing) return existing;
  const checking = (async () => {
    const separator = model.startsWith("custom:") ? model.indexOf(":", 7) : model.indexOf(":");
    if (separator < 0 || runtime.configuredProvider !== model.slice(0, separator) || runtime.model !== model.slice(separator + 1)) {
      throw new Error("Native model resolution changed the selected provider or model. No task was sent.");
    }
    const expectedProvider = runtime.configuredProvider.startsWith("custom:") ? "custom" : runtime.configuredProvider;
    const endpoint = new URL(runtime.endpoint);
    if (runtime.configuredProvider === "auto" || runtime.resolvedProvider !== expectedProvider || ["4187", "4190"].includes(endpoint.port)) {
      throw new Error("This route cannot preserve the selected native model and tool execution.");
    }
    if (matchesQualification(readQualification(), runtime)) return identity;
    if (!allowProbe) throw new Error("Run an explicit task to qualify this model before using it for background work.");
    const proof = await nativeJson(python, ["--qualify-route", model], env);
    if (!matchesQualification(proof, runtime)) {
      throw new Error("This model did not execute and consume the native qualification tool result. The task remains unstarted; no alternate model was used.");
    }
    return identity;
  })();
  instance.set(key, checking);
  try { return await checking; }
  catch (error) { instance.delete(key); throw error; }
}

export function forgetHermesQualifications(instanceId: string): void {
  checks.delete(instanceId);
}

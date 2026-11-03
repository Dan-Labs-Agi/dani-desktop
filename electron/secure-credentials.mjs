// "unavailable" (could not read) must never look like "empty": a caller would register a fresh installation over the real one.
// macOS says "temporarily unavailable. Please try again." for a keychain that is busy at launch, so retry briefly first.
export const CREDENTIAL_READ_DELAYS_MS = [100, 200, 400, 800];

// A chosen wait budget, not an OS guarantee: an OS credential call can stay
// pending forever behind a system prompt nobody answers (an upgrade whose
// keychain item is ACL'd to the old signature prompts; headless, nothing
// answers). Tunable for tests and for hosts whose store answers slowly.
export const CREDENTIAL_CALL_TIMEOUT_MS = 15_000;

export const CREDENTIAL_CALL_TIMED_OUT = "the credential store did not answer in time";

/** One bounded OS credential call. When the budget lapses the attempt ends;
 * the OS promise keeps running in the background and `settled()` lets a
 * caller prove a late resolution is discarded, never applied behind a newer
 * attempt. The error says only that no answer came - never that the stored
 * data is corrupt, and never that a prompt is definitely waiting. */
async function boundedCredentialCall(call, timeoutMs) {
  let settled = false;
  const outcome = Promise.resolve()
    .then(call)
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    )
    .finally(() => { settled = true; });
  // The budget runs on the real clock, deliberately NOT on the injected
  // backoff `sleep`: tests fake that sleep to skip pacing delays, and a
  // zero-delay fake must not zero the actual wait budget.
  const budget = new Promise((resolve) => setTimeout(() => resolve(CREDENTIAL_CALL_TIMED_OUT), timeoutMs));
  const raced = await Promise.race([outcome, budget]);
  if (raced === CREDENTIAL_CALL_TIMED_OUT) return { timedOut: true, settled: () => settled };
  return { timedOut: false, ...raced, settled: () => settled };
}

/** Encrypt one document with the same bounded wait as reads. A timed-out
 * write attempt throws before any file operation, so nothing partial is
 * ever renamed over the real store. */
export async function encryptSecureDocument({ encrypt, timeoutMs = CREDENTIAL_CALL_TIMEOUT_MS }) {
  const attempt = await boundedCredentialCall(encrypt, timeoutMs);
  if (attempt.timedOut) {
    const error = new Error(CREDENTIAL_CALL_TIMED_OUT);
    error.code = "credential-call-timeout";
    throw error;
  }
  if (!attempt.ok) throw attempt.error;
  return attempt.value;
}

const message = (error) => (error instanceof Error ? error.message : String(error));

export async function readSecureCredentials({
  exists,
  isAvailable,
  readFile,
  decrypt,
  sleep,
  delays = CREDENTIAL_READ_DELAYS_MS,
  timeoutMs = CREDENTIAL_CALL_TIMEOUT_MS,
}) {
  if (!exists()) return { status: "empty", credentials: {} };

  let lastError = "the operating-system credential store is unavailable";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      if (!(await isAvailable())) {
        lastError = "the operating-system credential store is unavailable";
        continue;
      }
      const call = await boundedCredentialCall(() => decrypt(readFile()), timeoutMs);
      if (call.timedOut) {
        // Prompt-gated, not transient: the backoff retries are for a busy
        // store, not for a wait nobody may ever answer. The underlying
        // promise is orphaned here; its late result is never applied.
        return { status: "unavailable", credentials: {}, error: CREDENTIAL_CALL_TIMED_OUT, timedOut: true, settled: call.settled };
      }
      if (!call.ok) throw call.error;
      const decrypted = call.value;
      const text = typeof decrypted === "string" ? decrypted : decrypted?.result;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
        }
        return { status: "ok", credentials: parsed };
      } catch {
        return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
      }
    } catch (error) {
      lastError = message(error);
    }
  }
  return { status: "unavailable", credentials: {}, error: lastError };
}

// "unavailable" (could not read) must never look like "empty": a caller would register a fresh installation over the real one.
// macOS says "temporarily unavailable. Please try again." for a keychain that is busy at launch, so retry briefly first.
export const CREDENTIAL_READ_DELAYS_MS = [100, 200, 400, 800];

const message = (error) => (error instanceof Error ? error.message : String(error));

const SECURE_STORAGE_TIMEOUT_MS = 10_000;

class SecureStorageTimeoutError extends Error {
  constructor() {
    super("The operating-system secure storage did not respond. Unlock it and try again.");
    this.name = "SecureStorageTimeoutError";
  }
}

/** A timed-out OS operation cannot authorize persistence of its late result. */
export async function withSecureStorageDeadline(operation, timeoutMs = SECURE_STORAGE_TIMEOUT_MS) {
  if (timeoutMs <= 0) throw new SecureStorageTimeoutError();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SecureStorageTimeoutError()), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readSecureCredentials({
  exists,
  isAvailable,
  readFile,
  decrypt,
  sleep,
  delays = CREDENTIAL_READ_DELAYS_MS,
  timeoutMs = SECURE_STORAGE_TIMEOUT_MS,
}) {
  if (!exists()) return { status: "empty", credentials: {} };
  const deadline = Date.now() + timeoutMs;

  let lastError = "the operating-system credential store is unavailable";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      if (!(await withSecureStorageDeadline(isAvailable, deadline - Date.now()))) {
        lastError = "the operating-system credential store is unavailable";
        continue;
      }
      const decrypted = await withSecureStorageDeadline(() => decrypt(readFile()), deadline - Date.now());
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
      if (error instanceof SecureStorageTimeoutError) break;
    }
  }
  return { status: "unavailable", credentials: {}, error: lastError };
}

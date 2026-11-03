import {
  CREDENTIAL_CALL_TIMEOUT_MS,
  encryptSecureDocument,
  readSecureCredentials,
} from "./secure-credentials.mjs";
import { createSecureCredentialState } from "./secure-credential-state.mjs";

/**
 * One serial coordinator for every credential-store attempt. Reads (launch,
 * then each user "try again") and writes must never run at the same time: a
 * write queue plus a read generation counter are two separate paths and do
 * not exclude each other, so every attempt - read or write - goes through a
 * single chain here. A timed-out attempt ends its slot; the OS promise it
 * orphaned keeps running but has no continuation that can touch state or the
 * filesystem, and the read generation is a second guard on top.
 *
 * Write attempts own uniquely named temporary files, and a failed attempt
 * removes only its own file - never another attempt's, never the real store.
 */
export function createSecureCredentialAccess({
  store: { exists, isAvailable, readFile, decrypt, encrypt },
  sleep,
  timeoutMs = CREDENTIAL_CALL_TIMEOUT_MS,
  fs: { mkdir, writeFile, rename, unlink },
  storeFile,
  tmpFile = (attempt) => `${storeFile}.${attempt}.tmp`,
  onUnavailable = () => {},
  onRecovered = () => {},
}) {
  let chain = Promise.resolve();
  const serial = (step) => {
    const run = chain.then(step);
    chain = run.then(() => {}, () => {});
    return run;
  };

  let unavailable = false;
  let readGeneration = 0;
  let writeAttempts = 0;
  let state = null;

  async function save(credentials) {
    return serial(async () => {
      if (unavailable) {
        throw new Error("The operating-system credential store is unavailable, and the saved data has not been changed");
      }
      if (!(await isAvailable())) {
        throw new Error("The operating-system credential store is unavailable");
      }
      const attempt = ++writeAttempts;
      const encrypted = await encryptSecureDocument({
        encrypt: () => encrypt(JSON.stringify(credentials)),
        timeoutMs,
      });
      if (attempt !== writeAttempts) {
        throw new Error("A newer credential write superseded this one before it finished");
      }
      mkdir();
      const temporary = tmpFile(attempt);
      try {
        writeFile(temporary, encrypted);
        rename(temporary, storeFile);
      } catch (error) {
        try { unlink(temporary); } catch { /* this attempt's own file may not exist */ }
        throw error;
      }
    });
  }

  async function read() {
    return serial(async () => {
      const generation = ++readGeneration;
      const result = await readSecureCredentials({ exists, isAvailable, readFile, decrypt, sleep, timeoutMs });
      if (generation !== readGeneration) {
        return { status: "superseded", credentials: state ? state.read() : {} };
      }
      const wasUnavailable = unavailable;
      unavailable = result.status === "unavailable";
      if (unavailable) onUnavailable(result.error);
      if (result.status === "ok" || result.status === "empty") {
        state = createSecureCredentialState(result.credentials, save, { writable: true });
        // Recovery is the transition unavailable -> readable; boot leaves no
        // prior state behind, so it cannot be the condition.
        if (wasUnavailable) onRecovered();
      }
      return {
        status: result.status,
        credentials: result.status === "unavailable" ? (state ? state.read() : {}) : result.credentials,
        error: result.error,
        timedOut: result.timedOut === true,
      };
    });
  }

  return {
    read,
    save,
    state: () => state,
    isUnavailable: () => unavailable,
  };
}

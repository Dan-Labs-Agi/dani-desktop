// Every test file gets a throwaway home, so DATA_DIR (~/.openmausbot) never touches the real one;
// os.homedir() reads HOME / USERPROFILE at call time, and this runs before server/config.ts is imported.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach } from "vitest";

import { removeTempDir } from "./cleanup.ts";

const home = mkdtempSync(join(tmpdir(), "omb-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
// OMB_DATA_DIR must never escape the throwaway home the suite deletes.
delete process.env.OMB_DATA_DIR;
delete process.env.DANI_DATA_DIR;
// Do not let a developer's Hermes global config path leak into per-test homes.
delete process.env.HERMES_HOME;
// Named explicitly although homedir() already covers it: the device tests delete this directory wholesale.
process.env.OMB_COMPANION_DIR = join(home, ".openmausbot-companion");

// Product code follows navigator.language; pin it so English assertions do not depend on the host locale.
Object.defineProperty(globalThis.navigator, "language", { value: "en", configurable: true });

// DOM tests do not open the server database. Importing its native SQLite module
// into the client bundler prevents those tests from being collected at all.
let closeMessageDb: (() => void) | undefined;
if (typeof window === "undefined") {
  ({ closeMessageDb } = await import("../message-db.ts"));
  // Windows will not remove an open database: keep real server cleanup intact.
  afterEach(closeMessageDb);
}

// Windows holds a live process's cwd, and a just-killed CLI lets go a beat after the kill returns.
afterAll(async () => {
  closeMessageDb?.();
  await removeTempDir(home);
});

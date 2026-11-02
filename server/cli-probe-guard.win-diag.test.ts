// TEMPORARY Windows diagnostic for the symlinked-CLI allowlist mismatch (the
// class-2 Windows CI failure). The assertion is deliberately impossible: the
// printed object IS the evidence. Remove when the repair lands.
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { buildCliProbeAllowlist, canonicalCliTarget, classifyCliProbe } from "./cli-probe-guard.ts";
import { resetPathCacheForTests } from "./env-path.ts";

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cli-probe-diag-")));
  savedPath = process.env.PATH;
});

afterEach(() => {
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  resetPathCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

it.runIf(process.platform === "win32")("win-diag: canonical forms of a symlinked CLI", () => {
  const installed = join(dir, "codex.cmd");
  writeFileSync(installed, "@echo hi\r\n", { mode: 0o755 });
  chmodSync(installed, 0o755);
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
  resetPathCacheForTests();
  const link = join(dir, "codex-alias");
  symlinkSync(installed, link);

  const installedReal = realpathSync(installed);
  const linkReal = realpathSync(link);
  const canonicalInstalled = canonicalCliTarget(installed);
  const canonicalLink = canonicalCliTarget(link);
  const allow = buildCliProbeAllowlist();
  const verdict = classifyCliProbe(link, false);

  expect({
    dir,
    installedReal,
    linkReal,
    canonicalInstalled,
    canonicalLink,
    equal: installedReal === linkReal,
    equalCaseFold: installedReal.toLowerCase() === linkReal.toLowerCase(),
    equalNoPrefix: installedReal.replace(/^\\\\\?\\/, "") === linkReal.replace(/^\\\\\?\\/, ""),
    allowHitInstalled: allow.has(canonicalInstalled ?? ""),
    allowHitLink: allow.has(canonicalLink ?? ""),
    allowCodexEntries: [...allow].filter((e) => e.toLowerCase().includes("codex")),
    verdict,
  }).toBe("the diff of this object is the diagnostic");
});

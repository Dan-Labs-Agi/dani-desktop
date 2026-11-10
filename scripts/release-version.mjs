import { pathToFileURL } from "node:url";

const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(value, allowLocal = false) {
  const stable = allowLocal ? value.replace(/-local\.(0|[1-9]\d*)$/, "") : value;
  const match = STABLE.exec(stable);
  const parts = match?.slice(1).map(Number);
  if (!parts || !parts.every(Number.isSafeInteger)) {
    throw new Error(`Expected a stable X.Y.Z${allowLocal ? " or X.Y.Z-local.N" : ""} version, got: ${value || "(empty)"}`);
  }
  return { parts, local: stable !== value };
}

export function nextReleaseVersion(current, bump, requested = "") {
  const { parts: before, local } = parseVersion(current, true);
  let after;
  if (bump === "patch") after = [before[0], before[1], before[2] + (local ? 0 : 1)];
  else if (bump === "minor") after = [before[0], before[1] + 1, 0];
  else if (bump === "custom") after = parseVersion(requested).parts;
  else throw new Error(`Unknown bump: ${bump}`);
  const next = after.join(".");
  parseVersion(next);
  const changed = after.findIndex((part, index) => part !== before[index]);
  if ((changed === -1 && !local) || (changed !== -1 && after[changed] < before[changed])) {
    throw new Error(`${next} must be newer than ${current}`);
  }
  return next;
}

export function validateReleaseVersion(version, ref = "") {
  parseVersion(version);
  if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`) {
    throw new Error(`Release tag must be v${version} to match package.json`);
  }
  return version;
}

/** @param {{ sha: string, tagSha?: string, draftSha?: string }} candidate */
export function assertReleaseIdentity({ sha, tagSha, draftSha }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Release SHA must be a full commit SHA");
  if (tagSha && tagSha !== sha) throw new Error(`Existing tag commit ${tagSha} does not match release SHA ${sha}`);
  if (draftSha && draftSha !== sha) throw new Error(`Existing draft commit ${draftSha} does not match release SHA ${sha}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === "next") console.log(nextReleaseVersion(first, second, third));
  else if (command === "validate") console.log(validateReleaseVersion(first, second));
  else if (command === "identity") assertReleaseIdentity({ sha: first, tagSha: second, draftSha: third });
  else throw new Error("Expected next, validate, or identity command");
}

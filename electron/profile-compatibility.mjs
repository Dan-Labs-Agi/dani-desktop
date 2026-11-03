// Choose an existing desktop profile without copying, merging or decrypting it.
import { lstatSync } from "node:fs";
import path from "node:path";
export const PROFILE_CHOICE_PREFIX = "--dani-profile-choice=";
export function profileDecision({ platform, packaged, appData, current, inspect = lstatSync, choice = null }) {
  if (!packaged || !["win32", "darwin"].includes(platform)) return { kind: "continue", path: current };
  const established = path.join(appData, "Dani Bot");
  if (established === current) return { kind: "continue", path: current };
  const exists = (file) => {
    try {
      const entry = inspect(file);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Profile is not a plain directory: ${file}`);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  };
  const oldExists = exists(established), currentExists = exists(current);
  if (oldExists && currentExists) {
    if (choice === "established") return { kind: "continue", path: established };
    if (choice === "current") return { kind: "continue", path: current };
    return { kind: "choose", established, current };
  }
  return { kind: "continue", path: oldExists ? established : current };
}

import fs from "node:fs";
import path from "node:path";

/** The home-folder directory this app keeps its data in. Dani Bot's own folder is ~/.danibot. A machine that already
 * runs the upstream OpenMausBot (or this app's earlier builds) may hold its data in ~/.openmausbot instead; that folder
 * is read in place and never moved, copied or deleted, so both apps keep working. A fresh machine gets ~/.danibot. */
export const DANI_DATA_DIRNAME = ".danibot";
export const LEGACY_DATA_DIRNAME = ".openmausbot";

export function defaultDataDir(home, exists = fs.existsSync) {
  const own = path.join(home, DANI_DATA_DIRNAME);
  if (exists(own)) return own;
  const legacy = path.join(home, LEGACY_DATA_DIRNAME);
  return exists(legacy) ? legacy : own;
}

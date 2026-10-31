import path from "node:path";

/** Dani Bot keeps its data in ~/.danibot, the folder the earlier Dani Bot builds already use. It never falls back to
 * ~/.openmausbot: that folder belongs to the upstream OpenMausBot app, and opening it from here would take over (or
 * fight over the lease of) another app's profile. Nothing is moved, copied or deleted. */
export const DANI_DATA_DIRNAME = ".danibot";

export function defaultDataDir(home) {
  return path.join(home, DANI_DATA_DIRNAME);
}

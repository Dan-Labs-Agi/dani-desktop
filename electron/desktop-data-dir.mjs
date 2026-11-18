import path from "node:path";

export function desktopDataDir(app) {
  return process.env.DANI_DATA_DIR || process.env.OMB_DATA_DIR || path.join(app.getPath("home"), ".danibot");
}


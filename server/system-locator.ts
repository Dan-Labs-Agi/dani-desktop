import { join } from "node:path";

/** Use Windows' trusted locator even when a GUI launch omits System32 from PATH. */
export function systemLocator(command: string): string {
  const root = process.env.SystemRoot || process.env.WINDIR;
  return command === "where.exe" && process.platform === "win32" && root
    ? join(root, "System32", "where.exe")
    : command;
}

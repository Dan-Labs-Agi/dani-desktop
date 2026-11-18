// Ownership fixtures run several tiny synthetic engines together. Their capacity
// must not depend on the CI worker's RAM or other suites' processes. Memory
// admission itself is covered with measured hosts in engine-memory.test.ts.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  if (String(path) === "/proc/meminfo") {
    const text = "MemTotal:       8388608 kB\nMemAvailable:   7340032 kB\nSwapFree:       0 kB\n";
    return typeof args[0] === "string" || args[0]?.encoding ? text : Buffer.from(text);
  }
  return read.call(this, path, ...args);
};
syncBuiltinESMExports();

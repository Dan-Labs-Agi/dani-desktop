// Proves the install line the app puts on the clipboard (it never installs the
// .deb itself) works as pasted, quoting included, as root on a clean Ubuntu,
// and that a bare `dpkg -i` does not.
//
//   node scripts/smoke-deb-command.mjs <path-to-deb>
//
// Needs a container runtime.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { packageInstallCommand } from "../electron/package-install-command.mjs";

const IMAGE = process.env.OMB_DEB_SMOKE_IMAGE || "ubuntu:24.04";
const RUNTIME = process.env.OMB_DEB_SMOKE_RUNTIME || "docker";
if (!["docker", "podman"].includes(RUNTIME)) throw new Error("unsupported container runtime");

function fail(message) {
  console.error(`[smoke-deb-command] ${message}`);
  process.exit(1);
}

const deb = path.resolve(process.argv[2] ?? "");
if (!deb.endsWith(".deb") || !existsSync(deb)) fail("pass the path to a .deb");

// Inside the container the package sits at a path with a space and an
// apostrophe, so the quoting the app emits is exercised, not assumed.
const staged = "/root/pending dir/o'brien/DaniBot.deb";
const command = packageInstallCommand("deb", staged);
console.log(`[smoke-deb-command] command under test:\n    ${command}\n`);

function inContainer(script, { expectFailure = false, modelUnrestrictedHost = false } = {}) {
  try {
    const output = execFileSync(
      RUNTIME,
      [
        "run", "--rm",
        // Only the unrestricted-host scenario needs extra privilege (to bind-mount a file over the sysctl); every other
        // run keeps the runtime's default confinement. The container is disposable and holds only the package under test.
        ...(modelUnrestrictedHost ? ["--cap-add", "SYS_ADMIN", "--security-opt", "apparmor=unconfined"] : []),
        "-v", `${deb}:/tmp/package.deb:ro`,
        "-e", "DEBIAN_FRONTEND=noninteractive",
        IMAGE,
        "/bin/bash", "-c", script,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60 * 1000 },
    );
    if (expectFailure) fail("the command was expected to fail but succeeded");
    return output;
  } catch (error) {
    if (expectFailure) return String(error.stdout ?? "") + String(error.stderr ?? "");
    console.error(String(error.stdout ?? "").slice(-6000));
    console.error(String(error.stderr ?? "").slice(-6000));
    throw error;
  }
}

// Everything before the command under test is setup; `set -e` keeps a failed
// setup from being read as a failed install.
const prepare = [
  "set -e",
  "apt-get update -qq",
  "apt-get install -y -qq sudo >/dev/null",
  `mkdir -p "$(dirname "${staged}")"`,
  `cp /tmp/package.deb "${staged}"`,
].join("\n");

// The post-install fails closed when the kernel restricts user namespaces and AppArmor is not running (what a
// container on a current runner looks like). Scenario A models the other supported host, restriction off; scenario B
// keeps the host's real value and, when it is 1, asserts the fail-closed refusal with its diagnostic.
const RESTRICTION = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
const unrestrictedHost = [
  `if [ -e ${RESTRICTION} ]; then printf 0 > /tmp/userns-unrestricted; mount --bind /tmp/userns-unrestricted ${RESTRICTION}; fi`,
  `echo "RESTRICTION=$(cat ${RESTRICTION} 2>/dev/null || echo absent)"`,
].join("\n");

console.log("[smoke-deb-command] installing with the command the app hands over (host without the userns restriction)…");
const installed = inContainer(
  [
    prepare,
    unrestrictedHost,
    command,
    'dpkg-query -W -f="INSTALLED=\\${Version} \\${db:Status-Abbrev}\\n" danibot',
    'test -x "/opt/Dani Bot/danibot" && echo "EXECUTABLE=yes"',
  ].join("\n"),
  { modelUnrestrictedHost: true },
);

const version = installed.match(/INSTALLED=(\S+) (\S+)/);
const checks = [
  ["the package installed and configured", version?.[2]?.startsWith("ii") === true],
  ["the app binary is in place", installed.includes("EXECUTABLE=yes")],
];

// Scenario B: the host's own restriction value, default container confinement, nothing modelled.
console.log("[smoke-deb-command] fail-closed check: the host's real restriction value, AppArmor not running in the container…");
const closed = inContainer(
  [
    prepare,
    `echo "RESTRICTION=$(cat ${RESTRICTION} 2>/dev/null || echo absent)"`,
    `${command} || echo "INSTALL_REFUSED"`,
    'dpkg-query -W -f="STATUS=\\${db:Status-Abbrev}\\n" danibot || true',
  ].join("\n"),
  { expectFailure: false },
);
const hostRestriction = closed.match(/RESTRICTION=(\S+)/)?.[1];
if (hostRestriction === "1") {
  checks.push([
    "restriction 1 with AppArmor absent refuses the install with its diagnostic and leaves the package unconfigured",
    closed.includes("INSTALL_REFUSED") &&
      closed.includes("cannot load its browser sandbox policy while AppArmor restrictions are active") &&
      !/STATUS=ii/.test(closed),
  ]);
} else {
  console.log(`[smoke-deb-command] fail-closed check skipped: this host reports restriction=${hostRestriction}, so the refusal path is not exercised here`);
}

// Control: on a clean Ubuntu `dpkg -i` resolves none of the dependencies.
console.log("[smoke-deb-command] control: the `dpkg -i` the app used to run…");
const control = inContainer([prepare, `dpkg -i "${staged}" || echo "DPKG_FAILED"`].join("\n"), {
  expectFailure: false,
});
checks.push([
  "`dpkg -i` alone fails where the handed-over command works",
  control.includes("DPKG_FAILED") || /dependency problems|not installed/i.test(control),
]);

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✔" : "✖"} ${label}`);
  if (!ok) failed += 1;
}
if (failed > 0) fail(`${failed} check(s) failed`);
console.log(`[smoke-deb-command] OK — ${version[1]} installed by the command the app copies`);

// Bounded source-bound repair validation. This does not replace full CI, native
// installer checks or the user's every-test release gate. No provider calls.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const files = [
  'electron/cua-linux-runtime.test.mjs',
  'electron/cua-linux.test.mjs',
  'scripts/ci-workflow.test.ts',
  'server/cloud-home.test.ts',
  'server/container-computer.test.ts',
  'server/devs-report-send.test.ts',
  'server/escalations.e2e.test.ts',
  'server/host/devs-reports.test.ts',
  'server/host/loop-guard.test.ts',
  'server/live-call.test.ts',
  'server/local-computer.test.ts',
  'server/long-running-chief.e2e.test.ts',
  'server/mcp-app-observer.test.ts',
  'server/mcp-sign-in-card.e2e.test.ts',
  'server/notification-routing.e2e.test.ts',
  'server/paired-thread-targets-api.test.ts',
  'server/person-first.e2e.test.ts',
  'server/post-to-room.test.ts',
  'server/registry-save.test.ts',
  'server/room-coordination.e2e.test.ts',
  'server/room-roots.e2e.test.ts',
  'server/routine-delegation.e2e.test.ts',
  'server/runtime-coordination.e2e.test.ts',
  'server/runtime-paths.e2e.test.ts',
  'server/setup-suggestions.test.ts',
  'server/shared-computers.test.ts',
  'server/steer-queue.test.ts',
  'server/steer-unattended.e2e.test.ts',
  'server/teammate-follow-ups.e2e.test.ts',
  'server/thread-aware-bots.e2e.test.ts',
  'server/vps-computer.test.ts',
  'server/vps-routing.test.ts',
  'shared/package-format.test.ts',
  'scripts/testing/analytics-docs.test.ts',
  'server/server-lines.test.ts',
  'scripts/linux-after-install.test.mjs',
];
for (const file of files) {
  if (!existsSync(file)) throw new Error(`Repair regression source is missing: ${file}`);
}
console.log(`Repair-only validation: ${files.length} complete test files. Full CI remains required.`);
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files], {
  stdio: "inherit",
  env: { ...process.env, OMB_AI_CHECKS: "0" },
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`Repair regressions interrupted by ${result.signal}`);
process.exitCode = result.status ?? 1;

# Latest handoff

## Native runtime installer repair

Candidate app version: `0.1.60`.
Release branch: `fix/native-runtime-release-20261110`.
Hermes-compatible source baseline: `d07150a5ca0b293dde9c7ba5e61b6a187c81d319`.
The newer multi-harness `main` tree is not replaced by this maintenance release.

### Changes

- Reject a packaged app unless both Hermes and OpenCode have matching target manifests, regular archives, exact sizes and SHA-256 digests. The target comes from electron-builder's architecture, not the build host.
- Preserve the maintenance implementation's fresh atomic activation, exact manifest binding and immutable Hermes dependency/probe environment.
- Run native installed NSIS, Intel DMG, Apple Silicon DMG and Ubuntu DEB checks from one source revision. Require first-launch readiness, relaunch persistence and damaged-runtime replacement while preserving synthetic user data and the old activation.
- Isolate product data, Electron appData, home and Hermes state. Save actual runtime status and screenshots rather than treating successful packaging as successful installation.
- Give the Windows ZIP a platform-qualified filename so it cannot collide with the Intel Mac ZIP. Stable Windows portable aliases and release inventory use the new name.
- Verify downloaded Actions package hashes and generated updater-feed hashes before creating a private all-platform draft. The draft records source, native evidence and package SHA-256 digests; it does not change public latest.

### Local evidence

- `pnpm exec vitest run scripts/after-pack.test.mjs scripts/prepare-cloudflared.test.mjs server/managed-runtime-retry.test.ts server/managed-runtime.test.ts server/drivers/acp/hermes.test.ts`: 96 passed.
- `node --test scripts/mac-installer-evidence.node-test.cjs`: 2 passed.
- `python3 scripts/hermes_payload_recipe_test.py`: 3 passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: exited zero with warnings in existing unrelated files; not a warning-free result.
- `pnpm build`: production UI/server TypeScript and Vite build passed, with the existing large-chunk warning.
- `pnpm test:packaged-server`: a server copied outside the repository booted without reachable node_modules, all 10 proxy paths resolved, and packaged MCP stdio reached the isolated API and flushed its final frames.
- Direct Node invocation of the new afterPack hook against the old installed Intel app rejected its ARM64-only runtime resources with the missing `hermes-darwin-x64.manifest.json` and the exact restaging target. This check read resources only and did not alter the installed app.

### Native delivery gate

This source revision requires its own `Verified native runtime installers` run; historical maintenance successes do not certify the new artifacts. Native statuses and screenshots are attached only after the corresponding real installed checks pass. The candidate job cannot run unless all four native target jobs succeed.

macOS artifacts are ad-hoc signed, not Developer ID signed or notarized. Windows artifacts are unsigned. Keep the candidate private; do not claim Gatekeeper/SmartScreen acceptance or promote it as a signed public release. Linux installed lifecycle covers DEB; AppImage and portable ZIPs are built but their independent lifecycles are not certified. Native runtime readiness does not certify an ordinary live-provider turn or the full voice/computer-use matrix.

The requested Intel Mac delivery must separately checksum and install the exact new DMG, preserve the current app and user data, launch an isolated real-runtime profile, exercise an ordinary turn without paid fallback, and capture the actual installed UI. No current-user chat mutation is a verification fixture.

# Latest handoff

## Hermes-only bot harness — 2026-11-12

Scope: DaniBot in `dani-desktop`, starting from observed base
`3a7797656f12a23c1702af59342751e5e65f0287`. No assistant commit,
push, release, installed-app replacement, or live-data migration was performed.
Concurrent browser-runtime changes in this working tree are not this slice.

### Implemented

- Production loads and exposes Hermes instances only. A missing or unavailable
  Hermes does not select another agent CLI. The registry execution guard also
  rejects native-agent bot turns and background text calls after provider reloads
  or custom decoration.
- Models remain independent: Hermes provider-qualified and local-endpoint model
  IDs are retained. Unscoped or missing IDs are refused rather than silently
  running Hermes' configured default.
- Startup migrates bot defaults, pinned conversations, and backup selections
  with one durable bots-file write before publishing the changes. Instructions,
  histories, model IDs, and follow-the-bot semantics remain intact. Unsupported
  provider-specific approval modes step down to Ask; engine-specific model
  controls are cleared when changing harnesses.
- Store mutation boundaries normalize subsequent creates, imports, reviewed
  team updates, bot/task patches, and model switches. Configuration defaults,
  recovery backups, and helper selection move to Hermes as well.
- The ordinary picker hides the single-Hermes engine rail and uses model-neutral
  labels. The connection surface shows Hermes rather than offering competing
  harness setup.
  The connection card invites model selection without claiming that CLI/catalog
  discovery alone proves a healthy model provider.
- `control-omb launch --hermes` provides a disposable ACP fixture with the
  production policy enabled. Other sealed fake-driver fixtures retain their
  injected transports for protocol conformance; the fixture flag is never
  enabled by a network request or by runtime availability.

### Exercised verification

- Eight focused runtime/store/picker/onboarding files: **370 passed**.
  `server/comms.test.ts`: **32 passed** after marking its synthetic fleet as
  sealed and removing obsolete branding/prompt-wording assertions. The replay
  test still checks completed work, prior context, and exactly one result.
- The new Hermes regression failed before the fix because an unscoped model
  was accepted; missing, empty, and unscoped models are now rejected.
- Actual serving-path smoke used `launchVerificationServer` and the canonical
  `runControlOmb` commands: the default bot used `hermes`; turns on
  `openai:fixture-a` and `openrouter:fixture-b` both settled; captured ACP
  `session/set_model` calls contained the requested model IDs; selecting
  `claude` was refused. The final run confirmed removal of its temporary data.
- The canonical `launch --hermes` command was also launched directly. Its
  starter and active task both reported `instanceId: "hermes"`.
- Real renderer verification used disposable previews: the model menu displayed
  both fixture models without a competing-agent selector, a UI click changed
  the selected model, and the onboarding connection card displayed Hermes.
  No browser-console errors were observed on those surfaces.
- Changed-source `oxlint --deny-warnings` passed.
- Verification services and tabs were stopped; throwaway smoke/preview source
  files were removed.

### Limits

`pnpm typecheck` and the standalone server typecheck both stopped on
`server/browser-calls.test.ts:80` (`Promise.withResolvers`, TS2550), outside
this harness change. A separate registry run had two npm-install fixture
failures (`env: node: No such file or directory`); those cases are not claimed
as passing.

The ACP engine and model responses above were synthetic. No live model
credential, paid request, packaged installer, Windows runtime, or real Hermes
distribution was qualified. Hermes must be installed and its model providers
configured before a real bot can run. This does not close the packaging,
bootstrap, provider-health, or release gates in spec 110.

## Local release/update and compact-sidebar work — 2026-11-10

Source branch: `main`; last observed base:
`c077c7940be477e50857b106f7e1cf4202babd81`. Source/local app version:
`0.1.140-local.3`. No assistant commit, push, tag, release publication, artifact
upload or remote workflow dispatch was performed.

### Implemented

- Stable `latest` updater policy for local candidates; prerelease tags ignored,
  downgrades disabled after setting the channel, no signature/checksum/TLS bypass.
- Missing public releases remain an actionable error, not a fake up-to-date
  result. A first public stable release is still required.
- Normal main/prod pushes build without public promotion. Tag/manual candidates
  pin a SHA, survive later main pushes, require the adopted complete CI, and
  serialize candidate/draft work by version. Existing tags/drafts cannot retarget
  another SHA, and published release assets are not overwritten.
- Stable version preparation graduates local candidates. Windows portable ZIPs
  use a distinct `-win-x64.zip` namespace. Artifact validation runs before
  flattening and checks feed references, versions, sizes, hashes, ZIP platforms
  and payload integrity. Mac feed regeneration is structured YAML and atomic.
- Optional Developer ID/notarization support is candidate-only; signing setup
  and public-promotion prerequisites are in
  [CONTRIBUTING](../../CONTRIBUTING.md#desktop-releases-and-automatic-updates).
- Operational repository/download URLs target `Dan-Labs-Agi/dani-desktop`.
  Generated native helper `.app` bundles are ignored; author/NOTICE attribution
  is retained.
- Compact sidebar rows show one avatar with no provider-logo/extra-Chief
  overlays. Tooltips, accessible labels and activity remain. The installed
  native app was expanded/collapsed through its real resize handle; both compact
  rows reported one avatar, zero provider badges and zero Chief overlays.

### Exercised verification

- Release/updater/feed regressions: 112 passed.
- Updater coordinator/error/native-staging/quiet-install contracts: 75 passed.
- Sidebar regressions: 144 passed.
- `pnpm lint`, `pnpm typecheck`, full UI/server/companion/updater builds,
  packaged-server smoke, and Intel Mac DMG + ZIP build passed.
- Official `actionlint` v1.7.7 passed the changed release/preparation/Windows
  workflows.
- A standalone real vendored checker/HTTP/digest smoke discovered stable
  `0.1.140` and `0.1.141` from `0.1.140-local.2`, accepted matching bytes, and
  rejected corruption without a downloaded event. This was loopback API proof,
  not a native installer upgrade.
- Standalone artifact/feed CLIs accepted synthetic contract artifacts and
  rejected duplicate basenames, missing Intel ZIPs, hash mismatches and corrupted
  Windows ZIP contents. Postprocessing byte changes were rehashed successfully.
  Blockmap regeneration ran successfully on a non-executable fixture.
- `/Applications/Dani Bot.app` reports `0.1.140-local.3`; the native compact UI
  was verified using the isolated desktop profile. Original user chats/settings
  were not the verification workspace.

### Release blockers and owner steps

No Developer ID Application identity was available locally; the successful
repository Actions-secret-name query returned no configured repository secrets.
The local Mac app is ad-hoc signed, not notarized. Windows remains unsigned.
Hosted native release/signing/notarization/installed-upgrade execution was not
performed, and must not be claimed as passed.

Configure signing, prepare/merge stable `0.1.140`, push its tag at the intended
commit, inspect the resulting complete draft, complete native trust/upgrade
checks, then publish stable/latest. Existing ad-hoc Mac installs need a trusted
signed installer bootstrap before relying on future automatic upgrades. Source
pushes, drafts and Actions artifacts do not resolve the reported missing-public-
release prerequisite.

## Earlier SDD-only handoff — historical context

Branch: `sdd-kit-integration`, replayed after the three infrastructure CI fixes on prod. This slice integrates owner-supplied SDD documentation and local skills only; it changes no production code.

Added: preserved kit under `docs/dani-sdd-kit/` with trust/provenance notice; namespaced project skills under `.claude/skills/dani-*`; repository audit, feature parity, dependency notes, baseline, unknowns, constitution, ADR-001, runtime/Hermes specs and traceability.

## Staged application work

1. RED tests and schema migration for canonical `UNKNOWN`, immutable attempts, full effect digest, precondition hashes, intent-before-dispatch and reconcile-before-retry.
2. Fenced transitions, cancellation checks at admission/lease/dispatch, and one durable physical-desktop lease.
3. Fresh source-linked success verifier, canonical duplicate result, untrusted page/tool/file provenance, broker-only writes and filesystem verification.
4. Workspace and memory isolation, retention/delete, correction/retraction, staleness and procedural-vs-personal memory contracts.
5. Trigger registry/evaluator/scheduler/wake, freshness/dedupe-window authorization, typed initiative levels, novelty/budgets and real quiet-hour/DST/deferred-coalescing enforcement.
6. Wire the control plane into the live serving path; pin and license Hermes; run real ACP handshake/stream/model/permission/cancel/resume tests; measure warm versus per-turn processes; add deterministic no-model stop/status/cancel and durable delegation/crash/orphan handling.
7. Add provider capability/quota/error contracts and broker-bypass negatives. Keep Computer MCP unavailable until controlled-device proof; keep `dani-free` absent from claims; block unattended high-impact Hermes native terminal/filesystem/network effects until broker enforcement is proven.
8. Offline/recovery and controlled Windows WD/EF/PI/DL/EV/FG gauntlets. Keep the Windows slice `IMPLEMENTED_UNVERIFIED` until a real Windows device produces source-linked proof.

Do not claim runtime/effects, memory/proactivity, CUA, provider, Laya or voice compliance until the mapped acceptance gates pass. The next application branch should begin with stages 1-2, preserve the existing skeleton, and avoid infrastructure-owned workflows/build/release paths.

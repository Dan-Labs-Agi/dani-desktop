# Latest handoff

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

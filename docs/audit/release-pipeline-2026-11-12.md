# Desktop release pipeline audit — 2026-11-12

Read-only authenticated GitHub API/CLI inspection; no dispatch, push, tag,
release, credential or repository-setting mutations were performed. Local
fixture checks are separate from live-model and installed-app validation.

## Exact upstream evidence

| Evidence | Observed result |
| --- | --- |
| [Main CI 43156737982](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/43156737982), commit `a1684abc5c6b5ea7423c24d7e68e064f72acf779` | Failure: all 20 native Vitest shard jobs failed. Package/Linux smoke, control-plane and optional native jobs succeeded. Logs contain substantive assertion failures, not only missing runners: e.g. Windows shard 3/8 has 17 failed files/43 failed tests, branding/catalog mismatches, cloud UID/GID mismatch, image-format fixtures, routine-recovery state and desktop fixture timeout. This is upstream main's shard graph, not this checkout's adopted portable matrix. Do not suppress failures to make release CI green. |
| [Main Release 43156737811](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/43156737811), same commit | Success for pin/Linux/Windows/macOS packaging. Candidate-CI and draft jobs **skipped**. This did not publish an update and does not contradict failing CI. |
| [Tag Release 41469439709](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/41469439709), `v0.1.58`, commit `02296525bb0c24a18ff49c309e730771280b989c` | All native builds succeeded; draft assembly failed with `v0.1.58 is already published; refusing to overwrite it`. This is an intentional immutable-version guard, not permission to overwrite release bytes. |
| [Prepare release 41615004057](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/41615004057), job `125846145821` | `pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)`. Requires an authorized repository/organization Actions setting; not a code fix or a reason to add a personal token silently. |
| [Newer branch commit bddf739](https://github.com/Dan-Labs-Agi/dani-desktop/commit/bddf7390eae440d192f5903c2cd874c76aeb87ee) | Only two test changes: engine reload expectation includes `dani-client`; `dani-free-client` teardown uses retrying `removeTempDir`. No release/workflow/updater fix to recreate. Inspected without pulling/resetting. |

## Public feed blocker

The [anonymous latest-release API](https://api.github.com/repos/Dan-Labs-Agi/dani-desktop/releases/latest)
returned `browser-engine-v0.36.0-omb.2`, published 2026-11-11, containing only
`agent-browser-win32-x64-0.36.0-omb.2.exe`. It has no desktop installers or update
feeds. The actual installed Mac app's `resources/app-update.yml` was read and
contains `provider: github`, `owner: Dan-Labs-Agi`, `repo: dani-desktop`, matching
`electron-builder.yml`. The vendored electron-updater GitHub provider calls the
latest-release endpoint with prereleases disabled. Therefore this auxiliary
release breaks normal desktop feed lookup and `/releases/latest/download`
links; a local workflow edit cannot repair already-published remote state.

An authorized maintainer must restore a complete verified desktop release as
latest and ensure auxiliary releases use `make_latest: "false"` or prerelease
status. Do not merely mark an unverified candidate latest. GitHub documents
[`make_latest`](https://docs.github.com/en/rest/releases/releases#create-a-release):
newly published releases default to latest; drafts/prereleases cannot be latest.
No remote repair or publication was performed in this audit.

Read-only installed metadata also identifies version `0.1.140-local.3`.
`codesign -dv --verbose=4` reports thin `x86_64`, `Signature=adhoc`, and
`TeamIdentifier=not set`. This does not verify code integrity or notarization;
it positively identifies the missing Developer ID trust prerequisite.

The older desktop `v0.1.58` public feeds were read directly:
[Mac](https://github.com/Dan-Labs-Agi/dani-desktop/releases/download/v0.1.58/latest-mac.yml),
[Windows](https://github.com/Dan-Labs-Agi/dani-desktop/releases/download/v0.1.58/latest.yml),
[Linux](https://github.com/Dan-Labs-Agi/dani-desktop/releases/download/v0.1.58/latest-linux.yml).
They report version `0.1.58`; Mac lists both ZIPs and DMGs, Windows the NSIS EXE,
Linux AppImage and DEB. Release inventory/digests show the Intel Mac ZIP and
Intel portable alias match, while Windows portable has distinct bytes. Those
large installer bytes were not downloaded, executed or independently hashed;
feed presence and API digests are not installed-upgrade proof. Version 0.1.58
also cannot update an installed newer 0.1.139/0.1.140 build without an explicit,
unsafe downgrade; the production policy correctly refuses downgrades.

## Local corrections and release expectations

The collected asset verifier must run on ordinary `main`/`prod` packaging
pushes, not only inside the tag/manual draft assembler. Stable download aliases
must match their verified versioned bytes; required NSIS/Mac blockmaps must be
present. The standalone Ubuntu workflow must probe the canonical public
repository and upload `latest-linux.yml`, not claim the old fork validates the
packaged updater. Regression fixtures cover these contracts.

The release guide and packaging playbook were stale: they claimed automatic
drafts on merge, nonexistent publish/emergency inputs, always-signed Mac builds,
old secret names, old fork URLs and upstream shard/nightly behavior. They now
state the actual draft-only trigger and trust boundaries. Full current behavior
and local verification commands: [releasing](../releasing.md).

Primary requirements: [electron-builder auto-update](https://www.electron.build/features/auto-update/)
requires signed macOS apps and the ZIP target, and describes generated
`app-update.yml`, NSIS, AppImage and platform update manifests. Consult the
installed vendored updater version for version-specific behavior; newer
upstream documentation alone does not upgrade this app. GitHub's
[workflow-trigger token rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
explain why GITHUB_TOKEN pushes do not trigger ordinary push workflows and why
an explicit CI dispatch is required for automated release branches.

## Remaining external/native acceptance

- Repository Actions permission must allow release PR creation. The current
  permissions endpoint returned HTTP 403 for this credential, so the historical
  run failure is confirmed but the current setting is not inspectable here.
- GitHub latest must identify a complete verified desktop release, not a
  browser-only auxiliary release.
- Developer ID and notarization credentials must be supplied by their owner.
  Reading repository variable `DANI_MAC_SIGNING` returned HTTP 404, which does
  not distinguish absent configuration from unavailable access. No secret values
  were requested. Unsigned/ad-hoc Mac builds are not a verified Squirrel.Mac
  bootstrap. Windows remains unsigned.
- Exact release installers require native install and version-to-version upgrade
  qualification, both Mac CPU architectures, signing identity continuity and
  settings/user-data preservation. Native Windows NSIS smoke and loopback
  checksum fixtures do not establish all of this.
- No source change here has been pushed or deployed; future workflow behavior
  starts only after authorized integration. Tests/checks are run and reported by
  the integrating agent, not inferred from these changes.

## Read-only refresh — 2026-11-13

Primary GitHub GET metadata and the existing failed-run logs were inspected
again; no workflow was dispatched or rerun. The newest CI/release runs remain
`43156737982` (failed CI) and `43156737811` (successful branch packaging) at
`a1684abc5c6b5ea7423c24d7e68e064f72acf779`. All 20 failed CI jobs identify
`Run tests` as the failed step. Windows shard 3/8's existing log still records
43 failed tests, including substantive UID/GID and image-format assertions.
These are not runner-acquisition failures.

### Available artifacts, permissions and signing configuration

| Read-only source | Current observation | What it does not prove |
| --- | --- | --- |
| Anonymous `/releases/latest` | Still `browser-engine-v0.36.0-omb.2`, only `agent-browser-win32-x64-0.36.0-omb.2.exe` | No desktop update is available from latest. |
| `/releases/tags/v0.1.58` | 23 assets: both Mac architectures' DMG/ZIP/blockmaps, Windows NSIS/blockmap and portable alias, Linux AppImage/DEB, stable aliases and all three feeds | Presence does not prove signatures, byte integrity or an upgrade; version remains older than the installed local build. |
| `/actions/runs/43156737811/artifacts` | `linux-release` (1,166,414,662 bytes), `macos-release` (2,530,258,929 bytes), `windows-release` (1,243,186,904 bytes); all report `expired:false`, expiry 2026-11-19 | These archive sizes are API metadata, not downloaded/verified installer bytes, green CI or public updates. |
| Authenticated release inventory | Numerous `0.1.139-validation.*` and preview releases remain drafts/prereleases; some have assets, some have none | They are not eligible for the stable installed updater, and no draft was promoted or repaired. |
| Repository metadata | Public, default branch `main`; credential reports `pull/push/triage:true`, `admin/maintain:false` | Push permission is not authorization to publish or change settings. |
| `/actions/permissions/workflow` | HTTP 403 | Current PR-creation policy remains unobservable with this credential. Historical failure occurred with `PullRequests: write` already granted, so adding that YAML permission is not a fix. |
| `/actions/secrets` and `/actions/organization-secrets` | Both requests succeed with `total_count:0`, empty name lists | No repository or accessible organization signing secrets are supplied through these scopes. No secret values were requested; no claim about private local keychains or unrelated environment scopes. |
| `/actions/variables/DANI_MAC_SIGNING` | HTTP 404 | Signing opt-in is not available to this inspection. Current release jobs declare no protected environment, so unrelated environment secrets cannot supply this workflow. |

The historical Prepare release log also shows that `release/v0.1.140` was
pushed before PR creation failed. An authorized maintainer must inspect that
existing branch before choosing a version or rerunning preparation; do not
force-push, delete it, or bypass the existing-branch guard. The run predates the
repository transfer and logs `somdipto/dani-desktop`; it is historical policy
evidence, not proof of today's organization setting.
The current branch-ref GET succeeds and identifies
`8bf0824e38142eebef9564d926955ed17fff51e4`, not the historical run's original
version-bump SHA. Its contents and suitability require review, not assumptions
from the old run.

### Source correction in this refresh

`scripts/release-ci.mjs` previously returned any green own/tree/parent proof
before inspecting the pinned candidate's failed tests. This could approve a
candidate with an actual failed run, including a dispatched release lane whose
parent CI became available later. Four consumer cases in
`scripts/release-ci.test.ts` reproduced the bypass; the integrating agent
reported all four failing for the intended `ok:true` result before production
was changed (`.omb-scratch/release-current-candidate-red.json`).

The gate now checks the candidate's completed real failures before accepting
reusable green evidence. It retains successful later-attempt handling,
never-started-runner retry policy and release-lane cleanup. No workflow trigger,
signing configuration, updater downgrade policy or publication permission was
changed. The integrating agent must run the full release-CI file and adjacent
release gates after integration; this correction is not native upgrade proof.

### Required integration and publication evidence

1. Run the focused commands in [releasing](../releasing.md), then the full
   adopted platform CI. The previously reported 81 source-gate tests are a
   historical focused result, not a green full repository or current candidate.
2. Integrate only with authorization and retain exact candidate SHA/version.
   Branch packaging must pass collected-artifact integrity; a tag/manual draft
   additionally requires complete candidate CI. No failure may become advisory.
3. An authorized owner must resolve Actions PR policy and supply Developer ID
   signing/notarization credentials through approved secret management. Do not
   silently introduce a PAT, change signing identity or publish unsigned Mac
   builds as an automatic-update bootstrap.
4. Qualify exact installers on Windows x64, Linux x64, Mac arm64 and Mac x64.
   Exercise an actual older-to-newer installed upgrade with disposable profiles,
   identity continuity and settings/provider/user-data preservation. Preserve
   downgrade rejection; `v0.1.58` is not a repair for `0.1.140-local.3`.
5. Only after these gates and explicit publication authorization may a complete
   newer desktop release become latest. Re-download public feeds and referenced
   bytes and verify them; ensure auxiliary releases cannot replace latest.

No full repository test, native install, signing check, artifact download,
publication or installed-app upgrade was performed by this refresh.

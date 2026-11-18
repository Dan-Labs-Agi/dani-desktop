# Releasing

The canonical desktop repository and public updater source is
[Dan-Labs-Agi/dani-desktop](https://github.com/Dan-Labs-Agi/dani-desktop/releases).
A successful build, a draft, a published release and a successful installed-app
upgrade are different results. Do not report one as another.

## Pushes versus releases

- Pull requests and pushes to `main`/`prod` run the portable native-platform CI.
- Pushes to `main`/`prod` also build Windows x64, Linux x64 and both macOS
  architectures and run full combined artifact-integrity verification. This
  branch-only build mode accepts stable `X.Y.Z` or local `X.Y.Z-local.N` versions
  without changing artifact/feed versions or relaxing any integrity checks.
  It does **not** create tags, drafts or public updates.
- Other feature-branch pushes do not publish desktop releases. Open a PR for CI.
- **Actions → Prepare next release** chooses a stable `X.Y.Z` version, pushes a
  version-only branch and opens a PR. It explicitly dispatches CI. The repository
  must allow GitHub Actions to create pull requests; otherwise this step fails.
- After merging that PR, an authorized maintainer must tag `v<version>` at the
  exact merge commit or manually run **Release** against that commit. A merge
  alone does not assemble a draft. The workflow has no `publish` checkbox and no
  `ship_without_ci` bypass.
- Tag/manual release runs require a stable `X.Y.Z` version, the pinned
  candidate's complete CI, complete collected artifacts and immutable tag/draft
  identity before creating or refreshing a **draft**. Local builds are not
  publication-eligible. Published versions are never overwritten.
- Publication remains an explicit maintainer action after the native trust and
  install/upgrade checks below. Installed apps see only public releases, not
  Actions artifacts or drafts. Shipping source changes does not update an
  already-installed app.

See [current CI contract](current-ci-contract.md), not the imported upstream
shard/nightly description, for the checks actually wired into this checkout.
The release CI gate accepts the candidate's green CI, an identical source tree,
or the verified version-only parent. It may dispatch CI on a temporary
`release-ci/v<version>` branch. A real test failure on the pinned candidate stops
release preparation before any older green, identical-tree or parent proof can
be accepted. A successful later attempt of that failed run clears the failure;
only a runner that never started may receive the bounded infrastructure retry.

## Update-feed and asset contract

`electron-builder.yml` bakes `owner: Dan-Labs-Agi`, `repo: dani-desktop`,
`provider: github` into each app's `resources/app-update.yml`. The installed
updater reads that file; it does not use the source checkout's git remote.
Older builds pointing elsewhere need an explicitly verified migration, not a
silent redirect or a token placed on users' machines.

The production updater pins `latest`, rejects prereleases and disallows
downgrades. A version must be newer than the installed version; reusing an
already-published version cannot deliver new code.

Each stable release must contain, from the same version and commit:

| Platform | Versioned update/download files | Feed | Stable download aliases |
| --- | --- | --- | --- |
| Windows x64 | `DaniBot-<version>-setup.exe`, its `.blockmap`, `DaniBot-<version>-win-x64.zip` | `latest.yml` | `DaniBot-setup.exe`, `DaniBot-Windows-Portable.zip` |
| macOS arm64 + x64 | `DaniBot-<version>-<arch>.dmg`, `.zip`, and their `.blockmap` files | `latest-mac.yml` | `DaniBot-Silicon.dmg`, `DaniBot-Intel.dmg`, `DaniBot-Silicon-Portable.zip`, `DaniBot-Intel-Portable.zip` |
| Linux x64 | `DaniBot-<version>-x86_64.AppImage`, `DaniBot-<version>-amd64.deb` | `latest-linux.yml` | `DaniBot.AppImage`, `danibot-amd64.deb` |

The verifier rejects incorrect feed versions, platform references, sizes and
SHA-512 digests, duplicate basenames, missing required files and ZIP platform or
integrity failures. Stable aliases must be byte-identical to their versioned
source. AppImage differential metadata is embedded in the AppImage; it has no
separate `.blockmap` upload. Blockmap presence is not proof of its contents or
of a successful differential upgrade.

Build integrity and publication eligibility are separate checks. The verifier
defaults to stable-only publication validation. Its explicit `--build-version`
mode permits the existing `X.Y.Z-local.N` build convention while still checking
all required feeds, exact versions, hashes, sizes, blockmaps, ZIP integrity and
byte-identical stable download aliases. The workflow selects that mode only for
`main`/`prod` branch pushes; tag/manual draft assembly retains stable-only
validation. Alias filenames describe download names, not permission to publish
a local build. No updater prerelease or downgrade policy changes.

**Reserve GitHub's latest release for a complete desktop release.** The shipped
GitHub provider and README download links depend on `/releases/latest`.
Browser-engine or other auxiliary releases must use `make_latest: "false"`
(or be prereleases), never replace desktop latest. Before and after publication,
inspect the anonymous latest endpoint and verify all three feeds and every
referenced asset. Do not hide a missing feed as “up to date.”

## Signing and installed-upgrade gates

Unsigned builds are review artifacts, not a proven automatic-update bootstrap.
The default macOS configuration does not notarize. To opt into the existing
Developer ID workflow, set repository variable `DANI_MAC_SIGNING=true` and
provide these secrets through the repository's approved secret management:

- `MAC_CSC_LINK`: electron-builder-compatible Developer ID certificate bundle;
- `MAC_CSC_KEY_PASSWORD`: certificate password;
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: notarization identity.

The workflow checks required credentials, forces signing, verifies extracted ZIP
apps' Developer ID authority, team, CPU architecture, stapled ticket and
Gatekeeper assessment, notarizes/staples DMGs, then regenerates affected
blockmaps and the Mac feed. Missing credentials fail; there is no fabricated
signature. Existing ad-hoc installations may require a one-time signed installer
bootstrap. Keep the signing identity consistent across future upgrades.

Windows is currently unsigned and may display SmartScreen warnings. Do not add
a `publisherName` without actually signing with the corresponding certificate.
Windows release packaging runs isolated NSIS install/onboarding/relaunch checks.
The exact macOS and Linux release artifacts still need clean-machine install
and version-to-version upgrade checks, including both Mac architectures,
settings/provider preservation, rollback and user-data preservation. A native
package build or loopback updater fixture does not prove these workflows.

Before publishing, require complete assets and checksums, native architecture
and version evidence, signing trust where required, and an installed upgrade
using the exact downloaded release bytes. Download published feeds and assets
back and compare hashes; upload success alone is not this verification. No
workflow here authorizes bypassing those gates or publishing every branch push.

## Local verification commands

Run only against isolated fixture data or a fresh native test machine:

```sh
pnpm exec vitest run scripts/release-artifacts.test.ts scripts/release-version.test.ts scripts/release-ci.test.ts scripts/release-candidate.test.ts scripts/ci-workflow.test.ts scripts/regenerate-mac-feed.test.ts electron/updater-stable.test.mjs
node scripts/release-artifacts.mjs release-assets X.Y.Z
# Non-publication integrity check only; never use this mode to approve a release:
node scripts/release-artifacts.mjs release-assets X.Y.Z-local.N --build-version
```

`release-assets` must preserve separate platform subdirectories, as downloaded
from the native build artifacts. On each matching native host, package using
`pnpm package:mac`, `pnpm package:win` or `pnpm package:linux`, then exercise the
installed app and upgrade with disposable profiles. Do not run mutation checks
against a person's existing app/profile or assume cross-building verifies an OS.

For read-only upstream inspection:

```sh
gh run list --repo Dan-Labs-Agi/dani-desktop --workflow ci.yml --limit 5
gh run list --repo Dan-Labs-Agi/dani-desktop --workflow release.yml --limit 5
gh api repos/Dan-Labs-Agi/dani-desktop/releases/latest --jq '{tag_name,draft,prerelease,assets:[.assets[].name]}'
```

Before an authorized preparation attempt, inspect any existing version branch,
especially after PR creation failed: preparation pushes the branch before
opening its PR, and reruns intentionally refuse an existing branch. Recover
that branch through normal maintainer review; do not delete or force-update it.
Repository `pull-requests: write` alone does not override Actions PR policy.
The owner must also authorize and configure that policy; credential access to
push is not permission to change repository settings or publish.

Current external blockers and exact upstream run evidence are recorded in
[the release audit](audit/release-pipeline-2026-11-12.md). No local test or
workflow edit changes remote settings, release visibility or installed apps.

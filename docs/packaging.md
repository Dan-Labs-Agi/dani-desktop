# Packaging Dani Desktop

Agents: this is the only packaging playbook. Do not invent extra steps.

Repo: `https://github.com/Dan-Labs-Agi/dani-desktop.git`  
App window name: **Dani Bot**. Package name: **dani-desktop**.  
Node **24+**, **pnpm** (`packageManager` in `package.json`).

This machine cannot cross-build. Each OS builds only its own installer.

## Run locally as a desktop app (any agent)

Do **not** demo a live hosted instance. On the person's OS:

```sh
corepack enable
pnpm install
pnpm dev:server    # 127.0.0.1:8799
pnpm dev           # 127.0.0.1:5199 — keep running
pnpm dev:desktop   # Electron window — show this
```

All three stay running. The product is the Electron window, not the browser
tab. Computer-use = This computer (CUA). Browser eval = [`docs/browser-webcmd.md`](browser-webcmd.md).

For an installer to leave behind, use the table below on **that same OS**.

## Prefer GitHub Actions (after the first version)

`main`/`prod` pushes build and validate packages but never publish updates.

1. Put Mac signing secrets on the repo (see `docs/releasing.md`) if you want signed macOS.
2. **Actions → Prepare next release** (patch) → merge the PR into main.
   Or bump `package.json` `version` on main directly.
3. Tag `v<version>` at that main commit (or run **Release** against it) —
   **Release** builds Mac + Windows + Ubuntu and opens a draft on this repo.
4. Publish the draft. Installed apps update from `latest.yml` / `latest-mac.yml` / `latest-linux.yml`.

Windows and Linux CI need no signing secrets. Mac builds are unsigned by default; trusted Mac release builds require `DANI_MAC_SIGNING=true` and the `MAC_CSC_*`/Apple credentials described in `docs/releasing.md`.

## First build on a friend's computer

Clone the **same commit** on each machine. Do not mix SHAs under one version.

```sh
git clone https://github.com/Dan-Labs-Agi/dani-desktop.git
cd dani-desktop
corepack enable
pnpm install --frozen-lockfile
```

| Host | Command | Give back from `release/` |
|---|---|---|
| **macOS** + Xcode | `pnpm package:mac` | versioned `.dmg` + `.zip` + `.blockmap` + `latest-mac.yml` for both architectures. Aliases: `DaniBot-Silicon.dmg`, `DaniBot-Intel.dmg`, `DaniBot-Silicon-Portable.zip`, `DaniBot-Intel-Portable.zip`. |
| **Windows x64** | `pnpm package:win` | `DaniBot-<ver>-setup.exe` + `.blockmap` + `DaniBot-<ver>-win-x64.zip` + `latest.yml`. Aliases: `DaniBot-setup.exe`, `DaniBot-Windows-Portable.zip`. |
| **Ubuntu 24.04 x86_64** | `pnpm package:linux` | versioned `.deb` + `.AppImage` + `latest-linux.yml`. Aliases: `danibot-amd64.deb`, `DaniBot.AppImage`. The standalone Ubuntu workflow also generates `SHA256SUMS-ubuntu-x64.txt`. |

Check before sending:

- `release/*/resources/ui/index.html` (or Mac `Dani Bot.app/Contents/Resources/ui/index.html`) contains `<title>Dani Bot</title>`
- `app-update.yml` has `owner: Dan-Labs-Agi` and `repo: dani-desktop`
- `package.json` version matches the filenames

Upload **all** files to **one draft** GitHub release tag `v<version>` on `Dan-Labs-Agi/dani-desktop`. Validate with `node scripts/release-artifacts.mjs release-assets <version>` and complete native trust/install/upgrade checks before publication. Missing feeds strand installed users. Auxiliary releases must not become GitHub's latest release.

For non-publication `main`/`prod` builds, the combined verifier accepts the existing
`X.Y.Z-local.N` convention only with explicit `--build-version`. It still checks
the exact artifact/feed version, every required file and blockmap, feed hashes
and sizes, ZIP integrity and byte-identical stable download aliases. Omit that
flag for release eligibility: tag/manual draft assembly requires stable `X.Y.Z`.
Passing build integrity does not authorize publishing a local version.

Friend interviews after they install: copy [`docs/interview-notes.md`](interview-notes.md) per person. Browser eval: [`docs/browser-webcmd.md`](browser-webcmd.md).

## Agent success criteria

- [ ] Built only on the matching OS
- [ ] Same git SHA as the other platforms for this version
- [ ] Updater yml files included
- [ ] No extra dependencies added
- [ ] Showed the Electron desktop window on the host OS
- [ ] Did not use a live hosted instance
- [ ] Did not claim it works without running the package command

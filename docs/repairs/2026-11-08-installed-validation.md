# Installed-package validation, 8 November 2026

The main-compatible installer gate was tested at commit
`9dbbf5373039ae2e5b4c50318a73c04c37b4c6a5`.

- Native Windows test: https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42474982388
- Actual NSIS install, updater repository, completed onboarding, app relaunch,
  welcome-state persistence and synthetic profile preservation passed.
- The clean machine correctly shows model-provider setup. No model inference or
  end-to-end agent task was claimed.

The older v0.1.58 managed-runtime repair stays on its maintenance lineage at
`90f8807c2c1946ca16bf7d3751647a32c6c4827b`. It is not copied over the newer main
architecture.

- Native maintenance test: https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42473679558
- Linux x64, Windows x64, macOS Intel and macOS arm64 passed actual installation
  (or DMG app copy), installed-app launch, Hermes/OpenCode readiness, relaunch,
  damaged-activation recovery and synthetic data preservation.
- Screenshots show the rendered welcome screen without the runtime-verification
  error. They do not prove completion of onboarding or a model-backed task.

## Separate local Ubuntu guest

A fresh Ubuntu24.04.5 x64 guest installed and configured the locally built
0.1.59 DEB and opened the package-owned Electron app. Actual X11/page screenshots
showed the Preparing Dani / Verifying screen. The final runtime status was
`installing`, phase `verify-bundled`, `taskReady:false`, and no reported error.
Local runtime activation is INCONCLUSIVE, not passed.

The software-emulated guest had1GB RAM and no hardware acceleration. The first
installer attempt exceeded the test harness's240-second watchdog and left an
unconfigured package. A guest-only dpkg recovery configured it, and a local-only
20-minute harness watchdog was used for the retry. A separate resource diagnostic
was stopped after slow staging; it did not pass. A UI-capture retry used180seconds
instead of Playwright's default30seconds. These changes did not change app,
installer, verification or sandbox rules. No model inference was tested.

The local DEB used gzip compression rather than the production defaultxz. Its
SHA256 is `25ff8147834e3a1ecedc661c817782196aba9a9419446d88416b9e28e47d52e9`.
Linux package-content and metadata validation passed. This local result does not
replace or extend the completed native four-platform activation tests above.

After evidence collection, the new test guest was shut down and its process,
disks, test-assets ISO and test SSH key were removed. No pre-existing VM or user
resource was deleted.

These validation runs made no public release, release draft, tag, artifact upload
or cache write. Standard public-repository native runners were used.

The public release/download remains v0.1.58. No repaired installer was published
or distributed by this change. The maintenance repair and this newer-main release
gate remain separate; pushing the gate does not repair an already installed
v0.1.58 application. Delivering a replacement installer is still outstanding.

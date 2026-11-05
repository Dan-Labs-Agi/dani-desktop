# CI and release gates

Ordinary commits validate code. They never publish installers.

## Continuous integration

Every pull request and push to `main` or `prod` runs the portable typecheck and test matrix. Linux CI also runs the full production build and package smoke checks. The production build command compiles the renderer, server and companion code rather than invoking Vite alone.

## Releases

The release workflow builds packages on branch pushes too. Its draft-release job runs only on an explicit manual dispatch or a version-tag push, and only after all platform package jobs succeed. A version tag must match `v<package.json version>`. The job creates a draft, not a published installer. See [the current CI contract](current-ci-contract.md). The required package set is:

- macOS Apple silicon
- macOS Intel
- Windows x64
- Linux x64 (`.deb` and AppImage)
- updater metadata and checksums

Missing artifacts fail the release. The assembler will not replace an already-published version. Signing and notarization still depend on the repository's release secrets; Windows remains unsigned until a signing identity is configured.

The bundled speech model data is checksum-pinned and staged during packaging. This does not claim local duplex voice support: reviewed native Whisper and Kokoro/ONNX inference runtimes are still required for every desktop target.

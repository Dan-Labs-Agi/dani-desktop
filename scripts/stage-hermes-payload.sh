#!/bin/sh
# Stage a built Hermes runtime payload into dist-native/managed-runtimes for
# packaging. The Hermes builder uses its own target naming (mac-arm64, mac-x64,
# win-x64); the app's managed-runtime schema uses darwin-arm64, darwin-x64 and
# win32-x64, and rejects any other manifest target. This script takes the APP
# target, locates the builder output, rewrites the manifest target identity to
# the app name, and re-verifies every hash against the shipped bytes.
#
# Usage: scripts/stage-hermes-payload.sh BUILD_OUT TARGET [REPO_ROOT]
#   TARGET: linux-x64 | darwin-arm64 | darwin-x64 | win32-x64 (app naming)
set -eu
SOURCE="$(cd "${1:?usage: stage-hermes-payload.sh BUILD_OUT TARGET [REPO_ROOT]}" && pwd)"
TARGET="${2:?missing target (linux-x64|darwin-arm64|darwin-x64|win32-x64)}"
ROOT="$(cd "${3:-$(dirname "$0")/..}" && pwd)"
case "$TARGET" in
  linux-x64)    BUILD_TARGET=linux-x64 ;;
  darwin-arm64) BUILD_TARGET=mac-arm64 ;;
  darwin-x64)   BUILD_TARGET=mac-x64 ;;
  win32-x64)    BUILD_TARGET=win-x64 ;;
  *) echo "unknown target: $TARGET" >&2; exit 2 ;;
esac
ARCHIVE="$SOURCE/hermes-payload-$BUILD_TARGET-v2026.9.21.tar.gz"
MANIFEST="$SOURCE/hermes-payload-$BUILD_TARGET-v2026.9.21.manifest.json"
[ -f "$ARCHIVE" ] && [ -f "$MANIFEST" ]
# A matching archive hash does not prove it contains the corrected dependency/launcher recipe.
python3 "$(dirname "$0")/hermes_payload_recipe.py" --matches "$MANIFEST"
STAGED_MANIFEST="$SOURCE/hermes-payload-$TARGET-v2026.9.21.staged.manifest.json"
python3 - "$ARCHIVE" "$MANIFEST" "$STAGED_MANIFEST" "$TARGET" "$BUILD_TARGET" <<'PY'
import hashlib, json, os, sys
archive, manifest, staged, target, build_target = sys.argv[1:]
m = json.load(open(manifest))
h = hashlib.sha256(open(archive, 'rb').read()).hexdigest()
assert h == m['archiveSha256'], f"archive hash mismatch: {h} != {m['archiveSha256']}"
assert os.path.getsize(archive) == m['archiveSize'], 'archive size mismatch'
assert m['name'] == 'hermes-runtime-payload' and m['target'] == build_target, \
    f"builder manifest identity mismatch: {m['name']} {m['target']} != {build_target}"
assert m['probe']['expectedAgentName'] == 'hermes-agent' and m['probe']['expectedVersion'] == '0.21.4'
# Re-issue the manifest under the app target identity. Only the target field
# changes: every hash and size still describes the identical archive bytes.
m['target'] = target
probe0 = m['probe']['argv'][0]
if target.startswith('win32-'):
    assert probe0.endswith('.cmd'), 'win32 probe must be a .cmd'
    assert m['executableRelPath'].endswith('.cmd'), 'win32 executable must be a .cmd'
else:
    assert not probe0.endswith('.cmd'), 'non-win32 probe must not be a .cmd'
if target == 'darwin-x64':
    assert len(m['degradations']) >= 1, 'darwin-x64 must declare its degradations'
json.dump(m, open(staged, 'w'), indent=2)
# Re-verify the re-issued manifest against the archive once more.
m2 = json.load(open(staged))
assert m2['archiveSha256'] == h and m2['archiveSize'] == os.path.getsize(archive)
assert m2['target'] == target
PY
A="$ROOT/dist-native/managed-runtimes/archives"; M="$ROOT/dist-native/managed-runtimes/manifests"
mkdir -p "$A" "$M"
cp "$ARCHIVE" "$A/hermes-runtime-payload-$TARGET.tar.gz"
cp "$STAGED_MANIFEST" "$M/hermes-$TARGET.manifest.json"
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
[ "$(sha_of "$A/hermes-runtime-payload-$TARGET.tar.gz")" = "$(sha_of "$ARCHIVE")" ]
[ "$(sha_of "$M/hermes-$TARGET.manifest.json")" = "$(sha_of "$STAGED_MANIFEST")" ]
echo "staged Hermes runtime payload ($TARGET, built as $BUILD_TARGET) under dist-native/managed-runtimes"

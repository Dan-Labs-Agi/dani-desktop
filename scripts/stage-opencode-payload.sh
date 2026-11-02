#!/bin/sh
# Stage a built OpenCode runtime payload into dist-native/managed-runtimes for
# packaging. Verifies the build output, the archive against its manifest, and
# the staged bytes independently.
#
# Usage: scripts/stage-opencode-payload.sh BUILD_OUT TARGET [REPO_ROOT]
#   TARGET: linux-x64 | darwin-arm64 | darwin-x64 | win32-x64 (app naming)
set -eu
SOURCE="$(cd "${1:?usage: stage-opencode-payload.sh BUILD_OUT TARGET [REPO_ROOT]}" && pwd)"
TARGET="${2:?missing target (linux-x64|darwin-arm64|darwin-x64|win32-x64)}"
ROOT="$(cd "${3:-$(dirname "$0")/..}" && pwd)"
VER=1.18.32
ARCHIVE="$SOURCE/opencode-payload-$TARGET-v$VER.tar.gz"
MANIFEST="$SOURCE/opencode-payload-$TARGET-v$VER.manifest.json"
SUMS="$SOURCE/SHA256SUMS.txt"
[ -f "$ARCHIVE" ] && [ -f "$MANIFEST" ]
if [ -f "$SUMS" ] && command -v sha256sum >/dev/null 2>&1; then (cd "$SOURCE" && sha256sum -c SHA256SUMS.txt); fi
python3 - "$ARCHIVE" "$MANIFEST" "$TARGET" <<'PY'
import hashlib, json, os, sys
archive, manifest, target = sys.argv[1:]
m = json.load(open(manifest))
h = hashlib.sha256(open(archive, 'rb').read()).hexdigest()
assert h == m['archiveSha256'], f"archive hash mismatch: {h} != {m['archiveSha256']}"
assert os.path.getsize(archive) == m['archiveSize'], 'archive size mismatch'
assert m['name'] == 'opencode-runtime-payload' and m['target'] == target, \
    f"manifest identity mismatch: {m['name']} {m['target']} != {target}"
assert m['format'] == 'tar.gz', 'payload archive must be tar.gz'
assert m['upstreamCommit'] == 'f5ce4f881e477c7b75421cea2d20939f0ddd71fb'
assert m['probe']['expectedAgentName'] == 'OpenCode' and m['probe']['expectedVersion'] == '1.18.32'
probe0 = m['probe']['argv'][0]
if target.startswith('win32-'):
    assert probe0.endswith('.cmd'), 'win32 probe must be a .cmd'
    assert m['executableRelPath'].endswith('.cmd'), 'win32 executable must be a .cmd'
else:
    assert not probe0.endswith('.cmd'), 'non-win32 probe must not be a .cmd'
if target == 'darwin-x64':
    assert len(m['degradations']) >= 1, 'darwin-x64 must declare its baseline degradation'
PY
A="$ROOT/dist-native/managed-runtimes/archives"; M="$ROOT/dist-native/managed-runtimes/manifests"
mkdir -p "$A" "$M"
cp "$ARCHIVE" "$A/opencode-runtime-payload-$TARGET.tar.gz"
cp "$MANIFEST" "$M/opencode-$TARGET.manifest.json"
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
[ "$(sha_of "$A/opencode-runtime-payload-$TARGET.tar.gz")" = "$(sha_of "$ARCHIVE")" ]
[ "$(sha_of "$M/opencode-$TARGET.manifest.json")" = "$(sha_of "$MANIFEST")" ]
echo "staged OpenCode runtime payload ($TARGET) under dist-native/managed-runtimes"

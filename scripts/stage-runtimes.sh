#!/bin/sh
# Build (when missing) and stage the pinned managed runtime payloads
# (Hermes + OpenCode) for one app target into dist-native/managed-runtimes,
# which electron-builder then packs as extraResources.
#
# Usage: scripts/stage-runtimes.sh [TARGET]
#   TARGET: linux-x64 | darwin-arm64 | darwin-x64 | win32-x64
#   Default: the build host's own target.
#
# Idempotent: payload archives already built under dist-payloads/<target>/ are
# re-verified and reused; staging always re-verifies hashes against the
# manifests. Builds need network access to the pinned upstream artifacts only.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -ge 1 ]; then
  TARGET="$1"
else
  HOST="$(uname -s)-$(uname -m)"
  case "$HOST" in
    Linux-x86_64)     TARGET=linux-x64 ;;
    Darwin-arm64)     TARGET=darwin-arm64 ;;
    Darwin-x86_64)    TARGET=darwin-x64 ;;
    Windows_NT-x86_64|MINGW*-x86_64|MSYS*-x86_64) TARGET=win32-x64 ;;
    *) echo "cannot derive target from host $HOST; pass one explicitly" >&2; exit 2 ;;
  esac
fi
case "$TARGET" in
  linux-x64|darwin-arm64|darwin-x64|win32-x64) ;;
  *) echo "unknown target: $TARGET" >&2; exit 2 ;;
esac

OUT="$ROOT/dist-payloads/$TARGET"
mkdir -p "$OUT"

# --- OpenCode -------------------------------------------------------------
OC_ARCHIVE="$OUT/opencode-payload-$TARGET-v1.18.32.tar.gz"
if [ ! -f "$OC_ARCHIVE" ]; then
  echo "==> building OpenCode payload ($TARGET)"
  sh "$ROOT/scripts/build-opencode-payload.sh" "$TARGET" "$OUT"
fi
sh "$ROOT/scripts/stage-opencode-payload.sh" "$OUT" "$TARGET" "$ROOT"

# --- Hermes ---------------------------------------------------------------
case "$TARGET" in
  linux-x64)    BUILD_TARGET=linux-x64 ;;
  darwin-arm64) BUILD_TARGET=mac-arm64 ;;
  darwin-x64)   BUILD_TARGET=mac-x64 ;;
  win32-x64)    BUILD_TARGET=win-x64 ;;
esac
HM_ARCHIVE="$OUT/hermes-payload-$BUILD_TARGET-v2026.9.21.tar.gz"
if [ ! -f "$HM_ARCHIVE" ]; then
  echo "==> building Hermes payload ($TARGET, builder target $BUILD_TARGET)"
  # Tool bootstrap for clean runners: uv and the python 'packaging' module.
  if ! command -v uv >/dev/null 2>&1; then
    echo "    uv not found; installing to ~/.local/bin"
    curl -fsSL https://astral.sh/uv/install.sh | sh
    PATH="$HOME/.local/bin:$PATH"; export PATH
  fi
  if ! python3 -c 'import packaging' >/dev/null 2>&1; then
    echo "    python3 'packaging' module not found; installing with pip --user"
    python3 -m pip install --user packaging
  fi
  sh "$ROOT/scripts/build-hermes-payload.sh" "$BUILD_TARGET" "$OUT"
fi
sh "$ROOT/scripts/stage-hermes-payload.sh" "$OUT" "$TARGET" "$ROOT"

echo "managed runtimes staged for $TARGET"

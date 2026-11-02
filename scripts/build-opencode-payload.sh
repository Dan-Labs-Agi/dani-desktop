#!/bin/sh
# Build a redistributable OpenCode runtime payload for one app target.
#
# Usage: scripts/build-opencode-payload.sh TARGET OUTDIR [WORKDIR]
#   TARGET: linux-x64 | darwin-arm64 | darwin-x64 | win32-x64
#
# Supply-chain model: the upstream release artifact is pinned by SHA-256 and
# size, verified before use, and redistributed unmodified. Dani adds only
# launchers, probes, NOTICE, and SBOM metadata. All targets repack to tar.gz
# so staging and in-app verification stay uniform.
set -eu

TARGET="${1:?usage: build-opencode-payload.sh TARGET OUTDIR [WORKDIR]}"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
WORK="${3:-$(mktemp -d)}"; mkdir -p "$WORK"

VER=1.18.32
UPSTREAM_COMMIT=f5ce4f881e477c7b75421cea2d20939f0ddd71fb
BASE=https://github.com/anomalyco/opencode/releases/download/v$VER

case "$TARGET" in
  linux-x64)
    ART=opencode-linux-x64-baseline.tar.gz
    UP_SHA=763af386ef88a8cab18df00fcf055690e5a55e31a7088beabe02307142a6adce
    UP_SIZE=60608354
    ZIP=0
    EXE=opencode
    ;;
  darwin-arm64)
    ART=opencode-darwin-arm64.zip
    UP_SHA=fa643f93401c13508d8d513780e54ce9cc01203d501114be9b88d62408b8101f
    UP_SIZE=46299070
    ZIP=1
    EXE=opencode
    ;;
  darwin-x64)
    ART=opencode-darwin-x64-baseline.zip
    UP_SHA=3888d74f1478b94ab1682a7c30942ab53e1266329f3786cf05e499381572dea8
    UP_SIZE=48490250
    ZIP=1
    EXE=opencode
    ;;
  win32-x64)
    ART=opencode-windows-x64-baseline.zip
    UP_SHA=cd852831bd094c2df2eb379eb98bed7a63db7f823a7caf277c732cdac33cbdb6
    UP_SIZE=62101771
    ZIP=1
    EXE=opencode.exe
    ;;
  *) echo "unknown target: $TARGET (want linux-x64|darwin-arm64|darwin-x64|win32-x64)" >&2; exit 2 ;;
esac

UP="$WORK/$ART"
if [ ! -f "$UP" ]; then curl -fL "$BASE/$ART" -o "$UP"; fi
[ "$(stat -c %s "$UP" 2>/dev/null || stat -f %z "$UP")" = "$UP_SIZE" ]
if command -v sha256sum >/dev/null 2>&1; then
  echo "$UP_SHA  $UP" | sha256sum -c -
else
  [ "$(shasum -a 256 "$UP" | cut -d' ' -f1)" = "$UP_SHA" ]
fi

P="$OUT/opencode-payload-$TARGET"
rm -rf "$P"; mkdir -p "$P/bin" "$P/probe" "$P/licenses"
if [ "$ZIP" = 1 ]; then
  if command -v unzip >/dev/null 2>&1; then unzip -q "$UP" -d "$P/bin"; else tar -xf "$UP" -C "$P/bin"; fi
else
  tar xzf "$UP" -C "$P/bin"
fi
chmod +x "$P/bin/$EXE" 2>/dev/null || true

cat > "$P/bin/opencode-acp" <<'EOF'
#!/bin/sh
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/bin/opencode" acp --pure "$@"
EOF
chmod +x "$P/bin/opencode-acp"
cat > "$P/bin/opencode-acp.cmd" <<'EOF'
@echo off
set "ROOT=%~dp0.."
"%ROOT%\bin\opencode.exe" acp --pure %*
EOF

cp "$(dirname "$0")/opencode-payload/"* "$P/probe/"; chmod +x "$P/probe/run-probe.sh"

cat > "$P/licenses/OpenCode-MIT.txt" <<'EOF'
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
EOF
cat > "$P/NOTICE" <<EOF
OpenCode Runtime Payload - Third-Party Notices
OpenCode v$VER (commit $UPSTREAM_COMMIT), official immutable $TARGET release artifact ($ART).
Upstream: https://github.com/anomalyco/opencode/releases/tag/v$VER
Archive SHA-256: $UP_SHA; size: $UP_SIZE bytes.
Copyright (c) 2025 opencode. MIT license: licenses/OpenCode-MIT.txt.
The upstream executable is redistributed unmodified. Dani adds only launchers, probes, NOTICE, and SBOM metadata.
EOF

sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
size_of() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }
BIN_SHA=$(sha_of "$P/bin/$EXE"); BIN_SIZE=$(size_of "$P/bin/$EXE")
cat > "$P/SBOM.cdx.json" <<EOF
{"bomFormat":"CycloneDX","specVersion":"1.5","serialNumber":"urn:uuid:9ff06d4b-6e5d-4cc4-85d4-118320000001","version":1,"metadata":{"component":{"type":"application","name":"opencode-runtime-payload","version":"$VER"}},"components":[{"type":"application","bom-ref":"pkg:github/anomalyco/opencode@v$VER","name":"OpenCode","version":"$VER","licenses":[{"license":{"id":"MIT"}}],"hashes":[{"alg":"SHA-256","content":"$BIN_SHA"}],"properties":[{"name":"dani:upstreamCommit","value":"$UPSTREAM_COMMIT"},{"name":"dani:upstreamTag","value":"v$VER"},{"name":"dani:upstreamArchiveSha256","value":"$UP_SHA"},{"name":"dani:target","value":"$TARGET"},{"name":"dani:executableSize","value":"$BIN_SIZE"}]}]}
EOF

A="$OUT/opencode-payload-$TARGET-v$VER.tar.gz"
tar --mode='go-w' -czf "$A" -C "$OUT" "opencode-payload-$TARGET" 2>/dev/null || tar -czf "$A" -C "$OUT" "opencode-payload-$TARGET"
python3 "$(dirname "$0")/opencode_manifest.py" --target "$TARGET" --payload-dir "$P" --archive "$A" --out "$OUT/opencode-payload-$TARGET-v$VER.manifest.json"
(cd "$OUT" && sha256sum "$(basename "$A")" "$(basename "$A" .tar.gz).manifest.json" > SHA256SUMS.txt 2>/dev/null) || true

# Probe only where the host can execute the target's binaries.
RUN_PROBE="${RUN_PROBE:-auto}"
HOST="$(uname -s)-$(uname -m)"
CAN_RUN=0
case "$TARGET:$HOST" in
  linux-x64:Linux-x86_64|darwin-arm64:Darwin-arm64|darwin-x64:Darwin-x86_64|win32-x64:Windows_NT-x86_64) CAN_RUN=1 ;;
esac
case "$HOST" in MINGW*-x86_64|MSYS*-x86_64) [ "$TARGET" = win32-x64 ] && CAN_RUN=1 ;; esac
if [ "$RUN_PROBE" = 1 ] || { [ "$RUN_PROBE" = auto ] && [ "$CAN_RUN" = 1 ] && [ "$TARGET" != win32-x64 ]; }; then
  "$P/probe/run-probe.sh"
elif [ "$RUN_PROBE" = auto ] && [ "$CAN_RUN" = 1 ] && [ "$TARGET" = win32-x64 ]; then
  echo "    probe: run on Windows as probe\\run-probe.cmd (skipped on this host)"
else
  echo "    probe: skipped (host $HOST cannot run $TARGET binaries)"
fi
echo "DONE $A"

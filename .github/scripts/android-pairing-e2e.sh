#!/usr/bin/env bash
# Runs inside an already-booted emulator. Starts the REAL Dani server from this checkout (server/dev-server.ts,
# loopback only), asks it for a real pairing credential, builds the link with the repo's own phonePairingLink(),
# opens it in the installed Dani app through adb reverse, and records what the app and the server did.
# The credential is generated at run time, lives only in this job's temp files, and is never printed.
set -u
APK="$1"; OUT="$2"; PKG="dev.danlab.dani"; PORT=18799
DATA="$(mktemp -d)"; mkdir -p "$OUT"
# The real server needs Node 24 and the repo's pnpm install; the runner image has neither pinned.
NODE_VER=24.11.0
curl -fsSL "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-linux-x64.tar.xz" | tar -xJ -C "$DATA"
export PATH="$DATA/node-v$NODE_VER-linux-x64/bin:$PATH"
node --version
npm install -g pnpm@10.33.0 > "$OUT/pnpm-setup.txt" 2>&1 || { cat "$OUT/pnpm-setup.txt"; exit 1; }
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile > "$OUT/pnpm-install.txt" 2>&1 || { tail -40 "$OUT/pnpm-install.txt"; exit 1; }
export OMB_PORT="$PORT" OMB_DATA_DIR="$DATA" OMB_DEV_TRUST_LOCAL_BROWSER=1
nohup node --experimental-strip-types server/dev-server.ts > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 90); do curl -fs "http://127.0.0.1:$PORT/api/health" > "$OUT/health.json" 2>/dev/null && break; sleep 2; done
[ -s "$OUT/health.json" ] || { echo "server did not come up"; tail -40 "$OUT/server.log"; exit 1; }
cat "$OUT/health.json"; echo
curl -fs -X POST "http://127.0.0.1:$PORT/api/auth/pairing" -H 'content-type: application/json' \
  -d '{"scopes":["client"],"label":"Android CI"}' > "$DATA/pairing.json" || { echo "pairing mint failed"; exit 1; }
node --experimental-strip-types -e '
import { readFileSync, writeFileSync } from "node:fs";
import { phonePairingLink } from "./shared/pairing-link.ts";
const p = JSON.parse(readFileSync(process.argv[1], "utf8"));
const link = phonePairingLink({ address: "127.0.0.1", port: Number(process.argv[2]), token: p.credential, name: p.serverName });
if (!link) { console.error("phonePairingLink returned null"); process.exit(1); }
writeFileSync(process.argv[3], link);
console.log("link built, scheme:", link.split("://")[0], "length:", link.length);
' "$DATA/pairing.json" "$PORT" "$DATA/link.txt" || exit 1
curl -fs "http://127.0.0.1:$PORT/api/auth/pairing" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("open pairings before:",JSON.parse(s).pairings.length))' | tee "$OUT/pairings-before.txt"
adb reverse "tcp:$PORT" "tcp:$PORT"
adb logcat -c
adb install -r "$APK" > "$OUT/install.txt" 2>&1; cat "$OUT/install.txt"
grep -q '^Success' "$OUT/install.txt" || { echo "install failed"; exit 1; }
adb shell am start -W -n "$PKG/com.openmausbot.companion.MainActivity" > "$OUT/start.txt" 2>&1
sleep 8
# The link holds '&': it must be single-quoted for the device's own shell (the link carries no single quote).
adb shell "am start -W -a android.intent.action.VIEW -d '$(cat "$DATA/link.txt")' $PKG" > "$OUT/link.txt" 2>&1
sed 's/token=[^&]*/token=REDACTED/' "$OUT/link.txt" | head -5
for i in 1 2 3 4 5 6; do sleep 5; adb exec-out screencap -p > "$OUT/pair-$i.png"; done
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
curl -fs "http://127.0.0.1:$PORT/api/auth/pairing" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("open pairings after:",JSON.parse(s).pairings.length))' | tee "$OUT/pairings-after.txt"
adb logcat -d -v time > "$OUT/logcat.txt"
grep -E 'FATAL EXCEPTION|ANR in' "$OUT/logcat.txt" > "$OUT/crashes.txt" || true
grep -E 'POST /api/auth/pair|auth/pair' "$OUT/server.log" | sed 's/token=[^& ]*/token=REDACTED/' | tail -5 > "$OUT/server-pair-lines.txt" || true
kill "$SERVER_PID" 2>/dev/null || true
[ ! -s "$OUT/crashes.txt" ] || { echo "app crashed"; cat "$OUT/crashes.txt"; exit 1; }
grep -q 'after: 0' "$OUT/pairings-after.txt" || { echo "pairing was not redeemed by the app"; exit 1; }
echo "pairing e2e ok"

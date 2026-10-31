#!/usr/bin/env bash
# Runs inside an already-booted emulator. Installs the Dani debug APK, launches it, and records
# what is on screen and in the device log. No account, pairing code or secret is used.
set -u
APK="$1"; OUT="$2"; PKG="dev.danlab.dani"
mkdir -p "$OUT"
adb logcat -c
adb install -r "$APK" > "$OUT/install.txt" 2>&1; cat "$OUT/install.txt"
grep -q '^Success' "$OUT/install.txt" || { echo "install failed"; exit 1; }
adb shell dumpsys package "$PKG" | grep -E 'versionName|versionCode|firstInstallTime' > "$OUT/package.txt"
adb shell am start -W -n "$PKG/com.openmausbot.companion.MainActivity" > "$OUT/start.txt" 2>&1; cat "$OUT/start.txt"
sleep 12
adb exec-out screencap -p > "$OUT/launch-1.png"
adb shell pidof "$PKG" > "$OUT/pid.txt" 2>&1; cat "$OUT/pid.txt"
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
adb logcat -d -v time > "$OUT/logcat.txt"
grep -E 'FATAL EXCEPTION|ANR in' "$OUT/logcat.txt" > "$OUT/crashes.txt" || true
if [ -s "$OUT/crashes.txt" ]; then echo "crash found"; cat "$OUT/crashes.txt"; exit 1; fi
test -s "$OUT/pid.txt" || { echo "app process not running"; exit 1; }
# A danibot:// pairing link must reach the pairing trampoline (it carries a dummy code that no server issued).
adb shell am start -W -a android.intent.action.VIEW -d 'danibot://pair?address=127.0.0.1:1&code=000000' > "$OUT/link.txt" 2>&1; cat "$OUT/link.txt"
sleep 6
adb exec-out screencap -p > "$OUT/danibot-link.png"
adb logcat -d -v time > "$OUT/logcat-after-link.txt"
grep -E 'FATAL EXCEPTION|ANR in' "$OUT/logcat-after-link.txt" > "$OUT/crashes-after-link.txt" || true
[ ! -s "$OUT/crashes-after-link.txt" ] || { echo "crash after link"; cat "$OUT/crashes-after-link.txt"; exit 1; }
echo "emulator smoke ok"

#!/usr/bin/env bash
# Native DEB proof in a disposable private /opt. The hosted runner's /opt is
# never repaired or used as a substitute for the package's safety requirement.
set -euo pipefail
printf 'DANI_HOST_OPT '
stat -c '%U:%G:%a' /opt
command -v unshare >/dev/null
command -v runuser >/dev/null
# Establish existing runner capability before attempting any private mount.
sudo -n unshare --mount --propagation private -- true
runner=$(id -un)
node_copy=$(mktemp "${RUNNER_TEMP}/dani-native-node.XXXXXX")
cp "$(command -v node)" "$node_copy"
chmod 0755 "$node_copy"
trap 'rm -f "$node_copy"' EXIT
# Copy the Node binary because the runner's toolcache under /opt becomes hidden.
# The app runs as the original user, with the normal Electron sandbox enabled.
sudo --preserve-env=RUNNER_TEMP,GITHUB_SHA,DANI_INSTALLER_FORMAT,DANI_VERIFY_FREE_INSTALL,OMB_AI_CHECKS,DISPLAY,XAUTHORITY,DBUS_SESSION_BUS_ADDRESS,PATH \
  unshare --mount --propagation private --fork bash -s -- "$runner" "$node_copy" "$PWD/scripts/verify-main-linux-installed.cjs" <<'NAMESPACE'
set -euo pipefail
runner=$1
node_copy=$2
verifier=$3
mount -t tmpfs -o mode=0755,uid=0,gid=0 tmpfs /opt
trap 'umount /opt' EXIT
printf 'DANI_PRIVATE_OPT '
stat -c '%U:%G:%a' /opt
[ "$(stat -c '%U:%G:%a' /opt)" = root:root:755 ]
runuser -u "$runner" -- "$node_copy" "$verifier"
NAMESPACE

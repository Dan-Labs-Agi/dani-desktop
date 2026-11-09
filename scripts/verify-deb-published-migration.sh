#!/usr/bin/env bash
# Native DEB proof in a disposable private /opt. The hosted runner's /opt is
# never repaired or used as a substitute for the package's safety requirement.
set -euo pipefail
cat /etc/os-release
printf 'DANI_MIGRATION_KERNEL '
uname -r
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
sudo --preserve-env=CI,RUNNER_TEMP,GITHUB_SHA,DANI_INSTALLER_FORMAT,DANI_VERIFY_FREE_INSTALL,OMB_AI_CHECKS,DISPLAY,XAUTHORITY,DBUS_SESSION_BUS_ADDRESS,PATH \
  unshare --mount --propagation private --fork bash -s -- "$runner" "$node_copy" "$PWD/scripts/verify-deb-published-migration.cjs" "$PWD/release" <<'NAMESPACE'
set -euo pipefail
runner=$1
node_copy=$2
verifier=$3
release=$4
mount -t tmpfs -o mode=0755,uid=0,gid=0 tmpfs /opt
cleanup_private_opt() {
  status=$?
  trap - EXIT
  # The verifier kills its own detached Electron group on exit. Give those
  # processes time to release executable mappings before unmounting.
  for attempt in $(seq 1 20); do
    if umount /opt 2>"$RUNNER_TEMP/dani-private-opt-unmount.log"; then
      printf 'DANI_PRIVATE_OPT_UNMOUNT_PASS attempt=%s\n' "$attempt"
      exit "$status"
    fi
    sleep 0.5
  done
  cat "$RUNNER_TEMP/dani-private-opt-unmount.log" >&2
  echo 'Private /opt cleanup failed; validation remains failed.' >&2
  exit 32
}
trap cleanup_private_opt EXIT
printf 'DANI_PRIVATE_OPT '
stat -c '%U:%G:%a' /opt
[ "$(stat -c '%U:%G:%a' /opt)" = root:root:755 ]
candidate=$(find "$release" -maxdepth 1 -name 'DaniBot-*-amd64.deb' -type f)
[ -n "$candidate" ]
[ "$(printf '%s\n' "$candidate" | wc -l)" -eq 1 ]
export DEBIAN_FRONTEND=noninteractive
apt-get install -y "$RUNNER_TEMP/published-DaniBot-0.1.58-amd64.deb"
[ "$(dpkg-query -W -f='${Version}' danibot)" = 0.1.58 ]
runuser -u "$runner" -- env DANI_MIGRATION_PHASE=published "$node_copy" "$verifier"
apt-get install -y "$candidate"
runuser -u "$runner" -- env DANI_MIGRATION_PHASE=upgraded "$node_copy" "$verifier"
NAMESPACE

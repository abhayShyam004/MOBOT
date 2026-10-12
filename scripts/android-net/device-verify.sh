#!/usr/bin/env bash
#
# Device verification for the Android native networking addons.
#
#   scripts/android-net/device-verify.sh [--serial SN] [--abi arm64-v8a]
#
# Requires a phone connected over adb with the debug APK installed, and addons
# already built by scripts/android-net/build-native-addons.mjs.
#
# The app performs this same placement itself at runtime (the npx shim installs
# with --ignore-scripts, so nothing on the phone can compile an addon; the host
# copies a prebuilt one into the package's own build/Release after install).
# Doing it here by hand lets a build be checked before it is packaged.
#
# What it touches: the app's npm cache tree, which is where the app installs
# these packages anyway, and /data/local/tmp for staging. It does not touch the
# person's workspace, their chats, or the live app process, and running it twice
# is the same as running it once.
#
# Exit status is the payloads': 0 only when every check passed on the phone.

set -euo pipefail

SERIAL=""
ABI="arm64-v8a"

while [ $# -gt 0 ]; do
  case "$1" in
    --serial) SERIAL=${2:?--serial needs a value}; shift 2 ;;
    --abi) ABI=${2:?--abi needs a value}; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STAGE="$ROOT/.omb-scratch/webrtc/out/$ABI"
PKG=com.openmausbot.companion
APP_DATA=/data/user/0/$PKG
DEVICE_STAGE=/data/local/tmp/omb-addons

case "$ABI" in
  arm64-v8a) LIB_ARCH=arm64 ;;
  armeabi-v7a) LIB_ARCH=arm ;;
  x86_64) LIB_ARCH=x86_64 ;;
  *) echo "unknown ABI: $ABI" >&2; exit 2 ;;
esac

adb_() { timeout 120 adb ${SERIAL:+-s "$SERIAL"} "$@"; }

PASS=0
FAIL=0

expect_contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    echo "ok   $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL $label — expected to find: $needle"
    FAIL=$((FAIL + 1))
  fi
}

expect_matches() {
  local label="$1" pattern="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qE -- "$pattern"; then
    echo "ok   $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL $label — expected to match: $pattern"
    FAIL=$((FAIL + 1))
  fi
}

for artifact in node_datachannel.node utp_native.node; do
  [ -f "$STAGE/$artifact" ] || {
    echo "missing $STAGE/$artifact — run: node scripts/android-net/build-native-addons.mjs --abi $ABI" >&2
    exit 2
  }
done

echo "device: $(adb_ get-state)"
APK_PATH=$(adb_ shell pm path $PKG | tr -d '\r' | sed 's/^package://')
[ -n "$APK_PATH" ] || { echo "$PKG is not installed on this device" >&2; exit 2; }
LIB_DIR=$(dirname "$APK_PATH")/lib/$LIB_ARCH
echo "native libs: $LIB_DIR"

stage_file() { # stage_file <local path> <name on device>
  adb_ push "$1" "$DEVICE_STAGE/$2" >/dev/null
}

adb_ shell mkdir -p "$DEVICE_STAGE"
stage_file "$STAGE/node_datachannel.node" node_datachannel.node
stage_file "$STAGE/utp_native.node" utp_native.node
stage_file "$ROOT/scripts/android-net/webrtc-functional.cjs" webrtc-functional.cjs
stage_file "$ROOT/scripts/android-net/utp-functional.cjs" utp-functional.cjs
adb_ shell "chmod 644 $DEVICE_STAGE/*"

# What is being verified, by hash, so the result can be tied to a build.
for artifact in node_datachannel.node utp_native.node; do
  printf 'staged %-24s %s  %s bytes\n' "$artifact" \
    "$(sha256sum "$STAGE/$artifact" | cut -c1-16)…" "$(wc -c <"$STAGE/$artifact")"
done
echo "addon libs: $(adb_ shell "run-as $PKG sh -c 'ls $LIB_DIR/libssl_3.so $LIB_DIR/libcrypto_3.so'" | tr -d '\r' | tr '\n' ' ')"

# The device-side half runs as the app's own uid, with the app's own runtime and
# the app's own LD_LIBRARY_PATH, so nothing about the environment is borrowed
# from a desktop.
write_device_script() {
  cat <<EOF
set -eu
APP=$APP_DATA
LIB=$LIB_DIR
STAGE=$DEVICE_STAGE
NM=\$APP/.npm/_npx-shim/torlnk/node_modules
status=0

place() {
  pkg=\$1; file=\$2
  if [ -f "\$NM/\$pkg/package.json" ]; then
    mkdir -p "\$NM/\$pkg/build/Release"
    cp "\$STAGE/\$file" "\$NM/\$pkg/build/Release/\$file"
    echo "placed \$pkg/build/Release/\$file (\$(wc -c < "\$NM/\$pkg/build/Release/\$file") bytes)"
  else
    echo "SKIP \$pkg: not installed under \$NM"
  fi
}

place node-datachannel node_datachannel.node
place utp-native utp_native.node

echo "=== node-datachannel: load + peer connection + data channel ==="
if LD_LIBRARY_PATH=\$LIB \$LIB/libnode_host.so \$STAGE/webrtc-functional.cjs \$NM/node-datachannel; then
  echo "RESULT webrtc: PASS"
else
  echo "RESULT webrtc: FAIL (exit \$?)"
  status=1
fi

echo "=== utp-native: sockets + transfer ==="
if LD_LIBRARY_PATH=\$LIB \$LIB/libnode_host.so \$STAGE/utp-functional.cjs \$NM/utp-native; then
  echo "RESULT utp: PASS"
else
  echo "RESULT utp: FAIL (exit \$?)"
  status=1
fi

exit \$status
EOF
}

write_device_script >"$ROOT/.omb-scratch/webrtc/device-verify-inner.sh"
adb_ push "$ROOT/.omb-scratch/webrtc/device-verify-inner.sh" "$DEVICE_STAGE/verify.sh" >/dev/null
adb_ shell "chmod 644 $DEVICE_STAGE/verify.sh"

echo "=== running on the phone ==="
set +e
OUTPUT=$(adb_ shell "run-as $PKG sh $DEVICE_STAGE/verify.sh" 2>&1)
STATUS=$?
set -e
printf '%s\n' "$OUTPUT"

# The payloads' own verdict, plus the specifics that make the WebRTC result a
# peer connection rather than two objects that never spoke.
expect_contains "an offer and an answer crossed between the peers" "WEBRTC_SDP a:offer,b:answer" "$OUTPUT"
expect_matches "both sides gathered ICE candidates" "WEBRTC_CANDIDATES a=[1-9][0-9]* b=[1-9][0-9]*" "$OUTPUT"
expect_contains "the WebRTC payload passed" "RESULT webrtc: PASS" "$OUTPUT"
expect_contains "the uTP payload passed" "RESULT utp: PASS" "$OUTPUT"
expect_contains "the uTP transfer moved bytes both ways" "\"bidirectionalTransfer\":true" "$OUTPUT"

echo "=== device-verify: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
exit $STATUS

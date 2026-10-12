#!/usr/bin/env bash
#
# Capability verification for the Android networking addons, on a device.
#
#   scripts/android-net/device-capability.sh [--serial SN]
#
# Proves three things that cannot be proved on a desktop:
#
#   1. the app's own path places the addons. The APK ships them under
#      host-server/native/<abi>/; the bot terminal's `npx` (the shim, run here
#      exactly as the app runs it) copies each one into the installed package's
#      build/Release — after the files were deliberately deleted.
#   2. the libraries' OWN detection flips to available: torlnk's
#      require("node-datachannel") loads, webrtc-polyfill imports, and
#      WebTorrent's ConnPool.UTP_SUPPORT is true — with no TORLINK_NO_* flag
#      anywhere in the environment.
#   3. the same detection says unavailable when the addons are hidden, so the
#      "available" above is a measurement and not a constant.
#
# It writes only inside the app's own npm cache trees (addon files the app
# itself puts there) and restores what it hides. Exit status is the verdict.

set -uo pipefail

SERIAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --serial) SERIAL=${2:?--serial needs a value}; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/.omb-scratch/webrtc/out/arm64-v8a"
PKG=com.openmausbot.companion
APP_DATA=/data/user/0/$PKG
DEVICE_STAGE=/data/local/tmp/omb-addons

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
    printf '%s\n' "$haystack" | sed 's/^/     | /'
    FAIL=$((FAIL + 1))
  fi
}

expect_absent() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    echo "FAIL $label — did not expect: $needle"
    printf '%s\n' "$haystack" | sed 's/^/     | /'
    FAIL=$((FAIL + 1))
  else
    echo "ok   $label"
    PASS=$((PASS + 1))
  fi
}

APK_PATH=$(adb_ shell pm path $PKG | tr -d '\r' | sed 's/^package://')
[ -n "$APK_PATH" ] || { echo "$PKG is not installed on this device" >&2; exit 2; }
LIB_DIR=$(dirname "$APK_PATH")/lib/arm64
HOST_SERVER=$APP_DATA/files/host-server
WS=$APP_DATA/files/host/workspace
TREE_WS=$WS/.npm/_npx-shim/torlnk/node_modules
TREE_HOME=$APP_DATA/.npm/_npx-shim/torlnk/node_modules

echo "native libs:  $LIB_DIR"
echo "host server:  $HOST_SERVER"
echo "workspace:    $WS"

adb_ shell mkdir -p "$DEVICE_STAGE" >/dev/null
adb_ push "$ROOT/scripts/android-net/capability-detection.cjs" "$DEVICE_STAGE/capability-detection.cjs" >/dev/null
adb_ push "$ROOT/scripts/android-net/webtorrent-transport.cjs" "$DEVICE_STAGE/webtorrent-transport.cjs" >/dev/null
adb_ push "$ROOT/scripts/android-net/net-regression.cjs" "$DEVICE_STAGE/net-regression.cjs" >/dev/null
adb_ shell "chmod 644 $DEVICE_STAGE/capability-detection.cjs $DEVICE_STAGE/webtorrent-transport.cjs $DEVICE_STAGE/net-regression.cjs"

# ── the device half ────────────────────────────────────────────────────────
# Generated with the paths baked in so nothing has to survive three levels of
# shell quoting at the adb boundary.
cat >"$ROOT/.omb-scratch/webrtc/capability-inner.sh" <<EOF
set -u
APP=$APP_DATA
LIB=$LIB_DIR
HOST=$HOST_SERVER
WS=$WS
TREES="\$WS/.npm/_npx-shim/torlnk/node_modules \$APP/.npm/_npx-shim/torlnk/node_modules"
PAYLOAD=$DEVICE_STAGE/capability-detection.cjs

addon_files() {
  for t in \$TREES; do
    for p in node-datachannel utp-native; do
      d=\$t/\$p/build/Release
      if [ -d "\$d" ]; then
        for f in "\$d"/*.node; do
          [ -e "\$f" ] && echo "\$f \$(sha256sum "\$f" | cut -c1-16)…"
        done
      fi
    done
  done
}

case "\$1" in
  clean)
    for t in \$TREES; do
      for p in node-datachannel utp-native; do
        rm -f "\$t/\$p/build/Release/"*.node
      done
    done
    echo "--- addons present after cleaning ---"
    addon_files
    echo "--- end ---"
    ;;
  shim)
    cd "\$WS" || exit 1
    HOME="\$WS" LD_LIBRARY_PATH="\$LIB" \\
      OMB_NPX_SHIM="\$HOST/android-npx-shim.js" OMB_NPM_CLI="\$HOST/npm/bin/npm-cli.js" \\
      "\$LIB/libnode_host.so" "\$HOST/android-npx-shim.js" --yes torlnk --version 2>&1
    echo "--- addons present after the app's npx path ---"
    addon_files
    echo "--- end ---"
    ;;
  capability)
    HOME="\$WS" TMPDIR="\$WS/.tmp" LD_LIBRARY_PATH="\$LIB" "\$LIB/libnode_host.so" "\$PAYLOAD" "\$WS/.npm/_npx-shim/torlnk/node_modules" 2>&1
    ;;
  webtorrent)
    # TMPDIR mirrors what the app's shell environment sets for the bot terminal.
    # WebTorrent's *default* store path is /tmp/webtorrent resolved at module
    # load, and Android's /tmp exists without being writable — which is why
    # every add() in this payload passes an explicit path, the same way torlnk
    # does (`{ path: downloadDir }`).
    mkdir -p "\$WS/.tmp"
    cd "\$WS" || exit 1
    HOME="\$WS" TMPDIR="\$WS/.tmp" LD_LIBRARY_PATH="\$LIB" "\$LIB/libnode_host.so" \
      "$DEVICE_STAGE/webtorrent-transport.cjs" "\$WS/.npm/_npx-shim/torlnk/node_modules" 2>&1
    ;;
  net)
    cd "\$WS" || exit 1
    HOME="\$WS" TMPDIR="\$WS/.tmp" LD_LIBRARY_PATH="\$LIB" "\$LIB/libnode_host.so" \
      "$DEVICE_STAGE/net-regression.cjs" "\$WS/.npm/_npx-shim/torlnk/node_modules" 2>&1
    ;;
  torlnk-direct)
    cd "\$WS" || exit 1
    HOME="\$WS" LD_LIBRARY_PATH="\$LIB" "\$LIB/libnode_host.so" \\
      "\$WS/.npm/_npx-shim/torlnk/node_modules/torlnk/dist/cli.cjs" --version 2>&1
    ;;
  hide)
    for t in \$TREES; do
      for p in node-datachannel utp-native; do
        d=\$t/\$p/build/Release
        [ -d "\$d" ] && mv "\$d" "\$d.omb-hidden"
      done
    done
    echo "hidden"
    ;;
  restore)
    for t in \$TREES; do
      for p in node-datachannel utp-native; do
        d=\$t/\$p/build/Release.omb-hidden
        [ -d "\$d" ] && mv "\$d" "\${d%.omb-hidden}"
      done
    done
    echo "restored"
    ;;
  *) echo "unknown step \$1" >&2; exit 2 ;;
esac
EOF

adb_ push "$ROOT/.omb-scratch/webrtc/capability-inner.sh" "$DEVICE_STAGE/capability.sh" >/dev/null
adb_ shell "chmod 644 $DEVICE_STAGE/capability.sh"
step() { adb_ shell "run-as $PKG sh $DEVICE_STAGE/capability.sh $1"; }

echo
echo "=== 1. the addons the APK shipped ==="
SHIPPED=$(adb_ shell "run-as $PKG sh -c 'ls -l $HOST_SERVER/native/arm64-v8a/*.node'")
printf '%s\n' "$SHIPPED"
expect_contains "the APK's bundle carries the WebRTC addon" "node_datachannel.node" "$SHIPPED"
expect_contains "the APK's bundle carries the uTP addon" "utp_native.node" "$SHIPPED"

echo
echo "=== 2. the app's own path places them (files deleted first) ==="
CLEANED=$(step clean)
printf '%s\n' "$CLEANED"
expect_absent "the package trees start without addons" ".node " "$CLEANED"
SHIMMED=$(step shim)
printf '%s\n' "$SHIMMED"
expect_contains "the app's npx path placed node-datachannel" "node-datachannel/build/Release/node_datachannel.node" "$SHIMMED"
expect_contains "the app's npx path placed utp-native" "utp-native/build/Release/utp_native.node" "$SHIMMED"
expect_contains "torlnk runs from that tree" "torlink v1.9.0" "$SHIMMED"
expect_absent "torlnk does not report WebRTC missing" "WebRTC peers unavailable" "$SHIMMED"

LOCAL_ND=$(sha256sum "$OUT/node_datachannel.node" | cut -c1-16)
LOCAL_UTP=$(sha256sum "$OUT/utp_native.node" | cut -c1-16)
expect_contains "the placed WebRTC addon matches the build output" "$LOCAL_ND" "$SHIMMED"
expect_contains "the placed uTP addon matches the build output" "$LOCAL_UTP" "$SHIMMED"

echo
echo "=== 3. the libraries' own capability detection, addons in place ==="
AVAILABLE=$(step capability)
printf '%s\n' "$AVAILABLE"
expect_contains "torlnk's own probe loads node-datachannel" "CAPABILITY_TORLNK_PROBE loaded" "$AVAILABLE"
expect_contains "webrtc-polyfill imports" "CAPABILITY_POLYFILL ok" "$AVAILABLE"
expect_contains "RTCPeerConnection is a constructor" "CAPABILITY_RTCPeerConnection function" "$AVAILABLE"
expect_contains "the real libdatachannel version is reported" "CAPABILITY_LIBDATACHANNEL 0.24.2" "$AVAILABLE"
# utp-native's real export surface is exactly { createServer, connect };
# WebTorrent's check is only that the count is non-zero.
expect_contains "WebTorrent sees uTP exports" "CAPABILITY_UTP_KEYS 2" "$AVAILABLE"
expect_contains "WebTorrent's ConnPool.UTP_SUPPORT is true" "CAPABILITY_UTP_SUPPORT true" "$AVAILABLE"
expect_contains "no TORLINK_NO_* flag is set" "CAPABILITY_DISABLE_FLAGS none" "$AVAILABLE"

echo
echo "=== 3b. WebTorrent's own transports, addons in place ==="
WT_OK=$(step webtorrent)
printf '%s\n' "$WT_OK"
expect_contains "WebTorrent reports WebRTC support" "WT_WEBRTC_SUPPORT true" "$WT_OK"
expect_contains "the swarm downloaded the whole file" "WT_PAYLOAD_MATCH true" "$WT_OK"
expect_contains "the leecher connected over an outgoing uTP wire" "leech:utpOutgoing" "$WT_OK"
expect_contains "the seeder accepted an incoming uTP wire" "seed:utpIncoming" "$WT_OK"
expect_absent "no TCP wire replaced the uTP one" "tcpOutgoing" "$WT_OK"
expect_absent "and none arrived over TCP either" "tcpIncoming" "$WT_OK"

echo
echo "=== 4. the same detection with the addons hidden ==="
HIDDEN=$(step hide)
printf '%s\n' "$HIDDEN"
UNAVAILABLE=$(step capability)
printf '%s\n' "$UNAVAILABLE"
expect_absent "torlnk's probe no longer loads" "CAPABILITY_TORLNK_PROBE loaded" "$UNAVAILABLE"
expect_absent "webrtc-polyfill no longer imports" "CAPABILITY_POLYFILL ok" "$UNAVAILABLE"
expect_contains "RTCPeerConnection is not a constructor" "CAPABILITY_RTCPeerConnection undefined" "$UNAVAILABLE"
expect_contains "WebTorrent sees no uTP exports" "CAPABILITY_UTP_KEYS 0" "$UNAVAILABLE"
expect_contains "WebTorrent's ConnPool.UTP_SUPPORT is false" "CAPABILITY_UTP_SUPPORT false" "$UNAVAILABLE"

WT_NO=$(step webtorrent)
printf '%s\n' "$WT_NO"
expect_contains "WebTorrent reports no WebRTC support without the addon" "WT_WEBRTC_SUPPORT absent" "$WT_NO"
expect_absent "and the uTP wire never appears" "utpOutgoing" "$WT_NO"

WARNED=$(step torlnk-direct)
printf '%s\n' "$WARNED"
expect_contains "torlnk's own CLI reports WebRTC missing" "WebRTC peers unavailable" "$WARNED"

echo
echo "=== 4b. the rest of the network, with the addons preserved ==="
# Everything above ran with a uTP socket and a DTLS stack in the process; this
# checks the paths they could plausibly have disturbed.
step restore >/dev/null
NET=$(step net)
printf '%s\n' "$NET"
expect_contains "a TCP listener and connection still work" "ok   a TCP listener" "$NET"
expect_contains "a raw UDP datagram round trip still works" "ok   a raw UDP datagram round trip works" "$NET"
expect_contains "the runtime's TLS still works" "ok   DNS over HTTPS works" "$NET"
expect_contains "bittorrent-dht still bootstraps over UDP" "ok   bittorrent-dht bootstraps over UDP" "$NET"
expect_contains "the whole networking regression passed" "NET_RESULT pass" "$NET"

echo
echo "=== 5. restored ==="
step restore >/dev/null
RESTORED=$(step capability)
expect_contains "the capability is available again" "CAPABILITY_UTP_SUPPORT true" "$RESTORED"
expect_contains "and the probe loads again" "CAPABILITY_TORLNK_PROBE loaded" "$RESTORED"

echo
echo "=== device-capability: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1

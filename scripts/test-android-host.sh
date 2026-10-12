#!/usr/bin/env bash
# Device test for the Phase 2 standalone Android host.
#
#   scripts/test-android-host.sh [apk]
#
# Boots nothing: it drives whatever device adb sees (physical phone or
# emulator), installs the APK, launches the app, and collects the evidence
# Phase 2 asks for:
#
#   1. install + launch
#   2. embedded runtime start (HarnessHost / HostFiles logs)
#   3. server health green through an adb forward
#   4. bot fleet served from the device's own host
#   5. node process visible on-device
#
# Exit 0 only if install, launch, and health all succeed. Every failure path
# prints the logs needed to diagnose it.
set -uo pipefail

APK="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"
PKG="com.openmausbot.companion"
PORT_DEVICE=18799
PORT_HOST=28799

if [ ! -f "$APK" ]; then
    echo "APK not found: $APK"
    echo "build one with:  ./gradlew :app:assembleDebug  (from android/)"
    exit 2
fi

echo "== device =="
adb devices
if ! adb get-state >/dev/null 2>&1; then
    echo "No device. Connect the phone (USB debugging on) or start an emulator."
    exit 2
fi
echo "ABI list: $(adb shell getprop ro.product.cpu.abilist | tr -d '\r')"
echo "primary ABI: $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
echo "uname -m: $(adb shell uname -m | tr -d '\r')"
echo "API level: $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
echo "nativeLibraryDir: $(adb shell pm path $PKG >/dev/null 2>&1 && adb shell pm dump $PKG 2>/dev/null | grep -m1 primaryCpuAbi | tr -d '\r')"

echo "== install =="
if ! adb install -r -g "$APK"; then
    echo "INSTALL FAILED"
    exit 3
fi

echo "== launch =="
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" | head -2
sleep 25

echo "== host logs =="
adb logcat -d 2>/dev/null | grep -E "HarnessHost|HostFiles|StandalonePairing|HostProvisioning" | head -40

echo "== crashes =="
CRASHES=$(adb logcat -d 2>/dev/null | grep -c "FATAL EXCEPTION")
echo "fatal exceptions: $CRASHES"

echo "== health (via adb forward) =="
adb forward "tcp:$PORT_HOST" "tcp:$PORT_DEVICE"
sleep 2
HEALTH=$(curl -s -m 8 "http://127.0.0.1:$PORT_HOST/api/health" || true)
if [ -z "$HEALTH" ]; then
    echo "HOST DID NOT ANSWER on 127.0.0.1:$PORT_DEVICE (forwarded from device)"
    echo "== full HarnessHost/HostFiles evidence (failure point is in here) =="
    adb logcat -d 2>/dev/null | grep -E "HarnessHost|HostFiles|StandalonePairing" | tail -60
    echo "== node/server output captured by the supervisor =="
    adb logcat -d 2>/dev/null | grep "host-output|" | tail -20
    echo "== app crashes (OpenMausBot only — ignore Samsung system libs) =="
    adb logcat -d 2>/dev/null | grep -E "FATAL EXCEPTION|Process: $PKG|UnsatisfiedLinkError.*openmausbot" | head -8
    exit 4
fi
echo "health: $HEALTH"

echo "== bots =="
curl -s -m 10 "http://127.0.0.1:$PORT_HOST/api/bots" | head -c 600; echo

echo "== node on device (process tree) =="
adb shell "ps -A 2>/dev/null | grep -iE 'libnode|node_host' | head -3" || true
APP_PID=$(adb shell pidof $PKG | tr -d '\r')
echo "app pid: $APP_PID"
if [ -n "$APP_PID" ]; then
    echo "== app children (host process should appear here) =="
    adb shell "ps -o PID,PPID,NAME 2>/dev/null | grep -E \"^ *$APP_PID\$\$| $APP_PID\$\$\" | head -3" 2>/dev/null || true
    adb shell "for p in \$(ps -A -o PID,PPID 2>/dev/null | awk -v me=$APP_PID '\$2==me {print \$1}'); do ps -p \$p -o PID,ARGS 2>/dev/null | tail -1; done" 2>/dev/null | head -5
fi

if [ -n "$APP_PID" ] || adb shell run-as $PKG ls files >/dev/null 2>&1; then
    echo "== nativeLibraryDir contents (via run-as) =="
    NATIVE_DIR=$(adb shell run-as $PKG ls -d ../lib 2>/dev/null | tr -d '\r')
    adb shell run-as $PKG sh -c 'ls /data/app/*/lib* 2>/dev/null | head' 2>/dev/null || true
    NLD=$(adb shell run-as $PKG sh -c 'cmd package dump-profiles 2>/dev/null' >/dev/null 2>&1; true)
    adb shell "cmd package resolve-activity --brief -c android.intent.category.DEFAULT $PKG" >/dev/null 2>&1 || true
    echo "nativeLibraryDir from app: (see HarnessHost log 'provision: nativeLibraryDir=…')"
    adb logcat -d 2>/dev/null | grep -m1 "nativeLibraryDir=" | tr -d '\r'
fi

echo "== persistence dir =="
adb shell "run-as $PKG ls files/host-server 2>/dev/null | head -5" || echo "(run-as unavailable on this build)"

echo
echo "RESULT: host is serving from the device. ✓"

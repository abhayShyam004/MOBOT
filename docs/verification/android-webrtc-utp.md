# Real WebRTC and uTP on Android

torlnk reported `WebRTC and uTP native modules are not available on Android`,
because neither package in the torlnk → WebTorrent chain publishes an Android
prebuilt and the phone cannot compile one: Android denies `execve` of anything
in app data, so a lifecycle build step has nothing to run and npm installs with
`--ignore-scripts`. This closes that gap with two NDK-built addons shipped
inside the APK, placed where each library looks for them.

The rule this was built to: the warning is not turned off, the capability is
made real. torlnk decides by `require("node-datachannel")` and WebTorrent by
`Object.keys(utp).length > 0`; nothing here sets a flag, patches a library, or
stubs a transport. If the addons are absent — for any reason — both libraries
report exactly what they reported before.

## What the chain needs, exactly

| Package | Version | Native source | Addon path the loader uses |
| --- | --- | --- | --- |
| `node-datachannel` | 0.32.3 | libdatachannel v0.24.2 (+ libjuice, usrsctp, libsrtp, plog) | `<pkg>/build/Release/node_datachannel.node` — `dist/cjs/lib/node-datachannel.cjs` requires `../../../build/Release/node_datachannel.node` |
| `utp-native` | 2.5.3 | libutp (vendored) | `<pkg>/build/Release/utp_native.node` — `lib/binding.js` asks node-gyp-build, whose first candidate is `build/Release/*.node` |

Both are found through the package's own directory, so the placement needs no
JavaScript patching anywhere. The upper chain is `torlnk → webtorrent →
webrtc-polyfill 1.2.2 → node-datachannel`, and `webrtc-polyfill`'s module body
imports `{ PeerConnection, RtcpReceivingSession, Video, Audio, cleanup }` at
load time — which is why the addon is built with media and WebSocket support
rather than a smaller `NO_MEDIA` build.

## Build

```sh
node scripts/android-net/build-native-addons.mjs            # both addons, arm64-v8a
node scripts/android-net/build-native-addons.mjs --check    # the same gates, no build
```

- NDK 28.2.13676358, `ANDROID_PLATFORM=android-26`, `ANDROID_ABI=arm64-v8a`,
  `ANDROID_STL=c++_shared`, N-API 8, CMake Unix Makefiles.
- `-DANDROID_ALLOW_UNDEFINED_SYMBOLS=ON` is required, not cosmetic: a Node
  addon resolves `napi_*` and `uv_*` from the host process at `dlopen`, and the
  NDK toolchain otherwise appends `-Wl,--no-undefined` and refuses the link.
- OpenSSL: DTLS is mandatory for data channels, so the addon links the runtime's
  **own** `libssl_3.so`/`libcrypto_3.so` (OpenSSL 3.6.3, already in the process)
  and takes headers from the build host (3.5.5). `DT_NEEDED` is then
  `liblog libssl_3 libcrypto_3 libm libdl libc`, and the build refuses a header
  set newer than the library.
- Sources are pinned by sha256 (tarballs) and by commit (libdatachannel
  `4e4f4892dccb2a57fe3a490d0c9d958de4244e74`), verified before use.
- Artifacts are stripped (`llvm-strip --strip-unneeded`): the WebRTC addon is
  44.9 MB fresh out of the linker and 2.87 MB afterwards. `--check` re-verifies
  machine type, the N-API entry point, and the `DT_NEEDED` allowlist.
- Output: `.omb-scratch/webrtc/out/<abi>/{node_datachannel.node,utp_native.node,manifest.json}`
  (scratch, gitignored — the manifest carries the provenance for whatever
  bundle is built next).

## Ship, then place

`scripts/prepare-android-host.mjs` copies the built addons into the host bundle
as `native/<abi>/`, so they land on the phone in `files/host-server/native/…`
beside the server. `server/android-native-addons.ts` copies the right one into
each installed package's own `build/Release`:

- on every npx-shim invocation, for the prefix that invocation uses, so a
  package installed *before* this build gains its addon too;
- once at adapter startup, for the workspace prefix, the workspace
  `node_modules`, and every `_npx-shim` tree under both HOMEs.

The copy is gated on the ELF machine type, and writes through a temp file plus
rename, so a mismatch or an interruption cannot leave a half-copied addon for
`dlopen` to find.

## Regression checks

```sh
node scripts/android-net/build-native-addons.mjs --check
npx tsc -p tsconfig.server.json
npx oxlint --deny-warnings server/android-native-addons.ts \
  server/android-native-addons.test.ts server/android-npx-shim.ts server/android-computer.ts
npx vitest run --no-file-parallelism server/android-native-addons.test.ts \
  server/android-npx-shim.test.ts server/android-computer.test.ts server/android-exec-launcher.test.ts
```

The suite covers the placement itself (copy, idempotence, staleness, the ABI
gate, a non-ELF file, the prefix form the shim calls) and the loader contract —
that `dist/cjs/lib/node-datachannel.cjs`'s relative require and node-gyp-build's
first candidate both resolve the file that gets placed.

Device harnesses (they place nothing themselves; they drive the app's own path
and read the libraries' own answers):

```sh
bash scripts/android-net/device-verify.sh      --serial SN   # the two payloads
bash scripts/android-net/device-capability.sh  --serial SN   # shipping, placement, detection, network
```

## Recorded pass — 2026-10-06, SM-A075F (arm64-v8a, API 36)

Bundle `android/app/src/main/assets/host/server.zip` sha256
`871dbd818650f685131e1eaac0c0d9a727aed812be9ccc9e631d9f526c16eaa3`, byte for
byte the same file inside the installed APK. Debug APK
`app-arm64-v8a-debug.apk` 72,598,973 bytes.

- `device-verify.sh`: **5 passed, 0 failed**. node-datachannel loads from the
  package tree (24 exports, libdatachannel **0.24.2**), the polyfill's import
  set is present, `WEBRTC_SDP a:offer,b:answer`, `WEBRTC_CANDIDATES a=3 b=3`,
  and a real 1728-byte payload round-trips over a selected host candidate pair
  (ICE + DTLS + SCTP), with `bytesSent`/`bytesReceived` both 1728.
  utp-native: 96 KB moved both ways over real UDP sockets, orderly close, and
  the dead-port path still reports failure.
- `device-capability.sh`: **37 passed, 0 failed**, in five parts.
  1. the APK's bundle carries both addons;
  2. after deleting the addon files, the app's own `npx` path placed them again —
     hashes identical to the build output — and `torlnk --version` printed
     `torlink v1.9.0` with **no** `WebRTC peers unavailable` line;
  3. the libraries' own detection: torlnk's probe `loaded`, webrtc-polyfill
     1.2.2 imports, `RTCPeerConnection` is a function, WebTorrent sees
     `utp-native`'s two exports, `ConnPool.UTP_SUPPORT true`,
     `WebTorrent.WEBRTC_SUPPORT true`, `TORLINK_NO_*` flags: none — and a real
     seeder/leecher pair moved a 256 KB file over a **uTP** wire
     (`leech:utpOutgoing`, `seed:utpIncoming`, no TCP wire) with the payload
     hash matching;
  4. the same measurements with the addons hidden: probe throws
     `MODULE_NOT_FOUND`, polyfill throws, `RTCPeerConnection undefined`,
     `UTP_KEYS 0`, `UTP_SUPPORT false`, `WEBRTC_SUPPORT absent`, and torlnk's
     own CLI prints the `WebRTC peers unavailable` warning — so part 3 is a
     measurement, not a constant;
  5. the rest of the network with the addons in place: TCP listener/connection,
     a raw UDP round trip to `1.1.1.1:53` with the A record parsed, DNS over
     HTTPS (200, 509 ms), and bittorrent-dht bootstrapping over UDP (23
     routing-table nodes).
- Cost, measured on the phone: loading both addons 125 ms; RSS 38.7 MB → 48.0 MB;
  a full loopback ICE+DTLS+SCTP handshake 1064 ms. APK: +1,117,726 bytes for
  2,979,760 bytes of addons (2,871,328 + 108,432 raw; 1,068,620 + 45,191
  deflated inside the bundle).
- Repo checks: `tsc` clean, `oxlint` 0/0, 55 tests passed (1 skipped: the
  existing host-launcher placeholder), `./gradlew assembleDebug` successful,
  device install healthy at `127.0.0.1:18799`.

## Defects this pass found and fixed

- The addon linked with `-Wl,--no-undefined`, so every `napi_*` symbol was an
  error. Fixed with `ANDROID_ALLOW_UNDEFINED_SYMBOLS=ON` — the supported way to
  say "this shared library is a plugin".
- 44.9 MB of debug info per addon. Fixed by stripping in the build script.
- `DataChannel.sendMessage()` takes a string, `sendMessageBinary()` takes a
  Buffer; passing a Buffer throws `TypeError: String or Null expected`, which in
  a try/catch looks exactly like a dead transport. The first version of the
  functional payload failed this way.
- **WebTorrent resolves its default store path once at module load**:
  `TMP = path.join(fs.statSync('/tmp') && '/tmp', 'webtorrent')`. Android's
  `/tmp` exists and is not writable, so every piece read failed with
  `EACCES: permission denied, mkdir '/tmp/webtorrent'` — and `TMPDIR`, which the
  app sets for the bot terminal, cannot override it because the decision was
  already made. torlnk is unaffected because it passes `{ path: downloadDir }`
  on every `add()`; the device payload now does the same.
- The uTP payload deadlocked its own close: the server only ends its side after
  seeing the client's FIN, so neither side ever closed. Fixed by ending from the
  client once the payload is complete.
- `webrtc-polyfill` and `bittorrent-dht` are ESM with import-only `exports`
  maps, so `createRequire` resolution refuses them by design; the payloads
  import them by path.

## What this does not prove

- Only `arm64-v8a` is built. `armeabi-v7a` and `x86_64` APKs will report both
  capabilities as unavailable, which is the ABI gate working: a wrong-ABI addon
  is refused rather than loaded.
- WebRTC was proven with host candidates (LAN and loopback). A peer behind NAT,
  with STUN/TURN, was not exercised.
- WebTorrent's WebRTC *wire* needs a WebRTC-capable tracker to carry the
  signalling; the stack beneath it is proven end to end and
  `WebTorrent.WEBRTC_SUPPORT` is true, but no browser-to-phone torrent was run.
- Long-run CPU and battery for libdatachannel's event loop were not measured
  (the upstream issue torlnk's `TORLINK_NO_WEBRTC` exists for).
- Placement covers the trees the app knows about: the npx-shim trees under both
  HOMEs, the workspace prefix, and the workspace `node_modules`. A
  `node_modules` inside an arbitrary subdirectory, installed by a plain
  `npm install` that the adapter never scans, does not get an addon.

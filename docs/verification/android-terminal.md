# Interactive terminals on Android

A real terminal for the standalone Android app: a persistent PTY owned by the
app, shown on the app's own screen, driven by the bot through
`open_interactive` / `terminal_*`, and outliving the turn that opened it.

This is a device-verification record, not a `control-omb` recipe: the feature
lives in the Android app and its only control surface is the harness `adb`
already reaches on `127.0.0.1:18799`. Nothing here pairs to the user's desktop;
the phone is the fixture, and every program used is either the app's own
embedded runtime or a package the app installed itself.

## Build and install

```sh
pnpm build:server                              # compile the host bundle
node scripts/prepare-android-host.mjs          # prints the bundle sha256
node scripts/build-android-pty.mjs             # libombpty.so + libombexec.so, 3 ABIs
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell monkey -p com.openmausbot.companion -c android.intent.category.LAUNCHER 1
adb forward tcp:28799 tcp:18799 && curl -s http://127.0.0.1:28799/api/health
```

`libombpty.so` (JNI PTY) and `libombexec.so` (the generic native launcher) are
built by the NDK and land in `android/app/src/main/jniLibs/<abi>/`. The app
needs `jniLibs { useLegacyPackaging = true }` so the runtime is a real file in
`nativeLibraryDir` that can be executed.

## Regression checks

```sh
cd android
./gradlew :app:testDebugUnitTest --tests "com.openmausbot.companion.terminal.*" \
  --tests "com.openmausbot.companion.ui.TerminalPresentationTest"
cd ..
npx tsc -p tsconfig.server.json
npx oxlint --deny-warnings server/android-computer.ts server/android-seed.ts \
  server/system-prompt.ts server/index-android.ts
npx vitest run --no-file-parallelism server/android-computer.test.ts \
  server/android-seed.test.ts server/system-prompt.test.ts server/android-exec-launcher.test.ts
```

The Kotlin suites cover the PTY surface through a `FakePty` (hangup, signals,
partial writes, exit status), the stream/ring buffer and cursor semantics, the
screen renderer, the registry's refusals and limits, and what leaving and
returning mean. The TypeScript suites cover the harness client against a fake
driver implementing the same routes, plus a test that executes the real
`libombexec.so` and resolves `npx` from a direct call, from `sh -c`, and from a
`spawnSync` child.

## Manual checks on a device

1. Ask a bot to open something interactive (`open torlnk in a terminal`). The
   terminal must appear on screen by itself, with a state line saying
   `running`, and the bot must not claim a program is open unless a session
   confirmed it.
2. Type in the field and press Enter; the program's own output must appear.
   `adb shell input text "…"` and `adb shell input keyevent 66` inject the same
   events a soft keyboard delivers.
3. Leave with the back arrow. A chip named after the program appears; the
   program keeps running, and the bot's `terminal_read` still sees its output.
4. Open a second terminal: one chip per program, and the chip you were in is
   marked. Return to either one — same process, previous output intact.
5. Rotate the phone. The same session must still be on screen with its output,
   and its size must change (`cols×rows` in the header).
6. End a terminal from the surface. It asks first; after confirming, the
   program is gone from `ps`, and no orphan is left behind.
7. Force-stop the app: no `libnode_host.so` child and no downloaded package
   process may survive.

Read the screen through `uiautomator dump`, but dump to a **fresh, unique
path** each time and check that the dump reported success. Two traps found the
hard way: a failed dump leaves the previous `/sdcard/*.xml` in place and reports
the old screen as the current one, and uiautomator picks `"` or `'` as the
attribute delimiter, so a naive `text="([^"]*)"` match silently reports a
screen as empty. It also escapes `>` as `&gt;`, which hides a `>_` chip.

## Recorded pass — 2026-10-06, SM-A075F (arm64-v8a, API 36)

Bundle `android/app/src/main/assets/host/server.zip` sha256
`975e9db051b0d64ce84a35d2dc0f70990a0d37017aa7634ae4d6d85aea7cf78d`; the
`android-computer.js` and `android-npx-shim.js` the phone had extracted matched
the bundle's members byte for byte. Debug APK 71,481,247 bytes.

- Kotlin 43/43 (terminal 36, presentation 7). TypeScript 53 passed, 1 skipped —
  the skip is `cannot run: no host compiler built the launcher`, a placeholder
  that stays skipped precisely because the host launcher *did* build, so all
  six tests that execute the real `libombexec.so` ran. `tsc` clean, `oxlint` 0/0.
- `open_interactive` from a real bot turn started `npx --yes torlnk` in a real
  PTY; `ps` showed the shim → `torlnk/dist/cli.cjs` chain, and
  `/proc/<cli>/fd/{0,1,2} -> /dev/pts/1` with `tty_nr=34817` — a kernel
  controlling terminal, not a pipe.
- The surface rendered torlnk's own TUI: its ASCII banner, the sidebar, and
  `╭─ Search ─╮ │ ❯ hello │`, `Results (160)`. The bot typed `hello` with
  `terminal_write` and read the result with `terminal_read`, then reported
  exactly what the screen showed.
- Typing from the device worked in both a `sh -i` session
  (`echo human typing works` → `human typing works`) and a Node REPL
  (`12345+0` → `12345`), including the field clearing on Enter.
- Two terminals ran at once (`node` REPL and `sh -i`); leaving showed one chip
  per program; tapping the `node` chip returned to the same pid with its
  history.
- Rotation to landscape and back kept the same running session and re-pushed
  the size (55×22 → 118×14 with the keyboard down → 55×22).
- Ending the `sh` terminal from the surface asked first, then removed it: gone
  from the registry, gone from `ps`, the `node` terminal untouched, and the
  surface moved to it rather than going blank.
- `am force-stop` left nothing behind: the host, the REPL, the shim and torlnk
  were all gone within 2 seconds.
- `npx` resolves for every kind of caller on the phone: `./.omb-bin/npx …`
  exit 0, `sh -c 'npx …'` exit 0, `spawnSync("npx", …)` from node status 0 with
  `torlink v1.9.0`; `./.omb-bin/npm --version` → `10.9.7`; `./.omb-bin/node -e`
  → `v26.4.0`.

### Defects this pass found and fixed

- The screen could stay one chunk behind forever: the publish throttle had no
  trailing edge, so the last output before a program went quiet never reached
  the screen. Pinned by `the screen shows the newest output even when the
  program then goes quiet`.
- `CSI n G` and the relative cursor moves were ignored, so a prompt that
  repaints with `CSI 1 G` stacked as `> > > >` instead of one prompt. Pinned by
  `a repainting prompt lands back at the start of its line` and by a test built
  from the Node REPL's own bytes.
- The input field kept half-typed text when the surface switched terminals; the
  chip opened the first session in the registry rather than the one the person
  was in; and the close button killed a running program with a single tap. All
  three are fixed (per-session field, one chip per terminal with the active one
  marked, a confirmation before ending a running program), and `close()` logs
  which caller asked for it.

## What this does not prove

- Input was injected with `adb shell input`, not by a finger on the glass; the
  soft-keyboard path (IME suggestions, `ImeAction.Done`) was not separately
  driven.
- The key chips (esc/tab/`^C`/`^D`/arrows/backspace), the raw-keys toggle, and
  `ctrl-c` as a session control are covered by the sequence table's unit test
  and share the same write path as the device-verified Enter, but were not
  tapped on the device.
- Only `arm64-v8a` was installed. `armeabi-v7a` and `x86_64` are built but
  never run.
- A session does not survive an app process kill, by design: the PTYs are the
  app's children. Surviving the bot turn, leaving the surface, backgrounding
  the app and rotating are all proven; surviving a force-stop is not a goal.
- A heavy full-screen TUI that repaints continuously costs real work: torlnk
  emits roughly 50 KB/s while idle. The screen stays readable (it is the newest
  state, not a scrollback), but nothing here throttles the program's painting.

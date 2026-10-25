package com.openmausbot.companion.host

import android.os.Build
import android.util.Log
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import com.openmausbot.companion.terminal.TerminalDriverServer

/**
 * Supervises the embedded MOBOT host process.
 *
 * Owns the full loop: provision → spawn → wait for /api/health → supervise →
 * restart on crash (bounded, backoff) → stop on request. The host is
 * deliberately independent of any Activity: callers are the foreground
 * service and the Application, and the UI observes [status] like any other
 * client would observe a remote computer.
 *
 * Every step of that loop is logged with enough detail to diagnose a failure
 * from logcat alone: provisioning paths and stamp results, the exact spawn
 * command and environment, the child PID, decoded exit status (normal exit
 * code vs killed-by-signal), classified health-check attempts, and the final
 * failure reason with a bounded output tail. Nothing secret is ever logged:
 * the environment contains only paths and ports, and provider credentials
 * never enter this class.
 */
class HarnessHost(
    private val scope: CoroutineScope,
    private val files: Files,
    /** Fixed loopback port; the seeded self-pairing points here. */
    private val port: Int,
) {

    /**
     * What the supervisor needs from storage: the provisioned runtime plus
     * the directory contract the process environment is built from.
     */
    interface Files {
        suspend fun provision(): HostFiles.Provisioning
        fun dataDir(): File
        fun homeDir(): File
        fun tmpDir(): File
        /** Phase 7: per-bot browser session state root handed to the
         *  android_browser MCP server via AB_SESSIONS_ROOT. */
        fun browserSessionsDir(): File
        /** In-app updater: passing current Android app version to host environment. */
        fun appVersion(): String = "1.0.0"
        /** Device crash-injection point, preview builds only; null otherwise. */
        fun crashPoint(): String? = null
    }

    private val _status = MutableStateFlow<HostStatus>(HostStatus.Idle)
    val status: StateFlow<HostStatus> = _status.asStateFlow()

    private val _output = MutableStateFlow<List<String>>(emptyList())
    /** Bounded recent process output, for the diagnostics screen. */
    val output: StateFlow<List<String>> = _output.asStateFlow()

    private val processRef = AtomicReference<Process?>(null)
    /** Serialises writes to the integrity bridge (responses and the one-time key). */
    private val outputLock = Any()
    /** This process's accepted connection on the integrity bridge for the
     *  current host; -1 when no bridge is attached (adopted host, or a build
     *  without the launcher). Only the bridge reader and the frame writer
     *  touch it. */
    @Volatile private var bridgeFd: Int = -1
    /**
     * The pid the kernel proved when it accepted this spawn on the integrity
     * bridge (`SO_PEERCRED`). This is the whole host identity: no bearer token
     * exists to leak, and the connection cannot be reopened or transferred. A
     * responder is ours only while this fd is alive and `/api/health` names
     * this pid. -1 before the spawn's bridge (or after it dies) means nothing
     * on the port may be trusted.
     */
    @Volatile private var bridgePeerPid: Int = -1

    /** Frames from the host that are protocol, not log output. The leading
     *  record separator cannot appear at the start of a log line. */
    private val framePrefix = "\u001eOMBINT "
    @Volatile private var loggedFirstIntegrityFrame = false
    /** True when the separate-UID signer answered the handshake for this
     *  spawn; the MAC authority is then the signer's Keystore key, not this
     *  app UID's. */
    @Volatile private var signerActive = false
    private val generation = AtomicInteger(0)
    private val wantRunning = AtomicBoolean(false)
    private val restarts = AtomicInteger(0)
    private var superviseJob: Job? = null

    /** Steady-state health poll, in milliseconds. */
    var healthIntervalMs = 10_000L
    /** Consecutive failed health checks before a running host is torn down for restart. */
    var healthMissesAllowed = 5

    val boundPort: Int?
        get() = (_status.value as? HostStatus.Running)?.port

    val isReady: Boolean
        get() = _status.value is HostStatus.Running

    suspend fun awaitReady(timeoutMs: Long = 45_000L): Boolean {
        if (!wantRunning.get()) {
            start()
        }
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            when (_status.value) {
                is HostStatus.Running -> return true
                is HostStatus.Failed -> return false
                else -> delay(100)
            }
        }
        return _status.value is HostStatus.Running
    }

    suspend fun start() {
        if (wantRunning.get()) return
        wantRunning.set(true)
        restarts.set(0)
        generation.incrementAndGet()
        logI("— host start requested —")
        logI(
            "device: ABI=${Build.SUPPORTED_ABIS.joinToString(",")} api=${Build.VERSION.SDK_INT} " +
                "model=${Build.MODEL.take(40)}",
        )
        launchInner(initial = true, myGeneration = generation.get())
    }

    /** User-visible stop: no restarts afterwards until [start] again. */
    suspend fun stop() {
        wantRunning.set(false)
        generation.incrementAndGet()
        _status.value = HostStatus.Stopping
        // destroy() + timed waitFor() can block for up to 8s: off-main.
        withContext(Dispatchers.IO) { stopProcess(processRef.getAndSet(null)) }
        closeBridge()
        superviseJob?.cancel()
        _status.value = HostStatus.Idle
        logI("— host stopped —")
    }

    fun restart() {
        scope.launch {
            stop()
            start()
        }
    }

    private suspend fun launchInner(initial: Boolean, myGeneration: Int) {
        // ── 1. provisioning ─────────────────────────────────────────────
        _status.value = HostStatus.Extracting
        logI("provisioning: beginning (extract server bundle if stamp changed, verify native runtime)")
        val provisioning = try {
            withContext(Dispatchers.IO) { files.provision() }
        } catch (error: Throwable) {
            logE(
                "PROVISIONING FAILED: ${error.javaClass.simpleName}: ${error.message}",
            )
            error.stackTrace.take(6).forEach { logE("  at $it") }
            fail("local computer unavailable: ${error.message}")
            return
        }
        logI(
            "provisioning: OK — node=${provisioning.nodeBinary.absolutePath} " +
                "(${provisioning.nodeBinary.length()} bytes, canExecute=${provisioning.nodeBinary.canExecute()})",
        )
        logI("provisioning: server entry=${provisioning.serverEntry.absolutePath} " +
            "(${provisioning.serverEntry.length()} bytes)")
        // A token file from an earlier phase is a working credential for any
        // same-UID process; the identity no longer lives on disk at all.
        withContext(Dispatchers.IO) { HostIdentity.discardLegacyTokenFile(files.dataDir()) }

        // ── 2. port ownership ───────────────────────────────────────────
        // A healthy port is not an identity: the previous phase measured this
        // preview adopting the *official* app's host here, because the only
        // check was "does /api/health answer 200". Nothing about a fresh app
        // process can authenticate an HTTP responder — its own bridge does not
        // exist yet — so the port is never trusted before a spawn. An occupied
        // port is attributed only to reclaim our own leftover host (its bridge
        // died with the old app process, so it cannot serve memory); anything
        // else is a startup failure, never a fallback.
        when (val decision = awaitHostDecision(port, provisioning.serverEntry)) {
            HostProbe.Absent -> logI("host identity: nothing is listening on 127.0.0.1:$port — spawning")
            is HostProbe.OwnOrphan -> {
                logI(
                    "host identity: port $port is held by this installation's previous host (pid ${decision.pid}) — reclaiming it",
                )
                val freed = withContext(Dispatchers.IO) { HostIdentity.reclaim(decision.pid, port) }
                if (!freed) {
                    fail(
                        "the previous host (pid ${decision.pid}) did not release 127.0.0.1:$port; " +
                            "refusing to run two hosts on one port",
                    )
                    return
                }
                logI("host identity: port reclaimed — spawning a host that can hold the integrity bridge")
            }
            is HostProbe.Foreign -> {
                fail(
                    "another application is serving 127.0.0.1:$port (${decision.reason}); " +
                        "refusing to adopt it — memory integrity fails closed rather than trusting a foreign host",
                )
                return
            }
            is HostProbe.Unreachable -> {
                fail(
                    "127.0.0.1:$port answers but would not prove its identity (${decision.reason}); " +
                        "refusing to start a second host against an unknown listener",
                )
                return
            }
        }

        // ── 3. spawn ────────────────────────────────────────────────────
        val process = try {
            spawn(provisioning, port)
        } catch (error: Throwable) {
            logE("SPAWN FAILED: ${error.javaClass.simpleName}: ${error.message}")
            error.stackTrace.take(6).forEach { logE("  at $it") }
            fail("failed to start the embedded runtime: ${error.message}")
            return
        }
        processRef.set(process)
        _status.value = HostStatus.Starting(port)
        logI("process started: exe=${provisioning.nodeBinary.absolutePath}")
        logI("process started: args=[${provisioning.serverEntry.absolutePath}] " +
            "cwd=${files.homeDir().absolutePath}")
        val pid = pidOf(process)
        logI("process started: pid=$pid")

        superviseJob = scope.launch { supervise(process, port, myGeneration, initial) }
    }

    private suspend fun spawn(provisioning: HostFiles.Provisioning, port: Int): Process {
        // No secret is minted for this spawn: identity comes from the bridge
        // the kernel binds to the child's pid (see [bridgePeerPid]).
        // The canonical-memory MACs are computed by the Keystore key created
        // here; its bytes are not exportable and never enter the child. Only
        // the migration boot receives the retired key, so the old v1
        // manifests can be verified before being re-sealed.
        val integrityKey = runCatching { MemoryIntegrityKeyStore.prepare(files.dataDir()) }
            .onFailure {
                logE("memory integrity key unavailable: ${it.javaClass.simpleName}: ${it.message}")
                logE("memory will fail closed with ERR_MEMORY_INTEGRITY until the Keystore is usable")
            }
            .getOrNull()
        val migrationComplete = File(files.dataDir(), "memory-integrity/native-provider.json").isFile
        if (migrationComplete && MemoryIntegrityKeyStore.hasLegacyKey(files.dataDir())) {
            MemoryIntegrityKeyStore.retireLegacyKey(files.dataDir())
        }
        val legacyKey = if (!migrationComplete && MemoryIntegrityKeyStore.hasLegacyKey(files.dataDir())) {
            runCatching { MemoryIntegrityKeyStore.legacyKey(files.dataDir()) }
                .onFailure { logE("legacy memory key unreadable for migration: ${it.javaClass.simpleName}: ${it.message}") }
                .getOrNull()
        } else {
            null
        }
        // Ask the separate-UID signer before describing the spawn: an enrolled
        // signer changes which Keystore key seals new manifests (v3), so the
        // host must be told before it opens a store. Being bound is not enough
        // — only a process that presented the signer's enrollment challenge
        // holds the authority. Absent signer → the historical in-app authority
        // (v2), with its known same-UID limit.
        // Off the main thread: the signer delivers its enrollment challenge to
        // this app's broadcast receiver, which runs on the main thread. Waiting
        // here on the main thread (appScope is Dispatchers.Main.immediate)
        // meant the challenge could only be delivered after the wait expired —
        // measured on the Galaxy A07, enrollment landed ~40 ms after a 5 s wait
        // and ~46 ms after a 20 s wait, and the host spawned with
        // OMB_MEMORY_INTEGRITY_SIGNER=0. Yielding lets the broadcast run.
        signerActive = withContext(Dispatchers.IO) { MemorySignerClient.ready(5_000) }
        logI(
            if (signerActive) {
                "security: memory MACs will come from the separate-UID signer (Keystore key in another UID, this process enrolled)"
            } else {
                "security: no enrolled separate-UID signer — memory MACs stay in this app UID"
            },
        )
        val nativeDir = provisioning.nodeBinary.parentFile
        // Minimal, controlled environment. Nothing from this app's own
        // process environment is forwarded — bot processes must not see
        // application secrets or unrelated Android state. These are all
        // paths/ports; none of them is ever a credential.
        val nativePath = nativeDir?.absolutePath ?: ""
        // /data/data and /data/user/0 are the same directory through two
        // mount paths; the canonical user/0 spelling keeps env values, the
        // seeded MCP entry, and log lines referring to one stable path even
        // when the process is reached through the other spelling.
        val canonicalFiles = files.dataDir().parentFile
        val workspaceDir = File(canonicalFiles, "workspace")
        // The host is started through the packaged launcher, which clears the
        // process's dumpable flag before exec'ing the runtime. Without that
        // one kernel bit, any same-UID process — including a bot's own shell —
        // can inspect the host's process state. The launcher is the only place
        // that can set the bit for the process that replaces it; a build
        // without it must not pretend.
        val launcher = File(provisioning.nodeBinary.parentFile, "libombexec.so")
        val hardened = launcher.isFile && launcher.canExecute()
        // The MAC channel itself: an abstract Unix socket, freshly named for
        // every spawn — abstract because that namespace has no files for a
        // same-UID process to unlink or replace, and named per spawn because
        // a squatter then only denies a boot, never impersonates the
        // harness. The old channel was the host's stdio pipes, and same-UID
        // code reopened them through /proc to inject MAC requests and read
        // the responses — measured on the target device. open(2) on a
        // socket's /proc fd link answers ENXIO, so the kernel now refuses
        // what the protocol never could, and SO_PEERCRED on the accepted
        // connection proves who dialed in.
        var listenFd = -1
        var bridgeName: String? = null
        if (hardened) {
            val name = "omb-integrity-${android.os.Process.myPid()}-" +
                java.util.UUID.randomUUID().toString().replace("-", "").take(16)
            val created = runCatching { NativeIpc.listen(name) }.getOrElse { error ->
                logE("security: the integrity bridge listener could not be created: ${error.javaClass.simpleName}: ${error.message}")
                -1
            }
            if (created < 0) {
                if (created != -1) logE("security: the integrity bridge listener could not be created (-$created) — the host will fail closed")
            } else {
                listenFd = created
                bridgeName = name
            }
        }
        val anchorMarker = java.io.File(files.dataDir(), "memory-integrity/anchor/baseline.json")
        val anchorBaselineAllowed = !anchorMarker.exists()
        if (anchorBaselineAllowed) {
            logI("security: no rollback anchor baseline yet — this boot may establish the first one")
        }
        val env = LinkedHashMap(mapOf(
            "HOME" to files.homeDir().absolutePath,
            "TMPDIR" to files.tmpDir().absolutePath,
            "LANG" to "C.UTF-8",
            // The relocated Node binary carries OpenSSL's compiled-in config
            // path from its build prefix, which is unreadable inside this
            // app's sandbox; an empty config is the correct relocation story.
            "OPENSSL_CONF" to "/dev/null",
            "PATH" to listOf(nativePath, "/system/bin").joinToString(":"),
            // The Android linker does not search nativeLibraryDir on fresh
            // exec; every bundled library is found through this variable.
            "LD_LIBRARY_PATH" to nativePath,
            "OMB_PORT" to port.toString(),
            "OMB_WEBHOOK_PORT" to (port + 1).toString(),
            "OMB_DATA_DIR" to files.dataDir().absolutePath,
            // Phase 4: sandboxed workspace root for the android_computer
            // adapter (a path, never a credential). Not OMB_-prefixed: that
            // namespace is harness-reserved inside mcpServers entries.
            "AC_WORKSPACE" to workspaceDir.absolutePath,
            // The server is embedded; there is no web UI directory to serve.
            "OMB_STATIC_DIR" to "",
            // The host asks the Keystore for MACs over the PID-authenticated
            // abstract socket named below: the launcher dials in, verifies the
            // listener's kernel pid, and moves the connection onto fd 0 — the
            // descriptor it reports through OMB_MEMORY_INTEGRITY_FD. A host
            // without that channel fails closed instead of silently
            // downgrading to a file key.
            "OMB_MEMORY_INTEGRITY_NATIVE" to "1",
            "OMB_MEMORY_INTEGRITY_LEGACY" to if (legacyKey != null) "1" else "0",
            // The signing authority lives in a second application package with
            // its own UID, so this app's processes — including the bot's shell —
            // cannot use the Keystore alias. "1" means the host seals with that
            // authority (manifest v3) instead of this UID's key (v2). The old
            // alias stays reachable for the one migration boot that has to
            // verify v2 manifests before re-sealing them.
            "OMB_MEMORY_INTEGRITY_SIGNER" to if (signerActive) "1" else "0",
            // The one boot allowed to adopt a pre-authenticity store: the
            // retired key decrypted, so this is the migration boot. Tying the
            // permission to a key that is deleted at retirement (and whose
            // wrapping alias cannot be recreated with the old secret) keeps it
            // out of reach of same-UID code; the manifest and ledger it
            // replaces are files that code can delete.
            "OMB_MEMORY_INTEGRITY_ALLOW_LEGACY_UPGRADE" to if (legacyKey != null) "1" else "0",
            // The first boot after anchoring shipped, and only that one: a
            // store that was sealed before there was an anchor has to get its
            // first one, and no later boot could prove the manifest it sees is
            // the latest. The flag only authorizes the *request* — the signer
            // refuses a second baseline for a store it already tracks.
            "OMB_MEMORY_INTEGRITY_ALLOW_ANCHOR_BASELINE" to if (anchorBaselineAllowed) "1" else "0",
            // The host and the person's browser share this phone: provider
            // sign-ins that redirect to a loopback port (the Codex ChatGPT
            // OAuth flow) can complete right here instead of falling back to
            // a device code. Loopback-only — never set on a remote-access host.
            "OPENMAUSBOT_LOOPBACK_AUTH" to "1",
            // Phase 7: how the harness's android_browser MCP server reaches the
            // app-side WebView driver. A port and a per-boot capability token —
            // the token is not a user credential, it authorizes exactly this
            // child to drive this phone's browser sessions, on loopback only.
            "AB_DRIVER_PORT" to BrowserDriverServer.currentPort().toString(),
            "AB_DRIVER_TOKEN" to BrowserDriverServer.currentToken(),
            "AB_SESSIONS_ROOT" to files.browserSessionsDir().absolutePath,
            // The terminal driver (Phase 8): the app owns the PTYs, so the
            // harness reaches them through this loopback port and token — the
            // same handoff the browser driver gets, and the same rule: a port
            // and a per-boot capability token, never a user credential.
            "AT_DRIVER_PORT" to TerminalDriverServer.currentPort().toString(),
            "AT_DRIVER_TOKEN" to TerminalDriverServer.currentToken(),
            "APP_VERSION" to files.appVersion(),
            // The host-identity token is deliberately *not* here. A child's
            // `/proc/<pid>/environ` is readable by the agent PTY on this device
            // (measured), so an environment secret is a public secret. It is
            // written over the authenticated bridge instead, below.
        ))
        // Preview builds can be told to die at one commit transition by a
        // global setting, so the crash-recovery protocol is exercised on the
        // real writer instead of a fabricated state. Production builds return
        // null from Files.crashPoint() unconditionally.
        files.crashPoint()?.let { point ->
            env["OMB_MEMORY_CRASH_POINT"] = point
            logI("security: crash injection armed at '$point' (preview build only)")
        }
        if (bridgeName != null) {
            env["OMB_MEMORY_INTEGRITY_SOCK"] = bridgeName
            // Not a secret: the launcher compares it against the kernel's own
            // answer for the listener's pid, and nothing outside this spawn
            // can change the child's environment.
            env["OMB_HARNESS_PID"] = android.os.Process.myPid().toString()
        }

        val builder = if (hardened) {
            ProcessBuilder(launcher.absolutePath, provisioning.serverEntry.absolutePath)
        } else {
            logE(
                "security: libombexec.so is missing; the host cannot be made non-dumpable " +
                    "and the integrity bridge stays reachable from same-UID code",
            )
            ProcessBuilder(provisioning.nodeBinary.absolutePath, provisioning.serverEntry.absolutePath)
        }
        logI("security: host launcher ${if (hardened) "present — clearing the dumpable flag before exec" else "missing — host stays same-UID-readable"}")
        val spawnEnv = LinkedHashMap(env)
        if (hardened) {
            spawnEnv["OMB_EXEC_NODE"] = "1"
            spawnEnv["OMB_EXEC_NONDUMPABLE"] = "1"
        }
        builder.environment().clear()
        builder.environment().putAll(spawnEnv)
        builder.redirectErrorStream(true)
        // Values are paths, ports and provider flags. Capability tokens are
        // redacted: an `adb logcat` reader must not be able to drive the
        // phone's terminals or browser sessions with a value copied from here.
        logI("spawn: env summary (paths/ports; tokens redacted): " + spawnEnv.entries.joinToString(" ") {
            if (it.key.endsWith("_TOKEN")) "${it.key}=<redacted>" else "${it.key}=${it.value}"
        })
        val process = try {
            builder.start()
        } catch (error: Throwable) {
            // The spawn failed after the listener was created: close it here
            // or nothing ever will.
            if (listenFd >= 0) NativeIpc.close(listenFd)
            throw error
        }
        if (listenFd >= 0) {
            // The host dials in as itself. SO_PEERCRED is filled in by the
            // kernel at connect time and cannot be claimed or replayed, so
            // the connection whose pid is the process just spawned is the
            // host; anything else is closed and the accept loop keeps
            // waiting. Off-main, bounded — normally one poll right after the
            // fork returns the launcher's connect.
            // java.lang.Process#pid is hidden by the platform (measured on
            // the Galaxy A07: `hiddenapi: … Process->pid()J … api=blocked`,
            // so the pid is "unknown" on API 36). Pass -1 to mean "no exact
            // pid available": the accept loop then proves the same fact with
            // the kernel's own parent field instead of leaving the host
            // without a channel.
            val childPid = pidOf(process).toIntOrNull() ?: -1
            val accepted = withContext(Dispatchers.IO) { acceptHostBridge(listenFd, childPid) }
            NativeIpc.close(listenFd)
            if (accepted != null) {
                val marked = NativeIpc.setCloexec(accepted.fd)
                if (marked != 0) logE("security: integrity bridge end could not be marked close-on-exec ($marked)")
                val stale = bridgeFd
                bridgeFd = accepted.fd
                bridgePeerPid = accepted.pid
                if (stale >= 0 && stale != accepted.fd) NativeIpc.close(stale)
                val proof = if (childPid > 0) "pid + SO_PEERCRED" else "kernel parentage + SO_PEERCRED"
                logI("security: integrity bridge accepted — peer pid ${accepted.pid} authenticated by $proof; /proc cannot reopen it")
            } else {
                logE("security: the host never authenticated on the integrity bridge — memory integrity stays closed")
                val stale = bridgeFd
                bridgeFd = -1
                bridgePeerPid = -1
                if (stale >= 0) NativeIpc.close(stale)
            }
        } else {
            val stale = bridgeFd
            bridgeFd = -1
            bridgePeerPid = -1
            if (stale >= 0) NativeIpc.close(stale)
        }
        // On the migration boot only, the retired key rides the bridge once,
        // in the same frame protocol as the MAC requests — and, like them,
        // over a channel no other process can open. The bytes sit in the
        // socket until the host reads them; nothing touches the stdio pipes.
        if (legacyKey != null) {
            try {
                val fd = bridgeFd
                if (fd < 0) error("no integrity bridge is attached")
                synchronized(outputLock) {
                    val frame = org.json.JSONObject()
                        .put("id", 0)
                        .put("op", "legacy-key")
                        .put("key", java.util.Base64.getEncoder().encodeToString(legacyKey))
                    if (!NativeIpc.write(fd, "$framePrefix$frame\n".toByteArray(Charsets.UTF_8))) {
                        error("the host closed the bridge before the key was delivered")
                    }
                }
                logI("memory integrity: legacy key delivered once for the v1→Keystore migration")
            } catch (error: Throwable) {
                logE("legacy key delivery failed — memory integrity will fail closed: ${error.javaClass.simpleName}: ${error.message}")
            } finally {
                legacyKey.fill(0)
            }
        }
        logI(
            if (integrityKey != null) {
                "memory integrity: Keystore HMAC provider active (${MemoryIntegrityKeyStore.describeSecurityLevel()})" +
                    if (legacyKey != null) ", migration key delivered" else ""
            } else {
                "memory integrity: no Keystore key — reads and writes will fail closed"
            },
        )
        return process
    }

    /**
     * Accept until the connection belongs to the host we just spawned, or the
     * deadline passes. A wrong caller — same UID, no way to lie about its
     * pid — is closed and the loop continues: a squatter can stall a boot,
     * never borrow it.
     */
    private fun acceptHostBridge(listenFd: Int, childPid: Int): AcceptedBridge? {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            val got = NativeIpc.acceptPeer(listenFd, 1_000)
            val fd = got[0]
            // -EAGAIN: no connection yet; -EACCES: a caller outside this UID,
            // already closed by the native layer itself.
            if (fd < 0) continue
            val pid = got[1]
            val parent = if (childPid > 0) "" else describeParent(pid)
            if (if (childPid > 0) pid == childPid else parent == VERIFIED) return AcceptedBridge(fd, pid)
            logE(
                "security: integrity bridge connection from pid $pid (uid ${got[2]}) refused — " +
                    if (childPid > 0) "the host is pid $childPid" else parent,
            )
            NativeIpc.close(fd)
        }
        return null
    }

    /**
     * Ask the kernel whether [pid]'s parent is this app process.
     *
     * `/proc/<pid>/status` carries the PPid assigned at fork, and no process
     * can make itself a child of another — but reading another process's
     * `/proc` entry is itself gated (the app runs in `untrusted_app`, and this
     * returns whatever the platform says, including a denial). The answer is a
     * reason string: [VERIFIED], or the exact fact that prevented it, which is
     * what the refusal log prints. Anything short of [VERIFIED] leaves the
     * bridge closed rather than guessing.
     */
    private fun describeParent(pid: Int): String {
        if (pid <= 0) return "peer pid $pid is not a usable identity"
        return runCatching {
            val file = File("/proc/$pid/status")
            if (!file.exists()) return "no /proc/$pid/status entry for the caller"
            val line = file.useLines { lines -> lines.firstOrNull { it.startsWith("PPid:") } }
                ?: return "/proc/$pid/status has no PPid line"
            val ppid = line.substringAfter(':').trim().toIntOrNull()
                ?: return "unparsable PPid line '$line'"
            if (ppid == android.os.Process.myPid()) VERIFIED
            else "PPid=$ppid, but this app is pid ${android.os.Process.myPid()}"
        }.getOrElse { "cannot read /proc/$pid/status: ${it.javaClass.simpleName}: ${it.message}" }
    }

    /** A connection the kernel has tied to this spawn: descriptor plus peer pid. */
    private data class AcceptedBridge(val fd: Int, val pid: Int)

    private fun handleIntegrityFrame(line: String) {
        try {
            handleIntegrityFrameUnsafe(line)
        } catch (error: Throwable) {
            logE("memory integrity: frame failed: ${error.javaClass.simpleName}: ${error.message}")
        }
    }

    private fun handleIntegrityFrameUnsafe(line: String) {
        val json = runCatching { org.json.JSONObject(line.removePrefix(framePrefix)) }.getOrElse {
            logE("memory integrity: malformed frame from the host")
            return
        }
        val id = json.optInt("id", -1)
        when (json.optString("op")) {
            "mac" -> {
                if (!loggedFirstIntegrityFrame) {
                    loggedFirstIntegrityFrame = true
                    logI("memory integrity: first Keystore MAC request received from the host")
                }
                val purpose = json.optString("purpose")
                val payloads = json.optJSONArray("payloads")
                // Which authority signs this batch. v3 is the separate-UID
                // signer; v2 is this UID's Keystore alias, still reachable on
                // the one boot that verifies old manifests before re-sealing.
                val key = json.optString("key", if (signerActive) "v3" else "v2")
                val response = org.json.JSONObject().put("id", id)
                if ((purpose != "record" && purpose != "manifest") || payloads == null || payloads.length() > 512) {
                    response.put("error", "unsupported integrity request")
                } else {
                    val batch = (0 until payloads.length()).map { payloads.optString(it, "") }
                    var failure: String? = null
                    for (payload in batch) {
                        if (!validIntegrityPayload(purpose, payload)) {
                            failure = "payload is not a canonical $purpose"
                            break
                        }
                    }
                    val macs = org.json.JSONArray()
                    if (failure == null) {
                        when (key) {
                            "v3" -> runCatching { MemorySignerClient.mac(purpose, batch) }
                                .onSuccess { values -> values.forEach { macs.put(it) } }
                                .onFailure { error ->
                                    failure = "the separate-UID signer is unavailable: ${error.message}"
                                }
                            "v2" -> batch.forEach { macs.put(MemoryIntegrityKeyStore.mac(purpose, it)) }
                            else -> failure = "unknown MAC authority"
                        }
                    }
                    if (failure != null) {
                        response.put("error", failure)
                    } else {
                        response.put("macs", macs)
                        // One line per signer request, with the batch size: this
                        // is the count the integrity benchmark reports (v3 asked
                        // for one MAC per record; v4 asks for one manifest MAC).
                        logI("memory integrity: $key signed $purpose batch=${batch.size}")
                    }
                }
                writeIntegrityFrame(response)
            }
            "head", "prepare", "commit", "baseline" -> {
                handleAnchorFrame(json, id)
            }
            "migrated" -> {
                MemoryIntegrityKeyStore.retireLegacyKey(files.dataDir())
            }
            else -> logE("memory integrity: unknown frame op")
        }
    }

    /**
     * The rollback anchor, reached only from the host that opened this spawn's
     * socket.
     *
     * The signer owns the state; this process is a relay and validates shapes,
     * not authority. Every operation below requires the separate-UID signer to
     * be enrolled *and* to accept the request itself, so a host that somehow
     * forged a frame still could not move an anchor without the signer's
     * agreement.
     */
    private fun handleAnchorFrame(json: org.json.JSONObject, id: Int) {
        val response = org.json.JSONObject().put("id", id)
        val op = json.optString("op")
        val storeKey = json.optString("storeKey", "")
        if (json.optString("key", if (signerActive) "v3" else "v2") != "v3") {
            response.put("error", "the rollback anchor exists only under the separate-UID signer")
            writeIntegrityFrame(response)
            return
        }
        val failure = runCatching {
            when (op) {
                "head" -> response.put("head", MemorySignerClient.anchorHead(storeKey))
                "prepare" -> {
                    val payload = json.optString("payload", "")
                    if (!validIntegrityPayload("manifest", payload)) {
                        throw IllegalArgumentException("payload is not a canonical manifest")
                    }
                    response.put("mac", MemorySignerClient.prepareManifest(storeKey, payload))
                }
                "commit" -> {
                    val generation = json.optLong("generation", 0)
                    val digest = json.optString("digest", "")
                    if (generation < 1 || !Regex("^[0-9a-f]{64}$").matches(digest)) {
                        throw IllegalArgumentException("invalid generation or digest")
                    }
                    response.put("ok", MemorySignerClient.commitManifest(storeKey, generation, digest))
                }
                "baseline" -> {
                    val payload = json.optString("payload", "")
                    val mac = json.optString("mac", "")
                    if (!validIntegrityPayload("manifest", payload) || mac.isEmpty()) {
                        throw IllegalArgumentException("baseline needs a manifest and its MAC")
                    }
                    response.put("ok", MemorySignerClient.baselineManifest(storeKey, payload, mac))
                }
                else -> throw IllegalArgumentException("unknown anchor operation")
            }
        }
        failure.onFailure { error ->
            if (!response.has("error")) {
                response.put("error", "${error.javaClass.simpleName}: ${error.message}")
            }
        }
        writeIntegrityFrame(response)
    }

    /** Defence in depth: the bridge MACs canonical memory payloads, never
     * arbitrary bytes, even though only the host can reach it. */
    private fun validIntegrityPayload(purpose: String, payload: String): Boolean {
        val parsed = runCatching { org.json.JSONObject(payload) }.getOrNull() ?: return false
        val required = if (purpose == "record") {
            listOf(
                "id", "botId", "category", "headline", "detail", "confidence", "sourceTurnId",
                "createdAt", "lastReinforcedAt", "accessCount", "sha256Hash", "redacted",
            )
        } else {
            listOf("count", "digest", "macs", "seq", "version")
        }
        return required.all { parsed.has(it) }
    }

    private fun writeIntegrityFrame(frame: org.json.JSONObject) {
        val fd = bridgeFd
        if (fd < 0) {
            logE("memory integrity: no bridge attached — dropping the answer; the host fails closed")
            return
        }
        try {
            synchronized(outputLock) {
                if (!NativeIpc.write(fd, "$framePrefix$frame\n".toByteArray(Charsets.UTF_8))) {
                    logE("memory integrity: the bridge closed before the answer landed")
                }
            }
        } catch (error: Throwable) {
            logE("memory integrity: could not answer the host: ${error.javaClass.simpleName}")
        }
    }

    /**
     * The single reader of the integrity bridge: the host's MAC requests and
     * migration notices, and nothing else. Frames no longer share the host's
     * stdout — that stream is logs only from this boot on. The blocking read
     * runs on Dispatchers.IO; host death delivers EOF on the socket (the
     * other end closes), which is what ends the loop.
     */
    private suspend fun bridgeLoop() = withContext(Dispatchers.IO) {
        val fd = bridgeFd
        if (fd < 0) return@withContext
        logI("memory integrity: bridge reader attached (bridge fd $fd)")
        val buffer = ByteArray(64 * 1024)
        val pending = StringBuilder()
        while (true) {
            val got = NativeIpc.read(fd, buffer, buffer.size)
            if (got == 0) {
                logI("memory integrity: bridge closed by the host")
                return@withContext
            }
            if (got < 0) {
                logE("memory integrity: bridge read failed (-${-got})")
                return@withContext
            }
            pending.append(String(buffer, 0, got, Charsets.UTF_8))
            while (true) {
                val newline = pending.indexOf("\n")
                if (newline < 0) break
                val line = pending.substring(0, newline)
                pending.delete(0, newline + 1)
                if (line.startsWith(framePrefix)) handleIntegrityFrame(line)
            }
            if (pending.length > 4 * 1024 * 1024) {
                logE("memory integrity: bridge sent an oversized frame — detaching")
                return@withContext
            }
        }
    }

    private suspend fun supervise(process: Process, port: Int, myGeneration: Int, initial: Boolean) {
        val outputJob = scope.launch { drainOutput(process) }
        val bridgeJob = scope.launch(Dispatchers.IO) { bridgeLoop() }
        val exitFuture = CompletableFuture<Int>()
        // waitFor() is a native BLOCKING call: it must never run on the
        // caller's dispatcher. `scope` is Main.immediate, and a plain
        // `scope.launch { process.waitFor() }` pinned the main thread inside
        // UNIXProcess.waitFor for the host's whole lifetime — the ANR on both
        // physical devices ("App isn't responding" at launch, UI stuck on
        // Connecting). The drain and the health loop hop to Dispatchers.IO;
        // this waiter must do the same.
        val exitJob = scope.launch(Dispatchers.IO) {
            val code = runCatching { process.waitFor() }.getOrElse { -1 }
            exitFuture.complete(code)
        }

        try {
            // ── 4. startup health wait ───────────────────────────────
            // Cold-start wait: the desktop boots in ~7s; phones (especially
            // arm32) are slower, so the budget is generous but bounded.
            val budgetMs = if (initial) 120_000L else 45_000L
            logI("startup: health wait begins — budget ${budgetMs / 1000}s, target 127.0.0.1:$port/api/health")
            var healthy = false
            var waited = 0L
            var attempts = 0
            var lastFailure: HealthResult = HealthResult.ConnectionRefused
            while (waited < budgetMs && generation.get() == myGeneration) {
                if (exitFuture.isDone) {
                    logI("startup: process exited before becoming healthy — abandoning health wait")
                    break
                }
                attempts++
                val result = healthCheck(port)
                lastFailure = result
                if (result == HealthResult.Reachable) {
                    healthy = true
                    logI("health: OK (attempt $attempts, after ${waited / 1000}s) — server is serving 127.0.0.1:$port")
                    break
                }
                // Not every attempt is worth a line; the first few and every
                // tenth mark the pattern without drowning the log ring.
                if (attempts <= 3 || attempts % 10 == 0) {
                    logI("health: attempt $attempts failed: ${result.describe()}")
                }
                delay(500)
                waited += 500
            }
            if (generation.get() != myGeneration) return // superseded or stopped

            if (!healthy) {
                val exitCode = exitFuture.getNow(null)
                val reason = if (exitCode != null) {
                    "host exited during startup (exit status ${decodeExit(exitCode)}) before becoming healthy; " +
                        "last health failure: ${lastFailure.describe()}"
                } else {
                    "host did not become healthy within ${budgetMs / 1000}s " +
                        "($attempts attempts; last failure: ${lastFailure.describe()})"
                }
                stopProcess(process)
                handleExit(reason, exitCode)
                return
            }

            // ── 5. steady-state watchdog ─────────────────────────────
            restarts.set(0)
            _status.value = HostStatus.Running(port, System.currentTimeMillis())
            logI("host healthy at 127.0.0.1:$port — steady state")

            var misses = 0
            while (generation.get() == myGeneration && !exitFuture.isDone) {
                delay(healthIntervalMs)
                if (generation.get() != myGeneration) return
                val result = healthCheck(port)
                if (result == HealthResult.Reachable) {
                    misses = 0
                } else {
                    misses++
                    logI("health check failed ($misses/$healthMissesAllowed): ${result.describe()}")
                    if (misses >= healthMissesAllowed) {
                        logI("health watchdog tearing the host down for restart")
                        stopProcess(process)
                        break
                    }
                }
            }
            if (generation.get() != myGeneration) return

            val exitCode = runCatching { exitFuture.get(10, TimeUnit.SECONDS) }.getOrElse { -1 }
            handleExit("host exited (exit status ${decodeExit(exitCode)})", exitCode)
        } finally {
            outputJob.cancel()
            bridgeJob.cancel()
            exitJob.cancel()
        }
    }

    private suspend fun handleExit(reason: String, code: Int?) {
        processRef.set(null)
        // The bridge died with the host. Never let a restarted host inherit a
        // descriptor that points at a process that no longer exists.
        closeBridge()
        logE(reason)
        // Surface the captured output next to the exit reason in logcat:
        // this is the single most useful place to find the server's own
        // error message (bad ELF, linker failure, JS exception, …).
        _output.value.takeLast(50).forEach { logE("host-output| $it") }
        if (!wantRunning.get()) {
            _status.value = HostStatus.Idle
            return
        }
        val attempt = restarts.incrementAndGet()
        if (attempt > MAX_RESTARTS) {
            _status.value = HostStatus.Failed(
                reason = "host kept crashing: $reason ($MAX_RESTARTS restart attempts)",
                exitCode = code,
                outputTail = _output.value.takeLast(TAIL_LINES),
            )
            return
        }
        val backoff = RESTART_BACKOFF_MS[attempt - 1].toLong()
        logI("restarting in ${backoff / 1000}s (attempt $attempt/$MAX_RESTARTS)")
        _status.value = HostStatus.Idle
        delay(backoff)
        if (wantRunning.get()) {
            launchInner(initial = false, myGeneration = generation.get())
        }
    }

    /**
     * Decide what owns the port before spawning anything.
     *
     * One probe is not enough: a host that is still starting — or one this
     * process just asked to die — can refuse or time out for a second. Only
     * the inconclusive answer is retried; a foreign responder is final at once,
     * because no amount of waiting turns another package's host into ours.
     */
    private suspend fun awaitHostDecision(port: Int, serverEntry: File): HostProbe {
        // A freshly started app process has no bridge, so nothing on the port
        // can authenticate itself. An occupied port is attributed only to
        // reclaim it — never trusted — or refused.
        val occupied = withContext(Dispatchers.IO) { HostIdentity.listening(port) }
        if (!occupied) return HostProbe.Absent
        val pid = withContext(Dispatchers.IO) { HostIdentity.findOwnHost(serverEntry) }
        return if (pid != null) {
            HostProbe.OwnOrphan(pid)
        } else {
            HostProbe.Foreign("port $port is held by a listener this app process did not start")
        }
    }

    /** Close the bridge end that belonged to a host that is gone. */
    private fun closeBridge() {
        val stale = bridgeFd
        bridgeFd = -1
        bridgePeerPid = -1
        if (stale >= 0) runCatching { NativeIpc.close(stale) }
    }

    private fun fail(reason: String) {
        logE("HOST FAILED: $reason")
        _status.value = HostStatus.Failed(
            reason = reason,
            exitCode = null,
            outputTail = _output.value.takeLast(TAIL_LINES),
        )
        wantRunning.set(false)
    }

    private suspend fun drainOutput(process: Process) {
        withContext(Dispatchers.IO) {
            var first = true
            runCatching {
                process.inputStream.bufferedReader(Charsets.UTF_8).forEachLine { line ->
                    if (first) {
                        first = false
                        logI("runtime produced first output — the server bundle is executing")
                    }
                    appendOutput(line.take(MAX_LINE_CHARS))
                }
            }
            logI("runtime output stream closed")
        }
    }

    private fun stopProcess(process: Process?) {
        process ?: return
        runCatching {
            process.destroy()
            // Timed waits only — the unbounded waitFor() variant must never
            // run on main (see the exitJob fix in supervise()).
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                process.destroyForcibly()
                process.waitFor(3, TimeUnit.SECONDS)
            }
        }
        processRef.compareAndSet(process, null)
    }

    private fun decodeExit(status: Int): String {
        val signal = status and 0x7F
        val core = status and 0x80 != 0
        return when {
            signal != 0 -> "killed by signal $signal${if (core) ", core dumped" else ""}"
            else -> "exited normally with code ${status shr 8}"
        }
    }

    private fun pidOf(process: Process): String =
        runCatching {
            // java.lang.Process#pid exists on modern API levels; this stays
            // best-effort so diagnostics can never break the launch path.
            process.javaClass.getMethod("pid").invoke(process).toString()
        }.getOrElse {
            // The platform blocks that method for this targetSdk (`hiddenapi:
            // … Process->pid()J … api=blocked`, measured on the Galaxy A07),
            // so the reflective call above fails on device. `toString()` is
            // public API and the platform implementation prints its own pid
            // (`Process[pid=<n>, …]`, present in this build's core-oj dex), so
            // the same number is recovered without touching hidden methods.
            runCatching { Regex("\\bpid=(\\d+)").find(process.toString())?.groupValues?.get(1) }
                .getOrNull() ?: "unknown"
        }

    /**
     * Steady-state health, as an identity check.
     *
     * The watchdog used to accept any 200 that mentioned OpenMausBot, so a
     * different package's host taking the port mid-run looked healthy while
     * every memory operation failed behind it. Now the same token that decided
     * startup decides liveness.
     */
    private suspend fun healthCheck(port: Int): HealthResult = withContext(Dispatchers.IO) {
        // The bridge peer pid is kernel evidence, not a claim. Liveness is
        // "that same pid answers /api/health"; anything else is a foreign
        // listener, even if it knows every value this process knows.
        when (val health = HostIdentity.verify(port, bridgePeerPid)) {
            HostHealth.Absent -> HealthResult.ConnectionRefused
            is HostHealth.Answered -> HealthResult.Reachable
            is HostHealth.Rejected -> HealthResult.Error(health.reason)
            is HostHealth.Unreachable -> HealthResult.Error(health.reason)
        }
    }

    private fun appendOutput(line: String) {
        val next = _output.value + line
        _output.value = if (next.size > MAX_OUTPUT_LINES) next.takeLast(MAX_OUTPUT_LINES) else next
    }

    private fun logI(message: String) {
        Log.i(TAG, message)
        appendOutput(message)
    }

    private fun logE(message: String) {
        Log.e(TAG, message)
        appendOutput(message)
    }

    companion object {
        private const val TAG = "HarnessHost"
        private const val MAX_OUTPUT_LINES = 400
        private const val MAX_LINE_CHARS = 500
        /** [describeParent]'s only success value; every other answer is a reason. */
        private const val VERIFIED = "verified"
        private const val TAIL_LINES = 40
        private const val MAX_RESTARTS = 3
        private val RESTART_BACKOFF_MS = intArrayOf(2_000, 5_000, 10_000)
    }
}

/** Classified health-check outcome — refused, timeout, HTTP error are distinct facts. */
private sealed interface HealthResult {
    fun describe(): String

    data object Reachable : HealthResult {
        override fun describe() = "reachable"
    }

    data object ConnectionRefused : HealthResult {
        override fun describe() = "connection refused (nothing listening on the port yet)"
    }

    data object Timeout : HealthResult {
        override fun describe() = "connect/read timeout"
    }

    data class HttpError(val code: Int) : HealthResult {
        override fun describe() = "HTTP $code"
    }

    data class Error(val message: String) : HealthResult {
        override fun describe() = message
    }
}

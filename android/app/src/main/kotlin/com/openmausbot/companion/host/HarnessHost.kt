package com.openmausbot.companion.host

import android.os.Build
import android.util.Log
import java.io.File
import java.net.URI
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
    }

    private val _status = MutableStateFlow<HostStatus>(HostStatus.Idle)
    val status: StateFlow<HostStatus> = _status.asStateFlow()

    private val _output = MutableStateFlow<List<String>>(emptyList())
    /** Bounded recent process output, for the diagnostics screen. */
    val output: StateFlow<List<String>> = _output.asStateFlow()

    private val processRef = AtomicReference<Process?>(null)
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

        // ── 2. orphan adoption probe ────────────────────────────────────
        logI("pre-spawn probe: health-checking 127.0.0.1:$port for an orphan host from a previous run")
        val adopted = healthCheck(port)
        if (adopted != HealthResult.Reachable) {
            logI("pre-spawn probe: no orphan host (${adopted.describe()}) — spawning a fresh one")
        } else {
            logI("adopting healthy host already serving 127.0.0.1:$port")
            _status.value = HostStatus.Running(port, System.currentTimeMillis())
            superviseJob = scope.launch { superviseAdopted(port, myGeneration) }
            return
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

    private fun spawn(provisioning: HostFiles.Provisioning, port: Int): Process {
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
        val env = mapOf(
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
        )

        val builder = ProcessBuilder(
            provisioning.nodeBinary.absolutePath,
            provisioning.serverEntry.absolutePath,
        ).directory(files.homeDir())
        builder.environment().clear()
        builder.environment().putAll(env)
        builder.redirectErrorStream(true)
        logI("spawn: env summary (values are paths/ports only): " + env.entries.joinToString(" ") {
            "${it.key}=${it.value}"
        })
        return builder.start()
    }

    private suspend fun supervise(process: Process, port: Int, myGeneration: Int, initial: Boolean) {
        val outputJob = scope.launch { drainOutput(process) }
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
            exitJob.cancel()
        }
    }

    private suspend fun handleExit(reason: String, code: Int?) {
        processRef.set(null)
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

    /** Watchdog for a host this process did not spawn (adopted after a restart). */
    private suspend fun superviseAdopted(port: Int, myGeneration: Int) {
        while (generation.get() == myGeneration) {
            delay(healthIntervalMs)
            if (generation.get() != myGeneration) return
            if (healthCheck(port) == HealthResult.Reachable) continue
            logI("adopted host stopped answering health checks; relaunching")
            if (wantRunning.get()) {
                _status.value = HostStatus.Starting(port)
                launchInner(initial = false, myGeneration = generation.get())
            } else {
                _status.value = HostStatus.Idle
            }
            return
        }
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
        }.getOrElse { "unknown" }

    private suspend fun healthCheck(port: Int): HealthResult = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URI("http", null, "127.0.0.1", port, "/api/health", null, null)
                .toURL().openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 2_000
            connection.readTimeout = 2_000
            connection.requestMethod = "GET"
            val code = connection.responseCode
            val body = if (code in 200..299) {
                runCatching {
                    connection.inputStream.bufferedReader().use { it.readText() }
                }.getOrDefault("")
            } else ""
            connection.disconnect()
            if (code in 200..299 && body.contains("openmausbot")) {
                HealthResult.Reachable
            } else if (code in 200..299) {
                HealthResult.Error("Foreign service listening on port $port")
            } else {
                HealthResult.HttpError(code)
            }
        }.getOrElse { error ->
            when {
                error is java.net.ConnectException -> HealthResult.ConnectionRefused
                error is java.net.SocketTimeoutException -> HealthResult.Timeout
                else -> HealthResult.Error(error.javaClass.simpleName + ": " + (error.message ?: ""))
            }
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

package com.openmausbot.companion.terminal

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/** Everything needed to start a session. Paths and arguments only — the
 *  harness never sends this app a secret, and this app never stores one. */
data class TerminalSpec(
    val program: String,
    val args: List<String> = emptyList(),
    val env: Map<String, String> = emptyMap(),
    val cwd: String? = null,
    val rows: Int = 30,
    val cols: Int = 80,
    /** What a person calls this: "torlnk", "Node", … Shown on the screen and
     *  in the ongoing notification's title, never a command line. */
    val label: String = "",
    /** The command line as it would be typed (display only). */
    val command: String = "",
    val botId: String? = null,
)

class TerminalStartException(message: String) : IllegalStateException(message)

/**
 * Every terminal this app is hosting, app-scoped and deliberately process-wide.
 *
 * This object is the answer to "why does the program survive the turn": a
 * session is created here, not inside a tool call, not inside a Composable, and
 * not inside the harness process. The harness (a Node child), the chat screen,
 * the terminal surface and the Activity are all *clients* of this registry, and
 * any of them can go away without the session noticing.
 *
 * It also owns the one piece of cross-client intent: [openRequest]. A bot
 * starting a terminal is a reason to put the terminal in front of the person,
 * and the UI is the only layer that may decide how — so the registry says
 * "someone wants to see session X" and the UI decides.
 */
class TerminalSessions(
    private val pty: Pty = NativePty,
    private val homeDir: File,
    private val tmpDir: File,
    private val nativeLibraryDir: File,
    private val log: (String) -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val idFactory: () -> String = ::randomSessionId,
) {
    private val live = ConcurrentHashMap<String, TerminalSession>()

    private val _sessions = MutableStateFlow<List<TerminalSession>>(emptyList())
    /** Newest first — the order a person expects to find them in. */
    val sessions: StateFlow<List<TerminalSession>> = _sessions.asStateFlow()

    private val _openRequest = MutableStateFlow<String?>(null)
    /** A session someone asked to be shown. The UI consumes it. */
    val openRequest: StateFlow<String?> = _openRequest.asStateFlow()

    fun start(spec: TerminalSpec): TerminalSession {
        if (live.size >= MAX_SESSIONS) {
            throw TerminalStartException(
                "too many terminals are already open on this phone ($MAX_SESSIONS); close one first",
            )
        }
        val program = spec.program
        if (!program.startsWith("/")) {
            throw TerminalStartException("a terminal needs the absolute path of the program to run")
        }
        val file = File(program)
        if (!file.isFile) throw TerminalStartException("there is no such program on this phone: $program")
        if (!file.canExecute()) throw TerminalStartException("that program cannot be run on this phone: $program")
        requireAllowed(program)

        val requestedCwd = spec.cwd?.let { File(it) }?.takeIf { it.isDirectory }?.absolutePath
        val cwd = requestedCwd ?: homeDir.absolutePath
        val env = buildEnvironment(spec.env)
        val rows = spec.rows.coerceIn(TerminalSession.MIN_ROWS, TerminalSession.MAX_ROWS)
        val cols = spec.cols.coerceIn(TerminalSession.MIN_COLS, TerminalSession.MAX_COLS)
        val argv = listOf(program) + spec.args

        // Spawn first, name and register second: a session that failed to start
        // must not appear in the list, must not hold a slot, and must not burn
        // an id either.
        val handle = pty.spawn(program, argv, env, cwd, rows, cols)
        val id = idFactory()
        val session = TerminalSession(
            id = id,
            label = spec.label.ifBlank { File(program).name },
            command = spec.command.ifBlank { (listOf(program) + spec.args).joinToString(" ") },
            program = program,
            botId = spec.botId,
            startedAt = clock(),
            pty = pty,
            handle = handle,
            rows = rows,
            cols = cols,
            log = log,
        )
        live[id] = session
        session.start()
        publish()
        log("terminal $id: registered (${live.size} open)")
        return session
    }

    fun get(id: String): TerminalSession? = live[id]

    fun list(): List<TerminalSession> = live.values.sortedByDescending { it.startedAt }

    fun close(id: String, force: Boolean = false): TerminalSession? {
        val session = live.remove(id) ?: return null
        publish()
        session.close(force = force)
        log("terminal $id: removed (${live.size} open)")
        return session
    }

    /** Close everything. Used when the app is told to stop hosting the
     *  computer: no session outlives that, and no program is left orphaned. */
    fun closeAll() {
        for (id in live.keys.toList()) close(id)
    }

    fun requestOpen(id: String) {
        if (live.containsKey(id)) _openRequest.value = id
    }

    fun consumeOpenRequest() {
        _openRequest.value = null
    }

    private fun publish() {
        _sessions.value = list()
    }

    internal fun touch(session: TerminalSession) {
        publish()
    }

    /**
     * What a program must be for this app to run it under a terminal: a file
     * this app is genuinely allowed to execute. Nothing here escalates — it is
     * the opposite: the native library directory (where this APK's own runtime
     * lives) and the system's own binary directories. A name from the sandbox
     * is resolved by the harness to one of those before it ever gets here, so a
     * refusal is a refusal, not a silent fallback.
     */
    private fun requireAllowed(program: String) {
        val resolved = runCatching { File(program).canonicalPath }.getOrDefault(program)
        val roots = listOf(
            nativeLibraryDir.canonicalPath,
            "/system/bin",
            "/system/xbin",
            "/apex",
        )
        val allowed = roots.any { root -> resolved == root || resolved.startsWith("$root/") }
        if (!allowed) {
            throw TerminalStartException("this phone only runs its own runtime and system programs")
        }
    }

    /** The child's environment. TERM is not optional: without it a program
     *  decides it is talking to a dumb pipe no matter how real the PTY is. */
    private fun buildEnvironment(requested: Map<String, String>): List<String> {
        val environment = LinkedHashMap<String, String>()
        environment["HOME"] = homeDir.absolutePath
        environment["TMPDIR"] = tmpDir.absolutePath
        environment["PWD"] = homeDir.absolutePath
        environment["LANG"] = "C.UTF-8"
        environment["PATH"] = listOf(nativeLibraryDir.absolutePath, "/system/bin").joinToString(":")
        environment["LD_LIBRARY_PATH"] = nativeLibraryDir.absolutePath
        for ((key, value) in requested) {
            if (key.isBlank() || key.contains('=') || key.contains('\u0000')) continue
            if (value.contains('\u0000')) continue
            environment[key] = value
        }
        // Ours, and never overridable by the caller: this is what tells the
        // program it has a terminal, and what it may assume about it.
        environment["TERM"] = environment["TERM"]?.takeIf { it.isNotBlank() } ?: "xterm-256color"
        environment["COLORTERM"] = "truecolor"
        return environment.map { (key, value) -> "$key=$value" }
    }

    companion object {
        const val MAX_SESSIONS = 8

        /** Installed by [com.openmausbot.companion.OpenMausApp]; the UI and the
         *  driver both read it. Null before the Application is created (a JVM
         *  test, say), and every caller must handle that honestly. */
        @Volatile
        var instance: TerminalSessions? = null

        private val random = SecureRandom()

        private fun randomSessionId(): String {
            val bytes = ByteArray(5)
            random.nextBytes(bytes)
            return "t-" + bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

package com.openmausbot.companion.terminal

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What a session is doing, as it would be described to a person. */
data class TerminalState(
    val running: Boolean,
    /** Exit code when the program exited normally. */
    val exitCode: Int? = null,
    /** Signal number when the program was killed by a signal. */
    val signal: Int? = null,
    /** True once the terminal's resources are released and the session is gone. */
    val closed: Boolean = false,
    /** Set when the session failed in a way worth repeating verbatim. */
    val error: String? = null,
) {
    val exited: Boolean get() = !running
}

data class TerminalSize(val rows: Int, val cols: Int)

/**
 * One live PTY session: a program, its terminal, and the stream between them.
 *
 * Owned by [TerminalSessions] (app-scoped) rather than by a turn, an Activity
 * or a screen — which is the whole point. A bot's tool call starts a session and
 * returns; the turn ends; the Compose screen may be recomposed, navigated away
 * from, or destroyed and recreated by the system. None of that touches this
 * object, so the program keeps running and a later reader finds its output by
 * cursor.
 *
 * One thread pumps the master descriptor. It polls with a short timeout rather
 * than blocking in `read`, so the same thread can notice the child's exit and a
 * close() can never be left waiting on a read that will not return. The pump
 * ends on end-of-file (the child died and closed the last slave descriptor) or
 * when the descriptor is closed under it, whichever comes first.
 */
class TerminalSession internal constructor(
    val id: String,
    val label: String,
    /** The command line as a person would read it (display only). */
    val command: String,
    val program: String,
    val botId: String?,
    val startedAt: Long,
    private val pty: Pty,
    private val handle: PtyHandle,
    rows: Int,
    cols: Int,
    private val log: (String) -> Unit = {},
) {
    val pid: Int get() = handle.pid

    private val master: Int = handle.masterFd
    private val buffer = TerminalBuffer(OUTPUT_CAPACITY)
    private val fdClosed = AtomicBoolean(false)
    private val waitLock = Object()

    private val _state = MutableStateFlow(TerminalState(running = true))
    val state: StateFlow<TerminalState> = _state.asStateFlow()

    private val _size = MutableStateFlow(TerminalSize(rows, cols))
    val size: StateFlow<TerminalSize> = _size.asStateFlow()

    /** Rendered tail of the output, for the screen. Escape sequences consumed. */
    private val _screen = MutableStateFlow("")
    val screen: StateFlow<String> = _screen.asStateFlow()

    /** Bumped on every output chunk and on every state change: what a UI
     *  collects to know it should look again. */
    private val _revision = MutableStateFlow(0L)
    val revision: StateFlow<Long> = _revision.asStateFlow()

    /** Bytes produced so far — the cursor a reader passes back to [read]. */
    val cursor: Long get() = buffer.total

    private var lastPublishAt = 0L
    /** True when output arrived inside the publish window and has not reached
     *  the screen yet. Without this the last chunk before a program goes quiet
     *  would never be shown: a REPL's answer to the line you just typed would
     *  sit invisible behind its own prompt. */
    @Volatile private var screenDirty = false
    @Volatile private var pumpDone = false

    private val pump = Thread({ pumpLoop() }, "omb-terminal-$id").apply {
        isDaemon = true
    }

    internal fun start() {
        log("session $id: started pid=$pid fd=$master ${size.value.cols}x${size.value.rows} command=$command")
        pump.start()
    }

    // ── input ───────────────────────────────────────────────────────────────

    /** Raw bytes to the program. Blocks only as long as a terminal write does. */
    fun write(bytes: ByteArray): Int {
        if (bytes.isEmpty()) return 0
        var offset = 0
        var guard = 0
        while (offset < bytes.size) {
            val wrote = pty.write(master, bytes, offset, bytes.size - offset)
            if (wrote <= 0) {
                throw IllegalStateException(
                    "the terminal closed before the input was delivered (errno ${-wrote})",
                )
            }
            offset += wrote
            if (++guard > 4096) throw IllegalStateException("terminal write did not make progress")
        }
        return bytes.size
    }

    /** Text as a terminal receives it (newlines become CR). */
    fun writeText(text: String, enter: Boolean = false) {
        val payload = TerminalText.toTerminalInput(text) + if (enter) "\r" else ""
        if (payload.isNotEmpty()) write(payload.toByteArray(Charsets.UTF_8))
    }

    /** Named keys from [TerminalText]'s table; unknown names are refused. */
    fun sendKeys(keys: List<String>) {
        for (key in keys) {
            val sequence = TerminalText.keySequence(key)
                ?: throw IllegalArgumentException("unknown key: $key")
            write(sequence.toByteArray(Charsets.ISO_8859_1))
        }
    }

    /** The program interrupted from outside: the same byte Ctrl-C sends. */
    fun interrupt() = write(byteArrayOf(0x03))

    // ── output ──────────────────────────────────────────────────────────────

    /**
     * Output produced after [cursor], up to [maxBytes], with the cursor to use
     * next. [waited] is true when new output arrived rather than the wait
     * timing out — a reader can tell "nothing yet" from "here it is".
     */
    fun read(cursor: Long, maxBytes: Int = READ_LIMIT, waitMs: Long = 0): TerminalRead {
        if (waitMs > 0 && buffer.total <= cursor) {
            waitForOutput(cursor, waitMs)
        }
        val (bytes, next) = buffer.since(cursor, maxBytes)
        val missed = cursor < buffer.oldest && cursor < buffer.total
        return TerminalRead(
            text = String(bytes, Charsets.UTF_8),
            bytes = bytes.size,
            cursor = next,
            total = buffer.total,
            missed = missed,
            waited = next > cursor,
            state = _state.value,
        )
    }

    /** Blocks until output arrives past [cursor], the session ends, or the
     *  deadline passes. This is what keeps a bot from polling in a loop. */
    private fun waitForOutput(cursor: Long, waitMs: Long) {
        val deadline = System.currentTimeMillis() + waitMs
        synchronized(waitLock) {
            while (buffer.total <= cursor && _state.value.running) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) return
                waitLock.wait(minOf(remaining, 250L))
            }
        }
    }

    /** Wait for the program to exit, up to [timeoutMs]. */
    fun awaitExit(timeoutMs: Long): TerminalState {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val state = refreshState()
            if (!state.running) return state
            Thread.sleep(25)
        }
        return refreshState()
    }

    /** The program's terminal is really a terminal, as the kernel sees it. */
    fun isTerminal(): Boolean = runCatching { pty.isTerminal(master) }.getOrDefault(false)

    /** The size the kernel has, which is what a program's ioctl reads. */
    fun kernelSize(): TerminalSize? = runCatching {
        pty.windowSize(master)?.let { TerminalSize(it[0], it[1]) }
    }.getOrNull()

    fun resize(rows: Int, cols: Int): TerminalSize {
        val next = TerminalSize(rows.coerceIn(MIN_ROWS, MAX_ROWS), cols.coerceIn(MIN_COLS, MAX_COLS))
        val result = pty.resize(master, next.rows, next.cols)
        if (result != 0) throw IllegalStateException("resizing the terminal failed (errno ${-result})")
        _size.value = next
        bump()
        return next
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    /**
     * Close the session: hang the program up, then make sure it is gone.
     *
     * SIGHUP first and SIGKILL only if the program ignores it, because a program
     * that wants to flush state on the way out deserves the chance (a TUI
     * restores the screen; a REPL writes history). Closing the master descriptor
     * afterwards is what unblocks the pump, so the thread can never be stuck.
     */
    fun close(force: Boolean = false) {
        if (_state.value.closed) return
        log("session $id: closing (pid=$pid force=$force) from ${caller()}")
        if (!force) pty.signal(pid, SIGHUP, group = true)
        var state = awaitExit(if (force) 250 else HANGUP_GRACE_MS)
        if (state.running) {
            log("session $id: did not exit on hangup; sending SIGKILL")
            pty.signal(pid, SIGKILL, group = true)
            state = awaitExit(KILL_GRACE_MS)
        }
        releaseDescriptor()
        pump.join(PUMP_JOIN_MS)
        if (pump.isAlive) log("session $id: pump thread did not finish within ${PUMP_JOIN_MS}ms")
        val final = if (_state.value.running) refreshState() else _state.value
        _state.value = final.copy(closed = true)
        publishScreen(force = true)
        bump()
        log("session $id: closed — exit=${final.exitCode} signal=${final.signal} running=${final.running}")
    }

    /**
     * Who asked for the close, for the log.
     *
     * Closing a terminal is the one irreversible thing this app does to a
     * running program, and "someone called close" is not enough to act on when
     * a session a person expected to still be there is gone: the thread name
     * separates the surface's button from the bot's terminal_close from an app
     * shutdown, and the first frame outside this class names the exact path.
     */
    private fun caller(): String {
        val thread = Thread.currentThread().name
        val frame = Throwable().stackTrace.firstOrNull { it.className != javaClass.name }
        return if (frame == null) thread else "$thread ${frame.className.substringAfterLast('.')}.${frame.methodName}:${frame.lineNumber}"
    }

    /** Called by the pump when the program is gone: the descriptor has nothing
     *  left to say, so release it without touching the program. */
    private fun releaseDescriptor() {
        if (!fdClosed.compareAndSet(false, true)) return
        pty.closeFd(master)
    }

    private fun pumpLoop() {
        val chunk = ByteArray(READ_CHUNK)
        try {
            while (true) {
                val ready = runCatching { pty.pollIn(master, POLL_TIMEOUT_MS) }.getOrDefault(2)
                if (ready == 1) {
                    val got = runCatching { pty.read(master, chunk, chunk.size) }.getOrDefault(-EIO)
                    if (got > 0) {
                        buffer.append(chunk, got)
                        publishScreen()
                        notifyOutput()
                    } else if (got == 0 || got == -EIO || got == -EBADF) {
                        log("session $id: output stream ended (${if (got == 0) "eof" else "errno ${-got}"})")
                        break
                    } else {
                        log("session $id: read failed (errno ${-got})")
                        Thread.sleep(20)
                    }
                } else                    if (ready == 2) {
                    log("session $id: the program's terminal was released")
                    break
                }
                // Trailing edge: anything the throttle held back is published on
                // the next turn of this loop (a poll timeout is 200 ms, well
                // past the 80 ms window), so what is on screen is always what
                // the program last wrote — not one chunk behind it.
                if (screenDirty) publishScreen()
                if (!_state.value.running) break
            }
        } catch (error: Throwable) {
            log("session $id: pump stopped: ${error.javaClass.simpleName}: ${error.message}")
        } finally {
            settleExit()
            releaseDescriptor()
            publishScreen(force = true)
            notifyOutput()
            pumpDone = true
            bump()
        }
    }

    /**
     * The stream can end a moment before the process does (a program may close
     * its terminal and keep working). Nothing polls on its own after that, so
     * the pump stays for a bounded while and records the real exit instead of
     * leaving the session claiming to be running forever.
     */
    private fun settleExit() {
        val deadline = System.currentTimeMillis() + EXIT_SETTLE_MS
        while (_state.value.running && System.currentTimeMillis() < deadline) {
            if (!refreshState().running) return
            Thread.sleep(100)
        }
    }

    /**
     * Read the child's exit status without ever blocking on it. `wait` with
     * WNOHANG also reaps, so an exited program leaves no zombie behind a
     * session nobody has closed yet.
     */
    internal fun refreshState(): TerminalState {
        val current = _state.value
        if (!current.running) return current
        val result = runCatching { pty.wait(pid, noHang = true) }.getOrNull() ?: return current
        val state = when (result[0]) {
            WAIT_EXITED -> TerminalState(running = false, exitCode = result[1], closed = current.closed)
            WAIT_SIGNALED -> TerminalState(running = false, signal = result[1], closed = current.closed)
            else -> return current
        }
        _state.value = state
        bump()
        return state
    }

    private fun notifyOutput() {
        synchronized(waitLock) { waitLock.notifyAll() }
    }

    /**
     * The screen is the newest part of the stream, rendered. Publishing is
     * throttled because a TUI can emit output far faster than a phone can
     * recompose a text section, and the screen only needs the newest state.
     */
    private fun publishScreen(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastPublishAt < SCREEN_REFRESH_MS) {
            screenDirty = true
            return
        }
        lastPublishAt = now
        screenDirty = false
        val bytes = buffer.tail(SCREEN_TAIL_BYTES)
        val rendered = TerminalText.render(bytes)
        _screen.value = if (rendered.length > SCREEN_CHARS) {
            val start = rendered.length - SCREEN_CHARS
            // Prefer a line boundary so a truncated first line does not begin
            // with the tail of an escape sequence's payload.
            val lineStart = rendered.indexOf('\n', start)
            "…\n" + (if (lineStart in start until rendered.length) rendered.substring(lineStart + 1) else rendered.substring(start))
        } else {
            rendered
        }
    }

    private fun bump() {
        _revision.value = _revision.value + 1
    }

    internal val isPumpDone: Boolean get() = pumpDone

    internal companion object {
        const val OUTPUT_CAPACITY = 256 * 1024
        private const val READ_CHUNK = 32 * 1024
        private const val READ_LIMIT = 128 * 1024
        private const val POLL_TIMEOUT_MS = 200
        private const val SCREEN_TAIL_BYTES = 64 * 1024
        private const val SCREEN_CHARS = 48 * 1024
        private const val SCREEN_REFRESH_MS = 80L
        private const val HANGUP_GRACE_MS = 2_000L
        private const val KILL_GRACE_MS = 1_500L
        private const val PUMP_JOIN_MS = 2_000L
        private const val EXIT_SETTLE_MS = 60_000L
        const val MIN_ROWS = 2
        const val MAX_ROWS = 400
        const val MIN_COLS = 20
        const val MAX_COLS = 500

        /** Signal numbers, spelled out rather than imported: they are the
         *  kernel's ABI, not an Android API level, and the session logic has no
         *  business depending on android.system to name them. */
        private const val SIGHUP = 1
        private const val SIGKILL = 9
        private const val EIO = 5
        private const val EBADF = 9
        private const val WAIT_EXITED = 1
        private const val WAIT_SIGNALED = 2
    }
}

/** One read of a session's stream. */
data class TerminalRead(
    val text: String,
    val bytes: Int,
    /** Cursor to pass to the next read. */
    val cursor: Long,
    /** Total bytes ever produced by the session. */
    val total: Long,
    /** True when the reader fell behind further than the buffer retains. */
    val missed: Boolean,
    /** True when this read returned new output rather than timing out. */
    val waited: Boolean,
    val state: TerminalState,
)

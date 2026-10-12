package com.openmausbot.companion.terminal

import java.util.concurrent.ConcurrentLinkedQueue

/**
 * A PTY with no kernel behind it, for testing the parts that are Kotlin.
 *
 * It is a real enough stand-in to exercise every branch the session logic has:
 * it queues output, it hangs up (POLLHUP) when the program ends, it answers
 * wait() the way waitpid(2) does, and it can be a program that ignores SIGHUP —
 * which is the interesting case for close(), because it is the one that forces
 * SIGKILL.
 */
class FakePty : Pty {
    val writes = ConcurrentLinkedQueue<ByteArray>()
    val resizes = ConcurrentLinkedQueue<Pair<Int, Int>>()
    val signals = ConcurrentLinkedQueue<Pair<Int, Boolean>>()
    val closedFds = ConcurrentLinkedQueue<Int>()

    /** Thrown by [spawn] when set, so a test can drive the failure path. */
    var spawnFailure: Exception? = null
    /** A program that ignores the hangup: only SIGKILL ends it. */
    var ignoresHangup = false
    /** Set by [exit]: wait() reports this exit status. */
    @Volatile private var exited = false
    @Volatile private var exitCode: Int? = null
    @Volatile private var signal: Int? = null
    @Volatile var lastProgram: String? = null
    @Volatile var lastArgv: List<String> = emptyList()
    @Volatile var lastEnv: List<String> = emptyList()
    @Volatile var lastCwd: String = ""
    @Volatile var lastSpawnRows: Int = 0
    @Volatile var lastSpawnCols: Int = 0
    private var nextFd = 40
    private var nextPid = 9000

    private val output = ConcurrentLinkedQueue<ByteArray>()

    /** The program prints [text]. */
    fun feed(text: String) = feed(text.toByteArray(Charsets.UTF_8))

    fun feed(bytes: ByteArray) {
        output.add(bytes)
    }

    /** The program exits. */
    fun exit(code: Int = 0) {
        exited = true
        exitCode = code
        signal = null
    }

    /** The program is killed by a signal. */
    fun killedBy(sig: Int) {
        exited = true
        exitCode = null
        signal = sig
    }

    /** Everything the session has written to the program, decoded. */
    fun writtenText(): String {
        val out = StringBuilder()
        for (chunk in writes) out.append(String(chunk, Charsets.ISO_8859_1))
        return out.toString()
    }

    override fun spawn(
        program: String,
        argv: List<String>,
        env: List<String>,
        cwd: String,
        rows: Int,
        cols: Int,
    ): PtyHandle {
        spawnFailure?.let { throw it }
        lastProgram = program
        lastArgv = argv
        lastEnv = env
        lastCwd = cwd
        lastSpawnRows = rows
        lastSpawnCols = cols
        return PtyHandle(masterFd = nextFd++, pid = nextPid++)
    }

    override fun pollIn(fd: Int, timeoutMs: Int): Int {
        if (output.isNotEmpty()) return 1
        if (exited) return 2
        Thread.sleep(minOf(timeoutMs.toLong(), 5L))
        return 0
    }

    override fun read(fd: Int, buffer: ByteArray, length: Int): Int {
        val chunk = output.poll() ?: return -5 // EIO: the last slave descriptor closed
        val take = minOf(chunk.size, length)
        System.arraycopy(chunk, 0, buffer, 0, take)
        if (take < chunk.size) output.add(chunk.copyOfRange(take, chunk.size))
        return take
    }

    override fun write(fd: Int, bytes: ByteArray, offset: Int, length: Int): Int {
        writes.add(bytes.copyOfRange(offset, offset + length))
        return length
    }

    override fun resize(fd: Int, rows: Int, cols: Int): Int {
        resizes.add(rows to cols)
        return 0
    }

    override fun windowSize(fd: Int): IntArray? = intArrayOf(24, 80)

    override fun wait(pid: Int, noHang: Boolean): IntArray? = when {
        !exited -> intArrayOf(0, 0)
        signal != null -> intArrayOf(2, signal!!)
        else -> intArrayOf(1, exitCode ?: 0)
    }

    override fun signal(pid: Int, signal: Int, group: Boolean): Int {
        signals.add(signal to group)
        if (signal == 9) {
            killedBy(9)
            return 0
        }
        if (!ignoresHangup) killedBy(signal)
        return 0
    }

    override fun closeFd(fd: Int): Int {
        closedFds.add(fd)
        return 0
    }

    override fun isTerminal(fd: Int): Boolean = true
}

/** Poll a condition from a test thread, without depending on coroutines. */
fun awaitUntil(timeoutMs: Long = 5_000, what: String = "condition", condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
        if (condition()) return
        Thread.sleep(10)
    }
    error("timed out after ${timeoutMs}ms waiting for $what")
}

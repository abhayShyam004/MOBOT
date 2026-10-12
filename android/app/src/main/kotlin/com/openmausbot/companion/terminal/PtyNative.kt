package com.openmausbot.companion.terminal

/**
 * The one native dependency of the terminal: a pseudo-terminal.
 *
 * `android.system.Os` stops exactly one syscall short of a terminal —
 * `openpty(3)`/`forkpty(3)` do not exist in the Java surface, there is no
 * `fork()`, and `java.lang.Process` can only hand a child pipes. `ombpty.c`
 * supplies precisely that gap and nothing more; every decision above it (ids,
 * buffers, state, which session is on screen) is Kotlin.
 *
 * Interposed as an interface so the session/registry logic — the part with the
 * interesting failure modes — is unit-testable on the JVM without a device and
 * without the NDK.
 */
interface Pty {
    /** openpty + fork + exec. Returns the master descriptor and the child pid.
     *  Throws [java.io.IOException] when the program could not be started. */
    fun spawn(
        program: String,
        argv: List<String>,
        env: List<String>,
        cwd: String,
        rows: Int,
        cols: Int,
    ): PtyHandle

    /** 1 = readable, 2 = hangup/closed, 0 = timeout, <0 = -errno. */
    fun pollIn(fd: Int, timeoutMs: Int): Int

    /** >0 bytes, 0 = end of file, <0 = -errno (EIO = last slave closed). */
    fun read(fd: Int, buffer: ByteArray, length: Int): Int

    /** Bytes written, or <0 = -errno. A short write is normal. */
    fun write(fd: Int, bytes: ByteArray, offset: Int, length: Int): Int

    fun resize(fd: Int, rows: Int, cols: Int): Int

    /** { rows, cols } as the *kernel* has them, or null. */
    fun windowSize(fd: Int): IntArray?

    /** { state, code }: 0 running, 1 exited, 2 signalled. Reaps the child. */
    fun wait(pid: Int, noHang: Boolean): IntArray?

    fun signal(pid: Int, signal: Int, group: Boolean): Int

    fun closeFd(fd: Int): Int

    fun isTerminal(fd: Int): Boolean
}

data class PtyHandle(val masterFd: Int, val pid: Int)

/**
 * The JNI implementation. The library is small (a few KB) and is loaded once,
 * on first use, so a device whose ABI this build does not ship degrades to an
 * honest "no terminal driver" answer instead of a crash at application start.
 *
 * The C symbols are named after THIS object and these methods —
 * `Java_com_openmausbot_companion_terminal_NativePty_nativeSpawn`, and so on.
 * A mismatch is not a compile error on either side; it is an
 * UnsatisfiedLinkError on the phone, at the first call, which is exactly the
 * kind of failure that costs a device round trip. [PtyJniContractTest] exists
 * to catch it on the JVM instead.
 */
internal object NativePty : Pty {

    /** Loaded lazily: a JVM unit test that uses [FakePty] must never need it. */
    private val loaded: Result<Unit> by lazy {
        runCatching { System.loadLibrary("ombpty") }
    }

    private fun requireLoaded() {
        loaded.getOrElse { error ->
            throw IllegalStateException(
                "the terminal driver is not available on this device " +
                    "(native library failed to load: ${error.message})",
                error,
            )
        }
    }

    override fun spawn(
        program: String,
        argv: List<String>,
        env: List<String>,
        cwd: String,
        rows: Int,
        cols: Int,
    ): PtyHandle {
        requireLoaded()
        val handle = nativeSpawn(program, argv.toTypedArray(), env.toTypedArray(), cwd, rows, cols)
        return PtyHandle(masterFd = handle[0], pid = handle[1])
    }

    override fun pollIn(fd: Int, timeoutMs: Int): Int {
        requireLoaded()
        return nativePollIn(fd, timeoutMs)
    }

    override fun read(fd: Int, buffer: ByteArray, length: Int): Int {
        requireLoaded()
        return nativeRead(fd, buffer, length)
    }

    override fun write(fd: Int, bytes: ByteArray, offset: Int, length: Int): Int {
        requireLoaded()
        return nativeWrite(fd, bytes, offset, length)
    }

    override fun resize(fd: Int, rows: Int, cols: Int): Int {
        requireLoaded()
        return nativeResize(fd, rows, cols)
    }

    override fun windowSize(fd: Int): IntArray? {
        requireLoaded()
        return nativeWindowSize(fd)
    }

    override fun wait(pid: Int, noHang: Boolean): IntArray? {
        requireLoaded()
        return nativeWait(pid, noHang)
    }

    override fun signal(pid: Int, signal: Int, group: Boolean): Int {
        requireLoaded()
        return nativeSignal(pid, signal, group)
    }

    override fun closeFd(fd: Int): Int {
        if (loaded.isFailure) return 0
        return nativeCloseFd(fd)
    }

    override fun isTerminal(fd: Int): Boolean {
        requireLoaded()
        return nativeIsTerminal(fd)
    }

    // ── jni (names must match ombpty.c exactly; this build is not minified) ──

    private external fun nativeSpawn(
        program: String,
        argv: Array<String>,
        env: Array<String>,
        cwd: String,
        rows: Int,
        cols: Int,
    ): IntArray

    private external fun nativePollIn(fd: Int, timeoutMs: Int): Int

    private external fun nativeRead(fd: Int, buffer: ByteArray, length: Int): Int

    private external fun nativeWrite(fd: Int, bytes: ByteArray, offset: Int, length: Int): Int

    private external fun nativeResize(fd: Int, rows: Int, cols: Int): Int

    private external fun nativeWindowSize(fd: Int): IntArray?

    private external fun nativeWait(pid: Int, noHang: Boolean): IntArray?

    private external fun nativeSignal(pid: Int, signal: Int, group: Boolean): Int

    private external fun nativeCloseFd(fd: Int): Int

    private external fun nativeIsTerminal(fd: Int): Boolean
}


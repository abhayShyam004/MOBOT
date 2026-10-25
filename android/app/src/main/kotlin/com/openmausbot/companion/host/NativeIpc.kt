package com.openmausbot.companion.host

import com.openmausbot.companion.terminal.NativePty

/**
 * The host's memory-integrity bridge: this process's end of an abstract Unix
 * socket, freshly named for every host spawn.
 *
 * Why a socket and not pipes: the previous bridge rode the host's own stdio
 * pipes, and `open("/proc/<host>/fd/1")` on a pipe *succeeds* for any process
 * in the same UID — measured on the target device, MAC-request injection and
 * response reads included. A socket cannot be reopened through that magic
 * link at all: `open(2)` answers ENXIO. The kernel, not our protocol, is what
 * stops the signing oracle now.
 *
 * Why the host dials in instead of inheriting a descriptor: Android's
 * `java.lang.Process` closes descriptors beyond stdio in the child before
 * exec, so a harness-created socketpair end never reaches the host — measured
 * on the same device. A connection needs no inherited fd, and it buys the
 * authentication the mission requires: [acceptPeer] reads SO_PEERCRED, which
 * the kernel fills in at connect time and no process can forge, and the
 * harness keeps only the connection whose pid is the process it just spawned.
 * A wrong process that dials in is closed; a process that binds the name
 * first only denies the boot (abstract names carry a per-spawn nonce), never
 * impersonates the harness — and the host verifies the listener's credentials
 * symmetrically, against the harness pid in its own environment.
 *
 * The launcher then moves the host's connected socket onto fd 0, so every
 * process the host itself spawns — MCP servers, sandboxes, npx shims — finds
 * its own pipes or PTY there and can never inherit the channel.
 *
 * Read/write/close are interposed through [NativePty]: same native library,
 * same syscalls, one contract test covering both objects' symbols.
 */
internal object NativeIpc {

    /**
     * Bind and listen on the abstract socket [name]. Returns the listening
     * descriptor, or <0 as -errno. Close it once the host has authenticated.
     */
    fun listen(name: String): Int {
        load()
        return nativeListen(name)
    }

    /**
     * Accept one connection within [timeoutMs] and read its kernel peer
     * credentials. Returns { acceptedFd, peerPid, peerUid }; acceptedFd < 0
     * is -errno (-EAGAIN = timed out, -EACCES = caller outside this UID).
     * The caller decides by peerPid whether this is the process it spawned.
     */
    fun acceptPeer(listenFd: Int, timeoutMs: Int): IntArray {
        load()
        return nativeAcceptPeer(listenFd, timeoutMs, android.os.Process.myUid())
    }

    /** 0 on success, <0 as -errno. Applied to the accepted connection. */
    fun setCloexec(fd: Int): Int {
        load()
        return nativeSetCloexec(fd, true)
    }

    /** >0 bytes, 0 = peer hung up, <0 = -errno. */
    fun read(fd: Int, buffer: ByteArray, length: Int): Int = NativePty.read(fd, buffer, length)

    /** Whole-frame write: advances through short writes, false when the host is gone. */
    fun write(fd: Int, bytes: ByteArray): Boolean {
        var offset = 0
        while (offset < bytes.size) {
            val wrote = NativePty.write(fd, bytes, offset, bytes.size - offset)
            if (wrote <= 0) return false
            offset += wrote
        }
        return true
    }

    fun close(fd: Int) {
        NativePty.closeFd(fd)
    }

    private val loaded: Result<Unit> by lazy {
        runCatching { System.loadLibrary("ombpty") }
    }

    private fun load() {
        loaded.getOrElse { error ->
            throw IllegalStateException(
                "the native integrity bridge is not available on this device " +
                    "(native library failed to load: ${error.message})",
                error,
            )
        }
    }

    // ── jni (names must match ombpty.c exactly; this build is not minified) ──

    private external fun nativeListen(name: String): Int

    private external fun nativeAcceptPeer(listenFd: Int, timeoutMs: Int, myUid: Int): IntArray

    private external fun nativeSetCloexec(fd: Int, enabled: Boolean): Int
}

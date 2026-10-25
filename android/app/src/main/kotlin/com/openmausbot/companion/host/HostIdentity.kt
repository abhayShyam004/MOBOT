package com.openmausbot.companion.host

import android.util.Log
import java.io.File
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import org.json.JSONObject

/**
 * Who is answering on our loopback port?
 *
 * The port alone answers nothing: `127.0.0.1:18799` is a number, not an
 * identity, and two OpenMausBot packages installed side by side use the same
 * loopback trust rule. Measured on the Galaxy A07: after the preview process
 * was restarted, the *official* app's host was serving that port, and the
 * preview adopted it because a health check answered 200. Every request the
 * preview then made was answered by a different application's runtime.
 *
 * The first version of that identity was a token in a 0600 file, copied into
 * the child's environment. Phase 15 measured the real agent PTY reading both:
 * same-UID code is not stopped by file mode, and `/proc/<host>/environ` is
 * readable on this kernel despite `PR_SET_DUMPABLE=0`. A second version kept
 * the token in memory and delivered it over the integrity bridge; the same
 * audit then measured that `execve` resets the dumpable flag, so
 * `/proc/<host>/mem` is openable by a same-UID process. Any bearer secret that
 * lives in a process this attacker can inspect is not a boundary.
 *
 * There is therefore no secret at all now. The boundary is the **kernel's own
 * record of who connected**: the app creates a socketpair, the host dials in
 * as itself, and `SO_PEERCRED` binds that connection to the pid this app
 * forked (and to that process's parentage when the pid is hidden). The app
 * keeps that fd; it cannot be reopened through `/proc/<pid>/fd` (ENXIO), and it
 * dies with the host. A responder is trusted only while that bridge is alive
 * *and* `/api/health` reports the same pid the kernel authenticated. A foreign
 * process can read or forge everything except the live connection.
 *
 * Adoption is deliberately gone. An orphan from an earlier launch has no
 * integrity bridge (that socket died with the app process), so it cannot serve
 * memory at all; the only correct move is to reclaim the port from it and spawn
 * a host that can. A foreign responder is a startup failure, never a fallback.
 */
/** What owns the loopback port before a spawn. */
internal sealed interface HostProbe {
    /** Nothing is listening: spawn. */
    data object Absent : HostProbe

    /** This installation's own host from an earlier launch: reclaim and spawn. */
    data class OwnOrphan(val pid: Int) : HostProbe

    /** Something else owns the port: fail closed, never talk to it. */
    data class Foreign(val reason: String) : HostProbe

    /** The probe could not establish anything (timeout, odd status). */
    data class Unreachable(val reason: String) : HostProbe
}

/** What `/api/health` said, before any identity decision. */
internal sealed interface HostHealth {
    /** Nothing is listening. */
    data object Absent : HostHealth

    /** A host answered and named its pid. */
    data class Answered(val pid: Int, val port: Int?) : HostHealth

    /** Something answers but is not a usable OpenMausBot host. */
    data class Rejected(val reason: String) : HostHealth

    /** It answers, but this probe could not establish what it is. */
    data class Unreachable(val reason: String) : HostHealth
}

internal object HostIdentity {

    private const val TAG = "HarnessHost"
    private const val TOKEN_FILE = "host-instance.token"
    private const val HEALTH_PATH = "/api/health"

    /**
     * Remove the token file older builds persisted (mode 0600, readable by every
     * same-UID process all the same). Deleting it is part of the fix, not
     * housekeeping: a stale file is a working token for the next attacker.
     */
    fun discardLegacyTokenFile(dataDir: File) {
        val legacy = File(dataDir, TOKEN_FILE)
        runCatching {
            if (legacy.exists() && legacy.delete()) {
                Log.i(TAG, "host identity: removed the legacy on-disk token")
            }
        }.onFailure { Log.w(TAG, "host identity: could not remove the legacy token: ${it.javaClass.simpleName}") }
    }

    /** True when something accepts a TCP connection on the loopback port. */
    fun listening(port: Int, timeoutMs: Int = 700): Boolean = try {
        Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), timeoutMs) }
        true
    } catch (_: ConnectException) {
        false
    } catch (_: Throwable) {
        // A timeout or an odd error still means something is bound there: only
        // an outright refusal proves the port is free.
        true
    }

    /**
     * The pid of a process running *this installation's* embedded host, if one
     * survives this app process.
     *
     * Used only to decide which pid to kill after an app restart, when no token
     * exists yet — never to decide what to trust. A same-UID process can forge
     * the command line and nominate itself; the consequence is that it is killed
     * and a host is spawned, which is the same denial of service it could cause
     * with `kill(2)` anyway. No HTTP response from the pid is ever used.
     */
    fun findOwnHost(serverEntry: File): Int? {
        val needle = serverEntry.absolutePath
        val self = android.os.Process.myPid()
        val uid = android.os.Process.myUid()
        val proc = File("/proc")
        val entries = runCatching { proc.listFiles() }.getOrNull() ?: return null
        for (entry in entries) {
            val pid = entry.name.toIntOrNull() ?: continue
            if (pid == self) continue
            val cmdline = runCatching { File(entry, "cmdline").readBytes() }.getOrNull() ?: continue
            if (cmdline.isEmpty()) continue
            val text = String(cmdline, Charsets.UTF_8).replace('\u0000', ' ')
            if (!text.contains(needle)) continue
            val status = runCatching { File(entry, "status").readLines() }.getOrNull() ?: continue
            val uidLine = status.firstOrNull { it.startsWith("Uid:") } ?: continue
            val owner = uidLine.substringAfter(':').trim().split(Regex("\\s+")).firstOrNull()
                ?.toIntOrNull() ?: continue
            if (owner != uid) continue
            Log.i(TAG, "host identity: found this installation's surviving host at pid $pid")
            return pid
        }
        return null
    }

    /** Ask the responder what it claims to be. It proves nothing on its own. */
    fun health(port: Int, timeoutMs: Int = 1_500): HostHealth {
        val connection = runCatching {
            URI("http", null, "127.0.0.1", port, HEALTH_PATH, null, null)
                .toURL().openConnection() as HttpURLConnection
        }.getOrElse { error ->
            return HostHealth.Unreachable("${error.javaClass.simpleName}: ${error.message}")
        }
        return try {
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.requestMethod = "GET"
            val code = connection.responseCode
            val body = runCatching {
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                stream?.bufferedReader()?.use { it.readText() } ?: ""
            }.getOrDefault("")
            when (code) {
                200 -> {
                    val parsed = runCatching { JSONObject(body) }.getOrNull()
                    val pid = parsed?.optInt("pid", 0) ?: 0
                    val answeredPort = parsed?.optInt("port", 0) ?: 0
                    when {
                        parsed?.optString("app") != "openmausbot" ->
                            HostHealth.Rejected("the responder is not an OpenMausBot host")
                        pid <= 0 -> HostHealth.Rejected("the responder's health carries no pid")
                        answeredPort != 0 && answeredPort != port ->
                            HostHealth.Rejected("the responder reports port $answeredPort, not $port")
                        else -> HostHealth.Answered(pid, answeredPort.takeIf { it != 0 })
                    }
                }
                404 -> HostHealth.Rejected("a service on port $port has no /api/health")
                else -> HostHealth.Unreachable("HTTP $code")
            }
        } catch (error: Throwable) {
            when (error) {
                is ConnectException -> HostHealth.Absent
                is SocketTimeoutException -> HostHealth.Unreachable("timeout")
                else -> HostHealth.Unreachable("${error.javaClass.simpleName}: ${error.message}")
            }
        } finally {
            runCatching { connection.disconnect() }
        }
    }

    /**
     * Is the responder the process the kernel proved on the bridge?
     *
     * `bridgePid` is the peer pid `SO_PEERCRED` returned when this app accepted
     * the host's connection; it is not supplied by the host and cannot be
     * claimed by another process. A healthy-looking listener that names a
     * different pid is foreign, whatever its token or headers say.
     */
    fun verify(port: Int, bridgePid: Int, timeoutMs: Int = 1_500): HostHealth {
        if (bridgePid <= 0) {
            return HostHealth.Rejected("no kernel-authenticated host bridge is open")
        }
        return when (val health = health(port, timeoutMs)) {
            is HostHealth.Answered ->
                if (health.pid == bridgePid) health
                else HostHealth.Rejected(
                    "the responder reports pid ${health.pid}, but the bridge belongs to pid $bridgePid",
                )
            else -> health
        }
    }

    /**
     * Kill this installation's own leftover host and wait for the port.
     *
     * `Process.killProcess` only reaches a process of this UID — which is also
     * the only kind the probe will ever return, because answering with the
     * token requires reading this app's private storage.
     */
    fun reclaim(pid: Int, port: Int, waitMs: Long = 5_000): Boolean {
        val killed = runCatching { android.os.Process.killProcess(pid) }.isSuccess
        if (killed) Log.i(TAG, "reclaiming the loopback port from this installation's previous host (pid $pid)")
        val deadline = System.currentTimeMillis() + waitMs
        while (System.currentTimeMillis() < deadline) {
            if (!listening(port, 500)) return true
            Thread.sleep(100)
        }
        return false
    }
}

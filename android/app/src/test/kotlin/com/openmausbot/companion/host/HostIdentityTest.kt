package com.openmausbot.companion.host

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The identity decision that replaced "does /api/health answer 200".
 *
 * Measured failures this pins: after the preview restarted, the official app's
 * host owned the preview's loopback port and the preview adopted it on a
 * healthy health check. A per-spawn bearer token was tried next, and Phase 15
 * measured that `execve` resets the dumpable flag, so the token in host memory
 * was readable through `/proc/<pid>/mem` by the same UID. The boundary is now
 * the pid the kernel proved on the integrity bridge: a responder is ours only
 * while that fd is alive and `/api/health` names the same pid. No secret exists
 * to leak, and a process that merely answers HTTP cannot claim another pid.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HostIdentityTest {

    private var server: HttpServer? = null

    @After
    fun tearDown() {
        server?.stop(0)
    }

    /** A responder that answers /api/health like the host does. */
    private fun serve(port: Int, body: String?, code: Int): Int {
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)
        http.createContext("/api/health") { exchange: HttpExchange ->
            val payload = (if (code == 200) body ?: "" else """{"error":"not found"}""").toByteArray()
            exchange.sendResponseHeaders(code, payload.size.toLong())
            exchange.responseBody.use { it.write(payload) }
        }
        http.start()
        server = http
        return http.address.port
    }

    private fun freePort(): Int = java.net.ServerSocket(0).use { it.localPort }

    @Test
    fun `nothing listening means absent`() {
        assertEquals(HostHealth.Absent, HostIdentity.health(freePort()))
    }

    @Test
    fun `the pid the bridge proved is the only acceptable identity`() {
        val port = freePort()
        serve(port, """{"app":"openmausbot","pid":4321,"port":$port}""", 200)

        assertEquals(HostHealth.Answered(4321, port), HostIdentity.verify(port, 4321))
        val wrong = HostIdentity.verify(port, 9999)
        assertTrue(wrong is HostHealth.Rejected)
        assertTrue((wrong as HostHealth.Rejected).reason.contains("bridge belongs to pid 9999"))
    }

    @Test
    fun `without a bridge nothing on the port is accepted`() {
        val port = freePort()
        serve(port, """{"app":"openmausbot","pid":4321,"port":$port}""", 200)

        val answer = HostIdentity.verify(port, -1)
        assertTrue(answer is HostHealth.Rejected)
        assertTrue((answer as HostHealth.Rejected).reason.contains("no kernel-authenticated host bridge"))
    }

    @Test
    fun `a service without the health route is rejected`() {
        val port = freePort()
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)
        http.createContext("/") { exchange: HttpExchange ->
            val payload = "not found".toByteArray()
            exchange.sendResponseHeaders(404, payload.size.toLong())
            exchange.responseBody.use { it.write(payload) }
        }
        http.start()
        server = http

        val answer = HostIdentity.verify(port, 4321)
        assertTrue(answer is HostHealth.Rejected)
        assertTrue((answer as HostHealth.Rejected).reason.contains("no /api/health"))
    }

    @Test
    fun `a 200 with the wrong application name is rejected`() {
        val port = freePort()
        serve(port, """{"app":"something-else","pid":4321,"port":$port}""", 200)

        assertTrue(HostIdentity.verify(port, 4321) is HostHealth.Rejected)
    }

    @Test
    fun `a 200 that names another port is rejected`() {
        val port = freePort()
        serve(port, """{"app":"openmausbot","pid":4321,"port":${port + 1}}""", 200)

        assertTrue(HostIdentity.verify(port, 4321) is HostHealth.Rejected)
    }

    @Test
    fun `a token file left by an older build is deleted`() {
        val dir = File(RuntimeEnvironmentHolder.tempDir(), "data-legacy").apply { mkdirs() }
        val legacy = File(dir, "host-instance.token").apply { writeText("a".repeat(64) + "\n") }
        assertTrue(legacy.isFile)

        HostIdentity.discardLegacyTokenFile(dir)

        assertTrue(!legacy.exists())
    }

    @Test
    fun `each installation owns its own loopback port`() {
        assertEquals(StandalonePairing.HOST_PORT, StandalonePairing.portFor("com.openmausbot.companion"))
        assertEquals(
            StandalonePairing.PREVIEW_HOST_PORT,
            StandalonePairing.portFor("com.openmausbot.companion.preview"),
        )
        assertNotEquals(StandalonePairing.HOST_PORT, StandalonePairing.PREVIEW_HOST_PORT)
        assertEquals(StandalonePairing.PREVIEW_HOST_PORT, StandalonePairing.selfConnection(18789).port)
        assertEquals(18789, StandalonePairing.selfEndpoint(18789).port)
    }
}

/** Robolectric's app files dir, without depending on an Activity. */
private object RuntimeEnvironmentHolder {
    fun tempDir(): File = org.robolectric.RuntimeEnvironment.getApplication().filesDir
}

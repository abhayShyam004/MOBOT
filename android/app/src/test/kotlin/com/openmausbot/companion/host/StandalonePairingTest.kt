package com.openmausbot.companion.host

import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ConnectionRegistry
import com.openmausbot.companion.core.ConnectionRegistryRestore
import com.openmausbot.companion.core.ConnectionStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The self pairing must point at the port this installation actually owns.
 *
 * A preview build now listens on 18789 while the official app keeps 18799, and
 * a preview registry written by an older build points at 18799 — the official
 * app's port. Repairing it is not cosmetic: leaving it would make every request
 * the preview's UI issues follow a stale endpoint into the other package. Only
 * the synthetic self connection may be rewritten; a real pairing the person
 * created is theirs.
 */
class StandalonePairingTest {

    private class FakeStore(var registry: ConnectionRegistry) : ConnectionStore {
        var saves = 0
        override suspend fun load(): Connection? = registry.connections.firstOrNull()
        override suspend fun save(connection: Connection) {
            val others = registry.connections.filterNot { it.id == connection.id }
            registry = ConnectionRegistry.restoring(others + connection, registry.activeConnectionId)
        }
        override suspend fun clear() {
            registry = ConnectionRegistry()
        }
        override suspend fun loadRegistry(): ConnectionRegistryRestore = ConnectionRegistryRestore(registry, false)
        override suspend fun saveRegistry(registry: ConnectionRegistry) {
            saves++
            this.registry = registry
        }
        override suspend fun clearRegistry() {
            registry = ConnectionRegistry()
        }
    }

    private fun realPairing() = Connection(
        id = "real-computer",
        name = "Desk",
        host = "192.168.1.20",
        port = 8799,
    )

    @Test
    fun `a stale self pairing is repaired to this installation's port, and nothing else changes`() = runBlocking {
        val stale = StandalonePairing.selfConnection(StandalonePairing.HOST_PORT)
        val inner = FakeStore(
            ConnectionRegistry.restoring(
                listOf(stale, realPairing()),
                StandalonePairing.SELF_CONNECTION_ID,
            ),
        )

        val restored = StandaloneConnectionStore(inner, StandalonePairing.PREVIEW_HOST_PORT).loadRegistry()

        val self = restored.registry.connection(StandalonePairing.SELF_CONNECTION_ID)
        assertNotNull(self)
        assertEquals(StandalonePairing.PREVIEW_HOST_PORT, self!!.port)
        assertEquals("http://127.0.0.1:${StandalonePairing.PREVIEW_HOST_PORT}", self.activeEndpoint?.url)
        assertEquals(setOf("real-computer", StandalonePairing.SELF_CONNECTION_ID), restored.registry.connections.map { it.id }.toSet())
        assertEquals("192.168.1.20", restored.registry.connection("real-computer")?.host)
        assertEquals(8799, restored.registry.connection("real-computer")?.port)
        assertEquals(1, inner.saves)
    }

    @Test
    fun `an already-correct self pairing is left untouched`() = runBlocking {
        val correct = StandalonePairing.selfConnection(StandalonePairing.PREVIEW_HOST_PORT)
        val inner = FakeStore(ConnectionRegistry.restoring(listOf(correct), StandalonePairing.SELF_CONNECTION_ID))

        val restored = StandaloneConnectionStore(inner, StandalonePairing.PREVIEW_HOST_PORT).loadRegistry()

        assertEquals(0, inner.saves)
        assertEquals(correct.port, restored.registry.connection(StandalonePairing.SELF_CONNECTION_ID)?.port)
    }

    @Test
    fun `a missing self pairing is seeded at this installation's port`() = runBlocking {
        val inner = FakeStore(ConnectionRegistry.restoring(listOf(realPairing()), "real-computer"))

        val restored = StandaloneConnectionStore(inner, StandalonePairing.PREVIEW_HOST_PORT).loadRegistry()

        assertEquals(StandalonePairing.PREVIEW_HOST_PORT, restored.registry.connection(StandalonePairing.SELF_CONNECTION_ID)?.port)
        assertTrue(restored.registry.connections.any { it.id == "real-computer" })
    }
}

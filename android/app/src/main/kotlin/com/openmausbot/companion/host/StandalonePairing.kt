package com.openmausbot.companion.host

import android.util.Log
import com.openmausbot.companion.core.CompanionEndpoint
import com.openmausbot.companion.core.CompanionEndpointKind
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ConnectionRegistry
import com.openmausbot.companion.core.ConnectionRegistryRestore
import com.openmausbot.companion.core.ConnectionStore
import com.openmausbot.companion.core.TokenStore

/**
 * Makes this phone its own paired computer.
 *
 * The companion Session is a state machine over a paired computer; rather
 * than fork it, the standalone build seeds one synthetic pairing — a loopback
 * [Connection] to the embedded host plus a token that satisfies the client's
 * "paired" invariant. Server-side, requests from this app to 127.0.0.1 are
 * authenticated by the harness's loopback trust rule (loopback Host, no
 * proxy headers, no cross-origin), which carries full owner scopes; the
 * seeded token is never validated by the server and grants nothing by
 * itself. It must not use the `omb_sess_` prefix, which would send the
 * client down the session-credential path instead of loopback.
 */
object StandalonePairing {

    /** Stable identity for the synthetic self-pairing. */
    const val SELF_CONNECTION_ID = "self-this-phone"

    /**
     * The host's fixed loopback port. Deterministic so the seeded record is
     * always valid — but *per installation*, because two packages built from
     * this repository can be installed side by side and both trust loopback:
     * the official app keeps 18799, a preview build listens on 18789. Without
     * the split, whichever host starts second cannot bind, and a restart used
     * to "adopt" the other app's host because a health check answered 200.
     */
    const val HOST_PORT = 18799
    const val PREVIEW_HOST_PORT = 18789
    const val WEBHOOK_PORT = HOST_PORT + 1

    /** The loopback port this installation owns. */
    fun portFor(applicationId: String): Int =
        if (applicationId == "com.openmausbot.companion.preview" || applicationId.endsWith(".preview")) {
            PREVIEW_HOST_PORT
        } else {
            HOST_PORT
        }

    private const val SELF_CONNECTION_NAME = "This phone"

    /**
     * Not a secret: never checked by the server, only satisfies the client
     * store. Chosen to be obviously synthetic in any log or export.
     */
    const val SELF_TOKEN = "omb-local-self-pairing"

    fun selfEndpoint(port: Int = HOST_PORT): CompanionEndpoint =
        CompanionEndpoint.create("http://127.0.0.1:$port", CompanionEndpointKind.LAN, 0)
            ?: error("loopback endpoint must always build")

    fun selfConnection(port: Int = HOST_PORT): Connection {
        val endpoint = selfEndpoint(port)
        return Connection(
            id = SELF_CONNECTION_ID,
            name = SELF_CONNECTION_NAME,
            host = "127.0.0.1",
            port = port,
            activeEndpoint = endpoint,
            endpoints = listOf(endpoint),
            allowedRouteKinds = setOf(CompanionEndpointKind.LAN, CompanionEndpointKind.HOSTED),
            allowedLocalRouteURLs = setOf(endpoint.url),
        )
    }
}

/**
 * Seeds the self-pairing on first restore if it is absent. A real pairing the
 * user created later is never removed or reordered; seeding only makes the
 * phone its own computer, it does not steal anyone else's slot.
 */
class StandaloneConnectionStore(
    private val inner: ConnectionStore,
    /** This installation's loopback port; a preview build owns a different one. */
    private val port: Int = StandalonePairing.HOST_PORT,
) : ConnectionStore {

    override suspend fun load(): Connection? = inner.load()

    override suspend fun save(connection: Connection) = inner.save(connection)

    override suspend fun clear() = inner.clear()

    override suspend fun loadRegistry(): ConnectionRegistryRestore {
        val restored = inner.loadRegistry()
        val registry = restored.registry
        val existing = registry.connection(StandalonePairing.SELF_CONNECTION_ID)
        val expected = StandalonePairing.selfConnection(port)
        if (existing != null) {
            // A pairing saved by an older build points at the port this
            // installation used to share with the official app. Repair the
            // synthetic self connection only — a real pairing is never touched
            // — so no request can follow a stale endpoint into the other app.
            if (existing.port != expected.port || existing.activeEndpoint?.url != expected.activeEndpoint?.url) {
                val repaired = ConnectionRegistry.restoring(
                    registry.connections.map { if (it.id == StandalonePairing.SELF_CONNECTION_ID) expected else it },
                    registry.activeConnectionId,
                )
                try {
                    inner.saveRegistry(repaired)
                } catch (error: Exception) {
                    Log.w(TAG, "self-pairing endpoint repair not persisted yet: ${error.message}")
                }
                return ConnectionRegistryRestore(repaired, restored.migratedLegacyConnection)
            }
            return restored
        }
        val seeded = ConnectionRegistry.restoring(
            listOf(StandalonePairing.selfConnection(port)) + registry.connections,
            StandalonePairing.SELF_CONNECTION_ID,
        )
        try {
            inner.saveRegistry(seeded)
        } catch (error: Exception) {
            // A store that cannot persist today must not block the session:
            // the seed is re-attempted on the next restore. Keep the seeded
            // registry in memory for this launch.
            Log.w(TAG, "self-pairing seed not persisted yet: ${error.message}")
        }
        return ConnectionRegistryRestore(seeded, restored.migratedLegacyConnection)
    }

    override suspend fun saveRegistry(registry: ConnectionRegistry) = inner.saveRegistry(registry)

    override suspend fun clearRegistry() = inner.clearRegistry()

    private companion object {
        const val TAG = "StandalonePairing"
    }
}

/**
 * Mints the self-token on first read. Saved through the real store so it
 * survives process death like any pairing credential.
 */
class StandaloneTokenStore(private val inner: TokenStore) : TokenStore {

    override suspend fun save(connectionId: String, token: String) = inner.save(connectionId, token)

    override suspend fun remove(connectionId: String) = inner.remove(connectionId)

    override suspend fun read(connectionId: String): TokenStore.ReadResult {
        val stored = inner.read(connectionId)
        if (connectionId != StandalonePairing.SELF_CONNECTION_ID) return stored
        return when (stored) {
            is TokenStore.ReadResult.Found -> stored
            is TokenStore.ReadResult.Unavailable -> stored
            TokenStore.ReadResult.Missing -> {
                val token = StandalonePairing.SELF_TOKEN
                try {
                    inner.save(connectionId, token)
                } catch (error: Exception) {
                    Log.w(TAG, "self token not persisted yet: ${error.message}")
                }
                TokenStore.ReadResult.Found(token)
            }
        }
    }

    private companion object {
        const val TAG = "StandalonePairing"
    }
}

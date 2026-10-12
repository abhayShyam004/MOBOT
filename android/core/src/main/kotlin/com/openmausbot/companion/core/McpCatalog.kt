package com.openmausbot.companion.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One owner for the MCP server catalog on Android: the StateFlow the UI
 * observes, every config mutation, and the bounded per-server probe.
 *
 * Extracted from [Session] as a cohesive unit — MCP is the one domain whose
 * state lives outside the paired-computer model (config is local to the
 * host), and every mutation returns the fresh listing so the flow updates in
 * one place. Endpoint selection lives in [CompanionClient]; this class names
 * intents (add / replace / enable / remove / import), never routes.
 *
 * @param client the current companion client, or null while unpaired —
 *   mutations report "not connected" (false) instead of throwing.
 * @param onError receives a user-readable message when a mutation fails;
 *   Session forwards it to its action-error surface.
 */
class McpCatalog(
    private val client: () -> CompanionClient?,
    private val onError: (String?) -> Unit,
) {
    private val _servers = MutableStateFlow<List<McpServerListing>?>(null)

    /** The catalog as last fetched or mutated; null means "not loaded". */
    val servers: StateFlow<List<McpServerListing>?> = _servers.asStateFlow()

    /** Fetch the catalog. A failed load keeps the previous value and reports
     * through [onError], returning false so the UI can offer a retry. */
    suspend fun refresh(): Boolean {
        val activeClient = client() ?: return false
        return try {
            _servers.value = activeClient.mcpServers()
            true
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            onError(error.message)
            false
        }
    }

    /** Apply one config mutation; on success the catalog updates and every
     * observing screen re-renders. The listing never contains secret values,
     * so keeping it is safe. */
    private suspend fun mutate(
        mutation: suspend (CompanionClient) -> List<McpServerListing>,
    ): Boolean {
        val activeClient = client() ?: return false
        return try {
            _servers.value = mutation(activeClient)
            true
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            onError(error.message)
            false
        }
    }

    suspend fun add(name: String, config: McpServerConfig) =
        mutate { it.addMcpServer(name, config) }

    suspend fun replace(name: String, config: McpServerConfig) =
        mutate { it.updateMcpServer(name, config) }

    suspend fun setEnabled(name: String, enabled: Boolean) =
        mutate { it.setMcpServerEnabled(name, enabled) }

    suspend fun delete(name: String) =
        mutate { it.deleteMcpServer(name) }

    suspend fun import(json: String) =
        mutate { it.importMcpServers(json) }

    /** The bounded per-server Test probe. A failed probe is a result
     * ({ok:false, …}), not an exception, so it reports inline. */
    suspend fun probe(name: String): McpProbeResult? {
        val activeClient = client() ?: return null
        return try {
            activeClient.testMcpServer(name)
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            onError(error.message)
            null
        }
    }
}

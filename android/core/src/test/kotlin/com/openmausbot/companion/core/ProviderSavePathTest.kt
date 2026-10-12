package com.openmausbot.companion.core

import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The exact save path Settings' "Configure OpenAI-compatible endpoint" dialog
 * drives: [Session.saveOpenAICompatProvider] → `PUT /api/config` →
 * `POST /api/instances/openaiCompat/refresh-models`.
 *
 * Regression for the ARM32 device failure `content-type must be
 * application/json`: the refresh POST is body-less, and a body-less POST used
 * to carry no Content-Type at all (OkHttp omits the header when the empty
 * RequestBody has a null media type). The real server gates the
 * instance-action routes on Content-Type before reading anything and answers
 * 415 with exactly that message. A bare MockWebServer accepts any headers,
 * which is why the original wire test (method/path/body assertions only)
 * passed while the device failed — so these assertions check the headers.
 */
class ProviderSavePathTest {
    private lateinit var server: MockWebServer

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `saving a provider from settings sends json content-type on config write and model refresh`() = runTest {
        val session = sessionOver(server)
        session.awaitRestored()

        server.enqueue(json("""{"openaiCompat":{"configured":true,"url":"https://openrouter.ai/api/v1"}}"""))
        server.enqueue(json(fixtureText("instances")))

        val instances = session.saveOpenAICompatProvider("https://openrouter.ai/api/v1", "sk-or-test")

        val config = server.takeRequest()
        assertEquals("PUT", config.method)
        assertEquals("/api/config", config.path)
        // The server checks startsWith("application/json"); the charset
        // parameter OkHttp appends is fine — the bare type is the contract.
        assertTrue(config.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("Bearer device-token", config.getHeader("Authorization"))
        val configBody = CompanionJson.parseToJsonElement(config.body.readUtf8()).jsonObject.jsonObjectSafe()
        assertEquals("https://openrouter.ai/api/v1", configBody.openaiCompatString("url"))
        assertEquals("sk-or-test", configBody.openaiCompatString("key"))

        val refresh = server.takeRequest()
        assertEquals("POST", refresh.method)
        assertEquals("/api/instances/openaiCompat/refresh-models", refresh.path)
        // The regression: this body-less POST must still declare JSON, or the
        // server's instance-action guard refuses it before reading the body.
        assertTrue(refresh.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("Bearer device-token", refresh.getHeader("Authorization"))

        assertNotNull(instances)
        assertNull(session.actionError, "the dialog surfaces actionError; the save must be clean")
    }

    @Test
    fun `reconfiguring with a blank key still refreshes through a typed empty body`() = runTest {
        val session = sessionOver(server)
        session.awaitRestored()

        server.enqueue(json("""{"openaiCompat":{"configured":true,"url":"https://openrouter.ai/api/v1"}}"""))
        server.enqueue(json(fixtureText("instances")))

        session.saveOpenAICompatProvider("https://openrouter.ai/api/v1", null)

        val config = server.takeRequest()
        assertEquals("PUT", config.method)
        assertTrue(config.getHeader("Content-Type")!!.startsWith("application/json"))
        // A blank key field must not reach the wire at all: absent key = keep
        // the stored credential.
        val configBody = CompanionJson.parseToJsonElement(config.body.readUtf8()).jsonObject.jsonObjectSafe()
        val openaiCompat = configBody["openaiCompat"] as? Map<*, *>
        assertTrue("key" !in (openaiCompat?.keys ?: emptySet()))

        val refresh = server.takeRequest()
        assertEquals("POST /api/instances/openaiCompat/refresh-models", "${refresh.method} ${refresh.path}")
        assertTrue(refresh.getHeader("Content-Type")!!.startsWith("application/json"))
    }

    /** A restored one-computer session over the mock server, client live. */
    private fun TestScope.sessionOver(server: MockWebServer): Session {
        val connection = requireNotNull(Connection.parse(server.url("/").toString()))
        return Session(
            scope = backgroundScope,
            connectionStore = SingleConnectionStore(connection),
            tokenStore = FixedTokenStore("device-token"),
            onboardingStore = InMemoryOnboardingStore(),
            deviceNameProvider = { "Pixel" },
            eventsFn = { _, _, _ -> emptyFlow() },
        )
    }

    private fun json(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)

    private fun kotlinx.serialization.json.JsonObject.jsonObjectSafe(): Map<String, Any> =
        mapValues { (_, value) ->
            when (value) {
                is kotlinx.serialization.json.JsonObject -> value.mapValues { (_, v) ->
                    (v as kotlinx.serialization.json.JsonPrimitive).content
                }
                is kotlinx.serialization.json.JsonPrimitive -> value.content
                else -> value.toString()
            }
        }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any>.openaiCompatString(field: String): String =
        ((this["openaiCompat"] as? Map<String, Any>) ?: emptyMap())[field] as? String ?: ""

    private class SingleConnectionStore(private val connection: Connection) : ConnectionStore {
        override suspend fun load(): Connection = connection
        override suspend fun save(connection: Connection) {}
        override suspend fun clear() {}
        override suspend fun loadRegistry() = ConnectionRegistryRestore(
            ConnectionRegistry(listOf(connection), connection.id),
            migratedLegacyConnection = false,
        )
        override suspend fun saveRegistry(registry: ConnectionRegistry) {}
    }

    private class FixedTokenStore(private val token: String) : TokenStore {
        override suspend fun save(connectionId: String, token: String) {}
        override suspend fun read(connectionId: String): TokenStore.ReadResult = TokenStore.ReadResult.Found(token)
        override suspend fun remove(connectionId: String) {}
    }
}

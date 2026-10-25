package com.openmausbot.companion.core

import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConnectedAppsClientTest {
    private lateinit var server: MockWebServer
    private lateinit var connection: Connection
    private lateinit var client: CompanionClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        connection = requireNotNull(Connection.parse(server.url("/").toString()))
        client = CompanionClient(connection, "paired-token")
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun anUnreadableCredentialStoreIsNotAnEmptyInventory() {
        val unreadable = CompanionJson.decodeFromString<ConnectorStatuses>(
            """{"configured":false,"credentialStore":"unavailable","services":{}}""",
        )
        assertFalse(
            unreadable.isAuthoritative,
            "the store could not be read, so this empty map is ignorance, not an inventory",
        )
        assertTrue(unreadable.services.isEmpty())

        val readable = CompanionJson.decodeFromString<ConnectorStatuses>(
            """{"configured":true,"credentialStore":"ok","services":{}}""",
        )
        assertTrue(
            readable.isAuthoritative,
            "a store that was read and holds nothing is a real answer",
        )

        val older = CompanionJson.decodeFromString<ConnectorStatuses>(
            """{"configured":true,"services":{}}""",
        )
        assertTrue(
            older.isAuthoritative,
            "a desktop too old to send the field still answers for itself",
        )

        val switchedOff = CompanionJson.decodeFromString<ConnectorStatuses>(
            """{"configured":false,"credentialStore":"ok","services":{}}""",
        )
        assertTrue(
            switchedOff.isAuthoritative,
            "Composio being unconfigured is knowledge, and only an unreadable store is not",
        )

        // Only the exact string withdraws authority. The server writes it from
        // one literal, so a variant is not a store we failed to read — it is a
        // value this build does not recognise, and the contract says an
        // unrecognised answer still answers. Without these two the rule accepts
        // a silent widening: `equals(ignoreCase = true)`, or "anything that is
        // not ok is unavailable", would both pass on the cases above alone.
        listOf("Unavailable", "UNAVAILABLE", "unavailable ", "degraded", "", "unknown")
            .forEach { value ->
                val decoded = CompanionJson.decodeFromString<ConnectorStatuses>(
                    """{"configured":true,"credentialStore":"$value","services":{}}""",
                )
                assertTrue(
                    decoded.isAuthoritative,
                    "only the exact string \"unavailable\" withdraws authority, not \"$value\"",
                )
            }
    }

    @Test
    fun accountStatusAndDisplayRulesMatchSwift() {
        val statuses = CompanionJson.decodeFromString<ConnectorStatuses>(
            """{
              "configured":true,
              "services":{
                "gmail":{
                  "connected":true,
                  "pending":false,
                  "status":"ACTIVE",
                  "accounts":[
                    {"id":"ca_work","alias":" Work ","status":" ACTIVE "},
                    {"id":"ca_personal","status":"INACTIVE"}
                  ]
                },
                "weather":{"connected":true,"pending":false,"status":"ACTIVE","accounts":[]},
                "slack":{"connected":false,"pending":true}
              }
            }""",
        )

        val gmail = requireNotNull(statuses.services["gmail"])
        val accounts = requireNotNull(gmail.accounts)
        assertEquals(listOf("ca_work", "ca_personal"), accounts.map(ConnectorAccount::id))
        assertEquals("Work", accounts[0].displayName)
        assertEquals("Primary account", accounts[1].displayName)
        assertEquals("Primary account", ConnectorAccount("ca_blank", " \n ", "ACTIVE").displayName)
        assertTrue(accounts[0].isActive)
        assertFalse(accounts[1].isActive)
        assertFalse(ConnectorAccount("ca_other", null, "REACTIVE").isActive)
        assertEquals(emptyList(), statuses.services["weather"]?.accounts)
        assertEquals(true, statuses.services["slack"]?.pending)
        assertNull(statuses.services["slack"]?.accounts)
    }

    @Test
    fun additionalAccountAliasRulesTrimCapAndStopAtFiveAccounts() {
        assertNull(ConnectedAppsRules.firstAccountAlias)
        assertNull(ConnectedAppsRules.additionalAccountAlias("  \n\t "))
        assertEquals(
            "a".repeat(64),
            ConnectedAppsRules.additionalAccountAlias("  ${"a".repeat(65)}  "),
        )
        assertTrue(ConnectedAppsRules.canAddAnotherAccount(accounts(4)))
        assertFalse(ConnectedAppsRules.canAddAnotherAccount(accounts(5)))
        assertEquals(64, ConnectedAppsRules.MAX_ACCOUNT_ALIAS_LENGTH)
        assertEquals(5, ConnectedAppsRules.MAX_ACCOUNTS_PER_CONNECTOR)
    }

    @Test
    fun catalogAndCompleteInventoryUseSeparateAuthenticatedCalls() = runBlocking {
        server.enqueue(json(
            """{"configured":true,"mode":"composio","source":"toolkits","cards":[{"slug":"slack","label":"Slack","blurb":"Team messages","logo":"https://cdn.example/slack.png","domain":"slack.com"}]}""",
        ))
        server.enqueue(json(
            """{"configured":true,"services":{"slack":{"connected":true,"accounts":[{"id":"ca_work","alias":"Work","status":"ACTIVE"},{"id":"ca_client","alias":"Client","status":"ACTIVE"}]}}}""",
        ))

        val catalog = client.connectorCatalog()
        val statuses = client.allConnectorStatuses()

        assertEquals(listOf("slack"), catalog.cards.map(ConnectorCard::slug))
        assertEquals("composio", catalog.mode)
        assertEquals("toolkits", catalog.source)
        assertEquals("https://cdn.example/slack.png", catalog.cards.single().logo)
        assertEquals("slack.com", catalog.cards.single().domain)
        assertEquals(listOf("Work", "Client"), statuses.services["slack"]?.accounts?.map { it.alias })
        val requests = listOf(server.takeRequest(), server.takeRequest())
        assertEquals(
            listOf("GET /api/connectors/catalog", "GET /api/connectors/connected"),
            requests.map { "${it.method} ${it.path}" },
        )
        requests.forEach { assertEquals("Bearer paired-token", it.getHeader("Authorization")) }
    }

    @Test
    fun connectorCatalogSupportsQueryAndRefreshParameters() = runBlocking {
        val dummyCatalog = """{"configured":true,"cards":[{"slug":"zoom","label":"Zoom","blurb":"Meetings"}],"totalCount":25}"""
        server.enqueue(json(dummyCatalog))
        server.enqueue(json(dummyCatalog))
        server.enqueue(json(dummyCatalog))
        server.enqueue(json(dummyCatalog))

        client.connectorCatalog(query = "zoom meeting")
        client.connectorCatalog(refresh = true)
        client.connectorCatalog(query = "spotify", refresh = true)
        client.connectorCatalog()

        val req1 = server.takeRequest()
        val req2 = server.takeRequest()
        val req3 = server.takeRequest()
        val req4 = server.takeRequest()

        assertEquals("GET /api/connectors/catalog?query=zoom%20meeting", "${req1.method} ${req1.path}")
        assertEquals("GET /api/connectors/catalog?refresh=true", "${req2.method} ${req2.path}")
        assertEquals("GET /api/connectors/catalog?query=spotify&refresh=true", "${req3.method} ${req3.path}")
        assertEquals("GET /api/connectors/catalog", "${req4.method} ${req4.path}")
    }

    @Test
    fun firstAuthorizationOmitsAliasAndAnotherAccountSendsOnlyTheTrimmedAlias() = runBlocking {
        server.enqueue(json("""{"url":"https://auth.example/connect"}"""))
        server.enqueue(json("""{"url":"https://auth.example/connect/personal"}"""))
        server.enqueue(json("""{"url":"https://auth.example/connect/primary"}"""))

        assertEquals(
            "https://auth.example/connect",
            client.authorizeConnector("gmail", ConnectedAppsRules.firstAccountAlias).toString(),
        )
        val first = server.takeRequest()
        assertEquals("POST", first.method)
        assertEquals("/api/connectors/gmail/authorize", first.path)
        assertEquals(0, first.bodySize)
        // Body-less POSTs still declare the API's JSON type (zero-length
        // body parses as {} server-side); the route itself has no
        // content-type gate, but the header is now uniform across mutations.
        assertTrue(first.getHeader("Content-Type")!!.startsWith("application/json"))

        assertEquals(
            "https://auth.example/connect/personal",
            client.authorizeConnector("google-calendar", "  Personal  ").toString(),
        )
        val additional = server.takeRequest()
        assertEquals("POST", additional.method)
        assertEquals("/api/connectors/google-calendar/authorize", additional.path)
        val body = CompanionJson.parseToJsonElement(additional.body.readUtf8()).jsonObject
        assertEquals(setOf("alias"), body.keys)
        assertEquals("Personal", body.getValue("alias").jsonPrimitive.content)
        assertEquals("Bearer paired-token", additional.getHeader("Authorization"))

        client.authorizeConnector("gmail", "  \n  ")
        val whitespaceOnly = server.takeRequest()
        assertEquals(0, whitespaceOnly.bodySize)
        // Same uniform typed-empty-body rule as the first request above.
        assertTrue(whitespaceOnly.getHeader("Content-Type")!!.startsWith("application/json"))
    }

    @Test
    fun unsafeSlugsAndNonHttpsAuthorizationUrlsAreRejectedLocally() = runBlocking {
        assertFailsWith<APIError.BadUrl> { client.authorizeConnector("café", null) }
        assertFailsWith<APIError.BadUrl> { client.authorizeConnector("bad/slash", null) }
        assertEquals(0, server.requestCount)

        listOf(
            "http://auth.example/connect",
            "https:///path",
            "https:auth.example/connect",
            "javascript:alert(1)",
        ).forEach { url ->
            server.enqueue(json("""{"url":"$url"}"""))
            assertFailsWith<APIError.BadUrl> { client.authorizeConnector("gmail", null) }

            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/connectors/gmail/authorize", request.path)
            assertEquals("Bearer paired-token", request.getHeader("Authorization"))
        }
    }

    @Test
    fun sessionWrappersReturnOnlyValidatedContractValues() = runTest {
        val connectionStore = MemoryConnectionStore(connection)
        val tokenStore = MemoryTokenStore(connection.id, "paired-token")
        val session = Session(
            scope = backgroundScope,
            connectionStore = connectionStore,
            tokenStore = tokenStore,
            onboardingStore = InMemoryOnboardingStore(),
            deviceNameProvider = { "Pixel" },
            eventsFn = { _, _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        server.enqueue(json(
            """{"configured":true,"cards":[{"slug":"gmail","label":"Gmail","blurb":"Mail"}]}""",
        ))
        server.enqueue(json(
            """{"configured":true,"services":{"gmail":{"connected":false,"pending":true}}}""",
        ))
        server.enqueue(json("""{"url":"https://auth.example/connect"}"""))
        server.enqueue(json("""{"url":"http://auth.example/connect"}"""))

        assertEquals("gmail", session.loadConnectorCatalog()?.cards?.single()?.slug)
        assertEquals(true, session.loadAllConnectorStatuses()?.services?.get("gmail")?.pending)
        assertEquals(
            "https://auth.example/connect",
            session.authorizeConnector("gmail", null)?.toString(),
        )
        assertNull(session.authorizeConnector("gmail", null))
        assertEquals("That address doesn't look right.", session.actionError)

        assertEquals(
            listOf(
                "/api/connectors/catalog",
                "/api/connectors/connected",
                "/api/connectors/gmail/authorize",
                "/api/connectors/gmail/authorize",
            ),
            List(4) { server.takeRequest().path },
        )
    }

    @Test
    fun theProjectKeyIsWriteOnlyAndEmptyStringClearsIt() = runBlocking {
        server.enqueue(json("""{"composio":{"configured":true,"mode":"self-hosted"}}"""))
        server.enqueue(json("""{"composio":{"configured":false,"mode":"unavailable"}}"""))

        val saved = client.updateComposioApiKey("ak_live_123")
        assertEquals(true, saved.composio?.configured)
        assertEquals("self-hosted", saved.composio?.mode)
        assertEquals(false, client.updateComposioApiKey("").composio?.configured)

        val save = server.takeRequest()
        assertEquals("PUT", save.method)
        assertEquals("/api/config", save.path)
        val saveBody = CompanionJson.parseToJsonElement(save.body.readUtf8()).jsonObject
        assertEquals(setOf("composio"), saveBody.keys)
        val sent = saveBody.getValue("composio").jsonObject
        assertEquals(setOf("apiKey"), sent.keys)
        assertEquals("ak_live_123", sent.getValue("apiKey").jsonPrimitive.content)

        val clearBody = CompanionJson.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("", clearBody.getValue("composio").jsonObject.getValue("apiKey").jsonPrimitive.content)
    }

    @Test
    fun thePerBotConnectedAppsGrantUsesTheBroadBotPatch() = runBlocking {
        server.enqueue(json(
            """{"bot":{"id":"b1","threadId":"t1","name":"Mira","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"i","model":"m"},"createdAt":1,"composio":false}}""",
        ))

        val bot = client.updateBotComposio("b1", false)
        assertEquals(false, bot.composio)

        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("/api/bots/b1", request.path)
        val body = CompanionJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(setOf("composio"), body.keys)
        assertEquals("false", body.getValue("composio").jsonPrimitive.content)
    }

    @Test
    fun connectionCardsDriveAuthorizeStatusResumeAndDismiss() = runBlocking {
        server.enqueue(json("""{"url":"https://auth.example/connect"}"""))
        server.enqueue(json("""{"connected":true,"pending":false,"status":"ACTIVE"}"""))
        server.enqueue(json("""{"resumed":true}"""))
        server.enqueue(json("""{"dismissed":true}"""))

        assertEquals("https://auth.example/connect", client.authorizeConnectorCard("b1", "m1", "t1").toString())
        assertTrue(client.connectorCardStatus("b1", "m1", "t1").connected)
        client.resumeConnectorCard("b1", "m1", "t1")
        client.dismissConnectorCard("b1", "m1", "t1")

        val requests = List(4) { server.takeRequest() }
        assertEquals(
            listOf(
                "POST /api/bots/b1/connector-cards/m1/authorize",
                "GET /api/bots/b1/connector-cards/m1/status?threadId=t1",
                "POST /api/bots/b1/connector-cards/m1/resume",
                "POST /api/bots/b1/connector-cards/m1/dismiss",
            ),
            requests.map { "${it.method} ${it.path}" },
        )
        // Every action is bound to the thread that owns the card.
        listOf(0, 2, 3).forEach { index ->
            val body = CompanionJson.parseToJsonElement(requests[index].body.readUtf8()).jsonObject
            assertEquals("t1", body.getValue("threadId").jsonPrimitive.content)
        }
        assertEquals(0, requests[1].bodySize)
    }

    @Test
    fun aNonHttpsConnectionCardUrlIsRejectedBeforeItCanBeOpened() = runBlocking {
        server.enqueue(json("""{"url":"javascript:alert(1)"}"""))
        assertFailsWith<APIError.BadUrl> { client.authorizeConnectorCard("b1", "m1", "t1") }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun disconnectUsesTheServiceRouteAndUnsafeSlugsNeverLeaveTheDevice() = runBlocking {
        server.enqueue(json("""{"ok":true}"""))
        client.removeConnectorService("google-calendar")

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/connectors/google-calendar", request.path)

        assertFailsWith<APIError.BadUrl> { client.removeConnectorService("bad/slash") }
        assertFailsWith<APIError.BadUrl> { client.removeConnectorService("caf\u00e9") }
        assertEquals(1, server.requestCount)
    }

    private fun accounts(count: Int): List<ConnectorAccount> =
        List(count) { index -> ConnectorAccount("ca_$index", "Account $index", "ACTIVE") }

    private fun json(body: String): MockResponse = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}

private class MemoryConnectionStore(initial: Connection) : ConnectionStore {
    private var value: Connection? = initial

    override suspend fun load(): Connection? = value

    override suspend fun save(connection: Connection) {
        value = connection
    }

    override suspend fun clear() {
        value = null
    }
}

private class MemoryTokenStore(connectionId: String, token: String) : TokenStore {
    private val values = mutableMapOf(connectionId to token)

    override suspend fun save(connectionId: String, token: String) {
        values[connectionId] = token
    }

    override suspend fun read(connectionId: String): TokenStore.ReadResult =
        values[connectionId]?.let(TokenStore.ReadResult::Found) ?: TokenStore.ReadResult.Missing

    override suspend fun remove(connectionId: String) {
        values.remove(connectionId)
    }
}

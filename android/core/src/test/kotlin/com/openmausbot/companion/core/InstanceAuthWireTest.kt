package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

/**
 * The harness wraps a sign-in start/status in an `auth` envelope
 * (`json(res, 200, { auth })` in server/index.ts). Reading the bare flow
 * object instead is exactly how the phone answered every Codex sign-in with
 * a decode error — these pin the envelope, its nullable fields, and that the
 * engine catalog's new capability fields survive a round trip.
 */
class InstanceAuthWireTest {

    @Test
    fun `a start response decodes from its auth envelope`() {
        val raw = """
            {"auth":{"phase":"waiting","flowId":"flow-1",
            "authorizationUrl":"https://auth.openai.com/codex/device",
            "expiresAt":"2026-10-03T06:43:42.544Z","userCode":"BJVL-0YJP2"}}
        """.trimIndent()
        val decoded = CompanionJson.decodeFromString<AuthStartResponse>(raw)
        assertEquals("waiting", decoded.auth.phase)
        assertEquals("flow-1", decoded.auth.flowId)
        assertEquals("https://auth.openai.com/codex/device", decoded.auth.authorizationUrl)
        assertEquals("BJVL-0YJP2", decoded.auth.userCode)
    }

    @Test
    fun `a status response decodes from its auth envelope, message included`() {
        val raw = """
            {"auth":{"phase":"failed","flowId":"flow-1","authorizationUrl":null,
            "expiresAt":null,"message":"OpenAI refused to start the device sign-in (HTTP 429)."}}
        """.trimIndent()
        val decoded = CompanionJson.decodeFromString<AuthStatusResponse>(raw)
        assertEquals("failed", decoded.auth.phase)
        assertNull(decoded.auth.authorizationUrl)
        assertEquals("OpenAI refused to start the device sign-in (HTTP 429).", decoded.auth.message)
    }

    @Test
    fun `engine capability fields round-trip, availability included`() {
        val authentication = InstanceAuthentication(
            method = "device-code",
            signOut = true,
            available = true,
        )
        val encoded = CompanionJson.encodeToJsonElement(InstanceAuthentication.serializer(), authentication)
        val decoded = CompanionJson.decodeFromJsonElement(InstanceAuthentication.serializer(), encoded)
        assertEquals(authentication, decoded)

        // A server that predates the flag sends no `available`: absent must not
        // read as a refusal (older hosts only offered sign-in with a runtime).
        val legacy = CompanionJson.decodeFromString<InstanceAuthentication>("""{"method":"browser","signOut":false}""")
        assertNull(legacy.available)
    }

    @Test
    fun `a snapshot carries the account identity the card shows`() {
        val raw = """
            {"state":"unavailable","reason":"`codex` CLI not found","authenticated":true,
            "account":{"email":"person@example.com","method":"login"}}
        """.trimIndent()
        val decoded = CompanionJson.decodeFromString<ProviderSnapshot>(raw)
        assertEquals(true, decoded.authenticated)
        assertEquals("person@example.com", decoded.account?.email)
        assertEquals("login", decoded.account?.method)
    }
}

package com.openmausbot.companion.host

import android.content.Context
import androidx.webkit.ProfileStore
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * JVM-side contract tests for the browser driver (Robolectric stands in for
 * the Android runtime; the real WebView matrix runs on-device via
 * scripts/test-android-browser.mjs). Pinned here: session identity, the
 * loopback+token boundary, the {ok,error} response shape, and the per-bot
 * profile isolation invariant the on-device test asserts end-to-end.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrowserDriverServerTest {

    private val context: Context = RuntimeEnvironment.getApplication()

    @After
    fun tearDown() {
        BrowserDriverServer.stopCurrent()
    }

    @Test
    fun `session name is a stable digest, never the raw bot id`() {
        val name = BrowserDriverServer.sessionNameForBot("bot-alpha")
        assertTrue(name!!.startsWith("omb-"))
        assertEquals(36, name.length) // "omb-" + 32 hex chars
        assertEquals(name, BrowserDriverServer.sessionNameForBot("bot-alpha"))
        assertTrue(BrowserDriverServer.sessionNameForBot("bot-beta") != name)
    }

    @Test
    fun `session name rejects hostile ids`() {
        assertEquals(null, runCatching { BrowserDriverServer.sessionNameForBot("../etc") }.getOrNull())
        assertEquals(null, runCatching { BrowserDriverServer.sessionNameForBot("") }.getOrNull())
    }

    @Test
    fun `start binds loopback once and hands out a stable port+token`() {
        val sessions = File(context.filesDir, "browser-sessions-test").apply { mkdirs() }
        val first = BrowserDriverServer.start(context, sessions)
        val second = BrowserDriverServer.start(context, sessions)
        assertEquals(first.first, second.first)
        assertEquals(first.second, second.second)
        assertTrue(first.second.length >= 32)
        assertEquals(first.first, BrowserDriverServer.currentPort())
        assertEquals(first.second, BrowserDriverServer.currentToken())
    }

    @Test
    fun `requests without the token are refused`() {
        val sessions = File(context.filesDir, "browser-sessions-test").apply { mkdirs() }
        val (port, _) = BrowserDriverServer.start(context, sessions)
        val connection = URL("http://127.0.0.1:$port/session/omb-abc/status").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connect()
        assertEquals(401, connection.responseCode)
        connection.disconnect()
    }

    @Test
    fun `requests with the token but an unknown session answer ok-false, not a crash`() {
        val sessions = File(context.filesDir, "browser-sessions-test").apply { mkdirs() }
        val (port, token) = BrowserDriverServer.start(context, sessions)
        val connection = URL("http://127.0.0.1:$port/session/omb-doesnotexist/status").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.doOutput = true
        connection.connect()
        val body = connection.inputStream.bufferedReader().readText()
        assertEquals(200, connection.responseCode)
        assertTrue(body.contains("\"ok\":false"))
        connection.disconnect()
    }

    @Test
    fun `per-bot profile names are distinct and filesystem-safe`() {
        // ProfileStore itself needs a real WebView APK (unsupported under
        // Robolectric), so here we pin the identity contract only; the actual
        // per-profile isolation (separate CookieManager instances) is asserted
        // on-device by scripts/test-android-browser.mjs (isolation leg).
        val alpha = BrowserDriverServer.sessionNameForBot("bot-alpha")!!
        val beta = BrowserDriverServer.sessionNameForBot("bot-beta")!!
        assertTrue(alpha != beta)
        assertTrue(alpha.matches(Regex("[a-z0-9-]{3,64}")))
        assertTrue(beta.matches(Regex("[a-z0-9-]{3,64}")))
    }
}

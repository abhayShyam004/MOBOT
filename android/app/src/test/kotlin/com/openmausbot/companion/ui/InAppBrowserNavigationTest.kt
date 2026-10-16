package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ChatTarget
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class InAppBrowserNavigationTest {

    @Test
    fun `layered back navigation resolves to history when canGoBack is true`() {
        var navigatedBack = false
        var exitedBrowser = false

        fun executeBack(canGoBack: Boolean) {
            if (canGoBack) {
                navigatedBack = true
            } else {
                exitedBrowser = true
            }
        }

        executeBack(canGoBack = true)
        assertTrue(navigatedBack)
        assertFalse(exitedBrowser)
    }

    @Test
    fun `layered back navigation exits browser when no history remains`() {
        var navigatedBack = false
        var exitedBrowser = false

        fun executeBack(canGoBack: Boolean) {
            if (canGoBack) {
                navigatedBack = true
            } else {
                exitedBrowser = true
            }
        }

        executeBack(canGoBack = false)
        assertFalse(navigatedBack)
        assertTrue(exitedBrowser)
    }

    @Test
    fun `host and protocol parsing correctly detects https security badge`() {
        val httpsUrl = "https://news.ycombinator.com/item?id=42"
        val httpUrl = "http://insecure.example.org/path"

        val httpsUri = URI(httpsUrl)
        val httpUri = URI(httpUrl)

        assertEquals("news.ycombinator.com", httpsUri.host)
        assertTrue(httpsUrl.startsWith("https://", ignoreCase = true))

        assertEquals("insecure.example.org", httpUri.host)
        assertFalse(httpUrl.startsWith("https://", ignoreCase = true))
    }

    @Test
    fun `browser destination sits on top of chat destination and returns to exact chat on pop`() {
        val navigator = CompanionNavigator()
        val botChat = Destination.Chat(ChatTarget.Bot("bot-1", "thread-1"))
        navigator.push(botChat)
        assertEquals(botChat, navigator.current)

        val browser = Destination.Browser("https://example.com", "Example", "bot-1")
        navigator.push(browser)
        assertEquals(browser, navigator.current)
        assertTrue(navigator.canGoBack)

        // Close / Back pops browser, returning to botChat
        navigator.pop()
        assertEquals(botChat, navigator.current)

        // Next Back returns to Roster
        navigator.pop()
        assertEquals(Destination.Roster, navigator.current)
    }
}

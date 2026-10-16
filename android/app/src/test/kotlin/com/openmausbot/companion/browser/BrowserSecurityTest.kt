package com.openmausbot.companion.browser

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BrowserSecurityTest {

    @Test
    fun `public http and https urls are allowed`() {
        assertTrue(BrowserSecurity.isSafeWebUrl("https://example.com"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://example.org/path?query=1#section"))
        assertTrue(BrowserSecurity.isSafeWebUrl("https://news.ycombinator.com/item?id=123"))
    }

    @Test
    fun `non-http schemes are refused`() {
        assertFalse(BrowserSecurity.isSafeWebUrl("file:///android_asset/index.html"))
        assertFalse(BrowserSecurity.isSafeWebUrl("javascript:alert(1)"))
        assertFalse(BrowserSecurity.isSafeWebUrl("content://media/external/images"))
        assertFalse(BrowserSecurity.isSafeWebUrl("data:text/html,<h1>Hello</h1>"))
        assertFalse(BrowserSecurity.isSafeWebUrl("about:blank"))
    }

    @Test
    fun `private and loopback hosts are refused`() {
        assertFalse(BrowserSecurity.isSafeWebUrl("http://localhost:3000"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://app.localhost:8080"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:8080"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://10.0.0.1:5000"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://192.168.1.100/status"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://service.internal/api"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://device.local/"))
    }

    @Test
    fun `fixture port allows designated loopback target only`() {
        val fixturePort = 18765
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:$fixturePort/test", fixturePort = fixturePort))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:9999/test", fixturePort = fixturePort))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://localhost:$fixturePort/test", fixturePort = fixturePort))
    }

    @Test
    fun `malformed urls are refused safely`() {
        assertFalse(BrowserSecurity.isSafeWebUrl(""))
        assertFalse(BrowserSecurity.isSafeWebUrl("not-a-url"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://:80"))
    }
}

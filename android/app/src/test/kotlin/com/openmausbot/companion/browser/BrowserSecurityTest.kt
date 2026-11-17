package com.openmausbot.companion.browser

import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BrowserSecurityTest {

    @BeforeTest
    fun setUp() {
        BrowserSecurity.clearAllowedPreviewPorts()
    }

    @AfterTest
    fun tearDown() {
        BrowserSecurity.clearAllowedPreviewPorts()
    }

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
        assertFalse(BrowserSecurity.isSafeWebUrl("intent://example.com#Intent;scheme=https;end"))
        assertFalse(BrowserSecurity.isSafeWebUrl("blob:http://example.com/uuid"))
    }

    @Test
    fun `malformed urls are refused safely`() {
        assertFalse(BrowserSecurity.isSafeWebUrl(""))
        assertFalse(BrowserSecurity.isSafeWebUrl("not-a-url"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://:80"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://   "))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:999999"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:-1"))
    }

    @Test
    fun `default loopback access is refused without explicit allowlist`() {
        assertFalse(BrowserSecurity.isSafeWebUrl("http://localhost:3000"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://app.localhost:8080"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:8080"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3001"))
    }

    @Test
    fun `exact runtime-configured preview port allowlist permits matching port only`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        // Allowed port 3001 passes
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3001/"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://localhost:3001/lessons"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3001/api/lessons/complete"))

        // Unauthorized ports are strictly refused
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3000"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:8080"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:22"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:80"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://localhost:5000"))
    }

    @Test
    fun `caller-provided allowedLoopbackPorts takes precedence and strictly filters ports`() {
        val allowedPorts = setOf(3001, 3002)

        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3001", allowedLoopbackPorts = allowedPorts))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3002/sub", allowedLoopbackPorts = allowedPorts))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3000", allowedLoopbackPorts = allowedPorts))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:8080", allowedLoopbackPorts = allowedPorts))
    }

    @Test
    fun `redirects to unauthorized localhost ports are refused`() {
        // Simulating redirect inspection: allowed preview is 3001, redirect attempts 8080 or 22
        val activePreviewPorts = setOf(3001)

        // Initial preview navigation
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3001/lesson", allowedLoopbackPorts = activePreviewPorts))

        // Redirect targets
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:22/admin", allowedLoopbackPorts = activePreviewPorts))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:8080/internal", allowedLoopbackPorts = activePreviewPorts))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://localhost:6379/eval", allowedLoopbackPorts = activePreviewPorts))
    }

    @Test
    fun `IPv4 loopback variations are identified and governed by port allowlist`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:3001/"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.2:3001/"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.255.255.254:3001/"))

        // Unauthorized port on alternate loopback IPs
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.2:8080/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.255.255.254:22/"))
    }

    @Test
    fun `IPv6 loopback variations are identified and governed by port allowlist`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        assertTrue(BrowserSecurity.isSafeWebUrl("http://[::1]:3001/"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://[0:0:0:0:0:0:0:1]:3001/"))

        // Unauthorized port on IPv6 loopback
        assertFalse(BrowserSecurity.isSafeWebUrl("http://[::1]:8080/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://[0:0:0:0:0:0:0:1]:22/"))
    }

    @Test
    fun `IPv4-mapped IPv6 loopback variations are identified and governed by port allowlist`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        assertTrue(BrowserSecurity.isSafeWebUrl("http://[::ffff:127.0.0.1]:3001/"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://[0:0:0:0:0:ffff:127.0.0.1]:3001/"))

        // Unauthorized port
        assertFalse(BrowserSecurity.isSafeWebUrl("http://[::ffff:127.0.0.1]:8080/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://[0:0:0:0:0:ffff:127.0.0.1]:22/"))
    }

    @Test
    fun `alternate IP representations are detected and prevented from bypassing policy`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        // Dword 2130706433 = 127.0.0.1
        assertTrue(BrowserSecurity.isLoopbackHost("2130706433"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://2130706433:3001/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://2130706433:8080/"))

        // Hex 0x7f.0.0.1 / 0x7f000001 = 127.0.0.1
        assertTrue(BrowserSecurity.isLoopbackHost("0x7f.0.0.1"))
        assertTrue(BrowserSecurity.isLoopbackHost("0x7f000001"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://0x7f.0.0.1:3001/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://0x7f.0.0.1:8080/"))

        // Octal 0177.0.0.1 = 127.0.0.1
        assertTrue(BrowserSecurity.isLoopbackHost("0177.0.0.1"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://0177.0.0.1:3001/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://0177.0.0.1:8080/"))

        // Shortened notation 127.1 = 127.0.0.1
        assertTrue(BrowserSecurity.isLoopbackHost("127.1"))
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.1:3001/"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.1:8080/"))
    }

    @Test
    fun `private LAN and cloud metadata remain strictly refused even with loopback allowed`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        // Cloud metadata
        assertFalse(BrowserSecurity.isSafeWebUrl("http://169.254.169.254/latest/meta-data"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://169.254.169.254:3001/latest/meta-data"))

        // RFC 1918 Private LAN
        assertFalse(BrowserSecurity.isSafeWebUrl("http://10.0.0.1:3001"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://192.168.1.50:3001"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://172.16.0.10:3001"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://100.64.0.1:3001")) // Carrier-grade NAT

        // Private domain suffixes
        assertFalse(BrowserSecurity.isSafeWebUrl("http://service.internal:3001"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://device.local:3001"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://gateway.lan:3001"))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://router.home.arpa:3001"))
    }

    @Test
    fun `fixture port allows designated loopback target only`() {
        val fixturePort = 18765
        assertTrue(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:$fixturePort/test", fixturePort = fixturePort))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://127.0.0.1:9999/test", fixturePort = fixturePort))
        assertFalse(BrowserSecurity.isSafeWebUrl("http://localhost:$fixturePort/test", fixturePort = fixturePort))
    }

    @Test
    fun `isLocalPreviewUrl accurately classifies loopback targets with port allowlist`() {
        BrowserSecurity.addAllowedPreviewPort(3001)

        assertTrue(BrowserSecurity.isLocalPreviewUrl("http://127.0.0.1:3001"))
        assertTrue(BrowserSecurity.isLocalPreviewUrl("http://localhost:3001/lessons"))

        // Ports outside allowlist
        assertFalse(BrowserSecurity.isLocalPreviewUrl("http://127.0.0.1:8080"))
        assertFalse(BrowserSecurity.isLocalPreviewUrl("http://localhost:5173"))

        // Non-loopback
        assertFalse(BrowserSecurity.isLocalPreviewUrl("http://192.168.1.1:3001"))
        assertFalse(BrowserSecurity.isLocalPreviewUrl("https://google.com"))
    }
}

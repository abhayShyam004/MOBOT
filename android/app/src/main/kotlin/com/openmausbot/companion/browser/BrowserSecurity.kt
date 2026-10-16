package com.openmausbot.companion.browser

import java.net.InetAddress
import java.net.URI

/**
 * Shared security checks for in-app browser and WebView driver automation.
 * Protects against SSRF, internal network exploration, and non-web schemes.
 */
object BrowserSecurity {
    fun isSafeWebUrl(url: String, fixturePort: Int = 0): Boolean {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false
        return try {
            val uri = URI(url)
            val host = uri.host ?: return false
            if (fixturePort > 0 && host == "127.0.0.1" && uri.port == fixturePort) return true
            !isPrivateHost(host)
        } catch (_: Exception) {
            false
        }
    }

    fun isPrivateHost(host: String): Boolean {
        if (host.equals("localhost", ignoreCase = true) ||
            host.endsWith(".localhost", ignoreCase = true) ||
            host.endsWith(".local", ignoreCase = true) ||
            host.endsWith(".internal", ignoreCase = true)
        ) {
            return true
        }
        return try {
            val address = InetAddress.getByName(host)
            address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isAnyLocalAddress
        } catch (_: Exception) {
            false
        }
    }
}

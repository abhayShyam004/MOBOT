package com.openmausbot.companion.browser

import java.net.InetAddress
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * Shared security checks for in-app browser and WebView driver automation.
 * Protects against SSRF, internal network exploration, and non-web schemes.
 * Enforces an exact, runtime-configured preview-port allowlist for loopback access.
 */
object BrowserSecurity {

    private val _allowedPreviewPorts = ConcurrentHashMap.newKeySet<Int>()

    /**
     * Runtime-configured allowlist of loopback ports permitted for preview rendering.
     */
    val allowedPreviewPorts: Set<Int>
        get() = _allowedPreviewPorts.toSet()

    fun addAllowedPreviewPort(port: Int) {
        if (port in 1..65535) {
            _allowedPreviewPorts.add(port)
        }
    }

    fun removeAllowedPreviewPort(port: Int) {
        _allowedPreviewPorts.remove(port)
    }

    fun setAllowedPreviewPorts(ports: Collection<Int>) {
        _allowedPreviewPorts.clear()
        for (p in ports) {
            if (p in 1..65535) {
                _allowedPreviewPorts.add(p)
            }
        }
    }

    fun clearAllowedPreviewPorts() {
        _allowedPreviewPorts.clear()
    }

    private fun extractHostAndPort(uri: URI, scheme: String): Pair<String, Int>? {
        var host = uri.host
        var port = uri.port
        if (host == null && uri.authority != null) {
            val auth = uri.authority
            val colon = auth.lastIndexOf(':')
            if (colon != -1 && colon < auth.length - 1) {
                val portStr = auth.substring(colon + 1)
                port = portStr.toIntOrNull() ?: -1
                host = auth.substring(0, colon)
            } else {
                host = auth
            }
        }
        if (host.isNullOrBlank()) return null
        val effectivePort = if (port != -1) port else if (scheme.equals("https", ignoreCase = true)) 443 else 80
        if (effectivePort !in 1..65535) return null
        return Pair(host, effectivePort)
    }

    /**
     * Determines whether the given URL is safe for in-app browser navigation.
     * Revalidates scheme, host, alternate IP representations, private LAN / cloud metadata,
     * and strictly requires loopback ports to belong to the exact allowlist.
     */
    fun isSafeWebUrl(
        url: String,
        fixturePort: Int = 0,
        allowLoopback: Boolean = false,
        allowedLoopbackPorts: Set<Int> = emptySet(),
    ): Boolean {
        if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) {
            return false
        }

        return try {
            val uri = URI(url)
            val scheme = uri.scheme?.lowercase() ?: return false
            if (scheme != "http" && scheme != "https") return false

            val (host, port) = extractHostAndPort(uri, scheme) ?: return false

            // Fixture testing bypass strictly requires exact 127.0.0.1 host and designated fixture port
            if (fixturePort > 0 && host == "127.0.0.1" && port == fixturePort) {
                return true
            }

            // Loopback validation
            if (isLoopbackHost(host)) {
                val effectiveAllowedPorts = buildSet {
                    addAll(allowedLoopbackPorts)
                    addAll(_allowedPreviewPorts)
                }

                // If explicit allowed ports are configured, loopback is strictly allowed ONLY on those ports
                if (effectiveAllowedPorts.isNotEmpty()) {
                    return port in effectiveAllowedPorts
                }

                return false
            }

            // Public host validation: ensure host is not private, internal, link-local or cloud metadata
            !isPrivateHost(host)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Identifies whether a URL targets a local loopback preview server.
     */
    fun isLocalPreviewUrl(url: String, allowedPorts: Set<Int> = emptySet()): Boolean {
        if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) {
            return false
        }
        return try {
            val uri = URI(url)
            val scheme = uri.scheme?.lowercase() ?: return false
            val (host, port) = extractHostAndPort(uri, scheme) ?: return false
            if (!isLoopbackHost(host)) return false

            val effectiveAllowedPorts = buildSet {
                addAll(allowedPorts)
                addAll(_allowedPreviewPorts)
            }

            if (effectiveAllowedPorts.isNotEmpty()) {
                port in effectiveAllowedPorts
            } else {
                port in 1024..65535
            }
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Checks if the host represents any loopback address:
     * - "localhost", "*.localhost"
     * - IPv4 loopback (127.0.0.0/8)
     * - Alternate representations (dword, hex, octal, shortened notation)
     * - IPv6 loopback (::1, [::1], 0:0:0:0:0:0:0:1)
     * - IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)
     */
    fun isLoopbackHost(rawHost: String): Boolean {
        if (rawHost.isBlank()) return false
        val clean = rawHost.trim().lowercase().removePrefix("[").removeSuffix("]")

        if (clean == "localhost" || clean.endsWith(".localhost") || clean == "localhost.") {
            return true
        }

        val altIpv4 = parseIpv4Alternate(clean)
        if (altIpv4 != null) {
            val firstOctet = (altIpv4 ushr 24) and 0xFF
            return firstOctet == 127L
        }

        return try {
            val addr = InetAddress.getByName(clean)
            if (addr.isLoopbackAddress) return true
            val bytes = addr.address
            if (bytes.size == 4 && (bytes[0].toInt() and 0xFF) == 127) return true
            if (bytes.size == 16) {
                val isAllZeroExceptLast = (0..14).all { bytes[it].toInt() == 0 } && bytes[15].toInt() == 1
                if (isAllZeroExceptLast) return true
                val isIpv4Mapped = (0..9).all { bytes[it].toInt() == 0 } &&
                    (bytes[10].toInt() and 0xFF) == 0xFF &&
                    (bytes[11].toInt() and 0xFF) == 0xFF
                if (isIpv4Mapped && (bytes[12].toInt() and 0xFF) == 127) return true
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Checks if the host represents a private or restricted network destination:
     * - RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
     * - Link-Local / AWS/Cloud Metadata (169.254.0.0/16, 169.254.169.254)
     * - Carrier-Grade NAT (100.64.0.0/10)
     * - Multicast / Reserved (224.0.0.0/4, 240.0.0.0/4)
     * - Loopback addresses
     * - Private domain suffixes (.local, .internal, .lan, .home.arpa)
     * - IPv6 Link-Local (fe80::/10) and Unique Local (fc00::/7)
     */
    fun isPrivateHost(rawHost: String): Boolean {
        if (rawHost.isBlank()) return true
        val clean = rawHost.trim().lowercase().removePrefix("[").removeSuffix("]")

        if (clean == "localhost" || clean.endsWith(".localhost") ||
            clean.endsWith(".local") || clean.endsWith(".internal") ||
            clean.endsWith(".lan") || clean.endsWith(".home.arpa")
        ) {
            return true
        }

        val altIpv4 = parseIpv4Alternate(clean)
        if (altIpv4 != null) {
            val b0 = (altIpv4 ushr 24) and 0xFF
            val b1 = (altIpv4 ushr 16) and 0xFF
            if (b0 == 0L || b0 == 127L || b0 == 10L) return true
            if (b0 == 172L && b1 in 16L..31L) return true
            if (b0 == 192L && b1 == 168L) return true
            if (b0 == 169L && b1 == 254L) return true
            if (b0 == 100L && b1 in 64L..127L) return true
            if (b0 >= 224L) return true
        }

        return try {
            val addr = InetAddress.getByName(clean)
            if (addr.isLoopbackAddress || addr.isLinkLocalAddress ||
                addr.isSiteLocalAddress || addr.isAnyLocalAddress || addr.isMulticastAddress
            ) {
                return true
            }

            val bytes = addr.address
            if (bytes.size == 16) {
                // IPv6 Unique Local Address (fc00::/7)
                if ((bytes[0].toInt() and 0xFE) == 0xFC) return true
                // IPv6 Link-Local (fe80::/10)
                if ((bytes[0].toInt() and 0xFF) == 0xFE && (bytes[1].toInt() and 0xC0) == 0x80) return true
                // IPv4-mapped IPv6 check
                val isIpv4Mapped = (0..9).all { bytes[it].toInt() == 0 } &&
                    (bytes[10].toInt() and 0xFF) == 0xFF &&
                    (bytes[11].toInt() and 0xFF) == 0xFF
                if (isIpv4Mapped) {
                    val b0 = bytes[12].toLong() and 0xFF
                    val b1 = bytes[13].toLong() and 0xFF
                    if (b0 == 0L || b0 == 127L || b0 == 10L) return true
                    if (b0 == 172L && b1 in 16L..31L) return true
                    if (b0 == 192L && b1 == 168L) return true
                    if (b0 == 169L && b1 == 254L) return true
                    if (b0 == 100L && b1 in 64L..127L) return true
                    if (b0 >= 224L) return true
                }
            }
            false
        } catch (_: Exception) {
            clean.any { it.isDigit() || it == ':' || it == '.' }
        }
    }

    /**
     * Parses IPv4 addresses in alternative formats (decimal dword, octal, hex, shortened dotted quad)
     * according to standard POSIX inet_aton rules.
     */
    fun parseIpv4Alternate(host: String): Long? {
        val clean = host.trim().lowercase()

        // Single integer (e.g. 2130706433, 0x7f000001, 017700000001)
        if (clean.matches(Regex("^0x[0-9a-f]+$"))) {
            return clean.removePrefix("0x").toLongOrNull(16)?.takeIf { it in 0L..0xFFFFFFFFL }
        }
        if (clean.matches(Regex("^0[0-7]+$"))) {
            return clean.removePrefix("0").toLongOrNull(8)?.takeIf { it in 0L..0xFFFFFFFFL }
        }
        if (clean.matches(Regex("^[0-9]+$"))) {
            return clean.toLongOrNull(10)?.takeIf { it in 0L..0xFFFFFFFFL }
        }

        // Dotted parts (1 to 4 parts: a.b.c.d, a.b.d, a.d)
        val parts = clean.split(".")
        if (parts.size in 1..4) {
            val parsedParts = mutableListOf<Long>()
            for (p in parts) {
                val num = when {
                    p.startsWith("0x") -> p.removePrefix("0x").toLongOrNull(16)
                    p.startsWith("0") && p.length > 1 && p.all { it in '0'..'7' } -> p.removePrefix("0").toLongOrNull(8)
                    p.all { it.isDigit() } -> p.toLongOrNull(10)
                    else -> return null
                } ?: return null
                if (num < 0L) return null
                parsedParts.add(num)
            }

            return when (parsedParts.size) {
                1 -> if (parsedParts[0] <= 0xFFFFFFFFL) parsedParts[0] else null
                2 -> if (parsedParts[0] <= 0xFF && parsedParts[1] <= 0xFFFFFF) {
                    (parsedParts[0] shl 24) or parsedParts[1]
                } else null
                3 -> if (parsedParts[0] <= 0xFF && parsedParts[1] <= 0xFF && parsedParts[2] <= 0xFFFF) {
                    (parsedParts[0] shl 24) or (parsedParts[1] shl 16) or parsedParts[2]
                } else null
                4 -> if (parsedParts.all { it <= 0xFF }) {
                    (parsedParts[0] shl 24) or (parsedParts[1] shl 16) or (parsedParts[2] shl 8) or parsedParts[3]
                } else null
                else -> null
            }
        }

        return null
    }
}

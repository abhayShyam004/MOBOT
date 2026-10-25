package com.openmausbot.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Trampoline activity for OAuth / Connector / Model Provider callbacks.
 * Catches:
 *   - openmausbot://connected?status=success&toolkit=...
 *   - openmausbot://auth?status=success&provider=...
 * and brings MainActivity to the foreground.
 */
class OAuthCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val data = intent?.data
        val host = data?.host
        val toolkit = data?.getQueryParameter("toolkit")
        val provider = data?.getQueryParameter("provider")
        val mainIntent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (host == "connected") {
                putExtra("connector_authorized", toolkit ?: "true")
            } else if (host == "auth") {
                putExtra("provider_authorized", provider ?: "true")
            }
        }
        startActivity(mainIntent)
        finish()
    }
}

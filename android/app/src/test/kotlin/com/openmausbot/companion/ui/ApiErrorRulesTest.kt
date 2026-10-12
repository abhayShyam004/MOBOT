package com.openmausbot.companion.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A 401 must never read as "Something went wrong", and an unmatched failure
 * must not grow an invented explanation — the raw text stays the body.
 */
class ApiErrorRulesTest {

    @Test
    fun `authentication failures name the missing or invalid key and offer configuration`() {
        val classified = ApiErrorRules.classify("Request failed with status code 401")
        assertEquals("Model authentication needed", classified.title)
        assertTrue("401" in classified.explanation)
        assertTrue(classified.configureProviders)
        assertEquals("Request failed with status code 401", classified.detail)
    }

    @Test
    fun `an invalid api key is recognised verbatim`() {
        val classified = ApiErrorRules.classify("Invalid API key provided")
        assertEquals("Model authentication needed", classified.title)
        assertTrue(classified.configureProviders)
    }

    @Test
    fun `forbidden names the provider refusal`() {
        val classified = ApiErrorRules.classify("403 Forbidden: this model requires a higher tier")
        assertEquals("The provider refused the request", classified.title)
        assertTrue(classified.configureProviders)
    }

    @Test
    fun `a missing model reads as not configured`() {
        val classified = ApiErrorRules.classify("No model providers are available")
        assertEquals("Model not configured", classified.title)
        assertTrue(classified.configureProviders)
    }

    @Test
    fun `rate limits tell the reader to wait`() {
        val classified = ApiErrorRules.classify("429 Too Many Requests")
        assertEquals("The provider is rate-limiting", classified.title)
        assertFalse(classified.configureProviders)
    }

    @Test
    fun `timeouts and network failures name connectivity`() {
        assertEquals(
            "The provider did not respond in time",
            ApiErrorRules.classify("The request timed out after 30s").title,
        )
        assertEquals(
            "Could not reach the provider",
            ApiErrorRules.classify("getaddrinfo ENOTFOUND api.openai.com").title,
        )
        // An unreachable endpoint is almost always a wrong base URL, which is
        // exactly what the in-chat fix panel edits.
        assertTrue(ApiErrorRules.classify("connection refused").configureProviders)
    }

    @Test
    fun `an unavailable model opens the fix panel rather than staying a red line`() {
        val classified = ApiErrorRules.classify("Quill's model is unavailable")
        assertEquals("Model not configured", classified.title)
        assertTrue(classified.configureProviders)
        assertEquals("Quill's model is unavailable", classified.detail)
    }

    @Test
    fun `an engine missing from the host is not a shrug`() {
        val raw = "Codex is not installed on this server. Run npm install -g @openai/codex@latest on the server, then try again."
        val classified = ApiErrorRules.classify(raw)
        assertEquals("The engine is not installed on this host", classified.title)
        assertFalse(classified.configureProviders, "the remedy is on the host, not in provider settings")
        assertEquals(raw, classified.detail, "the engine's own words stay on the dialog")
    }

    @Test
    fun `a missing npm on the host classifies the same way`() {
        val classified = ApiErrorRules.classify(
            "npm is not installed on this server. Install Node.js with npm for the user running MOBOT, then try again.",
        )
        assertEquals("The engine is not installed on this host", classified.title)
        assertFalse(classified.configureProviders)
    }

    @Test
    fun `an unmatched message stays honest - the raw text is the explanation`() {
        val raw = "The turn ended because the sky turned purple"
        val classified = ApiErrorRules.classify(raw)
        assertEquals("Something went wrong", classified.title)
        assertEquals(raw, classified.explanation)
        assertNull(classified.detail)
        assertFalse(classified.configureProviders)
    }

    @Test
    fun `empty input stays a plain failure`() {
        val classified = ApiErrorRules.classify("   ")
        assertEquals("Something went wrong", classified.title)
        assertFalse(classified.configureProviders)
    }

    @Test
    fun `server errors keep the provider's own words as detail`() {
        val classified = ApiErrorRules.classify("500 Internal Server Error: upstream overloaded")
        assertEquals("The provider had an internal error", classified.title)
        assertEquals("500 Internal Server Error: upstream overloaded", classified.detail)
    }

    @Test
    fun `quota and credit exhaustion are classified with provider configuration`() {
        val classified = ApiErrorRules.classify("insufficient_quota: you exceeded your current quota")
        assertEquals("Out of credits or quota", classified.title)
        assertTrue(classified.configureProviders)
    }

    @Test
    fun `deployment and preview failures are classified accurately`() {
        val deploy = ApiErrorRules.classify("deployment failed: container crashed on startup")
        assertEquals("Deployment failed", deploy.title)
        assertFalse(deploy.configureProviders)

        val preview = ApiErrorRules.classify("preview server error: port already in use")
        assertEquals("Preview server error", preview.title)
        assertFalse(preview.configureProviders)
    }

    @Test
    fun `malformed responses and runtime errors are classified accurately`() {
        val malformed = ApiErrorRules.classify("malformed response: unexpected token < in JSON at position 0")
        assertEquals("Malformed provider response", malformed.title)
        assertFalse(malformed.configureProviders)

        val runtime = ApiErrorRules.classify("local runtime failure: worker exited with code 1")
        assertEquals("Local runtime failure", runtime.title)
        assertFalse(runtime.configureProviders)
    }
}

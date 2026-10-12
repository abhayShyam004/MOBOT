package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class StructuredAppErrorTest {

    @Test
    fun `SecretSanitizer redacts bearer tokens, api keys, and private keys`() {
        val raw = """
            Authorization: Bearer mySecretToken123456789
            API key: sk-abcdef1234567890
            Vercel: ver_xyz987654321
            Render: rnd_abc12345678
            GitHub: ghp_1234567890abcdef
            JSON: {"api_key": "supersecretkey999", "password": "mypassword"}
            URL: https://api.example.com?token=secrettoken999&user=alice
            -----BEGIN PRIVATE KEY-----
            MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC
            -----END PRIVATE KEY-----
        """.trimIndent()

        val sanitized = SecretSanitizer.sanitize(raw)

        assertFalse(sanitized.contains("mySecretToken123456789"), "Bearer token must be redacted")
        assertTrue(sanitized.contains("[REDACTED_TOKEN]"), "Bearer token placeholder must be present")

        assertFalse(sanitized.contains("sk-abcdef1234567890"), "OpenAI key must be redacted")
        assertTrue(sanitized.contains("sk-...[REDACTED]"), "API key placeholder must be present")

        assertFalse(sanitized.contains("ver_xyz987654321"), "Vercel token must be redacted")
        assertTrue(sanitized.contains("ver_...[REDACTED]"), "Vercel placeholder must be present")

        assertFalse(sanitized.contains("rnd_abc12345678"), "Render token must be redacted")
        assertTrue(sanitized.contains("rnd_...[REDACTED]"), "Render placeholder must be present")

        assertFalse(sanitized.contains("ghp_1234567890abcdef"), "GitHub token must be redacted")
        assertTrue(sanitized.contains("ghp_...[REDACTED]"), "GitHub placeholder must be present")

        assertFalse(sanitized.contains("supersecretkey999"), "JSON secret must be redacted")
        assertFalse(sanitized.contains("mypassword"), "JSON password must be redacted")

        assertFalse(sanitized.contains("secrettoken999"), "Query param token must be redacted")
        assertFalse(sanitized.contains("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC"), "Private key must be redacted")
        assertTrue(sanitized.contains("[REDACTED_PRIVATE_KEY]"), "Private key placeholder must be present")
    }

    @Test
    fun `StructuredAppError formats comprehensive diagnostic report`() {
        val error = StructuredAppError(
            id = "err-101",
            category = ErrorCategory.PROVIDER,
            operation = "Model Inference (OpenAI)",
            headline = "Authentication Failed",
            explanation = "Invalid API key provided for model provider.",
            confidence = CauseConfidence.CONFIRMED,
            nextSteps = listOf(
                "Open Model Provider settings.",
                "Verify API key has valid credits.",
                "Retry turn once key is updated."
            ),
            actions = listOf(ActionableRecovery.OPEN_SETTINGS, ActionableRecovery.RETRY, ActionableRecovery.DISMISS),
            diagnostics = ErrorDiagnostics(
                rawMessage = "HTTP 401: Invalid API key",
                statusCode = 401,
                stackTrace = "com.openmausbot.companion.core.APIError.Status: 401",
                sanitizedLogs = "Request failed on endpoint /v1/chat/completions",
                failedOperation = "Model Inference",
                timestamp = "2026-10-10T12:00:00.000Z",
                correlationId = "corr-99",
                turnId = "turn-42",
            ),
            canRetry = true,
        )

        val report = error.toDiagnosticReport()

        assertTrue(report.contains("=== MOBOT Failure Diagnostic Report ==="))
        assertTrue(report.contains("Error ID: err-101"))
        assertTrue(report.contains("Category: PROVIDER"))
        assertTrue(report.contains("Confidence: CONFIRMED"))
        assertTrue(report.contains("HTTP / Exit Code: 401"))
        assertTrue(report.contains("Correlation ID: corr-99"))
        assertTrue(report.contains("Turn ID: turn-42"))
        assertTrue(report.contains("1. Open Model Provider settings."))
        assertTrue(report.contains("2. Verify API key has valid credits."))
        assertTrue(report.contains("3. Retry turn once key is updated."))
        assertTrue(report.contains("Raw Details (Sanitized):"))
        assertTrue(report.contains("HTTP 401: Invalid API key"))
        assertTrue(report.contains("Logs Tail:"))
        assertTrue(report.contains("Stack Trace:"))
    }

    @Test
    fun `ErrorClassifier classifies provider 401 authentication error`() {
        val classified = ErrorClassifier.classify(
            operation = "Chat Completion",
            rawMessage = "401 Unauthorized: invalid api key provided: sk-abcdef1234567890",
            statusCode = 401,
        )

        assertEquals(ErrorCategory.PROVIDER, classified.category)
        assertEquals("Model Provider Authentication Failed", classified.headline)
        assertEquals(CauseConfidence.CONFIRMED, classified.confidence)
        assertFalse(classified.canRetry)
        assertTrue(classified.actions.contains(ActionableRecovery.OPEN_SETTINGS))
        assertEquals(3, classified.nextSteps.size)
        assertFalse(classified.diagnostics.rawMessage.contains("sk-abcdef1234567890"))
    }

    @Test
    fun `ErrorClassifier classifies rate limit 429 error as retryable`() {
        val classified = ErrorClassifier.classify(
            operation = "Model Inference",
            rawMessage = "HTTP 429: rate limit exceeded, please slow down",
            statusCode = 429,
        )

        assertEquals(ErrorCategory.PROVIDER, classified.category)
        assertEquals("Provider Rate Limit or Quota Exceeded", classified.headline)
        assertEquals(CauseConfidence.CONFIRMED, classified.confidence)
        assertTrue(classified.canRetry)
        assertTrue(classified.isIdempotent)
        assertTrue(classified.actions.contains(ActionableRecovery.RETRY))
    }

    @Test
    fun `ErrorClassifier classifies preview server port failure`() {
        val classified = ErrorClassifier.classify(
            operation = "HTML Preview",
            rawMessage = "Preview server error: listen EADDRINUSE: address already in use 127.0.0.1:3006",
        )

        assertEquals(ErrorCategory.PREVIEW_SERVER, classified.category)
        assertEquals("Preview Server Failed to Run", classified.headline)
        assertEquals(CauseConfidence.CONFIRMED, classified.confidence)
        assertTrue(classified.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
        assertNotNull(classified.retryPrompt)
        assertTrue(classified.retryPrompt!!.contains("preview"))
    }

    @Test
    fun `ErrorClassifier classifies build failure with auto-fix prompt`() {
        val classified = ErrorClassifier.classify(
            operation = "Project Build",
            rawMessage = "npm run build failed with exit code 1: syntax error in App.tsx",
        )

        assertEquals(ErrorCategory.BUILD_SYSTEM, classified.category)
        assertEquals("Project Build Failed", classified.headline)
        assertEquals(CauseConfidence.CONFIRMED, classified.confidence)
        assertTrue(classified.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
        assertTrue(classified.retryPrompt!!.contains("build"))
    }

    @Test
    fun `ErrorClassifier classifies ToolActivity failure`() {
        val tool = ToolActivity(
            name = "bash",
            ok = false,
            error = "command not found: docker",
            output = "bash: line 1: docker: command not found",
        )

        val classified = ErrorClassifier.fromToolActivity(tool, turnId = "turn-77")

        assertEquals(ErrorCategory.TOOL_EXECUTION, classified.category)
        assertEquals("Tool Execution Failed: bash", classified.headline)
        assertTrue(classified.explanation.contains("command not found: docker"))
        assertEquals("turn-77", classified.diagnostics.turnId)
        assertTrue(classified.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
        assertNotNull(classified.retryPrompt)
    }

    @Test
    fun `ErrorClassifier classifies FailureCard accurately`() {
        val card = FailureCard(
            kind = "rate_limit",
            title = "Rate limit reached",
            detail = "The provider asked this turn to slow down.",
            advice = "Wait a few seconds and retry.",
            status = 429,
            instanceId = "inst-1",
            provider = "Anthropic",
            model = "claude-3-7-sonnet",
            attempts = 3,
        )

        val classified = ErrorClassifier.fromFailureCard(card, turnId = "turn-99")

        assertEquals(ErrorCategory.PROVIDER, classified.category)
        assertEquals("Rate limit reached", classified.headline)
        assertEquals("The provider asked this turn to slow down.", classified.explanation)
        assertTrue(classified.canRetry)
        assertEquals(429, classified.diagnostics.statusCode)
        assertTrue(classified.diagnostics.sanitizedLogs!!.contains("Attempts: 3"))
    }

    @Test
    fun `ErrorClassifier classifies network connection timeout as possible cause`() {
        val classified = ErrorClassifier.fromThrowable(
            java.net.SocketTimeoutException("Read timed out after 30000ms"),
            operation = "Sync Roster",
        )

        assertEquals(ErrorCategory.NETWORK, classified.category)
        assertEquals("Network Connection Failed", classified.headline)
        assertEquals(CauseConfidence.POSSIBLE, classified.confidence)
        assertTrue(classified.canRetry)
    }
}

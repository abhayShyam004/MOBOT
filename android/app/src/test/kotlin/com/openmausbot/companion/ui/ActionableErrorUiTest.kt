package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ActionableRecovery
import com.openmausbot.companion.core.CauseConfidence
import com.openmausbot.companion.core.ErrorCategory
import com.openmausbot.companion.core.ErrorClassifier
import com.openmausbot.companion.core.ErrorDiagnostics
import com.openmausbot.companion.core.StructuredAppError
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ActionableErrorUiTest {

    @Test
    fun `structured error contains all 3 core answers for UI presentation`() {
        val error = ErrorClassifier.classify(
            operation = "Deploy to Vercel",
            rawMessage = "401 Unauthorized: Invalid Vercel token: ver_1234567890abcdef",
            statusCode = 401,
        )

        // Question 1: What failed?
        assertEquals("Deploy to Vercel", error.operation)
        assertEquals("Cloud Deployment Authentication Failed", error.headline)

        // Question 2: Why did it fail? (Confirmed vs Possible)
        assertEquals(CauseConfidence.CONFIRMED, error.confidence)
        assertTrue(error.explanation.contains("HTTP 401 Unauthorized"))

        // Question 3: What to do next? (Numbered steps)
        assertTrue(error.nextSteps.isNotEmpty())
        assertEquals(3, error.nextSteps.size)
        assertTrue(error.nextSteps[0].contains("settings", ignoreCase = true))

        // Actions
        assertTrue(error.actions.contains(ActionableRecovery.OPEN_SETTINGS))
        assertTrue(error.actions.contains(ActionableRecovery.COPY_DIAGNOSTICS))

        // Sanitization
        assertFalse(error.diagnostics.rawMessage.contains("ver_1234567890abcdef"))
        assertTrue(error.diagnostics.rawMessage.contains("ver_...[REDACTED]"))
    }

    @Test
    fun `preview failure answers What Why and What next with auto fix prompt`() {
        val error = ErrorClassifier.classify(
            operation = "Local HTML Preview",
            rawMessage = "Preview server error: listen EADDRINUSE: address already in use 127.0.0.1:3006",
        )

        assertEquals(ErrorCategory.PREVIEW_SERVER, error.category)
        assertEquals("Local HTML Preview", error.operation)
        assertEquals(CauseConfidence.CONFIRMED, error.confidence)
        assertTrue(error.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
        assertTrue(error.actions.contains(ActionableRecovery.RETRY))
        assertNotNull(error.retryPrompt)
        assertTrue(error.retryPrompt!!.contains("preview"))
    }

    @Test
    fun `tool execution failure classifies into TOOL_EXECUTION and provides fix automatically prompt`() {
        val error = ErrorClassifier.classify(
            operation = "tool_bash_execute",
            rawMessage = "/system/bin/sh: command not found: unknown_binary_tool",
        )

        assertEquals(ErrorCategory.TOOL_EXECUTION, error.category)
        assertEquals("tool_bash_execute", error.operation)
        assertEquals("Tool Command Execution Failed", error.headline)
        assertEquals(CauseConfidence.CONFIRMED, error.confidence)
        assertTrue(error.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
        assertTrue(error.actions.contains(ActionableRecovery.RETRY))
        assertTrue(error.actions.contains(ActionableRecovery.COPY_DIAGNOSTICS))
        assertNotNull(error.retryPrompt)
        assertTrue(error.retryPrompt!!.contains("unknown_binary_tool"))
    }

    @Test
    fun `build and test failures classify into BUILD_SYSTEM and TEST_SYSTEM respectively`() {
        val buildError = ErrorClassifier.classify(
            operation = "Project Build",
            rawMessage = "Syntax error: Unexpected token ';' at line 42. Compilation failed with exit code 1",
        )
        assertEquals(ErrorCategory.BUILD_SYSTEM, buildError.category)
        assertEquals("Project Build Failed", buildError.headline)
        assertTrue(buildError.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
        assertTrue(buildError.actions.contains(ActionableRecovery.RETRY))

        val testError = ErrorClassifier.classify(
            operation = "Run Tests",
            rawMessage = "AssertionError: expected true but was false. 3 tests failed.",
        )
        assertEquals(ErrorCategory.TEST_SYSTEM, testError.category)
        assertEquals("Test Suite Execution Failed", testError.headline)
        assertTrue(testError.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
    }

    @Test
    fun `network connection and timeout failures classify with POSSIBLE confidence and retry action`() {
        val netError = ErrorClassifier.classify(
            operation = "Sync Workspace",
            error = java.net.SocketTimeoutException("Read timed out after 10000ms"),
        )

        assertEquals(ErrorCategory.NETWORK, netError.category)
        assertEquals(CauseConfidence.POSSIBLE, netError.confidence)
        assertEquals("Network Connection Failed", netError.headline)
        assertTrue(netError.canRetry)
        assertTrue(netError.actions.contains(ActionableRecovery.RETRY))
        assertFalse(netError.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY))
    }

    @Test
    fun `secret sanitizer masks Vercel Render GitHub OpenAI keys and bearer tokens`() {
        val sensitiveLog = """
            Connecting with Vercel token ver_abcdef1234567890
            Connecting with Render token rnd_live9876543210zyxw
            GitHub token: ghp_1234567890abcdefghijklmnopqrstuv
            Model key: sk-live1234567890abcdef
            Authorization: Bearer token_secret_string_12345
            Payload: {"api_key": "super_secret_password_value"}
        """.trimIndent()

        val sanitized = com.openmausbot.companion.core.SecretSanitizer.sanitize(sensitiveLog)

        assertFalse(sanitized.contains("ver_abcdef1234567890"))
        assertTrue(sanitized.contains("ver_...[REDACTED]"))

        assertFalse(sanitized.contains("rnd_live9876543210zyxw"))
        assertTrue(sanitized.contains("rnd_...[REDACTED]"))

        assertFalse(sanitized.contains("ghp_1234567890abcdefghijklmnopqrstuv"))
        assertTrue(sanitized.contains("ghp_...[REDACTED]"))

        assertFalse(sanitized.contains("sk-live1234567890abcdef"))
        assertTrue(sanitized.contains("sk-...[REDACTED]"))

        assertFalse(sanitized.contains("token_secret_string_12345"))
        assertTrue(sanitized.contains("[REDACTED_TOKEN]"))

        assertFalse(sanitized.contains("super_secret_password_value"))
        assertTrue(sanitized.contains("\"api_key\": \"[REDACTED]\""))
    }

    @Test
    fun `diagnostic report contains all structured fields in plain text`() {
        val error = ErrorClassifier.classify(
            operation = "Deploy to Render",
            rawMessage = "401 Unauthorized: Invalid Render token: rnd_secret1234567890",
            statusCode = 401,
            correlationId = "corr-1234",
            turnId = "turn-5678",
        )

        val report = error.toDiagnosticReport()

        assertTrue(report.contains("=== MOBOT Failure Diagnostic Report ==="))
        assertTrue(report.contains("Category: DEPLOYMENT"))
        assertTrue(report.contains("Operation: Deploy to Render"))
        assertTrue(report.contains("Correlation ID: corr-1234"))
        assertTrue(report.contains("Turn ID: turn-5678"))
        assertTrue(report.contains("rnd_...[REDACTED]"))
        assertFalse(report.contains("rnd_secret1234567890"))
    }
}


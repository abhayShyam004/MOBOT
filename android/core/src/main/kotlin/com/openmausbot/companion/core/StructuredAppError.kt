package com.openmausbot.companion.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlinx.serialization.Serializable

/**
 * Global Structured Error Model for MOBOT.
 *
 * Guarantees every failure in the application answers three core questions:
 * 1. What failed? ([operation])
 * 2. Why did it fail? ([explanation], [confidence])
 * 3. What should I do next? ([nextSteps], [actions])
 *
 * Provides sanitized diagnostic details without leaking sensitive credentials.
 */

@Serializable
enum class ErrorCategory {
    PROVIDER,
    NETWORK,
    TOOL_EXECUTION,
    BUILD_SYSTEM,
    TEST_SYSTEM,
    PREVIEW_SERVER,
    DEPLOYMENT,
    STORAGE_IO,
    PERMISSION,
    INTERNAL_RUNTIME,
    USER_INPUT,
    UNKNOWN,
}

@Serializable
enum class CauseConfidence {
    CONFIRMED,
    POSSIBLE,
}

@Serializable
enum class ActionableRecovery {
    RETRY,
    FIX_AUTOMATICALLY,
    OPEN_SETTINGS,
    OPEN_PREVIEW,
    VIEW_LOGS,
    COPY_DIAGNOSTICS,
    DISMISS,
}

@Serializable
data class ErrorDiagnostics(
    val rawMessage: String,
    val statusCode: Int? = null,
    val stackTrace: String? = null,
    val sanitizedLogs: String? = null,
    val failedOperation: String,
    val timestamp: String,
    val correlationId: String? = null,
    val turnId: String? = null,
)

@Serializable
data class StructuredAppError(
    val id: String = UUID.randomUUID().toString(),
    val category: ErrorCategory,
    val operation: String,
    val headline: String,
    val explanation: String,
    val confidence: CauseConfidence = CauseConfidence.CONFIRMED,
    val nextSteps: List<String>,
    val actions: List<ActionableRecovery>,
    val diagnostics: ErrorDiagnostics,
    val canRetry: Boolean = false,
    val isIdempotent: Boolean = false,
    val retryPrompt: String? = null,
) {
    /** Formats a complete diagnostic dump suitable for clipboard copying. */
    fun toDiagnosticReport(): String {
        val stepsFormatted = nextSteps.mapIndexed { idx, s -> "  ${idx + 1}. $s" }.joinToString("\n")
        return buildString {
            appendLine("=== MOBOT Failure Diagnostic Report ===")
            appendLine("Error ID: $id")
            appendLine("Timestamp: ${diagnostics.timestamp}")
            appendLine("Category: $category")
            appendLine("Operation: $operation")
            appendLine("Headline: $headline")
            appendLine("Confidence: $confidence")
            appendLine("Explanation: $explanation")
            if (diagnostics.statusCode != null) {
                appendLine("HTTP / Exit Code: ${diagnostics.statusCode}")
            }
            if (diagnostics.correlationId != null) {
                appendLine("Correlation ID: ${diagnostics.correlationId}")
            }
            if (diagnostics.turnId != null) {
                appendLine("Turn ID: ${diagnostics.turnId}")
            }
            appendLine()
            appendLine("Recommended Next Steps:")
            appendLine(stepsFormatted)
            appendLine()
            appendLine("Raw Details (Sanitized):")
            appendLine(diagnostics.rawMessage)
            if (!diagnostics.sanitizedLogs.isNullOrBlank()) {
                appendLine()
                appendLine("Logs Tail:")
                appendLine(diagnostics.sanitizedLogs)
            }
            if (!diagnostics.stackTrace.isNullOrBlank()) {
                appendLine()
                appendLine("Stack Trace:")
                appendLine(diagnostics.stackTrace)
            }
            appendLine("========================================")
        }
    }
}

/**
 * Sanitizes and redacts credentials, bearer tokens, API keys, and sensitive data from diagnostics.
 */
object SecretSanitizer {
    private val PATTERNS = listOf(
        // Bearer tokens
        Regex("""(?i)\b(bearer\s+)[a-zA-Z0-9_\-\.]{8,}""") to "$1[REDACTED_TOKEN]",
        // OpenAI / Anthropic / Generic API keys
        Regex("""\b(sk-[a-zA-Z0-9_\-]{8,})""") to "sk-...[REDACTED]",
        // Vercel tokens
        Regex("""\b(ver_[a-zA-Z0-9_\-]{8,})""") to "ver_...[REDACTED]",
        // Render tokens
        Regex("""\b(rnd_[a-zA-Z0-9_\-]{8,})""") to "rnd_...[REDACTED]",
        // GitHub Personal Access Tokens
        Regex("""\b(ghp_[a-zA-Z0-9]{8,})""") to "ghp_...[REDACTED]",
        // JSON key-value secrets
        Regex("""(?i)"(api[_-]?key|token|secret|password|access[_-]?token)"\s*:\s*"[^"]+"""") to "\"$1\": \"[REDACTED]\"",
        // Query param secrets
        Regex("""(?i)([?&](api[_-]?key|token|key|password|secret)=)[^&\s]+""") to "$1[REDACTED]",
        // PEM Private keys
        Regex("""-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----""") to "[REDACTED_PRIVATE_KEY]",
    )

    fun sanitize(input: String?): String {
        if (input.isNullOrBlank()) return ""
        var sanitized: String = input
        for ((regex, replacement) in PATTERNS) {
            sanitized = regex.replace(sanitized, replacement)
        }
        return sanitized
    }

    fun currentIsoTimestamp(): String {
        val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        df.timeZone = TimeZone.getTimeZone("UTC")
        return df.format(Date())
    }
}

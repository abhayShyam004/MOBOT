package com.openmausbot.companion.core

import java.io.PrintWriter
import java.io.StringWriter

/**
 * Universal Error Classifier for MOBOT.
 *
 * Transforms any failure (APIError, Throwable, FailureCard, ToolActivity,
 * or raw error strings) into a [StructuredAppError] that guarantees:
 * 1. What failed? ([StructuredAppError.operation], [StructuredAppError.headline])
 * 2. Why did it fail? ([StructuredAppError.explanation], [StructuredAppError.confidence])
 * 3. What to do next? ([StructuredAppError.nextSteps], [StructuredAppError.actions])
 */
object ErrorClassifier {

    fun classify(
        operation: String = "Application Operation",
        error: Throwable? = null,
        rawMessage: String? = null,
        statusCode: Int? = null,
        stackTrace: String? = null,
        sanitizedLogs: String? = null,
        correlationId: String? = null,
        turnId: String? = null,
        retryPrompt: String? = null,
    ): StructuredAppError {
        val message = rawMessage ?: error?.message ?: "An unexpected error occurred."
        val effectiveStatusCode = statusCode ?: (error as? APIError.Status)?.code
        val effectiveStackTrace = stackTrace ?: error?.let { extractStackTrace(it) }

        val lower = message.lowercase()

        // 1. Authentication Failures (HTTP 401, Invalid API key / token)
        if (effectiveStatusCode == 401 ||
            containsAny(lower, "unauthorized", "invalid api key", "invalid api-key", "api key not valid", "missing api key", "no api key", "pairing expired", "revoked", "invalid token")
        ) {
            val isDeployment = containsAny(lower, "vercel", "render", "deploy") || containsAny(operation.lowercase(), "vercel", "render", "deploy")
            val isPairing = containsAny(lower, "pairing", "companion", "phone is not paired", "not paired")
            val headline = when {
                isDeployment -> "Cloud Deployment Authentication Failed"
                isPairing -> "Phone Pairing Expired or Revoked"
                else -> "Model Provider Authentication Failed"
            }
            val category = when {
                isDeployment -> ErrorCategory.DEPLOYMENT
                isPairing -> ErrorCategory.PERMISSION
                else -> ErrorCategory.PROVIDER
            }
            val explanation = when {
                isDeployment -> "The cloud deployment provider rejected the authentication token with HTTP 401 Unauthorized. The Personal Access Token is missing, expired, or revoked."
                isPairing -> "The host computer rejected this phone's authentication token. The pairing session has expired or was removed."
                else -> "The model provider rejected the request with HTTP 401 Unauthorized. The API key is missing, invalid, or expired."
            }
            val steps = when {
                isDeployment -> listOf(
                    "Open Cloud Deployment settings (Vercel & Render) in MOBOT.",
                    "Verify or generate a new Personal Access Token with full deployment scope.",
                    "Retry the deployment once credentials have been saved."
                )
                isPairing -> listOf(
                    "Open MOBOT settings or scan the host QR code to re-pair.",
                    "Ensure your host computer is powered on and running the companion server.",
                    "Verify both devices are on the same local network or tailnet."
                )
                else -> listOf(
                    "Open Model Provider settings in MOBOT.",
                    "Enter a valid API key for the selected provider.",
                    "Retry the request once credentials are saved."
                )
            }
            val actions = when {
                isDeployment -> listOf(ActionableRecovery.OPEN_SETTINGS, ActionableRecovery.RETRY, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS)
                else -> listOf(ActionableRecovery.OPEN_SETTINGS, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS)
            }
            return StructuredAppError(
                category = category,
                operation = operation,
                headline = headline,
                explanation = explanation,
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = steps,
                actions = actions,
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = isDeployment,
                isIdempotent = false,
            )
        }

        // 2. Permission / Forbidden (HTTP 403)
        if (effectiveStatusCode == 403 || containsAny(lower, "forbidden", "permission denied", "access denied", "not allowed")) {
            return StructuredAppError(
                category = ErrorCategory.PERMISSION,
                operation = operation,
                headline = "Access Permission Refused",
                explanation = "The provider or host server responded with HTTP 403 Forbidden. Your account or device does not have permission for this resource.",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Check permission levels on the provider or service dashboard.",
                    "Switch to an authorized model or project role in settings.",
                    "Contact the workspace administrator if access was restricted."
                ),
                actions = listOf(ActionableRecovery.OPEN_SETTINGS, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = false,
                isIdempotent = false,
            )
        }

        // 3. Provider Quota & Rate Limit (HTTP 429)
        if (effectiveStatusCode == 429 || containsAny(lower, "rate limit", "rate_limit", "quota", "too many requests", "tokens per minute", "exceeded your current quota")) {
            return StructuredAppError(
                category = ErrorCategory.PROVIDER,
                operation = operation,
                headline = "Provider Rate Limit or Quota Exceeded",
                explanation = "The model provider answered HTTP 429 Too Many Requests or reported that your account usage quota has been exhausted.",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Wait 30-60 seconds for the provider rate window to reset, then tap Retry.",
                    "Check your account billing tier and credits on the provider dashboard.",
                    "Switch to another configured provider model in bot settings if needed."
                ),
                actions = listOf(ActionableRecovery.RETRY, ActionableRecovery.OPEN_SETTINGS, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = true,
                isIdempotent = true,
                retryPrompt = retryPrompt,
            )
        }

        // 4. Resource Not Found (HTTP 404)
        if (effectiveStatusCode == 404 ||
            (containsAny(lower, "not found", "404 not found", "no longer there") && !containsAny(lower, "command not found", "tool"))
        ) {
            return StructuredAppError(
                category = ErrorCategory.STORAGE_IO,
                operation = operation,
                headline = "Resource or Endpoint Not Found",
                explanation = "The requested file, bot task, thread, or API route does not exist or was deleted (HTTP 404).",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Verify the target project, task, or file still exists.",
                    "Refresh the list or view to sync with the current host state.",
                    "Tap Dismiss to return to the active workspace."
                ),
                actions = listOf(ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = false,
                isIdempotent = false,
            )
        }

        // 5. Preview Server Failures (HTML/local preview, bind errors, port conflicts)
        if (containsAny(lower, "preview failed", "preview server", "preview crashed", "eaddrinuse", "127.0.0.1:3006", "cannot bind to port", "preview unreachable")) {
            return StructuredAppError(
                category = ErrorCategory.PREVIEW_SERVER,
                operation = operation.ifBlank { "Local HTML Preview" },
                headline = "Preview Server Failed to Run",
                explanation = "The local project preview server could not start or is not responding on the configured port. A port collision or missing entrypoint file is likely.",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Tap 'Fix automatically' to let MOBOT inspect running preview processes and restart.",
                    "Check whether index.html or project entrypoint exists in the project root.",
                    "Verify port 3006 is not occupied by an orphaned process."
                ),
                actions = listOf(ActionableRecovery.FIX_AUTOMATICALLY, ActionableRecovery.RETRY, ActionableRecovery.VIEW_LOGS, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = true,
                isIdempotent = true,
                retryPrompt = "Fix local HTML preview server: check process status, bind address 0.0.0.0 / 127.0.0.1, and ensure index.html serves cleanly.",
            )
        }

        // 6. Build & Test Failures (compiler errors, exit code != 0, test failure)
        if (containsAny(lower, "build failed", "compilation failed", "syntax error", "test failed", "npm run build failed", "tests failed", "exit code 1", "exit code 2")) {
            val isTest = containsAny(lower, "test failed", "tests failed", "assertionerror", "assert")
            return StructuredAppError(
                category = if (isTest) ErrorCategory.TEST_SYSTEM else ErrorCategory.BUILD_SYSTEM,
                operation = operation.ifBlank { if (isTest) "Test Execution" else "Project Build" },
                headline = if (isTest) "Test Suite Execution Failed" else "Project Build Failed",
                explanation = "The runner terminated with a non-zero exit code. " +
                    if (isTest) "One or more automated assertions failed." else "Source files contain syntax or compilation errors.",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Tap 'Fix automatically' to ask MOBOT to analyze the compiler logs and fix the source code.",
                    "Review the error output in the diagnostic details below.",
                    "Re-run the build or test after code fixes are applied."
                ),
                actions = listOf(ActionableRecovery.FIX_AUTOMATICALLY, ActionableRecovery.RETRY, ActionableRecovery.VIEW_LOGS, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = true,
                isIdempotent = false,
                retryPrompt = if (isTest) "Inspect failing tests and fix the implementation to make the test suite pass." else "Analyze build failure output and resolve the compilation errors.",
            )
        }

        // 7. Deployment Failures (Vercel, Render, cloud deploy)
        if (containsAny(lower, "deployment error", "deployment failed", "failed to deploy", "vercel", "deploy error")) {
            return StructuredAppError(
                category = ErrorCategory.DEPLOYMENT,
                operation = operation.ifBlank { "Cloud Deployment" },
                headline = "Application Deployment Failed",
                explanation = "The deployment provider rejected the bundle or encountered a build error during cloud provisioning.",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Review provider build logs for compilation or dependency issues.",
                    "Check provider credentials and token permissions in deployment settings.",
                    "Retry the deployment once settings and project files are verified."
                ),
                actions = listOf(ActionableRecovery.RETRY, ActionableRecovery.OPEN_SETTINGS, ActionableRecovery.VIEW_LOGS, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = true,
                isIdempotent = false,
                retryPrompt = "Diagnose cloud deployment failure and retry provisioning.",
            )
        }

        // 8. Tool Execution Failures
        if (containsAny(lower, "tool failed", "command failed", "execution failed", "spawn", "enoent", "command not found")) {
            return StructuredAppError(
                category = ErrorCategory.TOOL_EXECUTION,
                operation = operation.ifBlank { "Tool Execution" },
                headline = "Tool Command Execution Failed",
                explanation = "The tool encountered a runtime error or non-zero exit status during execution. The system command or tool script failed.",
                confidence = CauseConfidence.CONFIRMED,
                nextSteps = listOf(
                    "Tap 'Fix automatically' to prompt the bot to diagnose and resolve the command issue.",
                    "Check tool parameters and execution logs in the technical details below.",
                    "Retry if this was caused by a temporary lock or transient resource condition."
                ),
                actions = listOf(ActionableRecovery.FIX_AUTOMATICALLY, ActionableRecovery.RETRY, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = true,
                isIdempotent = false,
                retryPrompt = "The tool command failed with error: $message. Please inspect the cause and resolve it.",
            )
        }

        // 9. Network Connection & Offline Failures
        if (error is java.net.ConnectException ||
            error is java.net.SocketTimeoutException ||
            error is java.net.UnknownHostException ||
            containsAny(lower, "network", "connectexception", "sockettimeoutexception", "unknownhostexception", "offline", "connection refused", "econnrefused", "timeout", "timed out", "unreachable")
        ) {
            return StructuredAppError(
                category = ErrorCategory.NETWORK,
                operation = operation.ifBlank { "Network Communication" },
                headline = "Network Connection Failed",
                explanation = "Could not establish or maintain connection to the host server. The host may be sleeping, offline, or network routing failed.",
                confidence = CauseConfidence.POSSIBLE,
                nextSteps = listOf(
                    "Verify Wi-Fi or mobile data is connected on this device.",
                    "Ensure the host computer is awake and companion server is actively running.",
                    "Tap Retry to attempt re-establishing the network connection."
                ),
                actions = listOf(ActionableRecovery.RETRY, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
                diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
                canRetry = true,
                isIdempotent = true,
            )
        }

        // 10. Default / Unclassified Fallback
        return StructuredAppError(
            category = ErrorCategory.UNKNOWN,
            operation = operation,
            headline = "Operation Encountered an Error",
            explanation = "The operation could not complete: $message",
            confidence = CauseConfidence.POSSIBLE,
            nextSteps = listOf(
                "Review the diagnostic details and sanitized logs below.",
                "Tap 'Fix automatically' if this occurred during an AI conversation turn.",
                "Retry the operation or dismiss if no further action is needed."
            ),
            actions = listOf(ActionableRecovery.FIX_AUTOMATICALLY, ActionableRecovery.RETRY, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
            diagnostics = buildDiagnostics(message, effectiveStatusCode, effectiveStackTrace, sanitizedLogs, operation, correlationId, turnId),
            canRetry = true,
            isIdempotent = false,
            retryPrompt = "An error occurred during $operation: $message. Please analyze and fix.",
        )
    }

    fun fromThrowable(
        throwable: Throwable,
        operation: String = "Application Operation",
        turnId: String? = null,
    ): StructuredAppError {
        return classify(
            operation = operation,
            error = throwable,
            rawMessage = throwable.message,
            turnId = turnId,
        )
    }

    fun fromApiError(
        apiError: APIError,
        operation: String = "Network Request",
    ): StructuredAppError {
        return classify(
            operation = operation,
            error = apiError,
            rawMessage = apiError.message,
            statusCode = (apiError as? APIError.Status)?.code,
        )
    }

    fun fromFailureCard(
        card: FailureCard,
        chatThreadId: String? = null,
        turnId: String? = null,
    ): StructuredAppError {
        val kind = card.kind.lowercase()
        val category = when (kind) {
            "auth" -> ErrorCategory.PROVIDER
            "access" -> ErrorCategory.PERMISSION
            "quota", "rate_limit" -> ErrorCategory.PROVIDER
            "network" -> ErrorCategory.NETWORK
            "setup" -> ErrorCategory.INTERNAL_RUNTIME
            else -> ErrorCategory.PROVIDER
        }

        val actions = mutableListOf<ActionableRecovery>()
        if (kind != "setup") actions.add(ActionableRecovery.RETRY)
        if (kind in setOf("auth", "access", "quota", "model_unavailable", "setup")) actions.add(ActionableRecovery.OPEN_SETTINGS)
        actions.add(ActionableRecovery.COPY_DIAGNOSTICS)
        actions.add(ActionableRecovery.DISMISS)

        val steps = buildList {
            if (card.advice.isNotBlank()) add(card.advice)
            if (kind in setOf("auth", "access")) add("Update API key or authentication settings for ${card.provider ?: "provider"}.")
            if (kind != "setup") add("Tap Retry to run the turn again.")
            add("View diagnostic report if the error persists.")
        }

        return StructuredAppError(
            category = category,
            operation = listOfNotNull(card.provider, card.model).joinToString(" ").ifBlank { "Model Turn" },
            headline = card.title,
            explanation = card.detail,
            confidence = CauseConfidence.CONFIRMED,
            nextSteps = steps,
            actions = actions,
            diagnostics = buildDiagnostics(
                rawMessage = "${card.title}: ${card.detail}",
                statusCode = card.status,
                stackTrace = null,
                sanitizedLogs = "Attempts: ${card.attempts ?: 1}, Kind: ${card.kind}, Instance: ${card.instanceId ?: "none"}",
                operation = "Turn Execution (${card.provider ?: "Provider"})",
                correlationId = card.instanceId,
                turnId = turnId,
            ),
            canRetry = kind != "setup",
            isIdempotent = true,
        )
    }

    fun fromToolActivity(
        tool: ToolActivity,
        turnId: String? = null,
        chatThreadId: String? = null,
    ): StructuredAppError {
        val toolName = tool.name
        val rawErr = tool.error ?: tool.output ?: "Tool execution failed"
        val lower = rawErr.lowercase()

        val category = when {
            containsAny(lower, "preview", "3006") -> ErrorCategory.PREVIEW_SERVER
            containsAny(lower, "build", "compile") -> ErrorCategory.BUILD_SYSTEM
            containsAny(lower, "test", "assert") -> ErrorCategory.TEST_SYSTEM
            containsAny(lower, "deploy") -> ErrorCategory.DEPLOYMENT
            else -> ErrorCategory.TOOL_EXECUTION
        }

        val explanation = if (!tool.error.isNullOrBlank()) {
            "Tool '$toolName' failed: ${tool.error}"
        } else {
            "Tool '$toolName' returned a non-zero failure code without stderr output."
        }

        val steps = listOf(
            "Tap 'Fix automatically' to instruct the bot to diagnose and fix '$toolName'.",
            "Examine the sanitized tool output and parameters in the diagnostics section.",
            "Retry execution once required prerequisites are met."
        )

        return StructuredAppError(
            category = category,
            operation = "Tool '$toolName'",
            headline = "Tool Execution Failed: $toolName",
            explanation = explanation,
            confidence = CauseConfidence.CONFIRMED,
            nextSteps = steps,
            actions = listOf(ActionableRecovery.FIX_AUTOMATICALLY, ActionableRecovery.RETRY, ActionableRecovery.COPY_DIAGNOSTICS, ActionableRecovery.DISMISS),
            diagnostics = buildDiagnostics(
                rawMessage = rawErr,
                statusCode = null,
                stackTrace = null,
                sanitizedLogs = tool.output,
                operation = "Tool '$toolName'",
                correlationId = null,
                turnId = turnId,
            ),
            canRetry = true,
            isIdempotent = false,
            retryPrompt = "The tool '$toolName' failed with: $rawErr. Please inspect and fix the failure.",
        )
    }

    private fun buildDiagnostics(
        rawMessage: String,
        statusCode: Int?,
        stackTrace: String?,
        sanitizedLogs: String?,
        operation: String,
        correlationId: String?,
        turnId: String?,
    ): ErrorDiagnostics {
        return ErrorDiagnostics(
            rawMessage = SecretSanitizer.sanitize(rawMessage),
            statusCode = statusCode,
            stackTrace = stackTrace?.let { SecretSanitizer.sanitize(it) },
            sanitizedLogs = sanitizedLogs?.let { SecretSanitizer.sanitize(it) },
            failedOperation = operation,
            timestamp = SecretSanitizer.currentIsoTimestamp(),
            correlationId = correlationId,
            turnId = turnId,
        )
    }

    private fun extractStackTrace(throwable: Throwable): String {
        val sw = StringWriter()
        val pw = PrintWriter(sw)
        throwable.printStackTrace(pw)
        return sw.toString()
    }

    private fun containsAny(text: String, vararg keywords: String): Boolean {
        for (kw in keywords) {
            if (text.contains(kw)) return true
        }
        return false
    }
}

package com.openmausbot.companion.ui

/**
 * What an API/runtime failure says to a person — the rules behind
 * [RootScreen]'s error dialog.
 *
 * The raw provider message stays on the dialog, smaller and always present:
 * classification rewrites the headline and the explanation, never the evidence.
 * A 401 must not become "Something went wrong", and "Something went wrong" must
 * not become a fake explanation either — the arms below only fire on text the
 * failure actually carried, and everything else keeps the raw message as the
 * whole body.
 */
object ApiErrorRules {
    data class Classification(
        val title: String,
        val explanation: String,
        /**
         * The provider's own words, shown under the explanation — never its
         * payload. See [withoutPayload]: a report whose body is a JSON object
         * is described, not quoted.
         */
        val detail: String?,
        /** True when the remedy lives in model-provider settings. */
        val configureProviders: Boolean,
    )

    fun classify(raw: String): Classification {
        val text = raw.trim()
        if (text.isEmpty()) {
            return Classification(
                title = "Something went wrong",
                explanation = "The request could not be completed.",
                detail = null,
                configureProviders = false,
            )
        }
        val lower = text.lowercase()
        val detail = withoutPayload(text)
        return when {
            // Engine CLIs live on the host: the codex/claude/pi account sign-in
            // flows answer this when the host lacks the binary, and engine
            // install says it about npm. The remedy is on the host computer,
            // not in provider settings — say so instead of a shrug.
            containsAny(lower, "not installed on this server") ->
                Classification(
                    title = "The engine is not installed on this host",
                    explanation = "This model engine runs on the host computer, and its command-line tool is not installed there. The engine's own message is below.",
                    detail = detail,
                    configureProviders = false,
                )
            // Authentication. "invalid api key" arrives verbatim from
            // OpenAI-compatible providers; "401"/"unauthorized" from the rest.
            containsAny(lower, "401", "unauthorized", "invalid api key", "invalid api-key", "api key not valid", "missing api key", "no api key", "credential") ->
                Classification(
                    title = "Model authentication needed",
                    explanation = "The model provider rejected the request with HTTP 401 Unauthorized. " +
                        "The saved API key may be missing or no longer valid.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "403", "forbidden", "permission denied", "not allowed") ->
                Classification(
                    title = "The provider refused the request",
                    explanation = "The model provider answered HTTP 403 Forbidden. " +
                        "The account behind the saved key may not have access to this model.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "404", "not found") ->
                Classification(
                    title = "Model or endpoint not found",
                    explanation = "The model provider answered HTTP 404 Not Found. " +
                        "The model id may no longer exist on this provider.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "deployment error", "deployment failed", "failed to deploy") ->
                Classification(
                    title = "Deployment failed",
                    explanation = "The application deployment failed to complete. Review build and container logs.",
                    detail = detail,
                    configureProviders = false,
                )
            containsAny(lower, "preview failed", "preview server error", "preview crashed") ->
                Classification(
                    title = "Preview server error",
                    explanation = "The local preview server could not start or stopped unexpectedly.",
                    detail = detail,
                    configureProviders = false,
                )
            containsAny(lower, "malformed response", "invalid response format", "unexpected response body", "parse error in stream") ->
                Classification(
                    title = "Malformed provider response",
                    explanation = "The model provider returned an invalid or unparseable response stream.",
                    detail = detail,
                    configureProviders = false,
                )
            containsAny(lower, "local runtime failure", "companion host crash", "unhandled runtime error") ->
                Classification(
                    title = "Local runtime failure",
                    explanation = "The local execution environment encountered an internal error.",
                    detail = detail,
                    configureProviders = false,
                )
            containsAny(lower, "invalid configuration", "malformed url", "invalid endpoint url", "invalid base url") ->
                Classification(
                    title = "Invalid provider configuration",
                    explanation = "The provider endpoint URL or parameters are incorrectly formatted.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "insufficient_quota", "out of credits", "quota exceeded", "zero balance", "billing account") ->
                Classification(
                    title = "Out of credits or quota",
                    explanation = "The provider account has run out of credits or reached its usage quota. Add credits or switch models.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "429", "rate limit", "too many requests", "quota") ->
                Classification(
                    title = "The provider is rate-limiting",
                    explanation = "The model provider answered HTTP 429 Too Many Requests. " +
                        "Wait a moment and try again.",
                    detail = detail,
                    configureProviders = false,
                )
            containsAny(lower, "timed out", "timeout", "etimedout") ->
                Classification(
                    title = "The provider did not respond in time",
                    explanation = "The request to the model provider timed out. " +
                        "This is usually temporary — try again.",
                    detail = detail,
                    configureProviders = false,
                )
            containsAny(lower, "offline", "unable to resolve", "econnrefused", "econnreset", "enotfound", "network", "connect", "fetch failed", "certificate", "getaddrinfo") ->
                Classification(
                    title = "Could not reach the provider",
                    explanation = "This device could not reach the model provider over the network. " +
                        "Check the base URL and connectivity, then try again.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "no model provider", "no providers", "not configured", "no model is available", "provider is unavailable", "no available model", "missing model", "model is unavailable", "pick another model") ->
                Classification(
                    title = "Model not configured",
                    explanation = "No model provider is configured or currently available. " +
                        "Add a provider or fix the existing one to keep working.",
                    detail = detail,
                    configureProviders = true,
                )
            containsAny(lower, "500", "502", "503", "504", "bad gateway", "internal server error", "server error") ->
                Classification(
                    title = "The provider had an internal error",
                    explanation = "The model provider failed on its side. Its own words are below — " +
                        "retrying is usually right.",
                    detail = detail,
                    configureProviders = false,
                )
            else ->
                // No pattern matched: say nothing the failure did not say. What
                // it said in words is the honest body, unchanged — and if it
                // said it in a payload, there is no body to show, so the
                // explanation admits that rather than printing the payload.
                Classification(
                    title = "Something went wrong",
                    explanation = detail
                        ?: "The provider reported an error the app could not read as words. The computer's log has the details.",
                    detail = null,
                    configureProviders = false,
                )
        }
    }

    private fun containsAny(lower: String, vararg needles: String): Boolean =
        needles.any { lower.contains(it) }

    /**
     * A report with its machine payload taken out.
     *
     * `upstream HTTP 429: {"error":{"message":"…"}}` keeps `upstream HTTP
     * 429`; a report that is nothing but JSON keeps nothing at all. A truncated
     * JSON object is not an explanation, and a screen that shows one has failed
     * the person reading it — which is exactly the defect the turn-failure card
     * exists to end. Nothing here interprets the payload; it only removes it,
     * at the first brace or bracket, so the head of the line survives when there
     * is one.
     */
    fun withoutPayload(raw: String): String? {
        val head = raw.trim().substringBefore('{').substringBefore('[')
        val cleaned = head.trim().trimEnd(':', ',', '-', ' ').trim()
        return cleaned.takeIf { it.isNotEmpty() && it.length <= 200 }
    }
}

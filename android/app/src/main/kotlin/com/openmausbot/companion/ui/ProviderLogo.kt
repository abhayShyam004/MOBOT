package com.openmausbot.companion.ui

import androidx.annotation.DrawableRes
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Instance

/**
 * The logo a provider is known by, when this app ships one.
 *
 * Providers used to be drawn as one letter of their name — "C" for Claude, "C"
 * for Cursor, "C" for a gateway someone named "Chatbox" — so a list of engines
 * read as the same row six times and the letter said nothing about who the
 * provider actually was. A real mark settles that at a glance: the same
 * provider is the same picture on every screen that names it, and the picture
 * is one the person already recognises from the provider's own site.
 *
 * The marks are bundled (fetched once from each provider's own site and from
 * Simple Icons / Wikimedia Commons), so nothing is requested at runtime and a
 * provider still shows its logo with the network down. A provider with no
 * bundled mark — someone's private gateway named "home box" — keeps the letter
 * it had before: a wrong logo would be worse than none.
 *
 * **Who has earned a mark.** A mark is a claim about *whose* engine is
 * answering, and only the driver can make that claim: `claudeAgent` is Claude,
 * `codex` is OpenAI's, `grokAgent` is xAI's. A compatible endpoint is the one
 * case where the driver says the opposite — `openai-compat` and
 * `anthropic-compat` name a *wire protocol*, not a company — so those keep the
 * letter whatever they are called. That distinction is the whole rule, and it
 * exists because the words were being trusted too far: an endpoint someone
 * added and named "OpenAI-compatible (OpenRouter / Groq)" was wearing
 * OpenRouter's mark, and a gateway named "Test gateway" was wearing OpenAI's,
 * on the strength of a name a person typed and a protocol everyone speaks. The
 * covers were the complaint: a screen that lists what this host can actually
 * run must not dress a bare API-key endpoint as a provider the app has an
 * integration with.
 *
 * Matching is by substring over the two words that can carry an engine's
 * identity once the driver has passed that test (its display name and its
 * instance id), most specific first, so "Anthropic" does not lose to a driver
 * called "openai-compat".
 */
internal object ProviderLogo {
    /**
     * Keyword → mark, most specific first: a longer keyword must be tested
     * before a shorter one it contains ("openrouter" before "openai" is
     * unnecessary, "claude" before "anthropic" is not — they simply are not the
     * same word, and the order keeps the first match stable).
     */
    private val known: List<Pair<String, Int>> = listOf(
        "openrouter" to R.drawable.provider_openrouter,
        "anthropic" to R.drawable.provider_anthropic,
        "perplexity" to R.drawable.provider_perplexity,
        "deepseek" to R.drawable.provider_deepseek,
        "mistral" to R.drawable.provider_mistral,
        "googlegemini" to R.drawable.provider_gemini,
        "gemini" to R.drawable.provider_gemini,
        // Google's own ACP server for the Gemini family, which is how the
        // default fleet reaches Google — a letter here would be a step back
        // from the mark the same company's models already draw elsewhere.
        "antigravity" to R.drawable.provider_gemini,
        "ollama" to R.drawable.provider_ollama,
        "claude" to R.drawable.provider_claude,
        "grok" to R.drawable.provider_grok,
        "groq" to R.drawable.provider_groq,
        "cursor" to R.drawable.provider_cursor,
        "qwen" to R.drawable.provider_qwen,
        "chatgpt" to R.drawable.provider_openai,
        "codex" to R.drawable.provider_openai,
        "openai" to R.drawable.provider_openai,
        "xai" to R.drawable.provider_grok,
    )

    /**
     * The drivers that speak a protocol rather than name a provider.
     *
     * Every OpenAI-shaped endpoint in the world runs through these, so what they
     * tell us is what the traffic looks like, never who answers it. See the
     * object's own note for why that has to end in a letter rather than a logo.
     */
    private val protocolDrivers: Set<String> = setOf("openai-compat", "anthropic-compat")

    /**
     * Map a declared provider preset name to a bundled drawable.
     */
    fun presetDrawable(preset: String): Int? {
        val key = preset.trim().lowercase()
        return when (key) {
            "openai" -> R.drawable.provider_openai
            "anthropic" -> R.drawable.provider_anthropic
            "google", "gemini" -> R.drawable.provider_gemini
            "deepseek" -> R.drawable.provider_deepseek
            "mistral" -> R.drawable.provider_mistral
            "qwen" -> R.drawable.provider_qwen
            "openrouter" -> R.drawable.provider_openrouter
            "groq" -> R.drawable.provider_groq
            "ollama" -> R.drawable.provider_ollama
            "xai", "grok" -> R.drawable.provider_grok
            "cursor" -> R.drawable.provider_cursor
            "perplexity" -> R.drawable.provider_perplexity
            "claude" -> R.drawable.provider_claude
            else -> known.firstOrNull { (kw, _) -> key.contains(kw) }?.second
        }
    }

    /** The mark for this instance, or null when it has not earned one. */
    fun drawableFor(instance: Instance): Int? {
        val explicitPreset = instance.icon?.takeIf { it.kind == "preset" }?.preset
        if (explicitPreset != null) {
            val presetMark = presetDrawable(explicitPreset)
            if (presetMark != null) return presetMark
        }
        val driver = instance.driverKind.trim().lowercase()
        if (driver in protocolDrivers) return null
        return markFor(
            words = listOf(instance.displayName.orEmpty(), instance.instanceId, driver),
        )
    }

    /**
     * The first mark named by any of [words] — null when none of them is a
     * provider this app knows.
     *
     * Case and spacing are folded away ("ChatGPT", "chatgpt" and "Chat GPT" are
     * the same words), because a display name is typed by whoever added the
     * provider and its capitalisation is not a fact about the brand.
     */
    private fun markFor(words: List<String>): Int? {
        val haystack = words.joinToString(" ").lowercase()
        if (haystack.isBlank()) return null
        return known.firstOrNull { (keyword, _) -> haystack.contains(keyword) }?.second
    }
}

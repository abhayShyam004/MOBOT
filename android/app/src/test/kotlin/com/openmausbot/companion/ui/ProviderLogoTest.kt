package com.openmausbot.companion.ui

import com.openmausbot.companion.R
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.ModelCatalog
import com.openmausbot.companion.core.ModelOption
import com.openmausbot.companion.core.ProviderSnapshot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A provider's mark is a claim about whose engine answers, so it may only be
 * drawn where something in the instance actually says so.
 *
 * The rule under test: the driver is what earns a mark. `claudeAgent`, `codex`,
 * `grokAgent` and the rest name a company's own integration, while
 * `openai-compat` and `anthropic-compat` name a wire protocol every gateway
 * speaks — and a name someone typed into "Add a provider" is not evidence of a
 * brand. Before this, an endpoint called "OpenAI-compatible (OpenRouter / Groq)"
 * wore OpenRouter's mark and a gateway called "Test gateway" wore OpenAI's,
 * which read as an integration the app does not have.
 */
class ProviderLogoTest {

    private fun instance(
        id: String,
        driverKind: String,
        displayName: String? = id,
    ) = Instance(
        instanceId = id,
        driverKind = driverKind,
        displayName = displayName,
        snapshot = ProviderSnapshot(state = "available"),
        models = ModelCatalog("m-1", listOf(ModelOption("m-1", "Model 1"))),
    )

    @Test
    fun `a brand driver earns its mark`() {
        assertEquals(R.drawable.provider_claude, ProviderLogo.drawableFor(instance("claude", "claudeAgent")))
        assertEquals(R.drawable.provider_openai, ProviderLogo.drawableFor(instance("codex", "codex")))
        assertEquals(R.drawable.provider_grok, ProviderLogo.drawableFor(instance("grok", "grokAgent")))
        assertEquals(R.drawable.provider_cursor, ProviderLogo.drawableFor(instance("cursor", "cursorAgent")))
        assertEquals(R.drawable.provider_qwen, ProviderLogo.drawableFor(instance("qwen", "qwenAgent")))
        // Google's own ACP server is how the default fleet reaches Gemini.
        assertEquals(R.drawable.provider_gemini, ProviderLogo.drawableFor(instance("antigravity", "antigravityAgent")))
    }

    @Test
    fun `a compatible endpoint keeps its letter, whatever it is called`() {
        // Both shapes seen on a real phone: a gateway named by its driver, and
        // an endpoint whose name advertises the router behind it.
        assertNull(
            ProviderLogo.drawableFor(instance("test-gateway", "openai-compat", displayName = "Test gateway")),
            "a protocol driver never claims a brand",
        )
        assertNull(
            ProviderLogo.drawableFor(
                instance(
                    "openaiCompat",
                    "openai-compat",
                    displayName = "OpenAI-compatible (OpenRouter / Groq)",
                ),
            ),
        )
        // And a name is not a credential even when it is a brand's own word:
        // someone's endpoint called "Claude" is still their endpoint.
        assertNull(ProviderLogo.drawableFor(instance("claude-proxy", "anthropic-compat", displayName = "Claude")))
    }

    @Test
    fun `an engine with no bundled mark keeps its letter`() {
        assertNull(ProviderLogo.drawableFor(instance("kimi", "kimiAgent", displayName = "Kimi")))
        assertNull(ProviderLogo.drawableFor(instance("computer", "boxAgent", displayName = "Computer")))
    }

    @Test
    fun `the mark follows the engine's own words, not their case`() {
        // A display name is typed by whoever added the provider.
        assertEquals(R.drawable.provider_claude, ProviderLogo.drawableFor(instance("work", "claudeAgent", displayName = "CLAUDE")))
        // The instance id counts too, for a fleet whose name was left blank.
        assertEquals(
            R.drawable.provider_mistral,
            ProviderLogo.drawableFor(instance("mistral-large", "acp-unknown", displayName = null)),
        )
    }

    @Test
    fun `an explicit preset icon on a compatible provider is honored`() {
        val customWithPreset = instance("my-deepseek", "openai-compat", displayName = "Private DeepSeek").copy(
            icon = com.openmausbot.companion.core.ProviderIconDto(kind = "preset", preset = "deepseek"),
        )
        assertEquals(R.drawable.provider_deepseek, ProviderLogo.drawableFor(customWithPreset))

        val customGroq = instance("my-groq", "openai-compat", displayName = "Fast Groq").copy(
            icon = com.openmausbot.companion.core.ProviderIconDto(kind = "preset", preset = "groq"),
        )
        assertEquals(R.drawable.provider_groq, ProviderLogo.drawableFor(customGroq))
    }
}

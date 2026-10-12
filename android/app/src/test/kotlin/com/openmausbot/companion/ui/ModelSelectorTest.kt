package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.InstanceCapabilities
import com.openmausbot.companion.core.ModelCatalog
import com.openmausbot.companion.core.ModelOption
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.ProviderSnapshot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What the model selector decides.
 *
 * The screen asks one question — which model — so these pin the three things that
 * answer it: which models are offered at all, what each one says about itself, and
 * what choosing it sets. The rule that shapes the page is that it is the *one*
 * provider's catalog: the provider was chosen on the row above, and another
 * engine's models below it would be the same decision offered twice.
 */
class ModelSelectorTest {
    private val codex = instance(
        "codex",
        default = "gpt-5.6-luna",
        options = listOf(
            "gpt-5.6-luna" to "GPT-5.6 Luna",
            "gpt-5.6-sol" to "GPT-5.6 Sol",
        ),
        efforts = listOf("low", "high"),
        images = true,
    )
    private val claude = instance(
        "claude",
        default = "opus-4.6",
        options = listOf("opus-4.6" to "Opus 4.6", "sonnet-4.6" to "Sonnet 4.6"),
        images = true,
    )
    private val gone = instance("gemini", default = "pro", options = listOf("pro" to "Pro"), available = false)
    private val saved = ModelSelection("codex", "gpt-5.6-luna", effort = "high")
    private val all = listOf(codex, claude, gone)

    @Test
    fun `only the selected provider's models are listed`() {
        val listing = ModelSelectorSpec.listing(all, saved)
        assertEquals(listOf("GPT-5.6 Luna", "GPT-5.6 Sol"), listing.map { it.label })
        assertTrue(listing.none { it.instanceId != "codex" }, "no other provider's models appear")
        assertTrue(listing.first().current, "the model in use is marked in the list")
        assertEquals(1, listing.count { it.current }, "and marked exactly once")
    }

    @Test
    fun `a provider with nothing available offers no models`() {
        val listing = ModelSelectorSpec.listing(listOf(codex, gone), ModelSelection("gemini", "pro"))
        assertTrue(listing.isEmpty(), "an unavailable provider cannot be chosen from")
    }

    @Test
    fun `an unknown provider offers no models`() {
        assertTrue(ModelSelectorSpec.listing(all, ModelSelection("home-box", "any")).isEmpty())
    }

    @Test
    fun `search filters within the provider, and clears back to everything`() {
        val byModel = ModelSelectorSpec.listing(all, saved, query = "sonnet")
        assertTrue(byModel.isEmpty(), "codex does not offer a Sonnet")

        val byModelInProvider = ModelSelectorSpec.listing(all, saved, query = "sol")
        assertEquals(listOf("GPT-5.6 Sol"), byModelInProvider.map { it.label })

        val none = ModelSelectorSpec.listing(all, saved, query = "gpt-7")
        assertTrue(none.isEmpty())

        val cleared = ModelSelectorSpec.listing(all, saved, query = "")
        assertEquals(2, cleared.size)
    }

    @Test
    fun `capabilities are only the facts the engine reported`() {
        assertEquals("Vision · Reasoning", ModelSelectorSpec.capabilities(codex))
        assertEquals("Vision", ModelSelectorSpec.capabilities(claude))
        assertEquals("", ModelSelectorSpec.capabilities(gone.copy(capabilities = null)))
        assertEquals("", ModelSelectorSpec.capabilities(null))
        assertEquals(
            "Vision · Reasoning · Steering",
            ModelSelectorSpec.capabilities(
                codex.copy(capabilities = InstanceCapabilities(images = true, effortLevels = listOf("low"), queueing = true)),
            ),
        )
        // A level list of blanks is not a capability.
        assertEquals(
            "Vision",
            ModelSelectorSpec.capabilities(
                claude.copy(capabilities = InstanceCapabilities(images = true, effortLevels = listOf(""))),
            ),
        )
    }

    @Test
    fun `changing model keeps the reasoning level, changing provider does not`() {
        val sameProvider = ModelSelectorSpec.pick(
            saved,
            SelectableModel("codex", "Codex", "gpt-5.6-sol", "GPT-5.6 Sol", "", false),
            all,
        )
        assertEquals(ModelSelection("codex", "gpt-5.6-sol", "high"), sameProvider)

        val otherProvider = ModelSelectorSpec.pick(
            saved,
            SelectableModel("claude", "Claude", "opus-4.6", "Opus 4.6", "", false),
            all,
        )
        assertEquals(ModelSelection("claude", "opus-4.6", null), otherProvider)

        // A level the provider no longer offers is dropped rather than carried.
        val trimmed = instance("codex", default = "gpt-5.6-luna", options = listOf("gpt-5.6-luna" to "Luna"), efforts = listOf("low"))
        assertEquals(
            ModelSelection("codex", "gpt-5.6-luna", null),
            ModelSelectorSpec.pick(
                saved,
                SelectableModel("codex", "Codex", "gpt-5.6-luna", "Luna", "", true),
                listOf(trimmed),
            ),
        )
    }

    @Test
    fun `a model id is only ever printed when no label exists for it`() {
        assertEquals("GPT-5.6 Luna", ModelSelectorSpec.labelFor(codex, "gpt-5.6-luna"))
        assertEquals("gpt-4-legacy", ModelSelectorSpec.labelFor(codex, "gpt-4-legacy"))
        assertEquals("stray-model", ModelSelectorSpec.labelFor(null, "stray-model"))
    }

    @Test
    fun `the current provider's selection survives a catalog that dropped it`() {
        val listing = ModelSelectorSpec.listing(listOf(codex), ModelSelection("codex", "gpt-4-legacy"))
        assertTrue(listing.any { it.modelId == "gpt-4-legacy" && it.current })
    }

    @Test
    fun `the provider page offers exactly what the settings row would`() {
        val rows = ProviderSelectorSpec.rows(all, selectedInstanceId = "codex")
        assertEquals(listOf("codex", "claude"), rows.map { it.instanceId }, "available providers only")
        assertTrue(rows.first { it.instanceId == "codex" }.selected)
        assertTrue(rows.none { it.selected && it.instanceId != "codex" })
        assertTrue(rows.all { it.available })
    }

    @Test
    fun `the provider in use is still listed when it has gone unavailable`() {
        val rows = ProviderSelectorSpec.rows(all, selectedInstanceId = "gemini")
        assertEquals(listOf("gemini", "codex", "claude"), rows.map { it.instanceId })
        val current = rows.first()
        assertTrue(current.selected)
        assertFalse(current.available, "an unavailable provider is shown, not offered")
    }

    private fun instance(
        id: String,
        default: String,
        options: List<Pair<String, String>>,
        efforts: List<String>? = null,
        images: Boolean? = null,
        available: Boolean = true,
    ) = Instance(
        instanceId = id,
        driverKind = id,
        displayName = id.replaceFirstChar { it.uppercase() },
        snapshot = ProviderSnapshot(state = if (available) "available" else "unavailable"),
        models = ModelCatalog(defaultModel = default, options = options.map { ModelOption(it.first, it.second) }),
        capabilities = InstanceCapabilities(images = images, effortLevels = efforts),
    )
}

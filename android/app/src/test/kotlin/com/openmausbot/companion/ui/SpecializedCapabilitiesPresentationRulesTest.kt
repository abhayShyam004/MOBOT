package com.openmausbot.companion.ui

import androidx.compose.ui.graphics.Color
import com.openmausbot.companion.core.CapabilityConfig
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Phase K: Specialized Capabilities Presentation Rules Test.
 */
class SpecializedCapabilitiesPresentationRulesTest {

    @Test
    fun `formats titles for specialized capability ids`() {
        assertEquals("Image Generation", SpecializedCapabilitiesPresentationRules.titleFor("image_generation"))
        assertEquals("Video Generation", SpecializedCapabilitiesPresentationRules.titleFor("video_generation"))
        assertEquals("Audio Generation", SpecializedCapabilitiesPresentationRules.titleFor("audio_generation"))
        assertEquals("Speech & TTS", SpecializedCapabilitiesPresentationRules.titleFor("speech_tts"))
        assertEquals("Music Generation", SpecializedCapabilitiesPresentationRules.titleFor("music_generation"))
        assertEquals("Vision Intelligence", SpecializedCapabilitiesPresentationRules.titleFor("vision_understanding"))
        assertEquals("Video Intelligence", SpecializedCapabilitiesPresentationRules.titleFor("video_understanding"))
        assertEquals("Audio Understanding", SpecializedCapabilitiesPresentationRules.titleFor("audio_understanding"))
    }

    @Test
    fun `groups capabilities into accurate categories`() {
        assertEquals("Generation", SpecializedCapabilitiesPresentationRules.categoryFor("image_generation"))
        assertEquals("Generation", SpecializedCapabilitiesPresentationRules.categoryFor("video_generation"))
        assertEquals("Speech & Audio", SpecializedCapabilitiesPresentationRules.categoryFor("speech_tts"))
        assertEquals("Multimodal Intelligence", SpecializedCapabilitiesPresentationRules.categoryFor("vision_understanding"))
    }

    @Test
    fun `derives truthful status badges without faking credentials`() {
        val disabled = CapabilityConfig(id = "image_generation", enabled = false)
        val (label1, color1) = SpecializedCapabilitiesPresentationRules.statusBadge(disabled)
        assertEquals("Disabled", label1)
        assertEquals(Color(0xFF6B7280), color1)

        val needsKey = CapabilityConfig(id = "image_generation", enabled = true, hasApiKey = false)
        val (label2, color2) = SpecializedCapabilitiesPresentationRules.statusBadge(needsKey)
        assertEquals("Needs API Key", label2)
        assertEquals(Color(0xFFF59E0B), color2)

        val active = CapabilityConfig(id = "image_generation", enabled = true, hasApiKey = true)
        val (label3, color3) = SpecializedCapabilitiesPresentationRules.statusBadge(active)
        assertEquals("Active", label3)
        assertEquals(Color(0xFF10B981), color3)
    }
}

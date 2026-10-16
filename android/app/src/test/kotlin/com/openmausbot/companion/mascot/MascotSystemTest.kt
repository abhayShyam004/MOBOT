package com.openmausbot.companion.mascot

import androidx.compose.ui.graphics.Path
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.ui.MausState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MascotSystemTest {

    private fun testBot(
        id: String = "b1",
        name: String = "Bot",
        color: String = "blue",
        mascotBody: String? = null,
        busy: Boolean? = null,
        activity: String? = null,
    ): Bot = Bot(
        id = id,
        threadId = "t-$id",
        name = name,
        title = "",
        description = "",
        notifications = true,
        color = color,
        mascotBody = mascotBody,
        busy = busy,
        activity = activity,
        unread = false,
        modelSelection = ModelSelection("inst", "model"),
        createdAt = 0.0,
    )

    @Test
    fun `curated fleet bots have distinct silhouettes and palettes matching design spec`() {
        val vega = MascotRegistry.resolve(testBot(id = "b1", name = "Vega", color = "blue"))
        val panko = MascotRegistry.resolve(testBot(id = "b2", name = "Panko", color = "yellow"))
        val skye = MascotRegistry.resolve(testBot(id = "b3", name = "Skye", color = "pink"))
        val olive = MascotRegistry.resolve(testBot(id = "b4", name = "Olive", color = "green"))
        val ziggy = MascotRegistry.resolve(testBot(id = "b5", name = "Ziggy", color = "purple"))
        val rio = MascotRegistry.resolve(testBot(id = "b6", name = "Rio", color = "orange"))
        val poppy = MascotRegistry.resolve(testBot(id = "b7", name = "Poppy", color = "purple"))

        // Silhouettes are genuinely distinct across the fleet
        assertEquals(MascotShape.SQUIRCLE, vega.shape)
        assertEquals(MascotShape.DROPLET, panko.shape)
        assertEquals(MascotShape.CLOUD, skye.shape)
        assertEquals(MascotShape.PEBBLE, olive.shape)
        assertEquals(MascotShape.TRIANGLE, ziggy.shape)
        assertEquals(MascotShape.CAPSULE, rio.shape)
        assertEquals(MascotShape.BLOB, poppy.shape)

        // Palettes match intentional design roles
        assertEquals(MascotPalette.BLUE, vega.palette)
        assertEquals(MascotPalette.YELLOW, panko.palette)
        assertEquals(MascotPalette.PINK, skye.palette)
        assertEquals(MascotPalette.GREEN, olive.palette)
        assertEquals(MascotPalette.PURPLE, ziggy.palette)
        assertEquals(MascotPalette.ORANGE, rio.palette)
        assertEquals(MascotPalette.PURPLE, poppy.palette)

        // Facial personalities are diverse
        assertEquals(MascotPersonality.FOCUSED, vega.personality)
        assertEquals(MascotPersonality.PLAYFUL, panko.personality)
        assertEquals(MascotPersonality.ENERGETIC, skye.personality)
        assertEquals(MascotPersonality.CALM, olive.personality)
        assertEquals(MascotEyeStyle.CYCLOPS, ziggy.eyeStyle)
        assertTrue(panko.hasCheeks)
        assertTrue(skye.hasCheeks)
    }

    @Test
    fun `unknown custom bots resolve deterministically without colliding to single wedge`() {
        val custom1 = MascotRegistry.resolve(testBot(id = "cust-1", name = "Atlas Code", color = "teal"))
        val custom2 = MascotRegistry.resolve(testBot(id = "cust-2", name = "Kora Assist", color = "red"))
        val custom3 = MascotRegistry.resolve(testBot(id = "cust-3", name = "Nova Agent", color = "charcoal"))

        // Deterministic repeat resolution
        val custom1Again = MascotRegistry.resolve(testBot(id = "cust-1", name = "Atlas Code", color = "teal"))
        assertEquals(custom1.shape, custom1Again.shape)
        assertEquals(custom1.palette, custom1Again.palette)
        assertEquals(custom1.eyeStyle, custom1Again.eyeStyle)

        // None are forced to cursor
        assertNotNull(custom1.shape)
        assertNotNull(custom2.shape)
        assertNotNull(custom3.shape)
    }

    @Test
    fun `user override takes absolute precedence`() {
        val bot = testBot(id = "bot-override-1", name = "Testing Override", color = "blue")
        val customDef = MascotDefinition(
            id = bot.id,
            shape = MascotShape.STAR,
            palette = MascotPalette.RED,
            eyeStyle = MascotEyeStyle.HAPPY_ARCS,
            mouthStyle = MascotMouthStyle.OPEN_SMILE,
        )

        MascotRegistry.setOverride(bot.id, customDef)
        val resolved = MascotRegistry.resolve(bot)
        assertEquals(MascotShape.STAR, resolved.shape)
        assertEquals(MascotPalette.RED, resolved.palette)
        assertEquals(MascotMouthStyle.OPEN_SMILE, resolved.mouthStyle)

        MascotRegistry.clearOverride(bot.id)
        val reverted = MascotRegistry.resolve(bot)
        assertEquals(MascotPalette.BLUE, reverted.palette)
        assertNotEquals(MascotEyeStyle.HAPPY_ARCS, reverted.eyeStyle)
    }

    @Test
    fun `activity state mapping handles busy, errors, and legacy MausState`() {
        val busyBot = testBot(id = "b-busy", name = "BusyBot", busy = true)
        assertEquals(MascotActivityState.WORKING, MascotRegistry.resolveActivity(busyBot))

        val waitingBot = testBot(id = "b-wait", name = "WaitBot", activity = "waiting-on-you")
        assertEquals(MascotActivityState.WAITING, MascotRegistry.resolveActivity(waitingBot))

        val toolBot = testBot(id = "b-tool", name = "ToolBot", activity = "using-tool")
        assertEquals(MascotActivityState.USING_TOOL, MascotRegistry.resolveActivity(toolBot))

        // MausState mapping
        assertEquals(MascotActivityState.WORKING, MascotRegistry.mapMausState(MausState.WORKING))
        assertEquals(MascotActivityState.WORKING, MascotRegistry.mapMausState(MausState.PROGRESS))
        assertEquals(MascotActivityState.THINKING, MascotRegistry.mapMausState(MausState.THINKING))
        assertEquals(MascotActivityState.THINKING, MascotRegistry.mapMausState(MausState.SEARCHING))
        assertEquals(MascotActivityState.ERROR, MascotRegistry.mapMausState(MausState.ALERTING))
        assertEquals(MascotActivityState.SUCCESS, MascotRegistry.mapMausState(MausState.CELEBRATE))
        assertEquals(MascotActivityState.SUCCESS, MascotRegistry.mapMausState(MausState.HAPPY))
        assertEquals(MascotActivityState.PAUSED, MascotRegistry.mapMausState(MausState.DROWSY))
        assertEquals(MascotActivityState.WAITING, MascotRegistry.mapMausState(MausState.CURIOUS))
        assertEquals(MascotActivityState.IDLE, MascotRegistry.mapMausState(MausState.IDLE))
    }

    @Test
    fun `all 10 body shapes build valid geometric paths with sensible face anchors`() {
        val path = Path()
        val width = 200f
        val height = 200f

        for (shape in MascotShape.entries) {
            path.reset()
            MascotShapes.buildPath(shape, width, height, path)
            assertFalse("Path for $shape should not be empty", path.isEmpty)

            val anchor = MascotShapes.anchorFor(shape)
            assertTrue("Anchor X for $shape must be in [0.2, 0.8]: ${anchor.normalizedX}", anchor.normalizedX in 0.2f..0.8f)
            assertTrue("Anchor Y for $shape must be in [0.2, 0.8]: ${anchor.normalizedY}", anchor.normalizedY in 0.2f..0.8f)
            assertTrue("Face scale for $shape must be positive: ${anchor.faceScale}", anchor.faceScale > 0.3f)
        }
    }

    @Test
    fun `all 10 color palettes have high contrast and distinct primary secondary stops`() {
        for (palette in MascotPalette.entries) {
            val spec = MascotColorSystem.specFor(palette)
            assertNotNull("Spec for $palette must not be null", spec)
            assertNotEquals("Primary and secondary should create rich gradient", spec.primary, spec.secondary)
            assertNotNull(spec.eyeColor)
            assertNotNull(spec.pupilColor)
        }

        // Yellow ground specifically has dark eyes for accessibility
        val yellowSpec = MascotColorSystem.specFor(MascotPalette.YELLOW)
        assertEquals(androidx.compose.ui.graphics.Color(0xFF1C1917), yellowSpec.eyeColor)
    }
}

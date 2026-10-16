package com.openmausbot.companion.mascot

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Chat
import kotlin.math.abs

/**
 * Registry providing deterministic, consistent mascot resolution and persistence
 * for every bot in the fleet.
 */
object MascotRegistry {

    private val customOverrides = HashMap<String, MascotDefinition>()

    /**
     * Curated deterministic defaults for the core MOBOT fleet, ensuring each bot
     * exhibits distinct silhouette, color, and character personality matching the reference.
     */
    private val fleetDefaults: Map<String, MascotDefinition> = mapOf(
        "vega" to MascotDefinition(
            id = "vega",
            shape = MascotShape.SQUIRCLE,
            palette = MascotPalette.BLUE,
            eyeStyle = MascotEyeStyle.FOCUSED_DOTS,
            mouthStyle = MascotMouthStyle.NONE,
            personality = MascotPersonality.FOCUSED,
        ),
        "panko" to MascotDefinition(
            id = "panko",
            shape = MascotShape.DROPLET,
            palette = MascotPalette.YELLOW,
            eyeStyle = MascotEyeStyle.TWIN_DOTS,
            mouthStyle = MascotMouthStyle.SMILE_ARC,
            personality = MascotPersonality.PLAYFUL,
            hasCheeks = true,
        ),
        "skye" to MascotDefinition(
            id = "skye",
            shape = MascotShape.CLOUD,
            palette = MascotPalette.PINK,
            eyeStyle = MascotEyeStyle.HAPPY_ARCS,
            mouthStyle = MascotMouthStyle.NONE,
            personality = MascotPersonality.ENERGETIC,
            hasCheeks = true,
        ),
        "olive" to MascotDefinition(
            id = "olive",
            shape = MascotShape.PEBBLE,
            palette = MascotPalette.GREEN,
            eyeStyle = MascotEyeStyle.WIDE_EYES,
            mouthStyle = MascotMouthStyle.TINY_DOT,
            personality = MascotPersonality.CALM,
        ),
        "ziggy" to MascotDefinition(
            id = "ziggy",
            shape = MascotShape.TRIANGLE,
            palette = MascotPalette.PURPLE,
            eyeStyle = MascotEyeStyle.CYCLOPS,
            mouthStyle = MascotMouthStyle.NONE,
            personality = MascotPersonality.PLAYFUL,
        ),
        "rio" to MascotDefinition(
            id = "rio",
            shape = MascotShape.CAPSULE,
            palette = MascotPalette.ORANGE,
            eyeStyle = MascotEyeStyle.TWIN_DOTS,
            mouthStyle = MascotMouthStyle.NONE,
            personality = MascotPersonality.CALM,
        ),
        "poppy" to MascotDefinition(
            id = "poppy",
            shape = MascotShape.BLOB,
            palette = MascotPalette.PURPLE,
            eyeStyle = MascotEyeStyle.SLIT_GAZE,
            mouthStyle = MascotMouthStyle.NONE,
            personality = MascotPersonality.SLEEPY,
        ),
    )

    /**
     * Resolves a persistent, deterministic mascot definition for a bot.
     */
    fun resolve(bot: Bot): MascotDefinition {
        // 1. User customization override
        customOverrides[bot.id]?.let { return it }

        // 2. Curated fleet default by name/id
        val key = bot.name.lowercase().trim()
        val defaultMatch = fleetDefaults.entries.firstOrNull { key.startsWith(it.key) }?.value
        if (defaultMatch != null) {
            val palette = if (bot.color.isNotBlank()) MascotPalette.fromId(bot.color) else defaultMatch.palette
            val shape = if (!bot.mascotBody.isNullOrBlank()) MascotShape.fromId(bot.mascotBody) else defaultMatch.shape
            return defaultMatch.copy(
                id = bot.id,
                palette = palette,
                shape = shape,
            )
        }

        // 3. Deterministic hash generation for any other existing or newly created bot
        val hash = abs(bot.id.hashCode() xor (bot.name.hashCode() * 31))
        val shapes = MascotShape.entries
        val eyes = MascotEyeStyle.entries
        val personalities = MascotPersonality.entries

        val assignedShape = if (!bot.mascotBody.isNullOrBlank()) {
            MascotShape.fromId(bot.mascotBody)
        } else {
            shapes[hash % shapes.size]
        }

        val assignedPalette = if (bot.color.isNotBlank()) {
            MascotPalette.fromId(bot.color)
        } else {
            MascotPalette.entries[(hash / 3) % MascotPalette.entries.size]
        }

        return MascotDefinition(
            id = bot.id,
            shape = assignedShape,
            palette = assignedPalette,
            eyeStyle = eyes[(hash / 7) % eyes.size],
            mouthStyle = if (hash % 3 == 0) MascotMouthStyle.SMILE_ARC else MascotMouthStyle.NONE,
            personality = personalities[(hash / 13) % personalities.size],
            hasCheeks = (hash % 4 == 0),
        )
    }

    /**
     * Resolves a mascot definition for a Chat target.
     */
    fun resolve(chat: Chat): MascotDefinition = when (chat) {
        is Chat.BotChat -> resolve(chat.bot)
        is Chat.RoomChat -> MascotDefinition(
            id = chat.id,
            shape = MascotShape.CLOUD,
            palette = MascotPalette.BLUE,
            eyeStyle = MascotEyeStyle.HAPPY_ARCS,
            mouthStyle = MascotMouthStyle.SMILE_ARC,
            personality = MascotPersonality.PLAYFUL,
        )
    }

    /**
     * Resolves the real-time activity state of a bot from its actual properties.
     */
    fun resolveActivity(bot: Bot): MascotActivityState {
        if (bot.busy == true) return MascotActivityState.WORKING
        return when (bot.activity) {
            "waiting-on-you" -> MascotActivityState.WAITING
            "working" -> MascotActivityState.WORKING
            "thinking" -> MascotActivityState.THINKING
            "using-tool" -> MascotActivityState.USING_TOOL
            "planning" -> MascotActivityState.PLANNING
            "error" -> MascotActivityState.ERROR
            "paused" -> MascotActivityState.PAUSED
            else -> MascotActivityState.IDLE
        }
    }

    /**
     * Maps legacy MausState to the new MascotActivityState.
     */
    internal fun mapMausState(state: com.openmausbot.companion.ui.MausState): MascotActivityState = when (state) {
        com.openmausbot.companion.ui.MausState.WORKING,
        com.openmausbot.companion.ui.MausState.PROGRESS,
        com.openmausbot.companion.ui.MausState.LOADING,
        com.openmausbot.companion.ui.MausState.WRITING,
        com.openmausbot.companion.ui.MausState.SPAWNING -> MascotActivityState.WORKING

        com.openmausbot.companion.ui.MausState.THINKING,
        com.openmausbot.companion.ui.MausState.THINKING_DOTS,
        com.openmausbot.companion.ui.MausState.SEARCHING,
        com.openmausbot.companion.ui.MausState.DICTATING -> MascotActivityState.THINKING

        com.openmausbot.companion.ui.MausState.ALERTING,
        com.openmausbot.companion.ui.MausState.ANGRY,
        com.openmausbot.companion.ui.MausState.SCARED -> MascotActivityState.ERROR

        com.openmausbot.companion.ui.MausState.CELEBRATE,
        com.openmausbot.companion.ui.MausState.PROUD,
        com.openmausbot.companion.ui.MausState.HAPPY -> MascotActivityState.SUCCESS

        com.openmausbot.companion.ui.MausState.DROWSY,
        com.openmausbot.companion.ui.MausState.SLEEPING,
        com.openmausbot.companion.ui.MausState.POWERING_DOWN -> MascotActivityState.PAUSED

        com.openmausbot.companion.ui.MausState.CURIOUS,
        com.openmausbot.companion.ui.MausState.CONFUSED,
        com.openmausbot.companion.ui.MausState.RADAR -> MascotActivityState.WAITING

        else -> MascotActivityState.IDLE
    }

    fun setOverride(id: String, definition: MascotDefinition) {
        customOverrides[id] = definition
    }

    fun clearOverride(id: String) {
        customOverrides.remove(id)
    }
}

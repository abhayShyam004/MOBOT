package com.openmausbot.companion.mascot

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Extensible body shapes for the MOBOT mascot character system.
 * Each shape provides distinct geometry and silhouette.
 */
enum class MascotShape(val id: String, val label: String) {
    BLOB("blob", "Organic Blob"),
    CLOUD("cloud", "Soft Cloud"),
    DROPLET("droplet", "Droplet"),
    TRIANGLE("triangle", "Rounded Triangle"),
    SQUIRCLE("squircle", "Squircle"),
    CAPSULE("capsule", "Soft Capsule"),
    SHIELD("shield", "Shield"),
    PEBBLE("pebble", "Smooth Pebble"),
    STAR("star", "Soft Star"),
    CURSOR("cursor", "Classic Wedge");

    companion object {
        fun fromId(id: String?): MascotShape = entries.firstOrNull { it.id == id } ?: BLOB
    }
}

/**
 * Vibrant, carefully tuned color palettes engineered to look beautiful
 * in both Light and Dark themes.
 */
enum class MascotPalette(val id: String, val label: String) {
    PURPLE("purple", "Royal Violet"),
    BLUE("blue", "Electric Blue"),
    GREEN("green", "Emerald Green"),
    PINK("pink", "Neon Rose"),
    ORANGE("orange", "Vibrant Orange"),
    RED("red", "Crimson Red"),
    YELLOW("yellow", "Warm Amber"),
    TEAL("teal", "Cyan Teal"),
    CHARCOAL("charcoal", "Modern Charcoal"),
    CARAMEL("caramel", "Warm Caramel");

    companion object {
        fun fromId(id: String?): MascotPalette = when (id?.lowercase()) {
            "purple", "violet" -> PURPLE
            "blue", "cyan", "sky" -> BLUE
            "green", "emerald", "mint" -> GREEN
            "pink", "magenta", "rose" -> PINK
            "orange", "coral" -> ORANGE
            "red", "crimson" -> RED
            "yellow", "amber", "gold" -> YELLOW
            "teal" -> TEAL
            "charcoal", "gray", "grey", "black" -> CHARCOAL
            "caramel", "brown", "earth" -> CARAMEL
            else -> BLUE
        }
    }
}

/**
 * Minimalist, highly expressive eye styles inspired by the reference design.
 */
enum class MascotEyeStyle(val id: String, val label: String) {
    TWIN_DOTS("twin_dots", "Twin Dots"),
    FOCUSED_DOTS("focused_dots", "Focused Dots"),
    WIDE_EYES("wide_eyes", "Wide Eyes"),
    SLIT_GAZE("slit_gaze", "Slit Gaze"),
    CYCLOPS("cyclops", "Cyclops Dot"),
    HAPPY_ARCS("happy_arcs", "Happy Arcs"),
    SLEEPY_LIDS("sleepy_lids", "Sleepy Lids");

    companion object {
        fun fromId(id: String?): MascotEyeStyle = entries.firstOrNull { it.id == id } ?: TWIN_DOTS
    }
}

/**
 * Minimal mouth expressions. Many characters rely solely on eyes,
 * but subtle mouths provide delightful additional nuance.
 */
enum class MascotMouthStyle(val id: String, val label: String) {
    NONE("none", "None (Eyes Only)"),
    TINY_DOT("tiny_dot", "Tiny Dot"),
    SMILE_ARC("smile_arc", "Smile Arc"),
    OPEN_SMILE("open_smile", "Open Smile"),
    CONCERNED_ARC("concerned_arc", "Concerned Arc"),
    SURPRISED_O("surprised_o", "Surprised O");

    companion object {
        fun fromId(id: String?): MascotMouthStyle = entries.firstOrNull { it.id == id } ?: NONE
    }
}

/**
 * Behavioral animation profiles controlling breathing cadence, blink rate,
 * and movement energy.
 */
enum class MascotPersonality(
    val id: String,
    val label: String,
    val breathDurationMs: Int,
    val minBlinkIntervalMs: Long,
    val maxBlinkIntervalMs: Long,
    val motionEnergy: Float,
) {
    CALM("calm", "Calm", breathDurationMs = 3800, minBlinkIntervalMs = 4500, maxBlinkIntervalMs = 7000, motionEnergy = 0.7f),
    PLAYFUL("playful", "Playful", breathDurationMs = 2600, minBlinkIntervalMs = 2500, maxBlinkIntervalMs = 4500, motionEnergy = 1.3f),
    FOCUSED("focused", "Focused", breathDurationMs = 3200, minBlinkIntervalMs = 3500, maxBlinkIntervalMs = 6000, motionEnergy = 0.9f),
    ENERGETIC("energetic", "Energetic", breathDurationMs = 2100, minBlinkIntervalMs = 2000, maxBlinkIntervalMs = 3800, motionEnergy = 1.6f),
    SLEEPY("sleepy", "Sleepy", breathDurationMs = 4800, minBlinkIntervalMs = 5000, maxBlinkIntervalMs = 8500, motionEnergy = 0.5f);

    companion object {
        fun fromId(id: String?): MascotPersonality = entries.firstOrNull { it.id == id } ?: CALM
    }
}

/**
 * Live agent activity states mapped directly from the harness/bot lifecycle.
 */
enum class MascotActivityState {
    IDLE,
    THINKING,
    PLANNING,
    WORKING,
    USING_TOOL,
    WAITING,
    RECOVERING,
    SUCCESS,
    ERROR,
    PAUSED,
}

/**
 * Core emotional states controlling facial posture and eye geometry.
 */
enum class MascotEmotion {
    IDLE,
    HAPPY,
    THINKING,
    FOCUSED,
    WORKING,
    WAITING,
    SUCCESS,
    CONFUSED,
    ERROR,
    SLEEPY,
}

/**
 * Responsive sizing presets for the mascot system.
 */
enum class MascotSize(val dp: Dp) {
    SMALL(28.dp),
    MEDIUM(40.dp),
    LARGE(56.dp),
    HERO(110.dp),
}

/**
 * Persistent configuration defining a bot's unique mascot character.
 */
data class MascotDefinition(
    val id: String,
    val shape: MascotShape = MascotShape.BLOB,
    val palette: MascotPalette = MascotPalette.BLUE,
    val eyeStyle: MascotEyeStyle = MascotEyeStyle.TWIN_DOTS,
    val mouthStyle: MascotMouthStyle = MascotMouthStyle.NONE,
    val personality: MascotPersonality = MascotPersonality.CALM,
    val hasCheeks: Boolean = false,
)

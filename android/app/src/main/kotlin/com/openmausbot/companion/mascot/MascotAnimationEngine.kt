package com.openmausbot.companion.mascot

import androidx.compose.ui.geometry.Offset
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Calculated animated pose parameters for a single render frame.
 */
data class MascotPose(
    val scaleX: Float = 1f,
    val scaleY: Float = 1f,
    val translateY: Float = 0f,
    val translateX: Float = 0f,
    val rotationDeg: Float = 0f,
    val blinkFraction: Float = 0f,
    val gazeShift: Offset = Offset.Zero,
    val emotion: MascotEmotion = MascotEmotion.IDLE,
)

/**
 * Procedural animation engine driving organic, lifelike motion without
 * expensive physics engines or memory allocations.
 */
object MascotAnimationEngine {

    fun computePose(
        elapsedMillis: Long,
        personality: MascotPersonality,
        activityState: MascotActivityState,
        reducedMotion: Boolean = false,
    ): MascotPose {
        val emotion = resolveEmotion(activityState)

        if (reducedMotion) {
            return MascotPose(
                scaleX = 1f,
                scaleY = 1f,
                translateY = 0f,
                translateX = 0f,
                rotationDeg = 0f,
                blinkFraction = 0f,
                gazeShift = Offset.Zero,
                emotion = emotion,
            )
        }

        val energy = personality.motionEnergy
        val breathPeriod = personality.breathDurationMs.toFloat()
        val t = elapsedMillis.toFloat()

        // 1. Natural Breathing (Volume Conserving Squash & Stretch)
        val breathPhase = (t % breathPeriod) / breathPeriod * 2f * PI.toFloat()
        val breathSin = sin(breathPhase)

        val breathScaleY = 1f + (0.028f * energy * breathSin)
        val breathScaleX = 1f - (0.014f * energy * breathSin)

        // 2. Subtle Vertical Floating Drift
        val floatPhase = (t % (breathPeriod * 1.25f)) / (breathPeriod * 1.25f) * 2f * PI.toFloat()
        val floatY = cos(floatPhase) * 1.5f * energy

        // 3. Periodic Blink Engine
        val blinkCycle = personality.minBlinkIntervalMs + (personality.maxBlinkIntervalMs - personality.minBlinkIntervalMs) / 2
        val blinkDuration = 160f
        val timeInCycle = t % blinkCycle
        val blinkFraction = if (timeInCycle < blinkDuration) {
            val blinkProgress = timeInCycle / blinkDuration
            sin(blinkProgress * PI.toFloat())
        } else {
            0f
        }

        // 4. Activity Specific State Overrides
        var finalScaleX = breathScaleX
        var finalScaleY = breathScaleY
        var finalTranslateY = floatY
        var finalTranslateX = 0f
        var finalRotation = 0f
        var gazeShift = Offset.Zero

        when (activityState) {
            MascotActivityState.THINKING, MascotActivityState.PLANNING -> {
                // Thoughtful wandering gaze
                val gazePhase = (t % 2200f) / 2200f * 2f * PI.toFloat()
                val gazeX = sin(gazePhase) * 4.0f
                val gazeY = cos(gazePhase * 0.5f) * 1.2f
                gazeShift = Offset(gazeX, gazeY)
                finalRotation = sin(gazePhase * 0.5f) * 1.5f
            }

            MascotActivityState.WORKING, MascotActivityState.USING_TOOL -> {
                // Energetic focused work rhythm
                val workPhase = (t % 650f) / 650f * 2f * PI.toFloat()
                val workPulse = sin(workPhase) * 0.035f
                finalScaleY += workPulse
                finalScaleX -= workPulse * 0.5f
                finalTranslateY += sin(workPhase) * 1.8f
                finalRotation = sin((t % 1300f) / 1300f * 2f * PI.toFloat()) * 2.2f
            }

            MascotActivityState.WAITING, MascotActivityState.PAUSED -> {
                // Calm, tranquil stillness
                finalScaleY = 1f + (0.015f * breathSin)
                finalScaleX = 1f - (0.008f * breathSin)
                finalTranslateY = floatY * 0.5f
            }

            MascotActivityState.SUCCESS -> {
                // Joyful spring bounce
                val bouncePhase = (t % 750f) / 750f * 2f * PI.toFloat()
                val bounceY = -kotlin.math.max(0f, sin(bouncePhase)) * 4.5f
                finalTranslateY += bounceY
                finalScaleY += 0.05f
            }

            MascotActivityState.ERROR, MascotActivityState.RECOVERING -> {
                // Subtle concerned shudder / shake
                val shakePhase = (t % 160f) / 160f * 2f * PI.toFloat()
                finalTranslateX = sin(shakePhase) * 2.0f
                finalRotation = sin(shakePhase) * 1.5f
            }

            MascotActivityState.IDLE -> {
                // Standard breathing and floating
            }
        }

        return MascotPose(
            scaleX = finalScaleX,
            scaleY = finalScaleY,
            translateY = finalTranslateY,
            translateX = finalTranslateX,
            rotationDeg = finalRotation,
            blinkFraction = blinkFraction,
            gazeShift = gazeShift,
            emotion = emotion,
        )
    }

    fun resolveEmotion(state: MascotActivityState): MascotEmotion = when (state) {
        MascotActivityState.IDLE -> MascotEmotion.IDLE
        MascotActivityState.THINKING, MascotActivityState.PLANNING -> MascotEmotion.THINKING
        MascotActivityState.WORKING, MascotActivityState.USING_TOOL -> MascotEmotion.WORKING
        MascotActivityState.WAITING, MascotActivityState.PAUSED -> MascotEmotion.WAITING
        MascotActivityState.SUCCESS -> MascotEmotion.SUCCESS
        MascotActivityState.ERROR -> MascotEmotion.ERROR
        MascotActivityState.RECOVERING -> MascotEmotion.CONFUSED
    }
}

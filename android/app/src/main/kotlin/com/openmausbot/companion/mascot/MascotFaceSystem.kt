package com.openmausbot.companion.mascot

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke

/**
 * Procedural face rendering system: eyes, pupils, expressions, and blinking.
 */
object MascotFaceSystem {

    fun drawFace(
        scope: DrawScope,
        eyeStyle: MascotEyeStyle,
        mouthStyle: MascotMouthStyle,
        colors: MascotColorSpec,
        anchor: FaceAnchor,
        canvasWidth: Float,
        canvasHeight: Float,
        blinkFraction: Float = 0f,
        gazeShift: Offset = Offset.Zero,
        emotion: MascotEmotion = MascotEmotion.IDLE,
        hasCheeks: Boolean = false,
    ) {
        val centerX = canvasWidth * anchor.normalizedX + gazeShift.x
        val centerY = canvasHeight * anchor.normalizedY + gazeShift.y
        val scale = canvasWidth * anchor.faceScale

        val eyeSpacing = scale * 0.44f
        val baseEyeRadius = scale * 0.16f

        val effectiveEyeStyle = when (emotion) {
            MascotEmotion.SUCCESS, MascotEmotion.HAPPY -> MascotEyeStyle.HAPPY_ARCS
            MascotEmotion.ERROR, MascotEmotion.CONFUSED -> MascotEyeStyle.SLIT_GAZE
            MascotEmotion.SLEEPY -> MascotEyeStyle.SLEEPY_LIDS
            MascotEmotion.FOCUSED, MascotEmotion.WORKING -> MascotEyeStyle.FOCUSED_DOTS
            else -> eyeStyle
        }

        // 1. Draw Cheeks (if enabled or happy)
        if (hasCheeks || emotion == MascotEmotion.HAPPY || emotion == MascotEmotion.SUCCESS) {
            val cheekY = centerY + scale * 0.18f
            val cheekRadius = scale * 0.12f
            scope.drawCircle(
                color = colors.cheekColor,
                radius = cheekRadius,
                center = Offset(centerX - eyeSpacing * 1.15f, cheekY),
            )
            scope.drawCircle(
                color = colors.cheekColor,
                radius = cheekRadius,
                center = Offset(centerX + eyeSpacing * 1.15f, cheekY),
            )
        }

        // 2. Draw Eyes
        val leftEyeCenter = Offset(centerX - eyeSpacing * 0.5f, centerY)
        val rightEyeCenter = Offset(centerX + eyeSpacing * 0.5f, centerY)

        if (blinkFraction > 0.05f) {
            // Blinking eyelid slit
            val blinkStroke = Stroke(width = baseEyeRadius * 0.55f, cap = StrokeCap.Round)
            val blinkWidth = baseEyeRadius * 1.5f
            if (effectiveEyeStyle == MascotEyeStyle.CYCLOPS) {
                scope.drawLine(
                    color = colors.eyeColor,
                    start = Offset(centerX - blinkWidth, centerY),
                    end = Offset(centerX + blinkWidth, centerY),
                    strokeWidth = blinkStroke.width,
                    cap = StrokeCap.Round,
                )
            } else {
                scope.drawLine(
                    color = colors.eyeColor,
                    start = Offset(leftEyeCenter.x - blinkWidth * 0.5f, centerY),
                    end = Offset(leftEyeCenter.x + blinkWidth * 0.5f, centerY),
                    strokeWidth = blinkStroke.width,
                    cap = StrokeCap.Round,
                )
                scope.drawLine(
                    color = colors.eyeColor,
                    start = Offset(rightEyeCenter.x - blinkWidth * 0.5f, centerY),
                    end = Offset(rightEyeCenter.x + blinkWidth * 0.5f, centerY),
                    strokeWidth = blinkStroke.width,
                    cap = StrokeCap.Round,
                )
            }
        } else {
            when (effectiveEyeStyle) {
                MascotEyeStyle.CYCLOPS -> {
                    // Single confident center eye
                    val cyclopsRadius = baseEyeRadius * 1.45f
                    scope.drawCircle(
                        color = colors.eyeColor,
                        radius = cyclopsRadius,
                        center = Offset(centerX, centerY),
                    )
                    // Pupil
                    scope.drawCircle(
                        color = colors.pupilColor,
                        radius = cyclopsRadius * 0.45f,
                        center = Offset(centerX + gazeShift.x * 0.2f, centerY + gazeShift.y * 0.2f),
                    )
                }

                MascotEyeStyle.TWIN_DOTS -> {
                    // Two pure solid circles
                    scope.drawCircle(color = colors.eyeColor, radius = baseEyeRadius, center = leftEyeCenter)
                    scope.drawCircle(color = colors.eyeColor, radius = baseEyeRadius, center = rightEyeCenter)
                }

                MascotEyeStyle.FOCUSED_DOTS -> {
                    // Smaller sharp dots
                    val focusedRadius = baseEyeRadius * 0.78f
                    scope.drawCircle(color = colors.eyeColor, radius = focusedRadius, center = leftEyeCenter)
                    scope.drawCircle(color = colors.eyeColor, radius = focusedRadius, center = rightEyeCenter)
                }

                MascotEyeStyle.WIDE_EYES -> {
                    // Large open eyes with dark pupil
                    val wideRadius = baseEyeRadius * 1.25f
                    scope.drawCircle(color = colors.eyeColor, radius = wideRadius, center = leftEyeCenter)
                    scope.drawCircle(color = colors.eyeColor, radius = wideRadius, center = rightEyeCenter)
                    scope.drawCircle(color = colors.pupilColor, radius = wideRadius * 0.45f, center = leftEyeCenter)
                    scope.drawCircle(color = colors.pupilColor, radius = wideRadius * 0.45f, center = rightEyeCenter)
                }

                MascotEyeStyle.SLIT_GAZE -> {
                    // Modern 45-degree angled slit or horizontal slit
                    val slitStroke = Stroke(width = baseEyeRadius * 0.70f, cap = StrokeCap.Round)
                    val len = baseEyeRadius * 1.3f
                    scope.drawLine(
                        color = colors.eyeColor,
                        start = Offset(leftEyeCenter.x - len * 0.5f, leftEyeCenter.y - len * 0.3f),
                        end = Offset(leftEyeCenter.x + len * 0.5f, leftEyeCenter.y + len * 0.3f),
                        strokeWidth = slitStroke.width,
                        cap = StrokeCap.Round,
                    )
                    scope.drawLine(
                        color = colors.eyeColor,
                        start = Offset(rightEyeCenter.x - len * 0.5f, rightEyeCenter.y - len * 0.3f),
                        end = Offset(rightEyeCenter.x + len * 0.5f, rightEyeCenter.y + len * 0.3f),
                        strokeWidth = slitStroke.width,
                        cap = StrokeCap.Round,
                    )
                }

                MascotEyeStyle.HAPPY_ARCS -> {
                    // Upward happy arcs ^ ^
                    val arcStroke = Stroke(width = baseEyeRadius * 0.65f, cap = StrokeCap.Round)
                    val arcWidth = baseEyeRadius * 1.2f
                    val arcHeight = baseEyeRadius * 0.8f

                    val leftArc = Path().apply {
                        moveTo(leftEyeCenter.x - arcWidth * 0.5f, leftEyeCenter.y + arcHeight * 0.3f)
                        quadraticTo(leftEyeCenter.x, leftEyeCenter.y - arcHeight * 0.6f, leftEyeCenter.x + arcWidth * 0.5f, leftEyeCenter.y + arcHeight * 0.3f)
                    }
                    val rightArc = Path().apply {
                        moveTo(rightEyeCenter.x - arcWidth * 0.5f, rightEyeCenter.y + arcHeight * 0.3f)
                        quadraticTo(rightEyeCenter.x, rightEyeCenter.y - arcHeight * 0.6f, rightEyeCenter.x + arcWidth * 0.5f, rightEyeCenter.y + arcHeight * 0.3f)
                    }
                    scope.drawPath(leftArc, color = colors.eyeColor, style = arcStroke)
                    scope.drawPath(rightArc, color = colors.eyeColor, style = arcStroke)
                }

                MascotEyeStyle.SLEEPY_LIDS -> {
                    // Drooping half-moon eyes
                    val lidStroke = Stroke(width = baseEyeRadius * 0.65f, cap = StrokeCap.Round)
                    val lidWidth = baseEyeRadius * 1.2f
                    scope.drawLine(
                        color = colors.eyeColor,
                        start = Offset(leftEyeCenter.x - lidWidth * 0.5f, leftEyeCenter.y),
                        end = Offset(leftEyeCenter.x + lidWidth * 0.5f, leftEyeCenter.y),
                        strokeWidth = lidStroke.width,
                        cap = StrokeCap.Round,
                    )
                    scope.drawLine(
                        color = colors.eyeColor,
                        start = Offset(rightEyeCenter.x - lidWidth * 0.5f, rightEyeCenter.y),
                        end = Offset(rightEyeCenter.x + lidWidth * 0.5f, rightEyeCenter.y),
                        strokeWidth = lidStroke.width,
                        cap = StrokeCap.Round,
                    )
                }
            }
        }

        // 3. Draw Mouth (if configured or emotion calls for it)
        val mouthY = centerY + scale * 0.30f
        val effectiveMouth = when (emotion) {
            MascotEmotion.SUCCESS, MascotEmotion.HAPPY -> MascotMouthStyle.SMILE_ARC
            MascotEmotion.CONFUSED, MascotEmotion.ERROR -> MascotMouthStyle.CONCERNED_ARC
            else -> mouthStyle
        }

        when (effectiveMouth) {
            MascotMouthStyle.NONE -> { /* Minimalist: no mouth */ }

            MascotMouthStyle.TINY_DOT -> {
                scope.drawCircle(
                    color = colors.eyeColor,
                    radius = baseEyeRadius * 0.35f,
                    center = Offset(centerX, mouthY),
                )
            }

            MascotMouthStyle.SMILE_ARC -> {
                val mouthStroke = Stroke(width = baseEyeRadius * 0.50f, cap = StrokeCap.Round)
                val mouthWidth = scale * 0.32f
                val mouthDepth = scale * 0.16f
                val smilePath = Path().apply {
                    moveTo(centerX - mouthWidth * 0.5f, mouthY - mouthDepth * 0.2f)
                    quadraticTo(centerX, mouthY + mouthDepth, centerX + mouthWidth * 0.5f, mouthY - mouthDepth * 0.2f)
                }
                scope.drawPath(smilePath, color = colors.eyeColor, style = mouthStroke)
            }

            MascotMouthStyle.OPEN_SMILE -> {
                val mouthWidth = scale * 0.34f
                val mouthDepth = scale * 0.22f
                val openSmile = Path().apply {
                    moveTo(centerX - mouthWidth * 0.5f, mouthY)
                    quadraticTo(centerX, mouthY + mouthDepth, centerX + mouthWidth * 0.5f, mouthY)
                    close()
                }
                scope.drawPath(openSmile, color = colors.eyeColor)
            }

            MascotMouthStyle.CONCERNED_ARC -> {
                val mouthStroke = Stroke(width = baseEyeRadius * 0.50f, cap = StrokeCap.Round)
                val mouthWidth = scale * 0.28f
                val mouthDepth = scale * 0.14f
                val concernedPath = Path().apply {
                    moveTo(centerX - mouthWidth * 0.5f, mouthY + mouthDepth * 0.4f)
                    quadraticTo(centerX, mouthY - mouthDepth * 0.4f, centerX + mouthWidth * 0.5f, mouthY + mouthDepth * 0.4f)
                }
                scope.drawPath(concernedPath, color = colors.eyeColor, style = mouthStroke)
            }

            MascotMouthStyle.SURPRISED_O -> {
                scope.drawCircle(
                    color = colors.eyeColor,
                    radius = baseEyeRadius * 0.65f,
                    center = Offset(centerX, mouthY),
                )
            }
        }
    }
}

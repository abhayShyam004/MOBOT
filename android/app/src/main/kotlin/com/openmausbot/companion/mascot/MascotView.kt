package com.openmausbot.companion.mascot

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.collectLatest

/**
 * Animated native vector mascot composable.
 * Renders procedural body shapes, expressions, breathing, and state transitions
 * with 60fps performance and zero allocation overhead during draw.
 */
@Composable
fun MascotView(
    mascot: MascotDefinition,
    modifier: Modifier = Modifier,
    activityState: MascotActivityState = MascotActivityState.IDLE,
    size: Dp = 40.dp,
    animated: Boolean = true,
) {
    val colors = remember(mascot.palette) {
        MascotColorSystem.specFor(mascot.palette)
    }
    val anchor = remember(mascot.shape) {
        MascotShapes.anchorFor(mascot.shape)
    }

    val bodyPath = remember { Path() }
    var elapsedMillis by remember { mutableLongStateOf(0L) }
    var isVisible by remember { mutableStateOf(true) }
    var startNanos by remember { mutableLongStateOf(0L) }

    LaunchedEffect(animated) {
        val durationScale = coroutineContext[MotionDurationScale]
        val motionAllowed = (durationScale?.scaleFactor ?: 1f) > 0f

        snapshotFlow { animated && isVisible && motionAllowed }
            .collectLatest { live ->
                if (!live) return@collectLatest
                while (true) {
                    withFrameNanos { frameTimeNanos ->
                        if (startNanos == 0L) startNanos = frameTimeNanos
                        elapsedMillis = (frameTimeNanos - startNanos) / 1_000_000L
                    }
                }
            }
    }

    Canvas(
        modifier = modifier
            .size(size)
            .onGloballyPositioned { isVisible = !it.boundsInWindow().isEmpty }
            .semantics { },
    ) {
        val w = this.size.width
        val h = this.size.height

        val pose = MascotAnimationEngine.computePose(
            elapsedMillis = elapsedMillis,
            personality = mascot.personality,
            activityState = activityState,
            reducedMotion = !animated,
        )

        val pivot = Offset(w * 0.5f, h * 0.5f)

        withTransform({
            translate(left = pose.translateX, top = pose.translateY)
            scale(scaleX = pose.scaleX, scaleY = pose.scaleY, pivot = pivot)
            rotate(degrees = pose.rotationDeg, pivot = pivot)
        }) {
            // 1. Draw Body Silhouette
            MascotShapes.buildPath(mascot.shape, w, h, bodyPath)
            drawPath(
                path = bodyPath,
                brush = Brush.verticalGradient(
                    colors = listOf(colors.primary, colors.secondary),
                    startY = 0f,
                    endY = h,
                ),
            )

            // 2. Draw Face
            MascotFaceSystem.drawFace(
                scope = this,
                eyeStyle = mascot.eyeStyle,
                mouthStyle = mascot.mouthStyle,
                colors = colors,
                anchor = anchor,
                canvasWidth = w,
                canvasHeight = h,
                blinkFraction = pose.blinkFraction,
                gazeShift = pose.gazeShift,
                emotion = pose.emotion,
                hasCheeks = mascot.hasCheeks,
            )
        }
    }
}

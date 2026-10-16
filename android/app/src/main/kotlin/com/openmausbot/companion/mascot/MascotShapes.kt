package com.openmausbot.companion.mascot

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path

/**
 * Optical positioning anchor for the face (eyes and mouth) within a mascot shape.
 * Coordinates are normalized to [0..1] range.
 */
data class FaceAnchor(
    val normalizedX: Float,
    val normalizedY: Float,
    val faceScale: Float,
)

/**
 * Extensible vector geometry engine generating mathematically smooth,
 * organic Bézier paths for all mascot body shapes.
 */
object MascotShapes {

    fun anchorFor(shape: MascotShape): FaceAnchor = when (shape) {
        MascotShape.CLOUD -> FaceAnchor(0.50f, 0.54f, 0.38f)
        MascotShape.DROPLET -> FaceAnchor(0.50f, 0.58f, 0.36f)
        MascotShape.TRIANGLE -> FaceAnchor(0.50f, 0.58f, 0.35f)
        MascotShape.SQUIRCLE -> FaceAnchor(0.50f, 0.50f, 0.42f)
        MascotShape.CAPSULE -> FaceAnchor(0.50f, 0.50f, 0.40f)
        MascotShape.BLOB -> FaceAnchor(0.52f, 0.48f, 0.40f)
        MascotShape.SHIELD -> FaceAnchor(0.50f, 0.48f, 0.38f)
        MascotShape.PEBBLE -> FaceAnchor(0.50f, 0.50f, 0.40f)
        MascotShape.STAR -> FaceAnchor(0.50f, 0.50f, 0.32f)
        MascotShape.CURSOR -> FaceAnchor(0.54f, 0.54f, 0.38f)
    }

    fun buildPath(shape: MascotShape, width: Float, height: Float, targetPath: Path = Path()): Path {
        targetPath.reset()
        val w = width
        val h = height

        when (shape) {
            MascotShape.SQUIRCLE -> {
                val radius = w * 0.28f
                targetPath.addRoundRect(
                    RoundRect(
                        rect = Rect(w * 0.04f, h * 0.04f, w * 0.96f, h * 0.96f),
                        cornerRadius = CornerRadius(radius, radius),
                    )
                )
            }

            MascotShape.CAPSULE -> {
                val corner = h * 0.38f
                targetPath.addRoundRect(
                    RoundRect(
                        rect = Rect(w * 0.04f, h * 0.16f, w * 0.96f, h * 0.84f),
                        cornerRadius = CornerRadius(corner, corner),
                    )
                )
            }

            MascotShape.PEBBLE -> {
                // Smooth organic egg/pebble
                targetPath.moveTo(w * 0.50f, h * 0.06f)
                targetPath.cubicTo(w * 0.82f, h * 0.06f, w * 0.96f, h * 0.28f, w * 0.96f, h * 0.55f)
                targetPath.cubicTo(w * 0.96f, h * 0.82f, w * 0.78f, h * 0.94f, w * 0.50f, h * 0.94f)
                targetPath.cubicTo(w * 0.22f, h * 0.94f, w * 0.04f, h * 0.82f, w * 0.04f, h * 0.55f)
                targetPath.cubicTo(w * 0.04f, h * 0.28f, w * 0.18f, h * 0.06f, w * 0.50f, h * 0.06f)
                targetPath.close()
            }

            MascotShape.DROPLET -> {
                // Classic water droplet / tear
                targetPath.moveTo(w * 0.50f, h * 0.06f)
                targetPath.cubicTo(w * 0.62f, h * 0.18f, w * 0.94f, h * 0.48f, w * 0.94f, h * 0.68f)
                targetPath.cubicTo(w * 0.94f, h * 0.88f, w * 0.74f, h * 0.96f, w * 0.50f, h * 0.96f)
                targetPath.cubicTo(w * 0.26f, h * 0.96f, w * 0.06f, h * 0.88f, w * 0.06f, h * 0.68f)
                targetPath.cubicTo(w * 0.06f, h * 0.48f, w * 0.38f, h * 0.18f, w * 0.50f, h * 0.06f)
                targetPath.close()
            }

            MascotShape.TRIANGLE -> {
                // Soft equilateral triangle with rounded vertices
                targetPath.moveTo(w * 0.50f, h * 0.08f)
                targetPath.cubicTo(w * 0.58f, h * 0.08f, w * 0.92f, h * 0.74f, w * 0.94f, h * 0.82f)
                targetPath.cubicTo(w * 0.96f, h * 0.90f, w * 0.90f, h * 0.94f, w * 0.80f, h * 0.94f)
                targetPath.lineTo(w * 0.20f, h * 0.94f)
                targetPath.cubicTo(w * 0.10f, h * 0.94f, w * 0.04f, h * 0.90f, w * 0.06f, h * 0.82f)
                targetPath.cubicTo(w * 0.08f, h * 0.74f, w * 0.42f, h * 0.08f, w * 0.50f, h * 0.08f)
                targetPath.close()
            }

            MascotShape.CLOUD -> {
                // Soft 4-lobed cloud
                targetPath.moveTo(w * 0.24f, h * 0.78f)
                targetPath.cubicTo(w * 0.06f, h * 0.78f, w * 0.04f, h * 0.52f, w * 0.20f, h * 0.46f)
                targetPath.cubicTo(w * 0.14f, h * 0.28f, w * 0.38f, h * 0.16f, w * 0.50f, h * 0.26f)
                targetPath.cubicTo(w * 0.62f, h * 0.16f, w * 0.86f, h * 0.28f, w * 0.80f, h * 0.46f)
                targetPath.cubicTo(w * 0.96f, h * 0.52f, w * 0.94f, h * 0.78f, w * 0.76f, h * 0.78f)
                targetPath.close()
            }

            MascotShape.BLOB -> {
                // Organic asymmetric jelly blob
                targetPath.moveTo(w * 0.45f, h * 0.08f)
                targetPath.cubicTo(w * 0.80f, h * 0.04f, w * 0.96f, h * 0.30f, w * 0.92f, h * 0.60f)
                targetPath.cubicTo(w * 0.88f, h * 0.88f, w * 0.65f, h * 0.96f, w * 0.40f, h * 0.92f)
                targetPath.cubicTo(w * 0.15f, h * 0.88f, w * 0.04f, h * 0.68f, w * 0.08f, h * 0.42f)
                targetPath.cubicTo(w * 0.12f, h * 0.16f, w * 0.25f, h * 0.10f, w * 0.45f, h * 0.08f)
                targetPath.close()
            }

            MascotShape.SHIELD -> {
                // Friendly rounded shield / pentagon
                targetPath.moveTo(w * 0.16f, h * 0.12f)
                targetPath.lineTo(w * 0.84f, h * 0.12f)
                targetPath.cubicTo(w * 0.94f, h * 0.12f, w * 0.94f, h * 0.48f, w * 0.86f, h * 0.66f)
                targetPath.cubicTo(w * 0.76f, h * 0.86f, w * 0.56f, h * 0.95f, w * 0.50f, h * 0.96f)
                targetPath.cubicTo(w * 0.44f, h * 0.95f, w * 0.24f, h * 0.86f, w * 0.14f, h * 0.66f)
                targetPath.cubicTo(w * 0.06f, h * 0.48f, w * 0.06f, h * 0.12f, w * 0.16f, h * 0.12f)
                targetPath.close()
            }

            MascotShape.STAR -> {
                // Puffy 4-point star
                targetPath.moveTo(w * 0.50f, h * 0.06f)
                targetPath.cubicTo(w * 0.58f, h * 0.35f, w * 0.65f, h * 0.42f, w * 0.94f, h * 0.50f)
                targetPath.cubicTo(w * 0.65f, h * 0.58f, w * 0.58f, h * 0.65f, w * 0.50f, h * 0.94f)
                targetPath.cubicTo(w * 0.42f, h * 0.65f, w * 0.35f, h * 0.58f, w * 0.06f, h * 0.50f)
                targetPath.cubicTo(w * 0.35f, h * 0.42f, w * 0.42f, h * 0.35f, w * 0.50f, h * 0.06f)
                targetPath.close()
            }

            MascotShape.CURSOR -> {
                // Classic iconic MOBOT wedge
                targetPath.moveTo(w * 0.12f, h * 0.10f)
                targetPath.lineTo(w * 0.90f, h * 0.52f)
                targetPath.cubicTo(w * 0.95f, h * 0.56f, w * 0.92f, h * 0.64f, w * 0.84f, h * 0.66f)
                targetPath.lineTo(w * 0.56f, h * 0.70f)
                targetPath.lineTo(w * 0.46f, h * 0.92f)
                targetPath.cubicTo(w * 0.42f, h * 0.98f, w * 0.32f, h * 0.96f, w * 0.30f, h * 0.88f)
                targetPath.lineTo(w * 0.08f, h * 0.16f)
                targetPath.cubicTo(w * 0.06f, h * 0.11f, w * 0.10f, h * 0.08f, w * 0.12f, h * 0.10f)
                targetPath.close()
            }
        }
        return targetPath
    }
}

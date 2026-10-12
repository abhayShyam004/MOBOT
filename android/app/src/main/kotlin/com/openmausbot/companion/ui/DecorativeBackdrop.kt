package com.openmausbot.companion.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * The decorative geometry a screen may carry in its empty space.
 *
 * The reference this language came from has shapes — a fan of pale teal petals, a
 * blush disc, a sand wedge — sitting in the corners of an otherwise empty light
 * page. They are what stops a screen of white surfaces from reading as a blank
 * form, and they cost nothing in legibility because they are drawn far enough
 * under everything to be texture rather than content.
 *
 * The rules these obey, in order:
 *
 *  - **Never behind words.** The motifs are placed in the top band and the outer
 *    edges, and stop where a screen's dense content starts. A shape a paragraph
 *    has to be read through is the failure mode of this whole idea.
 *  - **Low contrast.** Every shape is a pastel token at partial alpha — a tint in
 *    the page rather than an object on it, and held further down after dark, where
 *    there is far less luminance between a pastel and the page.
 *  - **One idea per screen.** A screen gets one motif set, not a collage. The
 *    variety between screens comes from *which* set and where it sits, not from
 *    how many shapes it has.
 *  - **No motion, and no layout.** The shapes never take space and never animate.
 *    A screen's first row starts where it would have started without them.
 */
enum class BackdropMotif {
    /** Nothing. A dense screen — a terminal, a table — carries no shapes. */
    NONE,

    /** The roster: a fan and two discs, in the band under the header. */
    HOME,

    /** A conversation: two flat rings, in the band the floating header occupies. */
    CHAT,

    /** A bot's own page: the largest treatment, behind the identity block. */
    PROFILE,

    /** Settings and lists: one small wedge, and that is all. */
    SETTINGS,

    /** A screen with one object on it — pairing, onboarding, an empty state. */
    HERO,
}

/** How tall a motif's band is by default: enough for the largest of them. */
private val DEFAULT_BAND = 260.dp

/**
 * The band of shapes, drawn behind this element's own content.
 *
 * This is the form a screen should reach for: it costs no layout, so a column of
 * content is written exactly as it would be without it, and the shapes end up
 * behind whatever is at the top. [DecorativeBackdrop] is the same drawing as a
 * sibling, for a screen that already has a `Box` to hang it in.
 */
@Composable
internal fun Modifier.backdrop(motif: BackdropMotif, band: Dp = DEFAULT_BAND): Modifier {
    if (motif == BackdropMotif.NONE) return this
    val colors = AppTheme.colors
    val weight = decorationWeight(colors)
    return this.drawBehind {
        drawBackdrop(
            motif = motif,
            colors = colors,
            weight = weight,
            width = size.width,
            bandHeight = band.toPx(),
        )
    }
}

/**
 * The same band as a sibling of the content, for a screen whose root is a `Box`.
 *
 * A `Box`'s children overlap, so this draws under the content without moving it.
 * A screen whose root is a `Column` wants [backdrop] instead: a sibling in a
 * `Column` is a 200 dp gap.
 */
@Composable
internal fun DecorativeBackdrop(
    motif: BackdropMotif,
    modifier: Modifier = Modifier,
    height: Dp = DEFAULT_BAND,
    alpha: Float = 1f,
) {
    if (motif == BackdropMotif.NONE) return
    val colors = AppTheme.colors
    val weight = decorationWeight(colors) * alpha
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(height),
    ) {
        drawBackdrop(
            motif = motif,
            colors = colors,
            weight = weight,
            width = size.width,
            bandHeight = size.height,
        )
    }
}

/**
 * A pastel that reads as a tint on a white page reads as a *shape* on a near-black
 * one, because there is far less luminance between it and the page. Held down
 * after dark so the two schemes carry the same weight of decoration.
 */
private fun decorationWeight(colors: AppColors): Float =
    if (colors.background.luminance() < 0.35f) 0.42f else 1f

/**
 * The drawing, shared by both entry points, in a coordinate space of
 * [width] × [bandHeight] with the origin at the top-left of the band.
 *
 * Every motif is drawn for a leading-to-trailing reading order and mirrored
 * wholesale under a right-to-left layout direction, so the fan trails off the same
 * corner of the page whichever way the page reads.
 */
private fun DrawScope.drawBackdrop(
    motif: BackdropMotif,
    colors: AppColors,
    weight: Float,
    width: Float,
    bandHeight: Float,
) {
    val mirror = layoutDirection == LayoutDirection.Rtl
    fun at(x: Float, y: Float): Offset = Offset(if (mirror) width - x else x, y)

    when (motif) {
        BackdropMotif.NONE -> Unit

        BackdropMotif.HOME -> {
            petalFan(
                // Inside the header's own glyphs and clear of the first rows: a
                // fan behind a control is a fan the control has to be found in
                // front of, and a fan behind a face makes the face look printed
                // on it.
                center = at(width * 0.82f, bandHeight * 0.40f),
                radius = 52.dp.toPx(),
                count = 8,
                color = colors.petalTeal,
                alpha = 0.26f * weight,
            )
            softDisc(
                // Down the leading edge, under the header and beside the first
                // rows rather than behind the group strip, which has tiles of its
                // own and does not need a second circle under them.
                center = at(width * 0.06f, bandHeight * 0.74f),
                radius = 30.dp.toPx(),
                color = colors.petalBlush,
                alpha = 0.22f * weight,
            )
            softDisc(
                center = at(width * 0.34f, bandHeight * 0.14f),
                radius = 16.dp.toPx(),
                color = colors.petalSand,
                alpha = 0.26f * weight,
            )
        }

        BackdropMotif.CHAT -> {
            // Rings, not discs: a conversation scrolls under this, so the treatment
            // has to be flat enough to sit behind a bubble's edge.
            arc(
                center = at(width * 0.88f, 8.dp.toPx()),
                radius = 96.dp.toPx(),
                color = colors.petalTeal,
                alpha = 0.30f * weight,
            )
            arc(
                center = at(width * 0.10f, -14.dp.toPx()),
                radius = 62.dp.toPx(),
                color = colors.petalSand,
                alpha = 0.26f * weight,
            )
        }

        BackdropMotif.PROFILE -> {
            petalFan(
                center = at(width * 0.78f, bandHeight * 0.42f),
                radius = 92.dp.toPx(),
                count = 10,
                color = colors.petalTeal,
                alpha = 0.46f * weight,
            )
            softDisc(
                center = at(width * 0.10f, bandHeight * 0.66f),
                radius = 60.dp.toPx(),
                color = colors.petalSand,
                alpha = 0.28f * weight,
            )
            softDisc(
                center = at(width * 0.46f, bandHeight * 0.10f),
                radius = 26.dp.toPx(),
                color = colors.petalBlush,
                alpha = 0.34f * weight,
            )
        }

        BackdropMotif.SETTINGS -> {
            wedge(
                center = at(width * 0.94f, bandHeight * 0.18f),
                radius = 58.dp.toPx(),
                color = colors.petalTeal,
                alpha = 0.26f * weight,
            )
        }

        BackdropMotif.HERO -> {
            softDisc(
                center = at(width * 0.80f, bandHeight * 0.30f),
                radius = 72.dp.toPx(),
                color = colors.petalBlush,
                alpha = 0.32f * weight,
            )
            petalFan(
                center = at(width * 0.14f, bandHeight * 0.62f),
                radius = 66.dp.toPx(),
                count = 7,
                color = colors.petalSand,
                alpha = 0.34f * weight,
            )
            softDisc(
                center = at(width * 0.56f, bandHeight * 0.08f),
                radius = 20.dp.toPx(),
                color = colors.petalSky,
                alpha = 0.36f * weight,
            )
        }
    }
}

/**
 * A fan of [count] rounded petals around [center] — the reference's own motif,
 * built from one rounded rectangle per petal, rotated evenly around the centre.
 *
 * Each petal starts a little away from the centre and ends at [radius], so the fan
 * has a hole in the middle: that is what makes it read as a flower rather than a
 * pie, and it is what the reference draws.
 */
private fun DrawScope.petalFan(
    center: Offset,
    radius: Float,
    count: Int,
    color: Color,
    alpha: Float,
) {
    if (count <= 0) return
    val inner = radius * 0.30f
    val length = radius - inner
    val petalWidth = (2f * Math.PI.toFloat() * radius / count) * 0.46f
    val brush = color.copy(alpha = alpha)
    repeat(count) { index ->
        val degrees = index * (360f / count)
        rotate(degrees = degrees, pivot = center) {
            drawRoundRect(
                color = brush,
                topLeft = Offset(center.x - petalWidth / 2f, center.y - radius),
                size = Size(petalWidth, length),
                cornerRadius = CornerRadius(petalWidth / 2f),
            )
        }
    }
}

/** A soft disc — the reference's plain round shapes. */
private fun DrawScope.softDisc(
    center: Offset,
    radius: Float,
    color: Color,
    alpha: Float,
) {
    drawCircle(color = color.copy(alpha = alpha), radius = radius, center = center)
}

/** A quarter wedge, drawn as a filled arc: a corner shape rather than a disc. */
private fun DrawScope.wedge(
    center: Offset,
    radius: Float,
    color: Color,
    alpha: Float,
    startAngle: Float = -90f,
    sweep: Float = 90f,
) {
    drawArc(
        color = color.copy(alpha = alpha),
        startAngle = startAngle,
        sweepAngle = sweep,
        useCenter = true,
        topLeft = Offset(center.x - radius, center.y - radius),
        size = Size(radius * 2f, radius * 2f),
    )
}

/** A ring, for the treatment that has to stay flat behind scrolling content. */
private fun DrawScope.arc(
    center: Offset,
    radius: Float,
    color: Color,
    alpha: Float,
    stroke: Float = 18f,
) {
    drawCircle(
        color = color.copy(alpha = alpha),
        radius = radius,
        center = center,
        style = Stroke(width = stroke),
    )
}

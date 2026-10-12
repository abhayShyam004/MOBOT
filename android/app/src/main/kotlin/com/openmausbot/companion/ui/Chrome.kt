package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The one material the floating chrome is made of — where `ios/App/Glass.swift`
 * sits in the port, done the way Android does it.
 *
 * iOS floats its bars on real glass: Liquid Glass on iOS 26, `.ultraThinMaterial`
 * before that, both of which refract whatever scrolls beneath. Android has no
 * counterpart this app can use. The only backdrop blur the platform offers is
 * `RenderEffect`, which `androidx.compose.ui.graphics.BlurEffect` gates at
 * `SDK_INT >= 31`; this app starts at 26, so five API levels would get no chrome
 * at all. Blurring by hand instead — capturing the backdrop into a layer every
 * frame, over a roster of animated mascots — buys a look at the price of the
 * scroll, which is the wrong trade on a list.
 *
 * So the chrome is not translucent. What it is now is quieter than it used to be:
 * one step up from the page's own background, separated by a hairline rather than
 * lifted by a shadow. A shadow under every pill and bar is what makes a screen
 * read as layers of floating objects; the hairline says "this sits on top" just as
 * clearly and costs the composition nothing. It is still opaque — legible over any
 * content by construction, identical on API 26 and 37 — and both `background` and
 * `border` cache their outline against size, layout direction and shape.
 */

/** Below this, a control is hard to hit; Android asks for 48 dp either way. */
internal val MIN_TOUCH_TARGET: Dp = 48.dp

/** A capsule of chrome — pills and round buttons. */
@Composable
internal fun Modifier.chromeCapsule(): Modifier = chrome(CircleShape)

/** A rounded sheet of chrome. */
@Composable
internal fun Modifier.chromeSheet(cornerRadius: Dp = AppRadii.sheet): Modifier =
    chrome(RoundedCornerShape(cornerRadius))

@Composable
internal fun Modifier.chrome(shape: Shape): Modifier = this
    // White, not a grey well: the reference draws its controls as light tiles on a
    // warm page, separated by a hairline rather than by being darker than what is
    // behind them. On a page whose cards are also white that reads as a control
    // sitting *on* the page, which is the point.
    .background(AppTheme.colors.surface, shape)
    .border(1.dp, AppTheme.colors.hairline, shape)

/**
 * A round chrome button with one glyph — the shape of every action in the chrome
 * that is not a pill.
 *
 * The tile keeps the size the design draws it at; the clickable area around it is
 * always at least [MIN_TOUCH_TARGET], so a 44 dp tile does not hand back a target
 * Android considers too small.
 */
@Composable
internal fun ChromeButton(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    glyph: Dp = 20.dp,
    enabled: Boolean = true,
    tint: Color = Color.Unspecified,
) {
    ChromeButton(modifier, size, enabled, onClick) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint,
            modifier = Modifier.size(glyph),
        )
    }
}

/** The same button for a glyph the core icon set does not carry. */
@Composable
internal fun ChromeButton(
    painter: Painter,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    glyph: Dp = 20.dp,
    enabled: Boolean = true,
    tint: Color = Color.Unspecified,
) {
    ChromeButton(modifier, size, enabled, onClick) {
        Icon(
            painter = painter,
            contentDescription = contentDescription,
            tint = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint,
            modifier = Modifier.size(glyph),
        )
    }
}

@Composable
private fun ChromeButton(
    modifier: Modifier,
    size: Dp,
    enabled: Boolean,
    onClick: () -> Unit,
    glyph: @Composable () -> Unit,
) {
    // No description on the target: the glyph inside carries it, and `clickable`
    // merges its descendants, so naming it twice is how a control gets read twice.
    TouchTarget(modifier = modifier, size = size, enabled = enabled, onClick = onClick) {
        Box(
            modifier = Modifier
                .size(size)
                .chromeCapsule(),
            contentAlignment = Alignment.Center,
            content = { glyph() },
        )
    }
}

/**
 * A header's action: a bare glyph, no tile under it.
 *
 * The reference's own header is a mark on one side and two glyphs on the other,
 * with nothing drawn around either of them. A filled or outlined circle per action
 * is what makes a header read as a toolbar and eats the width a title would have
 * had; the target is still [MIN_TOUCH_TARGET], so the drawing shrinks and the
 * thing a thumb hits does not.
 */
@Composable
internal fun HeaderGlyphButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    glyph: Dp = 22.dp,
    enabled: Boolean = true,
) {
    TouchTarget(onClick = onClick, modifier = modifier, enabled = enabled) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = if (enabled) AppTheme.colors.textPrimary else AppTheme.colors.textTertiary,
            modifier = Modifier.size(glyph),
        )
    }
}

/**
 * Leaving a flat header — Settings and the screens it opens.
 *
 * A bare glyph, not a filled circle: on a screen whose header already has a title
 * and a right-hand action, a third grey disc is the kind of chrome that makes a
 * simple screen look like a toolbar. The target is still [MIN_TOUCH_TARGET]; only
 * the drawing is smaller.
 */
@Composable
internal fun HeaderBackButton(onBack: () -> Unit, modifier: Modifier = Modifier) {
    TouchTarget(onClick = onBack, modifier = modifier, contentDescription = "Back") {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = null,
            tint = AppTheme.colors.textSecondary,
            modifier = Modifier.size(22.dp),
        )
    }
}

/**
 * A control drawn at [size] but hit at [MIN_TOUCH_TARGET]: the visual stays where
 * the design puts it while the target stays where Android's guidance puts it.
 *
 * [contentDescription] is for a target whose content says nothing on its own — a
 * bare glyph, a face. Where the content is already a labelled icon or a line of
 * text, leave it null and let that name the button.
 */
@Composable
internal fun TouchTarget(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = MIN_TOUCH_TARGET,
    enabled: Boolean = true,
    contentDescription: String? = null,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .size(if (size > MIN_TOUCH_TARGET) size else MIN_TOUCH_TARGET)
            .clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .then(
                if (contentDescription == null) {
                    Modifier
                } else {
                    Modifier.semantics { this.contentDescription = contentDescription }
                },
            ),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

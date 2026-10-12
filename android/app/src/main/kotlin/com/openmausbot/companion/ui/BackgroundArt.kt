package com.openmausbot.companion.ui

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.R

/**
 * One wallpaper the whole app can stand on.
 *
 * A background is not a per-screen decoration: a person picks a picture once
 * and then meets it on the roster, in a chat, and in Settings, and any screen
 * that had its own would read as a different app. So this catalog is the one
 * list Settings offers, and the root of the composition is the one place that
 * draws it.
 *
 * **Adding one** is two steps: drop the file at
 * `app/src/main/res/drawable-nodpi/wallpaper_<id>.webp` (a portrait image,
 * ~840×1870 keeps it under 40 KB) and add a line below. Settings and the root
 * render from this list, so nothing else needs to know it grew.
 */
data class BackgroundArt(
    /** The stored value Settings writes; empty means the plain page. */
    val id: String,
    /** How the choice is named where a person picks it. */
    val label: String,
    @DrawableRes val drawable: Int,
) {
    companion object {
        /**
         * Every wallpaper this build ships, in the order the picker shows them.
         *
         * The names are the pictures' own — short, because they are printed
         * under a 90dp thumbnail.
         */
        val all: List<BackgroundArt> = listOf(
            BackgroundArt("spring", "Spring", R.drawable.wallpaper_spring),
            BackgroundArt("waves", "Waves", R.drawable.wallpaper_waves),
            BackgroundArt("garden", "Garden", R.drawable.wallpaper_garden),
            BackgroundArt("dreamscape", "Dreamscape", R.drawable.wallpaper_dreamscape),
            BackgroundArt("lavender", "Lavender", R.drawable.wallpaper_lavender),
            BackgroundArt("sakura", "Sakura", R.drawable.wallpaper_sakura),
        )

        /**
         * The wallpaper a stored id names, or null for the plain page.
         *
         * An id this build does not know — a wallpaper removed by an update, a
         * value written by a newer build — reads as "none" rather than crashing
         * on a drawable that is not there: a missing picture must never be able
         * to take the app down with it.
         */
        fun fromId(id: String?): BackgroundArt? = all.firstOrNull { it.id == id }
    }
}

/**
 * How much of the page's own colour is washed over the picture.
 *
 * The line this draws: the art has to survive — a wallpaper behind a 90%
 * wash is a wallpaper nobody picked — while every line of text on top of it
 * stays as readable as it was on the plain page. Half is where both hold for
 * these pale pictures; a darker theme asks for more, because white type over
 * a pastel needs more ground than dark type does.
 */
private const val WALLPAPER_SCRIM: Float = 0.55f
private const val WALLPAPER_SCRIM_DARK: Float = 0.72f

/**
 * The chosen wallpaper, painted behind everything the app draws.
 *
 * Deliberately at the root, outside the inset padding: the picture runs edge
 * to edge behind the status and gesture bars, which is the only way it reads
 * as the place the app is rather than a rectangle behind its content.
 *
 * It paints the page colour first, always. The Surface above it is transparent
 * (the wallpaper is the page now), so this is what a screen stands on — and
 * with no wallpaper chosen it is the same flat colour the Surface used to
 * paint, which is how "none" stays indistinguishable from the app before this
 * feature existed.
 */
@Composable
internal fun AppWallpaper(id: String, dark: Boolean, modifier: Modifier = Modifier) {
    val art = BackgroundArt.fromId(id)
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(AppTheme.colors.background),
    ) {
        if (art != null) {
            Image(
                painter = painterResource(id = art.drawable),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        AppTheme.colors.background.copy(
                            alpha = if (dark) WALLPAPER_SCRIM_DARK else WALLPAPER_SCRIM,
                        ),
                    ),
            )
        }
    }
}

/**
 * The picker Settings offers: one strip of pictures, the current one marked.
 *
 * A strip and not a list, because these are pictures — a person chooses one by
 * recognising it, and a column of names would make them read instead of look.
 * "None" is a swatch of the page's own colour, so the choice a person made
 * when they chose nothing is visible rather than an absence.
 */
@Composable
internal fun BackgroundPicker(
    selectedId: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AppTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(vertical = AppSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        BackgroundSwatch(
            label = "None",
            selected = selectedId.isEmpty(),
            onClick = { onSelect("") },
            content = {},
        )
        BackgroundArt.all.forEach { art ->
            BackgroundSwatch(
                label = art.label,
                selected = art.id == selectedId,
                onClick = { onSelect(art.id) },
                content = {
                    Image(
                        painter = painterResource(id = art.drawable),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                },
            )
        }
    }
}

/**
 * One wallpaper as a choice: the picture, its name, and a border that says
 * whether it is the one in force.
 */
@Composable
private fun BackgroundSwatch(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = AppTheme.colors
    val shape = RoundedCornerShape(AppRadii.small)
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
    ) {
        Box(
            modifier = Modifier
                .width(SWATCH_WIDTH)
                .height(SWATCH_HEIGHT)
                .clip(shape)
                .background(colors.surface)
                .border(
                    width = if (selected) 2.dp else 1.dp,
                    color = if (selected) colors.accent else colors.hairline,
                    shape = shape,
                )
                .clickable(role = Role.Button, onClick = onClick)
                .semantics { contentDescription = "Background $label" },
            contentAlignment = Alignment.Center,
        ) {
            content()
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) colors.textPrimary else colors.textTertiary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The thumbnail's own size: portrait, at the pictures' aspect ratio. */
private val SWATCH_WIDTH = 76.dp
private val SWATCH_HEIGHT = 136.dp

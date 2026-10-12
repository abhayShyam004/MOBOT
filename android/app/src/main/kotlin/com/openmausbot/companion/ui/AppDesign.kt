package com.openmausbot.companion.ui

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The design system: one place that decides what this app looks like.
 *
 * Screens do not carry colours, sizes or corner radii of their own. They ask
 * [AppTheme] — `AppTheme.colors.textSecondary`, [AppSpacing.lg], [AppRadii.card] —
 * so a quiet surface stays the same quiet in the roster, the chat and Settings,
 * and a change here reaches every screen at once.
 *
 * **The interface is light.** A warm off-white canvas, white raised surfaces, soft
 * neutral wells, near-black ink, and a single charcoal accent for the one filled
 * action a screen is allowed. That is the language this design came from: a light
 * page, dark type, and almost no chrome. Dark is a real second scheme, not an
 * inversion — the same hierarchy and the same restraint on a warm near-black
 * canvas — because a person who prefers dark should not get a washed-out light
 * screen.
 *
 * **Colour is scarce and it belongs to the bots and to the backdrop.** The one
 * exception is a pastel set — [AppColors.petalTeal], [AppColors.petalSand],
 * [AppColors.petalBlush], [AppColors.petalSky] — used by [DecorativeBackdrop]'s
 * geometry and by an avatar's own identity, never to paint a control. A screen
 * with a pastel shape in its corner and one dark button reads as designed; a
 * screen where every element has a colour reads as a dashboard.
 *
 * The mascot's own ten colours are *not* here. They belong to the bots
 * ([MausPalette]); the interface borrows them for an avatar and nothing else.
 */
@Immutable
data class AppColors(
    /** The page: a warm off-white, never a cold white. */
    val background: Color,
    /** Raised surfaces: cards, fields, the sheets a screen floats on the page. */
    val surface: Color,
    /** A soft neutral on [surface] — chips, tags, an unfilled control. */
    val surfaceRaised: Color,
    /** Sunken wells: the composer at rest, code blocks, terminal bodies. */
    val surfaceSunken: Color,
    /** One hairline, used for separators and nothing else. */
    val hairline: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    /** Metadata: timestamps, counts, captions. Never body copy. */
    val textTertiary: Color,
    /**
     * The one filled action on a screen, and almost nothing else: the send
     * button, a primary pill. Charcoal rather than a hue, which is what keeps a
     * screen of coloured avatars from arguing with its own buttons.
     */
    val accent: Color,
    val onAccent: Color,
    /** The app's own mark — the mascot's green, the one place the brand shows. */
    val brand: Color,
    /** A selection wash: the row or chip a person just chose. */
    val selected: Color,
    /** Restrained state colours. They inform; they never decorate. */
    val positive: Color,
    val caution: Color,
    val danger: Color,
    /** The person's own words: the transcript's high-contrast side. */
    val myBubble: Color,
    val onMyBubble: Color,
    /** Decorative geometry, drawn well under anything readable. */
    val petalTeal: Color,
    val petalSand: Color,
    val petalBlush: Color,
    val petalSky: Color,
)

/**
 * What the app looks like in daylight — the primary design.
 *
 * Values are measured off the reference this language came from: a canvas of
 * `#E8E9E5`–`#F3F2EE`, white cards and fields, soft `#F5F5F4` wells, ink at
 * `#17181A`, a charcoal `#1C1D1F` filled action, and the pastel set at the
 * saturation the reference's own geometry carries.
 */
internal val LightAppColors = AppColors(
    background = Color(0xFFF3F2EE),
    surface = Color(0xFFFFFFFF),
    surfaceRaised = Color(0xFFE9E8E3),
    surfaceSunken = Color(0xFFEFEEE9),
    hairline = Color(0x14000000),
    textPrimary = Color(0xFF17181A),
    textSecondary = Color(0xFF55585D),
    textTertiary = Color(0xFF878A8F),
    accent = Color(0xFF1C1D1F),
    onAccent = Color(0xFFFFFFFF),
    brand = Color(MausPalette.argb("green")),
    selected = Color(0xFFDCE8E4),
    positive = Color(0xFF1E8A4C),
    caution = Color(0xFFA87514),
    danger = Color(0xFFBC4038),
    // The person's own words take the reference's dark bubble: the transcript has
    // one side in ink and one in white, so which side is speaking is legible
    // before a single word is read.
    myBubble = Color(0xFF1D1F21),
    onMyBubble = Color(0xFFF6F7F4),
    petalTeal = Color(0xFF9CC3BF),
    petalSand = Color(0xFFE9C68C),
    petalBlush = Color(0xFFEFBFB9),
    petalSky = Color(0xFFB9CFE2),
)

/**
 * The same system after dark: same structure, same scarcity, inverted weight.
 *
 * Warm near-black rather than blue-black, so it reads as the same material as the
 * light scheme, and the pastels are held down to deep muted tones — the same
 * shapes in the same places, at the brightness a dark screen can carry.
 */
internal val DarkAppColors = AppColors(
    background = Color(0xFF121311),
    surface = Color(0xFF1B1C19),
    surfaceRaised = Color(0xFF252720),
    surfaceSunken = Color(0xFF0E0F0D),
    hairline = Color(0x1FFFFFFF),
    textPrimary = Color(0xFFF1F2ED),
    textSecondary = Color(0xFFA5A8A1),
    textTertiary = Color(0xFF767A72),
    // Inverted: after dark the *filled* side is the light one, the same way the
    // reference's dark pill would become a light pill on a dark page.
    accent = Color(0xFFEFF0EA),
    onAccent = Color(0xFF17181A),
    brand = Color(0xFF3FBD86),
    selected = Color(0xFF233029),
    positive = Color(0xFF57C288),
    caution = Color(0xFFD9B471),
    danger = Color(0xFFE4888A),
    myBubble = Color(0xFF2B3730),
    onMyBubble = Color(0xFFE9F2EC),
    petalTeal = Color(0xFF2E4A46),
    petalSand = Color(0xFF4A3F26),
    petalBlush = Color(0xFF4A3331),
    petalSky = Color(0xFF2B3A47),
)

/** Mirrors [CompanionTheme]'s choice, so Compose-only previews and screens agree. */
internal val LocalAppColors = staticCompositionLocalOf { LightAppColors }

/**
 * The spacing scale. Everything that separates two things uses one of these, so
 * rhythm is a decision made once rather than per screen.
 */
object AppSpacing {
    /** Between an icon and its label. */
    val xs: Dp = 4.dp

    /** Between two lines of one block. */
    val sm: Dp = 8.dp

    /** Inside a control. */
    val md: Dp = 12.dp

    /** Between controls in a group. */
    val lg: Dp = 16.dp

    /** The screen gutter. Every screen lines its content up on this. */
    val gutter: Dp = 20.dp

    /** Between two groups. */
    val xl: Dp = 28.dp

    /** Above a screen's title block. */
    val xxl: Dp = 40.dp
}

/** Corner radii, so a "rounded surface" means the same curve everywhere. */
object AppRadii {
    /** A chip, a tag, a small tile. */
    val small: Dp = 12.dp

    /** A row, a field, a list item that is itself a surface. */
    val row: Dp = 18.dp

    /** A card: content that is one object. */
    val card: Dp = 22.dp

    /** A sheet, and the backdrop's own tiles. */
    val sheet: Dp = 28.dp

    val cardShape: Shape get() = RoundedCornerShape(card)
    val rowShape: Shape get() = RoundedCornerShape(row)
    val smallShape: Shape get() = RoundedCornerShape(small)
    val pill: Shape get() = CircleShape
}

/**
 * Motion. Short and purposeful: a screen change, an expanding section, a row
 * arriving. Nothing bounces, nothing spins for decoration, and nothing that a
 * person did not initiate animates for longer than [SLOW].
 */
object AppMotion {
    /** A state change the person caused: a toggle, a chip becoming selected. */
    const val FAST: Int = 120

    /** The default: a section expanding, a sheet arriving, a row settling in. */
    const val BASE: Int = 220

    /** Screen-level transitions and list rearrangements. */
    const val SLOW: Int = 320
}

/** Sizes shared by more than one screen. */
object AppSizes {
    /**
     * The avatar in a roster row: the loudest object in the list.
     *
     * 46 dp, taken off the reference this is drawn from: its faces measure 0.118
     * of the screen width, and the row's own pitch — avatar plus the whitespace
     * around it — came to about 0.205, which is what makes the list airy without
     * making it a gallery.
     */
    val rowAvatar: Dp = 46.dp

    /** An avatar beside a transcript row, or in a chat's top bar. */
    val smallAvatar: Dp = 38.dp

    /** The profile avatar in a screen header. */
    val headerAvatar: Dp = 34.dp

    /** A status dot — unread, presence. */
    val dot: Dp = 8.dp

    /** The glyph inside a chrome button. */
    val glyph: Dp = 20.dp
}

/**
 * Read the tokens: `AppTheme.colors.textSecondary`.
 *
 * A plain object rather than a wrapper composable, so a screen that needs one
 * colour does not wrap its whole body to get it.
 */
object AppTheme {
    val colors: AppColors
        @Composable @ReadOnlyComposable get() = LocalAppColors.current
}

/**
 * Type that is not a step on the scale but a treatment of one.
 *
 * [hero] exists because one screen — the roster — opens on a single oversized
 * line, the way the reference opens on its date. It is [Typography.displayLarge]
 * at a larger size, tighter tracking and a heavier weight rather than a new
 * style: the family, the direction policy and the colour are the theme's, and
 * only the size of the line is this treatment's business.
 */
object AppType {
    /** The one oversized line a screen is allowed to spend. */
    val hero: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.displayLarge.copy(
            fontSize = 42.sp,
            lineHeight = 44.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-1.4).sp,
        )
}

/**
 * The app's typography: hierarchy carried by size and weight, not by colour.
 *
 * Each step has exactly one job — a screen title, the primary object in a row, a
 * line of body copy, metadata — so two things that are not equally important
 * never look equally important. Weights stop at SemiBold: nothing here needs
 * Bold to be read, and Bold everywhere reads as shouting.
 *
 * [display] is the reference's own treatment: a large, tightly tracked line that
 * a screen may spend once — a bot's name on its own profile, the number in a
 * summary — and never as a heading over a list.
 */
internal fun appTypography(): Typography {
    val base = Typography()

    fun TextStyle.step(
        size: Int,
        lineHeight: Int,
        weight: FontWeight,
        tracking: Double = 0.0,
    ): TextStyle = copy(
        fontSize = size.sp,
        lineHeight = lineHeight.sp,
        fontWeight = weight,
        letterSpacing = tracking.sp,
        // The direction policy is the theme's, not each screen's: see
        // [CompanionTheme] for why text resolves from its own content.
        textDirection = TextDirection.ContentOrLtr,
    )

    // The one big line a screen is allowed.
    val display = base.displayLarge.step(34, 38, FontWeight.SemiBold, tracking = (-1.1))
    val screenTitle = base.displayLarge.step(26, 32, FontWeight.SemiBold, tracking = (-0.5))
    val sectionTitle = base.displayLarge.step(18, 24, FontWeight.SemiBold, tracking = (-0.2))

    // Objects: a bot's name, a thread's title, a provider's name.
    val objectLarge = base.displayLarge.step(16, 21, FontWeight.SemiBold, tracking = (-0.1))
    val objectMedium = base.displayLarge.step(15, 20, FontWeight.Medium)
    val objectSmall = base.displayLarge.step(14, 18, FontWeight.Medium)

    // Copy.
    val body = base.displayLarge.step(16, 23, FontWeight.Normal)
    val bodyCompact = base.displayLarge.step(15, 20, FontWeight.Normal)
    val caption = base.displayLarge.step(13, 18, FontWeight.Normal)

    // Metadata: timestamps, counts, section headers.
    val meta = base.displayLarge.step(12, 16, FontWeight.Medium, tracking = 0.4)
    val metaQuiet = base.displayLarge.step(12, 16, FontWeight.Normal)

    return base.copy(
        displayLarge = display,
        displayMedium = display,
        displaySmall = screenTitle,
        headlineLarge = screenTitle,
        headlineMedium = screenTitle,
        headlineSmall = screenTitle,
        titleLarge = sectionTitle,
        titleMedium = objectLarge,
        titleSmall = objectMedium,
        bodyLarge = body,
        bodyMedium = bodyCompact,
        bodySmall = caption,
        labelLarge = meta,
        labelMedium = meta,
        labelSmall = metaQuiet,
    )
}

/** Material's scheme, built from [AppColors] so Material widgets match the tokens. */
internal fun appColorScheme(colors: AppColors, dark: Boolean) = run {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    base.copy(
        primary = colors.accent,
        onPrimary = colors.onAccent,
        secondary = colors.textSecondary,
        onSecondary = colors.onAccent,
        background = colors.background,
        onBackground = colors.textPrimary,
        surface = colors.background,
        onSurface = colors.textPrimary,
        surfaceVariant = colors.surfaceRaised,
        onSurfaceVariant = colors.textSecondary,
        // Every one of Material's "container" levels is the page's own white.
        // A `Card`, a dialog, a bottom sheet and an `ElevatedCard` all pick from
        // these slots, and the design language has exactly one raised surface:
        // white on the warm page, at different corner radii. Leaving the default
        // M3 mapping in place gave a card the *background* colour, which is a grey
        // rectangle on a grey page.
        surfaceContainer = colors.surface,
        surfaceContainerHigh = colors.surface,
        surfaceContainerHighest = colors.surface,
        surfaceContainerLow = colors.surface,
        surfaceContainerLowest = colors.surface,
        outline = colors.hairline,
        outlineVariant = colors.hairline,
        error = colors.danger,
        onError = colors.onAccent,
        scrim = Color.Black,
    )
}

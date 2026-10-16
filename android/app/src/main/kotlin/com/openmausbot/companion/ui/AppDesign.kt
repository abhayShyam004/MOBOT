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
import androidx.compose.ui.text.font.FontFamily
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
    /** The page: neutral OLED ground (#141414) in dark, warm off-white (#F3F2EE) in light. */
    val background: Color,
    /** Raised surfaces: cards, fields, sheets. */
    val surface: Color,
    /** Elevated surface: inputs, elevated dialogs, card highlights (#202024 / #FFFFFF). */
    val elevatedSurface: Color = surface,
    /** Surface variant: grouped section background / subtle secondary fills (#18181B / #E9E8E3). */
    val surfaceVariant: Color = surface,
    /** A soft neutral on [surface] — chips, tags, an unfilled control. */
    val surfaceRaised: Color,
    /** Sunken wells: code blocks, terminal bodies, inset canvas (#0D0D0D / #EFEEE9). */
    val surfaceSunken: Color,
    /** One hairline, used for separators and subtle dividers. */
    val hairline: Color,
    /** Crisp 1px card and input borders (#313538 / #D4D4D8). */
    val border: Color = hairline,
    /** Subtle 1px inner borders (#262626 / #E4E4E7). */
    val subtleBorder: Color = hairline,
    /** Divider lines. */
    val divider: Color = hairline,
    /** Primary text ink. Maximum contrast. */
    val textPrimary: Color,
    /** Secondary text: descriptions, subtitles, timestamps. */
    val textSecondary: Color,
    /** Metadata: timestamps, counts, captions. */
    val textTertiary: Color,
    /** Disabled text ink. */
    val disabledText: Color = textTertiary,
    /**
     * Primary action fill and content: high-contrast pill button.
     * White on dark ground, Charcoal on light ground.
     */
    val accent: Color,
    val onAccent: Color,
    val primaryAction: Color = accent,
    val primaryActionContent: Color = onAccent,
    val secondaryAction: Color = surfaceRaised,
    /** The app's own mark. */
    val brand: Color,
    /** Selection and interaction washes. */
    val selected: Color,
    val pressed: Color = surfaceRaised,
    val focused: Color = border,
    val disabled: Color = surfaceRaised,
    /** Semantic state colours. */
    val positive: Color,
    val caution: Color,
    val danger: Color,
    val info: Color = brand,
    val success: Color = positive,
    val warning: Color = caution,
    val destructive: Color = danger,
    /** Agent execution states. */
    val thinking: Color = caution,
    val running: Color = brand,
    val waiting: Color = caution,
    val recovering: Color = caution,
    val error: Color = danger,
    val complete: Color = positive,
    /** The person's own words: high-contrast user bubble. */
    val myBubble: Color,
    val onMyBubble: Color,
    /** Decorative geometry. */
    val petalTeal: Color,
    val petalSand: Color,
    val petalBlush: Color,
    val petalSky: Color,
)

/**
 * What the app looks like in daylight — clean, warm, high-contrast.
 */
internal val LightAppColors = AppColors(
    background = Color(0xFFF3F2EE),
    surface = Color(0xFFFFFFFF),
    elevatedSurface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFE9E8E3),
    surfaceRaised = Color(0xFFE9E8E3),
    surfaceSunken = Color(0xFFEFEEE9),
    hairline = Color(0x14000000),
    border = Color(0xFFD4D4D8),
    subtleBorder = Color(0xFFE4E4E7),
    divider = Color(0x14000000),
    textPrimary = Color(0xFF17181A),
    textSecondary = Color(0xFF55585D),
    textTertiary = Color(0xFF878A8F),
    disabledText = Color(0xFFA1A1AA),
    accent = Color(0xFF1C1D1F),
    onAccent = Color(0xFFFFFFFF),
    secondaryAction = Color(0xFFE4E4E7),
    brand = Color(MausPalette.argb("green")),
    selected = Color(0xFFDCE8E4),
    pressed = Color(0xFFE2E8F0),
    focused = Color(0xFFCBD5E1),
    disabled = Color(0xFFF1F5F9),
    positive = Color(0xFF1E8A4C),
    caution = Color(0xFFA87514),
    danger = Color(0xFFBC4038),
    info = Color(0xFF0284C7),
    thinking = Color(0xFFD97706),
    running = Color(0xFF0284C7),
    waiting = Color(0xFF7C3AED),
    recovering = Color(0xFFEA580C),
    myBubble = Color(0xFF1D1F21),
    onMyBubble = Color(0xFFF6F7F4),
    petalTeal = Color(0xFF9CC3BF),
    petalSand = Color(0xFFE9C68C),
    petalBlush = Color(0xFFEFBFB9),
    petalSky = Color(0xFFB9CFE2),
)

/**
 * The same system after dark: calm OLED neutral depth, crisp hairlines, pure white primary CTA.
 */
internal val DarkAppColors = AppColors(
    background = Color(0xFF141414),
    surface = Color(0xFF18181B),
    elevatedSurface = Color(0xFF202024),
    surfaceVariant = Color(0xFF18181B),
    surfaceRaised = Color(0xFF202024),
    surfaceSunken = Color(0xFF0D0D0D),
    hairline = Color(0xFF262626),
    border = Color(0xFF313538),
    subtleBorder = Color(0xFF262626),
    divider = Color(0xFF262626),
    textPrimary = Color(0xFFFFFFFF),
    textSecondary = Color(0xFFA1A1AA),
    textTertiary = Color(0xFF71717A),
    disabledText = Color(0xFF52525B),
    accent = Color(0xFFFFFFFF),
    onAccent = Color(0xFF141414),
    secondaryAction = Color(0xFF27272A),
    brand = Color(0xFF00C972),
    selected = Color(0xFF233029),
    pressed = Color(0xFF27272A),
    focused = Color(0xFF52525B),
    disabled = Color(0xFF27272A),
    positive = Color(0xFF00C972),
    caution = Color(0xFFFF9800),
    danger = Color(0xFFFF3E51),
    info = Color(0xFF38BDF8),
    thinking = Color(0xFFFFAF38),
    running = Color(0xFF2A92FE),
    waiting = Color(0xFFA97EFE),
    recovering = Color(0xFFFF781C),
    myBubble = Color(0xFF202024),
    onMyBubble = Color(0xFFFFFFFF),
    petalTeal = Color(0xFF2E4A46),
    petalSand = Color(0xFF4A3F26),
    petalBlush = Color(0xFF4A3331),
    petalSky = Color(0xFF2B3A47),
)

/** Mirrors [CompanionTheme]'s choice, so Compose-only previews and screens agree. */
internal val LocalAppColors = staticCompositionLocalOf { LightAppColors }

/**
 * The spacing scale adhering to an 8-point base grid with 4-point micro steps.
 */
object AppSpacing {
    /** 2dp micro-gap between status dot and text. */
    val xxs: Dp = 2.dp
    val micro: Dp = 2.dp

    /** 4dp icon-to-label gap / micro step. */
    val xs: Dp = 4.dp

    /** 8dp row spacing / chip gap. */
    val sm: Dp = 8.dp
    val row: Dp = 8.dp

    /** 12dp inside a control / compact card padding. */
    val md: Dp = 12.dp
    val control: Dp = 12.dp

    /** 14dp card padding. */
    val card: Dp = 14.dp

    /** 16dp default group padding / message margin. */
    val lg: Dp = 16.dp
    val message: Dp = 6.dp
    val turnGap: Dp = 14.dp
    val screenVertical: Dp = 16.dp

    /** 18dp primary screen horizontal gutter (measured: 18.1dp). */
    val gutter: Dp = 18.dp
    val screenHorizontal: Dp = 18.dp

    /** 20dp modal padding. */
    val modal: Dp = 20.dp

    /** 24dp section spacing. */
    val section: Dp = 24.dp

    /** 28dp between two distinct groups. */
    val xl: Dp = 28.dp

    /** 32dp major section gap. */
    val xxl: Dp = 32.dp

    /** 40dp above screen hero or title. */
    val xxxl: Dp = 40.dp
}

/** Corner radii: dual-geometry with full pill rounding for controls and subtle squircles for content. */
object AppRadii {
    val micro: Dp = 4.dp
    val xs: Dp = 8.dp
    val compactCard: Dp = 12.dp
    val small: Dp = 12.dp
    val card: Dp = 16.dp
    val message: Dp = 16.dp
    val row: Dp = 18.dp
    val dialog: Dp = 20.dp
    val input: Dp = 24.dp
    val sheet: Dp = 24.dp
    val button: Dp = 24.dp

    val cardShape: Shape get() = RoundedCornerShape(card)
    val compactCardShape: Shape get() = RoundedCornerShape(compactCard)
    val inputShape: Shape get() = RoundedCornerShape(input)
    val dialogShape: Shape get() = RoundedCornerShape(dialog)
    val sheetShape: Shape get() = RoundedCornerShape(sheet)
    val rowShape: Shape get() = RoundedCornerShape(row)
    val smallShape: Shape get() = RoundedCornerShape(small)
    val pill: Shape get() = CircleShape
}

/** Elevation layers using surface value shifts and crisp hairlines instead of heavy drop shadows. */
object AppElevation {
    val level0: Dp = 0.dp // Base Ground (#141414)
    val level1: Dp = 1.dp // Recessed (#0D0D0D)
    val level2: Dp = 2.dp // Surface Card (#18181B / #202024)
    val level3: Dp = 4.dp // Interactive Element (#222226)
    val level4: Dp = 8.dp // Modal / Bottom Sheet
    val floating: Dp = 12.dp // Floating Action Pill / Dock
}

/** Motion tokens: Purposeful, calibrated physics without decorative bounce. */
object AppMotion {
    const val FAST: Int = 120
    const val BASE: Int = 220
    const val SLOW: Int = 320
}

/** Sizes shared across P0 surfaces. */
object AppSizes {
    val rowAvatar: Dp = 52.dp
    val smallAvatar: Dp = 38.dp
    val headerAvatar: Dp = 34.dp
    val dot: Dp = 8.dp
    val glyph: Dp = 20.dp
    val smallGlyph: Dp = 16.dp
    val largeGlyph: Dp = 24.dp
    val iconTouchTarget: Dp = 44.dp
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
    val isDark: Boolean
        @Composable @ReadOnlyComposable get() = LocalAppColors.current == DarkAppColors
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
    /** The one oversized hero line a screen is allowed to spend (32sp / 38sp, Bold, -0.5px tracking). */
    val hero: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.displayLarge.copy(
            fontSize = 32.sp,
            lineHeight = 38.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.5).sp,
        )

    /** Large heading (28sp / 34sp, Bold, -0.3px tracking). */
    val largeHeading: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.displayMedium.copy(
            fontSize = 28.sp,
            lineHeight = 34.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.3).sp,
        )

    /** Screen title (22sp / 28sp, Semibold, -0.2px tracking). */
    val screenTitle: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.headlineMedium.copy(
            fontSize = 22.sp,
            lineHeight = 28.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.2).sp,
        )

    /** Section heading (18sp / 24sp, Semibold). */
    val sectionHeading: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.titleLarge.copy(
            fontSize = 18.sp,
            lineHeight = 24.sp,
            fontWeight = FontWeight.SemiBold,
        )

    /** Body regular (15sp / 22sp, Regular). */
    val body: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.bodyLarge.copy(
            fontSize = 15.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.Normal,
        )

    /** Body emphasized (15sp / 22sp, Medium/Semibold). */
    val bodyEmphasized: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.bodyLarge.copy(
            fontSize = 15.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.SemiBold,
        )

    /** Secondary copy (13sp / 18sp, Regular). */
    val secondary: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.bodyMedium.copy(
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Normal,
        )

    /** Metadata: timestamps, counts, tags (12sp / 16sp, Medium). */
    val metadata: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.labelMedium.copy(
            fontSize = 12.sp,
            lineHeight = 16.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 0.2.sp,
        )

    /** Caption (11sp / 15sp, Regular). */
    val caption: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.bodySmall.copy(
            fontSize = 11.sp,
            lineHeight = 15.sp,
            fontWeight = FontWeight.Normal,
        )

    /** Button label (15sp / 20sp, Semibold). */
    val button: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.labelLarge.copy(
            fontSize = 15.sp,
            lineHeight = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )

    /** Label (13sp / 18sp, Medium). */
    val label: TextStyle
        @Composable @ReadOnlyComposable
        get() = MaterialTheme.typography.labelLarge.copy(
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Medium,
        )

    /** Monospace body (13sp / 18sp, Monospace). */
    val code: TextStyle
        @Composable @ReadOnlyComposable
        get() = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Normal,
        )

    /** Monospace bold / commands (13sp / 18sp, Monospace Semibold). */
    val codeBold: TextStyle
        @Composable @ReadOnlyComposable
        get() = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
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
        surface = colors.surface,
        onSurface = colors.textPrimary,
        surfaceVariant = colors.surfaceVariant,
        onSurfaceVariant = colors.textSecondary,
        surfaceContainer = colors.surface,
        surfaceContainerHigh = colors.elevatedSurface,
        surfaceContainerHighest = colors.elevatedSurface,
        surfaceContainerLow = colors.surface,
        surfaceContainerLowest = colors.background,
        outline = colors.border,
        outlineVariant = colors.subtleBorder,
        error = colors.danger,
        onError = colors.onAccent,
        scrim = Color.Black,
    )
}

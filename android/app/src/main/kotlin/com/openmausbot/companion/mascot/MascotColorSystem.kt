package com.openmausbot.companion.mascot

import androidx.compose.ui.graphics.Color

/**
 * Visual styling spec for a mascot palette.
 */
data class MascotColorSpec(
    val primary: Color,
    val secondary: Color,
    val eyeColor: Color = Color.White,
    val pupilColor: Color = Color(0xFF1E1E24),
    val cheekColor: Color = Color(0xFFFF8DA1).copy(alpha = 0.45f),
)

/**
 * Curated color definitions ensuring high contrast, warmth, and vitality
 * across both dark and light UI surfaces.
 */
object MascotColorSystem {
    fun specFor(palette: MascotPalette): MascotColorSpec = when (palette) {
        MascotPalette.PURPLE -> MascotColorSpec(
            primary = Color(0xFF8B5CF6),
            secondary = Color(0xFF6D28D9),
            eyeColor = Color.White,
            pupilColor = Color(0xFF3B0764),
            cheekColor = Color(0xFFF472B6).copy(alpha = 0.40f),
        )
        MascotPalette.BLUE -> MascotColorSpec(
            primary = Color(0xFF3B82F6),
            secondary = Color(0xFF1D4ED8),
            eyeColor = Color.White,
            pupilColor = Color(0xFF1E3A8A),
            cheekColor = Color(0xFF93C5FD).copy(alpha = 0.40f),
        )
        MascotPalette.GREEN -> MascotColorSpec(
            primary = Color(0xFF10B981),
            secondary = Color(0xFF047857),
            eyeColor = Color.White,
            pupilColor = Color(0xFF064E3B),
            cheekColor = Color(0xFFA7F3D0).copy(alpha = 0.35f),
        )
        MascotPalette.PINK -> MascotColorSpec(
            primary = Color(0xFFEC4899),
            secondary = Color(0xFFBE185D),
            eyeColor = Color.White,
            pupilColor = Color(0xFF831843),
            cheekColor = Color(0xFFFBCFE8).copy(alpha = 0.45f),
        )
        MascotPalette.ORANGE -> MascotColorSpec(
            primary = Color(0xFFF97316),
            secondary = Color(0xFFC2410C),
            eyeColor = Color.White,
            pupilColor = Color(0xFF7C2D12),
            cheekColor = Color(0xFFFDE047).copy(alpha = 0.35f),
        )
        MascotPalette.RED -> MascotColorSpec(
            primary = Color(0xFFEF4444),
            secondary = Color(0xFFB91C1C),
            eyeColor = Color.White,
            pupilColor = Color(0xFF7F1D1D),
            cheekColor = Color(0xFFFECACA).copy(alpha = 0.40f),
        )
        MascotPalette.YELLOW -> MascotColorSpec(
            primary = Color(0xFFF59E0B),
            secondary = Color(0xFFD97706),
            // High contrast eyes for yellow ground ensures razor-sharp legibility:
            eyeColor = Color(0xFF1C1917),
            pupilColor = Color.White,
            cheekColor = Color(0xFFFB923C).copy(alpha = 0.45f),
        )
        MascotPalette.TEAL -> MascotColorSpec(
            primary = Color(0xFF14B8A6),
            secondary = Color(0xFF0F766E),
            eyeColor = Color.White,
            pupilColor = Color(0xFF134E4A),
            cheekColor = Color(0xFF99F6E4).copy(alpha = 0.35f),
        )
        MascotPalette.CHARCOAL -> MascotColorSpec(
            primary = Color(0xFF4B5563),
            secondary = Color(0xFF1F2937),
            eyeColor = Color.White,
            pupilColor = Color(0xFF111827),
            cheekColor = Color(0xFF9CA3AF).copy(alpha = 0.30f),
        )
        MascotPalette.CARAMEL -> MascotColorSpec(
            primary = Color(0xFFA16207),
            secondary = Color(0xFF713F12),
            eyeColor = Color.White,
            pupilColor = Color(0xFF451A03),
            cheekColor = Color(0xFFFDE68A).copy(alpha = 0.35f),
        )
    }
}

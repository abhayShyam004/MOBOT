package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * The words the roster's hero says, kept out of the composable so they can be
 * pinned without a device.
 */
internal object RosterHeroSpec {
    /**
     * The greeting for the hour of the day (preserved for spec/test compatibility).
     */
    fun greeting(hour: Int): String = when {
        hour < 5 -> "Still up"
        hour < 12 -> "Good morning"
        hour < 18 -> "Good afternoon"
        else -> "Good evening"
    }

    /**
     * How the fleet stands, in one line: how many bots there are, and how many of
     * them are working right now.
     */
    fun summary(bots: Int, working: Int): String {
        if (bots <= 0) return "No bots yet"
        val fleet = if (bots == 1) "1 bot" else "$bots bots"
        if (working <= 0) return "$fleet · all quiet"
        val busy = if (working == 1) "1 working" else "$working working"
        return "$fleet · $busy"
    }
}

/**
 * The roster's opening status line: fleet summary count with balanced spacing.
 * Greeting and redundant New Bot button are removed in favor of the header + action.
 */
@Composable
internal fun RosterHero(
    bots: Int,
    working: Int,
    onCreateBot: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = AppSpacing.gutter,
                end = AppSpacing.gutter,
                top = AppSpacing.xs,
                bottom = AppSpacing.xs,
            ),
    ) {
        Text(
            text = RosterHeroSpec.summary(bots, working),
            style = MaterialTheme.typography.bodySmall,
            color = AppTheme.colors.textTertiary,
        )
    }
}

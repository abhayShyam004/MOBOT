package com.openmausbot.companion.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

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
 * The roster's opening studio launchpad: fleet summary count, headline, and
 * a prominent quick launcher capsule.
 */
@Composable
internal fun RosterHero(
    bots: Int,
    working: Int,
    onCreateBot: (() -> Unit)? = null,
    onOpenSearch: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val colors = AppTheme.colors
    val isWorking = working > 0

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = AppSpacing.gutter,
                end = AppSpacing.gutter,
                top = AppSpacing.xs,
                bottom = AppSpacing.sm,
            ),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        // Status Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (isWorking) colors.running else colors.accent)
                        .size(7.dp),
                )
                Text(
                    text = RosterHeroSpec.summary(bots, working),
                    style = AppType.metadata,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textSecondary,
                )
            }

            Surface(
                shape = CircleShape,
                color = colors.surfaceVariant,
            ) {
                Text(
                    text = "Local Engine · 0ms",
                    style = AppType.caption,
                    color = colors.textTertiary,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }

        // Actionable Quick Prompt / Search Capsule
        if (onOpenSearch != null) {
            Surface(
                shape = AppRadii.inputShape,
                color = colors.elevatedSurface,
                border = BorderStroke(1.dp, colors.subtleBorder),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onOpenSearch),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Search,
                        contentDescription = "Search",
                        tint = colors.textTertiary,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = "Search fleet, threads, or ask…",
                        style = AppType.body,
                        color = colors.textTertiary,
                        modifier = Modifier.weight(1f),
                    )
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = colors.surfaceVariant,
                    ) {
                        Text(
                            text = "/",
                            style = AppType.caption,
                            fontWeight = FontWeight.Bold,
                            color = colors.textSecondary,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }
                }
            }
        }
    }
}

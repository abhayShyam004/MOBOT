package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Architectural foundation for prerequisite & missing capability guidance in MOBOT.
 *
 * Core Product Philosophy:
 * When a task or capability is required but not yet enabled, MOBOT does not merely say
 * "I can't." It informs the user specifically what is needed and provides a direct,
 * contextual action to configure or grant it.
 *
 * Example:
 * "Google Maps isn't connected yet."
 * [Connect Google Maps]
 */
enum class CapabilityKind {
    MODEL_PROVIDER,
    AGENT_PERMISSION,
    SYSTEM_PERMISSION,
    CONNECTED_SERVICE,
    DEVICE_FEATURE,
}

enum class CapabilityState {
    DISCONNECTED,
    CONFIGURING,
    CONNECTED,
    PERMISSION_DENIED,
    PERMISSION_GRANTED,
}

data class CapabilityPrerequisite(
    val id: String,
    val kind: CapabilityKind,
    val title: String,
    val description: String,
    val isConfigured: Boolean,
    val actionLabel: String,
    val category: String = "General",
    val state: CapabilityState = if (isConfigured) CapabilityState.CONNECTED else CapabilityState.DISCONNECTED,
)

object CommonCapabilities {
    val GOOGLE_MAPS = CapabilityPrerequisite(
        id = "google_maps",
        kind = CapabilityKind.CONNECTED_SERVICE,
        title = "Google Maps",
        description = "Required to search places, inspect business hours, and calculate routes.",
        isConfigured = false,
        actionLabel = "Connect Google Maps",
        category = "Navigation & Maps",
    )

    val GMAIL = CapabilityPrerequisite(
        id = "gmail",
        kind = CapabilityKind.CONNECTED_SERVICE,
        title = "Gmail",
        description = "Required to read inbox messages, draft responses, and send emails.",
        isConfigured = false,
        actionLabel = "Connect Gmail",
        category = "Communication",
    )

    val GITHUB = CapabilityPrerequisite(
        id = "github",
        kind = CapabilityKind.CONNECTED_SERVICE,
        title = "GitHub",
        description = "Required to inspect repositories, review pull requests, and commit code.",
        isConfigured = false,
        actionLabel = "Connect GitHub",
        category = "Development",
    )

    val SLACK = CapabilityPrerequisite(
        id = "slack",
        kind = CapabilityKind.CONNECTED_SERVICE,
        title = "Slack",
        description = "Required to participate in channel discussions and send notifications.",
        isConfigured = false,
        actionLabel = "Connect Slack",
        category = "Communication",
    )

    val NOTION = CapabilityPrerequisite(
        id = "notion",
        kind = CapabilityKind.CONNECTED_SERVICE,
        title = "Notion",
        description = "Required to query workspace databases, create pages, and organize notes.",
        isConfigured = false,
        actionLabel = "Connect Notion",
        category = "Productivity",
    )

    val TERMINAL = CapabilityPrerequisite(
        id = "terminal",
        kind = CapabilityKind.AGENT_PERMISSION,
        title = "Terminal Execution",
        description = "Required to run shell commands, scripts, builds, and automated tests.",
        isConfigured = false,
        actionLabel = "Grant Terminal Access",
        category = "System Capabilities",
    )

    val FILESYSTEM = CapabilityPrerequisite(
        id = "filesystem",
        kind = CapabilityKind.AGENT_PERMISSION,
        title = "Workspace Filesystem",
        description = "Required to read, modify, and generate code files in your workspaces.",
        isConfigured = false,
        actionLabel = "Grant Filesystem Access",
        category = "System Capabilities",
    )

    val BROWSER = CapabilityPrerequisite(
        id = "browser",
        kind = CapabilityKind.AGENT_PERMISSION,
        title = "Web Browser & Search",
        description = "Required to browse live websites, fetch online research, and inspect web pages.",
        isConfigured = false,
        actionLabel = "Grant Browser Access",
        category = "System Capabilities",
    )

    val NOTIFICATIONS = CapabilityPrerequisite(
        id = "notifications",
        kind = CapabilityKind.SYSTEM_PERMISSION,
        title = "Push Notifications",
        description = "Required to alert you when background tasks finish or require your approval.",
        isConfigured = false,
        actionLabel = "Enable Notifications",
        category = "Device Capabilities",
    )
}

/**
 * Clean, minimal card displaying a missing capability or prerequisite with an actionable resolution CTA.
 * Designed to match Grok's visual cleanliness, spacing, typography, and confidence.
 */
@Composable
fun CapabilityGuidanceCard(
    prerequisite: CapabilityPrerequisite,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    isActionBusy: Boolean = false,
    onDismiss: (() -> Unit)? = null,
) {
    val isConnected = prerequisite.state == CapabilityState.CONNECTED || prerequisite.isConfigured
    val shape = RoundedCornerShape(18.dp)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(AppTheme.colors.surface)
            .border(
                width = 1.dp,
                color = if (isConnected) AppTheme.colors.border.copy(alpha = 0.4f) else AppTheme.colors.border,
                shape = shape,
            )
            .padding(18.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(
                                if (isConnected) AppTheme.colors.positive.copy(alpha = 0.15f)
                                else AppTheme.colors.surfaceRaised
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isConnected) {
                            Icon(
                                imageVector = Icons.Default.Check,
                                contentDescription = "Configured",
                                tint = AppTheme.colors.positive,
                                modifier = Modifier.size(18.dp),
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Info,
                                contentDescription = "Information",
                                tint = AppTheme.colors.textSecondary,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }

                    Column {
                        Text(
                            text = prerequisite.title,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AppTheme.colors.textPrimary,
                        )
                        Text(
                            text = prerequisite.category,
                            fontSize = 12.sp,
                            color = AppTheme.colors.textTertiary,
                        )
                    }
                }

                // Status pill
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(
                            if (isConnected) AppTheme.colors.positive.copy(alpha = 0.12f)
                            else AppTheme.colors.surfaceRaised
                        )
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = if (isConnected) "Connected" else "Not connected",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = if (isConnected) AppTheme.colors.positive else AppTheme.colors.textSecondary,
                    )
                }
            }

            Text(
                text = if (isConnected) {
                    "${prerequisite.title} is connected and ready for agent turns."
                } else {
                    "${prerequisite.title} isn't connected yet. ${prerequisite.description}"
                },
                fontSize = 13.5.sp,
                lineHeight = 18.sp,
                color = if (isConnected) AppTheme.colors.textSecondary else AppTheme.colors.textPrimary,
            )

            if (!isConnected) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = onAction,
                        enabled = !isActionBusy,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AppTheme.colors.accent,
                            contentColor = AppTheme.colors.onAccent,
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(44.dp),
                    ) {
                        if (isActionBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = AppTheme.colors.onAccent,
                            )
                        } else {
                            Text(
                                text = prerequisite.actionLabel,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }

                    if (onDismiss != null) {
                        TextButton(
                            onClick = onDismiss,
                            shape = CircleShape,
                            modifier = Modifier.height(44.dp),
                        ) {
                            Text(
                                text = "Dismiss",
                                fontSize = 13.sp,
                                color = AppTheme.colors.textTertiary,
                            )
                        }
                    }
                }
            }
        }
    }
}

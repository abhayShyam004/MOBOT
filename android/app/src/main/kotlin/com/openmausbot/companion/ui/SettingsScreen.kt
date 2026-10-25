package com.openmausbot.companion.ui

import android.content.ClipData
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.openmausbot.companion.core.UpdaterStatusResponse
import java.io.File
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.ActivityDetail
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.ThemeMode
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

/**
 * Navigation destinations for Settings sub-pages.
 */
enum class SettingsSubDestination {
    APPEARANCE,
    LANGUAGE,
    NOTIFICATIONS,
    DATA_STORAGE,
    AGENT_PERMISSIONS,
    ACCOUNT,
    SUBSCRIPTION,
    HELP_FEEDBACK,
    ABOUT,
    UPDATES,
}

/**
 * Rebuilt MOBOT Settings screen reproducing the reference design:
 * - Large editorial heading with subtitle
 * - Playful decorative original OpenMausBot mascots near top right
 * - Rounded profile/account card with pastel avatar
 * - Four grouped rounded setting containers: App, Agents, Account, Support
 * - Distinctive mini-mascot vector icons matching the reference specification
 * - Full fidelity underlying MOBOT data & navigation preserved
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenRoutines: (() -> Unit)? = null,
    /** AI & Models → Model providers. */
    onOpenModelProviders: (() -> Unit)? = null,
    /** AI & Models → Specialized AI capabilities. */
    onOpenSpecializedCapabilities: (() -> Unit)? = null,
    /** Apps → Connected apps. */
    onOpenConnectedApps: (() -> Unit)? = null,
    /** Applications built by MOBOT (Projects screen). */
    onOpenProjects: (() -> Unit)? = null,
    /** Mascot Character Studio / interactive avatar preview. */
    onOpenMascotStudio: (() -> Unit)? = null,
    /** Offered instead of the computer's details when there is no pairing. */
    onConnect: (() -> Unit)? = null,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val connection by session.connection.collectAsState()
    val connections by session.connections.collectAsState()
    val status by session.status.collectAsState()
    val notifications by environment.notifications.access.collectAsState()
    val alwaysOnEnabled by environment.alwaysOnEnabled.collectAsState()
    val activityDetail by environment.chatPreferences.activityDetail.collectAsState()
    val themeMode by environment.appearance.theme.collectAsState()

    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    val haptics = rememberHaptics()

    // Sub-page navigation state
    var activeSubPage by rememberSaveable { mutableStateOf<SettingsSubDestination?>(null) }

    // Existing operational states
    var editingAddress by remember { mutableStateOf(false) }
    var addressText by remember { mutableStateOf("") }
    var addressError by remember { mutableStateOf<String?>(null) }
    var showingFullAddress by remember { mutableStateOf(false) }
    var addressCopied by remember { mutableStateOf(false) }
    var reconnecting by remember { mutableStateOf(false) }
    var confirmingUnpair by remember { mutableStateOf(false) }
    var pendingComputerRemoval by remember { mutableStateOf<Connection?>(null) }
    var choosingActivity by remember { mutableStateOf(false) }
    var editingQuickReplies by remember { mutableStateOf(false) }
    var neverAskPermissions by remember { mutableStateOf<Boolean?>(null) }
    var agentPermissions by remember { mutableStateOf<com.openmausbot.companion.core.AgentPermissions?>(null) }
    var activePermissionDetailDomain by remember { mutableStateOf<String?>(null) }
    var savingPermissions by remember { mutableStateOf(false) }
    var cacheClearedMessage by remember { mutableStateOf<String?>(null) }

    // User profile information
    var profileName by remember { mutableStateOf("User") }
    var profileEmail by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        session.mcp.refresh()
        val config = session.configStatus()
        neverAskPermissions = config?.neverAskPermissions
        agentPermissions = config?.agentPermissions
        config?.profile?.let { prof ->
            if (prof.name.isNotBlank()) profileName = prof.name
            if (prof.email.isNotBlank()) profileEmail = prof.email
        }
    }

    val paired = connection

    val currentSubPage = activeSubPage
    if (currentSubPage != null) {
        BackHandler {
            if (activePermissionDetailDomain != null) {
                activePermissionDetailDomain = null
            } else {
                activeSubPage = null
            }
        }
        when (currentSubPage) {
            SettingsSubDestination.APPEARANCE -> {
                SettingsSubPage(
                    title = "Appearance",
                    subtitle = "Customize theme and styling",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "Theme Mode") {
                        Box(modifier = Modifier.padding(16.dp)) {
                            ChoiceRow(
                                label = "Theme",
                                options = ThemeMode.entries.map { it.label },
                                selectedIndex = ThemeMode.entries.indexOf(themeMode),
                                onSelect = { index -> environment.appearance.setTheme(ThemeMode.entries[index]) },
                            )
                        }
                    }

                    if (onOpenMascotStudio != null) {
                        SettingsSection(title = "Mascots & Characters") {
                            SettingsRow(
                                title = "Open Mascot Studio",
                                subtitle = "Preview expressions and test original bot avatars",
                                showChevron = true,
                                onClick = {
                                    activeSubPage = null
                                    onOpenMascotStudio()
                                },
                            )
                        }
                    }
                }
            }
            SettingsSubDestination.LANGUAGE -> {
                var selectedLang by rememberSaveable { mutableStateOf("en") }
                SettingsSubPage(
                    title = "Language",
                    subtitle = "Select app and voice language",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "Preferred Language") {
                        val languages = listOf(
                            "en" to "English (United States)",
                            "system" to "System Language",
                            "es" to "Español (Spanish)",
                            "fr" to "Français (French)",
                            "de" to "Deutsch (German)",
                            "ja" to "日本語 (Japanese)",
                            "hi" to "हिन्दी (Hindi)",
                        )
                        languages.forEachIndexed { index, (code, label) ->
                            SettingsRow(
                                title = label,
                                subtitle = if (code == "en") "Default" else null,
                                selected = selectedLang == code,
                                onClick = { selectedLang = code },
                            )
                            if (index < languages.lastIndex) {
                                SettingsDivider()
                            }
                        }
                    }
                }
            }
            SettingsSubDestination.NOTIFICATIONS -> {
                SettingsSubPage(
                    title = "Notifications",
                    subtitle = "Chats, updates, background connectivity, and reminders",
                    onBack = { activeSubPage = null },
                ) {
                    val hasPerm = !NotificationPermissionController.buttonEnabled(notifications)
                    var soundAlerts by rememberSaveable { mutableStateOf(true) }
                    var completionAlerts by rememberSaveable { mutableStateOf(true) }

                    SettingsSection(title = "System Permission") {
                        SettingsRow(
                            title = "Push Notifications",
                            subtitle = NotificationPermissionController.statusText(notifications),
                            trailingValue = if (hasPerm) "Allowed" else "Action needed",
                            showChevron = !hasPerm,
                            onClick = if (!hasPerm) environment.notifications::act else null,
                        )
                    }

                    SettingsSection(title = "Connection & Background") {
                        SettingsRow(
                            title = "Always-on Background Link",
                            subtitle = if (alwaysOnEnabled) {
                                "A low-priority persistent service keeps connection open for background tasks"
                            } else {
                                "Connection pauses shortly after leaving the app"
                            },
                            checked = alwaysOnEnabled,
                            onCheckedChange = { environment.onToggleAlwaysOn() },
                        )
                    }

                    SettingsSection(title = "Alert Preferences") {
                        SettingsRow(
                            title = "Sound & Haptics",
                            subtitle = "Play gentle feedback when agents reply",
                            checked = soundAlerts,
                            onCheckedChange = { soundAlerts = it },
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Task Completion Banners",
                            subtitle = "Notify when background agent routines finish",
                            checked = completionAlerts,
                            onCheckedChange = { completionAlerts = it },
                        )
                    }
                }
            }
            SettingsSubDestination.DATA_STORAGE -> {
                var clearingCache by remember { mutableStateOf(false) }
                SettingsSubPage(
                    title = "Data & Storage",
                    subtitle = "Manage cached media, activity details, and storage",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "Media Cache") {
                        SettingsRow(
                            title = "Attachment Cache",
                            subtitle = cacheClearedMessage ?: "Temporary images, downloads, and avatars",
                            trailingValue = "24.6 MB",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Clear Attachment Cache",
                            subtitle = "Free up device storage without losing messages",
                            destructive = true,
                            busy = clearingCache,
                            onClick = {
                                scope.launch {
                                    clearingCache = true
                                    environment.avatars.clear()
                                    cacheClearedMessage = "Attachment cache cleared"
                                    clearingCache = false
                                }
                            },
                        )
                    }

                    SettingsSection(title = "Display & Messaging Preferences") {
                        SettingsRow(
                            title = "Activity Detail",
                            subtitle = "Controls what agent execution steps are shown: ${activityDetail.label}",
                            showChevron = true,
                            onClick = { choosingActivity = true },
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Quick Replies",
                            subtitle = "Canned prompt buttons for faster chatting",
                            showChevron = true,
                            onClick = { editingQuickReplies = true },
                        )
                    }
                }
            }
            SettingsSubDestination.AGENT_PERMISSIONS -> {
                if (activePermissionDetailDomain != null) {
                    PermissionDetailScreen(
                        domainId = activePermissionDetailDomain!!,
                        session = session,
                        agentPermissions = agentPermissions,
                        onPermissionsUpdated = { agentPermissions = it },
                        onBack = { activePermissionDetailDomain = null },
                        onOpenConnectedServices = {
                            activePermissionDetailDomain = null
                            activeSubPage = null
                            onOpenConnectedApps?.invoke()
                        },
                    )
                } else {
                    val current = neverAskPermissions
                    SettingsSubPage(
                        title = "Agent Permissions",
                        subtitle = "Tool call authorization, safety barriers, and capabilities",
                        onBack = { activeSubPage = null },
                    ) {
                        SettingsSection(title = "Tool Execution Policy") {
                            SettingsRow(
                                title = "Execute Tools Without Asking",
                                subtitle = if (current == true) {
                                    "Bots execute shell commands, web requests, and file edits automatically"
                                } else {
                                    "Bots pause on an approval card before running tools or modifying files"
                                },
                                checked = current == true,
                                enabled = current != null && !savingPermissions,
                                busy = savingPermissions,
                                onCheckedChange = { next ->
                                    scope.launch {
                                        savingPermissions = true
                                        session.setNeverAskPermissions(next)?.let {
                                            neverAskPermissions = it.neverAskPermissions
                                        }
                                        savingPermissions = false
                                    }
                                },
                            )
                        }

                        val perms = agentPermissions ?: com.openmausbot.companion.core.AgentPermissions()
                        fun formatPermissionState(state: String): String = when (state.lowercase()) {
                            "granted" -> "Granted"
                            "denied" -> "Denied"
                            "restricted" -> "Restricted"
                            "requires_configuration" -> "Requires configuration"
                            else -> state.replaceFirstChar { it.uppercase() }
                        }

                        SettingsSection(title = "Core Capabilities & Permissions") {
                            val terminalState = perms.terminal
                            SettingsRow(
                                title = "Terminal & Shell Execution",
                                subtitle = "Sandboxed command-line operations on paired host",
                                trailingValue = formatPermissionState(terminalState),
                                showChevron = true,
                                onClick = { activePermissionDetailDomain = "terminal" },
                            )
                            SettingsDivider()
                            val filesystemState = perms.filesystem
                            SettingsRow(
                                title = "Filesystem Read & Write",
                                subtitle = "Access workspace files, codebases, and assets",
                                trailingValue = formatPermissionState(filesystemState),
                                showChevron = true,
                                onClick = { activePermissionDetailDomain = "filesystem" },
                            )
                            SettingsDivider()
                            val browserState = perms.browser
                            SettingsRow(
                                title = "Browser & Network",
                                subtitle = "Inspect URLs, search web, and fetch REST endpoints",
                                trailingValue = formatPermissionState(browserState),
                                showChevron = true,
                                onClick = { activePermissionDetailDomain = "browser" },
                            )
                            SettingsDivider()
                            val composioState = perms.composio
                            SettingsRow(
                                title = "Composio Integrations",
                                subtitle = if (composioState == "requires_configuration") {
                                    "Automate connected services (API key required)"
                                } else {
                                    "Automate connected services and cloud APIs"
                                },
                                trailingValue = formatPermissionState(composioState),
                                showChevron = true,
                                onClick = { activePermissionDetailDomain = "composio" },
                            )
                            SettingsDivider()
                            val phoneControlReady = com.openmausbot.companion.service.CompanionAccessibilityService.isReady()
                            SettingsRow(
                                title = "Phone Control & Automation",
                                subtitle = if (phoneControlReady) {
                                    "Native cross-app navigation, UI observation, and gestures"
                                } else {
                                    "Enable MOBOT in Android Settings -> Accessibility"
                                },
                                trailingValue = if (phoneControlReady) "Active" else "Action needed",
                                showChevron = true,
                                onClick = { activePermissionDetailDomain = "phone_control" },
                            )
                        }

                        if (onOpenSpecializedCapabilities != null) {
                            SettingsSection(title = "Specialized AI") {
                                SettingsRow(
                                    title = "Specialized Capabilities",
                                    subtitle = "Code interpreter, computer use, and reasoning models",
                                    showChevron = true,
                                    onClick = {
                                        activeSubPage = null
                                        onOpenSpecializedCapabilities()
                                    },
                                )
                            }
                        }
                    }
                }
            }
            SettingsSubDestination.ACCOUNT -> {
                SettingsSubPage(
                    title = "Account",
                    subtitle = "Profile identity, paired computer link, and security",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "User Profile") {
                        SettingsRow(
                            title = "Name",
                            trailingValue = profileName,
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Email",
                            trailingValue = profileEmail,
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Profile Status",
                            subtitle = "Local session managed by companion daemon",
                            trailingValue = "Active",
                        )
                    }

                    SettingsSection(title = "Paired Computer") {
                        SettingsRow(
                            title = "Computer Name",
                            trailingValue = paired?.name ?: "This phone",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Connection Status",
                            subtitle = troubleshootingText(status),
                            trailingValue = connectionStatusLabel(status),
                        )
                        paired?.let { p ->
                            SettingsDivider()
                            SettingsRow(
                                title = "Host Address",
                                subtitle = if (showingFullAddress) p.displayAddress else SettingsPolicy.addressText(p),
                                trailingValue = if (addressCopied) "Copied!" else "Copy",
                                onClick = {
                                    scope.launch {
                                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(ADDRESS_CLIP_LABEL, p.displayAddress)))
                                        addressCopied = true
                                        delay(COPIED_LABEL_MILLIS)
                                        addressCopied = false
                                    }
                                },
                            )
                            SettingsDivider()
                            SettingsRow(
                                title = "Edit Computer Address",
                                subtitle = "Update host IP or port",
                                showChevron = true,
                                onClick = {
                                    addressText = p.displayAddress
                                    addressError = null
                                    editingAddress = true
                                },
                            )
                        }
                    }

                    SettingsSection(title = "Danger Zone") {
                        SettingsRow(
                            title = if (connections.size > 1) "Remove This Computer" else "Unpair This Phone",
                            subtitle = "Disconnect from host and clear authentication credentials",
                            destructive = true,
                            onClick = { confirmingUnpair = true },
                        )
                    }
                }
            }
            SettingsSubDestination.SUBSCRIPTION -> {
                SettingsSubPage(
                    title = "Subscription",
                    subtitle = "Plan tier, quota limits, and capabilities",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "Current Plan") {
                        SettingsRow(
                            title = "MOBOT Community Edition",
                            subtitle = "Open-source local companion with full agentic capabilities",
                            trailingValue = "Free",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Token Limit",
                            subtitle = "Context window governed by paired host computer model",
                            trailingValue = "Unlimited",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Agent Concurrency",
                            subtitle = "Concurrent subagents and background tasks",
                            trailingValue = "Unlimited",
                        )
                    }

                    SettingsSection(title = "Ecosystem Capabilities") {
                        SettingsRow(
                            title = "Composio Integrations",
                            subtitle = "Access to 1,600+ third-party service connectors",
                            trailingValue = "Included",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Local Daemon Pairing",
                            subtitle = "Encrypted WebSocket link to your machine",
                            trailingValue = "Included",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "OpenMausBot Mascots",
                            subtitle = "Original animated expressive bot companions",
                            trailingValue = "Included",
                        )
                    }
                }
            }
            SettingsSubDestination.HELP_FEEDBACK -> {
                var copiedDiagnostics by remember { mutableStateOf(false) }
                SettingsSubPage(
                    title = "Help & Feedback",
                    subtitle = "Documentation, diagnostics, and community",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "Guides & Documentation") {
                        SettingsRow(
                            title = "MOBOT User Guide",
                            subtitle = "Learn about prompt syntax, skills, and tools",
                            showChevron = true,
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Composio Integration Docs",
                            subtitle = "Setup guides for Gmail, GitHub, Slack, and Linear",
                            showChevron = true,
                        )
                    }

                    SettingsSection(title = "Diagnostics") {
                        SettingsRow(
                            title = "Copy Diagnostics",
                            subtitle = "Status: ${connectionStatusLabel(status)}, Paired: ${paired?.name ?: "None"}",
                            trailingValue = if (copiedDiagnostics) "Copied!" else "Copy",
                            onClick = {
                                scope.launch {
                                    val diag = "MOBOT Diagnostics\nStatus: $status\nPaired: ${paired?.name ?: "None"}\nVersion: 1.0.0 (Build 42)"
                                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("MOBOT Diagnostics", diag)))
                                    copiedDiagnostics = true
                                    delay(COPIED_LABEL_MILLIS)
                                    copiedDiagnostics = false
                                }
                            },
                        )
                    }
                }
            }
            SettingsSubDestination.ABOUT -> {
                SettingsSubPage(
                    title = "About",
                    subtitle = "Specifications, version info, and licenses",
                    onBack = { activeSubPage = null },
                ) {
                    SettingsSection(title = "Software Specifications") {
                        SettingsRow(
                            title = "Application",
                            trailingValue = "MOBOT Companion",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Version",
                            trailingValue = "1.0.0",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Build Number",
                            trailingValue = "42",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Core Architecture",
                            subtitle = "Native Jetpack Compose + Kotlin Coroutines",
                            trailingValue = "Android 16",
                        )
                    }

                    SettingsSection(title = "Open Source & Legal") {
                        SettingsRow(
                            title = "OpenMausBot Project",
                            subtitle = "Licensed under Apache 2.0 and MIT",
                        )
                        SettingsDivider()
                        SettingsRow(
                            title = "Privacy Policy",
                            subtitle = "All model keys and data remain on your host computer",
                        )
                    }
                }
            }
            SettingsSubDestination.UPDATES -> {
                UpdatesSubPage(
                    session = session,
                    onBack = { activeSubPage = null },
                )
            }
        }
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(AppTheme.colors.background),
        ) {
            // Top status/back row: subtle minimal back icon without heavy toolbar
            Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, top = 8.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TouchTarget(onClick = onBack, size = 44.dp) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = AppTheme.colors.textPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 56.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // Header: Large editorial heading + subtitle + decorative original mascots
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 22.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = "Settings",
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                        letterSpacing = (-0.5).sp,
                    )
                    Text(
                        text = "Make the app work the way you do.",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Normal,
                        color = AppTheme.colors.textSecondary,
                    )
                }

                // Decorative mascots cluster in top-right
                SettingsDecorativeMascots()
            }

            // Profile / Account Card
            SettingsProfileCard(
                userName = profileName,
                userEmail = profileEmail,
                onClick = { activeSubPage = SettingsSubDestination.ACCOUNT },
            )

            // When unpaired on home, offer Connect a computer
            if (paired == null && onConnect != null) {
                SettingsGroupContainer(title = "This phone") {
                    SettingsItemRow(
                        iconType = SettingsMascotIconType.RECONNECT,
                        title = "Connect a computer",
                        subtitle = "Your bots live on a computer, and this phone reaches them from here.",
                        onClick = onConnect,
                    )
                }
            }

            // Section 1: App
            val needsNotificationPermission = NotificationPermissionController.buttonEnabled(notifications)
            SettingsGroupContainer(title = "App") {
                SettingsItemRow(
                    iconType = SettingsMascotIconType.APPEARANCE,
                    title = "Appearance",
                    subtitle = "Light, dark, or system",
                    trailingValue = themeMode.label,
                    onClick = { activeSubPage = SettingsSubDestination.APPEARANCE },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.LANGUAGE,
                    title = "Language",
                    subtitle = "English",
                    trailingValue = "English",
                    onClick = { activeSubPage = SettingsSubDestination.LANGUAGE },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.NOTIFICATIONS,
                    title = if (needsNotificationPermission) {
                        NotificationPermissionController.buttonText(notifications)
                    } else {
                        "Notifications"
                    },
                    subtitle = "Chats, updates, and reminders",
                    trailingValue = null,
                    onClick = {
                        if (needsNotificationPermission) {
                            environment.notifications.act()
                        } else {
                            activeSubPage = SettingsSubDestination.NOTIFICATIONS
                        }
                    },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.DATA_STORAGE,
                    title = "Data & Storage",
                    subtitle = "Manage downloads and cache",
                    onClick = { activeSubPage = SettingsSubDestination.DATA_STORAGE },
                )
            }

            // Section 2: AI & Agents
            SettingsGroupContainer(title = "AI & Agents") {
                SettingsItemRow(
                    iconType = SettingsMascotIconType.MANAGE_AGENTS,
                    title = "Manage Agents",
                    subtitle = "Add, remove, and configure",
                    onClick = { onOpenRoutines?.invoke() },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.DEFAULT_AGENT,
                    title = "Model Providers",
                    subtitle = "Claude, OpenAI, Gemini, Grok, and local models",
                    trailingValue = null,
                    onClick = { onOpenModelProviders?.invoke() },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.SPECIALIZED_CAPABILITIES,
                    title = "Specialized Capabilities",
                    subtitle = "Image, video, audio, and multimodal intelligence",
                    onClick = { onOpenSpecializedCapabilities?.invoke() },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.AGENT_PERMISSIONS,
                    title = "Agent Permissions",
                    subtitle = "Tools, connectors, and data access",
                    trailingValue = null,
                    onClick = { activeSubPage = SettingsSubDestination.AGENT_PERMISSIONS },
                )
            }

            // Section 3: Account
            SettingsGroupContainer(title = "Account") {
                SettingsItemRow(
                    iconType = SettingsMascotIconType.ACCOUNT,
                    title = "Account",
                    subtitle = "Profile, email, and security",
                    onClick = { activeSubPage = SettingsSubDestination.ACCOUNT },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.CONNECTED_SERVICES,
                    title = "Connected Services",
                    subtitle = "Google, GitHub, Notion, and more",
                    onClick = { onOpenConnectedApps?.invoke() },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.SUBSCRIPTION,
                    title = "Subscription",
                    subtitle = "View plan and billing",
                    trailingValue = "Free",
                    onClick = { activeSubPage = SettingsSubDestination.SUBSCRIPTION },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.RECONNECT,
                    title = "Try reconnecting",
                    subtitle = troubleshootingText(status),
                    trailingValue = connectionStatusLabel(status),
                    enabled = !reconnecting,
                    busy = reconnecting,
                    onClick = {
                        scope.launch {
                            reconnecting = true
                            haptics.play(TactileAction.SWITCH_COMPUTER)
                            session.refresh()
                            reconnecting = false
                        }
                    },
                )
            }

            // Section 4: Support
            SettingsGroupContainer(title = "Support") {
                SettingsItemRow(
                    iconType = SettingsMascotIconType.HELP,
                    title = "Help & Feedback",
                    subtitle = "Get help or send feedback",
                    onClick = { activeSubPage = SettingsSubDestination.HELP_FEEDBACK },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.UPDATES,
                    title = "Updates",
                    subtitle = "Release channel and in-app updates",
                    onClick = { activeSubPage = SettingsSubDestination.UPDATES },
                )
                SettingsRowDivider()
                SettingsItemRow(
                    iconType = SettingsMascotIconType.ABOUT,
                    title = "About",
                    subtitle = "Version 1.0.0",
                    trailingValue = null,
                    onClick = { activeSubPage = SettingsSubDestination.ABOUT },
                )
            }
        }
    }
}

    if (editingAddress) {
        AlertDialog(
            onDismissRequest = { editingAddress = false },
            title = { Text("Edit address") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(SettingsPolicy.EDIT_ADDRESS_MESSAGE, fontSize = 14.sp)
                    AppTextField(
                        value = addressText,
                        onValueChange = {
                            addressText = it
                            addressError = null
                        },
                        placeholder = "https://mac.example or 192.168.1.42:8810",
                        singleLine = true,
                        isError = addressError != null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    addressError?.let {
                        Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (session.updateAddress(addressText)) {
                            editingAddress = false
                        } else {
                            addressError = AddressEdit.INVALID
                        }
                    },
                ) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { editingAddress = false }) { Text("Cancel") }
            },
        )
    }

    if (confirmingUnpair) {
        AlertDialog(
            onDismissRequest = { confirmingUnpair = false },
            title = { Text(if (connections.size > 1) "Remove ${connection?.name}?" else SettingsPolicy.UNPAIR_CONFIRM_TITLE) },
            text = {
                Text(
                    if (connections.size > 1) {
                        "This removes the saved connection from this phone only. Another saved computer will stay available."
                    } else {
                        SettingsPolicy.UNPAIR_CONFIRM_MESSAGE
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmingUnpair = false
                        session.signOut()
                    },
                ) {
                    Text(
                        text = if (connections.size > 1) "Remove" else "Unpair",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingUnpair = false }) { Text("Cancel") }
            },
        )
    }

    pendingComputerRemoval?.let { computer ->
        AlertDialog(
            onDismissRequest = { pendingComputerRemoval = null },
            title = { Text("Remove ${computer.name}?") },
            text = { Text("This removes the saved connection from this phone only.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingComputerRemoval = null
                        session.forgetConnection(computer.id)
                    },
                ) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { pendingComputerRemoval = null }) { Text("Cancel") }
            },
        )
    }

    if (choosingActivity) {
        AlertDialog(
            onDismissRequest = { choosingActivity = false },
            title = { Text("Activity detail") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    ActivityDetail.entries.forEach { detail ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = MIN_TOUCH_TARGET)
                                .selectable(
                                    selected = detail == activityDetail,
                                    role = Role.RadioButton,
                                    onClick = {
                                        environment.chatPreferences.setActivityDetail(detail)
                                        choosingActivity = false
                                    },
                                )
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = detail == activityDetail, onClick = null)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(detail.label, textAlign = TextAlign.Start)
                                Text(detail.caption, fontSize = 12.sp, color = secondaryTint)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { choosingActivity = false }) { Text("Cancel") } },
        )
    }

    if (editingQuickReplies) {
        QuickRepliesEditor(
            preferences = environment.chatPreferences,
            onDismiss = { editingQuickReplies = false },
        )
    }
}

/**
 * Three playful decorative original OpenMausBot mascots clustered in the top-right
 * of the Settings header, matching the visual reference.
 */
@Composable
private fun SettingsDecorativeMascots(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.size(width = 96.dp, height = 72.dp),
    ) {
        // 1. Purple squircle (tilted -12 deg)
        Box(
            modifier = Modifier
                .offset(x = 0.dp, y = 12.dp)
                .graphicsLayer(rotationZ = -12f),
        ) {
            MausAvatar(
                color = "purple",
                bodyId = "squircle",
                size = 46.dp,
                state = MausState.IDLE,
                animated = false,
            )
        }

        // 2. Pink circle (top-right)
        Box(
            modifier = Modifier
                .offset(x = 48.dp, y = 0.dp),
        ) {
            MausAvatar(
                color = "pink",
                bodyId = "circle",
                size = 32.dp,
                state = MausState.IDLE,
                animated = false,
            )
        }

        // 3. Green drop (bottom-right)
        Box(
            modifier = Modifier
                .offset(x = 50.dp, y = 28.dp),
        ) {
            MausAvatar(
                color = "green",
                bodyId = "drop",
                size = 40.dp,
                state = MausState.IDLE,
                animated = false,
            )
        }
    }
}

/**
 * Large rounded profile card with pastel avatar badge and real user info.
 */
@Composable
private fun SettingsProfileCard(
    userName: String,
    userEmail: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = AppTheme.colors.background.luminance() < 0.5f
    val avatarBg = if (isDark) Color(0xFF1B3D35) else Color(0xFFD6F5EC)
    val avatarText = if (isDark) Color(0xFF80E2CA) else Color(0xFF0F5B4E)
    val avatarWave = if (isDark) Color(0xFF00BFA5) else Color(0xFF1DE9B6)

    val initials = remember(userName) {
        val parts = userName.trim().split("\\s+".toRegex())
        when {
            parts.size >= 2 -> "${parts[0].take(1)}${parts[1].take(1)}".uppercase()
            parts.isNotEmpty() && parts[0].isNotEmpty() -> parts[0].take(2).uppercase()
            else -> "AS"
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "avatarWaveTransition")
    val wavePhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = (2.0 * PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "wavePhase",
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(AppTheme.colors.surface)
            .border(
                width = 1.dp,
                color = AppTheme.colors.border.copy(alpha = 0.5f),
                shape = RoundedCornerShape(22.dp),
            )
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Pastel avatar circle with animated fluid wave and initials
        Box(
            modifier = Modifier
                .size(54.dp)
                .clip(CircleShape)
                .background(avatarBg),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val w = size.width
                val h = size.height
                val twoPi = (2.0 * PI).toFloat()

                // Layer 1: Background gentle wave (slower, translucent depth)
                val backWavePath = Path().apply {
                    val baseY = h * 0.70f
                    val amp = h * 0.045f
                    val phase = wavePhase + 1.25f
                    moveTo(0f, baseY + amp * sin(-phase))
                    val step = 3f
                    var x = step
                    while (x < w) {
                        val angle = twoPi * (x / (w * 0.85f)) - phase
                        lineTo(x, baseY + amp * sin(angle))
                        x += step
                    }
                    val endAngle = twoPi * (w / (w * 0.85f)) - phase
                    lineTo(w, baseY + amp * sin(endAngle))
                    lineTo(w, h)
                    lineTo(0f, h)
                    close()
                }
                drawPath(backWavePath, color = avatarWave.copy(alpha = 0.40f))

                // Layer 2: Foreground animated rolling wave
                val frontWavePath = Path().apply {
                    val baseY = h * 0.73f
                    val amp = h * 0.065f
                    val phase = wavePhase
                    moveTo(0f, baseY + amp * sin(-phase))
                    val step = 3f
                    var x = step
                    while (x < w) {
                        val angle = twoPi * (x / w) - phase
                        lineTo(x, baseY + amp * sin(angle))
                        x += step
                    }
                    lineTo(w, baseY + amp * sin(twoPi - phase))
                    lineTo(w, h)
                    lineTo(0f, h)
                    close()
                }
                drawPath(frontWavePath, color = avatarWave)
            }
            Text(
                text = initials,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = avatarText,
            )
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = userName,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = userEmail,
                fontSize = 13.5.sp,
                color = AppTheme.colors.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = AppTheme.colors.textTertiary.copy(alpha = 0.5f),
            modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * Grouped rounded container for settings categories: App, Agents, Account, Support.
 */
@Composable
internal fun SettingsGroupContainer(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = AppTheme.colors.textSecondary,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(AppTheme.colors.surface)
                .border(
                    width = 1.dp,
                    color = AppTheme.colors.border.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(22.dp),
                ),
        ) {
            content()
        }
    }
}

/**
 * Subtle row divider matching iOS / modern pastel settings cards.
 */
@Composable
internal fun SettingsRowDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 68.dp, end = 16.dp),
        thickness = 0.5.dp,
        color = AppTheme.colors.divider.copy(alpha = 0.6f),
    )
}

/**
 * Distinctive mini-mascot shapes for the 12+ settings rows.
 */
enum class SettingsMascotIconType {
    APPEARANCE,
    LANGUAGE,
    NOTIFICATIONS,
    DATA_STORAGE,
    MANAGE_AGENTS,
    DEFAULT_AGENT,
    SPECIALIZED_CAPABILITIES,
    AGENT_PERMISSIONS,
    ACCOUNT,
    CONNECTED_SERVICES,
    SUBSCRIPTION,
    RECONNECT,
    HELP,
    ABOUT,
    UPDATES,
}

/**
 * Vector rendering of the colorful mini-mascots in each settings row.
 */
@Composable
internal fun SettingsMascotIcon(
    type: SettingsMascotIconType,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height

        when (type) {
            SettingsMascotIconType.APPEARANCE -> {
                val bg = Color(0xFF1E88E5)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                val eyeWidth = w * 0.085f
                val eyeHeight = h * 0.22f
                val eyeRadius = CornerRadius(eyeWidth / 2f, eyeWidth / 2f)
                val eyeY = (h - eyeHeight) / 2f
                drawRoundRect(
                    color = Color.White,
                    topLeft = Offset(w * 0.36f, eyeY),
                    size = Size(eyeWidth, eyeHeight),
                    cornerRadius = eyeRadius,
                )
                drawRoundRect(
                    color = Color.White,
                    topLeft = Offset(w * 0.55f, eyeY),
                    size = Size(eyeWidth, eyeHeight),
                    cornerRadius = eyeRadius,
                )
            }
            SettingsMascotIconType.LANGUAGE -> {
                val bg = Color(0xFF7E57C2)
                val path = Path().apply {
                    moveTo(w * 0.5f, h * 0.12f)
                    lineTo(w * 0.88f, h * 0.88f)
                    lineTo(w * 0.12f, h * 0.88f)
                    close()
                }
                drawPath(
                    path = path,
                    color = bg,
                    style = Stroke(
                        width = w * 0.18f,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round,
                    ),
                )
                drawPath(path = path, color = bg)
                drawCircle(
                    color = Color.White,
                    radius = w * 0.085f,
                    center = Offset(w * 0.5f, h * 0.62f),
                )
            }
            SettingsMascotIconType.NOTIFICATIONS -> {
                val bg = Color(0xFFFB8C00)
                val pillHeight = h * 0.78f
                val pillY = (h - pillHeight) / 2f
                drawRoundRect(
                    color = bg,
                    topLeft = Offset(0f, pillY),
                    size = Size(w, pillHeight),
                    cornerRadius = CornerRadius(pillHeight / 2f, pillHeight / 2f),
                )
                val eyeR = w * 0.08f
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.38f, h * 0.5f))
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.62f, h * 0.5f))
            }
            SettingsMascotIconType.DATA_STORAGE -> {
                val bg = Color(0xFF8D6E63)
                val path = Path().apply {
                    moveTo(w * 0.5f, h * 0.08f)
                    cubicTo(w * 0.85f, h * 0.45f, w * 0.95f, h * 0.82f, w * 0.5f, h * 0.92f)
                    cubicTo(w * 0.05f, h * 0.82f, w * 0.15f, h * 0.45f, w * 0.5f, h * 0.08f)
                    close()
                }
                drawPath(path = path, color = bg)
                drawCircle(
                    color = Color.White,
                    radius = w * 0.085f,
                    center = Offset(w * 0.5f, h * 0.65f),
                )
            }
            SettingsMascotIconType.MANAGE_AGENTS -> {
                val bg = Color(0xFF00C853)
                val path = Path().apply {
                    addRoundRect(
                        RoundRect(
                            rect = Rect(w * 0.05f, h * 0.28f, w * 0.95f, h * 0.85f),
                            cornerRadius = CornerRadius(w * 0.25f, w * 0.25f),
                        ),
                    )
                }
                drawPath(path = path, color = bg)
                drawCircle(color = bg, radius = w * 0.28f, center = Offset(w * 0.35f, h * 0.4f))
                drawCircle(color = bg, radius = w * 0.28f, center = Offset(w * 0.65f, h * 0.4f))
                val eyeR = w * 0.075f
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.38f, h * 0.55f))
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.62f, h * 0.55f))
            }
            SettingsMascotIconType.DEFAULT_AGENT -> {
                val bg = Color(0xFFE53935)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                drawLine(
                    color = Color.White,
                    start = Offset(w * 0.32f, h * 0.68f),
                    end = Offset(w * 0.68f, h * 0.32f),
                    strokeWidth = w * 0.12f,
                    cap = StrokeCap.Round,
                )
            }
            SettingsMascotIconType.SPECIALIZED_CAPABILITIES -> {
                val bg = Color(0xFFFF8F00)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                val eyeR = w * 0.08f
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.38f, h * 0.5f))
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.62f, h * 0.5f))
            }
            SettingsMascotIconType.AGENT_PERMISSIONS -> {
                val bg = Color(0xFF5E35B1)
                val path = Path().apply {
                    addRoundRect(
                        RoundRect(
                            rect = Rect(w * 0.05f, h * 0.28f, w * 0.95f, h * 0.85f),
                            cornerRadius = CornerRadius(w * 0.25f, w * 0.25f),
                        ),
                    )
                }
                drawPath(path = path, color = bg)
                drawCircle(color = bg, radius = w * 0.28f, center = Offset(w * 0.35f, h * 0.4f))
                drawCircle(color = bg, radius = w * 0.28f, center = Offset(w * 0.65f, h * 0.4f))
                drawCircle(
                    color = Color.White,
                    radius = w * 0.12f,
                    center = Offset(w * 0.5f, h * 0.56f),
                    style = Stroke(width = w * 0.07f),
                )
            }
            SettingsMascotIconType.ACCOUNT -> {
                val bg = Color(0xFF039BE5)
                val path = Path().apply {
                    moveTo(w * 0.5f, h * 0.08f)
                    cubicTo(w * 0.85f, h * 0.45f, w * 0.95f, h * 0.82f, w * 0.5f, h * 0.92f)
                    cubicTo(w * 0.05f, h * 0.82f, w * 0.15f, h * 0.45f, w * 0.5f, h * 0.08f)
                    close()
                }
                drawPath(path = path, color = bg)
                drawCircle(
                    color = Color.White,
                    radius = w * 0.085f,
                    center = Offset(w * 0.5f, h * 0.65f),
                )
            }
            SettingsMascotIconType.CONNECTED_SERVICES -> {
                val bg = Color(0xFFFFA000)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                val innerSize = w * 0.38f
                val innerOffset = (w - innerSize) / 2f
                drawRoundRect(
                    color = Color.White,
                    topLeft = Offset(innerOffset, innerOffset),
                    size = Size(innerSize, innerSize),
                    cornerRadius = CornerRadius(innerSize * 0.25f, innerSize * 0.25f),
                )
            }
            SettingsMascotIconType.SUBSCRIPTION -> {
                val bg = Color(0xFF546E7A)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                val eyeR = w * 0.08f
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.38f, h * 0.5f))
                drawCircle(color = Color.White, radius = eyeR, center = Offset(w * 0.62f, h * 0.5f))
            }
            SettingsMascotIconType.RECONNECT -> {
                val bg = Color(0xFF1E88E5)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                val r = w * 0.22f
                drawArc(
                    color = Color.White,
                    startAngle = 40f,
                    sweepAngle = 260f,
                    useCenter = false,
                    topLeft = Offset(w * 0.5f - r, h * 0.5f - r),
                    size = Size(r * 2f, r * 2f),
                    style = Stroke(width = w * 0.08f, cap = StrokeCap.Round),
                )
                drawCircle(color = Color.White, radius = w * 0.06f, center = Offset(w * 0.5f, h * 0.5f))
            }
            SettingsMascotIconType.HELP -> {
                val bg = Color(0xFFEC407A)
                drawCircle(color = bg)
                drawCircle(
                    color = Color.White,
                    radius = w * 0.09f,
                    center = Offset(w * 0.5f, h * 0.5f),
                )
            }
            SettingsMascotIconType.ABOUT -> {
                val bg = Color(0xFF00C853)
                val path = Path().apply {
                    moveTo(w * 0.5f, h * 0.12f)
                    lineTo(w * 0.88f, h * 0.88f)
                    lineTo(w * 0.12f, h * 0.88f)
                    close()
                }
                drawPath(
                    path = path,
                    color = bg,
                    style = Stroke(
                        width = w * 0.18f,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round,
                    ),
                )
                drawPath(path = path, color = bg)
                drawCircle(
                    color = Color.White,
                    radius = w * 0.085f,
                    center = Offset(w * 0.5f, h * 0.62f),
                )
            }
            SettingsMascotIconType.UPDATES -> {
                val bg = Color(0xFF00B0FF)
                drawRoundRect(
                    color = bg,
                    cornerRadius = CornerRadius(w * 0.28f, w * 0.28f),
                )
                val path = Path().apply {
                    moveTo(w * 0.5f, h * 0.24f)
                    lineTo(w * 0.72f, h * 0.46f)
                    lineTo(w * 0.58f, h * 0.46f)
                    lineTo(w * 0.58f, h * 0.74f)
                    lineTo(w * 0.42f, h * 0.74f)
                    lineTo(w * 0.42f, h * 0.46f)
                    lineTo(w * 0.28f, h * 0.46f)
                    close()
                }
                drawPath(path = path, color = Color.White)
            }
        }
    }
}

/**
 * Standard settings item row with colorful mini-mascot, title, subtitle, trailing value, and subtle chevron.
 */
@Composable
internal fun SettingsItemRow(
    iconType: SettingsMascotIconType,
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    trailingValue: String? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SettingsMascotIcon(
            type = iconType,
            modifier = Modifier.size(38.dp),
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = title,
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (enabled) AppTheme.colors.textPrimary else AppTheme.colors.textTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                fontSize = 13.sp,
                color = AppTheme.colors.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (trailingValue != null) {
            Text(
                text = trailingValue,
                fontSize = 14.sp,
                fontWeight = FontWeight.Normal,
                color = AppTheme.colors.textTertiary,
            )
        }

        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = AppTheme.colors.textTertiary,
            )
        } else {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = AppTheme.colors.textTertiary.copy(alpha = 0.5f),
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Legacy helper composables and functions preserved for backward compatibility
// ---------------------------------------------------------------------------

@Composable
internal fun SettingsGroup(title: String?, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        title?.let { AppSectionHeader(it) }
        Column(
            modifier = Modifier
                .padding(horizontal = AppSpacing.gutter)
                .clip(AppRadii.cardShape)
                .background(AppTheme.colors.surface)
                .padding(horizontal = AppSpacing.lg, vertical = AppSpacing.md),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
        ) {
            content()
        }
    }
}

enum class StatusTone { PLAIN, GOOD, WARN, BAD }

@Composable
internal fun SettingsValueRow(
    label: String,
    value: String,
    tone: StatusTone = StatusTone.PLAIN,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = AppTheme.colors.textSecondary,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = when (tone) {
                StatusTone.PLAIN -> AppTheme.colors.textPrimary
                StatusTone.GOOD -> AppTheme.colors.positive
                StatusTone.WARN -> AppTheme.colors.caution
                StatusTone.BAD -> AppTheme.colors.danger
            },
            textAlign = TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
internal fun SettingsRow(label: String, value: String) = SettingsValueRow(label, value)

@Composable
internal fun SettingsLink(
    text: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    caption: String? = null,
    busy: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MIN_TOUCH_TARGET)
            .clip(RoundedCornerShape(AppRadii.small))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(vertical = AppSpacing.sm),
        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = when {
                    destructive -> AppTheme.colors.danger
                    enabled -> AppTheme.colors.textPrimary
                    else -> AppTheme.colors.textTertiary
                },
            )
            if (caption != null) {
                Text(
                    text = caption,
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.colors.textTertiary,
                )
            }
        }
        when {
            busy -> CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = AppTheme.colors.textTertiary,
            )
            !destructive -> Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = AppTheme.colors.textTertiary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
internal fun ChoiceRow(
    label: String,
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = AppTheme.colors.textSecondary,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(AppRadii.small))
                .background(AppTheme.colors.surfaceRaised)
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            options.forEachIndexed { index, option ->
                val selected = index == selectedIndex
                Text(
                    text = option,
                    style = MaterialTheme.typography.titleSmall,
                    color = if (selected) AppTheme.colors.textPrimary else AppTheme.colors.textSecondary,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(AppRadii.small - 3.dp))
                        .background(if (selected) AppTheme.colors.surface else Color.Transparent)
                        .selectable(
                            selected = selected,
                            role = Role.RadioButton,
                            onClick = { onSelect(index) },
                        )
                        .padding(vertical = 9.dp),
                )
            }
        }
    }
}

@Composable
private fun AddressRow(
    address: String,
    expanded: Boolean,
    copied: Boolean,
    onToggle: () -> Unit,
    onCopy: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Address", fontSize = 15.sp, color = secondaryTint)
        if (expanded) {
            SelectionContainer {
                Text(
                    text = address,
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace,
                    color = secondaryTint,
                )
            }
        } else {
            Text(
                text = shortenedAddress(address),
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = secondaryTint,
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = onToggle) {
                Text(if (expanded) "Hide full address" else "Show full address")
            }
            TextButton(onClick = onCopy) {
                Text(if (copied) "Copied" else "Copy")
            }
        }
    }
}

@Composable
internal fun SettingsButton(
    text: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    icon: Int? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    val tint = if (destructive) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.primary
    }
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.let {
                Icon(
                    painter = painterResource(it),
                    contentDescription = null,
                    tint = tint,
                    modifier = Modifier.size(20.dp),
                )
            }
            Text(
                text = text,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Start,
                color = tint,
            )
            trailing?.invoke()
        }
    }
}

@Composable
internal fun Footnote(text: String) {
    Text(text = text, fontSize = 13.sp, color = secondaryTint)
}

private const val ADDRESS_CLIP_LABEL = "MOBOT computer address"
private const val COPIED_LABEL_MILLIS = 2_000L

internal fun connectionStatusLabel(status: Session.Status): String = when (status) {
    Session.Status.Live -> "Connected"
    is Session.Status.Starting -> "Starting…"
    Session.Status.Connecting -> "Connecting…"
    Session.Status.Unauthorized -> "Needs pairing"
    Session.Status.Unpaired -> "Not paired"
    is Session.Status.Offline -> "Offline"
}

internal fun troubleshootingText(status: Session.Status): String = when (status) {
    Session.Status.Live -> "This computer is connected and responding normally."
    is Session.Status.Starting -> status.message
    Session.Status.Connecting -> "MOBOT is trying the saved connection automatically."
    Session.Status.Unauthorized -> "This phone was removed from the computer. Pair it again to reconnect."
    Session.Status.Unpaired -> "This phone is not paired with a computer."
    is Session.Status.Offline -> status.message
}

internal fun shortenedAddress(address: String): String {
    if (address.length <= 14) return address
    val leading = minOf(20, maxOf(8, address.length - 8))
    return address.take(leading) + "…" + address.takeLast(6)
}

@Composable
internal fun UpdatesSubPage(
    session: Session,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<UpdaterStatusResponse?>(null) }
    var checking by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf(false) }
    var installing by remember { mutableStateOf(false) }
    var successNotice by remember { mutableStateOf<String?>(null) }
    var errorNotice by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            status = session.getUpdaterStatus()
            if (status?.status == "complete") {
                successNotice = "Update complete. All persistent state preserved."
            }
        } catch (e: Exception) {
            // initial probe failure handled gracefully
        }
    }

    SettingsSubPage(
        title = "Updates",
        subtitle = "Official GitHub releases and system updates",
        onBack = onBack,
    ) {
        successNotice?.let { notice ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFF1B5E20).copy(alpha = 0.25f))
                    .border(1.dp, Color(0xFF2E7D32).copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = notice,
                    fontSize = 13.5.sp,
                    color = Color(0xFF81C784),
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        errorNotice?.let { err ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFFB71C1C).copy(alpha = 0.25f))
                    .border(1.dp, Color(0xFFD32F2F).copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = err,
                    fontSize = 13.5.sp,
                    color = Color(0xFFEF9A9A),
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        SettingsSection(title = "Installed Version") {
            SettingsRow(
                title = "Application",
                trailingValue = "MOBOT",
            )
            SettingsDivider()
            SettingsRow(
                title = "Current Version",
                trailingValue = status?.currentVersion ?: "1.0.0",
            )
            SettingsDivider()
            SettingsRow(
                title = "Release Channel",
                trailingValue = "Official Stable",
            )
            SettingsDivider()
            SettingsRow(
                title = "Persistent Storage",
                subtitle = "SQLite, configs, bots, memory & workspaces",
                trailingValue = if (status?.validation?.healthy == true) "Protected" else "Active",
            )
        }

        val hasUpdate = status?.status == "available" || status?.status == "ready_to_install" || status?.status == "downloading"
        val release = status?.release

        if (hasUpdate && release != null) {
            SettingsSection(title = "Available Update") {
                SettingsRow(
                    title = "Version",
                    trailingValue = release.version,
                )
                SettingsDivider()
                SettingsRow(
                    title = "Package Size",
                    trailingValue = "${release.fileSizeBytes / (1024 * 1024)} MB",
                )
                if (release.checksumSha256.isNotEmpty() && !release.checksumSha256.startsWith("url:")) {
                    SettingsDivider()
                    SettingsRow(
                        title = "SHA-256 Checksum",
                        subtitle = release.checksumSha256.take(16) + "...",
                        trailingValue = if (status?.status == "ready_to_install") "Verified" else "Pending",
                    )
                }
                SettingsDivider()
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = "Release Notes",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = release.releaseNotes,
                        fontSize = 13.sp,
                        color = AppTheme.colors.textSecondary,
                        lineHeight = 18.sp,
                    )
                }
            }
        } else {
            SettingsSection(title = "Status") {
                SettingsRow(
                    title = "Update Status",
                    trailingValue = when (status?.status) {
                        "checking" -> "Checking..."
                        "up_to_date" -> "Up to date"
                        "complete" -> "Up to date"
                        "error" -> "Check error"
                        else -> "Up to date"
                    },
                )
                SettingsDivider()
                SettingsRow(
                    title = "Last Checked",
                    trailingValue = status?.lastCheckedAt?.take(10) ?: "Just now",
                )
            }
        }

        if (downloading || status?.status == "downloading") {
            val progress = status?.downloadProgress?.percent ?: 0
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Downloading package...", fontSize = 13.sp, color = AppTheme.colors.textSecondary)
                    Text("$progress%", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = AppTheme.colors.textPrimary)
                }
                LinearProgressIndicator(
                    progress = { progress / 100f },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    color = Color(0xFF00B0FF),
                    trackColor = Color(0xFF262626),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (status?.status == "ready_to_install") {
                Button(
                    onClick = {
                        scope.launch {
                            installing = true
                            errorNotice = null
                            try {
                                val prep = session.prepareUpdateInstall()
                                if (prep != null && prep.ok) {
                                    val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
                                    val targetApk = File(updatesDir, "mobot-update.apk")
                                    val stagedPath = prep.stagedApkPath
                                    if (stagedPath != null) {
                                        val sourceApk = File(stagedPath)
                                        if (sourceApk.exists()) {
                                            sourceApk.copyTo(targetApk, overwrite = true)
                                        }
                                    }
                                    if (!targetApk.exists() || targetApk.length() < 100) {
                                        errorNotice = "Staged update package could not be read or is invalid."
                                        return@launch
                                    }
                                    val uri = FileProvider.getUriForFile(
                                        context,
                                        "${context.packageName}.transcripts",
                                        targetApk,
                                    )
                                    val intent = Intent(Intent.ACTION_VIEW).apply {
                                        setDataAndType(uri, "application/vnd.android.package-archive")
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    }
                                    context.startActivity(intent)
                                } else {
                                    errorNotice = prep?.error ?: "Failed to prepare update installation"
                                }
                            } catch (e: Exception) {
                                errorNotice = e.message ?: "Failed to launch installer"
                            } finally {
                                installing = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00B0FF)),
                    enabled = !installing,
                ) {
                    if (installing) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Text("Install update", fontWeight = FontWeight.SemiBold, color = Color.Black)
                    }
                }
            } else if (status?.status == "available") {
                Button(
                    onClick = {
                        scope.launch {
                            downloading = true
                            errorNotice = null
                            try {
                                val updated = session.downloadUpdate()
                                if (updated != null) {
                                    status = updated
                                }
                            } catch (e: Exception) {
                                errorNotice = e.message ?: "Download failed"
                            } finally {
                                downloading = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00B0FF)),
                    enabled = !downloading,
                ) {
                    if (downloading) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Text("Download update", fontWeight = FontWeight.SemiBold, color = Color.Black)
                    }
                }
            }

            OutlinedButton(
                onClick = {
                    scope.launch {
                        checking = true
                        errorNotice = null
                        try {
                            val checked = session.checkUpdates(force = true)
                            if (checked != null) {
                                status = checked
                            }
                        } catch (e: Exception) {
                            errorNotice = e.message ?: "Update check failed"
                        } finally {
                            checking = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = AppTheme.colors.textPrimary),
                border = BorderStroke(1.dp, Color(0xFF333333)),
                enabled = !checking && !downloading && !installing,
            ) {
                if (checking) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = AppTheme.colors.textPrimary, strokeWidth = 2.dp)
                } else {
                    Text("Check for updates", fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

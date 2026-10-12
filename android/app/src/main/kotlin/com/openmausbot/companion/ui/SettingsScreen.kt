package com.openmausbot.companion.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.ActivityDetail
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ThemeMode
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * What little the phone gets to configure — the port of
 * `ios/App/SettingsView.swift`.
 *
 * Almost nothing, on purpose: Phone settings, API keys and pairing all live
 * on the computer, because losing the phone must not mean losing the ability to
 * lock it out (§13). This is a status page with an unpair button.
 *
 * It is also the screen the unpaired home reaches, which is why both actions are
 * optional. `SettingsView(onConnect:)` in `ios/App/SettingsView.swift` does the
 * same thing: someone who answered "Not now" can still get to notifications
 * without first entering the connection flow they just declined, and the parts
 * that need a pairing — routines, unpairing, the address — are simply not there
 * to be pressed.
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenRoutines: (() -> Unit)? = null,
    /** AI & Models → Model providers. */
    onOpenModelProviders: (() -> Unit)? = null,
    /** AI & Models → Specialized AI capabilities. */
    onOpenSpecializedCapabilities: (() -> Unit)? = null,
    /**
     * Apps → Connected apps.
     *
     * This moved here from the roster's header when the header became the three
     * things the design gives it — identity, search, add. A connector is a
     * capability of the workspace, and this is where the workspace's capabilities
     * are listed.
     */
    onOpenConnectedApps: (() -> Unit)? = null,
    /** Applications built by MOBOT (Projects screen). */
    onOpenProjects: (() -> Unit)? = null,
    /** Offered instead of the computer's details when there is no pairing. */
    onConnect: (() -> Unit)? = null,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val connection by session.connection.collectAsState()
    val connections by session.connections.collectAsState()
    val status by session.status.collectAsState()
    val notifications by environment.notifications.access.collectAsState()
    val activityDetail by environment.chatPreferences.activityDetail.collectAsState()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    val haptics = rememberHaptics()

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
    var savingPermissions by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        session.mcp.refresh()
        neverAskPermissions = session.configStatus()?.neverAskPermissions
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            // No layout cost: the wedge is painted under the top of this column
            // rather than laid out above it, so the header still starts where the
            // header starts.
            .backdrop(motif = BackdropMotif.SETTINGS, band = 200.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = AppSpacing.xs, end = AppSpacing.gutter, top = AppSpacing.xs, bottom = AppSpacing.lg),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(
                text = "Settings",
                style = MaterialTheme.typography.headlineSmall,
                color = AppTheme.colors.textPrimary,
            )
        }

        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                // Room for the gesture bar: the last section is a destructive
                // action, and one that cannot be reached is worse than none.
                .padding(bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.xl),
        ) {
            // 1. The computer this phone is bound to. Everything else on this
            // screen is about the app; this is about the thing the app talks to,
            // and when it is wrong nothing else here matters.
            val paired = connection
            val otherComputers = connections.filter { it.id != paired?.id }
            if (paired == null && onConnect != null) {
                SettingsGroup("This phone") {
                    SettingsLink("Connect a computer", onClick = onConnect)
                    Footnote("Not paired yet. Your bots live on a computer, and this phone reaches them from here.")
                }
            }
            if (paired != null) {
                SettingsGroup("This phone") {
                    SettingsValueRow(
                        label = "Computer",
                        value = paired.name,
                    )
                    SettingsValueRow(
                        label = "Connection",
                        value = connectionStatusLabel(status),
                        tone = if (status == Session.Status.Live) StatusTone.GOOD else StatusTone.WARN,
                    )
                    SettingsLink(
                        text = "Try reconnecting",
                        enabled = !reconnecting,
                        busy = reconnecting,
                        onClick = {
                            scope.launch {
                                reconnecting = true
                                // Waits until the stream leaves connecting (or 10s),
                                // so the spinner means what it appears to mean.
                                session.refresh()
                                reconnecting = false
                            }
                        },
                    )
                    if (otherComputers.isNotEmpty()) {
                        otherComputers.forEach { computer ->
                            SettingsLink("Use ${computer.name}") {
                                haptics.play(TactileAction.SWITCH_COMPUTER)
                                session.switchComputer(computer.id)
                            }
                            SettingsLink("Remove ${computer.name}", destructive = true) {
                                pendingComputerRemoval = computer
                            }
                        }
                    }
                    SettingsLink(
                        text = if (connections.size > 1) "Remove this computer" else "Unpair this phone",
                        destructive = true,
                    ) { confirmingUnpair = true }
                    Footnote(SettingsPolicy.UNPAIR_FOOTER)
                }
            }

            // 2. How the app looks. A control that changes something visible on
            // the next frame is the cheapest way to prove the screen is alive.
            val themeMode by environment.appearance.theme.collectAsState()
            SettingsGroup("Appearance") {
                ChoiceRow(
                    label = "Theme",
                    options = ThemeMode.entries.map { it.label },
                    selectedIndex = ThemeMode.entries.indexOf(themeMode),
                    onSelect = { index -> environment.appearance.setTheme(ThemeMode.entries[index]) },
                )
                Footnote(themeMode.caption)
            }

            // 2b. The picture the whole app stands on. It lives with Appearance
            // because it is the same decision — what this app looks like — and
            // it is applied at the root, so every screen below picks it up on
            // the same frame it changes.
            val backgroundId by environment.appearance.background.collectAsState()
            SettingsGroup("Background") {
                BackgroundPicker(
                    selectedId = backgroundId,
                    onSelect = { environment.appearance.setBackground(it) },
                )
                Footnote(
                    "One picture behind every screen, chosen once. None is the plain page.",
                )
            }

            // 3. Notifications, including the one switch that decides whether
            // they can arrive at all when the app is not on screen.
            SettingsGroup("Notifications") {
                val alwaysOnEnabled by environment.alwaysOnEnabled.collectAsState()
                SettingsValueRow(
                    label = "Permission",
                    value = NotificationPermissionController.statusText(notifications),
                )
                SettingsLink(
                    text = NotificationPermissionController.buttonText(notifications),
                    enabled = NotificationPermissionController.buttonEnabled(notifications),
                    onClick = environment.notifications::act,
                )
                SettingsValueRow(
                    label = "Background",
                    value = if (alwaysOnEnabled) "Always connected" else "While the app is open",
                )
                SettingsLink(
                    text = if (alwaysOnEnabled) "Turn off always-on connection" else "Turn on always-on connection",
                    onClick = environment.onToggleAlwaysOn,
                )
                Footnote(
                    if (alwaysOnEnabled) {
                        "A permanent low-priority notification keeps the connection open, so routine " +
                            "results and reminders reach you with the app closed."
                    } else {
                        "Notifications arrive while the app is open or was recently in the background."
                    },
                )
            }

            // 4. The models behind every bot. Standalone: this phone hosts its
            // own engines, and every provider is managed on its own screen. The
            // row is drawn only when its destination exists — a dead row is
            // exactly the fake state this screen must not show.
            if (onOpenModelProviders != null || onOpenSpecializedCapabilities != null) {
                SettingsGroup("AI") {
                    if (onOpenModelProviders != null) {
                        SettingsLink(
                            text = "Model providers",
                            onClick = onOpenModelProviders,
                            caption = "Providers, sign-in, API keys, and the default model for new chats.",
                        )
                    }
                    if (onOpenSpecializedCapabilities != null) {
                        SettingsLink(
                            text = "Specialized capabilities",
                            onClick = onOpenSpecializedCapabilities,
                            caption = "Image generation, audio, TTS, and multimodal models across all bots.",
                        )
                    }
                }
            }

            // 5. What the bots can reach outside this computer. Automated
            // sign-in lives on the computer, so this is a status page for it.
            if (onOpenConnectedApps != null) {
                SettingsGroup("Apps") {
                    SettingsLink(
                        text = "Connected apps",
                        onClick = onOpenConnectedApps,
                        caption = "Accounts and services your bots can reach, including Vercel and Render deployment.",
                    )
                }
            }

            // 5b. Generated applications (Phase F & Phase H)
            if (onOpenProjects != null) {
                SettingsGroup("Applications") {
                    SettingsLink(
                        text = "Generated applications",
                        onClick = onOpenProjects,
                        caption = "View, preview, and deploy web applications built by MOBOT.",
                    )
                }
            }

            // 6. The agents' own workspace, schedules included. Routine
            // schedules live on the computer, so with no binding there is
            // nothing to schedule against and the row is absent rather than
            // present and dead. Connectors are deliberately not here: their
            // door is the header of the bots screen, and one capability should
            // have one home.
            if (onOpenRoutines != null) {
                SettingsGroup("Agents") {
                    SettingsLink(
                        text = "Threads & Routines",
                        onClick = onOpenRoutines,
                        caption = SettingsPolicy.WORKSPACE_FOOTER,
                    )
                }
            }

            // 7. The owner's standing grant that no bot ever stops for a
            // permission card. It lives on the computer, not the phone, and is
            // read back so a reinstall shows the truth rather than a default.
            // Null while the first read is in flight.
            if (connection != null || neverAskPermissions != null) {
                SettingsGroup("Approvals") {
                    SettingsValueRow(
                        label = "Tool calls",
                        value = when (neverAskPermissions) {
                            null -> "Checking…"
                            true -> "Never ask"
                            false -> "Ask when needed"
                        },
                    )
                    val current = neverAskPermissions
                    SettingsLink(
                        text = if (current == true) "Ask me before tool calls again" else "Never ask for permission",
                        enabled = current != null && !savingPermissions,
                    ) {
                        val next = current != true
                        scope.launch {
                            savingPermissions = true
                            session.setNeverAskPermissions(next)?.let { neverAskPermissions = it.neverAskPermissions }
                            savingPermissions = false
                        }
                    }
                    Footnote(
                        if (neverAskPermissions == true) {
                            "Bots work without pausing — no approval before a tool call, a download or a " +
                                "file change."
                        } else {
                            "Bots pause on an approval card before reaching the web, changing files or " +
                                "running tools."
                        },
                    )
                }
            }

            // 8. How conversations are drawn on this phone.
            SettingsGroup("Conversations") {
                SettingsValueRow(label = "Activity detail", value = activityDetail.label)
                SettingsLink("Change activity detail") { choosingActivity = true }
                SettingsLink("Quick replies") { editingQuickReplies = true }
                Footnote(activityDetail.caption)
            }

            // 9. The developer surface, at the bottom and named for what it is.
            // MCP servers are a capability of the computer, not a feature of
            // this phone's home screen.
            SettingsGroup("Developer") {
                McpSection(session)
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
                        // Session re-parses, re-dials and persists; the walk and
                        // promote semantics stay its job. The form only refuses
                        // what it can already tell is not an address.
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
                        // Local token and connection only. Revoking the device
                        // itself is Settings → Phone on the computer (§6).
                        session.signOut()
                    },
                ) {
                    // With another computer saved this removes one of them; the
                    // phone stays paired, so "Unpair" would be the wrong promise.
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
                // iOS draws a Picker (SettingsView.swift:67-78), which marks the
                // choice already in force; three plain buttons do not.
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
 * One group of settings: a quiet heading, then rows.
 *
 * No card, no box, no divider under the title. The old screen ruled a line
 * between a heading and its own rows and set every action in the accent colour,
 * which is what made a screen of eleven options read as a wall of green links.
 * Here the heading groups, the rows sit on the page, and only [SettingsLink]
 * is tappable.
 */
@Composable
internal fun SettingsGroup(title: String?, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        title?.let { AppSectionHeader(it) }
        // The group is one white surface on the warm page rather than a label with
        // rows floating under it. That is the whole difference between a settings
        // screen that looks like a form and one that looks like the rest of the
        // app: the rows belong to something, and the something is a card.
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

/** How a value reads: a fact, or something that wants attention. */
enum class StatusTone { PLAIN, GOOD, WARN, BAD }

/**
 * A label and a value — a fact about the phone, not a control.
 *
 * Draws no chevron and takes no click, so nothing in it looks tappable when it
 * is not: the fastest way to make a settings list feel broken is a row that
 * looks like a button and does nothing.
 */
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

/** The old name, kept for the sections that still draw a value row in place. */
@Composable
internal fun SettingsRow(label: String, value: String) = SettingsValueRow(label, value)

/**
 * A tappable row: the label, an optional line under it, and a chevron.
 *
 * Destructive rows keep their words and drop to the danger tone rather than
 * being painted as a red button — the row is still a row, and the colour is said
 * in the type as well, so it does not depend on colour alone.
 *
 * [busy] swaps the chevron for a spinner. The words do not change: an action that
 * renames itself mid-flight is one more thing to read on a screen that is meant
 * to be read once, and "Try reconnecting" is still the truth while it is trying.
 */
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

/**
 * A small set of mutually exclusive choices, inline: System / Light / Dark.
 *
 * Inline rather than a dialog because the choice is visible as soon as it is
 * made — the app redraws — and a picker that hides three words behind a tap to
 * show those same three words is a screen for the sake of a screen.
 */
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

/**
 * The address, short enough to read at a glance and long enough to copy — the
 * port of the connection details in `ios/App/SettingsView.swift:346-371`.
 */
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
            // Selectable, because the reason to show it in full is to take it away.
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
    /** Drawn at the end of the row — a progress indicator while one is running. */
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

/** Long enough for "Copied" to be read, short enough not to linger (iOS `:363-367`). */
private const val COPIED_LABEL_MILLIS = 2_000L

/**
 * The connection, in two words, for the value beside "Connection" — the same
 * status [troubleshootingText] explains in a sentence.
 */
internal fun connectionStatusLabel(status: Session.Status): String = when (status) {
    Session.Status.Live -> "Connected"
    Session.Status.Connecting -> "Connecting…"
    Session.Status.Unauthorized -> "Needs pairing"
    Session.Status.Unpaired -> "Not paired"
    is Session.Status.Offline -> "Offline"
}

/**
 * What the Troubleshooting section says before offering to reconnect — the port
 * of `ConnectionSecurityView.troubleshootingText` (`ios/App/SettingsView.swift:445-458`).
 */
internal fun troubleshootingText(status: Session.Status): String = when (status) {
    Session.Status.Live -> "This computer is connected and responding normally."
    Session.Status.Connecting -> "MOBOT is trying the saved connection automatically."
    Session.Status.Unauthorized -> "This phone was removed from the computer. Pair it again to reconnect."
    Session.Status.Unpaired -> "This phone is not paired with a computer."
    is Session.Status.Offline -> status.message
}

/**
 * The address with its middle taken out, so a long tailnet name still shows the
 * host and the port it ends in — `shortened` in `ios/App/SettingsView.swift:460-464`.
 */
internal fun shortenedAddress(address: String): String {
    if (address.length <= 14) return address
    val leading = minOf(20, maxOf(8, address.length - 8))
    return address.take(leading) + "…" + address.takeLast(6)
}

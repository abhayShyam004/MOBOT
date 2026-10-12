package com.openmausbot.companion.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import com.openmausbot.companion.core.GroupResponder
import com.openmausbot.companion.core.Room
import kotlinx.coroutines.launch

/**
 * A room's own settings — the port of the desktop's channel settings.
 *
 * The room header opens THIS, not the thread/model sheet: a group has no
 * single model to configure, and the header used to lead straight to a
 * provider picker that did not belong to the room at all. Name, bulletin,
 * membership and who answers by default are the room's real controls.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupSettingsSheet(room: Room, onDismiss: () -> Unit, onDeleted: () -> Unit = {}) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val state by session.state.collectAsState()

    // Live record so a rename or an SSE frame keeps the sheet current.
    val live = remember(state, room.id) { state.rooms.firstOrNull { it.id == room.id } }
    if (live == null) {
        LaunchedEffect(room.id) { onDismiss() }
        return
    }

    var name by remember(live.id) { mutableStateOf(live.name) }
    var bulletin by remember(live.id) { mutableStateOf(live.bulletin) }
    var members by remember(live.id) { mutableStateOf(live.memberIds.toSet()) }
    var responderKind by remember(live.id) { mutableStateOf(GroupSettingsRules.responderKind(live)) }
    var responderBotId by remember(live.id) { mutableStateOf(live.defaultResponder.botId) }
    var saving by remember { mutableStateOf(false) }
    var confirmingDelete by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val candidates = remember(state) { state.bots.filter { it.hidden != true } }
    val canSave = !saving &&
        members.isNotEmpty() &&
        name.trim().isNotEmpty() &&
        GroupSettingsRules.canSave(live, name, bulletin, members, responderKind, responderBotId)

    fun save() {
        saving = true
        error = null
        scope.launch {
            val responder = GroupSettingsRules.responder(responderKind, responderBotId, members)
            val updated = session.updateRoomSettings(
                forRoom = live,
                name = name.trim(),
                bulletin = bulletin.trim(),
                memberIds = members.toList(),
                responder = responder,
            )
            saving = false
            if (updated == null) {
                error = session.actionError ?: "Couldn't save these room settings. Try again."
                session.actionError = null
            } else {
                onDismiss()
            }
        }
    }

    BasicAlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = true),
    ) {
        Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(vertical = 16.dp)) {
                Text(
                    text = "Room settings",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )

                Column(
                    modifier = Modifier.padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    AppTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = "Room name",
                        singleLine = true,
                        enabled = !saving,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppTextField(
                        value = bulletin,
                        onValueChange = { bulletin = it },
                        label = "What is this room for? (optional)",
                        singleLine = false,
                        minLines = 2,
                        enabled = !saving,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                SectionLabel("Members")
                LazyColumn(modifier = Modifier.heightIn(max = 220.dp)) {
                    items(candidates, key = { it.id }) { bot ->
                        val checked = bot.id in members
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .toggleable(
                                    value = checked,
                                    enabled = !saving,
                                    role = Role.Checkbox,
                                    onValueChange = { on ->
                                        members = if (on) members + bot.id else members - bot.id
                                        // A removed member can't keep the default.
                                        if (!on && responderBotId == bot.id) {
                                            responderBotId = null
                                            responderKind = "mentions"
                                        }
                                    },
                                )
                                .padding(horizontal = 12.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = checked, onCheckedChange = null, enabled = !saving)
                            Column(modifier = Modifier.padding(start = 8.dp)) {
                                Text(bot.name, fontSize = 15.sp)
                                bot.title?.takeIf { it.isNotBlank() }?.let {
                                    Text(it, fontSize = 12.sp, color = secondaryTint)
                                }
                            }
                        }
                    }
                }

                SectionLabel("Who answers by default")
                ResponderOption(
                    label = "Only when mentioned",
                    selected = responderKind == "mentions",
                    enabled = !saving,
                ) { responderKind = "mentions"; responderBotId = null }
                ResponderOption(
                    label = "Everyone in the room",
                    selected = responderKind == "everyone",
                    enabled = !saving,
                ) { responderKind = "everyone"; responderBotId = null }
                candidates.filter { it.id in members }.forEach { bot ->
                    ResponderOption(
                        label = bot.name,
                        selected = responderKind == "member" && responderBotId == bot.id,
                        enabled = !saving,
                    ) { responderKind = "member"; responderBotId = bot.id }
                }

                error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                }

                // Deleting the whole room lives apart from Save/Cancel — it
                // is not an edit of these settings but the end of them, and
                // it asks once before anything is lost.
                TextButton(
                    onClick = { error = null; confirmingDelete = true },
                    enabled = !saving && !deleting,
                    modifier = Modifier.padding(horizontal = 12.dp),
                ) {
                    Text("Delete room", color = MaterialTheme.colorScheme.error)
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") }
                    Button(
                        onClick = { save() },
                        enabled = canSave,
                        modifier = Modifier.padding(start = 8.dp),
                    ) {
                        Text(if (saving) "Saving…" else "Save")
                    }
                }
            }
        }
    }

    if (confirmingDelete) {
        BasicAlertDialog(
            onDismissRequest = { if (!deleting) confirmingDelete = false },
            properties = DialogProperties(usePlatformDefaultWidth = true),
        ) {
            Surface(
                shape = MaterialTheme.shapes.extraLarge,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("Delete “${live.name}”?", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Every thread and message in this room is removed for good. This can't be undone.",
                        fontSize = 14.sp,
                        color = secondaryTint,
                    )
                    error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { confirmingDelete = false }, enabled = !deleting) { Text("Cancel") }
                        Button(
                            onClick = {
                                deleting = true
                                error = null
                                scope.launch {
                                    val deleted = session.deleteRoom(live)
                                    deleting = false
                                    if (deleted) {
                                        confirmingDelete = false
                                        onDismiss()
                                        onDeleted()
                                    } else {
                                        error = session.actionError
                                            ?: "Couldn't delete this room. Try again."
                                        session.actionError = null
                                    }
                                }
                            },
                            enabled = !deleting,
                            modifier = Modifier.padding(start = 8.dp),
                        ) {
                            Text(if (deleting) "Deleting…" else "Delete room")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = secondaryTint,
        modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 6.dp),
    )
}

@Composable
private fun ResponderOption(label: String, selected: Boolean, enabled: Boolean, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.RadioButton, enabled = enabled, onClick = onSelect)
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        RadioButton(selected = selected, onClick = null, enabled = enabled)
        Text(label, fontSize = 14.sp)
    }
}

/** Pure rules for the sheet, so what enables Save is testable without Compose. */
object GroupSettingsRules {
    fun responderKind(room: Room): String = when (room.defaultResponder.kind) {
        "everyone" -> "everyone"
        "member" -> "member"
        else -> "mentions"
    }

    /** A member responder whose bot was removed silently degrades to mentions;
     * the server refuses a member that is not in the new list. */
    fun responder(kind: String, botId: String?, members: Set<String>): GroupResponder = when {
        kind == "everyone" -> GroupResponder("everyone")
        kind == "member" && botId != null && botId in members -> GroupResponder("member", botId)
        else -> GroupResponder("mentions")
    }

    /** Save is offered only for a real change with a non-empty name and at
     * least one member — the two invariants the server enforces. */
    fun canSave(
        room: Room,
        name: String,
        bulletin: String,
        members: Set<String>,
        responderKind: String,
        responderBotId: String?,
    ): Boolean {
        if (members.isEmpty() || name.trim().isEmpty()) return false
        val next = responder(responderKind, responderBotId, members)
        val responderChanged = next.kind != room.defaultResponder.kind || next.botId != room.defaultResponder.botId
        return name != room.name ||
            bulletin != room.bulletin ||
            members != room.memberIds.toSet() ||
            responderChanged
    }
}

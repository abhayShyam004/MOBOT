package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Room

/**
 * The two in-chat panels that exist so a fixable problem never has to be
 * expressed as one clipped red line:
 *
 *  - [RoomSetupPanel] is the phone's copy of the desktop's room setup step.
 *    A room that still owes its first-run choices refuses its first message,
 *    and before this panel the only answer to "why" was a 409 sentence at the
 *    bottom of the composer. The choices are exactly the ones the endpoint
 *    takes: the bulletin, and who answers by default.
 *  - [ProviderFixPanel] is where a provider failure lands: the provider's own
 *    words stay visible, and the remedy is one button into Model providers —
 *    the only screen that actually holds the endpoint, key and model fields.
 */

@Composable
internal fun RoomSetupPanel(
    room: Room,
    busy: Boolean,
    onSubmit: (bulletin: String, everyone: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var bulletin by remember(room.id) { mutableStateOf(room.bulletin) }
    var everyone by remember(room.id) { mutableStateOf(room.defaultResponder.kind == "everyone") }
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "Finish setting up “${room.name}”",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "This room needs two choices before it can take its first message. " +
                    "You can change both later.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AppTextField(
                value = bulletin,
                onValueChange = { bulletin = it },
                label = "What is this room for? (optional)",
                singleLine = false,
                minLines = 2,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Who answers by default?", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            ResponderChoice(
                label = "Only when mentioned",
                selected = !everyone,
                enabled = !busy,
                onSelect = { everyone = false },
            )
            ResponderChoice(
                label = "Everyone in the room",
                selected = everyone,
                enabled = !busy,
                onSelect = { everyone = true },
            )
            Button(
                onClick = { onSubmit(bulletin.trim(), everyone) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Starting…" else "Start the room")
            }
        }
    }
}

@Composable
private fun ResponderChoice(label: String, selected: Boolean, enabled: Boolean, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.RadioButton, enabled = enabled, onClick = onSelect),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        RadioButton(selected = selected, onClick = null, enabled = enabled)
        Text(label, fontSize = 14.sp)
    }
}

/**
 * The provider fixer. [classification] is [ApiErrorRules.classify]'s verdict —
 * its title and explanation lead and the provider's raw words stay visible
 * underneath. The remedy is deliberately one button: the endpoint, key and
 * model id all live in Model providers, and half-editing them here (blind, in
 * a conversation) is what made this panel read as a vague form to fill in.
 */
@Composable
internal fun ProviderFixPanel(
    classification: ApiErrorRules.Classification,
    onOpenProviders: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(classification.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text(
                classification.explanation,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            classification.detail?.takeIf { it.isNotBlank() }?.let { detail ->
                Text(
                    text = detail,
                    fontSize = 12.sp,
                    color = Color(0xFFB3261E),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(8.dp))
                        .padding(10.dp),
                )
            }
            Button(
                onClick = onOpenProviders,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Open Model providers")
            }
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text("Dismiss")
            }
        }
    }
}

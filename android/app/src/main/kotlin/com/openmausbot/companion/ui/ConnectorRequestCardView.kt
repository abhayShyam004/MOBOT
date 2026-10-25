package com.openmausbot.companion.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.openmausbot.companion.MainActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ConnectorCardRules
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.Session
import java.net.URI
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The sign-in finishes in the browser, so the outcome only exists
// provider-side and has to be asked for. The desktop polls the same endpoint
// every four seconds, up to seventy-five times (ConnectorCard.tsx:41-64):
// same cadence, same ceiling, same reason.
private const val CONNECTOR_POLL_INTERVAL_MS = 4_000L
private const val CONNECTOR_POLL_ATTEMPTS = 75

/**
 * One app the bot needs connected before it can continue
 * (`server/connector-proxy.ts` turns an agent's connection request into this
 * card). The message is patched in place as the flow progresses, so the card
 * renders whatever state the harness last stored.
 */
@Composable
internal fun ConnectorRequestCardView(
    chat: Chat,
    message: Message,
    /** The bot whose request this is: the chat's bot, or the sender in a room. */
    botId: String,
    haptics: Haptics,
) {
    val card = message.connector ?: return
    if (ConnectorCardRules.isDismissed(card)) return
    val session = LocalCompanion.current.session
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val threadId = chat.threadId
    var busy by remember(message.id) { mutableStateOf(false) }

    val connected = ConnectorCardRules.isConnected(card)
    val authorizing = ConnectorCardRules.isAuthorizing(card)

    if (authorizing) {
        LaunchedEffect(message.id, card.status) {
            repeat(CONNECTOR_POLL_ATTEMPTS) {
                delay(CONNECTOR_POLL_INTERVAL_MS)
                val status = session.connectorCardStatus(botId, message.id, threadId) ?: return@LaunchedEffect
                if (status.connected) return@LaunchedEffect
            }
        }
    }

    fun connect() {
        busy = true
        haptics.play(TactileAction.CHOOSE_APPROVAL)
        scope.launch {
            val url = session.authorizeConnectorCard(botId, message.id, threadId)
            if (url != null) {
                openConnectorAuthorization(context, session, url)
                // Auto-return polling for card authorization in chat
                scope.launch {
                    val startTime = System.currentTimeMillis()
                    val timeoutMs = 120_000L
                    while (System.currentTimeMillis() - startTime < timeoutMs) {
                        kotlinx.coroutines.delay(2000L)
                        try {
                            val status = session.connectorCardStatus(botId, message.id, threadId)
                            if (status?.connected == true) {
                                try {
                                    val returnIntent = Intent(context, MainActivity::class.java).apply {
                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                                    }
                                    context.startActivity(returnIntent)
                                } catch (_: Exception) {}
                                break
                            }
                        } catch (_: Exception) {}
                    }
                }
            }
            busy = false
        }
    }

    fun resume() {
        busy = true
        haptics.play(TactileAction.GRANT_APPROVAL)
        scope.launch {
            session.resumeConnectorCard(botId, message.id, threadId)
            busy = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(secondaryTint.copy(alpha = 0.13f), RoundedCornerShape(22.dp))
            .then(
                if (!connected) {
                    Modifier.border(1.5.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(22.dp))
                } else {
                    Modifier
                },
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(card.label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                if (card.alias != null) {
                    Text("Account “${card.alias}”", fontSize = 12.sp, color = secondaryTint)
                }
            }
            if (connected) {
                Text("Connected", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(MausPalette.argb("green")))
            }
        }
        Text(
            text = when {
                connected && ConnectorCardRules.isResumed(card) -> "The bot is continuing this task."
                connected -> "Signed in. Continue the task when ready."
                else -> card.description
            },
            fontSize = 14.sp,
            color = secondaryTint,
        )
        card.error?.let { Text(it, fontSize = 13.sp, color = Color(MausPalette.argb("red"))) }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (authorizing) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
            }
            Text(
                ConnectorCardRules.progressLabel(card),
                fontSize = 12.sp,
                color = secondaryTint,
                modifier = Modifier.weight(1f),
            )
            when {
                !connected -> {
                    // The way out is only offered while the connection is
                    // still open; a connected account is managed from
                    // Settings → Connected apps instead.
                    TextButton(onClick = {
                        scope.launch { session.dismissConnectorCard(botId, message.id, threadId) }
                    }) { Text(ConnectorCardRules.NOT_NOW) }
                    Button(onClick = ::connect, enabled = !busy) {
                        Text(ConnectorCardRules.connectActionLabel(card))
                    }
                }
                !ConnectorCardRules.isResumed(card) -> Button(
                    onClick = ::resume,
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(),
                ) { Text("Continue task") }
            }
        }
    }
}

/**
 * Hand a provider sign-in page to the system browser. ACTION_VIEW keeps
 * provider cookies, redirects, and account choice in the browser instead of
 * our process. Shared by this card and the Connected apps screen so both
 * fail the same way.
 */
internal fun openConnectorAuthorization(context: Context, session: Session, url: URI) {
    val uri = Uri.parse(url.toASCIIString())
    try {
        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
        customTabsIntent.launchUrl(context, uri)
    } catch (_: Exception) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            session.actionError = "This phone has no browser available to open the authorization page."
        } catch (_: SecurityException) {
            session.actionError = "The authorization page could not be opened. Check your browser restrictions and try again."
        }
    }
}

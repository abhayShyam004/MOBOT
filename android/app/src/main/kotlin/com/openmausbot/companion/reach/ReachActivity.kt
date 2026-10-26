package com.openmausbot.companion.reach

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Full-screen incoming call-style and alarm presentation activity.
 * Configured to turn on the screen and display over the keyguard / lockscreen.
 */
class ReachActivity : ComponentActivity() {

    private var event: ReachEvent? = null
    private var ttsSpeaker: ReachTtsSpeaker? = null
    private val activeEventState = mutableStateOf<ReachEvent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Configure presentation over lock screen and turn screen on
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        val eventId = intent.getStringExtra(ReachScheduler.EXTRA_EVENT_ID) ?: ""
        val store = ReachStore.getInstance(this)
        event = store.getEvent(eventId)
        activeEventState.value = event

        // Initialize TTS
        ttsSpeaker = ReachTtsSpeaker(this)

        setContent {
            val currentEvent = activeEventState.value ?: event ?: ReachEvent(
                type = ReachEventType.CALL_REMINDER,
                title = "MOBOT Reminder",
                message = "Scheduled reminder",
                triggerTimeMs = System.currentTimeMillis()
            )

            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF0F141C)
                ) {
                    ReachScreen(
                        event = currentEvent,
                        onAnswer = { onAnswerClicked(currentEvent) },
                        onDecline = { onDeclineClicked(currentEvent) },
                        onSnooze = { onSnoozeClicked(currentEvent) },
                        onDismissAlarm = { onDismissAlarmClicked(currentEvent) },
                        onSpeakAlarmMessage = { speakReminderText(currentEvent) },
                        onStopSpeech = { ttsSpeaker?.stop() },
                        onFinishCall = { onFinishCallClicked(currentEvent) }
                    )
                }
            }
        }
    }

    override fun onNewIntent(newIntent: Intent) {
        super.onNewIntent(newIntent)
        setIntent(newIntent)
        val eventId = newIntent.getStringExtra(ReachScheduler.EXTRA_EVENT_ID) ?: ""
        val store = ReachStore.getInstance(this)
        event = store.getEvent(eventId)
        activeEventState.value = event
    }

    private fun cancelNotification(event: ReachEvent) {
        val notificationManager = NotificationManagerCompat.from(this)
        val requestCode = ReachScheduler.getRequestCode(event.id)
        notificationManager.cancel(ReachAlarmReceiver.NOTIFICATION_BASE_ID + requestCode)
    }

    private fun onAnswerClicked(event: ReachEvent) {
        ReachAudioPlayer.stopRinging(this)
        cancelNotification(event)
        ReachStore.getInstance(this).updateState(event.id, ReachEventState.ANSWERED)
        speakReminderText(event)
    }

    private fun speakReminderText(event: ReachEvent) {
        val speechText = if (event.message.isNotBlank()) {
            "${event.title}. ${event.message}"
        } else {
            event.title
        }
        ttsSpeaker?.speak(speechText)
    }

    private fun onDeclineClicked(event: ReachEvent) {
        ReachAudioPlayer.stopRinging(this)
        cancelNotification(event)
        ReachStore.getInstance(this).updateState(event.id, ReachEventState.DISMISSED)
        finish()
    }

    private fun onFinishCallClicked(event: ReachEvent) {
        ttsSpeaker?.stop()
        ReachAudioPlayer.stopRinging(this)
        cancelNotification(event)
        ReachStore.getInstance(this).updateState(event.id, ReachEventState.COMPLETED)
        finish()
    }

    private fun onDismissAlarmClicked(event: ReachEvent) {
        ttsSpeaker?.stop()
        ReachAudioPlayer.stopRinging(this)
        cancelNotification(event)
        ReachStore.getInstance(this).updateState(event.id, ReachEventState.DISMISSED)
        finish()
    }

    private fun onSnoozeClicked(event: ReachEvent) {
        ttsSpeaker?.stop()
        ReachAudioPlayer.stopRinging(this)
        cancelNotification(event)
        val snoozed = ReachScheduler.getInstance(this).snooze(event.id, event.snoozeMinutes)
        if (snoozed != null) {
            Toast.makeText(this, "Snoozed for ${event.snoozeMinutes} minutes", Toast.LENGTH_SHORT).show()
        }
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        ReachAudioPlayer.stopRinging(this)
        ttsSpeaker?.shutdown()
    }
}

@Composable
fun ReachScreen(
    event: ReachEvent,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
    onSnooze: () -> Unit,
    onDismissAlarm: () -> Unit,
    onSpeakAlarmMessage: () -> Unit,
    onStopSpeech: () -> Unit,
    onFinishCall: () -> Unit
) {
    if (event.type == ReachEventType.CALL_REMINDER) {
        CallReminderView(
            event = event,
            onAnswer = onAnswer,
            onDecline = onDecline,
            onSnooze = onSnooze,
            onStopSpeech = onStopSpeech,
            onFinishCall = onFinishCall
        )
    } else {
        AlarmView(
            event = event,
            onDismiss = onDismissAlarm,
            onSnooze = onSnooze,
            onSpeak = onSpeakAlarmMessage,
            onStopSpeech = onStopSpeech
        )
    }
}

@Composable
fun CallReminderView(
    event: ReachEvent,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
    onSnooze: () -> Unit,
    onStopSpeech: () -> Unit,
    onFinishCall: () -> Unit
) {
    var answered by remember { mutableStateOf(event.state == ReachEventState.ANSWERED) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Top branding
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(modifier = Modifier.height(32.dp))
            Text(
                text = "MOBOT CALL REMINDER",
                color = Color(0xFF64B5F6),
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp
            )
            Text(
                text = "Local scheduled reminder • Not a phone call",
                color = Color(0xFF90A4AE),
                fontSize = 11.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        // Center content card
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 16.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF1E293B)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Call,
                    contentDescription = "MOBOT Reach",
                    tint = Color(0xFF38BDF8),
                    modifier = Modifier.size(48.dp)
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = event.title,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center
            )

            if (answered) {
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Connected • Speaking Reminder",
                            color = Color(0xFF4ADE80),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = if (event.message.isNotBlank()) event.message else event.title,
                            color = Color(0xFFE2E8F0),
                            fontSize = 16.sp,
                            lineHeight = 22.sp
                        )
                    }
                }
            } else {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Incoming Reminder Alert...",
                    color = Color(0xFF94A3B8),
                    fontSize = 14.sp
                )
            }
        }

        // Bottom action controls
        if (!answered) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.fillMaxWidth()
            ) {
                OutlinedButton(
                    onClick = onSnooze,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF94A3B8)),
                    modifier = Modifier.padding(bottom = 24.dp)
                ) {
                    Text("Snooze (${event.snoozeMinutes}m)")
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    // Decline Button
                    Button(
                        onClick = onDecline,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                        shape = CircleShape,
                        modifier = Modifier.size(72.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Decline",
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }

                    // Answer Button
                    Button(
                        onClick = {
                            answered = true
                            onAnswer()
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E)),
                        shape = CircleShape,
                        modifier = Modifier.size(72.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Call,
                            contentDescription = "Answer",
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(32.dp))
            }
        } else {
            // Controls when answered / speaking
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = onStopSpeech,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF94A3B8))
                    ) {
                        Text("Stop Speech")
                    }

                    Button(
                        onClick = onFinishCall,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7))
                    ) {
                        Text("Done / Finish")
                    }
                }
                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}

@Composable
fun AlarmView(
    event: ReachEvent,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
    onSpeak: () -> Unit,
    onStopSpeech: () -> Unit
) {
    val timeFormat = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }
    val formattedTime = remember(event.triggerTimeMs) { timeFormat.format(Date(event.triggerTimeMs)) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Top header
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(modifier = Modifier.height(32.dp))
            Text(
                text = "MOBOT ALARM",
                color = Color(0xFFF59E0B),
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp
            )
        }

        // Center clock & title
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = formattedTime,
                color = Color.White,
                fontSize = 54.sp,
                fontWeight = FontWeight.Light,
                fontFamily = FontFamily.SansSerif
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = event.title,
                color = Color(0xFFE2E8F0),
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center
            )

            if (event.message.isNotBlank()) {
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "Spoken Reminder",
                                color = Color(0xFF38BDF8),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            IconButton(onClick = onSpeak, modifier = Modifier.size(24.dp)) {
                                Icon(
                                    imageVector = Icons.Default.Info,
                                    contentDescription = "Listen",
                                    tint = Color(0xFF38BDF8)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = event.message,
                            color = Color(0xFFCBD5E1),
                            fontSize = 14.sp
                        )
                    }
                }
            }
        }

        // Bottom controls
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedButton(
                    onClick = onSnooze,
                    modifier = Modifier.weight(1f).height(56.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFCBD5E1))
                ) {
                    Text("Snooze (${event.snoozeMinutes}m)", fontSize = 16.sp)
                }

                Button(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f).height(56.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))
                ) {
                    Text("Dismiss", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

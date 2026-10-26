package com.openmausbot.companion.reach

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.openmausbot.companion.R

/**
 * Handles AlarmManager triggers for MOBOT Reach call-like reminders and alarms.
 *
 * Guarantees delivery when the screen is off and the app interface is closed:
 * 1. Acquires a temporary WakeLock to keep CPU awake.
 * 2. Validates persisted event eligibility from ReachStore.
 * 3. Starts audible ringing and vibration.
 * 4. Posts high-priority notification with Full-Screen Intent over lockscreen.
 * 5. Launches ReachActivity.
 */
class ReachAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val eventId = intent?.getStringExtra(ReachScheduler.EXTRA_EVENT_ID) ?: return
        Log.i(TAG, "Received reach alarm trigger for event: $eventId")

        // 1. Acquire CPU WakeLock and Screen WakeLock with ACQUIRE_CAUSES_WAKEUP
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "MOBOT:ReachAlarmReceiverWakeLock"
        )
        wakeLock.acquire(60_000L)

        try {
            @Suppress("DEPRECATION")
            val screenWakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "MOBOT:ReachAlarmScreenWakeLock"
            )
            screenWakeLock.acquire(10_000L)
        } catch (e: Exception) {
            Log.w(TAG, "Screen wakeup lock failed: ${e.message}")
        }

        try {
            val store = ReachStore.getInstance(context)
            val event = store.getEvent(eventId)
            if (event == null) {
                Log.w(TAG, "Event $eventId not found in ReachStore; ignoring trigger.")
                return
            }

            if (event.state != ReachEventState.SCHEDULED && event.state != ReachEventState.SNOOZED) {
                Log.w(TAG, "Event $eventId is in state ${event.state}, not eligible to ring; suppressing trigger.")
                return
            }

            // Update state to RINGING
            store.updateState(eventId, ReachEventState.RINGING)
            val isCall = event.type == ReachEventType.CALL_REMINDER

            // 2. Start ringing audio and vibration
            ReachAudioPlayer.startRinging(context, isCall)

            // 3. Ensure notification channels exist
            ensureChannels(context)

            // 4. Build Full-Screen Intent for ReachActivity
            val activityIntent = Intent(context, ReachActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(ReachScheduler.EXTRA_EVENT_ID, event.id)
            }

            val requestCode = ReachScheduler.getRequestCode(event.id)
            val fullScreenPendingIntent = PendingIntent.getActivity(
                context,
                requestCode,
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val channelId = if (isCall) CHANNEL_CALLS else CHANNEL_ALARMS
            val category = if (isCall) NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_ALARM

            val title = if (isCall) "MOBOT Call Reminder: ${event.title}" else "MOBOT Alarm: ${event.title}"
            val contentText = if (event.message.isNotBlank()) event.message else "Tap to answer or dismiss"

            val notification = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(contentText)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(category)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(fullScreenPendingIntent)
                .setAutoCancel(false)
                .setOngoing(true)
                .build()

            val notificationManager = NotificationManagerCompat.from(context)
            try {
                notificationManager.notify(NOTIFICATION_BASE_ID + requestCode, notification)
            } catch (e: SecurityException) {
                Log.w(TAG, "Notification permission missing: ${e.message}")
            }

            // 5. Directly launch ReachActivity
            try {
                context.startActivity(activityIntent)
            } catch (e: Exception) {
                Log.w(TAG, "Direct startActivity failed, falling back to full-screen notification: ${e.message}")
            }
            Log.i(TAG, "Dispatched full-screen activity and notification for $eventId")

        } catch (e: Exception) {
            Log.e(TAG, "Error in ReachAlarmReceiver: ${e.message}", e)
        } finally {
            if (wakeLock.isHeld) {
                wakeLock.release()
            }
        }
    }

    private fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val callSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)

            val audioAttrCall = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val audioAttrAlarm = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val callChannel = NotificationChannel(
                CHANNEL_CALLS,
                "MOBOT Call Reminders",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Incoming call-like reminder alerts from MOBOT"
                setSound(callSound, audioAttrCall)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 800, 800)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }

            val alarmChannel = NotificationChannel(
                CHANNEL_ALARMS,
                "MOBOT Alarms",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Audible alarms and wake-up alerts from MOBOT"
                setSound(alarmSound, audioAttrAlarm)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 800, 800)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }

            manager.createNotificationChannel(callChannel)
            manager.createNotificationChannel(alarmChannel)
        }
    }

    companion object {
        const val TAG = "ReachAlarmReceiver"
        const val CHANNEL_CALLS = "reach_calls_channel"
        const val CHANNEL_ALARMS = "reach_alarms_channel"
        const val NOTIFICATION_BASE_ID = 900000
    }
}

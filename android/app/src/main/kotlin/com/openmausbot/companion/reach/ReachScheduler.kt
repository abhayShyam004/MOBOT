package com.openmausbot.companion.reach

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Native Android scheduler managing exact alarms via [AlarmManager].
 *
 * Guarantees that the Android OS owns the scheduled trigger:
 * - Uses [AlarmManager.setAlarmClock] with fallback to [AlarmManager.setExactAndAllowWhileIdle].
 * - Functions when screen is off, device is in Doze, application interface is closed,
 *   and Node.js agent runtime is stopped.
 */
class ReachScheduler(private val context: Context) {

    private val store = ReachStore.getInstance(context)
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    fun isExactAlarmPermitted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }
    }

    /**
     * Schedules a verified [ReachEvent] with Android AlarmManager.
     */
    fun schedule(event: ReachEvent): Boolean {
        val now = System.currentTimeMillis()
        if (event.triggerTimeMs <= now - 10_000L) {
            Log.w(TAG, "Refusing to schedule event ${event.id} in the past (trigger=${event.triggerTimeMs}, now=$now)")
            return false
        }

        // Persist first to ensure durability before OS registration
        val savedEvent = store.saveEvent(event.copy(state = ReachEventState.SCHEDULED))

        val intent = Intent(context, ReachAlarmReceiver::class.java).apply {
            action = ACTION_REACH_TRIGGER
            putExtra(EXTRA_EVENT_ID, savedEvent.id)
            putExtra(EXTRA_EVENT_TYPE, savedEvent.type.name)
            putExtra(EXTRA_EVENT_TITLE, savedEvent.title)
        }

        val requestCode = getRequestCode(savedEvent.id)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        try {
            // Build show intent (user tap on alarm clock icon opens ReachActivity)
            val showIntent = Intent(context, ReachActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_EVENT_ID, savedEvent.id)
            }
            val showPendingIntent = PendingIntent.getActivity(
                context,
                requestCode,
                showIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val alarmClockInfo = AlarmManager.AlarmClockInfo(savedEvent.triggerTimeMs, showPendingIntent)
            alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)
            Log.i(TAG, "Successfully scheduled AlarmClock trigger for ${savedEvent.id} (${savedEvent.type}) at ${savedEvent.triggerTimeMs}")
            return true
        } catch (e: SecurityException) {
            Log.w(TAG, "setAlarmClock SecurityException, falling back to setExactAndAllowWhileIdle: ${e.message}")
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        savedEvent.triggerTimeMs,
                        pendingIntent
                    )
                } else {
                    alarmManager.setExact(
                        AlarmManager.RTC_WAKEUP,
                        savedEvent.triggerTimeMs,
                        pendingIntent
                    )
                }
                Log.i(TAG, "Scheduled exact fallback trigger for ${savedEvent.id} at ${savedEvent.triggerTimeMs}")
                true
            } catch (fallbackEx: Exception) {
                Log.e(TAG, "Failed to schedule exact alarm: ${fallbackEx.message}", fallbackEx)
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error scheduling alarm for ${savedEvent.id}: ${e.message}", e)
            return false
        }
    }

    /**
     * Cancels a pending reach event and removes its Android AlarmManager trigger.
     */
    fun cancel(eventId: String): Boolean {
        val existing = store.getEvent(eventId)
        if (existing == null) {
            Log.w(TAG, "Cannot cancel unknown reach event $eventId")
            return false
        }

        val intent = Intent(context, ReachAlarmReceiver::class.java).apply {
            action = ACTION_REACH_TRIGGER
            putExtra(EXTRA_EVENT_ID, eventId)
        }
        val requestCode = getRequestCode(eventId)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        alarmManager.cancel(pendingIntent)
        store.updateState(eventId, ReachEventState.CANCELLED)
        Log.i(TAG, "Cancelled reach event $eventId and cleared AlarmManager trigger.")
        return true
    }

    /**
     * Snoozes an active reach event, rescheduling it for [snoozeMinutes] in the future.
     */
    fun snooze(eventId: String, snoozeMinutes: Int = 10): ReachEvent? {
        val existing = store.getEvent(eventId) ?: return null
        val newTriggerMs = System.currentTimeMillis() + (snoozeMinutes * 60_000L)
        val snoozedEvent = existing.copy(
            state = ReachEventState.SNOOZED,
            triggerTimeMs = newTriggerMs,
            snoozeMinutes = snoozeMinutes,
            snoozeCount = existing.snoozeCount + 1,
            updatedAtMs = System.currentTimeMillis()
        )

        val scheduled = schedule(snoozedEvent)
        return if (scheduled) snoozedEvent else null
    }

    /**
     * Reconciles persisted events after a device reboot, app update, or timezone change.
     */
    fun reconcile(): Int {
        val now = System.currentTimeMillis()
        var restoredCount = 0
        val active = store.getActiveEvents()
        Log.i(TAG, "Reconciling ${active.size} active reach events...")

        for (event in active) {
            if (event.triggerTimeMs > now) {
                // Future event: restore alarm trigger
                if (schedule(event)) {
                    restoredCount++
                }
            } else if (now - event.triggerTimeMs > 15 * 60_000L) {
                // More than 15 minutes overdue while phone was powered off: mark MISSED
                store.updateState(event.id, ReachEventState.MISSED)
                Log.w(TAG, "Marked overdue event ${event.id} as MISSED (scheduled=${event.triggerTimeMs}, now=$now)")
            } else {
                // Marginally overdue (<= 15 min): trigger promptly
                store.updateState(event.id, ReachEventState.RINGING)
                val triggerIntent = Intent(context, ReachAlarmReceiver::class.java).apply {
                    action = ACTION_REACH_TRIGGER
                    putExtra(EXTRA_EVENT_ID, event.id)
                }
                context.sendBroadcast(triggerIntent)
                restoredCount++
            }
        }
        return restoredCount
    }

    companion object {
        const val TAG = "ReachScheduler"
        const val ACTION_REACH_TRIGGER = "com.openmausbot.companion.reach.TRIGGER_EVENT"
        const val EXTRA_EVENT_ID = "reach_event_id"
        const val EXTRA_EVENT_TYPE = "reach_event_type"
        const val EXTRA_EVENT_TITLE = "reach_event_title"

        @Volatile
        private var instance: ReachScheduler? = null

        fun getInstance(context: Context): ReachScheduler {
            return instance ?: synchronized(this) {
                instance ?: ReachScheduler(context.applicationContext).also { instance = it }
            }
        }

        fun getRequestCode(eventId: String): Int {
            return eventId.hashCode() and 0x7FFFFFFF
        }
    }
}

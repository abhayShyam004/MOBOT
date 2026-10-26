package com.openmausbot.companion.reach

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.util.Log

/**
 * Reconciles and restores pending MOBOT Reach alarms after a device reboot,
 * package update, or system clock/timezone change.
 */
class ReachBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.i(TAG, "Received lifecycle broadcast: $action")

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "MOBOT:ReachBootReceiverWakeLock"
        )
        wakeLock.acquire(15_000L)

        try {
            val scheduler = ReachScheduler.getInstance(context)
            val restored = scheduler.reconcile()
            Log.i(TAG, "Reconciled $restored pending reach events on $action.")
        } catch (e: Exception) {
            Log.e(TAG, "Error reconciling reach alarms on $action: ${e.message}", e)
        } finally {
            if (wakeLock.isHeld) {
                wakeLock.release()
            }
        }
    }

    companion object {
        const val TAG = "ReachBootReceiver"
    }
}

package com.openmausbot.companion.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import android.app.ForegroundServiceStartNotAllowedException
import com.openmausbot.companion.OpenMausApp
import com.openmausbot.companion.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Keeps the embedded MOBOT host alive independently of any Activity.
 *
 * This is the Android counterpart of the desktop app's process: the agent
 * runtime must survive screen off, app backgrounding, and Activity
 * recreation, which on modern Android means a foreground service with a
 * visible, silent, ongoing notification. The notification is the cost of the
 * capability, not a bug to hide.
 *
 * Started when the standalone host is wanted (first launch after seeding),
 * `START_STICKY` so the OS re-creates it after a kill, and [HarnessHost]'s
 * own restart policy handles process-level crashes.
 */
class HarnessService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        promoteToForeground("Starting the local host…")
        val app = application as OpenMausApp
        app.appScope.launch {
            app.harnessHost.status.collect { status ->
                when (status) {
                    is HostStatus.Running ->
                        promoteToForeground("MOBOT local host running (port ${status.port})")
                    is HostStatus.Failed -> {
                        promoteToForeground("Host failed: ${status.reason}")
                        // The host is down and retries are exhausted: stop
                        // foreground so the notification can be dismissed.
                        // The service itself stays until explicitly stopped.
                        stopForeground(STOP_FOREGROUND_DETACH)
                    }
                    else -> Unit
                }
            }
        }
        app.appScope.launch { app.harnessHost.start() }
        return START_STICKY
    }

    /**
     * Foreground promotion must never kill the process. Two Android
     * realities make the plain `startForeground` call dangerous:
     *
     * 1. On Android 12+ a promotion can be rejected outright (e.g. the
     *    dataSync FGS quota is exhausted, or the restriction is temporarily
     *    enforced while the app is backgrounded). An unhandled
     *    ForegroundServiceStartNotAllowedException from the supervisor's
     *    status collector crashes the whole app — host, turns, browser
     *    sessions and all — which is strictly worse than running without a
     *    foreground promotion. Catch it and keep the host alive; Android
     *    re-asserts the promotion on the next START_STICKY restart or when
     *    the user next opens the app.
     * 2. dataSync has a ~6h/24h runtime budget on Android 15+. When that
     *    budget is gone, fall back to `specialUse` (any API level that
     *    knows it; the manifest declares both types): the host genuinely is
     *    a special-use long-running local service, and the notification
     *    stays visible either way. If even that is refused, the service
     *    keeps the host running as a background service until the process
     *    is otherwise reaped — degraded persistence, not a dead app.
     */
    private fun promoteToForeground(text: String) {
        val notification = buildNotification(text)
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } catch (e: ForegroundServiceStartNotAllowedException) {
                    try {
                        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                    } catch (e2: ForegroundServiceStartNotAllowedException) {
                        Log.w(TAG, "foreground promotion refused (dataSync + specialUse); continuing without", e2)
                    }
                }
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // Never let a promotion failure crash the app (see kdoc).
            Log.w(TAG, "foreground promotion failed; continuing without", e)
        }
    }

    override fun onDestroy() {
        val app = application as OpenMausApp
        // stopWithTask=false means this may be the user swiping the task away
        // with the host still wanted; the service dies with the process there
        // anyway, so only an explicit stopService reaches here under control.
        app.appScope.launch { app.harnessHost.stop() }
        // An explicit stop of the host means this phone is no longer hosting the
        // bots' computer, so no terminal outlives it: hang every program up,
        // release every PTY, and leave no orphan behind when the process goes.
        // (Nothing here touches a session while the app merely backgrounds —
        // that is the whole point of owning them at application scope.)
        app.appScope.launch(Dispatchers.IO) {
            runCatching { app.terminalSessions.closeAll() }
                .onFailure { Log.w(TAG, "closing terminals at shutdown failed", it) }
        }
        super.onDestroy()
    }

    private fun buildNotification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_maus_mark)
            .setContentTitle(getString(R.string.host_notification_title))
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val system = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_host),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_host_desc)
            setShowBadge(false)
        }
        system.createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "HarnessService"
        const val CHANNEL_ID = "host_status"
        const val NOTIFICATION_ID = 2

        fun start(context: Context) {
            androidx.core.content.ContextCompat.startForegroundService(
                context,
                Intent(context, HarnessService::class.java),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, HarnessService::class.java))
        }
    }
}

package com.openmausbot.companion.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.openmausbot.companion.R
import com.openmausbot.companion.core.NotificationFrame
import com.openmausbot.companion.core.NotificationSink

/**
 * Local-only notifications from live/replayed notify frames. No FCM.
 * PendingIntent carries both `botId` and `threadId` — the same pair iOS puts
 * in `userInfo` — so a tap opens the exact task (the one allowed quality
 * delta vs iOS, which only presents the banner).
 *
 * Frames are not notifications. One frame arrives per settled reply, and posting
 * each one is how the shade ends up with a hundred rows for one conversation, so
 * every frame goes through [NotificationAggregator] first: one conversation, one
 * notification, updated in place, silent while the person is reading it. The
 * policy is pure and tested on its own; what lives here is the Android glue —
 * channels, the builder, and the cancel that opening a chat has to perform.
 */
class LocalNotificationPoster(
    context: Context,
) : NotificationSink, NotificationVisibility {
    private val appContext = context.applicationContext
    private val manager = NotificationManagerCompat.from(appContext)
    private val aggregator = NotificationAggregator()

    init {
        ensureChannels()
    }

    override fun deliver(notification: NotificationFrame, sequence: Int?) {
        if (!canPost()) return
        when (val effect = aggregator.onFrame(notification, visibility.visibleThreadId, visibility.foreground)) {
            NoticeEffect.None -> return
            is NoticeEffect.Cancel -> manager.cancel(effect.id)
            is NoticeEffect.Post -> post(effect.notice, effect.id)
        }
    }

    // ---------------------------------------------------------------- policy

    /**
     * Where the person is, and whether they are here at all. Read on every
     * frame, so suppression is decided against the moment the frame arrives
     * rather than against whenever a state flow last emitted.
     */
    private val visibility = ChatVisibility()

    override fun showing(threadId: String) {
        visibility.showing(threadId)
        // Opening the conversation is the end of its notification. Only the
        // notice changes here — the id stays allocated, so a conversation the
        // person reads and leaves again is announced in the same slot. Marking
        // the thread read is `Session.markRead`, which the chat screen already
        // does; this is the shade's half of that same moment.
        aggregator.forget(threadId)?.let(manager::cancel)
    }

    override fun hidden() = visibility.hidden()

    override fun setForeground(foreground: Boolean) = visibility.setForeground(foreground)

    /** For tests and for the diagnostics screen: what the shade is holding. */
    fun standingNotices(): List<ConversationNotice> = aggregator.standing()

    // ----------------------------------------------------------------- post

    private fun post(notice: ConversationNotice, id: Int) {
        val channelId = NotificationMapping.channelId(notice.kind)
        // Identity lives in Intent data (botId + threadId), not a hashed
        // requestCode — extras alone cannot distinguish PendingIntents.
        val intent = NotificationIntents.contentIntent(appContext, notice.botId, notice.threadId, notice.kind)
        val pending = PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // The shade is SystemUI's window, so the app's reading-direction policy
        // has to travel inside the string. See NotificationText.
        val title = NotificationText.anchored(notice.title)
        val body = NotificationText.anchored(notice.body)
        val builder = NotificationCompat.Builder(appContext, channelId)
            // The app's own mark, monochrome as the status bar requires.
            .setSmallIcon(R.drawable.ic_maus_mark)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            // This conversation's own count, not the app's total: the number the
            // shade draws belongs to the notification it sits on.
            .setNumber(notice.count)
            .setPriority(
                if (notice.blocking) {
                    NotificationCompat.PRIORITY_HIGH
                } else {
                    NotificationCompat.PRIORITY_DEFAULT
                },
            )
            .setCategory(
                when (notice.kind) {
                    "approval", "question" -> NotificationCompat.CATEGORY_ALARM
                    "routine-failed" -> NotificationCompat.CATEGORY_ERROR
                    else -> NotificationCompat.CATEGORY_MESSAGE
                },
            )
        try {
            manager.notify(id, builder.build())
        } catch (_: SecurityException) {
            // Permission can be revoked between canPost() and notify(). A missed
            // local banner is safer than crashing the live companion session.
        }
    }

    override fun setBadge(count: Int) {
        // No universal launcher-badge API without a posted notification. Unread
        // count is attached via setNumber on real notify posts; badge-only updates
        // are a no-op so we never leave a phantom notification in the shade.
        lastBadge = maxOf(0, count)
    }

    @Volatile
    var lastBadge: Int = 0
        private set

    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val system = appContext.getSystemService(NotificationManager::class.java) ?: return

        // Re-creating a channel that already exists is supposed to be a no-op
        // for anything but name/description, but a plain process restart on
        // Kate's S26+ (2026-09-09) reset a custom sound she had picked for
        // `bot_messages` — the channel's own mUserLockedFields showed
        // visibility+lights locked but *not* sound, so this call's freshly
        // built (soundless) NotificationChannel object was silently winning.
        // Only ever create each channel once; leave an existing one alone,
        // full stop, so nothing this call passes can clobber a real pick.
        if (system.getNotificationChannel(NotificationMapping.CHANNEL_BLOCKING) == null) {
            system.createNotificationChannel(
                NotificationChannel(
                    NotificationMapping.CHANNEL_BLOCKING,
                    appContext.getString(R.string.notification_channel_blocking),
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = appContext.getString(R.string.notification_channel_blocking_desc)
                },
            )
        }

        if (system.getNotificationChannel(NotificationMapping.CHANNEL_DONE) == null) {
            // The legacy channel could only ever be at DEFAULT or something the
            // user explicitly lowered it to in system settings (Android caps a
            // channel at what the app first declared, so DEFAULT is the
            // ceiling). A lower importance is therefore a deliberate mute, not
            // a default — starting fresh at HIGH would silently override that
            // choice. Carry it forward; only a fresh install or an untouched
            // legacy channel gets the HIGH bump Kate asked for. This whole
            // branch only runs the one time `bot_messages` doesn't exist yet,
            // so it can't re-fire on every launch and re-decide anything.
            val legacyDone = system.getNotificationChannel(LEGACY_CHANNEL_DONE)
            val doneImportance = if (legacyDone != null &&
                legacyDone.importance < NotificationManager.IMPORTANCE_DEFAULT
            ) {
                legacyDone.importance
            } else {
                // HIGH so this pops up (heads-up banner + lock screen) with sound,
                // the way a normal messaging app does — DEFAULT only shows quietly
                // in the shade. Kate's ask (2026-09-08): every bot message, not just
                // approvals, should read as "interesting app noise" rather than sit
                // unnoticed until she happens to pull the shade down.
                NotificationManager.IMPORTANCE_HIGH
            }
            system.createNotificationChannel(
                NotificationChannel(
                    NotificationMapping.CHANNEL_DONE,
                    appContext.getString(R.string.notification_channel_done),
                    doneImportance,
                ).apply {
                    description = appContext.getString(R.string.notification_channel_done_desc)
                    // Importance isn't the only thing a person can customize on a
                    // channel — a picked sound, an intentionally silent one
                    // (sound=null), vibration, and lock-screen visibility all
                    // deserve the same carry-forward as importance above: copy
                    // them straight off the legacy channel rather than letting
                    // this constructor's plain defaults silently win. A fresh
                    // install has no legacy channel, so this is a no-op there.
                    if (legacyDone != null) {
                        setSound(legacyDone.sound, legacyDone.audioAttributes)
                        enableVibration(legacyDone.shouldVibrate())
                        vibrationPattern = legacyDone.vibrationPattern
                        lockscreenVisibility = legacyDone.lockscreenVisibility
                    }
                },
            )
        }
        // The old channel this replaced. Deleting it (rather than leaving it
        // orphaned) keeps Settings -> App notifications from showing a dead
        // "Finished work" entry alongside the new one; harmless no-op once
        // it's already gone.
        system.deleteNotificationChannel(LEGACY_CHANNEL_DONE)

        if (system.getNotificationChannel(NotificationMapping.CHANNEL_ROUTINE_FAILED) == null) {
            system.createNotificationChannel(
                NotificationChannel(
                    NotificationMapping.CHANNEL_ROUTINE_FAILED,
                    appContext.getString(R.string.notification_channel_routine),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = appContext.getString(R.string.notification_channel_routine_desc)
                },
            )
        }
    }

    /** True when the platform will accept a notification post right now. */
    fun canPost(): Boolean {
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** True when a runtime POST_NOTIFICATIONS request is still required. */
    fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= 33 && !canPost()

    companion object {
        const val EXTRA_THREAD_ID = "openmaus.threadId"
        const val EXTRA_BOT_ID = "openmaus.botId"
        const val EXTRA_KIND = "openmaus.kind"

        /** Permission string for the UI pass's launcher contract. */
        const val POST_NOTIFICATIONS_PERMISSION = Manifest.permission.POST_NOTIFICATIONS

        /** The channel id [NotificationMapping.CHANNEL_DONE] replaced. See its kdoc. */
        private const val LEGACY_CHANNEL_DONE = "done"
    }
}

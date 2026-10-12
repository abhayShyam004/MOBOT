package com.openmausbot.companion.notifications

import com.openmausbot.companion.core.NotificationFrame

/**
 * Pure mapping from companion notify frames to Android channel + dedupe id.
 * JVM-testable; [LocalNotificationPoster] is the Android glue.
 */
object NotificationMapping {
    const val CHANNEL_BLOCKING = "approval_question"
    /**
     * A new channel id, not "done": Android locks a channel's importance the
     * moment it is first created on a device — an app can never raise it later,
     * only the user can, in system Settings. "done" already exists at DEFAULT
     * importance on every phone with an older build installed, so making bot
     * replies pop up like a normal message (Kate's ask, 2026-09-08) requires a
     * fresh channel id rather than reconfiguring this one.
     */
    const val CHANNEL_DONE = "bot_messages"
    const val CHANNEL_ROUTINE_FAILED = "routine_failed"

    fun channelId(notification: NotificationFrame): String = channelId(notification.kind)

    /** A kind as the person's own channel wording sees it. */
    fun channelId(kind: String): String = when (kind) {
        "approval", "question" -> CHANNEL_BLOCKING
        "routine-failed" -> CHANNEL_ROUTINE_FAILED
        else -> CHANNEL_DONE
    }

    /**
     * Matches iOS: `openmaus.{threadId}.{seq}` (title fallback when seq is null).
     *
     * Android no longer posts under this id, and that is the point of
     * [NotificationAggregator]: one id per *frame* is one notification per
     * message, which is how a single reply storm filled the shade. The mapping
     * stays because it is the identifier the two platforms share — iOS
     * (`Notifications.swift:65-69`) still keys its banners on it — and because a
     * desktop-parity test asserts the shape.
     */
    fun dedupeId(notification: NotificationFrame, sequence: Int?): String {
        val suffix = sequence?.toString() ?: notification.title
        return "openmaus.${notification.threadId}.$suffix"
    }

    /**
     * One stable 31-bit notification id per conversation.
     *
     * Derived from the thread id rather than from a counter, so a process that
     * restarts — and therefore has no memory of what it posted — updates the
     * slot the previous process used instead of dropping a second, identical
     * notification beside it. [NotificationAggregator] probes past a collision;
     * this is only the base.
     */
    fun notificationId(threadId: String): Int {
        var hash = 0x811c9dc5u
        for (byte in threadId.encodeToByteArray()) {
            hash = hash xor byte.toUByte().toUInt()
            hash *= 0x01000193u
        }
        return (hash and 0x7fffffffu).toInt()
    }

    fun isHighImportance(notification: NotificationFrame): Boolean = notification.isBlocking
}

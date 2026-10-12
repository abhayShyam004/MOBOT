package com.openmausbot.companion.notifications

/**
 * The half of the notification surface the UI writes to.
 *
 * A screen knows two things nothing below it can infer: which conversation is on
 * screen, and that the app is in front of the person. Both are inputs to
 * suppression, and both belong to the UI — so the UI gets a narrow interface to
 * say so, rather than the poster reaching into the navigator or the Activity
 * reaching into the poster's internals.
 *
 * The calls are cheap and idempotent; a screen may make them on every
 * destination change.
 */
interface NotificationVisibility {
    /** The person is looking at [threadId]: drop its notification, stay silent for it. */
    fun showing(threadId: String)

    /** No conversation is on screen — the roster, settings, the terminal. */
    fun hidden()

    /**
     * Whether this app is in front of a person. A chat behind the launcher is
     * not being read, so this is what keeps a backgrounded app announceable.
     */
    fun setForeground(foreground: Boolean)
}

/** For tests, previews and any caller that wants no notification surface at all. */
object NoOpNotificationVisibility : NotificationVisibility {
    override fun showing(threadId: String) = Unit
    override fun hidden() = Unit
    override fun setForeground(foreground: Boolean) = Unit
}

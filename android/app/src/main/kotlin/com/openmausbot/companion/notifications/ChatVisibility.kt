package com.openmausbot.companion.notifications

/**
 * Where the person is looking, as far as the notification surface is concerned.
 *
 * Two pieces of state, both written from the UI and read from the companion
 * stream's coroutine: the conversation that is on screen, and whether this app
 * is in front of the person at all. Suppression needs **both**. A chat that is
 * still "open" behind the launcher is not a chat anyone is reading, and muting
 * a backgrounded app would be the one thing this must never do — the stream is
 * kept alive after Home precisely so a turn finishing behind the launcher can
 * still be announced.
 *
 * Deliberately plain fields rather than flows: the only reader is
 * [LocalNotificationPoster.deliver], on the frame that just arrived, and a
 * collector in between would add a hop in which one frame could be judged
 * against state from before it.
 *
 * There is one writer — the navigator's current destination — and it writes on
 * every destination change rather than clearing on the way out. That is what
 * makes an Activity recreation safe: the destination is restored from saved
 * state, so the value the new composition writes is the one the old one held,
 * and a rotation cannot open a window in which an open chat looks abandoned.
 */
class ChatVisibility {
    @Volatile
    private var visible: String? = null

    @Volatile
    private var front = false

    /** The conversation on screen, or null when none is. */
    val visibleThreadId: String?
        get() = visible

    /** True while the process lifecycle says this app is in front of a person. */
    val foreground: Boolean
        get() = front

    /**
     * The person is looking at [threadId]. Set from the navigator, which is
     * restored from the saved stack, so an Activity recreation lands here with
     * the same conversation it had before.
     */
    fun showing(threadId: String) {
        visible = threadId
    }

    /** No conversation is on screen (roster, settings, the terminal). */
    fun hidden() {
        visible = null
    }

    fun setForeground(foreground: Boolean) {
        front = foreground
    }
}

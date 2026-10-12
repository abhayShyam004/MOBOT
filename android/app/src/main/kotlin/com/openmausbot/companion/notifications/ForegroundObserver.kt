package com.openmausbot.companion.notifications

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * Says whether this app is in front of the person, to the notification surface.
 *
 * Half of suppression, and the half no screen can answer: a conversation that is
 * still the app's current destination behind the launcher is not being read. The
 * process lifecycle is the right signal and the Activity's is not — a rotation
 * recreates the Activity, and a notification policy that read that as "the
 * person left" would announce the chat they are in the middle of reading.
 *
 * Its own class, deliberately, and `SessionLingerWiringTest` is why: the app
 * installs exactly one observer that touches the *connection* (the linger
 * coordinator), and that test refuses to let an inline observer in the
 * Application file hide a second one. This observer touches notifications only —
 * it never disconnects, never opens a window and holds no session.
 */
class ForegroundObserver(
    private val visibility: NotificationVisibility,
) : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) = visibility.setForeground(true)

    override fun onStop(owner: LifecycleOwner) = visibility.setForeground(false)
}

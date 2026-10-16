package com.openmausbot.companion.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.delay

/**
 * Whether the app is still starting up, and therefore whether "offline" is true
 * yet.
 *
 * A cold start is not an offline app. This app can host its own computer: the
 * embedded runtime takes several seconds to bind its port, so the first
 * connection attempt is *refused* before anything is wrong — and the honest
 * screen for that moment is "connecting", not a red banner and an empty roster
 * that says the workspace is empty.
 *
 * The rule is deliberately narrow, so it can never hide a real failure:
 *
 *  - it only ever applies before the session has been live once in this process.
 *    Once a connection has succeeded, an offline status is a fact and is shown
 *    immediately — a computer that went to sleep mid-session is not a startup;
 *  - and it only applies for [StartupSettle.GRACE_MILLIS]. Past that, whatever
 *    `Offline` says is shown as written, because a phone that has spent eight
 *    seconds failing to reach its computer deserves to be told.
 *
 * Nothing here changes what [Session] reports. The status flow is the truth; this
 * is only about how long the interface waits before repeating it.
 */
object StartupSettle {
    /**
     * Long enough for the embedded host to finish booting on a slow phone, short
     * enough that a genuinely unreachable computer is never hidden for long.
     */
    const val GRACE_MILLIS: Long = 8_000L

    /** The status to render, given the truth, how long it has been true, and history. */
    fun visible(
        status: Session.Status,
        everLive: Boolean,
        offlineForMillis: Long,
    ): Session.Status = when {
        status is Session.Status.Offline && !everLive && offlineForMillis < GRACE_MILLIS ->
            Session.Status.Connecting
        else -> status
    }
}

/**
 * [StartupSettle] as the screens use it: the status to draw, and whether the
 * roster should say its empty state yet.
 */
internal class SettledStatus(
    val status: Session.Status,
    /** False while the app is still finding its computer for the first time. */
    val settled: Boolean,
)

@Composable
internal fun rememberSettledStatus(status: Session.Status): SettledStatus {
    var everLive by remember { mutableStateOf(status == Session.Status.Live) }
    var offlineSince by remember { mutableStateOf<Long?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    LaunchedEffect(status, everLive) {
        if (status == Session.Status.Live) {
            everLive = true
            offlineSince = null
            return@LaunchedEffect
        }
        if (status !is Session.Status.Offline) {
            offlineSince = null
            return@LaunchedEffect
        }
        // A connection has already worked in this process: the grace window is
        // over by definition, and re-reading the clock for it would recompose
        // this screen twice a second to learn nothing.
        if (everLive) return@LaunchedEffect
        val since = offlineSince ?: System.currentTimeMillis().also { offlineSince = it }
        // A timer that re-reads the clock while the window is open, so the grace
        // period can expire without anything else on screen changing. It stops
        // once it has, which is also when the honest status takes over.
        while (System.currentTimeMillis() - since < StartupSettle.GRACE_MILLIS) {
            now = System.currentTimeMillis()
            delay(500)
        }
        now = System.currentTimeMillis()
    }

    val offlineFor = offlineSince?.let { now - it } ?: 0L
    val visible = StartupSettle.visible(status, everLive, offlineFor)
    return remember(visible, everLive) {
        SettledStatus(status = visible, settled = everLive || (visible != Session.Status.Connecting && visible !is Session.Status.Starting))
    }
}

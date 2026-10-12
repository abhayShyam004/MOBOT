package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Session
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The startup grace window, as a rule.
 *
 * The interesting cases are the two the rule must *not* swallow: a computer that
 * was reachable and then stopped, and a phone that has spent the whole window
 * failing. Both have to end up showing what the session actually reported.
 */
class StartupSettleTest {

    private val offline = Session.Status.Offline("Phone access isn't answering on port 18799.")

    @Test
    fun `a cold start reports connecting, not offline`() {
        // The embedded host is still binding its port; the first attempt is
        // refused before anything is wrong.
        assertEquals(
            Session.Status.Connecting,
            StartupSettle.visible(offline, everLive = false, offlineForMillis = 0L),
        )
        assertEquals(
            Session.Status.Connecting,
            StartupSettle.visible(offline, everLive = false, offlineForMillis = StartupSettle.GRACE_MILLIS - 1),
        )
    }

    @Test
    fun `the window closes and the honest status takes over`() {
        assertEquals(
            offline,
            StartupSettle.visible(offline, everLive = false, offlineForMillis = StartupSettle.GRACE_MILLIS),
        )
        assertEquals(
            offline,
            StartupSettle.visible(offline, everLive = false, offlineForMillis = StartupSettle.GRACE_MILLIS * 10),
        )
    }

    @Test
    fun `a session that has been live never hides a failure`() {
        // A computer going to sleep mid-session is not a startup, and pretending
        // otherwise would leave the roster looking connected while it is not.
        assertEquals(
            offline,
            StartupSettle.visible(offline, everLive = true, offlineForMillis = 0L),
        )
    }

    @Test
    fun `other statuses are passed through untouched`() {
        assertEquals(
            Session.Status.Live,
            StartupSettle.visible(Session.Status.Live, everLive = false, offlineForMillis = 0L),
        )
        assertEquals(
            Session.Status.Connecting,
            StartupSettle.visible(Session.Status.Connecting, everLive = false, offlineForMillis = 0L),
        )
        assertEquals(
            Session.Status.Unauthorized,
            StartupSettle.visible(Session.Status.Unauthorized, everLive = false, offlineForMillis = 0L),
        )
        assertEquals(
            Session.Status.Unpaired,
            StartupSettle.visible(Session.Status.Unpaired, everLive = false, offlineForMillis = 0L),
        )
    }
}

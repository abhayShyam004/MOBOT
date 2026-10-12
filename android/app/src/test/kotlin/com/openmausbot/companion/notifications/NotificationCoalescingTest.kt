package com.openmausbot.companion.notifications

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import com.openmausbot.companion.core.NotificationFrame
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * What actually lands in the shade, counted.
 *
 * The defect this is here for is a count, not a string: one notify frame per
 * settled reply, each posted under its own `openmaus.{threadId}.{seq}` id, so a
 * chatty bot produced one notification per message. A suite that asserted the
 * policy object's return values would stay green through a poster that ignored
 * them, so every test below posts through the real [LocalNotificationPoster] and
 * reads the [NotificationManager]'s own record of what it holds — how many rows,
 * under which ids, saying what.
 *
 * The acceptance test on the phone adds the half a JVM cannot: SystemUI drawing
 * those rows, and a person leaving the app for real.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotificationCoalescingTest {

    @Test
    fun `a burst of ten replies is one row, and it says ten`() {
        val scene = Scene()
        repeat(10) { index -> scene.poster.deliver(frame(body = "reply $index"), index) }

        assertEquals(1, scene.posted().size, "ten replies, one notification")
        val only = scene.posted().single()
        assertEquals(10, only.number, "the row carries this conversation's own count")
        assertEquals("Scout", only.extras.getCharSequence(Notification.EXTRA_TITLE))
        assertEquals("10 new messages", only.extras.getCharSequence(Notification.EXTRA_TEXT))
    }

    @Test
    fun `the conversation on screen gets nothing at all`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.showing(THREAD)
        repeat(50) { index -> scene.poster.deliver(frame(body = "while reading $index"), index) }

        assertEquals(0, scene.posted().size, "fifty messages read in the chat are fifty silent messages")
    }

    @Test
    fun `the same conversation behind the launcher is announced`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.showing(THREAD)
        scene.poster.deliver(frame(body = "first"), 1)
        assertEquals(0, scene.posted().size)

        // Home: the chat is still the app's current destination, and the stream
        // is deliberately still open. Silence here would be a message nobody is
        // ever told about.
        scene.poster.setForeground(false)
        scene.poster.deliver(frame(body = "finished while you were out"), 2)

        assertEquals(1, scene.posted().size)
        assertEquals(
            "finished while you were out",
            scene.posted().single().extras.getCharSequence(Notification.EXTRA_TEXT),
        )
    }

    @Test
    fun `opening the chat takes its notification out of the shade`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.deliver(frame(body = "one"), 1)
        scene.poster.deliver(frame(body = "two"), 2)
        assertEquals(1, scene.posted().size)

        scene.poster.showing(THREAD)

        assertEquals(0, scene.posted().size, "the banner for the chat being opened goes away")
        assertTrue(scene.poster.standingNotices().isEmpty(), "and the notice is forgotten")
    }

    @Test
    fun `one conversation keeps one notification across a restart`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.deliver(frame(body = "before"), 1)
        val id = NotificationMapping.notificationId(THREAD)
        assertNotNull(scene.shadow.getNotification(id), "the first process posted under the conversation's id")

        // A new process: no memory of what the last one posted, and no id map to
        // read it from. The id has to come out of the conversation's identity.
        val restarted = Scene()
        restarted.poster.setForeground(true)
        restarted.poster.deliver(frame(body = "after"), 1)

        assertEquals(1, restarted.posted().size, "no twin beside the notification already in the shade")
        assertNotNull(
            restarted.shadow.getNotification(id),
            "the restarted process updates the same slot",
        )
        assertEquals("after", restarted.posted().single().extras.getCharSequence(Notification.EXTRA_TEXT))
    }

    @Test
    fun `a rotation does not turn an open chat into a notification`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.showing(THREAD)
        scene.poster.deliver(frame(body = "before the rotation"), 1)
        assertEquals(0, scene.posted().size)

        // The Activity is recreated: the composition is torn down and built
        // again, and the destination it restores is the same conversation.
        scene.poster.hidden()
        scene.poster.showing(THREAD)
        scene.poster.deliver(frame(body = "after the rotation"), 2)

        assertEquals(0, scene.posted().size, "a rotation is not the person leaving the chat")
    }

    @Test
    fun `two bots hold two rows`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.deliver(frame(threadId = "thread-a", body = "one"), 1)
        scene.poster.deliver(frame(threadId = "thread-b", body = "two"), 2)

        assertEquals(2, scene.posted().size)
        assertNotNull(scene.shadow.getNotification(NotificationMapping.notificationId("thread-a")))
        assertNotNull(scene.shadow.getNotification(NotificationMapping.notificationId("thread-b")))
    }

    @Test
    fun `an approval keeps the row and later replies do not repaint it`() {
        val scene = Scene()
        scene.poster.setForeground(true)
        scene.poster.deliver(frame(kind = "approval", body = "rm -rf ./build"), 1)
        val approval = scene.posted().single()
        assertEquals(NotificationMapping.CHANNEL_BLOCKING, approval.channelId)
        assertEquals(NotificationCompatPriorityHigh, approval.priority)

        repeat(5) { index -> scene.poster.deliver(frame(body = "reply $index"), index + 2) }

        assertEquals(1, scene.posted().size, "the approval is not joined by a second notification")
        val now = scene.posted().single()
        assertEquals("rm -rf ./build", now.extras.getCharSequence(Notification.EXTRA_TEXT), "nor overwritten")
        assertEquals(NotificationMapping.CHANNEL_BLOCKING, now.channelId)
    }

    @Test
    fun `a notification nobody can post is not counted as one`() {
        val scene = Scene(granted = false)
        scene.poster.deliver(frame(body = "one"), 1)
        assertEquals(0, scene.posted().size, "no permission, no row — and no crash")
        assertNull(scene.shadow.getNotification(NotificationMapping.notificationId(THREAD)))
    }

    /** A real poster over a real shadowed NotificationManager. */
    private class Scene(granted: Boolean = true) {
        private val context = RuntimeEnvironment.getApplication() as Application
        private val manager = context.getSystemService(NotificationManager::class.java)
        val shadow = shadowOf(manager)
        val poster = LocalNotificationPoster(context)

        init {
            if (granted) shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
            manager.cancelAll()
        }

        fun posted(): List<Notification> = shadow.allNotifications
    }

    private fun frame(
        threadId: String = THREAD,
        body: String = "done",
        kind: String = "done",
    ) = NotificationFrame(
        kind = kind,
        botId = "scout",
        botName = "Scout",
        threadId = threadId,
        title = if (kind == "done") "Scout finished" else "Scout needs you",
        body = body,
    )

    private companion object {
        const val THREAD = "thread-1"
        const val NotificationCompatPriorityHigh = 1
    }
}

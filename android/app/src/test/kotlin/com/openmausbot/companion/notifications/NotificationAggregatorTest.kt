package com.openmausbot.companion.notifications

import com.openmausbot.companion.core.NotificationFrame
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The policy on its own, with no Android in it.
 *
 * Every rule the shade's behaviour rests on is asserted here first: what
 * suppression needs, what a burst collapses to, what a question is allowed to be
 * overwritten by, and which id a conversation owns. The Robolectric suite beside
 * this one (`NotificationCoalescingTest`) then proves the same rules survive the
 * trip through a real `NotificationManager`, where a policy that is right and a
 * poster that ignores it would look identical.
 */
class NotificationAggregatorTest {

    @Test
    fun `the conversation on screen is silent, and its notification is withdrawn`() {
        val aggregator = NotificationAggregator()
        val first = aggregator.onFrame(frame(seqBody = "one"), visibleThreadId = null, foreground = true)
        assertTrue(first is NoticeEffect.Post, "a hidden conversation is announced")

        val second = aggregator.onFrame(frame(seqBody = "two"), visibleThreadId = THREAD, foreground = true)
        assertEquals(
            NoticeEffect.Cancel(NotificationMapping.notificationId(THREAD), THREAD),
            second,
            "opening the chat takes its notification out of the shade",
        )
        assertNull(aggregator.notice(THREAD), "and forgets it, so the next message is announced afresh")
    }

    @Test
    fun `a conversation that is already silent stays silent`() {
        val aggregator = NotificationAggregator()
        repeat(50) {
            assertEquals(
                NoticeEffect.None,
                aggregator.onFrame(frame(seqBody = "noise"), visibleThreadId = THREAD, foreground = true),
                "fifty messages while reading the chat is still no notification",
            )
        }
        assertTrue(aggregator.standing().isEmpty())
    }

    @Test
    fun `the same chat behind the launcher is not being read`() {
        val aggregator = NotificationAggregator()
        val effect = aggregator.onFrame(frame(seqBody = "while you were out"), visibleThreadId = THREAD, foreground = false)
        assertTrue(
            effect is NoticeEffect.Post,
            "the stream is kept alive after Home so a turn can be announced; foreground is half the test",
        )
    }

    @Test
    fun `a burst of ten frames is one notification with the whole count`() {
        val aggregator = NotificationAggregator()
        val posts = (1..10).map { index ->
            aggregator.onFrame(frame(seqBody = "reply $index"), visibleThreadId = null, foreground = true)
        }

        assertTrue(posts.all { it is NoticeEffect.Post }, "each frame updates the same notification")
        assertTrue(
            posts.map { (it as NoticeEffect.Post).id }.toSet().size == 1,
            "one id, so the shade holds one row and the platform updates it in place",
        )
        assertEquals(1, aggregator.standing().size)
        assertEquals(10, aggregator.notice(THREAD)?.count, "the notification says how many arrived")
        assertEquals("10 new messages", aggregator.notice(THREAD)?.body)
    }

    @Test
    fun `the first frame keeps the bot's words and later ones aggregate`() {
        val aggregator = NotificationAggregator()
        val first = aggregator.onFrame(frame(seqBody = "pushed the branch"), visibleThreadId = null, foreground = true)
        assertEquals("Scout finished", (first as NoticeEffect.Post).notice.title)
        assertEquals("pushed the branch", first.notice.body)

        val second = aggregator.onFrame(frame(seqBody = "and opened a PR"), visibleThreadId = null, foreground = true)
        assertEquals("Scout", (second as NoticeEffect.Post).notice.title, "an aggregate names the conversation")
        assertEquals("2 new messages", second.notice.body, "and says how much is waiting")
        assertEquals(2, second.notice.count)
    }

    @Test
    fun `two conversations own two notification ids`() {
        val aggregator = NotificationAggregator()
        val one = aggregator.onFrame(frame(THREAD, "one"), visibleThreadId = null, foreground = true)
        val two = aggregator.onFrame(frame("thread-b", "two"), visibleThreadId = null, foreground = true)
        assertNotEquals((one as NoticeEffect.Post).id, (two as NoticeEffect.Post).id)
        assertEquals(2, aggregator.standing().size)
    }

    @Test
    fun `a question is never spoken over by the messages behind it`() {
        val aggregator = NotificationAggregator()
        val question = aggregator.onFrame(
            frame(kind = "question", seqBody = "which branch?"),
            visibleThreadId = null,
            foreground = true,
        )
        assertTrue((question as NoticeEffect.Post).notice.blocking, "a question is the actionable one")

        val behind = aggregator.onFrame(frame(seqBody = "reply while it waits"), visibleThreadId = null, foreground = true)
        assertEquals(
            NoticeEffect.None,
            behind,
            "the shade would draw the same thing, so nothing is sent — a burst behind an approval is not " +
                "one update per message",
        )
        assertEquals("which branch?", aggregator.notice(THREAD)?.body, "the question keeps the content")
        assertEquals(2, aggregator.notice(THREAD)?.count, "but the count still moves")

        val answered = aggregator.onFrame(
            frame(kind = "approval", seqBody = "rm -rf ./build"),
            visibleThreadId = null,
            foreground = true,
        )
        assertEquals(
            "rm -rf ./build",
            (answered as NoticeEffect.Post).notice.body,
            "an approval is the newer actionable one and takes the slot",
        )
        assertTrue(answered.notice.blocking)
    }

    @Test
    fun `an id is the conversation's, not the run's`() {
        val first = NotificationAggregator().onFrame(frame(seqBody = "one"), visibleThreadId = null, foreground = true)
        val second = NotificationAggregator().onFrame(frame(seqBody = "two"), visibleThreadId = null, foreground = true)
        assertEquals(
            (first as NoticeEffect.Post).id,
            (second as NoticeEffect.Post).id,
            "a restarted process updates the notification the last one posted instead of adding a twin",
        )
    }

    @Test
    fun `forget gives back the id to withdraw and nothing when there was none`() {
        val aggregator = NotificationAggregator()
        assertNull(aggregator.forget(THREAD), "nothing standing, nothing to cancel")
        aggregator.onFrame(frame(seqBody = "one"), visibleThreadId = null, foreground = true)
        assertEquals(NotificationMapping.notificationId(THREAD), aggregator.forget(THREAD))
        assertNull(aggregator.forget(THREAD), "and it is not given back twice")
    }

    @Test
    fun `a collision probes to a free slot and keeps it`() {
        // Every conversation hashing to the same slot is the worst case the
        // probe exists for; the ids must differ and stay put.
        val aggregator = NotificationAggregator(baseId = { 7 })
        val one = aggregator.onFrame(frame("thread-a", "one"), visibleThreadId = null, foreground = true)
        val two = aggregator.onFrame(frame("thread-b", "two"), visibleThreadId = null, foreground = true)
        val oneAgain = aggregator.onFrame(frame("thread-a", "three"), visibleThreadId = null, foreground = true)
        assertNotEquals((one as NoticeEffect.Post).id, (two as NoticeEffect.Post).id)
        assertEquals(one.id, (oneAgain as NoticeEffect.Post).id, "a conversation keeps the slot it was given")
    }

    private fun frame(
        threadId: String = THREAD,
        seqBody: String = "done",
        kind: String = "done",
    ) = NotificationFrame(
        kind = kind,
        botId = "scout",
        botName = "Scout",
        threadId = threadId,
        title = if (kind == "done") "Scout finished" else "Scout has a question",
        body = seqBody,
    )

    private companion object {
        const val THREAD = "thread-1"
    }
}

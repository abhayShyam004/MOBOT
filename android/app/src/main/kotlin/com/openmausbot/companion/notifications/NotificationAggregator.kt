package com.openmausbot.companion.notifications

import com.openmausbot.companion.core.NotificationFrame

/**
 * One conversation's standing notification.
 *
 * [count] is how many notify frames this conversation has contributed since its
 * notification was last cleared — the "4 new messages" the shade shows, and the
 * number attached as the notification's badge. It counts frames rather than
 * transcript rows on purpose: the frame is what the shade is told about, so a
 * count the person can check against their own unread badge would be a promise
 * this object cannot keep.
 */
data class ConversationNotice(
    val threadId: String,
    val botId: String,
    val botName: String,
    val title: String,
    val body: String,
    val kind: String,
    val blocking: Boolean,
    val count: Int,
)

/** What the poster has to do about one frame, or nothing. */
sealed interface NoticeEffect {
    /** Nothing changed that the shade would draw differently. */
    data object None : NoticeEffect

    /** Post — or update in place — this conversation's one notification. */
    data class Post(val id: Int, val notice: ConversationNotice) : NoticeEffect

    /** Take this conversation's notification out of the shade. */
    data class Cancel(val id: Int, val threadId: String) : NoticeEffect
}

/**
 * At most one notification per conversation, whatever the frame rate.
 *
 * The defect this exists for: one notify frame per settled reply, each frame
 * posted under the id `openmaus.{threadId}.{seq}` (`NotificationMapping.dedupeId`,
 * which is still what iOS keys its banners on), so a chatty bot filled the shade
 * with one notification per message and a single sign-off could ring the phone
 * fifty times.
 *
 * The rules here are the whole policy, in one place:
 *
 *  - **The conversation on screen is silent.** A frame for the thread the person
 *    is reading produces no notification at all — and clears one already in the
 *    shade for it, because that is what "opening the chat" means for a banner.
 *    Foreground is part of the test: the same thread behind the launcher is not
 *    being read.
 *  - **One chat, one notification.** A later frame for a conversation that
 *    already has one updates it. The count in the title is replaced by the
 *    aggregate (`Vega` / `4 new messages`) once there is more than one, so an
 *    update is visible rather than a repost the person cannot tell apart.
 *  - **A question or approval is never spoken over.** A blocking frame takes the
 *    notification's content and keeps it: later messages for that conversation
 *    bump the count but do not replace what the person has to act on, and never
 *    create a second notification beside it.
 *  - **Ids are stable and derived from the conversation**, so a restarted process
 *    updates the notification a previous one posted instead of adding a twin.
 *
 * Everything here is pure: no Android types, no clock, no I/O. The poster is the
 * glue, and the tests drive this directly.
 */
class NotificationAggregator(
    private val baseId: (String) -> Int = NotificationMapping::notificationId,
) {
    private val notices = LinkedHashMap<String, ConversationNotice>()
    private val ids = HashMap<String, Int>()

    /** The notification this conversation currently owns, if any. */
    fun notice(threadId: String): ConversationNotice? = notices[threadId]

    /** Every standing notification, oldest first. */
    fun standing(): List<ConversationNotice> = notices.values.toList()

    /** The id this conversation's notification uses, allocated on first ask. */
    fun idFor(threadId: String): Int = ids.getOrPut(threadId) { allocate(threadId) }

    /**
     * Judge one frame against what the person is looking at.
     *
     * @param visibleThreadId the conversation on screen, or null
     * @param foreground whether this app is in front of the person
     */
    fun onFrame(
        frame: NotificationFrame,
        visibleThreadId: String?,
        foreground: Boolean,
    ): NoticeEffect {
        if (foreground && visibleThreadId == frame.threadId) {
            val standing = notices.remove(frame.threadId)
            return if (standing == null) {
                NoticeEffect.None
            } else {
                NoticeEffect.Cancel(idFor(frame.threadId), frame.threadId)
            }
        }

        val standing = notices[frame.threadId]
        val count = (standing?.count ?: 0) + 1

        // A message may not paint over a question or an approval waiting on the
        // person. The count still moves, so the notification they eventually
        // open reports how much arrived behind it — but the shade draws the
        // same thing either way, and a burst behind an approval must not become
        // one update per message.
        if (!frame.isBlocking && standing?.blocking == true) {
            notices[frame.threadId] = standing.copy(count = count)
            return NoticeEffect.None
        }

        val next = when {
            frame.isBlocking -> ConversationNotice(
                threadId = frame.threadId,
                botId = frame.botId,
                botName = frame.botName,
                title = frame.title,
                body = frame.body,
                kind = frame.kind,
                blocking = true,
                count = count,
            )

            // The first frame keeps the frame's own words: a single notification
            // still says what the bot said.
            count == 1 -> ConversationNotice(
                threadId = frame.threadId,
                botId = frame.botId,
                botName = frame.botName,
                title = frame.title,
                body = frame.body,
                kind = frame.kind,
                blocking = false,
                count = count,
            )

            // From the second frame on, the notice aggregates: the conversation
            // and how much of it is waiting, rather than the last reply's text
            // overwritten in the same slot over and over.
            else -> ConversationNotice(
                threadId = frame.threadId,
                botId = frame.botId,
                botName = frame.botName,
                title = frame.botName,
                body = aggregateBody(count),
                kind = frame.kind,
                blocking = false,
                count = count,
            )
        }
        notices[frame.threadId] = next
        return NoticeEffect.Post(idFor(frame.threadId), next)
    }

    /**
     * The person opened this conversation: give back the id whose notification
     * must be withdrawn, and forget the notice so the next message is announced
     * afresh.
     */
    fun forget(threadId: String): Int? {
        notices.remove(threadId) ?: return null
        return idFor(threadId)
    }

    /**
     * A stable 31-bit slot per conversation, probed past any collision the
     * string hash has with a live conversation. Deterministic in the base id, so
     * a restarted process — with no live set to collide against — lands on the
     * same slot the previous one used.
     */
    private fun allocate(threadId: String): Int {
        var candidate = baseId(threadId)
        if (candidate == 0) candidate = 1
        while (ids.containsValue(candidate)) {
            candidate = if (candidate == Int.MAX_VALUE) 1 else candidate + 1
        }
        return candidate
    }

    private fun aggregateBody(count: Int): String = "$count new messages"
}

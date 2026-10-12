package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ChatPreferencesTest {
    private fun text(id: String, at: Double = 1.0): Message = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.TEXT,
        at = at,
        text = "hello",
    )

    private fun activity(id: String, at: Double = 1.0, ok: Boolean? = true): Message = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.ACTIVITY,
        at = at,
        tool = ToolActivity(name = "run", ok = ok),
    )

    /** The activity row a settled failed turn leaves: a chip plus the card. */
    private fun failure(id: String, at: Double = 1.0): Message = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.ACTIVITY,
        at = at,
        tool = ToolActivity(name = "error: Rate limit reached", ok = false),
        failure = FailureCard(
            kind = "rate_limit",
            title = "Rate limit reached",
            detail = "The provider asked this turn to slow down.",
            advice = "Wait a few seconds and retry.",
        ),
    )

    @Test
    fun fullKeepsEveryMessageAndHiddenDropsEveryActivity() {
        val messages = listOf(text("a"), activity("b"), activity("c", ok = false), text("d"))
        assertEquals(listOf("a", "b", "c", "d"), transcriptRows(messages, ActivityDetail.FULL).map { it.id })
        assertEquals(listOf("a", "d"), transcriptRows(messages, ActivityDetail.HIDDEN).map { it.id })
    }

    @Test
    fun reducedFoldsRunsButNeverFoldsFailuresOrSingleSteps() {
        val rows = transcriptRows(
            listOf(
                activity("a", at = 100.0),
                activity("b", at = 200.0),
                activity("failed", at = 300.0, ok = false),
                activity("single", at = 400.0),
                text("tail", at = 500.0),
            ),
            ActivityDetail.REDUCED,
        )

        val run = assertIs<TranscriptRow.ActivityRun>(rows[0])
        assertEquals(listOf("a", "b"), run.items.map(Message::id))
        assertEquals(100.0, run.at)
        assertEquals(200.0, run.endAt)
        assertFalse(run.running)
        assertEquals(listOf("run.a", "failed", "single", "tail"), rows.map { it.id })
        assertIs<TranscriptRow.Single>(rows[1])
        assertIs<TranscriptRow.Single>(rows[2])
    }

    @Test
    fun aFailureRowIsNeverFoldedAndNeverHidden() {
        // The turn produced no answer: the sentence explaining why is the only
        // account of what happened to the message above it, so the activity
        // setting must not swallow it — in any mode.
        val messages = listOf(text("ask"), failure("boom"), activity("step", ok = false), text("tail"))
        assertEquals(listOf("ask", "boom", "step", "tail"), transcriptRows(messages, ActivityDetail.FULL).map { it.id })
        assertEquals(listOf("ask", "boom", "step", "tail"), transcriptRows(messages, ActivityDetail.REDUCED).map { it.id })
        assertEquals(
            listOf("ask", "boom", "tail"),
            transcriptRows(messages, ActivityDetail.HIDDEN).map { it.id },
            "an ordinary failed receipt still obeys the setting; a whole-turn failure does not",
        )
    }

    @Test
    fun aFailureRowPreviewsAsItsHeadlineNotAsAChip() {
        assertEquals(
            "Rate limit reached",
            rosterPreview(listOf(failure("boom")), ActivityDetail.REDUCED),
        )
    }

    @Test
    fun reducedRunReportsRunningWhenAReceiptHasNoVerdict() {
        val row = transcriptRows(
            listOf(activity("a"), activity("b", ok = null)),
            ActivityDetail.REDUCED,
        ).single()
        assertTrue(assertIs<TranscriptRow.ActivityRun>(row).running)
    }

    @Test
    fun quickRepliesRoundTripAndDistinguishEmptyListFromEmptyStore() {
        val mine = listOf(
            QuickReply(title = "Deploy", prompt = "Deploy to staging", icon = "send"),
            QuickReply(title = "Logs", prompt = "Show logs", icon = "document"),
        )
        assertEquals(mine, QuickReply.decode(QuickReply.encode(mine)))
        assertEquals(QuickReply.DEFAULTS, QuickReply.decode(""))
        assertEquals(QuickReply.DEFAULTS, QuickReply.decode("{not json"))
        assertEquals(emptyList(), QuickReply.decode(QuickReply.encode(emptyList())))
    }

    @Test
    fun invalidQuickReplyIdsFallBackToDefaults() {
        assertEquals(
            QuickReply.DEFAULTS,
            QuickReply.decode(QuickReply.encode(listOf(QuickReply(id = " ", title = "A", prompt = "A", icon = "next")))),
        )
        assertEquals(
            QuickReply.DEFAULTS,
            QuickReply.decode(
                QuickReply.encode(
                    listOf(
                        QuickReply(id = "same", title = "A", prompt = "A", icon = "next"),
                        QuickReply(id = "same", title = "B", prompt = "B", icon = "next"),
                    ),
                ),
            ),
        )
    }

    @Test
    fun unknownActivityDetailFallsBackToReduced() {
        assertEquals(ActivityDetail.REDUCED, ActivityDetail.fromWire("unknown"))
        assertEquals(ActivityDetail.REDUCED, ActivityDetail.fromWire(null))
    }

    @Test
    fun anExplicitlyStoredChoiceStillWinsOverTheQuietDefault() {
        assertEquals(ActivityDetail.FULL, ActivityDetail.fromWire("full"))
        assertEquals(ActivityDetail.HIDDEN, ActivityDetail.fromWire("hidden"))
    }
}

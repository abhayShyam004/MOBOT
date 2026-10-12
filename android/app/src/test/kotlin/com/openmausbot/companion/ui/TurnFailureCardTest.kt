package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.FailureCard
import com.openmausbot.companion.core.GroupResponder
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.Room
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A failure card offers the actions that actually help for the failure it
 * describes, and a Retry only ever runs the request the failure belongs to.
 */
class TurnFailureCardTest {

    private val botChat = Chat.BotChat(
        Bot(
            id = "bot-1",
            threadId = "task-1",
            name = "Ziggy",
            title = "research",
            description = "",
            notifications = true,
            color = "green",
            unread = false,
            modelSelection = ModelSelection("instance-1", "model-1"),
            createdAt = 0.0,
        ),
    )

    private val roomChat = Chat.RoomChat(
        Room(
            id = "room-1",
            threadId = "room-thread",
            name = "Standup",
            memberIds = listOf("bot-1"),
            defaultResponder = GroupResponder("mentions"),
            bulletin = "",
            unread = false,
            createdAt = 0.0,
        ),
    )

    private fun card(kind: String) = FailureCard(
        kind = kind,
        title = "Title",
        detail = "Detail",
        advice = "Advice",
    )

    private fun message(
        id: String,
        role: Message.Role = Message.Role.USER,
        kind: Message.Kind = Message.Kind.TEXT,
        text: String? = "do the thing",
        failure: FailureCard? = null,
        at: Double = 1.0,
    ) = Message(id = id, role = role, kind = kind, at = at, text = text, failure = failure)

    @Test
    fun `a rate limit offers a retry and another model, not the provider's settings`() {
        assertTrue(FailureActions.retry("rate_limit"))
        assertTrue(FailureActions.changeModel(botChat, "rate_limit"))
        assertFalse(
            FailureActions.providerSettings("rate_limit"),
            "sending someone to edit a key that is fine is a wrong button",
        )
    }

    @Test
    fun `a failure of this bot's own tools offers a retry, not another model`() {
        // The bot's tools failing to start is nothing the provider or the model
        // choice can fix: retry is the move, and the alternatives would send
        // someone to change a model that was never asked.
        assertTrue(FailureActions.retry("tooling"))
        assertFalse(FailureActions.changeModel(botChat, "tooling"))
        assertFalse(FailureActions.providerSettings("tooling"))
    }

    @Test
    fun `a missing engine offers setup rather than a retry into the same wall`() {
        assertFalse(FailureActions.retry("setup"))
        assertTrue(FailureActions.providerSettings("setup"))
        assertFalse(FailureActions.changeModel(botChat, "setup"))
    }

    @Test
    fun `a rejected sign-in offers the settings that hold the key`() {
        assertTrue(FailureActions.retry("auth"))
        assertTrue(FailureActions.providerSettings("auth"))
        assertTrue(FailureActions.editKey("auth"))
        assertTrue(FailureActions.editKey("access"))
        assertFalse(FailureActions.editKey("rate_limit"))
        assertFalse(FailureActions.editKey("setup"))
        assertFalse(FailureActions.changeModel(botChat, "auth"), "the key is the fault, not the model")
    }

    @Test
    fun `a room never offers to change a model it does not have`() {
        assertTrue(FailureActions.changeModel(botChat, "quota"))
        assertFalse(FailureActions.changeModel(roomChat, "quota"))
        assertTrue(FailureActions.providerSettings("quota"), "the settings screen is still the remedy")
    }

    @Test
    fun `retry runs the last request the person made before the failure`() {
        val messages = listOf(
            message("u1", text = "first"),
            message("u2", text = "second"),
            message("boom", role = Message.Role.BOT, kind = Message.Kind.ACTIVITY, failure = card("unknown")),
        )
        assertEquals("u2", RetryPlan.sourceFor(messages, "boom")?.id)
    }

    @Test
    fun `an old failure never offers to run a message that came after it`() {
        val messages = listOf(
            message("u1", text = "first"),
            message("boom", role = Message.Role.BOT, kind = Message.Kind.ACTIVITY, failure = card("unknown")),
            message("u2", text = "a later request", at = 2.0),
        )
        assertNull(RetryPlan.sourceFor(messages, "boom"))
    }

    @Test
    fun `a request that cannot be said again is not offered as retryable`() {
        // A message with an uploaded file would either lose the file or resend
        // without it — neither is a retry of what the person asked for. The
        // attachment is the transport tag the harness stores in the prompt.
        val carried = "look at this\n<attached-image path=\"/tmp/one.png\" name=\"one.png\" />"
        val attached = listOf(
            message("u1", text = carried),
            message("boom", role = Message.Role.BOT, kind = Message.Kind.ACTIVITY, failure = card("unknown")),
        )
        assertNull(RetryPlan.sourceFor(attached, "boom"))
        // A plain request above the failure still is retryable.
        val plain = listOf(
            message("u1", text = "look at this"),
            message("boom", role = Message.Role.BOT, kind = Message.Kind.ACTIVITY, failure = card("unknown")),
        )
        assertEquals("u1", RetryPlan.sourceFor(plain, "boom")?.id)
    }

    @Test
    fun `a failure announces itself as a sentence, not as a chip`() {
        val announcement = failureAnnouncement(
            FailureCard(
                kind = "rate_limit",
                title = "Rate limit reached",
                detail = "The provider asked this turn to slow down.",
                advice = "Wait a few seconds and retry.",
            ),
        )
        assertEquals(
            "Rate limit reached. The provider asked this turn to slow down. Wait a few seconds and retry.",
            announcement,
        )
    }

    @Test
    fun `a report's payload is never the text a person reads`() {
        assertEquals(
            "upstream HTTP 429",
            ApiErrorRules.withoutPayload("upstream HTTP 429: {\"error\":{\"message\":\"slow down\",\"type\":\"rate_limit\"}}"),
        )
        assertNull(ApiErrorRules.withoutPayload("{\"error\":{\"message\":\"slow down\"}}"))
        assertEquals(
            "The engine needs a sign-in",
            ApiErrorRules.withoutPayload("The engine needs a sign-in"),
        )
        // …and the classification that uses it keeps the same guarantee.
        val classified = ApiErrorRules.classify("upstream HTTP 429: {\"error\":{\"message\":\"slow down\"}}")
        assertTrue(classified.detail == "upstream HTTP 429")
        assertFalse(classified.detail!!.contains("{"))
    }
}

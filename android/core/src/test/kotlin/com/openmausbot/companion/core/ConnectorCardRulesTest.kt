package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The card's status words are protocol values from the harness, not prose.
 * These tests pin the one rule every renderer reads: exact, case-insensitive
 * words, and an unknown word stays "still required" rather than stranding the
 * person on a blank card.
 */
class ConnectorCardRulesTest {
    private fun card(status: String, resumed: Boolean? = null, dismissed: Boolean? = null) =
        ConnectorRequestCard(
            slug = "slack",
            label = "Slack",
            description = "Connect Slack so the bot can continue",
            status = status,
            resumeKey = "rk",
            resumed = resumed,
            dismissed = dismissed,
        )

    @Test
    fun statusWordsAreExactAndCaseInsensitive() {
        assertTrue(ConnectorCardRules.isConnected(card("connected")))
        assertTrue(ConnectorCardRules.isConnected(card("Connected")))
        assertTrue(ConnectorCardRules.isAuthorizing(card(" authorizing ")))
        assertTrue(ConnectorCardRules.isFailed(card("FAILED")))

        assertFalse(ConnectorCardRules.isConnected(card("connected-ish")))
        assertFalse(ConnectorCardRules.isAuthorizing(card("")))
        assertFalse(ConnectorCardRules.isFailed(card("authorized")))
    }

    @Test
    fun anUnknownStatusStaysOnTheConnectStep() {
        // A newer harness may invent a word this build has never seen. The
        // card must still offer the sign-in step rather than render nothing.
        val unknown = card("needs_reconnect")
        assertEquals("Connect securely", ConnectorCardRules.connectActionLabel(unknown))
        assertEquals("Requested by the bot", ConnectorCardRules.progressLabel(unknown))
        assertFalse(ConnectorCardRules.isConnected(unknown))
    }

    @Test
    fun theButtonSpeaksTheCurrentStep() {
        assertEquals("Open again", ConnectorCardRules.connectActionLabel(card("authorizing")))
        assertEquals("Try again", ConnectorCardRules.connectActionLabel(card("failed")))
        assertEquals("Connect securely", ConnectorCardRules.connectActionLabel(card("required")))
        assertEquals("Waiting for sign-in", ConnectorCardRules.progressLabel(card("authorizing")).substringBefore("\u2026"))
        assertEquals("Ready to use", ConnectorCardRules.progressLabel(card("connected")))
    }

    @Test
    fun dismissalAndResumeAreExplicitBooleans() {
        assertTrue(ConnectorCardRules.isDismissed(card("required", dismissed = true)))
        assertFalse(ConnectorCardRules.isDismissed(card("required", dismissed = false)))
        assertFalse(ConnectorCardRules.isDismissed(card("required")))
        assertTrue(ConnectorCardRules.isResumed(card("connected", resumed = true)))
        assertFalse(ConnectorCardRules.isResumed(card("connected")))
        assertEquals("Not now", ConnectorCardRules.NOT_NOW)
    }

    @Test
    fun theBotGateReadsAbsentAndTrueAlike() {
        // The server's gate is `bot.composio !== false`.
        assertTrue(bot(null).isConnectedAppsAllowed())
        assertTrue(bot(true).isConnectedAppsAllowed())
        assertFalse(bot(false).isConnectedAppsAllowed())
    }

    private fun bot(composio: Boolean?) = Bot(
        id = "b1",
        threadId = "t1",
        name = "Mira",
        title = "",
        description = "",
        notifications = true,
        color = "blue",
        unread = false,
        modelSelection = ModelSelection("i", "m"),
        createdAt = 1.0,
        composio = composio,
    )
}

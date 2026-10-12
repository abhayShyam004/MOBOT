package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals

class BotMoodRulesTest {

    @Test
    fun `resolves ready by default when idle`() {
        val mood = BotMoodRules.resolve(busy = false)
        assertEquals(BotMood.READY, mood)
    }

    @Test
    fun `resolves waiting for user when pending approval`() {
        val mood = BotMoodRules.resolve(busy = false, hasPendingApproval = true)
        assertEquals(BotMood.WAITING_FOR_USER, mood)
    }

    @Test
    fun `resolves thinking when busy with reasoning`() {
        val mood = BotMoodRules.resolve(busy = true, hasReasoning = true)
        assertEquals(BotMood.THINKING, mood)
    }

    @Test
    fun `resolves researching when busy with search tool`() {
        val mood = BotMoodRules.resolve(busy = true, toolName = "web_search")
        assertEquals(BotMood.RESEARCHING, mood)
    }

    @Test
    fun `resolves working when busy without specific tool`() {
        val mood = BotMoodRules.resolve(busy = true)
        assertEquals(BotMood.WORKING, mood)
    }

    @Test
    fun `resolves paused when explicitly paused`() {
        val mood = BotMoodRules.resolve(busy = true, isPaused = true)
        assertEquals(BotMood.PAUSED, mood)
    }

    @Test
    fun `resolves failed on failure message`() {
        val failMsg = Message(
            id = "m1",
            role = Message.Role.BOT,
            kind = Message.Kind.ACTIVITY,
            at = 123.0,
            text = "Error occurred",
            failure = FailureCard(
                kind = "auth",
                title = "Authentication failed",
                detail = "Invalid API key",
                advice = "Update API key",
            ),
        )
        val mood = BotMoodRules.resolve(busy = false, lastMessage = failMsg)
        assertEquals(BotMood.FAILED, mood)
    }

    @Test
    fun `resolves completed when turn finished with task complete`() {
        val completeMsg = Message(
            id = "m2",
            role = Message.Role.BOT,
            kind = Message.Kind.TEXT,
            at = 124.0,
            text = "Task complete\nCreated 3 files and ran verification.",
        )
        val mood = BotMoodRules.resolve(busy = false, lastMessage = completeMsg)
        assertEquals(BotMood.COMPLETED, mood)
    }
}

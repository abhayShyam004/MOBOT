package com.openmausbot.companion.ui

import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.Chat
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The roster long-press's heavier second action: deleting the agent itself,
 * not just the conversation. Blocked while anything of the bot's is running;
 * never offered for rooms; the confirmation names the agent, never a thread.
 */
class DeleteChatRulesTest {

    private fun chat(
        busy: Boolean? = null,
        tasks: List<BotTask>? = null,
    ): Chat.BotChat = Chat.BotChat(
        bot(id = "scout", busy = busy).copy(threadId = "t1", tasks = tasks),
    )

    @Test
    fun `an idle agent may be deleted`() {
        assertTrue(DeleteChatRules.canDeleteBot(chat(tasks = listOf(BotTask("t1", "First", 0.0)))))
    }

    @Test
    fun `a legacy bot is gated by the bot-level flag alone`() {
        val tasks = listOf(BotTask("t1", "First", 0.0), BotTask("t2", "Second", 1.0))
        assertFalse(DeleteChatRules.canDeleteBot(chat(busy = true, tasks = tasks)))
        assertTrue(DeleteChatRules.canDeleteBot(chat(busy = false, tasks = tasks)))
        // Absent (an older harness) reads as not busy, like the task rules read it.
        assertTrue(DeleteChatRules.canDeleteBot(chat(busy = null, tasks = tasks)))
    }

    @Test
    fun `any busy task blocks deletion for modern per-thread bots`() {
        assertFalse(
            DeleteChatRules.canDeleteBot(
                chat(tasks = listOf(BotTask("t1", "First", 0.0, busy = true), BotTask("t2", "Second", 1.0))),
            ),
        )
        assertFalse(
            DeleteChatRules.canDeleteBot(chat(tasks = listOf(BotTask("t2", "Second", 1.0, busy = true)))),
        )
    }

    @Test
    fun `a single idle thread still allows agent deletion, unlike thread deletion`() {
        val only = listOf(BotTask("t1", "Only", 0.0))
        assertTrue(DeleteChatRules.canDeleteBot(chat(tasks = only)))
        assertFalse(DeleteChatRules.canDelete(chat(tasks = only)))
    }

    @Test
    fun `rooms are never deletable as agents`() {
        val group = Chat.RoomChat(
            room().copy(threadId = "t1", tasks = listOf(BotTask("t1", "First", 0.0))),
        )
        assertFalse(DeleteChatRules.canDeleteBot(group))
    }

    @Test
    fun `the confirmation names the agent, never the thread`() {
        assertEquals("Scout", DeleteChatRules.botTitle(chat()))
        assertEquals(
            "Plan the launch",
            DeleteChatRules.title(chat(tasks = listOf(BotTask("t1", "Plan the launch", 0.0)))),
        )
    }
}

package com.openmausbot.companion.core

/**
 * User-facing bot mood and status states for MOBOT.
 *
 * Provides calm, high-level status (ready, thinking, researching, waiting for user,
 * working, paused, completed, failed) without exposing internal chain-of-thought
 * or flooding the conversation with noisy per-tool log traces.
 */
enum class BotMood(val label: String) {
    READY("Ready"),
    THINKING("Thinking…"),
    RESEARCHING("Researching…"),
    WAITING_FOR_USER("Waiting for you"),
    WORKING("Working…"),
    PAUSED("Paused"),
    COMPLETED("Completed"),
    FAILED("Attention needed"),
}

object BotMoodRules {
    /**
     * Resolves the subtle, user-facing mood state from current session and transcript context.
     */
    fun resolve(
        busy: Boolean,
        hasPendingApproval: Boolean = false,
        hasReasoning: Boolean = false,
        toolName: String? = null,
        lastMessage: Message? = null,
        isPaused: Boolean = false,
    ): BotMood {
        if (isPaused) return BotMood.PAUSED
        if (hasPendingApproval) return BotMood.WAITING_FOR_USER
        if (busy) {
            val tool = toolName?.lowercase()?.trim().orEmpty()
            if (tool.contains("search") || tool.contains("browse") || tool.contains("fetch") || tool.contains("web") || tool.contains("query")) {
                return BotMood.RESEARCHING
            }
            if (hasReasoning) return BotMood.THINKING
            return BotMood.WORKING
        }
        if (lastMessage?.failure != null || (lastMessage?.kind == Message.Kind.ACTIVITY && lastMessage.tool?.ok == false)) {
            return BotMood.FAILED
        }
        val text = lastMessage?.text?.lowercase()?.trim().orEmpty()
        if (text.startsWith("task complete") || text.startsWith("done.") || text.contains("completed successfully")) {
            return BotMood.COMPLETED
        }
        return BotMood.READY
    }
}

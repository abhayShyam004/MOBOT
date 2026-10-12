package com.openmausbot.companion.ui

import com.openmausbot.companion.core.AskQuestion
import com.openmausbot.companion.core.AskQuestionOption
import com.openmausbot.companion.core.AskQuestionRules
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.QuestionRequestCardData
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Which card a transcript row draws.
 *
 * The mistake this guards is the one the desktop shipped: a structured ask
 * routed to the approval card, offering Deny / Always allow / Allow once over
 * a question that has no such answer.
 */
class QuestionCardRulesTest {
    private fun message(card: OptionCard?): Message = Message(
        id = "m-1",
        role = Message.Role.BOT,
        kind = Message.Kind.OPTIONS,
        at = 1.0,
        card = card,
    )

    private val questions = listOf(
        AskQuestion(
            question = "Which model?",
            header = "Model",
            options = listOf(AskQuestionOption("Opus"), AskQuestionOption("Gemini")),
        ),
        AskQuestion(question = "Which style?", options = listOf(AskQuestionOption("Terse"))),
    )

    private fun card(questionRequest: QuestionRequestCardData?, tool: String? = null) = OptionCard(
        title = "t",
        subtitle = "s",
        options = emptyList(),
        requestId = "req-1",
        tool = tool,
        questionRequest = questionRequest,
    )

    @Test
    fun `a structured ask draws the question card`() {
        assertTrue(
            QuestionCardRules.drawsQuestionCard(
                message(card(QuestionRequestCardData(questions = questions))),
            ),
        )
    }

    @Test
    fun `an approval keeps the ordinary card`() {
        assertFalse(QuestionCardRules.drawsQuestionCard(message(card(null, tool = "Bash"))))
        assertFalse(QuestionCardRules.drawsQuestionCard(message(null)))
        assertFalse(
            QuestionCardRules.drawsQuestionCard(message(card(QuestionRequestCardData(questions = emptyList())))),
            "a payload with no questions has nothing to draw",
        )
    }

    @Test
    fun `tabs fall back to a number only where the model named nothing`() {
        assertEquals(listOf("Model", "Question 2"), QuestionCardRules.tabLabels(questions))
    }

    // ── typed questions (v2, mirror of shared/ask-question.ts) ──────────────

    @Test
    fun `a v2 single_choice keeps its rows and allowsOther`() {
        val question = AskQuestion(
            question = "Which layout?",
            options = listOf(
                AskQuestionOption("By project", detail = "Keep each project together"),
                AskQuestionOption("By date"),
            ),
            allowOther = true,
        )
        assertTrue(AskQuestionRules.allowsOther(question))
        val ids = AskQuestionRules.optionIds(question)
        assertEquals("by_project", ids[0])
        assertEquals("by_date", ids[1])
        assertEquals("other", ids.last())
        assertEquals(3, ids.size)
    }

    @Test
    fun `a v2 multiple_choice honors min and maxSelections`() {
        val question = AskQuestion(
            question = "Which providers to enable?",
            multiSelect = true,
            options = listOf(AskQuestionOption("OpenAI"), AskQuestionOption("Qwen"), AskQuestionOption("Google")),
            minSelections = 1,
            maxSelections = 2,
            allowOther = false,
        )
        assertEquals(AskQuestionRules.TYPE_MULTI, AskQuestionRules.type(question))
        assertEquals(1, AskQuestionRules.minSelections(question))
        assertEquals(2, AskQuestionRules.maxSelections(question))
        // ids come from the label slug, without any prefix
        assertEquals(listOf("openai", "qwen", "google"), AskQuestionRules.resolvedOptionIds(question))
        assertFalse(AskQuestionRules.allowsOther(question))
        assertNull(AskQuestionRules.validate(question, listOf("openai", "qwen"), ""))
        assertNull(AskQuestionRules.validate(question, listOf("openai"), "")) // one pick meets min=1
        assertEquals("Choose an answer first.", AskQuestionRules.validate(question, emptyList(), ""))
        assertEquals("Choose at most 2.", AskQuestionRules.validate(question, listOf("openai", "qwen", "google"), ""))
        assertEquals("That choice is no longer on the list.", AskQuestionRules.validate(question, listOf("openai", "not_on_list"), ""))
        // a floor above one is quoted in its own words
        val pair = AskQuestion(
            question = "Pick two providers.",
            multiSelect = true,
            options = listOf(AskQuestionOption("OpenAI"), AskQuestionOption("Qwen"), AskQuestionOption("Google")),
            minSelections = 2,
            maxSelections = 3,
        )
        assertEquals("Choose at least 2.", AskQuestionRules.validate(pair, listOf("openai"), ""))
    }

    @Test
    fun `a v2 confirmation resolves to the reserved id pair`() {
        val question = AskQuestion(
            question = "Delete the selected bot and all of its local data?",
            type = AskQuestionRules.TYPE_CONFIRM,
            options = emptyList(),
            allowOther = false,
        )
        assertEquals(AskQuestionRules.TYPE_CONFIRM, AskQuestionRules.type(question))
        assertEquals(2, AskQuestionRules.optionIds(question).size)
        assertEquals(listOf("confirmed", "declined"), AskQuestionRules.optionIds(question))
        assertEquals(0, AskQuestionRules.resolvedOptionIds(question).size) // the pair is in optionIds, not resolvedOptionIds
        assertNull(AskQuestionRules.validate(question, listOf("confirmed"), ""))
        assertNull(AskQuestionRules.validate(question, listOf("declined"), ""))
        // a required yes/no cannot be sent untouched
        assertEquals("Choose Confirm or Cancel.", AskQuestionRules.validate(question, emptyList<String>(), ""))
    }

    @Test
    fun `a v2 free_text needs text when required, nothing when optional`() {
        val required = AskQuestion(
            question = "Describe the behavior you want.",
            type = AskQuestionRules.TYPE_FREE,
            required = true,
        )
        assertEquals(AskQuestionRules.TYPE_FREE, AskQuestionRules.type(required))
        assertTrue(required.options.isEmpty())
        assertFalse(AskQuestionRules.allowsOther(required))
        assertEquals("Write an answer first.", AskQuestionRules.validate(required, emptyList(), ""))
        assertEquals(AskQuestionRules.TYPE_FREE, AskQuestionRules.type(required))
        assertNull(AskQuestionRules.validate(required, emptyList<String>(), "Retry with backoff"))
        val singleChoiceWithTooManyRows = AskQuestion(
            question = "Q",
            options = listOf(AskQuestionOption("A")),
            maxSelections = 999,
        )
        assertEquals("Choose only one.", AskQuestionRules.validate(singleChoiceWithTooManyRows, listOf("a", "other"), "x"))
    }

    @Test
    fun `colliding labels and ids each stay unique`() {
        // The model's own id wins; a row without one slugs its label, and a
        // repeat of either is suffixed so one id names one row.
        val question = AskQuestion(
            question = "Q",
            options = listOf(
                AskQuestionOption("Apple"),
                AskQuestionOption("Apple"),
                AskQuestionOption("Apple", id = "apple_id"),
                AskQuestionOption("Banana"),
            ),
            allowOther = false,
        )
        val ids = AskQuestionRules.resolvedOptionIds(question)
        // "Apple" -> apple, the repeat -> apple_2, the explicit id is kept,
        // "Banana" -> banana.
        assertEquals(listOf("apple", "apple_2", "apple_id", "banana"), ids)
    }

    @Test
    fun `required overrides minSelections to zero when the question is optional`() {
        val question = AskQuestion(
            question = "Which providers?",
            multiSelect = true,
            options = listOf(AskQuestionOption("A"), AskQuestionOption("B")),
            minSelections = 2,
            required = false,
        )
        assertEquals(AskQuestionRules.TYPE_MULTI, AskQuestionRules.type(question))
        assertEquals(0, AskQuestionRules.minSelections(question))
        assertNull(AskQuestionRules.validate(question, emptyList(), ""))
        // no declared maxSelections on a multi means the rules' cap, not 2
        assertEquals(AskQuestionRules.MAX_SELECTIONS, AskQuestionRules.maxSelections(question))
    }
}

package com.openmausbot.companion.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Structured questions raised by a provider's own "ask the human" tool —
 * Claude's built-in `AskUserQuestion`.
 *
 * A port of `shared/ask-question.ts`, kept in step with
 * `ios/Sources/CompanionCore/AskQuestion.swift`. The desktop re-reads that
 * tool's input into these questions and puts them on the card; the phone
 * renders them and sends back the same answer text the desktop would, so a
 * question answered here is indistinguishable from one answered on the Mac.
 *
 * Every field but the question itself is optional. These payloads are
 * bot-authored and arrive inside a transcript: a question whose shape
 * surprises us must cost one card, never the whole conversation.
 */
@Serializable
data class AskQuestionOption(
    val label: String,
    /**
     * The model's one-line gloss under the label. Named `detail` because
     * `description` collides with nothing here but reads as a Kotlin
     * `toString` hook to anyone arriving from the Swift twin.
     */
    @SerialName("description") val detail: String? = null,
    /** Stable id an answer cites. Minted from the label server-side when the
     * model did not send one, so it may be absent on a v1 payload. */
    val id: String? = null,
)

@Serializable
data class AskQuestion(
    val question: String,
    /** The short tab label the model gave this question ("Schedule", "Model"). */
    val header: String? = null,
    val multiSelect: Boolean? = null,
    /**
     * A question with no options is still answerable — the card always offers
     * free text — so a missing list is empty, not a failure.
     */
    val options: List<AskQuestionOption> = emptyList(),
    /** v2. Absent means derive: free_text with no options, multiple_choice
     * when multiSelect, else single_choice. */
    val type: String? = null,
    /** multiple_choice bounds; absent means the rules' defaults. */
    val minSelections: Int? = null,
    val maxSelections: Int? = null,
    /** false lets the card be submitted empty. Default is required. */
    val required: Boolean? = null,
    /** false removes the built-in "Other" row. Default is shown for choice
     * questions, never for free_text. */
    val allowOther: Boolean? = null,
) {
    val allowsMultiple: Boolean get() = multiSelect == true

    /**
     * What the tab shows. The model names most questions; a numbered fallback
     * keeps the tabs distinguishable when it does not.
     */
    fun tabLabel(position: Int): String = header?.takeIf { it.isNotEmpty() } ?: "Question $position"
}

@Serializable
data class QuestionRequestCardData(
    val version: Int = 1,
    val questions: List<AskQuestion> = emptyList(),
)

/**
 * The answer text, byte-for-byte what `shared/ask-question.ts` produces.
 *
 * It reaches the model as the tool's own result, so it has to stand on its
 * own: name each question, then what was picked for it.
 */
object AskQuestionAnswer {
    /**
     * The lead-in exists for the model — the answer is delivered on the
     * permission contract's deny channel, so it has to say what it is. The
     * card strips it back off when it shows a person what they sent.
     */
    const val PREAMBLE = "The user answered your questions."

    fun format(questions: List<AskQuestion>, answers: List<List<String>>): String {
        val blocks = questions.mapIndexedNotNull { index, question ->
            val picked = answers.getOrElse(index) { emptyList() }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            if (picked.isEmpty()) null else "Q: ${question.question}\nA: ${picked.joinToString(", ")}"
        }
        if (blocks.isEmpty()) return ""
        return "$PREAMBLE\n\n${blocks.joinToString("\n\n")}"
    }

    /** The same answer without the model-facing lead-in, for a settled card. */
    fun withoutPreamble(answer: String): String {
        val lead = "$PREAMBLE\n\n"
        return if (answer.startsWith(lead)) answer.removePrefix(lead) else answer
    }
}

/**
 * The typed-question rules, ported from `shared/ask-question.ts` so the phone
 * enforces exactly what the server validates: one source of truth per rule,
 * mirrored here and in the Swift twin. The card reads its whole shape from
 * these — never from the raw optional fields — so an absent v2 field and its
 * default behave identically.
 */
object AskQuestionRules {
    const val TYPE_SINGLE = "single_choice"
    const val TYPE_MULTI = "multiple_choice"
    const val TYPE_CONFIRM = "confirmation"
    const val TYPE_FREE = "free_text"

    /** The reserved id of the card's built-in "Other" row and of any
     * free-text answer. A model-provided option can never claim it. */
    const val OTHER_ID = "other"
    const val CONFIRMED_ID = "confirmed"
    const val DECLINED_ID = "declined"

    /** Upper bound on picks; matches shared/ask-question.ts MAX_SELECTIONS. */
    const val MAX_SELECTIONS = 12

    /** The cap a written answer must respect; matches MAX_CUSTOM_ANSWER. */
    const val MAX_CUSTOM_ANSWER = 2000

    /** The effective type, v1 payloads included. */
    fun type(question: AskQuestion): String = when {
        question.type != null -> question.type
        question.options.isEmpty() -> TYPE_FREE
        question.multiSelect == true -> TYPE_MULTI
        else -> TYPE_SINGLE
    }

    /** Whether the built-in "Other" row exists: any choice question without
     * allowOther:false. A free_text question IS the other field. */
    fun allowsOther(question: AskQuestion): Boolean =
        type(question) != TYPE_FREE && question.allowOther != false

    private fun required(question: AskQuestion): Boolean = question.required != false

    /** The most rows a person may tick, Other included. Single and
     * confirmation cap at one by definition; a multi honors the model's bound. */
    fun maxSelections(question: AskQuestion): Int {
        if (type(question) != TYPE_MULTI) return 1
        return (question.maxSelections ?: MAX_SELECTIONS).coerceIn(1, MAX_SELECTIONS)
    }

    /** The fewest rows a person must tick, Other included. An optional
     * question demands none, even over an explicit minSelections. */
    fun minSelections(question: AskQuestion): Int {
        if (!required(question)) return 0
        if (type(question) != TYPE_MULTI) return 1
        return (question.minSelections ?: 1).coerceIn(1, maxSelections(question))
    }

    /** Deterministic fallback so ids stay stable across replays of the same
     * ask: the same label always yields the same id. */
    private fun idFromLabel(label: String): String =
        label.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_').take(40).ifEmpty { "option" }

    /** The id each option answers under, in row order: the model's id when
     * it sent one, else a slug of the label — suffixed when two rows would
     * share one id. The built-in Other id is reserved from the start. */
    fun resolvedOptionIds(question: AskQuestion): List<String> {
        val used = mutableSetOf(OTHER_ID)
        return question.options.map { option ->
            val base = option.id ?: idFromLabel(option.label)
            var unique = base
            var n = 2
            while (unique in used) unique = "${base}_${n++}"
            used.add(unique)
            unique
        }
    }

    /** Every id an answer may cite, in row order, Other last. A confirmation
     * with no rows still offers its intrinsic pair. */
    fun optionIds(question: AskQuestion): List<String> =
        if (type(question) == TYPE_CONFIRM && question.options.isEmpty()) {
            listOf(CONFIRMED_ID, DECLINED_ID)
        } else {
            resolvedOptionIds(question) + if (allowsOther(question)) listOf(OTHER_ID) else emptyList()
        }

    /** Why the answer cannot be sent yet, in one card-sized line, or null
     * when it is complete. `selectedIds` come from [optionIds]; `freeText` is
     * the Other field's (or the question's whole) text. */
    fun validate(question: AskQuestion, selectedIds: List<String>, freeText: String): String? {
        val kind = type(question)
        val known = optionIds(question).toSet()
        if (selectedIds.any { it !in known }) return "That choice is no longer on the list."
        if (kind == TYPE_CONFIRM) {
            // The card offers exactly its two buttons, and an answer is one of
            // them. A required confirmation cannot be submitted untouched:
            // the submit button would be live while sending nothing at all.
            if (selectedIds.size > 1) return "Choose Confirm or Cancel."
            if (required(question) && selectedIds.isEmpty()) return "Choose Confirm or Cancel."
            return null
        }
        val trimmed = freeText.trim()
        if (trimmed.length > MAX_CUSTOM_ANSWER) return "Keep the written answer under $MAX_CUSTOM_ANSWER characters."
        val otherPicked = OTHER_ID in selectedIds
        if (otherPicked && trimmed.isEmpty()) return "Add your own answer beside Other, or pick one of the options."
        val total = selectedIds.size
        val max = maxSelections(question)
        if (total > max) return if (kind == TYPE_MULTI) "Choose at most $max." else "Choose only one."
        if (kind == TYPE_FREE) return if (required(question) && trimmed.isEmpty()) "Write an answer first." else null
        val min = minSelections(question)
        if (total < min) return if (min > 1) "Choose at least $min." else "Choose an answer first."
        return null
    }
}

package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.AskQuestion
import com.openmausbot.companion.core.AskQuestionAnswer
import com.openmausbot.companion.core.AskQuestionOption
import com.openmausbot.companion.core.AskQuestionRules
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.Message
import kotlinx.coroutines.launch

/**
 * The question card: what the bot actually asked, and its own answers.
 *
 * A structured ask (Claude's `AskUserQuestion`) reaches the harness through
 * the permission channel, so before this it drew the ordinary card — a flat
 * row of buttons over "which model should this bot run on?". One tap could not
 * say WHICH question it answered, so a multi-question ask had nothing tappable
 * at all and the phone could only watch it time out.
 *
 * The desktop's `src/components/QuestionCard.tsx` and its Swift twin
 * `ios/App/Cards/QuestionCardView.swift`, in Compose: a tab per question, the
 * model's options with their glosses, an "Other" row for a reply it did not
 * think of, and one submit that sends every answer at once. The answer text is
 * built by [AskQuestionAnswer.format], so an answer given here is
 * byte-for-byte the one the Mac would have sent.
 *
 * Typed questions (the ask_user tool's v2) draw from [AskQuestionRules]: a
 * single_choice is a radio group, a multiple_choice honors its min/max, a
 * confirmation offers its yes/no pair, and a free_text question is just the
 * field. Picks are tracked by option id — the stable answer — and rendered
 * back as the labels the person actually saw.
 */
@Composable
internal fun QuestionCardView(chat: Chat, message: Message, haptics: Haptics) {
    val card = message.card ?: return
    val questions = card.questions
    if (questions.isEmpty()) return

    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    // Per question: the option ids ticked, the free-text reply, and whether
    // "Other" is open. An open field with nothing in it is not an answer.
    val picked = remember(message.id) { mutableStateMapOf<Int, Set<String>>() }
    val custom = remember(message.id) { mutableStateMapOf<Int, String>() }
    val other = remember(message.id) { mutableStateMapOf<Int, Boolean>() }
    var active by remember(message.id) { mutableStateOf(0) }
    var answering by remember(message.id) { mutableStateOf(false) }
    // The harness settles the card, but only after a round trip. Holding the
    // sent answer closes the window where the buttons are still live.
    var sent by remember(message.id) { mutableStateOf<String?>(null) }

    /** One tappable row: an option with its resolved id, or the Other row. */
    data class Row(val option: AskQuestionOption?, val id: String, val isOther: Boolean = false)

    fun rowsFor(question: AskQuestion): List<Row> {
        val kind = AskQuestionRules.type(question)
        if (kind == AskQuestionRules.TYPE_FREE) return emptyList()
        val optionRows = if (kind == AskQuestionRules.TYPE_CONFIRM && question.options.isEmpty()) {
            // A hand-built confirmation with no rows still IS a yes/no: the
            // pair is the whole question, and the ids are the reserved ones.
            listOf(
                AskQuestionOption(label = "Confirm", id = AskQuestionRules.CONFIRMED_ID),
                AskQuestionOption(label = "Cancel", id = AskQuestionRules.DECLINED_ID),
            )
        } else {
            question.options
        }
        val ids = if (kind == AskQuestionRules.TYPE_CONFIRM && question.options.isEmpty()) {
            optionRows.mapNotNull { it.id }
        } else {
            AskQuestionRules.resolvedOptionIds(question)
        }
        val rows = optionRows.mapIndexed { position, option -> Row(option, ids.getOrElse(position) { option.id ?: "" }) }
        return if (AskQuestionRules.allowsOther(question)) rows + Row(null, AskQuestionRules.OTHER_ID, isOther = true) else rows
    }

    fun answerIdsFor(position: Int): List<String> {
        val question = questions[position]
        if (AskQuestionRules.type(question) == AskQuestionRules.TYPE_FREE) return emptyList()
        val chosen = picked[position].orEmpty().toMutableList()
        if (AskQuestionRules.allowsOther(question) && other[position] == true &&
            custom[position]?.trim()?.isNotEmpty() == true
        ) {
            chosen.add(AskQuestionRules.OTHER_ID)
        }
        return chosen
    }

    /** The same rules the server applies; the card may not send past them. */
    fun answerErrorFor(position: Int): String? =
        AskQuestionRules.validate(questions[position], answerIdsFor(position), custom[position].orEmpty())

    /** What this question's answer says, in the labels (or words) chosen. */
    fun answerTextFor(position: Int): List<String> {
        val question = questions[position]
        return when (AskQuestionRules.type(question)) {
            AskQuestionRules.TYPE_FREE -> listOfNotNull(custom[position]?.trim()?.takeIf { it.isNotEmpty() })
            AskQuestionRules.TYPE_CONFIRM -> answerIdsFor(position).mapNotNull { id ->
                when (id) {
                    AskQuestionRules.CONFIRMED_ID -> "The user confirmed."
                    AskQuestionRules.DECLINED_ID -> "The user declined."
                    else -> null
                }
            }
            else -> {
                val rows = rowsFor(question)
                answerIdsFor(position).mapNotNull { id ->
                    val row = rows.firstOrNull { it.id == id } ?: return@mapNotNull null
                    if (row.isOther) custom[position]?.trim() else row.option?.label
                }
            }
        }
    }

    val index = active.coerceIn(0, questions.lastIndex)
    val current = questions[index]
    val currentKind = AskQuestionRules.type(current)
    val settled = card.answered != null || sent != null
    val error = answerErrorFor(index)

    fun choose(row: Row) {
        if (settled || answering) return
        if (row.isOther) {
            val opening = other[index] != true
            other[index] = opening
            // Single-select: picking an option means the free-text answer was
            // not the one they wanted, and the reverse.
            if (!current.allowsMultiple && opening) picked[index] = emptySet()
            return
        }
        val chosen = picked[index].orEmpty()
        when {
            row.id in chosen -> picked[index] = chosen - row.id
            currentKind == AskQuestionRules.TYPE_MULTI -> {
                // The bound is real: past the max a further tap does nothing,
                // and the line under the list says why.
                if (chosen.size >= AskQuestionRules.maxSelections(current)) return
                picked[index] = chosen + row.id
            }
            else -> {
                picked[index] = setOf(row.id)
                other[index] = false
                // Move to the next question they still owe an answer to. The
                // last one stays put so the submit button is under the thumb
                // that just chose.
                questions.indices
                    .firstOrNull { it != index && answerErrorFor(it) != null }
                    ?.let { active = it }
            }
        }
    }

    fun send() {
        val requestId = card.requestId
        if (settled || answering || requestId == null) return
        // Every question must pass the same validation the server applies.
        if (questions.indices.any { answerErrorFor(it) != null }) return
        val answer = AskQuestionAnswer.format(questions, questions.indices.map(::answerTextFor))
        val finalAnswer = if (answer.isNotEmpty()) {
            answer
        } else {
            "${AskQuestionAnswer.PREAMBLE}\n\n" + questions.joinToString("\n\n") { "Q: ${it.question}\nA: (skipped)" }
        }
        sent = finalAnswer
        answering = true
        scope.launch {
            // A question only ever answers with text; the harness rejects an
            // allow/deny on one, so this never takes the permission path.
            session.answer(
                threadId = chat.threadId,
                requestId = requestId,
                choice = finalAnswer,
                isPermission = false,
            )
            answering = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(secondaryTint.copy(alpha = 0.13f), RoundedCornerShape(22.dp))
            .then(
                if (settled) {
                    Modifier
                } else {
                    Modifier.border(1.5.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(22.dp))
                },
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${chat.name} has a question",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (questions.size > 1 && !settled) {
                Text("${questions.indices.count { answerErrorFor(it) == null }} of ${questions.size}", fontSize = 12.sp, color = secondaryTint)
            }
        }

        if (questions.size > 1) {
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                questions.forEachIndexed { position, question ->
                    val chosen = position == index
                    Row(
                        modifier = Modifier
                            .background(
                                if (chosen) secondaryTint.copy(alpha = 0.22f) else Color.Transparent,
                                RoundedCornerShape(14.dp),
                            )
                            .clickable(enabled = !settled) {
                                haptics.play(TactileAction.CHOOSE_APPROVAL)
                                active = position
                            }
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (answerTextFor(position).isNotEmpty()) {
                            Icon(
                                imageVector = Icons.Filled.Check,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(12.dp),
                            )
                        }
                        Text(
                            question.tabLabel(position + 1),
                            fontSize = 13.sp,
                            fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (chosen) MaterialTheme.colorScheme.onSurface else secondaryTint,
                        )
                    }
                }
            }
        }

        SelectionContainer {
            Text(current.question, fontSize = 15.sp)
        }

        if (settled) {
            val answer = card.answeredText ?: sent
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = secondaryTint,
                    modifier = Modifier.size(16.dp),
                )
                SelectionContainer {
                    Text(
                        answer?.let(AskQuestionAnswer::withoutPreamble) ?: "Answered",
                        fontSize = 14.sp,
                        color = secondaryTint,
                    )
                }
            }
            return@Column
        }

        val rows = rowsFor(current)
        if (currentKind == AskQuestionRules.TYPE_MULTI) {
            val min = AskQuestionRules.minSelections(current)
            val max = AskQuestionRules.maxSelections(current)
            Text(
                when {
                    min == max -> "Choose $min"
                    max == 1 -> "Choose one"
                    min > 1 -> "Choose $min to $max"
                    else -> "Choose all that apply"
                },
                fontSize = 12.sp,
                color = secondaryTint,
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(secondaryTint.copy(alpha = 0.10f), RoundedCornerShape(14.dp)),
        ) {
            rows.forEachIndexed { position, row ->
                if (position > 0) HorizontalDivider()
                ChoiceRow(
                    label = row.option?.label ?: "Other",
                    detail = row.option?.detail,
                    checked = row.id in picked[index].orEmpty() || (row.isOther && other[index] == true),
                    multi = currentKind == AskQuestionRules.TYPE_MULTI,
                    enabled = !answering,
                ) {
                    haptics.play(TactileAction.CHOOSE_APPROVAL)
                    choose(row)
                }
                if (row.isOther && other[index] == true) {
                    HorizontalDivider()
                    AppTextField(
                        value = custom[index].orEmpty(),
                        onValueChange = { custom[index] = it },
                        placeholder = "Type your own answer",
                        singleLine = false,
                        maxLines = 4,
                        enabled = !answering,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(10.dp),
                    )
                }
            }
        }

        if (currentKind == AskQuestionRules.TYPE_FREE) {
            AppTextField(
                value = custom[index].orEmpty(),
                onValueChange = { custom[index] = it },
                placeholder = "Type your answer",
                singleLine = false,
                maxLines = 5,
                enabled = !answering,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (error != null) {
            Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
        }

        Button(
            onClick = ::send,
            enabled = error == null && !answering,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (questions.size > 1) "Submit answers" else "Submit answer")
        }
    }
}

/** One option row. The whole row is the target, not the 16 dp glyph on it. */
@Composable
private fun ChoiceRow(
    label: String,
    detail: String?,
    checked: Boolean,
    multi: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Marker(checked = checked, multi = multi)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (!detail.isNullOrEmpty()) {
                Text(detail, fontSize = 13.sp, color = secondaryTint)
            }
        }
    }
}

/** What the tabs and the answer share, kept here so a test can reach it. */
internal object QuestionCardRules {
    /** A structured ask draws the question card; everything else the ordinary one. */
    fun drawsQuestionCard(message: Message): Boolean =
        message.kind == Message.Kind.OPTIONS && message.card?.questions?.isNotEmpty() == true

    /** The tab labels, in order, exactly as the card shows them. */
    fun tabLabels(questions: List<AskQuestion>): List<String> =
        questions.mapIndexed { index, question -> question.tabLabel(index + 1) }
}

/**
 * The radio dot / checkbox tick, drawn rather than taken from the icon set:
 * the app bundles material-icons-core only, and pulling in the extended pack
 * for four glyphs would cost more than the twelve lines below.
 */
@Composable
private fun Marker(checked: Boolean, multi: Boolean) {
    val accent = MaterialTheme.colorScheme.primary
    val shape = if (multi) RoundedCornerShape(5.dp) else CircleShape
    Box(
        modifier = Modifier
            .size(20.dp)
            .then(
                if (checked) {
                    Modifier.background(accent, shape)
                } else {
                    Modifier.border(1.5.dp, secondaryTint, shape)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (!checked) return@Box
        if (multi) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(14.dp),
            )
        } else {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(MaterialTheme.colorScheme.onPrimary, CircleShape),
            )
        }
    }
}

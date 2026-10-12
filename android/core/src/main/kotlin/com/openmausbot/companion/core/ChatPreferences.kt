package com.openmausbot.companion.core

import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

/** How much of a bot's working activity the transcript shows. */
enum class ActivityDetail(val wireValue: String, val label: String, val caption: String) {
    FULL("full", "Full", "Every step a bot takes."),
    REDUCED("reduced", "Reduced", "Steps fold into one line. Failures always show."),
    HIDDEN("hidden", "Hidden", "No activity. A failed turn still explains itself."),
    ;

    companion object {
        /**
         * The quiet default. Normal agent work should read as a conversation, not
         * a tool-call log, so a phone with no stored choice — and a wire value it
         * does not recognise — folds successful steps into one line and keeps
         * failures visible. Full remains one tap away in Settings; an explicitly
         * stored choice (including Full) always wins over the default.
         */
        fun fromWire(value: String?): ActivityDetail =
            entries.firstOrNull { it.wireValue == value } ?: REDUCED
    }
}

/** One user-editable chip on the composer's quick-reply row. */
@Serializable
data class QuickReply(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val prompt: String,
    val icon: String,
) {
    companion object {
        val DEFAULTS: List<QuickReply> = listOf(
            QuickReply("default.diff", "Show diff", "Show latest git diff", "diff"),
            QuickReply("default.tests", "Run tests", "Run all automated tests", "tests"),
            QuickReply("default.explain", "Explain steps", "Explain the changes in detail", "explain"),
            QuickReply("default.next", "What's next?", "What should we do next?", "next"),
        )

        val ICON_CHOICES: List<String> = listOf(
            "next", "diff", "tests", "explain", "build", "bug", "document", "terminal",
            "send", "search", "history", "list",
        )

        fun encode(replies: List<QuickReply>): String =
            runCatching { CompanionJson.encodeToString(replies) }.getOrDefault("")

        /**
         * An empty or corrupt store falls back to defaults. An encoded empty list is a deliberate
         * choice and remains empty.
         */
        fun decode(json: String): List<QuickReply> {
            if (json.isEmpty()) return DEFAULTS
            val decoded = runCatching {
                CompanionJson.decodeFromString<List<QuickReply>>(json)
            }.getOrElse { return DEFAULTS }
            val ids = decoded.map { it.id.trim() }
            if (ids.any(String::isEmpty) || ids.toSet().size != ids.size) return DEFAULTS
            return decoded
        }
    }
}

/** A transcript item, either one message or a folded consecutive activity run. */
sealed interface TranscriptRow {
    val head: Message
    val id: String
    val at: Double get() = head.at
    val endAt: Double
    val role: Message.Role get() = head.role
    val kind: Message.Kind get() = head.kind
    val senderName: String? get() = head.from?.name

    data class Single(val message: Message) : TranscriptRow {
        override val head: Message get() = message
        override val id: String get() = message.id
        override val endAt: Double get() = message.at
    }

    data class ActivityRun(val items: List<Message>) : TranscriptRow {
        init {
            require(items.isNotEmpty()) { "An activity run must contain at least one message." }
        }

        override val head: Message get() = items.first()
        override val id: String get() = "run.${head.id}"
        override val endAt: Double get() = items.last().at
        val running: Boolean get() = items.any { it.tool?.ok == null }
    }
}

/**
 * The one line a roster row shows under a chat's name.
 *
 * Folded by the same rule as the transcript, and for the same reason: a reader who has turned
 * activity off has said they do not want to see tool calls, and the roster is where they see the
 * most of them — one per chat, on the screen they spend the most time on. Reading the preview off
 * the raw last message made "Hidden" mean "hidden in one place".
 */
fun rosterPreview(messages: List<Message>, detail: ActivityDetail): String =
    when (val last = transcriptRows(messages, detail).lastOrNull()) {
        null -> ""
        is TranscriptRow.Single -> previewText(last.message)
        is TranscriptRow.ActivityRun ->
            "${if (last.running) "Running" else "Ran"} ${last.items.size} steps"
    }

/** What a single message reads as in a roster row. */
internal fun previewText(message: Message): String = when (message.kind) {
    Message.Kind.TEXT -> message.text.orEmpty()
    // a pending card's question is the preview; the roster row already says
    // "waiting on you" beside it
    Message.Kind.OPTIONS -> {
        val card = message.card
        when {
            card == null -> ""
            card.isPending && card.subtitle.isNotEmpty() -> card.subtitle
            else -> card.title
        }
    }
    // A failure row previews as its headline rather than the chip's own
    // "error: …" phrasing: the roster row is about the bot, not about a log.
    Message.Kind.ACTIVITY -> message.failure?.title ?: message.tool?.name.orEmpty()
    Message.Kind.SCREEN -> "Screenshot"
    // The request itself is the preview: what the bot is blocked on.
    Message.Kind.CONNECTOR -> message.connector?.let { "Connect ${it.label}" }.orEmpty()
    Message.Kind.STRUCTURED -> message.text.takeIf { !it.isNullOrBlank() }
        ?: message.structured?.components?.firstOrNull()?.title
        ?: "Structured response"
    Message.Kind.UNKNOWN -> message.text.orEmpty()
}

/**
 * Fold a transcript to the selected activity detail. Failed steps are never folded in reduced
 * mode, and a failure that explains a whole turn is never folded in any mode — including hidden.
 *
 * The exception is deliberate, and it is narrower than "errors always show": a plain failed
 * tool receipt still obeys the setting, because a reader who turned activity off does not want a
 * bad Read in the middle of their conversation. A message carrying [Message.failure] is a different
 * thing — the turn produced no answer at all, and the sentence explaining why is the only account
 * of what happened to the message they sent. Hiding it would leave their own words unanswered with
 * nothing to point at.
 */
fun transcriptRows(messages: List<Message>, detail: ActivityDetail): List<TranscriptRow> = when (detail) {
    ActivityDetail.FULL -> messages.map(TranscriptRow::Single)
    ActivityDetail.HIDDEN -> messages
        .filterNot { it.kind == Message.Kind.ACTIVITY && it.failure == null }
        .map(TranscriptRow::Single)
    ActivityDetail.REDUCED -> buildList {
        val run = mutableListOf<Message>()
        fun flush() {
            when (run.size) {
                0 -> Unit
                1 -> add(TranscriptRow.Single(run.single()))
                else -> add(TranscriptRow.ActivityRun(run.toList()))
            }
            run.clear()
        }

        messages.forEach { message ->
            if (message.kind != Message.Kind.ACTIVITY) {
                flush()
                add(TranscriptRow.Single(message))
            } else if (message.tool?.ok == false || message.failure != null) {
                flush()
                add(TranscriptRow.Single(message))
            } else {
                run += message
            }
        }
        flush()
    }
}

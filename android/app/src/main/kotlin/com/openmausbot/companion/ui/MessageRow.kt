package com.openmausbot.companion.ui

import android.content.ClipData
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import com.openmausbot.companion.R
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.AttachedMessageContent
import com.openmausbot.companion.core.CitationRules
import com.openmausbot.companion.core.NativeCitation
import com.openmausbot.companion.core.DisplayedMessageAttachment
import com.openmausbot.companion.core.DownloadedFile
import com.openmausbot.companion.core.ErrorClassifier
import com.openmausbot.companion.core.Markdown
import com.openmausbot.companion.core.MarkdownBlock
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.MessageAttachment
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.ThreadRef
import com.openmausbot.companion.core.ToolActivity
import com.openmausbot.companion.core.TranscriptCard
import com.openmausbot.companion.core.TranscriptCards
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What the clipboard shows this came from. */
private const val MESSAGE_CLIP_LABEL = "MOBOT message"

/**
 * One row of the transcript — the port of `MessageRow` in `ios/App/ChatView.swift`.
 *
 * [endsRun] is the last bubble of a run from the same side: the one that gets the
 * tail. [TranscriptLayout.endsRun] decides it, over the whole transcript, so a row
 * never has to look at its neighbours.
 */
@Composable
fun MessageRow(
    chat: Chat,
    message: Message,
    endsRun: Boolean = true,
    /** Where a tapped link in a bot reply goes; null leaves it to the system. */
    openLink: ((String, Message) -> Unit)? = null,
    /** Open one exact user attachment through the authenticated computer route. */
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)? = null,
    /** Where an "Opened thread" chip goes; null leaves the chip a receipt. */
    openThread: ((ThreadRef) -> Unit)? = null,
    /** A failed turn's "Retry": null when there is nothing to run again, or
     * the task is already busy. */
    turnRetry: (() -> Unit)? = null,
    /** A failed turn's "Change model": null in a room, which has no one model. */
    changeModel: (() -> Unit)? = null,
    /** A failed turn's "Provider settings". */
    openProviders: (() -> Unit)? = null,
    onPromptAction: ((String) -> Unit)? = null,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val state by session.state.collectAsState()
    val clipboard = LocalClipboard.current
    var menuOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var editText by remember { mutableStateOf("") }
    var selectingText by remember { mutableStateOf<String?>(null) }

    val bot = (chat as? Chat.BotChat)?.bot
    val versions = remember(state, message.id) { state.versions(message, chat.threadId) }
    val versionIndex = versions.indexOfFirst { it.id == message.id }
    val mine = message.role == Message.Role.USER

    Box(
        modifier = Modifier
            .fillMaxWidth()
            // Long-press is the context menu; a plain tap must stay inert, so no
            // ripple is drawn for it.
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onLongClick = { menuOpen = true },
                onClick = {},
            ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            MessageContent(
                chat = chat,
                message = message,
                endsRun = endsRun,
                haptics = haptics,
                openLink = openLink,
                openAttachment = openAttachment,
                openThread = openThread,
                turnRetry = turnRetry,
                changeModel = changeModel,
                openProviders = openProviders,
                onPromptAction = onPromptAction,
            )

            message.reactions?.takeIf { it.isNotEmpty() }?.let { reactions ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Reactions.group(reactions).forEach { group ->
                        val tint = if (group.mine) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            secondaryTint
                        }
                        Text(
                            text = "${group.emoji} ${group.count}",
                            fontSize = 13.sp,
                            color = tint,
                            modifier = Modifier
                                .border(1.dp, tint.copy(alpha = 0.5f), CircleShape)
                                .clickable {
                                    haptics.play(TactileAction.TOGGLE_REACTION)
                                    scope.launch {
                                        session.react(message, chat.threadId, group.emoji)
                                    }
                                }
                                .padding(horizontal = 10.dp, vertical = 3.dp),
                        )
                    }
                }
            }
        }

        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            MessageActions.copyableText(message)?.let { text ->
                DropdownMenuItem(
                    text = { Text("Copy") },
                    onClick = {
                        menuOpen = false
                        scope.launch {
                            clipboard.setClipEntry(
                                ClipEntry(ClipData.newPlainText(MESSAGE_CLIP_LABEL, text)),
                            )
                        }
                    },
                )
                DropdownMenuItem(
                    text = { Text("Select text") },
                    onClick = {
                        menuOpen = false
                        selectingText = text
                    },
                )
            }
            if (versions.size > 1 && versionIndex >= 0 && bot != null) {
                HorizontalDivider()
                if (versionIndex > 0) {
                    DropdownMenuItem(
                        text = { Text("Previous version (${versionIndex} of ${versions.size})") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                        },
                        enabled = bot.busy != true,
                        onClick = {
                            menuOpen = false
                            scope.launch {
                                session.switchVersion(versions[versionIndex - 1], bot)
                            }
                        },
                    )
                }
                if (versionIndex + 1 < versions.size) {
                    DropdownMenuItem(
                        text = { Text("Next version (${versionIndex + 2} of ${versions.size})") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                        },
                        enabled = bot.busy != true,
                        onClick = {
                            menuOpen = false
                            scope.launch {
                                session.switchVersion(versions[versionIndex + 1], bot)
                            }
                        },
                    )
                }
            }
            // Attachment messages cannot be reconstructed by a text-only edit.
            // The policy also keeps their private transport paths out of the UI.
            val editableText = MessageActions.editableText(message)
            if (editableText != null && bot != null) {
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("Edit and retry") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        editText = editableText
                        editing = true
                    },
                )
            }
            if (!mine && bot != null && onPromptAction != null) {
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("Regenerate") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Regenerate your previous response with a fresh perspective")
                    },
                )
                DropdownMenuItem(
                    text = { Text("Shorten") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Can you shorten your previous response?")
                    },
                )
                DropdownMenuItem(
                    text = { Text("Expand") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Can you expand on your previous response with more detail?")
                    },
                )
                DropdownMenuItem(
                    text = { Text("Explain simply") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Explain your previous answer more simply.")
                    },
                )
                DropdownMenuItem(
                    text = { Text("Turn into table") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Format the key points of your previous response into a structured table.")
                    },
                )
                DropdownMenuItem(
                    text = { Text("Turn into checklist") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Turn the action items from your previous response into a checklist.")
                    },
                )
                DropdownMenuItem(
                    text = { Text("Make a plan") },
                    enabled = bot.busy != true,
                    onClick = {
                        menuOpen = false
                        onPromptAction("Create a step-by-step action plan based on your previous response.")
                    },
                )
            }
        }
    }

    if (editing && bot != null) {
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text("Edit and retry") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("This creates a new version and continues from there.", fontSize = 14.sp)
                    AppTextField(
                        value = editText,
                        onValueChange = { editText = it },
                        label = "Message",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    // `bot` is re-read from the collected state on every frame,
                    // so a bot that starts running while this dialog is open
                    // disables Send rather than sending an edit the harness will
                    // refuse with 409.
                    enabled = bot.busy != true && editText.isNotBlank(),
                    onClick = {
                        val text = editText.trim()
                        editing = false
                        if (text.isEmpty()) return@TextButton
                        scope.launch { session.edit(message, bot, text) }
                    },
                ) { Text("Send") }
            },
            dismissButton = {
                TextButton(onClick = { editing = false }) { Text("Cancel") }
            },
        )
    }

    selectingText?.let { text ->
        SelectableTextDialog(text = text, onDismiss = { selectingText = null })
    }
}

/**
 * Raw message text in a separate surface where Android can own the long-press
 * selection gesture. The bubble's long press is intentionally reserved for
 * reactions and message actions.
 */
@Composable
private fun SelectableTextDialog(text: String, onDismiss: () -> Unit) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember(text) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Select text") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SelectionContainer {
                    Text(
                        text = text,
                        fontSize = 16.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 360.dp)
                            .verticalScroll(rememberScrollState()),
                    )
                }
                Text(
                    "Touch and hold the text to select part of it.",
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    scope.launch {
                        // "Copied" after the clipboard has it, not before: the
                        // label is a report, and `setClipEntry` suspends.
                        clipboard.setClipEntry(
                            ClipEntry(ClipData.newPlainText(MESSAGE_CLIP_LABEL, text)),
                        )
                        copied = true
                    }
                },
            ) { Text(if (copied) "Copied" else "Copy all") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

@Composable
private fun MessageContent(
    chat: Chat,
    message: Message,
    endsRun: Boolean,
    haptics: Haptics,
    openLink: ((String, Message) -> Unit)?,
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
    openThread: ((ThreadRef) -> Unit)?,
    turnRetry: (() -> Unit)?,
    changeModel: (() -> Unit)?,
    openProviders: (() -> Unit)?,
    onPromptAction: ((String) -> Unit)? = null,
) {
    val session = LocalCompanion.current.session
    when (message.kind) {
        Message.Kind.TEXT -> {
            TextBubble(chat.threadId, message, endsRun, openLink, openAttachment, onPromptAction)
            message.structured?.let { structured ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp),
                ) {
                    StructuredResponseView(
                        chat = chat,
                        message = message,
                        structured = structured,
                        onEvent = { componentId, action, payload ->
                            if (action == "remix" && onPromptAction != null) {
                                val targetType = payload["targetType"] ?: "remix"
                                onPromptAction("Remix the ${targetType.replace('_', ' ')} in section \"$componentId\" while keeping the rest of the response stable.")
                            } else if ((action == "open_result" || action == "open_link") && openLink != null) {
                                payload["url"]?.let { url -> openLink(url, message) }
                            }
                        },
                    )
                }
            }
        }
        // Native structured response system (Phase J)
        Message.Kind.STRUCTURED -> message.structured?.let { structured ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
            ) {
                StructuredResponseView(
                    chat = chat,
                    message = message,
                    structured = structured,
                    onEvent = { componentId, action, payload ->
                        if (action == "remix" && onPromptAction != null) {
                            val targetType = payload["targetType"] ?: "remix"
                            onPromptAction("Remix the ${targetType.replace('_', ' ')} in section \"$componentId\" while keeping the rest of the response stable.")
                        } else if ((action == "open_result" || action == "open_link") && openLink != null) {
                            payload["url"]?.let { url -> openLink(url, message) }
                        }
                    },
                )
            }
        } ?: if (!message.text.isNullOrEmpty()) {
            TextBubble(chat.threadId, message, endsRun, openLink, openAttachment, onPromptAction)
        } else Unit
        // A structured ask draws its own card: its answers are the model's
        // questions, not an allow/deny a tap could stand for.
        Message.Kind.OPTIONS -> if (QuestionCardRules.drawsQuestionCard(message)) {
            QuestionCardView(chat, message, haptics)
        } else {
            CardView(chat, message, haptics)
        }
        // An activity row that carries a failure is not a tool step: it is the
        // turn saying why it produced nothing, and it draws the card that
        // explains it and offers the way out. Every other receipt stays a chip.
        Message.Kind.ACTIVITY -> message.failure?.let { failure ->
            TurnFailureCard(
                chat = chat,
                card = failure,
                onRetry = turnRetry,
                onChangeModel = changeModel,
                onOpenProviders = openProviders,
            )
        } ?: ActivityChip(
            tool = message.tool,
            threadRef = message.threadRef,
            openThread = openThread,
            onErrorTap = {
                message.tool?.let { tool ->
                    session.postStructuredError(
                        ErrorClassifier.fromToolActivity(tool, turnId = message.id, chatThreadId = chat.threadId)
                    )
                }
            },
        )
        Message.Kind.SCREEN -> ScreenShot(chat.threadId, message)
        // An app the bot needs connected. The card acts on the message it is
        // stored on; in a room, the requester is the sender on the card.
        Message.Kind.CONNECTOR -> message.connector?.let {
            val owner = (chat as? Chat.BotChat)?.bot?.id ?: message.from?.botId
            if (owner != null) ConnectorRequestCardView(chat, message, owner, haptics)
        }
        // A message kind from a newer computer. Almost everything the harness
        // sends carries `text`, so showing it is usually the whole message and
        // always better than a gap in the transcript. When there is nothing to
        // show, show nothing — a placeholder saying "unsupported" is a worse gap
        // than the gap.
        Message.Kind.UNKNOWN -> if (!message.text.isNullOrEmpty()) {
            TextBubble(chat.threadId, message, endsRun, openLink, openAttachment, onPromptAction)
        }
    }
}

private val INTERNAL_FILE_EXTENSIONS = setOf("js", "mjs", "cjs", "ts", "py", "sh", "bash")
private val INTERNAL_FILE_NAMES = setOf("artifacts.json", "package.json", "tsconfig.json", "make_pdf.js", "pretty_pdf.js")

private fun isUserVisibleAttachment(attachment: MessageAttachment): Boolean {
    val path = attachment.path.orEmpty()
    val name = (attachment.name ?: path.substringAfterLast('/')).lowercase().trim()
    if (name in INTERNAL_FILE_NAMES) return false
    val ext = name.substringAfterLast('.', "")
    if (ext in INTERNAL_FILE_EXTENSIONS && !attachment.isImage) {
        return false
    }
    return true
}

internal fun stripEmojis(text: String): String {
    if (text.isEmpty()) return text
    val sb = StringBuilder(text.length)
    var i = 0
    val len = text.length
    while (i < len) {
        val cp = text.codePointAt(i)
        val charCount = Character.charCount(cp)
        val isEmoji = when {
            // Regional indicator flags: 1F1E6 - 1F1FF
            cp in 0x1F1E6..0x1F1FF -> true
            // Emoticons, Pictographs, Transport, Misc symbols: 1F300 - 1FAFF
            cp in 0x1F300..0x1FAFF -> true
            // Misc symbols & Dingbats: 2600 - 27BF
            cp in 0x2600..0x27BF -> true
            // Variation selectors: FE00 - FE0F
            cp in 0xFE00..0xFE0F -> true
            // Zero-width joiner
            cp == 0x200D -> true
            // Combining enclosing keycap / marks: 20D0 - 20FF
            cp in 0x20D0..0x20FF -> true
            // Symbols: 2B50, 2B55, 2300-23FF
            cp in 0x2300..0x23FF || cp == 0x2B50 || cp == 0x2B55 -> true
            else -> false
        }
        if (!isEmoji) {
            sb.appendCodePoint(cp)
        }
        i += charCount
    }
    return sb.toString().replace(Regex(" +"), " ").trim()
}

private fun cleanAssistantChatText(text: String): String {
    if (text.isEmpty()) return text
    var cleaned = stripEmojis(text)
    cleaned = cleaned.replace(Regex("""\[(?:image|file)\s+attached\]""", RegexOption.IGNORE_CASE), "")
    cleaned = cleaned.replace(Regex("""\[image:\s*[^\]]+\]""", RegexOption.IGNORE_CASE), "")
    cleaned = cleaned.replace(Regex("""\[(?:download\s+the\s+[^\]]+|download\s+[^\]]+)\]\((?:attachment:[^\)]+|\/api\/attachments\/[^\)]+)\)""", RegexOption.IGNORE_CASE), "")
    cleaned = cleaned.replace(Regex("""\s*\*\([^\)]*peeking at the filename[^\)]*\)\*\s*""", RegexOption.IGNORE_CASE), "\n")
    return cleaned.trim()
}

/**
 * An image a bot attached to its reply — fetched once from the computer and
 * shown in the transcript with tap-to-open full-screen preview.
 */
@Composable
private fun BotImageAttachment(
    attachment: MessageAttachment,
    message: Message,
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
) {
    val session = LocalCompanion.current.session
    var bitmap by remember(attachment.path) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(attachment.path) {
        val bytes = session.attachmentImage(attachment.path) ?: return@LaunchedEffect
        bitmap = withContext(Dispatchers.IO) {
            runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }.getOrNull()
        }
    }
    val decoded = bitmap ?: return
    Image(
        bitmap = decoded,
        contentDescription = attachment.name ?: "Image",
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(enabled = openAttachment != null) {
                openAttachment?.invoke(
                    DisplayedMessageAttachment(
                        kind = DisplayedMessageAttachment.Kind.IMAGE,
                        name = attachment.name ?: "image.png",
                        path = attachment.path.orEmpty(),
                    ),
                    message,
                    null,
                )
            },
    )
}

/**
 * A non-image artifact a bot attached to its reply (PDF, document, dataset, code, archive)
 * rendered with native card styling and tap-to-open handler.
 */
@Composable
private fun BotFileAttachment(
    attachment: MessageAttachment,
    message: Message,
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
) {
    val path = attachment.path.orEmpty()
    val isPdf = attachment.name?.endsWith(".pdf", ignoreCase = true) == true || path.endsWith(".pdf", ignoreCase = true) || attachment.mime == "application/pdf"
    val isSlideOrDeck = attachment.name?.let { it.endsWith(".pptx", true) || it.endsWith(".ppt", true) || it.contains("deck", true) || it.contains("slide", true) } == true || path.contains("deck", true)
    val displayName = attachment.name ?: path.substringAfterLast('/')
    val mime = attachment.mime
    val subtitle: String = when {
        isSlideOrDeck -> "docs.google.com"
        !mime.isNullOrBlank() -> mime
        path.contains('/') -> path.substringBeforeLast('/')
        else -> if (isPdf) "PDF document" else "Document"
    }

    val isDark = AppTheme.isDark
    val cardBg = if (isDark) Color(0xFF1C1C1F) else Color(0xFFFFFFFF)
    val cardBorder = if (isDark) Color(0xFF2E2E32) else Color(0xFFECECEF)
    val btnBg = if (isDark) Color(0xFF2A2A2E) else Color(0xFFF4F4F6)
    val btnIconTint = if (isDark) Color(0xFFA0A0A8) else Color(0xFF6E6E73)

    val (iconBg, iconTint) = when {
        isSlideOrDeck -> Color(0xFFFEF3C7) to Color(0xFFD97706)
        isPdf -> Color(0xFFFEE2E2) to Color(0xFFDC2626)
        else -> Color(0xFFEFF6FF) to Color(0xFF2563EB)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(cardBg)
                .border(1.dp, cardBorder, RoundedCornerShape(18.dp))
                .clickable(enabled = openAttachment != null, role = Role.Button) {
                    openAttachment?.invoke(
                        DisplayedMessageAttachment(
                            kind = DisplayedMessageAttachment.Kind.FILE,
                            name = displayName,
                            path = path,
                        ),
                        message,
                        null,
                    )
                }
                .padding(horizontal = 16.dp, vertical = 14.dp)
                .semantics { contentDescription = "Attachment: $displayName. Tap to view." },
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(iconBg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_document),
                    contentDescription = null,
                    tint = iconTint,
                    modifier = Modifier.size(22.dp),
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = displayName,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (isDark) Color(0xFFFFFFFF) else Color(0xFF1A1A1A),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = subtitle,
                    fontSize = 12.5.sp,
                    color = Color(0xFF8E8E93),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(btnBg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_open_in_new),
                    contentDescription = "Open",
                    tint = btnIconTint,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        if (message.at > 0) {
            Text(
                text = RelativeStamp.time(message.at),
                fontSize = 11.5.sp,
                color = Color(0xFF9A9AA2),
                modifier = Modifier.padding(start = 4.dp, top = 4.dp),
            )
        }
    }
}

@Composable
private fun TextBubble(
    threadId: String,
    message: Message,
    endsRun: Boolean,
    openLink: ((String, Message) -> Unit)?,
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
    onPromptAction: ((String) -> Unit)? = null,
) {
    val mine = message.role == Message.Role.USER
    val tail = TranscriptLayout.tail(message, endsRun)
    // A reply that is *entirely* a patch or a table is drawn as one. The gate is
    // in `:core` and it is strict: anything with a sentence in it stays a
    // paragraph, because a card around a paragraph hides the paragraph.
    val card = remember(message.id, message.role, message.text) { TranscriptCards.of(message) }
    // Shared attachments are protocol tags in stored user text. They are not
    // prose, and a server-controlled path must never be presented as a link.
    val attached = remember(message.id, message.text) { AttachedMessageContent.parse(message.text.orEmpty()) }
    val assistantCleanText = remember(message.text, mine) {
        if (!mine) cleanAssistantChatText(message.text.orEmpty()) else ""
    }
    val userAttachments = remember(message.attachments, mine) {
        if (mine) emptyList()
        else message.attachments
            ?.filter { isUserVisibleAttachment(it) }
            ?.distinctBy { it.path?.ifEmpty { null } ?: it.name }
            .orEmpty()
    }
    val hasOnlyFileAttachments = !mine && assistantCleanText.isBlank() && userAttachments.isNotEmpty()
    // A card brings its own surface, so it drops the bubble — and with it the
    // tail, which is a bubble's chin and not a card's.
    val bubble = card == null && !hasOnlyFileAttachments
    // No face beside the bubble: the bot's face is in the header, and in a room
    // the name line says who spoke. The bubble sits at the edge.
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        val bubbleShape = RoundedCornerShape(18.dp)

        if (mine) {
            // User message: leave minimum 22% gutter on the left
            Spacer(modifier = Modifier.weight(0.22f))

            Column(
                modifier = Modifier
                    .weight(0.78f, fill = false)
                    .then(
                        if (bubble) {
                            Modifier
                                .background(BubbleColor.mine, bubbleShape)
                                .padding(horizontal = 16.dp, vertical = 13.dp)
                        } else {
                            Modifier
                        },
                    ),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                when (card) {
                    is TranscriptCard.Diff -> DiffCard(card)
                    is TranscriptCard.Table -> DataTableCard(card)
                    null -> {
                        attached.attachments.forEach { attachment ->
                            SharedAttachmentView(
                                threadId = threadId,
                                message = message,
                                attachment = attachment,
                                onOpen = openAttachment,
                                onPromptAction = onPromptAction,
                            )
                        }
                        if (attached.text.isNotEmpty()) {
                            SelectionContainer {
                                Text(
                                    text = attached.text,
                                    fontSize = 15.5.sp,
                                    lineHeight = 22.sp,
                                    color = BubbleColor.mineText,
                                )
                            }
                        }
                        if (message.at > 0) {
                            Text(
                                text = RelativeStamp.time(message.at),
                                fontSize = 11.5.sp,
                                color = Color(0xFF8E8E93),
                                modifier = Modifier.align(Alignment.End).padding(top = 2.dp),
                            )
                        }
                    }
                }
            }
        } else {
            // Assistant message
            val inlineImageUrls = remember(assistantCleanText) {
                if (assistantCleanText.isEmpty()) emptySet<String>()
                else Markdown.blocks(assistantCleanText).filterIsInstance<MarkdownBlock.Image>().map { it.url }.toSet()
            }
            val standaloneImages = remember(userAttachments, inlineImageUrls) {
                userAttachments.filter { attachment ->
                    if (!attachment.isImage) return@filter false
                    val path = attachment.path.orEmpty()
                    val id = path.substringAfterLast('/').substringBefore('.')
                    inlineImageUrls.none { url -> url == path || (id.isNotEmpty() && url.contains(id)) }
                }
            }
            val standaloneFiles = remember(userAttachments) {
                userAttachments.filter { !it.isImage }
            }

            Column(
                modifier = Modifier.weight(if (card != null) 1f else 0.80f, fill = false),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Rooms attribute each line to the member who said it
                message.from?.let {
                    Text(
                        text = it.name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(MausPalette.argb(it.color)),
                    )
                }

                when (card) {
                    is TranscriptCard.Diff -> DiffCard(card)
                    is TranscriptCard.Table -> DataTableCard(card)
                    null -> {
                        // 1. Assistant Text in its own Grok-style bubble (first!)
                        if (assistantCleanText.isNotEmpty()) {
                            Column(
                                modifier = Modifier
                                    .background(BubbleColor.theirs, bubbleShape)
                                    .padding(horizontal = 16.dp, vertical = 13.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                SelectionContainer {
                                    CompositionLocalProvider(
                                        LocalContentColor provides (if (AppTheme.isDark) Color(0xFFF0F0F2) else Color(0xFF1A1A1C))
                                    ) {
                                        MarkdownText(
                                            source = assistantCleanText,
                                            openLink = openLink?.let { open -> { url -> open(url, message) } },
                                            openImage = { imagePath ->
                                                openAttachment?.invoke(
                                                    DisplayedMessageAttachment(
                                                        kind = DisplayedMessageAttachment.Kind.IMAGE,
                                                        name = imagePath.substringAfterLast('/'),
                                                        path = imagePath,
                                                    ),
                                                    message,
                                                    null,
                                                )
                                            },
                                        )
                                    }
                                }
                                if (message.at > 0 && standaloneFiles.isEmpty() && standaloneImages.isEmpty()) {
                                    Text(
                                        text = RelativeStamp.time(message.at),
                                        fontSize = 11.5.sp,
                                        color = Color(0xFF9A9AA2),
                                        modifier = Modifier.align(Alignment.Start).padding(top = 2.dp),
                                    )
                                }
                            }
                        }

                        // 2. Standalone non-image attachments (PDFs, files, documents)
                        standaloneFiles.forEach { attachment ->
                            BotFileAttachment(attachment, message, openAttachment)
                        }

                        // 3. Standalone images (pictures generated/fetched, tap to preview full screen)
                        standaloneImages.forEach { attachment ->
                            BotImageAttachment(attachment, message, openAttachment)
                        }
                    }
                }
            }

            // Assistant message: leave minimum 20% gutter on the right
            Spacer(modifier = Modifier.weight(0.20f))
        }
    }
}

@Composable
private fun NativeCitationPill(citation: NativeCitation) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f))
            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.25f), RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp)
            .semantics { contentDescription = "Citation: ${citation.label}" },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "REF",
            fontSize = 9.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = citation.label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun SharedAttachmentView(
    threadId: String,
    message: Message,
    attachment: DisplayedMessageAttachment,
    onOpen: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
    onPromptAction: ((String) -> Unit)? = null,
) {
    if (attachment.kind == DisplayedMessageAttachment.Kind.IMAGE) {
        SharedImageAttachment(threadId, message, attachment, onOpen, onPromptAction)
        return
    }
    SharedGenericAttachment(message, attachment, onOpen, onPromptAction)
}

@Composable
private fun SharedGenericAttachment(
    message: Message,
    attachment: DisplayedMessageAttachment,
    onOpen: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
    onPromptAction: ((String) -> Unit)? = null,
) {
    val isPdf = attachment.name.endsWith(".pdf", ignoreCase = true)
    Column(
        modifier = Modifier.widthIn(max = 360.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(BubbleColor.mineText.copy(alpha = 0.10f))
                .clickable(enabled = onOpen != null, role = Role.Button) {
                    onOpen?.invoke(attachment, message, null)
                }
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .semantics { contentDescription = "${if (isPdf) "PDF document" else "File attachment"}: ${attachment.name}. Tap to preview." },
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (isPdf) Color(0xFFE53935).copy(alpha = 0.20f) else BubbleColor.mineText.copy(alpha = 0.16f))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    if (isPdf) "PDF" else "FILE",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isPdf) Color(0xFFEF5350) else BubbleColor.mineText.copy(alpha = 0.85f),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    attachment.name,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = BubbleColor.mineText,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (isPdf) "PDF document • Tap to preview" else "Tap to preview",
                    fontSize = 12.sp,
                    color = BubbleColor.mineText.copy(alpha = 0.68f),
                )
            }
        }
        if (isPdf && onPromptAction != null) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.padding(start = 2.dp),
            ) {
                AppPill(
                    text = "Summarize",
                    onClick = { onPromptAction("Summarize key takeaways from PDF \"${attachment.name}\"") },
                    tone = PillTone.Raised,
                )
                AppPill(
                    text = "Extract data",
                    onClick = { onPromptAction("Extract structured data and metrics from PDF \"${attachment.name}\"") },
                    tone = PillTone.Raised,
                )
                AppPill(
                    text = "Find contradictions",
                    onClick = { onPromptAction("Analyze PDF \"${attachment.name}\" for any contradictions or anomalies") },
                    tone = PillTone.Raised,
                )
            }
        }
    }
}

private sealed interface AttachmentThumbnailState {
    data object Loading : AttachmentThumbnailState
    data class Ready(val file: DownloadedFile, val image: ImageBitmap) : AttachmentThumbnailState
    data object Failed : AttachmentThumbnailState
}

@Composable
private fun SharedImageAttachment(
    threadId: String,
    message: Message,
    attachment: DisplayedMessageAttachment,
    onOpen: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
    onPromptAction: ((String) -> Unit)? = null,
) {
    val session = LocalCompanion.current.session
    var attempt by remember(message.id, attachment.path) { mutableStateOf(0) }
    var state by remember(message.id, attachment.path) {
        mutableStateOf<AttachmentThumbnailState>(AttachmentThumbnailState.Loading)
    }
    LaunchedEffect(threadId, message.id, attachment.path, attempt) {
        state = AttachmentThumbnailState.Loading
        // A failed inline preview owns its own retry UI; it must not replace an
        // unrelated composer or account alert while this row scrolls on screen.
        val downloaded = session.downloadFile(
            threadId,
            message.id,
            attachment.path,
            reportError = false,
            cacheResult = true,
        )
        if (downloaded == null) {
            state = AttachmentThumbnailState.Failed
            return@LaunchedEffect
        }
        val bitmap = withContext(Dispatchers.Default) {
            decodeAttachmentImage(downloaded.data, AttachmentImageRules.THUMBNAIL_EDGE)
        }
        state = bitmap?.let { AttachmentThumbnailState.Ready(downloaded, it) }
            ?: AttachmentThumbnailState.Failed
    }

    val ready = state as? AttachmentThumbnailState.Ready
    Column(
        modifier = Modifier.widthIn(max = 360.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(BubbleColor.mineText.copy(alpha = 0.10f))
                .clickable(enabled = ready != null && onOpen != null, role = Role.Button) {
                    ready?.let { onOpen?.invoke(attachment, message, it.file) }
                }
                .semantics { contentDescription = "Image attachment: ${attachment.name}. Tap to preview." },
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(4f / 3f),
                contentAlignment = Alignment.Center,
            ) {
                when (val current = state) {
                    AttachmentThumbnailState.Loading ->
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    AttachmentThumbnailState.Failed -> AttachmentLoadFailure(
                        label = "Image unavailable",
                        onRetry = { attempt += 1 },
                    )
                    is AttachmentThumbnailState.Ready -> Image(
                        bitmap = current.image,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f),
                    )
                }
            }
            Text(
                attachment.name,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = BubbleColor.mineText,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }
        if (onPromptAction != null) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.padding(start = 2.dp),
            ) {
                AppPill(
                    text = "Explain",
                    onClick = { onPromptAction("Explain what is in this image: \"${attachment.name}\"") },
                    tone = PillTone.Raised,
                )
                AppPill(
                    text = "Extract text",
                    onClick = { onPromptAction("Extract and transcribe all visible text in this image: \"${attachment.name}\"") },
                    tone = PillTone.Raised,
                )
                AppPill(
                    text = "Describe",
                    onClick = { onPromptAction("Describe this image in detail: \"${attachment.name}\"") },
                    tone = PillTone.Raised,
                )
            }
        }
    }
}

@Composable
private fun AttachmentLoadFailure(label: String, onRetry: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(
            imageVector = Icons.Filled.Warning,
            contentDescription = null,
            tint = BubbleColor.mineText.copy(alpha = 0.70f),
            modifier = Modifier.size(20.dp),
        )
        Text(label, fontSize = 13.sp, color = BubbleColor.mineText.copy(alpha = 0.80f))
        TextButton(onClick = onRetry) { Text("Retry") }
    }
}

/**
 * A tool the bot ran, and what became of it — the status half of
 * `ios/App/Cards/SkillExecutionReceiptView.swift`.
 *
 * Deliberately quiet: these are the bulk of a busy transcript and they are
 * context, not content. So the receipt is a dot and a name, and the badge word
 * appears only for the two states worth a glance ([ActivityReceipt.showsLabel]).
 * A row that failed keeps the warning glyph it already had, so failure is a
 * shape and not only a colour — and the whole row reads as one sentence to a
 * screen reader whichever state it is in.
 *
 * None of iOS's detail is here, because none of it has data: `durationMs`,
 * `parameters` and `output` are dormant on that view and absent from
 * [ToolActivity]. Nothing to expand means nothing to tap, which is why this is
 * not a button — except a chip that names a thread it opened, which is the
 * link to that thread.
 */
/**
 * A tool execution card adhering to MOBOT's P0 design system:
 * - Collapsed: 44dp minimum height, compact card shape (12.dp radius), elevated surface, 1px border.
 * - Category glyph: terminal (`>_`), file (`FILE`), web (`WEB`), or tool (`RUN`).
 * - Command / action name in monospace code font.
 * - Duration badge (e.g. "1.2s") and status badge ("Running", "Complete", "Failed").
 * - Expandable accordion: output / error inspector, copy button, thread ref button.
 */
@Composable
fun ToolExecutionCard(
    tool: ToolActivity,
    modifier: Modifier = Modifier,
    threadRef: ThreadRef? = null,
    openThread: ((ThreadRef) -> Unit)? = null,
    onErrorTap: (() -> Unit)? = null,
) {
    val haptics = rememberHaptics()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var expanded by remember(tool.name, tool.durationMs) { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

    val status = ActivityReceipt.status(tool.ok)
    val isRunning = status == ActivityStatus.RUNNING
    val isError = status == ActivityStatus.ERROR

    val colors = AppTheme.colors

    val statusColor = when {
        isRunning -> colors.accent
        isError -> colors.danger
        else -> colors.textSecondary
    }

    val borderColor = when {
        isError -> colors.danger.copy(alpha = 0.35f)
        isRunning -> colors.accent.copy(alpha = 0.35f)
        else -> colors.subtleBorder
    }

    val glyph = when {
        tool.name.contains("bash", ignoreCase = true) ||
            tool.name.contains("command", ignoreCase = true) ||
            tool.name.contains("terminal", ignoreCase = true) ||
            tool.name.contains("sh", ignoreCase = true) -> ">_"
        tool.name.contains("file", ignoreCase = true) ||
            tool.name.contains("read", ignoreCase = true) ||
            tool.name.contains("write", ignoreCase = true) ||
            tool.name.contains("edit", ignoreCase = true) -> "FILE"
        tool.name.contains("web", ignoreCase = true) ||
            tool.name.contains("browser", ignoreCase = true) ||
            tool.name.contains("fetch", ignoreCase = true) ||
            tool.name.contains("http", ignoreCase = true) ||
            tool.name.contains("url", ignoreCase = true) -> "WEB"
        else -> "RUN"
    }

    val durationText = tool.durationMs?.let { ms ->
        if (ms >= 1000) {
            String.format(java.util.Locale.US, "%.1fs", ms / 1000f)
        } else {
            "${ms}ms"
        }
    }

    val statusText = when {
        isRunning -> "Running"
        isError -> "Failed"
        else -> "Complete"
    }

    val hasDetails = !tool.output.isNullOrBlank() || !tool.error.isNullOrBlank() || !tool.spoken.isNullOrBlank() || threadRef != null || (isError && onErrorTap != null)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(AppRadii.compactCardShape)
            .background(colors.elevatedSurface)
            .border(1.dp, borderColor, AppRadii.compactCardShape)
            .then(
                if (hasDetails) {
                    Modifier.clickable(
                        role = Role.Button,
                        onClick = {
                            haptics.play(TactileAction.TOGGLE_ACTIVITY_RUN)
                            expanded = !expanded
                        },
                    )
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "Tool ${tool.name}, $statusText${durationText?.let { ", took $it" } ?: ""}"
            },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(colors.surfaceVariant)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = glyph,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = colors.textPrimary,
                )
            }

            Text(
                text = tool.name,
                style = AppType.codeBold,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )

            if (durationText != null) {
                Text(
                    text = durationText,
                    style = AppType.metadata,
                    color = colors.textTertiary,
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                when {
                    isRunning -> {
                        CircularProgressIndicator(
                            modifier = Modifier.size(12.dp),
                            strokeWidth = 1.5.dp,
                            color = colors.accent,
                        )
                    }
                    isError -> {
                        Icon(
                            imageVector = Icons.Filled.Warning,
                            contentDescription = null,
                            tint = colors.danger,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                    else -> {
                        Icon(
                            imageVector = Icons.Filled.Check,
                            contentDescription = null,
                            tint = colors.complete,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                }
                Text(
                    text = statusText,
                    style = AppType.metadata,
                    color = statusColor,
                )
            }

            if (hasDetails) {
                Text(
                    text = if (expanded) "▲" else "▼",
                    fontSize = 10.sp,
                    color = colors.textTertiary,
                )
            }
        }

        if (expanded && hasDetails) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val spoken = tool.spoken
                if (!spoken.isNullOrBlank()) {
                    Text(
                        text = spoken,
                        style = AppType.secondary,
                        color = colors.textSecondary,
                    )
                }

                val outputText = tool.error ?: tool.output
                if (!outputText.isNullOrBlank()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(colors.surface)
                            .border(1.dp, colors.subtleBorder, RoundedCornerShape(8.dp))
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        SelectionContainer {
                            Text(
                                text = outputText,
                                style = AppType.code,
                                color = if (isError) colors.danger else colors.textSecondary,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 200.dp)
                                    .verticalScroll(rememberScrollState()),
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(
                                onClick = {
                                    scope.launch {
                                        clipboard.setClipEntry(
                                            ClipEntry(ClipData.newPlainText("Tool Output", outputText)),
                                        )
                                        copied = true
                                    }
                                },
                            ) {
                                Text(
                                    text = if (copied) "Copied" else "Copy output",
                                    style = AppType.metadata,
                                    color = colors.textTertiary,
                                )
                            }
                        }
                    }
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (threadRef != null && openThread != null) {
                        AppPill(
                            text = "Open thread #${threadRef.title}",
                            tone = PillTone.Raised,
                            onClick = {
                                haptics.play(TactileAction.OPEN_THREAD_CHIP)
                                openThread(threadRef)
                            },
                        )
                    }

                    if (isError && onErrorTap != null) {
                        AppPill(
                            text = "View error details",
                            tone = PillTone.Destructive,
                            onClick = {
                                haptics.play(TactileAction.OPEN_THREAD_CHIP)
                                onErrorTap()
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityChip(
    tool: ToolActivity?,
    threadRef: ThreadRef? = null,
    openThread: ((ThreadRef) -> Unit)? = null,
    onErrorTap: (() -> Unit)? = null,
) {
    if (tool == null) return
    val haptics = rememberHaptics()
    var expanded by remember(tool.name, tool.durationMs) { mutableStateOf(false) }
    val isRunning = tool.ok == null
    val isError = tool.ok == false
    val durationText = tool.durationMs?.let { ms ->
        if (ms >= 1000) String.format(java.util.Locale.US, "%.1fs", ms / 1000f) else "${ms}ms"
    }
    val label = when {
        isRunning -> "Running ${tool.name}..."
        isError -> "${tool.name} failed"
        else -> "Ran ${tool.name}${durationText?.let { " · $it" } ?: ""}"
    }

    Column(
        modifier = Modifier.padding(start = 4.dp, top = 2.dp, bottom = 2.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier
                .background(
                    if (isError) MaterialTheme.colorScheme.error.copy(alpha = 0.12f) else AppTheme.colors.surfaceRaised,
                    RoundedCornerShape(16.dp),
                )
                .border(
                    1.dp,
                    if (isError) MaterialTheme.colorScheme.error.copy(alpha = 0.3f) else AppTheme.colors.subtleBorder,
                    RoundedCornerShape(16.dp),
                )
                .clickable(role = Role.Button) {
                    haptics.play(TactileAction.TOGGLE_ACTIVITY_RUN)
                    expanded = !expanded
                }
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isRunning) {
                CircularProgressIndicator(modifier = Modifier.size(13.dp), strokeWidth = 1.5.dp)
            } else if (isError) {
                Icon(
                    imageVector = Icons.Filled.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(14.dp),
                )
            } else {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = Color(0xFF10B981),
                    modifier = Modifier.size(14.dp),
                )
            }
            Text(
                text = label,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = if (isError) MaterialTheme.colorScheme.error else AppTheme.colors.textSecondary,
            )
        }
        if (expanded) {
            ToolExecutionCard(
                tool = tool,
                threadRef = threadRef,
                openThread = openThread,
                onErrorTap = onErrorTap,
            )
        }
    }
}

/** Several consecutive successful/running activity receipts, folded on demand. */
@Composable
fun ActivityRunChip(items: List<Message>, openThread: ((ThreadRef) -> Unit)? = null) {
    if (items.isEmpty()) return
    val session = LocalCompanion.current.session
    val haptics = rememberHaptics()
    var expanded by remember(items.first().id) { mutableStateOf(false) }
    val running = items.any { it.tool?.ok == null }
    val failedCount = items.count { it.tool?.ok == false }
    val hasError = failedCount > 0
    val summary = when {
        running -> "Running ${items.size} steps"
        hasError -> "$failedCount of ${items.size} steps failed"
        else -> "Ran ${items.size} steps"
    }
    Column(
        modifier = Modifier.padding(start = 4.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            modifier = Modifier
                .heightIn(min = MIN_TOUCH_TARGET)
                .clickable(role = Role.Button) {
                    expanded = !expanded
                    haptics.play(TactileAction.TOGGLE_ACTIVITY_RUN)
                }
                .semantics {
                    contentDescription = "$summary, ${if (expanded) "expanded" else "collapsed"}"
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(
                modifier = Modifier
                    .background(
                        if (hasError) MaterialTheme.colorScheme.error.copy(alpha = 0.12f) else AppTheme.colors.surfaceRaised,
                        RoundedCornerShape(16.dp),
                    )
                    .border(
                        1.dp,
                        if (hasError) MaterialTheme.colorScheme.error.copy(alpha = 0.3f) else AppTheme.colors.subtleBorder,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (running) {
                    CircularProgressIndicator(modifier = Modifier.size(13.dp), strokeWidth = 1.5.dp)
                } else if (hasError) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(14.dp),
                    )
                } else {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = Color(0xFF10B981),
                        modifier = Modifier.size(14.dp),
                    )
                }
                Text(
                    summary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (hasError) MaterialTheme.colorScheme.error else AppTheme.colors.textPrimary,
                )
                Text(
                    if (expanded) "Hide" else "Show",
                    fontSize = 12.5.sp,
                    color = if (hasError) MaterialTheme.colorScheme.error else AppTheme.colors.textSecondary,
                )
            }
        }
        if (expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items.forEach { item ->
                    ActivityChip(
                        tool = item.tool,
                        threadRef = item.threadRef,
                        openThread = openThread,
                        onErrorTap = {
                            item.tool?.let { tool ->
                                session.postStructuredError(
                                    ErrorClassifier.fromToolActivity(tool, turnId = item.id)
                                )
                            }
                        },
                    )
                }
            }
        }
    }
}

/** The receipt's status dot, sized to sit level with the 13 sp name beside it. */
private val ACTIVITY_DOT = 7.dp

internal fun formatCleanSubtitle(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
            val json = org.json.JSONObject(trimmed)
            val parts = mutableListOf<String>()
            val keys = json.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                if (!k.startsWith("_") && k != "transport" && k != "connector") {
                    parts.add("$k: ${json.opt(k)}")
                }
            }
            if (parts.isNotEmpty()) return parts.joinToString(" • ")
        } catch (_: Exception) {}
    } else if (trimmed.contains("Requested permissions: {")) {
        try {
            val start = trimmed.indexOf('{')
            val end = trimmed.lastIndexOf('}')
            if (start in 0 until end) {
                val json = org.json.JSONObject(trimmed.substring(start, end + 1))
                val keys = mutableListOf<String>()
                val it = json.keys()
                while (it.hasNext()) keys.add(it.next())
                val prefix = trimmed.substring(0, start).trim().removeSuffix("—").trim()
                val prefixStr = if (prefix.isNotEmpty()) "$prefix: " else ""
                return "${prefixStr}Permissions: ${keys.joinToString(", ")}"
            }
        } catch (_: Exception) {}
    }
    return trimmed
}

/**
 * An option card. When it still has a request behind it, this is the screen the
 * companion exists for — a bot stopped, and only a person can let it continue.
 */
@Composable
private fun CardView(chat: Chat, message: Message, haptics: Haptics) {
    val card = message.card ?: return
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var answering by remember(message.id) { mutableStateOf(false) }
    val skillRequest = card.skillRequest

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(secondaryTint.copy(alpha = 0.13f), RoundedCornerShape(22.dp))
            .then(
                if (card.isPending) {
                    Modifier.border(
                        1.5.dp,
                        MaterialTheme.colorScheme.primary,
                        RoundedCornerShape(22.dp),
                    )
                } else {
                    Modifier
                },
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(card.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f, fill = false))
            if (card.isPermission) {
                val isReadOnly = card.title.contains("Read", ignoreCase = true) ||
                    card.title.contains("Search", ignoreCase = true) ||
                    card.title.contains("Inspect", ignoreCase = true)
                val badgeText = if (isReadOnly) "Read-only" else "Action"
                val badgeBg = if (isReadOnly) Color(0xFF10B981).copy(alpha = 0.15f) else MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                val badgeColor = if (isReadOnly) Color(0xFF10B981) else MaterialTheme.colorScheme.primary
                Box(
                    modifier = Modifier
                        .background(badgeBg, RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text(badgeText, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = badgeColor)
                }
            }
        }
        // The detail of what is being approved is the thing worth copying.
        SelectionContainer {
            Text(formatCleanSubtitle(card.subtitle), fontSize = 15.sp, color = secondaryTint)
        }

        card.held?.let {
            Text(it, fontSize = 13.sp, color = Color(MausPalette.argb("orange")))
        }

        skillRequest?.let { skill ->
            val reviewed = skill.reviewedSha256
            if (reviewed != null) {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Review the complete SKILL.md",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "sha256 ${reviewed.take(8)}",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = secondaryTint,
                        )
                    }
                    SelectionContainer {
                        Text(
                            "Source: ${skill.source ?: "Unknown"}",
                            fontSize = 11.sp,
                            color = secondaryTint,
                        )
                    }
                    SelectionContainer {
                        Text(
                            skill.preview.orEmpty(),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 220.dp)
                                .verticalScroll(rememberScrollState())
                                .background(
                                    secondaryTint.copy(alpha = 0.08f),
                                    RoundedCornerShape(10.dp),
                                )
                                .padding(10.dp),
                        )
                    }
                }
            } else {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = Color(MausPalette.argb("orange")),
                    )
                    Text(
                        "This proposal was created by an older build and cannot be safely enabled. " +
                            "Deny it and ask the bot to create it again.",
                        fontSize = 12.sp,
                        color = Color(MausPalette.argb("orange")),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        if (card.isPending) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // The buttons are the card's own options, never a string
                // invented here. Session maps the choice to allow/deny/answer.
                card.options.forEach { option ->
                    val refusal = ApprovalChoices.emphasis(option) == OptionEmphasis.SECONDARY
                    Button(
                        onClick = {
                            haptics.play(TactileAction.CHOOSE_APPROVAL)
                            answering = true
                            scope.launch {
                                ApprovalAnswers.choose(session, chat, card, option)
                                answering = false
                            }
                        },
                        enabled = !answering && (
                            skillRequest == null ||
                                refusal ||
                                skillRequest.reviewedSha256 != null
                            ),
                        // Same `isRefusal` that picks the allow choice picks the
                        // weight, so the most sensible action on the most
                        // sensitive screen is not the same shape as the refusal.
                        colors = if (refusal) {
                            ButtonDefaults.filledTonalButtonColors()
                        } else {
                            ButtonDefaults.buttonColors()
                        },
                    ) {
                        Text(option)
                    }
                }
            }

            // The grant key comes from the card. The phone never derives its
            // own, so it cannot permit something subtly wider than the computer
            // would have. The same goes for the answer: it is one of the options
            // the card offered, never a string invented here.
            val alwaysAllow = ApprovalChoices.alwaysAllowChoice(card)
            if (alwaysAllow != null && chat is Chat.BotChat) {
                TextButton(
                    onClick = {
                        haptics.play(TactileAction.GRANT_APPROVAL)
                        answering = true
                        scope.launch {
                            ApprovalAnswers.grant(session, chat, card, alwaysAllow)
                            answering = false
                        }
                    },
                    enabled = !answering,
                ) {
                    Text("Always allow this tool", fontSize = 14.sp)
                }
            }
        } else {
            card.answered?.let {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = secondaryTint,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(it, fontSize = 14.sp, color = secondaryTint)
                }
            }
        }
    }
}

/**
 * A frame of the bot's computer. In the paged shape the pixels are not in the
 * transcript — they are fetched here, once, when the row appears.
 */
@Composable
private fun ScreenShot(threadId: String, message: Message) {
    val session = LocalCompanion.current.session
    var attempt by remember(message.id) { mutableStateOf(0) }
    var state by remember(message.id) { mutableStateOf<ScreenShotState>(ScreenShotState.Loading) }

    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val renderedWidthPixels = with(LocalDensity.current) { maxWidth.toPx().toInt().coerceAtLeast(1) }
        LaunchedEffect(threadId, message.id, attempt, renderedWidthPixels) {
            state = ScreenShotState.Loading
            val bytes = try {
                message.png?.let { encoded ->
                    withContext(Dispatchers.Default) {
                        runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull()
                    }
                } ?: if (message.hasImage == true) session.image(threadId, message.id) else null
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                null
            }
            val bitmap = bytes?.let {
                withContext(Dispatchers.Default) {
                    decodeScreenShotImage(it, renderedWidthPixels)
                }
            }
            state = bitmap?.let(ScreenShotState::Ready) ?: ScreenShotState.Failed
        }

        val aspectRatio = (state as? ScreenShotState.Ready)?.image?.let { image ->
            image.width.toFloat() / image.height.coerceAtLeast(1).toFloat()
        } ?: (16f / 10f)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(aspectRatio)
                .clip(RoundedCornerShape(16.dp))
                .background(secondaryTint.copy(alpha = 0.13f)),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = state) {
                ScreenShotState.Loading ->
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                ScreenShotState.Failed -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(20.dp),
                    )
                    Text("Screenshot unavailable", fontSize = 13.sp, color = secondaryTint)
                    TextButton(onClick = { attempt += 1 }) { Text("Retry") }
                }
                is ScreenShotState.Ready -> Image(
                    bitmap = current.image,
                    contentDescription = "A frame of this bot's computer",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

private sealed interface ScreenShotState {
    data object Loading : ScreenShotState
    data class Ready(val image: ImageBitmap) : ScreenShotState
    data object Failed : ScreenShotState
}

/**
 * The reply as it is being typed, styled to match the settled bubble it is about
 * to become — the handover should be invisible, and any difference in padding or
 * corner radius reads as the message jumping on arrival.
 *
 * A caret rather than a spinner: a spinner says "something is happening
 * somewhere", which the reader already knows. A caret at the end of real text
 * says how far along it is.
 */
@Composable
fun StreamingBubble(text: String?, reasoning: String?) {
    val bubbleShape = RoundedCornerShape(18.dp)
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Column(
            modifier = Modifier
                .weight(0.80f, fill = false)
                .background(BubbleColor.theirs, bubbleShape)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (text.isNullOrEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = "Thinking…",
                        style = AppType.metadata,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            } else {
                // Same renderer as the settled bubble: a live reply showing
                // `**bold**` that snaps to bold on arrival is the message
                // jumping, just in a different dimension.
                MarkdownText(source = text, caret = true)
            }
        }
        Spacer(Modifier.weight(0.20f))
    }
}

/**
 * The beat between "go" and the first token — the port of the `else if
 * current.busy` branch of `ChatView.swift` and of `TypingIndicatorView`.
 *
 * The reason this exists is the sentence in the semantics block, not the dots.
 * Busy already reaches a sighted reader twice over — the mascot wears a working
 * face and the composer offers an interrupt — and reached a TalkBack reader
 * through neither. The row is a polite live region, so it is spoken when it
 * appears, and it carries a name of its own, so it can also be found by swiping
 * to the end of the transcript.
 *
 * Drawn in the same bubble as the reply that will replace it, and in the bot's
 * own colour, so the handover is the text arriving rather than the shape changing.
 */
@Composable
fun WorkingBubble(name: String, color: String) {
    val tint = Color(MausPalette.argb(color))
    val label = LiveTail.workingLabel(name)
    val colors = AppTheme.colors
    val bubbleShape = RoundedCornerShape(18.dp)

    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Row(
            modifier = Modifier
                .background(BubbleColor.theirs, bubbleShape)
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .semantics {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
                color = tint,
            )
            Text(
                text = "Thinking…",
                style = AppType.metadata,
                color = colors.textSecondary,
            )
        }
        Spacer(Modifier.weight(0.20f))
    }
}

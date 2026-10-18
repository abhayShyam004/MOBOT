package com.openmausbot.companion.ui

import android.view.KeyCharacterMap
import androidx.activity.compose.BackHandler
import androidx.compose.material.icons.filled.Warning
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.geometry.Offset
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.openmausbot.companion.R
import com.openmausbot.companion.core.AttachmentPolicy
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ErrorClassifier
import com.openmausbot.companion.core.ChatTarget
import com.openmausbot.companion.core.LocalMessageLink
import com.openmausbot.companion.core.PendingMessageAttachment
import com.openmausbot.companion.core.QueuedSend
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Dictation
import com.openmausbot.companion.core.DisplayedMessageAttachment
import com.openmausbot.companion.core.DownloadedFile
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.BotMood
import com.openmausbot.companion.core.BotMoodRules
import com.openmausbot.companion.core.ThreadRef
import com.openmausbot.companion.core.TranscriptRow
import com.openmausbot.companion.core.target
import com.openmausbot.companion.core.transcriptRows
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * One conversation: the transcript, the approval cards, and the composer — the
 * port of `ios/App/ChatView.swift`.
 *
 * The transcript is whatever the harness folded — settled text, tool chips,
 * option cards, screenshots. This renders those and nothing else; it does not
 * re-derive anything from provider events, because the server already did that
 * and having two folds is how two clients start disagreeing.
 *
 * The chrome floats: back and the bot's computer on a strip that fades into the
 * transcript, the bot's face and name over it, and the composer below. Everything
 * else scrolls underneath, which is what makes the conversation the screen.
 */
@Composable
fun ChatScreen(
    destination: Destination.Conversation,
    onResolved: (ChatTarget) -> Unit,
    onBack: () -> Unit,
    onOpenComputer: (String) -> Unit,
    onOpenOverview: (String) -> Unit,
    /** Bot settings' Memory page, addressed by bot id. */
    onOpenMemory: (String) -> Unit = {},
    /** The provider fix panel's one remedy: Model providers. */
    onOpenModelProviders: () -> Unit = {},
    /**
     * True while this conversation is still on the navigator stack (including
     * under Computer). Used on dispose to keep the in-memory draft across a
     * push and drop it after a pop that removed the chat.
     */
    retainsDraft: (chatId: String) -> Boolean = { false },
    /** An "Opened thread" chip pointing at another bot pushes that chat. */
    onOpenChat: (Chat) -> Unit = {},
    /** Opens the native in-app browser with controls. */
    onOpenBrowser: (url: String, title: String?) -> Unit = { _, _ -> },
) {
    val session = LocalCompanion.current.session
    val state by session.state.collectAsState()

    // A notification tap at a cold start arrives before the fleet is hydrated,
    // and so does a navigation stack restored after the process was killed: wait
    // for it rather than concluding the chat is gone and bouncing back to the
    // roster, which would make the tap open nothing.
    val resolution = remember(state, destination) {
        ThreadResolution.resolve(state, destination)
    }
    when (resolution) {
        ThreadResolution.Result.Waiting -> OpeningThread(onBack)
        ThreadResolution.Result.Gone -> LaunchedEffect(destination) { onBack() }
        // The live chat record, so busy/unread stay current as frames land.
        is ThreadResolution.Result.Open -> {
            // Resolve the owner without changing the task named by the destination.
            val resolved = (destination as? Destination.Thread)?.let { resolution.chat.target }
            LaunchedEffect(resolved) { if (resolved != null) onResolved(resolved) }
            LoadedChat(
                resolution.chat,
                state,
                onBack,
                onOpenComputer,
                onOpenOverview,
                onOpenMemory,
                onOpenModelProviders,
                retainsDraft,
                onResolved,
                onOpenChat,
                onOpenBrowser,
            )
        }
    }
}

/** The transcript is on its way. Leaving is still possible while it is. */
@Composable
private fun OpeningThread(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(if (AppTheme.isDark) Color(0xFF121214) else Color(0xFFFFFFFF)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BackChevron(onBack = onBack)
        }
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
        }
    }
}

/** Every message id visible right now — the baseline a send records so the
 * fix panel can tell a failure of THIS send from one already in the log. */
private fun transcriptIds(rows: List<Message>): Set<String> = rows.mapTo(mutableSetOf()) { it.id }

@Composable
private fun LoadedChat(
    chat: Chat,
    state: CompanionState,
    onBack: () -> Unit,
    onOpenComputer: (String) -> Unit,
    onOpenOverview: (String) -> Unit,
    onOpenMemory: (String) -> Unit,
    onOpenModelProviders: () -> Unit,
    retainsDraft: (chatId: String) -> Boolean,
    onSelectTask: (ChatTarget) -> Unit,
    onOpenChat: (Chat) -> Unit,
    onOpenBrowser: (url: String, title: String?) -> Unit,
) {
    // This screen's selected task, independent of the desktop's selection.
    val threadId = chat.threadId
    val chatId = chat.id
    val draftKey = chat.threadId
    val environment = LocalCompanion.current
    val session = environment.session
    val dictation = environment.dictation
    val chatDrafts = environment.chatDrafts
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var threadOpenJob by remember { mutableStateOf<Job?>(null) }
    DisposableEffect(threadId) {
        onDispose { threadOpenJob?.cancel() }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    // Words this computer is holding until the running turn settles.
    val queuedSends = state.pendingQueued[threadId].orEmpty()
    val steeringInstanceIds by session.steeringInstanceIds.collectAsState()
    // Whether this bot's engine can take a message INTO the running turn.
    // Unknown reads as false, which is the promise that is always safe to
    // make: the message will be sent, just not necessarily right now.
    val steerTarget = (chat as? Chat.BotChat)?.bot
    val engineCanSteer = steerTarget?.modelSelection?.instanceId
        ?.let { it in steeringInstanceIds }
        ?: false
    // A Steer is in flight. Cleared when the queue drains or the turn ends,
    // whichever the engine gets to first — and after twenty seconds even if
    // neither frame ever arrives, because a control that spins for ever is
    // worse than one that admits it does not know.
    var steering by remember(threadId) { mutableStateOf(false) }
    LaunchedEffect(queuedSends.size, chat.busy) {
        if (queuedSends.isEmpty() || !chat.busy) steering = false
    }
    LaunchedEffect(steering) {
        if (steering) {
            delay(20_000)
            steering = false
        }
    }
    val steerNow: (() -> Unit)? = steerTarget?.let { target ->
        {
            haptics.play(HapticCue.SELECT)
            dictation.stop()
            steering = true
            scope.launch { session.interrupt(target) }
        }
    }
    var showingTasks by remember { mutableStateOf(false) }
    var showingGroupSettings by remember { mutableStateOf(false) }
    var creatingThread by remember(chatId) { mutableStateOf(false) }
    // Saveable: the profile form is a form, and a rotation must not throw away
    // what was typed into it — the sheet has to come back for that to matter.
    var showingProfile by rememberSaveable { mutableStateOf(false) }
    // …opened specifically for the model list, by a failure card's Change model.
    var showingModelPicker by rememberSaveable { mutableStateOf(false) }
    var showingPlus by remember(threadId) { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current

    val attachmentDraft = remember(draftKey, chatDrafts) {
        chatDrafts.register(chatId, draftKey)
        chatDrafts.attachments(draftKey)
    }
    val attachments = attachmentDraft.items
    var preparingAttachments by attachmentDraft.preparing
    var sendingMessage by attachmentDraft.sending
    var attachmentError by attachmentDraft.error
    // A notification can change owners while the system picker is open.
    // Its result still belongs to the draft that launched it.
    var pickerDraft by remember { mutableStateOf(attachmentDraft) }
    // A bot-linked file on its way from the computer, and where it landed.
    var openingFileName by remember(threadId) { mutableStateOf<String?>(null) }
    var fileOpenError by remember(threadId) { mutableStateOf<String?>(null) }
    var filePreview by remember(threadId) { mutableStateOf<FilePreviewItem?>(null) }
    var fileDownloadJob by remember(threadId) { mutableStateOf<Job?>(null) }
    var startingRoom by remember(threadId) { mutableStateOf(false) }
    val filePreviews = remember(context) { FilePreviews(context) }
    DisposableEffect(filePreviews) {
        onDispose {
            fileDownloadJob?.cancel()
            filePreviews.clear()
        }
    }
    DisposableEffect(filePreviews, threadId) {
        onDispose {
            // LoadedChat follows the bot when its task changes. Invalidate the
            // old request and its published preview as one lifecycle step; a
            // late completion can no longer write into the next task's UI.
            filePreviews.invalidateCurrent()
            fileDownloadJob?.cancel()
        }
    }
    val canAddAttachment = AttachmentImportRules.canAdd(attachments.size, preparingAttachments, sendingMessage)

    suspend fun importInto(target: ChatDraftHolder.Attachments, count: Int, read: suspend (Int, Int) -> PendingMessageAttachment) {
        if (target.preparing.value || target.sending.value) return
        val existing = target.items.toList()
        if (count > AttachmentPolicy.MAXIMUM_ITEMS - existing.size) {
            target.error.value = AttachmentImportRules.TOO_MANY
            return
        }
        target.preparing.value = true
        target.error.value = null
        try {
            val imported = mutableListOf<PendingMessageAttachment>()
            for (index in 0 until count) {
                val remaining = AttachmentImportRules.remainingBytes(existing + imported)
                val candidate = withContext(Dispatchers.IO) { read(index, remaining) }
                AttachmentPolicy.validate(existing + imported + candidate)
                imported += candidate
            }
            target.items += imported
            haptics.play(HapticCue.SELECT)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            target.error.value = error.message ?: "Couldn't add that attachment."
        } finally {
            target.preparing.value = false
        }
    }

    val pickPhotos = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(AttachmentPolicy.MAXIMUM_ITEMS),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val target = pickerDraft
        scope.launch {
            importInto(target, uris.size) { index, remaining ->
                AttachmentImport.readPhoto(context.contentResolver, uris[index], index, uris.size, remaining)
            }
        }
    }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val target = pickerDraft
        scope.launch {
            importInto(target, uris.size) { index, remaining ->
                AttachmentImport.readDocument(context.contentResolver, uris[index], remaining)
            }
        }
    }

    /** Every computer-local attachment takes the authenticated message-file route. */
    fun openFile(
        path: String,
        message: Message,
        prepared: DownloadedFile? = null,
        preferredName: String? = null,
        cacheResult: Boolean = false,
    ) {
        val requestGeneration = filePreviews.beginRequest()
        val requestedThreadId = threadId
        fileDownloadJob?.cancel()
        fileOpenError = null
        openingFileName = preferredName ?: prepared?.filename ?: FilePreviewRules.nameForOpening(path)
        fileDownloadJob = scope.launch {
            val fetched = prepared ?: session.downloadFile(
                requestedThreadId,
                message.id,
                path,
                cacheResult = cacheResult,
            )
            if (!filePreviews.isCurrent(requestGeneration)) return@launch
            openingFileName = null
            if (fetched == null) {
                fileOpenError = session.actionError ?: "Couldn't open that file. Try again."
                session.actionError = null
                return@launch
            }
            val item = try {
                // The tag's display name labels the card only. Materialising
                // and sharing must use the canonical Content-Disposition name
                // returned by the scoped download route.
                withContext(Dispatchers.IO) { filePreviews.store(fetched, requestGeneration) }
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (_: Throwable) {
                if (!filePreviews.isCurrent(requestGeneration)) return@launch
                fileOpenError = "The downloaded file couldn't be previewed."
                return@launch
            } ?: return@launch
            if (!filePreviews.isCurrent(requestGeneration)) return@launch
            filePreview = item
        }
    }

    // A tapped link in a bot reply: web links open in the native in-app browser
    // surface with navigation controls, a desktop path comes back through the
    // computer, anything else is refused out loud.
    fun openLink(url: String, message: Message) {
        when (val target = LocalMessageLink.resolve(url)) {
            is LocalMessageLink.Web -> onOpenBrowser(target.url, null)
            is LocalMessageLink.DesktopFile -> openFile(target.path, message)
            null -> fileOpenError = "This link can't be opened securely."
        }
    }

    fun openAttachment(
        attachment: DisplayedMessageAttachment,
        message: Message,
        downloaded: DownloadedFile?,
    ) = openFile(
        attachment.path,
        message,
        downloaded,
        preferredName = attachment.name,
        cacheResult = true,
    )

    // A chip that opened a thread on this bot switches this screen in place,
    // the way a thread row does; one that opened a thread on a teammate pushes
    // that chat.
    fun openThread(ref: ThreadRef) {
        threadOpenJob?.cancel()
        threadOpenJob = scope.launch {
            val bot = session.openThread(ref) ?: return@launch
            if (bot.id == chatId) onSelectTask(ChatTarget.Bot(bot.id, bot.threadId)) else onOpenChat(Chat.BotChat(bot))
        }
    }
    val focusedMessageId by session.focusedMessageId.collectAsState()

    val dictationListening by dictation.isListening.collectAsState()
    val dictationStarting by dictation.isStarting.collectAsState()
    val dictationError by dictation.error.collectAsState()
    val dictationLocked = dictationListening || dictationStarting

    val rawTranscript = remember(state, threadId) { state.visibleTranscript(threadId) }
    val activityDetail by environment.chatPreferences.activityDetail.collectAsState()
    val quickReplies by environment.chatPreferences.quickReplies.collectAsState()
    // The source transcript stays intact for approvals, mascot state and
    // pagination. Only the rendered rows fold activity according to the local
    // preference, so changing the choice never mutates server state.
    val transcript = remember(rawTranscript, activityDetail) {
        transcriptRows(rawTranscript, activityDetail)
    }
    // A failure whose cause is fixable (key, endpoint, model) becomes the
    // provider panel above the composer instead of the composer's one red
    // line. Two doors lead here: a send that threw, and a turn the harness
    // refused AFTER it was posted — the model/provider error the transcript
    // keeps as a failed activity chip.
    //
    // A row that carries a failure card is not one of these: the card is the
    // failure's own surface, drawn in the transcript with its own actions, and
    // two competing explanations of one failure is exactly what the card was
    // built to end. A computer too old to send the card still arrives here as
    // an "error:" chip, which is what this branch is now for.
    val turnIssue = remember(transcript) {
        transcript.asReversed().firstNotNullOfOrNull { row ->
            val rows = when (row) {
                is TranscriptRow.Single -> listOf(row.message)
                is TranscriptRow.ActivityRun -> row.items
            }
            rows.lastOrNull { message ->
                val tool = message.tool
                tool != null && tool.ok == false && tool.name.startsWith("error:") && message.failure == null
            }?.let { message ->
                val tool = message.tool ?: return@let null
                message.id to tool.name.removePrefix("error:").trim()
            }
        }
    }
    // What each failure card in this thread would run if its Retry were tapped,
    // keyed by the card's message id. Absent while the task is busy: there is
    // nothing to retry into a turn that is already running.
    val retrySources: Map<String, Message> = remember(rawTranscript, chat.busy) {
        if (chat.busy) {
            emptyMap()
        } else {
            rawTranscript.filter { it.failure != null }
                .mapNotNull { card -> RetryPlan.sourceFor(rawTranscript, card.id)?.let { card.id to it } }
                .toMap()
        }
    }
    // Dismissing the panel holds it shut for THIS failure; a new one arrives
    // under a new message id and opens the panel again.
    var dismissedTurnIssue by remember(threadId) { mutableStateOf<String?>(null) }
    // The transcript's message ids at the last send. A panel is armed by a send
    // — the moment a failure can actually be this screen's — and may then only
    // show a failure that send PRODUCED. Without this baseline, one old
    // "error:" chip anywhere in the transcript reopened the panel on every
    // send, even on a turn that answered perfectly. Null means no send on this
    // screen yet, so a screen opened onto a failed conversation shows history
    // as history.
    var sendBaseline by remember(threadId) { mutableStateOf<Set<String>?>(null) }
    val providerIssue = remember(fileOpenError, attachmentError, turnIssue, dismissedTurnIssue, sendBaseline) {
        val source = fileOpenError ?: attachmentError
            ?: turnIssue
                ?.takeIf { (id, _) -> sendBaseline?.contains(id) == false && id != dismissedTurnIssue }
                ?.second
        source?.let { ApiErrorRules.classify(it) }?.takeIf { it.configureProviders }
    }
    val predictiveChips = remember(quickReplies) {
        quickReplies.map { PredictiveChip(title = it.title, prompt = it.prompt, icon = it.icon) }
    }
    val streaming = state.streaming[threadId]
    val reasoning = state.reasoning[threadId]
    // Stream, then reasoning, then the bare fact of being busy — the order in
    // `ChatView.swift`, and the reason it is a rule rather than three `if`s here.
    val tail = LiveTail.of(streaming = streaming, reasoning = reasoning, busy = chat.busy)
    val liveText = streaming?.takeIf { tail == TranscriptTail.STREAM }
    val liveReasoning = reasoning?.takeIf { tail == TranscriptTail.REASONING }
    val hasMore = state.hasMore[threadId] == true
    // What stops the predictive chips from covering the one question on screen
    // that only a person can answer.
    val pendingApproval = remember(rawTranscript) {
        ComposerAccessories.hasPendingApproval(rawTranscript)
    }

    // One live composer per thread, including when an upload finishes after
    // switching away and back. Only typed text enters saved instance state;
    // dictation and attachments remain memory-only. Back clears this owner's
    // drafts, while a Computer push retains them.
    val heldOnEntry = remember(draftKey, chatDrafts) { chatDrafts.get(draftKey) }
    // Hoist the saver: building it inline in rememberSaveable reallocates the
    // Saver + both lambdas on every LoadedChat recomposition (partials included).
    val composerSaver = remember(draftKey, chatDrafts) {
        ChatComposerDraft.saver(draftKey, chatDrafts)
    }
    val composer = rememberSaveable(draftKey, chatDrafts, saver = composerSaver) {
        chatDrafts.composer(
            draftKey,
            initialSaveable = heldOnEntry?.typedSnapshot.orEmpty(),
        )
    }
    val draft = composer.text
    // The command HUD opens from the button *or* from a draft that starts with a
    // slash — and typing anything else closes it again. iOS drives that from
    // `onChange(of: draft)`, which fires however the draft moved, so the rule
    // lives in the one funnel every draft change goes through rather than in the
    // text field's callback alone.
    //
    // Seeded from the restored draft rather than from `false`: coming back from
    // Computer, or from a process death, is a mount and not an edit, so nothing
    // would ever re-apply the rule to a `/dif` that is already in the field.
    // Closing the HUD by hand still sticks — the seed runs once per mount, and
    // `remember` does not re-run it.
    var hudOpen by remember(draftKey, chatDrafts) {
        mutableStateOf(SlashCommands.openOnEntry(composer.text))
    }
    val listState = rememberLazyListState()

    fun publishFrom(composerDraft: ChatComposerDraft) {
        hudOpen = SlashCommands.opensOnDraft(composerDraft.text)
    }

    // Bind dictation to this chat's lifecycle: leaving the screen (including
    // pushing Computer) and process background both stop capture.
    DisposableEffect(lifecycleOwner, threadId) {
        dictation.bind(lifecycleOwner)
        onDispose { dictation.unbind(lifecycleOwner) }
    }

    // Drop the in-memory entry when the chat leaves the stack (roster pop or
    // stack rewrite). Keep it when Computer is pushed on top.
    DisposableEffect(chatId) {
        onDispose {
            if (!retainsDraft(chatId)) {
                chatDrafts.clearOwner(chatId)
            }
        }
    }

    // Always join against the text frozen at capture start. A newer partial
    // then replaces the older partial instead of duplicating it. Skip the
    // first emission: StateFlow replays a sticky transcript from a prior
    // session, and applying that on open would clobber this chat's draft.
    // Merged text stays in the volatile draft / holder — never in the
    // saveable typed snapshot.
    LaunchedEffect(threadId, dictation) {
        var first = true
        dictation.transcript.collect { next ->
            if (first) {
                first = false
                return@collect
            }
            val merged = Dictation.draft(base = dictation.base, transcript = next)
            composer.onDictation(merged)
            publishFrom(composer)
        }
    }
    LaunchedEffect(dictationListening) {
        if (dictationListening) focusManager.clearFocus()
    }
    // Stop when computer / tasks / profile / plus open — matching ChatView.swift.
    LaunchedEffect(showingPlus) { if (showingPlus) dictation.stop() }
    LaunchedEffect(showingTasks) { if (showingTasks) dictation.stop() }
    LaunchedEffect(showingProfile) { if (showingProfile) dictation.stop() }

    // Opening a chat is what marks it read, exactly as on the desktop — and a
    // message can arrive while it is already on screen, so this keys on the bit
    // rather than running once.
    LaunchedEffect(threadId, chat.unread) {
        if (chat.unread) session.markRead(chat)
    }
    // A non-resumable reconnect replaces the fleet snapshot and invalidates
    // history for nonactive threads. The open chat's ID has not changed, but
    // it must fetch its page again instead of waiting for the user to reopen it.
    LaunchedEffect(threadId, state.hasLoadedPage(threadId)) {
        session.loadThreadIfNeeded(threadId)
    }

    // Filter out tool activity chips and failure dashboards from normal conversation
    val visibleConversationRows = remember(transcript) {
        transcript.filter { row ->
            when (row) {
                is TranscriptRow.Single -> row.message.kind != Message.Kind.ACTIVITY
                is TranscriptRow.ActivityRun -> false
            }
        }
    }

    val headerCount = if (hasMore) 1 else 0
    // One slot at the bottom, whichever of the three is in it — iOS gives all of
    // them the same `.id(Self.liveBubbleId)` for the same reason: they replace
    // one another, they do not stack.
    val liveCount = if (tail == TranscriptTail.NONE) 0 else 1
    val itemCount = headerCount + visibleConversationRows.size + liveCount

    // A conversation grows from the bottom: opening a chat starts on the newest
    // message rather than the oldest.
    var settled by remember(threadId) { mutableStateOf(false) }
    LaunchedEffect(threadId, itemCount) {
        if (settled || itemCount == 0) return@LaunchedEffect
        listState.scrollToItem(itemCount - 1)
        settled = true
    }
    LaunchedEffect(threadId, visibleConversationRows.lastOrNull()?.id) {
        if (!settled || itemCount == 0) return@LaunchedEffect
        listState.animateScrollToItem(itemCount - 1)
    }
    // Follow the live row: its arrival, its change of kind, and the text inside
    // it. Keyed on length rather than the string so this fires once per delta
    // batch, and without animation — animating every token turns a smooth stream
    // into a stutter. [tail] is a key of its own because the working row appears
    // with no text at all, and a row nobody scrolls to is a row nobody is told
    // about.
    LaunchedEffect(threadId, tail, liveText?.length ?: 0) {
        if (liveCount == 0 || itemCount == 0) return@LaunchedEffect
        listState.scrollToItem(itemCount - 1)
    }
    // A search hit lands on its message.
    LaunchedEffect(focusedMessageId, visibleConversationRows.size) {
        val target = focusedMessageId ?: return@LaunchedEffect
        val index = visibleConversationRows.indexOfFirst { row -> row.id == target }
        if (index < 0) return@LaunchedEffect
        listState.scrollToItem(headerCount + index)
        session.consumeFocus(target)
        settled = true
    }

    val bot = (chat as? Chat.BotChat)?.bot
    // The computer is bot-only; a non-DM room exposes task navigation when the
    // paired desktop supplied a task list. Both answers are constants.
    val commands = SlashCommands.forChat(chat)
    // One handler for the one door. The name pill stopped being the second when
    // it became the way into a bot's profile, so the + now carries every action
    // there is — including both export formats.
    val onAction: (ChatActionId) -> Unit = { action ->
        when (action) {
            ChatActionId.PHOTOS -> {
                pickerDraft = attachmentDraft
                pickPhotos.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            }
            ChatActionId.FILES -> {
                pickerDraft = attachmentDraft
                pickFiles.launch(
                (AttachmentPolicy.IMAGE_MIME_TYPES + AttachmentPolicy.DOCUMENT_MIME_TYPES).toTypedArray(),
                )
            }
            ChatActionId.NEW_TASK -> if (!creatingThread && TaskRules.canCreate(chat)) {
                creatingThread = true
                scope.launch {
                    try {
                        val created = when (chat) {
                            is Chat.BotChat -> session.createTask(chat.bot, null)?.let(Chat::BotChat)
                            is Chat.RoomChat -> if (chat.supportsTasks) session.createTask(chat.room, null)
                                ?.let(Chat::RoomChat) else null
                        }
                        if (created == null) {
                            attachmentError = session.actionError ?: "Couldn't create this thread. Try again."
                            session.actionError = null
                        } else onSelectTask(created.target)
                    } finally {
                        creatingThread = false
                    }
                }
            }
            ChatActionId.TASKS -> showingTasks = true
            ChatActionId.WATCH_COMPUTER -> {
                // iOS stops on showingComputer; Android leaves ChatScreen when
                // Computer is pushed, but stop here too so capture ends before
                // the navigation frame, not only on dispose.
                dictation.stop()
                if (bot != null) onOpenComputer(bot.id)
            }
            ChatActionId.SETTINGS -> if (bot != null) showingProfile = true
            ChatActionId.SHARE_MARKDOWN -> share(scope, environment, threadId, ShareFormat.MARKDOWN)
            ChatActionId.SHARE_JSON -> share(scope, environment, threadId, ShareFormat.JSON)
            ChatActionId.INTERRUPT -> if (bot != null) scope.launch { session.interrupt(bot) }
        }
        Unit
    }

    // A slash command that navigates clears the draft the way emptying the
    // field does — including its provenance, so a spoken word cannot outlive it.
    fun clearDraft() {
        composer.onTypedChange("")
        publishFrom(composer)
    }

    /**
     * The port of iOS `submit(_ explicitText:)`. A command or a chip sends its
     * own prompt and still clears the composer, exactly as the Swift does: the
     * `/dif` you had half-typed is what you were asking for, and leaving it
     * behind would send it again on the next tap of the send button.
     */
    fun submit(explicitText: String? = null) {
        // Cancels an in-flight permission prompt before it can open the
        // microphone after the message has already been sent.
        dictation.stop()
        val text = (explicitText ?: draft).trim()
        // With attachments waiting, the message is the attachments plus
        // whatever was typed; the draft is cleared only once they are sent.
        if (attachments.isNotEmpty()) {
            if (preparingAttachments || sendingMessage) return
            val outgoing = attachments.toList()
            val draftAtSend = draft
            sendingMessage = true
            attachmentError = null
            showingPlus = false
            // Same arming as a text-only send: what fails now belongs here.
            sendBaseline = transcriptIds(rawTranscript)
            dismissedTurnIssue = null
            scope.launch {
                val sent = try {
                    session.send(text, outgoing, chat)
                } finally {
                    sendingMessage = false
                }
                if (!sent) {
                    attachmentError = session.actionError ?: "Couldn't send this message. Try again."
                    session.actionError = null
                    return@launch
                }
                // Compare with what was in the field at tap time, so a newer
                // edit made while uploading survives the clear.
                if (composer.text == draftAtSend) {
                    composer.onSend()
                    publishFrom(composer)
                }
                if (attachments.map { it.id } == outgoing.map { it.id }) attachments.clear()
                haptics.play(HapticCue.SEND)
            }
            return
        }
        if (text.isEmpty()) return
        composer.onSend()
        // Clearing the draft closes the HUD through the rule above, which is
        // how iOS's `showCommandHUD = false` on submit happens as well.
        publishFrom(composer)
        // Where iOS plays `SoundEffects.playSent()` and a medium impact. The
        // motor only: the sound there is an Apple system id with no counterpart
        // here, and the keyboard already owns that job on this platform.
        haptics.play(HapticCue.SEND)
        // A send arms the fix panel and reopens it for a fresh failure: what
        // follows is this screen's own outcome, not the transcript's history.
        sendBaseline = transcriptIds(rawTranscript)
        dismissedTurnIssue = null
        // Deliberately not disabled while the bot is busy: the harness answers
        // 409 and Session surfaces "The bot is busy — stop it first." That is a
        // clearer answer than a dead button.
        scope.launch {
            session.actionError = null
            session.send(text, chat)
            session.actionError?.let { message ->
                // A send that failed BEFORE the harness accepted it belongs to
                // this conversation: the composer's red line — or, when the
                // cause is a provider setting, the fix panel — instead of a
                // global dialog the chat can't act on.
                attachmentError = message
                session.actionError = null
            }
        }
    }

    fun selectCommand(command: SlashCommand) {
        // Null for a command that sends: `submit` below plays the send cue, and
        // two effects back to back on one gesture are one muddled buzz.
        CompanionHaptics.forCommand(command.effect)?.let { haptics.play(it) }
        when (val effect = command.effect) {
            SlashEffect.OpenComputer -> {
                // Stop before clearing, not after: a partial still in flight
                // would land on the draft this just emptied. iOS stops on
                // `showingComputer`; Android leaves ChatScreen when Computer is
                // pushed, so stop here too — before the navigation frame, not
                // only on dispose.
                dictation.stop()
                clearDraft()
                if (bot != null) onOpenComputer(bot.id)
            }

            SlashEffect.OpenTasks -> {
                dictation.stop()
                clearDraft()
                showingTasks = true
            }

            SlashEffect.Stop -> {
                dictation.stop()
                clearDraft()
                if (bot != null && chat.busy) scope.launch { session.interrupt(bot) }
            }

            SlashEffect.NewThread -> if (!creatingThread && TaskRules.canCreate(chat)) {
                creatingThread = true
                scope.launch {
                    try {
                        val created = when (chat) {
                            is Chat.BotChat -> session.createTask(chat.bot, null)?.let(Chat::BotChat)
                            is Chat.RoomChat -> if (chat.supportsTasks) session.createTask(chat.room, null)
                                ?.let(Chat::RoomChat) else null
                        }
                        if (created == null) {
                            attachmentError = session.actionError ?: "Couldn't create this thread. Try again."
                            session.actionError = null
                        } else {
                            dictation.stop()
                            clearDraft()
                            onSelectTask(created.target)
                        }
                    } finally {
                        creatingThread = false
                    }
                }
            }

            is SlashEffect.Send -> submit(effect.prompt)
        }
        hudOpen = false
    }

    /**
     * Closing takes back the `/` that opened the HUD and nothing else. Routed
     * around [publishFrom] when the draft did not change, because re-applying
     * the open rule to an unchanged `/dif` would reopen what was just closed.
     */
    fun closeHud() {
        val next = SlashCommands.draftAfterClose(draft)
        if (next != draft) {
            composer.onTypedChange(next)
            publishFrom(composer)
        }
        hudOpen = false
    }

    // Clear draft while still composed so rememberSaveable does not resurrect
    // it after a roster pop. Computer push never takes this path.
    fun leaveToRoster() {
        composer.onLeaveToRoster()
        publishFrom(composer)
        onBack()
    }

    BackHandler(enabled = showingPlus) { showingPlus = false }
    // Back dismisses an open panel before it leaves the screen — the platform's
    // own gesture, applied to the HUD the way it already was to the + sheet.
    BackHandler(enabled = !showingPlus && hudOpen) { closeHud() }
    BackHandler(enabled = !showingPlus && !hudOpen) { leaveToRoster() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(if (AppTheme.isDark) Color(0xFF121214) else Color(0xFFFFFFFF)),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    // Tapping the transcript puts the keyboard away, the way
                    // it does on iOS. `detectTapGestures` and not `clickable`:
                    // the transcript is not a button, so it should not answer
                    // to TalkBack as one, and a tap a row has already taken —
                    // a link, a card button — never reaches this far.
                    .pointerInput(Unit) {
                        detectTapGestures { focusManager.clearFocus() }
                    },
            ) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .widthIn(max = CHAT_CONTENT_MAX_WIDTH)
                        .fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        // Room for the floating face when scrolled to the top.
                        top = HEADER_CLEARANCE,
                        bottom = 12.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (hasMore) {
                        item(key = LOAD_EARLIER_KEY) {
                            TextButton(
                                onClick = {
                                    // Keep the reader where they were: after older
                                    // messages are prepended, sit back on the one
                                    // that used to be at the top.
                                    val anchor = visibleConversationRows.firstOrNull()?.id
                                    scope.launch {
                                        session.loadOlder(threadId)
                                        if (anchor == null) return@launch
                                        val fresh = session.state.value
                                        val freshRows = transcriptRows(
                                            fresh.visibleTranscript(threadId),
                                            activityDetail,
                                        ).filter { row ->
                                            when (row) {
                                                is TranscriptRow.Single -> row.message.kind != Message.Kind.ACTIVITY
                                                is TranscriptRow.ActivityRun -> false
                                            }
                                        }
                                        val index = freshRows.indexOfFirst { row -> row.id == anchor }
                                        if (index < 0) return@launch
                                        // The "load earlier" row is item 0 for as
                                        // long as there is still more to fetch.
                                        val offset = if (fresh.hasMore[threadId] == true) 1 else 0
                                        listState.scrollToItem(index + offset)
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Load earlier messages", fontSize = 13.sp)
                            }
                        }
                    }

                    itemsIndexedKeyed(visibleConversationRows) { index, message ->
                        when (message) {
                            is TranscriptRow.Single -> MessageRow(
                                chat = chat,
                                message = message.message,
                                // One tail per run of bubbles from the same author,
                                // not one per bubble.
                                endsRun = TranscriptLayout.endsRowRun(visibleConversationRows, index),
                                openLink = ::openLink,
                                openAttachment = ::openAttachment,
                                openThread = ::openThread,
                                // A failed turn's own actions. Retry appears only
                                // when there is a request to run again; Change
                                // model only for a bot, and Provider settings
                                // always, because the card decides per kind which
                                // of them is worth offering.
                                turnRetry = retrySources[message.message.id]?.let { source ->
                                    { scope.launch { session.retryTurn(chat, source) } }
                                },
                                changeModel = if (bot != null) {
                                    {
                                        showingModelPicker = true
                                        showingProfile = true
                                    }
                                } else {
                                    null
                                },
                                openProviders = onOpenModelProviders,
                                onPromptAction = ::submit,
                            )
                            is TranscriptRow.ActivityRun -> Unit
                        }
                    }

                    if (liveCount == 1) {
                        item(key = LIVE_BUBBLE_KEY) {
                            if (tail == TranscriptTail.WORKING) {
                                WorkingBubble(name = chat.name, color = chat.color)
                            } else {
                                StreamingBubble(text = liveText, reasoning = liveReasoning)
                            }
                        }
                    }
                }

                if (visibleConversationRows.isEmpty() && liveCount == 0) {
                    ChatEmptyState(
                        chat = chat,
                        face = remember(chat, rawTranscript) {
                            MausState.forChat(chat, rawTranscript.lastOrNull())
                        },
                        onStarterPrompt = { prompt ->
                            composer.onTypedChange(prompt)
                            publishFrom(composer)
                        },
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(top = HEADER_CLEARANCE),
                    )
                }

                val currentMood = remember(chat.busy, pendingApproval, reasoning, rawTranscript) {
                    val lastMsg = rawTranscript.lastOrNull()
                    BotMoodRules.resolve(
                        busy = chat.busy,
                        hasPendingApproval = pendingApproval,
                        hasReasoning = !reasoning.isNullOrBlank(),
                        toolName = lastMsg?.tool?.name,
                        lastMessage = lastMsg,
                    )
                }

                ChatHeader(
                    chat = chat,
                    lastActivityAt = rawTranscript.lastOrNull()?.at ?: 0.0,
                    face = remember(chat, rawTranscript) {
                        MausState.forChat(chat, rawTranscript.lastOrNull())
                    },
                    mood = currentMood,
                    unreadElsewhere = remember(state, chat) {
                        (state.unreadCount - if (chat.unread) 1 else 0).coerceAtLeast(0)
                    },
                    onRetryTurn = if (retrySources.isNotEmpty()) {
                        {
                            retrySources.values.lastOrNull()?.let { source ->
                                scope.launch { session.retryTurn(chat, source) }
                            }
                        }
                    } else null,
                    onBack = { leaveToRoster() },
                    onOpenThreads = {
                        dictation.stop()
                        focusManager.clearFocus()
                        showingTasks = true
                    },
                    onWatchComputer = {
                        dictation.stop()
                        if (bot != null) onOpenComputer(bot.id)
                    },
                    // A room's header is the door to the room's OWN settings —
                    // name, members, bulletin, who answers. It must never lead
                    // to a single bot's model pickers: a group has no one model.
                    onOpenRoomSettings = {
                        dictation.stop()
                        focusManager.clearFocus()
                        showingGroupSettings = true
                    },
                    // A bot's face and its name pill are both the door to its
                    // profile; a room has no profile, so its pill opens room
                    // settings.
                    onOpenProfile = {
                        if (bot != null) {
                            showingProfile = true
                        } else {
                            dictation.stop()
                            focusManager.clearFocus()
                            showingGroupSettings = true
                        }
                    },
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .widthIn(max = CHAT_CONTENT_MAX_WIDTH),
                )
            }

            // Setup and provider fixes render here, in the conversation that
            // hit the problem, above the composer they unblock.
            val room = (chat as? Chat.RoomChat)?.room
            if (room != null && room.setupPending == true) {
                RoomSetupPanel(
                    room = room,
                    busy = startingRoom,
                    onSubmit = { bulletin, everyone ->
                        if (!startingRoom) {
                            startingRoom = true
                            scope.launch {
                                session.finishRoomSetup(room, bulletin, everyone)
                                startingRoom = false
                            }
                        }
                    },
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .widthIn(max = CHAT_CONTENT_MAX_WIDTH),
                )
            }
            if (providerIssue != null) {
                ProviderFixPanel(
                    classification = providerIssue,
                    onOpenProviders = {
                        fileOpenError = null
                        attachmentError = null
                        dismissedTurnIssue = turnIssue?.first
                        onOpenModelProviders()
                    },
                    onDismiss = {
                        fileOpenError = null
                        attachmentError = null
                        dismissedTurnIssue = turnIssue?.first
                    },
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .widthIn(max = CHAT_CONTENT_MAX_WIDTH),
                )
            }
            Composer(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .widthIn(max = CHAT_CONTENT_MAX_WIDTH),
                name = chat.name,
                draft = draft,
                accessory = ComposerAccessories.accessory(
                    hudOpen = hudOpen,
                    draft = draft,
                    busy = chat.busy,
                    pendingApproval = pendingApproval,
                    hasQuickReplies = false,
                    hasAttachments = attachments.isNotEmpty(),
                ),
                commands = commands,
                chips = predictiveChips,
                plusOpen = showingPlus,
                dictationListening = dictationListening,
                dictationLocked = dictationLocked,
                dictationError = dictationError,
                attachments = attachments,
                sending = sendingMessage,
                preparing = preparingAttachments,
                busy = chat.busy,
                onInterrupt = if (chat.busy) { { if (bot != null) scope.launch { session.interrupt(bot) } } } else null,
                engineCanSteer = engineCanSteer,
                queuedSends = queuedSends,
                steering = steering,
                onSteer = steerNow,
                onCancelQueued = { queued ->
                    scope.launch { session.cancelQueued(queued, chat) }
                },
                openingFileName = openingFileName,
                // A provider-class failure is shown by the panel above, not
                // twice; everything else keeps the composer's own line.
                attachmentError = if (providerIssue != null) null else fileOpenError ?: attachmentError,
                onRemoveAttachment = { attachment ->
                    if (!preparingAttachments && !sendingMessage) {
                        attachments.removeAll { it.id == attachment.id }
                        attachmentError = null
                    }
                },
                onDismissError = {
                    fileOpenError = null
                    attachmentError = null
                },
                onTogglePlus = {
                    // iOS drops the composer's focus before the sheet rises; a
                    // keyboard under it would leave the sheet nowhere to go.
                    dictation.stop()
                    if (!showingPlus) focusManager.clearFocus()
                    showingPlus = !showingPlus
                },
                onDraftChange = { next ->
                    if (dictationLocked) return@Composer
                    composer.onTypedChange(next)
                    publishFrom(composer)
                },
                onToggleDictation = {
                    focusManager.clearFocus()
                    dictation.toggle(capturing = draft)
                },
                onSend = { submit() },
                onToggleHud = {
                    dictation.stop()
                    haptics.play(HapticCue.SELECT)
                    hudOpen = !hudOpen
                },
                // The button, not the back gesture — `closeHud` is also what the
                // BackHandler calls, and Android already gives back its own feel.
                onCloseHud = {
                    haptics.play(HapticCue.SELECT)
                    closeHud()
                },
                onSelectCommand = { selectCommand(it) },
                // A chip is the whole message, sent on the tap.
                onSelectChip = { submit(it.prompt) },
            )
        }

        PlusSheet(
            open = showingPlus,
            actions = remember(chat, pendingApproval, canAddAttachment) {
                ChatActions.sheet(chat, hasPendingApproval = pendingApproval, canAddAttachment = canAddAttachment)
            },
            onDismiss = { showingPlus = false },
            onAction = {
                showingPlus = false
                onAction(it)
            },
        )
    }

    if (showingTasks) {
        if (chat.supportsTasks) TaskSheet(chat = chat, onDismiss = { showingTasks = false }, onSelectTask = onSelectTask, onDeletedCurrent = onBack)
    }

    if (showingGroupSettings) {
        val roomSettings = (chat as? Chat.RoomChat)?.room
        if (roomSettings != null) {
            GroupSettingsSheet(
                room = roomSettings,
                onDismiss = { showingGroupSettings = false },
                // The room is gone; the conversation under this sheet no
                // longer exists, so the screen leaves the way a deleted
                // thread's does — one pop, back to the roster.
                onDeleted = onBack,
            )
        }
    }

    if (showingProfile && bot != null) {
        AgentProfileSheet(
            bot = bot,
            onDismiss = {
                showingProfile = false
                showingModelPicker = false
            },
            onOpenOverview = {
                onOpenOverview(it)
            },
            onOpenMemory = {
                onOpenMemory(it)
                showingProfile = false
                showingModelPicker = false
            },
            // A failure card asked for this sheet because its remedy is a
            // different model, so it opens on the list rather than on the
            // profile the person would then have to scroll.
            openModelPicker = showingModelPicker,
        )
    }

    filePreview?.let { item ->
        FilePreviewSheet(
            item = item,
            onDismiss = {
                filePreview = null
                scope.launch(Dispatchers.IO) { filePreviews.dismiss(item) }
            },
            onShare = { filePreviews.share(item) },
            onOpen = { filePreviews.openWithSystem(item) },
            onOpenBrowser = { onOpenBrowser(it, null) },
        )
    }
}

private fun share(
    scope: kotlinx.coroutines.CoroutineScope,
    environment: CompanionEnvironment,
    threadId: String,
    format: ShareFormat,
) {
    scope.launch {
        val session = environment.session
        val exported = session.export(threadId, format.wire) ?: return@launch
        environment.shareTranscript(exported, format)?.let { session.actionError = it }
    }
}

private const val LOAD_EARLIER_KEY = "companion.loadEarlier"
private const val LIVE_BUBBLE_KEY = "companion.live"
/** The chat's content column. Shared with the transcript's own cards (the
 * failure card), which sit in the same column as the chrome around them. */
internal val CHAT_CONTENT_MAX_WIDTH = 840.dp

/** `itemsIndexed` with the message id as the key — one call site, one helper. */
private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexedKeyed(
    messages: List<TranscriptRow>,
    content: @Composable (Int, TranscriptRow) -> Unit,
) {
    items(
        count = messages.size,
        key = { messages[it].id },
        itemContent = { index -> content(index, messages[index]) },
    )
}

// The strip the top controls sit on, and the air the transcript needs below the
// name pill before its first row.
private val HEADER_BAR = 56.dp
private val HEADER_CLEARANCE = 72.dp

/**
 * Back on the left with the rest-of-app unread count, the bot's computer on the
 * right, and the bot itself between them over its name.
 *
 * Modern solid header bar with a subtle hairline bottom border so transcripts
 * scroll cleanly under it without blurry gradient scrims.
 */
@Composable
private fun ChatEmptyState(
    chat: Chat,
    face: MausState,
    onStarterPrompt: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(AppTheme.colors.surfaceRaised)
                .border(1.dp, AppTheme.colors.subtleBorder, RoundedCornerShape(20.dp)),
            contentAlignment = Alignment.Center,
        ) {
            ChatAvatar(
                chat = chat,
                size = 54.dp,
                state = face,
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = chat.name,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textPrimary,
        )
        val tagline = chat.subtitle.ifBlank { "Standing by" }
        Spacer(Modifier.height(6.dp))
        Text(
            text = tagline,
            style = MaterialTheme.typography.bodyMedium,
            color = AppTheme.colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(28.dp))
        val starters = listOf(
            "Inspect workspace status",
            "Review recent changes",
            "Search documentation",
        )
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            starters.forEach { prompt ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(AppTheme.colors.surfaceRaised)
                        .border(1.dp, AppTheme.colors.subtleBorder, RoundedCornerShape(14.dp))
                        .clickable { onStarterPrompt(prompt) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = prompt,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = AppTheme.colors.textPrimary,
                    )
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = AppTheme.colors.textTertiary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatHeader(
    chat: Chat,
    face: MausState,
    mood: BotMood = BotMood.READY,
    unreadElsewhere: Int,
    lastActivityAt: Double = 0.0,
    onRetryTurn: (() -> Unit)? = null,
    onBack: () -> Unit,
    onWatchComputer: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenThreads: () -> Unit,
    onOpenRoomSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val surface = if (AppTheme.isDark) Color(0xFF121214) else Color(0xFFFFFFFF)
    var menuExpanded by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(surface)
            .padding(bottom = 2.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 10.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BackChevron(onBack = onBack)
            ChatIdentity(
                chat = chat,
                face = face,
                mood = mood,
                lastActivityAt = lastActivityAt,
                onOpenProfile = onOpenProfile,
                onOpenThreads = onOpenThreads,
                onOpenRoomSettings = onOpenRoomSettings,
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 8.dp),
            )
            Box {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(if (AppTheme.isDark) Color(0xFF222226) else Color(0xFFF4F4F6))
                        .clickable(
                            role = Role.Button,
                            onClickLabel = "More options",
                            onClick = { menuExpanded = true },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_more_horiz),
                        contentDescription = "More options",
                        tint = if (AppTheme.isDark) Color(0xFFE0E0E6) else Color(0xFF1A1A1A),
                        modifier = Modifier.size(18.dp),
                    )
                }
                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false },
                    modifier = Modifier
                        .background(AppTheme.colors.surfaceRaised)
                        .border(1.dp, AppTheme.colors.subtleBorder, RoundedCornerShape(12.dp)),
                ) {
                    if (onRetryTurn != null) {
                        DropdownMenuItem(
                            text = { Text("Retry turn", color = AppTheme.colors.textPrimary) },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Filled.Refresh,
                                    contentDescription = null,
                                    tint = AppTheme.colors.textSecondary,
                                    modifier = Modifier.size(18.dp),
                                )
                            },
                            onClick = {
                                menuExpanded = false
                                onRetryTurn()
                            },
                        )
                    }
                    if (chat is Chat.BotChat) {
                        DropdownMenuItem(
                            text = { Text("Watch computer", color = AppTheme.colors.textPrimary) },
                            leadingIcon = {
                                Icon(
                                    painter = painterResource(R.drawable.ic_display),
                                    contentDescription = null,
                                    tint = AppTheme.colors.textSecondary,
                                    modifier = Modifier.size(18.dp),
                                )
                            },
                            onClick = {
                                menuExpanded = false
                                onWatchComputer()
                            },
                        )
                    }
                    if (chat.supportsTasks) {
                        DropdownMenuItem(
                            text = { Text("Threads", color = AppTheme.colors.textPrimary) },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.List,
                                    contentDescription = null,
                                    tint = AppTheme.colors.textSecondary,
                                    modifier = Modifier.size(18.dp),
                                )
                            },
                            onClick = {
                                menuExpanded = false
                                onOpenThreads()
                            },
                        )
                    }
                    DropdownMenuItem(
                        text = {
                            Text(
                                if (chat is Chat.BotChat) "Bot settings" else "Room settings",
                                color = AppTheme.colors.textPrimary,
                            )
                        },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Filled.Settings,
                                contentDescription = null,
                                tint = AppTheme.colors.textSecondary,
                                modifier = Modifier.size(18.dp),
                            )
                        },
                        onClick = {
                            menuExpanded = false
                            if (chat is Chat.BotChat) onOpenProfile() else onOpenRoomSettings()
                        },
                    )
                }
            }
        }
    }
}

/**
 * Clean back chevron button matching Grok.
 */
@Composable
private fun BackChevron(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onBack),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = "Back",
            tint = if (AppTheme.isDark) Color(0xFFE0E0E6) else Color(0xFF1A1A1A),
            modifier = Modifier.size(24.dp),
        )
    }
}

/**
 * Who this conversation is with: mascot face, bot name, and timestamp underneath matching Grok.
 */
@Composable
private fun ChatIdentity(
    chat: Chat,
    face: MausState,
    mood: BotMood = BotMood.READY,
    lastActivityAt: Double = 0.0,
    onOpenProfile: () -> Unit,
    onOpenThreads: () -> Unit,
    onOpenRoomSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasThreads = chat.supportsTasks
    val timeStamp = remember(lastActivityAt) {
        if (lastActivityAt > 0) {
            RelativeStamp.separator(lastActivityAt, System.currentTimeMillis())
        } else {
            RelativeStamp.separator(System.currentTimeMillis().toDouble(), System.currentTimeMillis())
        }
    }
    val subtitleText = when {
        chat.busy -> when (mood) {
            BotMood.RESEARCHING -> "Searching…"
            BotMood.WORKING -> "Working…"
            else -> "Thinking…"
        }
        hasThreads && (chat as? Chat.BotChat)?.bot?.tasks?.isNotEmpty() == true -> chat.threadTitle
        chat.subtitle.isNotBlank() -> chat.subtitle
        (chat as? Chat.BotChat)?.bot?.title?.isNotBlank() == true -> (chat as Chat.BotChat).bot.title
        timeStamp.isNotEmpty() -> timeStamp
        else -> "Active"
    }
    val subtitleColor = Color(0xFF8E8E93)

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clickable(
                    role = Role.Button,
                    onClickLabel = if (chat is Chat.BotChat) "Open ${chat.name} settings" else "Open room settings",
                    onClick = if (chat is Chat.BotChat) onOpenProfile else onOpenRoomSettings,
                ),
            contentAlignment = Alignment.Center,
        ) {
            ChatAvatar(
                chat = chat,
                size = 36.dp,
                state = face,
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(AppRadii.small))
                .clickable(
                    role = Role.Button,
                    onClickLabel = if (hasThreads) "Switch thread" else "Open ${chat.name} chat options",
                    onClick = when {
                        chat is Chat.BotChat -> if (hasThreads) onOpenThreads else onOpenProfile
                        else -> onOpenRoomSettings
                    },
                ),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            Text(
                text = chat.name,
                style = MaterialTheme.typography.titleMedium,
                fontSize = 17.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (AppTheme.isDark) Color(0xFFF5F5F7) else Color(0xFF111111),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitleText,
                style = MaterialTheme.typography.bodySmall,
                fontSize = 12.sp,
                color = subtitleColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * What the composer's + opens: the things you can do here, each with a line
 * saying what it does. Rises above the composer; tapping anywhere else, the back
 * gesture, or the × the + became, puts it away.
 */
@Composable
private fun BoxScope.PlusSheet(
    open: Boolean,
    actions: List<ChatAction>,
    onDismiss: () -> Unit,
    onAction: (ChatActionId) -> Unit,
) {
    AnimatedVisibility(
        visible = open,
        enter = fadeIn(tween(PLUS_MILLIS)),
        exit = fadeOut(tween(PLUS_MILLIS)),
        modifier = Modifier.matchParentSize(),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.35f))
                // The scrim is a dismissal, not a control: no ripple, and the
                // back gesture does the same thing for anyone not using touch.
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    role = Role.Button,
                    onClick = onDismiss,
                )
                .semantics { contentDescription = "Close" },
        )
    }

    AnimatedVisibility(
        visible = open,
        enter = slideInVertically(tween(PLUS_MILLIS)) { it / 2 } + fadeIn(tween(PLUS_MILLIS)),
        exit = slideOutVertically(tween(PLUS_MILLIS)) { it / 2 } + fadeOut(tween(PLUS_MILLIS)),
        modifier = Modifier
            .align(Alignment.BottomStart)
            .padding(start = 12.dp, end = 44.dp, bottom = 70.dp),
    ) {
        Column(
            modifier = Modifier
                .background(AppTheme.colors.surface, RoundedCornerShape(PLUS_SHEET_RADIUS))
                .border(1.dp, AppTheme.colors.subtleBorder, RoundedCornerShape(PLUS_SHEET_RADIUS))
                .clip(RoundedCornerShape(PLUS_SHEET_RADIUS))
                .padding(vertical = 10.dp),
        ) {
            actions.forEach { action ->
                val tint = if (action.destructive) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurface
                }
                val alpha = if (action.enabled) 1f else 0.45f
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 64.dp)
                        .clickable(
                            enabled = action.enabled,
                            role = Role.Button,
                            onClick = { onAction(action.id) },
                        )
                        .padding(horizontal = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .background(
                                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f * alpha),
                                CircleShape,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        ChatActionIcon(id = action.id, tint = tint.copy(alpha = alpha))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = action.title,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Medium,
                            color = tint.copy(alpha = alpha),
                        )
                        Text(
                            text = action.subtitle,
                            fontSize = 13.sp,
                            color = secondaryTint.copy(alpha = alpha),
                        )
                    }
                }
            }
        }
    }
}

private const val PLUS_MILLIS = 280
private val PLUS_SHEET_RADIUS = 24.dp

/** The + becomes an ×. */
private const val PLUS_TURN_DEGREES = 45f

/** A quiet progress line above the field — `ProgressView` plus a caption on iOS. */
@Composable
private fun ComposerStatusLine(text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp)
            .semantics(mergeDescendants = true) { },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
        Text(text = text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = secondaryTint, maxLines = 1)
    }
}

/**
 * The glyph beside an action. Decorative: the row's own text is the label, and
 * TalkBack reading the icon too would say everything twice.
 */
@Composable
private fun ChatActionIcon(id: ChatActionId, tint: Color) {
    val modifier = Modifier.size(22.dp)
    when (id) {
        ChatActionId.PHOTOS ->
            Icon(painterResource(R.drawable.ic_photo), null, tint = tint, modifier = modifier)
        ChatActionId.FILES ->
            Icon(painterResource(R.drawable.ic_attach_file), null, tint = tint, modifier = modifier)
        ChatActionId.NEW_TASK ->
            Icon(Icons.Filled.Add, null, tint = tint, modifier = modifier)
        ChatActionId.TASKS ->
            Icon(Icons.AutoMirrored.Filled.List, null, tint = tint, modifier = modifier)
        ChatActionId.WATCH_COMPUTER ->
            Icon(painterResource(R.drawable.ic_display), null, tint = tint, modifier = modifier)
        ChatActionId.SETTINGS ->
            Icon(Icons.Filled.Settings, null, tint = tint, modifier = modifier)
        ChatActionId.SHARE_MARKDOWN, ChatActionId.SHARE_JSON ->
            Icon(Icons.Filled.Share, null, tint = tint, modifier = modifier)
        ChatActionId.INTERRUPT ->
            Icon(Icons.Filled.Close, null, tint = tint, modifier = modifier)
    }
}

/** A round + and a pill with the send button inside it. */
@Composable
private fun Composer(
    modifier: Modifier = Modifier,
    name: String,
    draft: String,
    accessory: ComposerAccessory,
    commands: List<SlashCommand>,
    plusOpen: Boolean,
    dictationListening: Boolean,
    dictationLocked: Boolean,
    dictationError: String?,
    onTogglePlus: () -> Unit,
    onDraftChange: (String) -> Unit,
    onToggleDictation: () -> Unit,
    onSend: () -> Unit,
    onToggleHud: () -> Unit,
    onCloseHud: () -> Unit,
    onSelectCommand: (SlashCommand) -> Unit,
    chips: List<PredictiveChip>,
    onSelectChip: (PredictiveChip) -> Unit,
    attachments: List<PendingMessageAttachment>,
    sending: Boolean,
    preparing: Boolean,
    busy: Boolean,
    onInterrupt: (() -> Unit)? = null,
    engineCanSteer: Boolean,
    queuedSends: List<QueuedSend>,
    steering: Boolean,
    onSteer: (() -> Unit)?,
    onCancelQueued: (QueuedSend) -> Unit,
    openingFileName: String?,
    attachmentError: String?,
    onRemoveAttachment: (PendingMessageAttachment) -> Unit,
    onDismissError: () -> Unit,
) {
    val canSend = AttachmentImportRules.canSend(draft, attachments.size, preparing, sending)
    val inFlight = preparing || sending
    // Held as the state rather than unwrapped with `by`: read inside the layer
    // block, the turn is a new frame, not a new composition of the composer.
    val turn = animateFloatAsState(
        targetValue = if (plusOpen) PLUS_TURN_DEGREES else 0f,
        animationSpec = tween(PLUS_MILLIS),
        label = "plus",
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (dictationError != null) {
            Text(
                text = dictationError,
                fontSize = 13.sp,
                color = Color(0xFFFF9800),
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        // What is in flight, in the order iOS stacks them: the send or the
        // import, then a file on its way, then whatever went wrong.
        if (inFlight) {
            ComposerStatusLine(if (preparing) "Preparing attachments…" else "Sending…")
        }
        if (openingFileName != null) {
            ComposerStatusLine("Opening $openingFileName…")
        }
        if (attachmentError != null) {
            val session = LocalCompanion.current.session
            ActionableComposerErrorCard(
                errorMessage = attachmentError,
                onViewDetails = {
                    session.postStructuredError(
                        ErrorClassifier.classify(
                            operation = "Message Action",
                            rawMessage = attachmentError,
                        )
                    )
                },
                onDismiss = onDismissError,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            )
        }
        // Everything the computer is holding, stacked straight above the chat
        // bar in the order it was sent.
        queuedSends.forEach { queued ->
            QueuedSendRow(
                send = queued,
                onSteer = onSteer,
                steering = steering,
                onCancel = { onCancelQueued(queued) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (attachments.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                attachments.forEach { attachment ->
                    PendingAttachmentChip(
                        attachment = attachment,
                        enabled = !inFlight,
                        onRemove = { onRemoveAttachment(attachment) },
                    )
                }
            }
        }
        // One or the other, never both: the HUD is what the composer is doing
        // right now, and a row of send-immediately chips under it would be a
        // second thing to tap by accident.
        when (accessory) {
            ComposerAccessory.HUD -> CommandSkillHud(
                commands = commands,
                draft = draft,
                onSelect = onSelectCommand,
                onClose = onCloseHud,
            )

            ComposerAccessory.CHIPS -> PredictiveChipsRow(chips = chips, onSelect = onSelectChip)

            ComposerAccessory.NONE -> Unit
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(CircleShape)
                .background(if (AppTheme.isDark) Color(0xFF1E1E22) else Color(0xFFFFFFFF))
                .border(1.dp, if (AppTheme.isDark) Color(0xFF2C2C30) else Color(0xFFE5E5EA), CircleShape)
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Standalone circular + button integrated in capsule
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(CircleShape)
                    .background(if (AppTheme.isDark) Color(0xFF28282C) else Color(0xFFF2F2F5))
                    .clickable(
                        role = Role.Button,
                        onClickLabel = if (plusOpen) "Close" else "More",
                        onClick = onTogglePlus,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Add,
                    contentDescription = null,
                    tint = if (plusOpen) {
                        if (AppTheme.isDark) Color.White else Color(0xFF111111)
                    } else {
                        if (AppTheme.isDark) Color(0xFFE0E0E6) else Color(0xFF1A1A1A)
                    },
                    modifier = Modifier
                        .size(20.dp)
                        .graphicsLayer { rotationZ = turn.value },
                )
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                if (draft.isEmpty()) {
                    Text(
                        text = "Ask $name",
                        fontSize = 15.5.sp,
                        color = if (AppTheme.isDark) Color(0xFF8E8E93) else Color(0xFF9A9AA2),
                    )
                }
                BasicTextField(
                    value = draft,
                    onValueChange = onDraftChange,
                    readOnly = dictationLocked,
                    maxLines = 5,
                    textStyle = LocalTextStyle.current.copy(
                        fontSize = 15.5.sp,
                        color = if (AppTheme.isDark) Color.White else Color(0xFF1A1A1A),
                    ),
                    cursorBrush = SolidColor(if (AppTheme.isDark) Color.White else Color(0xFF1A1A1A)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .onPreviewKeyEvent { event ->
                            val sends = ComposerReturn.sends(
                                isReturnKey = event.key == Key.Enter || event.key == Key.NumPadEnter,
                                keyDown = event.type == KeyEventType.KeyDown,
                                shift = event.isShiftPressed,
                                fromSoftwareKeyboard =
                                    event.nativeKeyEvent.deviceId == KeyCharacterMap.VIRTUAL_KEYBOARD,
                            )
                            if (sends) onSend()
                            sends
                        },
                )
            }

            val isStopAvailable = busy && draft.isEmpty() && onInterrupt != null
            val showSend = canSend
            val showMic = (!showSend && !isStopAvailable && !inFlight) || dictationListening

            if (showMic) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(
                            if (dictationListening) Color(0xFFEF4444)
                            else if (AppTheme.isDark) Color(0xFF28282C)
                            else Color(0xFFF2F2F5)
                        )
                        .clickable(
                            role = Role.Button,
                            onClickLabel = if (dictationListening) "Stop dictation" else "Start dictation",
                            onClick = onToggleDictation,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_mic),
                        contentDescription = null,
                        tint = if (dictationListening) Color.White
                               else if (AppTheme.isDark) Color(0xFFE0E0E6)
                               else Color(0xFF1A1A1A),
                        modifier = Modifier.size(20.dp),
                    )
                }
            } else if (isStopAvailable) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFEF4444))
                        .clickable(
                            role = Role.Button,
                            onClickLabel = "Stop generation",
                            onClick = { onInterrupt() },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(Color.White, RoundedCornerShape(2.dp)),
                    )
                }
            } else if (inFlight) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(if (AppTheme.isDark) Color(0xFF28282C) else Color(0xFFF2F2F5)),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = if (AppTheme.isDark) Color(0xFFE0E0E6) else Color(0xFF1A1A1A),
                    )
                }
            } else if (showSend) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(if (AppTheme.isDark) Color(0xFFE0E0E6) else Color(0xFF1A1A1A))
                        .clickable(
                            role = Role.Button,
                            onClickLabel = "Send",
                            onClick = onSend,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (AppTheme.isDark) Color(0xFF121214) else Color.White,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ActionableComposerErrorCard(
    errorMessage: String,
    onViewDetails: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.25f))
            .border(
                1.dp,
                MaterialTheme.colorScheme.error.copy(alpha = 0.35f),
                RoundedCornerShape(12.dp),
            )
            .padding(12.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Header: Warning Glyph + Headline + Dismiss 'X'
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                    Text(
                        text = "Action Failed",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .clickable(role = Role.Button, onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Dismiss error",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }

            // Body text
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = 18.sp,
            )

            // Remedies & Details action button
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onViewDetails,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = "View Remedies & Details",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

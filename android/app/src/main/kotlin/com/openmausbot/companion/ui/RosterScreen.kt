package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatSummary
import com.openmausbot.companion.core.Room
import com.openmausbot.companion.core.SearchHit
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.chat
import com.openmausbot.companion.core.chatSummaries
import com.openmausbot.companion.core.forTask
import com.openmausbot.companion.core.threadGroups
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The roster — the port of `ios/App/ChatListView.swift`.
 *
 * Messages-shaped: a header with you on the left and settings on the right, your
 * groups across the top, every bot below with the unread dot in the bot's own
 * colour at the left edge, and a bar floating at the bottom. The bar's pill is
 * Updates — only the bots that need you, are working, or have something you have
 * not read — beside round search and new-bot buttons. Everything scrolls under
 * the bar, which is why the list leaves [BAR_CLEARANCE] below its last row.
 *
 * Ordering is not decided here. `chatSummaries` (`:core`) folds pinned → unread →
 * last activity and hides hidden bots; [RosterLayout] decides which of those are
 * rows and which are tiles; the screen renders what it is handed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RosterScreen(navigator: CompanionNavigator) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val state by session.state.collectAsState()
    val connection by session.connection.collectAsState()
    // A cold start is not an offline app: the status this screen draws is the
    // settled one, so the first seconds of a launch do not announce a failure
    // that has not happened, and do not empty a roster that is still loading.
    val rawStatus by session.status.collectAsState()
    val settled = rememberSettledStatus(rawStatus)
    val status = settled.status
    // The same preference the transcript folds by, from the same store: a reader
    // who turned activity off must not still read tool names here.
    val activityDetail by environment.chatPreferences.activityDetail.collectAsState()

    var bar by rememberSaveable(stateSaver = RosterBarSaver) { mutableStateOf(RosterBar()) }
    var hits by remember { mutableStateOf<List<SearchHit>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var showingUpdates by remember { mutableStateOf(false) }
    var showingSmartRecap by remember { mutableStateOf(false) }
    var showingDailyBriefing by remember { mutableStateOf(false) }
    var showingUniversalSearch by remember { mutableStateOf(false) }
    var showingQuickCapture by remember { mutableStateOf(false) }
    var showingNewGroup by remember { mutableStateOf(false) }
    var showingNewSection by remember { mutableStateOf(false) }
    var expandedBots by rememberSaveable(stateSaver = StringSetSaver) { mutableStateOf(emptySet<String>()) }
    var collapsedFolders by rememberSaveable(stateSaver = StringSetSaver) { mutableStateOf(emptySet<String>()) }
    var creatingThreads by remember { mutableStateOf(emptySet<String>()) }
    // One createBot at a time: a second tap while the first is in flight
    // would race two bots into existence.
    var managingThreads by remember { mutableStateOf<Chat?>(null) }
    var deletingChat by remember { mutableStateOf<Chat?>(null) }
    var showingNewBot by remember { mutableStateOf(false) }

    val query = bar.query

    // Local filtering is always on; the computer is only asked past two
    // characters and after a quiet moment (§10).
    LaunchedEffect(query) {
        when (val decision = SearchPolicy.decide(query)) {
            SearchPolicy.Decision.Clear -> {
                hits = emptyList()
                searching = false
            }
            is SearchPolicy.Decision.Remote -> {
                searching = true
                delay(SearchPolicy.DEBOUNCE_MILLIS)
                hits = session.search(decision.query)
                searching = false
            }
        }
    }

    // Folding the fleet walks every thread's transcript, so it is keyed on the
    // state and the activity level alone: typing filters the fold instead of
    // repeating it.
    val summaries = remember(state, activityDetail) { state.chatSummaries(activityDetail) }
    // Only a search has rows to filter; the unsearched roster is assembled
    // section by section below.
    val rows = remember(summaries, query, state.queuedThreadIds) {
        rosterThreadRows(summaries, query, state.queuedThreadIds)
    }
    val approvals = remember(state) { state.pendingApprovals }
    val waiting = remember(state, approvals) { RosterLayout.waitingChats(state, approvals) }
    // One pass over the fleet rather than one per row: resolving a face walks the
    // chat's visible transcript.
    val faces = remember(state, summaries) {
        summaries.associate { it.id to MausState.forChat(it.chat, state) }
    }
    val summariesById = remember(summaries) { summaries.associateBy { it.id } }
    // Hoisted out of the list: read inside a lazy item, `state` would make that
    // item's recompose scope the whole fleet.
    val rooms = state.rooms
    val tiles = remember(state) {
        rooms.associate { it.id to RosterLayout.memberBots(state, it) }
    }
    // Read by the bar over the list and by nothing inside it, so the rows never
    // recompose for it. `approvals` is handed over rather than walked again.
    val updates = remember(state, approvals) { state.updates(approvals) }
    // The hero's own two facts, hoisted for the same reason: read inside a lazy
    // item, either of them would make that item recompose with the fleet.
    val fleet = state.bots.size
    val busy = remember(summaries) { summaries.count { it.chat.busy } }
    // The same rule the sheet picks from: two copies of "which bots can be
    // sectioned" could disagree about a hidden one.
    val canCreateSection = remember(state) { SectionRules.selectable(state).isNotEmpty() }
    // The cross-bot Needs attention section rides above every roster section.
    val attention = remember(state) { state.crossBotAttention() }

    // One bot is one row, and nothing is drawn between two of them. The
    // separator that used to run between rows is gone, and so is the third line
    // every bot paid for its thread count: whitespace separates bots here, which
    // is both what the design is drawn from and what keeps the list dense.
    val entry: @Composable (ChatSummary) -> Unit = { summary ->
        ChatRow(
            summary = summary,
            face = faces[summary.id] ?: MausState.IDLE,
            waiting = summary.id in waiting,
            onClick = { navigator.open(summary.chat) },
            // Long-press is where deletion lives on a phone — the same
            // gesture MessageRow uses for its menu.
            onLongClick = { deletingChat = summary.chat },
            // The face opens the bot rather than the conversation: a bot is
            // the lasting thing, and its own screen is where its threads,
            // memory and capabilities live.
            onOpen = (summary.chat as? Chat.BotChat)?.let { owned ->
                { navigator.push(Destination.Overview(owned.bot.id)) }
            },
        )
    }

    Box(modifier = Modifier.fillMaxSize().background(AppTheme.colors.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            RosterHeader(
                bar = bar,
                onBar = { bar = it },
                onOpenSearch = {
                    haptics.play(TactileAction.OPEN_SEARCH)
                    bar = bar.openSearch()
                },
                onSettings = { navigator.push(Destination.Settings) },
                onCreateBot = { showingNewBot = true },
                onOrganize = {
                    haptics.play(TactileAction.START_NEW_SECTION)
                    showingNewSection = true
                },
                onOpenUpdates = { showingUpdates = true },
                onOpenSmartRecap = { showingSmartRecap = true },
                onOpenDailyBriefing = { showingDailyBriefing = true },
                onOpenUniversalSearch = { showingUniversalSearch = true },
                onOpenQuickCapture = { showingQuickCapture = true },
                onOpenMascotStudio = { navigator.push(Destination.MascotShowcase) },
                canCreateBot = true,
                canOrganize = canCreateSection,
            )
            StatusBanner(status)

            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        // Session.refresh waits until the stream leaves connecting
                        // (or 10s), so the spinner means what it appears to mean.
                        session.refresh()
                        refreshing = false
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
                val nothingToList =
                    if (query.isEmpty()) summaries.isEmpty() else rows.isEmpty()
                if (nothingToList && hits.isEmpty()) {
                    if (!settled.settled && query.isEmpty()) {
                        // Nothing to show *yet*, which is not the same as nothing
                        // there is: the first seconds of a launch say so, in the
                        // same words the header uses.
                        AppLoadingState(
                            label = if (connection == null) "Initializing" else "Connecting to ${connection?.name}",
                            modifier = Modifier.padding(top = AppSpacing.xxl),
                        )
                    } else {
                        AppEmptyState(
                            title = if (query.isEmpty()) "Your workspace is empty" else "Nothing matches",
                            message = if (query.isEmpty()) {
                                "Your local computer agent is ready to help you work."
                            } else {
                                "No bot or thread matches “$query”."
                            },
                            action = if (query.isEmpty()) {
                                {
                                    AppPill(
                                        text = "New bot",
                                        tone = PillTone.Accent,
                                        onClick = { showingNewBot = true },
                                    )
                                }
                            } else {
                                null
                            },
                        )
                    }
                }

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = if (updates.isNotEmpty()) BAR_CLEARANCE else 24.dp),
                ) {
                    if (query.isEmpty()) {
                        items(summaries, key = { it.id }) { summary ->
                            entry(summary)
                        }
                    } else {
                        if (hits.isNotEmpty()) {
                            item(key = "search-header") {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    SectionLabel("Messages")
                                    Spacer(Modifier.weight(1f))
                                    if (searching) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(14.dp),
                                            strokeWidth = 2.dp,
                                        )
                                    }
                                }
                            }
                            items(hits, key = { it.id }) { hit ->
                                SearchHitRow(
                                    hit = hit,
                                    onClick = {
                                        scope.launch {
                                            session.open(hit)?.let {
                                                haptics.play(TactileAction.OPEN_SEARCH_RESULT)
                                                navigator.open(it)
                                            }
                                        }
                                    },
                                )
                            }
                            item(key = "chats-label") {
                                SectionLabel("Threads", Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 4.dp))
                            }
                        }

                        if (rows.isNotEmpty()) {
                            items(rows, key = { it.chat.threadId }) { summary ->
                                entry(summary)
                            }
                        }
                    }
                }
            }
        }

        RosterBottomBar(
            updates = updates,
            onOpenUpdates = {
                haptics.play(TactileAction.OPEN_UPDATES)
                showingUpdates = true
            },            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (showingUpdates) {
        UpdatesSheet(
            onOpen = { chat ->
                showingUpdates = false
                navigator.open(chat)
            },
            onDismiss = { showingUpdates = false },
            onOpenSmartRecap = { showingSmartRecap = true },
            onOpenDailyBriefing = { showingDailyBriefing = true },
            onOpenUniversalSearch = { showingUniversalSearch = true },
            onOpenQuickCapture = { showingQuickCapture = true },
        )
    }

    if (showingSmartRecap) {
        SmartRecapSheet(onDismiss = { showingSmartRecap = false })
    }

    if (showingDailyBriefing) {
        DailyBriefingSheet(onDismiss = { showingDailyBriefing = false })
    }

    if (showingUniversalSearch) {
        UniversalSearchSheet(
            onDismiss = { showingUniversalSearch = false },
            onSelectResult = { item ->
                if (item.category == "bots") {
                    val targetBot = state.bots.find { it.id == item.id }
                    if (targetBot != null) {
                        navigator.open(Chat.BotChat(targetBot))
                    }
                }
            },
        )
    }

    if (showingQuickCapture) {
        QuickCaptureSheet(onDismiss = { showingQuickCapture = false })
    }

    if (showingNewGroup) {
        NewGroupSheet(
            onCreated = { room ->
                showingNewGroup = false
                navigator.open(Chat.RoomChat(room))
            },
            onDismiss = { showingNewGroup = false },
        )
    }

    if (showingNewSection) {
        NewSectionSheet(onDismiss = { showingNewSection = false })
    }

    if (showingNewBot) {
        NewBotSheet(
            onCreated = { bot ->
                showingNewBot = false
                navigator.open(Chat.BotChat(bot))
            },
            onDismiss = { showingNewBot = false },
        )
    }

    managingThreads?.let { chat ->
        TaskSheet(
            chat = chat,
            onDismiss = { managingThreads = null },
            onSelectTask = { target ->
                managingThreads = null
                session.state.value.chat(target)?.let(navigator::open)
            },
        )
    }

    deletingChat?.let { chat ->
        DeleteChatSheet(
            chat = chat,
            onDismiss = { deletingChat = null },
        )
    }
}

/** Room for the floating bar, so the last row can scroll clear of it. */
private val BAR_CLEARANCE = 96.dp

/** Two flags and a string: enough to survive a rotation with the search still up. */
private val RosterBarSaver = listSaver<RosterBar, Any>(
    save = { listOf(it.searchOpen, it.query) },
    restore = { RosterBar(searchOpen = it[0] as Boolean, query = it[1] as String) },
)

private val StringSetSaver = listSaver<Set<String>, String>(
    save = { it.toList() },
    restore = { it.toSet() },
)

/**
 * The app's mark on the left, and the two things this screen can do about its
 * own contents on the right: search them, and add one.
 *
 * No title, and no status line. "Bots" printed over a list of bots is the screen
 * naming its own contents, and a permanent line naming the computer under it was
 * a second copy of a fact the status banner already carries whenever it is
 * actually interesting. What is left is the composition the design is drawn
 * from: identity, search, add.
 *
 * Opening search replaces this whole row with the field. A field living at the
 * bottom of the screen while its own icon lived at the top was two places to
 * look for one job.
 */
@Composable
private fun RosterHeader(
    bar: RosterBar,
    onBar: (RosterBar) -> Unit,
    onOpenSearch: () -> Unit,
    onSettings: () -> Unit,
    onCreateBot: () -> Unit,
    onOrganize: () -> Unit,
    onOpenUpdates: () -> Unit,
    onOpenSmartRecap: () -> Unit,
    onOpenDailyBriefing: () -> Unit,
    onOpenUniversalSearch: () -> Unit,
    onOpenQuickCapture: () -> Unit,
    onOpenMascotStudio: () -> Unit = {},
    canCreateBot: Boolean,
    canOrganize: Boolean,
) {
    val focus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    LaunchedEffect(bar.searchOpen) {
        if (bar.searchOpen) focus.requestFocus() else focusManager.clearFocus()
    }

    if (bar.searchOpen) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .height(42.dp)
                    .clip(RoundedCornerShape(21.dp))
                    .background(AppTheme.colors.surfaceRaised)
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.Search,
                    contentDescription = null,
                    tint = AppTheme.colors.textTertiary,
                    modifier = Modifier.size(18.dp),
                )
                Box(modifier = Modifier.weight(1f)) {
                    if (bar.query.isEmpty()) {
                        Text(
                            "Search",
                            fontSize = 16.sp,
                            color = AppTheme.colors.textTertiary,
                        )
                    }
                    BasicTextField(
                        value = bar.query,
                        onValueChange = { onBar(bar.typed(it)) },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontSize = 16.sp,
                            color = AppTheme.colors.textPrimary,
                        ),
                        cursorBrush = SolidColor(AppTheme.colors.textPrimary),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focus),
                    )
                }
                if (bar.query.isNotEmpty()) {
                    TouchTarget(onClick = { onBar(bar.clearQuery()) }, size = 24.dp) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "Clear search",
                            tint = AppTheme.colors.textTertiary,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            Text(
                text = "Cancel",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = AppTheme.colors.textPrimary,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button, onClick = { onBar(bar.cancelSearch()) })
                    .padding(horizontal = 4.dp, vertical = 8.dp),
            )
        }
    } else {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            var menuOpen by remember { mutableStateOf(false) }

            Box {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(AppTheme.colors.surfaceRaised)
                        .combinedClickable(
                            role = Role.Button,
                            onClick = onSettings,
                            onLongClick = { menuOpen = true },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = "Settings",
                        tint = AppTheme.colors.textPrimary,
                        modifier = Modifier.size(20.dp),
                    )
                }

                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Settings") },
                        onClick = {
                            menuOpen = false
                            onSettings()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("🎭 Mascot Studio") },
                        onClick = {
                            menuOpen = false
                            onOpenMascotStudio()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("🔍 Universal Search") },
                        onClick = {
                            menuOpen = false
                            onOpenUniversalSearch()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("📥 Quick Capture") },
                        onClick = {
                            menuOpen = false
                            onOpenQuickCapture()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("⚡ Smart Recap") },
                        onClick = {
                            menuOpen = false
                            onOpenSmartRecap()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("☀️ Daily Briefing") },
                        onClick = {
                            menuOpen = false
                            onOpenDailyBriefing()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Updates") },
                        onClick = {
                            menuOpen = false
                            onOpenUpdates()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("New section") },
                        onClick = {
                            menuOpen = false
                            onOrganize()
                        },
                        enabled = canOrganize,
                    )
                }
            }

            Spacer(Modifier.weight(1f))

            HeaderGlyphButton(
                icon = Icons.Filled.Search,
                contentDescription = "Search",
                glyph = 24.dp,
                onClick = onOpenSearch,
            )

            HeaderGlyphButton(
                icon = Icons.Filled.Add,
                contentDescription = "New bot",
                glyph = 26.dp,
                onClick = onCreateBot,
                enabled = canCreateBot,
            )
        }
    }
}

/**
 * The roster's editing actions, behind the header's ellipsis.
 */
@Composable
private fun RosterOverflowMenu(
    onOpenUpdates: () -> Unit,
    onOpenSmartRecap: () -> Unit,
    onOpenDailyBriefing: () -> Unit,
    onOpenUniversalSearch: () -> Unit,
    onOpenQuickCapture: () -> Unit,
    onOpenMascotStudio: () -> Unit = {},
    onOrganize: () -> Unit,
    onSettings: () -> Unit,
    enabled: Boolean,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        HeaderGlyphButton(
            icon = Icons.Filled.MoreVert,
            contentDescription = "More roster actions",
            onClick = { open = true },
            enabled = true,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("🎭 Mascot Studio") },
                onClick = {
                    open = false
                    onOpenMascotStudio()
                },
            )
            DropdownMenuItem(
                text = { Text("🔍 Universal Search") },
                onClick = {
                    open = false
                    onOpenUniversalSearch()
                },
            )
            DropdownMenuItem(
                text = { Text("📥 Quick Capture") },
                onClick = {
                    open = false
                    onOpenQuickCapture()
                },
            )
            DropdownMenuItem(
                text = { Text("⚡ Smart Recap") },
                onClick = {
                    open = false
                    onOpenSmartRecap()
                },
            )
            DropdownMenuItem(
                text = { Text("☀️ Daily Briefing") },
                onClick = {
                    open = false
                    onOpenDailyBriefing()
                },
            )
            DropdownMenuItem(
                text = { Text("Updates") },
                onClick = {
                    open = false
                    onOpenUpdates()
                },
            )
            DropdownMenuItem(
                text = { Text("New section") },
                onClick = {
                    open = false
                    onOrganize()
                },
                enabled = enabled,
            )
            DropdownMenuItem(
                text = { Text("⚙️ Settings") },
                onClick = {
                    open = false
                    onSettings()
                },
            )
        }
    }
}

/** A heading over a stretch of the list — see [AppSectionHeader]. */
@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    AppSectionHeader(
        text = RosterLayout.sectionLabel(text),
        modifier = modifier,
    )
}

/**
 * Every group, across the top, with the tile that makes one at the end — the
 * place iOS puts it, and the reason the header's plus is the only one.
 *
 * No heading. "GROUPS" over a strip of groups is the same waste as "Bots" over a
 * list of bots, and a heading plus its own spacing was a whole band of the screen
 * spent labelling what the tiles already show.
 */
@Composable
private fun GroupsStrip(
    rooms: List<Room>,
    members: Map<String, List<Bot>>,
    onOpen: (Room) -> Unit,
    onCreate: (() -> Unit)?,
) {
    Column(
        modifier = Modifier.padding(vertical = AppSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            contentPadding = PaddingValues(horizontal = AppSpacing.gutter),
        ) {
            items(rooms, key = { it.id }) { room ->
                GroupTile(
                    room = room,
                    members = members[room.id].orEmpty(),
                    onClick = { onOpen(room) },
                )
            }
            if (onCreate != null) {
                item(key = "new-group") { NewGroupTile(onClick = onCreate) }
            }
        }
    }
}

/**
 * A room as a round tile: the first two members' mascots stacked, its name
 * beneath.
 *
 * Kept deliberately small and low-contrast. A group is a way of sorting bots,
 * not an object with its own life, so its tile is half the weight of a bot's row
 * and never competes with one.
 */
@Composable
private fun GroupTile(room: Room, members: List<Bot>, onClick: () -> Unit) {
    // A soft tinted square rather than a bare pair of faces floating in the
    // strip: a tile is a card in the reference's sense — one object sitting on
    // the page. The wash is the theme's own one, not a colour per room, because a
    // room has no colour of its own: the faces stacked on the tile are what
    // identify it, and the tile's job is only to hold them.
    val wash = AppTheme.colors.selected
    GroupTileFrame(
        label = room.name,
        labelColor = AppTheme.colors.textSecondary,
        onClick = onClick,
    ) {
        Box(
            modifier = Modifier
                .size(GROUP_TILE)
                .background(wash, AppRadii.rowShape),
        )
        members.getOrNull(0)?.let {
            BotAvatar(
                bot = it,
                size = 34.dp,
                state = MausState.HAPPY,
                animated = false,
                modifier = Modifier.offset(x = (-8).dp, y = (-6).dp),
            )
        }
        members.getOrNull(1)?.let {
            Box(
                modifier = Modifier
                    .offset(x = 10.dp, y = 9.dp)
                    // The ring is the page, not a plate: it separates two
                    // overlapping faces by cutting the one behind.
                    .background(AppTheme.colors.background, CircleShape)
                    .padding(2.dp),
            ) {
                BotAvatar(bot = it, size = 26.dp, state = MausState.HAPPY, animated = false)
            }
        }
        if (room.unread) {
            Box(modifier = Modifier.align(Alignment.TopEnd)) {
                AppStatusDot(color = AppTheme.colors.textPrimary, size = 9.dp)
            }
        }
    }
}

/** The empty tile at the end of the strip: this is where a group is made. */
@Composable
private fun NewGroupTile(onClick: () -> Unit) {
    val outline = AppTheme.colors.hairline
    GroupTileFrame(label = "New group", labelColor = AppTheme.colors.textTertiary, onClick = onClick) {
        Spacer(
            modifier = Modifier
                .size(GROUP_TILE)
                .drawWithCache {
                    val width = 1.dp.toPx()
                    val dash = 3.dp.toPx()
                    val style = Stroke(
                        width = width,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash), 0f),
                    )
                    val radius = size.minDimension / 2f - width / 2f
                    onDrawBehind { drawCircle(color = outline, radius = radius, style = style) }
                },
        )
        Icon(
            imageVector = Icons.Filled.Add,
            contentDescription = null,
            tint = AppTheme.colors.textTertiary,
            modifier = Modifier.size(20.dp),
        )
    }
}

/** The tile both the group and the create-a-group affordance are drawn at. */
private val GROUP_TILE = 52.dp


@Composable
private fun GroupTileFrame(
    label: String,
    labelColor: Color,
    onClick: () -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .width(72.dp)
            .clip(RoundedCornerShape(AppRadii.row))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = AppSpacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        Box(modifier = Modifier.size(GROUP_TILE), contentAlignment = Alignment.Center, content = content)
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = labelColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * One row of the roster: a bot, what it is for, and what it last did.
 *
 * The list is meant to be read top to bottom in one pass — two short lines and
 * one face — so the answers to "who is this", "what is it doing" and "does it
 * need me" are all found without reading a label. Everything structural about the
 * row itself lives in [BotRow]; what belongs here is the decision about which of
 * a chat's facts are worth those two lines.
 *
 * Waiting on you outranks the last message, because it is the one state where the
 * next move is the person's. Working is shown by the avatar's ring and a dot that
 * breathes, so the row does not have to repeat it in words.
 */
@Composable
private fun ChatRow(
    summary: ChatSummary,
    face: MausState,
    waiting: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    onOpen: (() -> Unit)? = null,
) {
    val chat = summary.chat
    val now = remember(summary.lastActivity) { System.currentTimeMillis() }
    val accent = remember(chat.color) { Color(MausPalette.argb(chat.color)) }
    val working = chat.busy
    val activity = when {
        waiting -> BotStateLabel.WAITING
        working -> summary.preview.ifEmpty { BotStateLabel.WORKING }
        else -> summary.preview
    }
    BotRow(
        name = chat.name,
        role = chat.subtitle,
        activity = activity,
        stamp = RelativeStamp.list(summary.lastActivity, now, locale = Locale.getDefault()),
        accent = accent,
        unread = chat.unread && !working,
        working = working,
        waiting = waiting,
        avatar = { ChatAvatar(chat = chat, size = AppSizes.rowAvatar, state = face) },
        onClick = onClick,
        onLongClick = onLongClick,
        onOpen = onOpen,
    )
}

/**
 * The bar over the bottom of the list: what is waiting on you, and nothing at
 * all when nothing is.
 *
 * Search, adding a bot and editing the roster all moved to the top of the screen,
 * where the design puts them, so this bar is no longer a toolbar — it is the
 * updates pill, drawn only when there are updates, on a day when there are none
 * it is not there at all and the list simply ends.
 */
@Composable
private fun RosterBottomBar(
    updates: List<ChatUpdate>,
    onOpenUpdates: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (updates.isEmpty()) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = AppSpacing.gutter, end = AppSpacing.gutter, top = AppSpacing.sm, bottom = AppSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        UpdatesBar(
            updates = updates,
            onOpen = onOpenUpdates,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SearchHitRow(hit: SearchHit, onClick: () -> Unit) {
    val now = remember(hit.id) { System.currentTimeMillis() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // Who said it. Two hits with the same words are otherwise identical.
        Icon(
            // A person for what you said, the Maus mark for what a bot said —
            // iOS makes the same split with person.fill and a speech bubble.
            painter = if (SearchHitRole.isFromUser(hit.role)) {
                rememberVectorPainter(Icons.Filled.Person)
            } else {
                painterResource(R.drawable.ic_maus_mark)
            },
            contentDescription = SearchHitRole.contentDescription(hit.role, hit.name),
            tint = secondaryTint,
            modifier = Modifier
                .size(26.dp)
                .background(secondaryTint.copy(alpha = 0.13f), CircleShape)
                .padding(5.dp),
        )

        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(hit.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                hit.task?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, fontSize = 12.sp, color = secondaryTint)
                }
                Spacer(Modifier.weight(1f))
                Text(
                    text = RelativeStamp.list(hit.at, now, locale = Locale.getDefault()),
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }
            Text(
                text = hit.snippet,
                fontSize = 14.sp,
                color = secondaryTint,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Connection state, shown only when it is not "fine".
 *
 * Takes the status it draws rather than reading the flow itself, so the caller's
 * [rememberSettledStatus] decides whether the app has been up long enough for
 * "offline" to be worth saying. Two readings of the same flow would be two
 * moments in time, and the banner could contradict the header beside it.
 */
@Composable
fun StatusBanner(status: Session.Status = LocalCompanion.current.session.status.collectAsState().value) {
    val banner: Pair<String, Color>? = when (val current = status) {
        Session.Status.Live, Session.Status.Unpaired -> null
        is Session.Status.Starting -> current.message to secondaryTint
        Session.Status.Connecting -> "Connecting…" to secondaryTint
        is Session.Status.Offline -> current.message to Color(MausPalette.argb("orange"))
        Session.Status.Unauthorized ->
            "This phone was unpaired on the computer." to MaterialTheme.colorScheme.error
    }
    val (text, tint) = banner ?: return
    Text(
        text = text,
        fontSize = 13.sp,
        color = tint,
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .background(secondaryTint.copy(alpha = 0.12f), CircleShape)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/**
 * Deleting a conversation from the roster, as rules — the decision half of the
 * long-press sheet, so the list, the chat screen and TaskSheet all agree on
 * which thread may go.
 *
 * Deletion targets the conversation's **current** thread (the one the roster row
 * opens); the bot itself is never touched. The server refuses the last remaining
 * thread and a running one, so the rules here pre-answer the same two cases
 * instead of round-tripping a 409.
 */
object DeleteChatRules {
    /** The thread a long-press on this chat would delete. */
    fun task(chat: Chat): BotTask? = when (chat) {
        is Chat.BotChat -> chat.bot.tasks.orEmpty().firstOrNull { it.threadId == chat.threadId }
        is Chat.RoomChat -> chat.room.tasks.orEmpty().firstOrNull { it.threadId == chat.threadId }
    }

    /**
     * False for the bot's only thread — a bot without one has nowhere to talk —
     * and for a running thread, which must be stopped first. The room branch
     * mirrors [TaskRules.canDelete].
     */
    fun canDelete(chat: Chat): Boolean {
        val task = task(chat) ?: return false
        return TaskRules.canDelete(task, chat)
    }

    /** What the confirmation names, e.g. "Delete \"Quarterly report\"?". */
    fun title(chat: Chat): String {
        return when (chat) {
            is Chat.BotChat -> {
                val task = task(chat) ?: return chat.name
                TaskRules.title(task).ifEmpty { chat.name }
            }
            is Chat.RoomChat -> chat.name
        }
    }

    /**
     * Deleting the whole agent — the long-press's heavier second action, next
     * to thread deletion. Blocked while anything of the bot's is running: the
     * same busy gates the thread rules read, applied across every thread,
     * because the harness refuses a mid-turn, mid-routine or mid-credential
     * -save deletion with a 409. Rooms are not agents; the option never shows.
     */
    fun canDeleteBot(chat: Chat): Boolean = when (chat) {
        is Chat.BotChat ->
            chat.bot.busy != true && chat.bot.tasks.orEmpty().all { it.busy != true }
        is Chat.RoomChat -> false
    }

    /** The agent-deletion confirmation names the agent, never a thread. */
    fun botTitle(chat: Chat): String = chat.name
}

@Composable
private fun DeleteChatSheet(
    chat: Chat,
    onDismiss: () -> Unit,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showingBotDelete by remember { mutableStateOf(false) }
    val task = remember(chat) { DeleteChatRules.task(chat) }
    val canDelete = remember(chat, task) { DeleteChatRules.canDelete(chat) }

    AlertDialog(
        onDismissRequest = { if (!deleting) onDismiss() },
        title = { Text("Delete \"${DeleteChatRules.title(chat)}\"?") },
        text = {
            Text(
                when {
                    error != null -> error ?: ""
                    !canDelete -> "This conversation can't be deleted right now. " +
                        "A bot keeps at least one thread, and a running thread must be stopped first."
                    else -> "This conversation will be deleted from your list and its " +
                        "transcript removed. The bot itself is not deleted, and generated files are kept."
                },
            )
        },
        confirmButton = {
            TextButton(
                enabled = !deleting && canDelete && task != null,
                onClick = {
                    val current = task ?: return@TextButton
                    deleting = true
                    error = null
                    scope.launch {
                        val updated = when (chat) {
                            is Chat.BotChat -> session.deleteTask(current, chat.bot)
                            is Chat.RoomChat -> session.deleteTask(current, chat.room)
                        }
                        deleting = false
                        if (updated == null) {
                            error = session.actionError ?: "The conversation could not be deleted. Try again."
                        } else {
                            haptics.play(HapticCue.SELECT)
                            onDismiss()
                        }
                    }
                },
            ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = {
            Row {
                TextButton(enabled = !deleting, onClick = onDismiss) { Text("Cancel") }
                // The heavier sibling action: remove the agent itself, not just
                // this conversation. Rooms are not agents, so it never shows there.
                if (chat is Chat.BotChat) {
                    TextButton(enabled = !deleting, onClick = { showingBotDelete = true }) {
                        Text("Delete agent…", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
    )

    if (showingBotDelete) {
        DeleteBotDialog(
            chat = chat,
            onDismiss = { showingBotDelete = false },
            onDone = onDismiss,
        )
    }
}

@Composable
private fun DeleteBotDialog(
    chat: Chat,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val canDelete = remember(chat) { DeleteChatRules.canDeleteBot(chat) }

    AlertDialog(
        onDismissRequest = { if (!deleting) onDismiss() },
        title = { Text("Delete agent \"${DeleteChatRules.botTitle(chat)}\"?") },
        text = {
            Text(
                when {
                    error != null -> error ?: ""
                    !canDelete -> "This agent can't be deleted right now. Stop its " +
                        "work first — a running thread must finish before the agent goes."
                    else -> "The agent will be removed with all of its threads, " +
                        "transcripts and workspace files. This cannot be undone."
                },
            )
        },
        confirmButton = {
            TextButton(
                enabled = !deleting && canDelete,
                onClick = {
                    val bot = (chat as? Chat.BotChat)?.bot ?: return@TextButton
                    deleting = true
                    error = null
                    scope.launch {
                        val deleted = session.deleteBot(bot)
                        deleting = false
                        if (deleted) {
                            haptics.play(HapticCue.SELECT)
                            onDismiss()
                            onDone()
                        } else {
                            error = session.actionError ?: "The agent could not be deleted. Try again."
                        }
                    }
                },
            ) { Text("Delete agent", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = {
            TextButton(enabled = !deleting, onClick = onDismiss) { Text("Cancel") }
        },
    )
}

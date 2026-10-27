package com.openmausbot.companion.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.AbilityOverview
import com.openmausbot.companion.core.ActivityOverview
import com.openmausbot.companion.core.AutomationOverview
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotOverview
import com.openmausbot.companion.core.GoalOverview
import com.openmausbot.companion.core.MemoryItemOverview
import com.openmausbot.companion.core.RoutineInput
import com.openmausbot.companion.core.RoutineSchedule
import com.openmausbot.companion.core.WatchOverview
import kotlinx.coroutines.launch

private enum class OverviewDetailSheet {
    NONE,
    CAPABILITIES,
    MEMORY,
    AUTOMATIONS,
    GOALS,
    WATCHES,
    ACTIVITY,
}

/**
 * Bot Overview Screen.
 *
 * Clean product page presenting:
 * - Bot avatar and identity
 * - Short role/context and concise capability summary
 * - Currently working action (if active)
 * - Progressive disclosure rows (Capabilities, Memory, Automations, Goals, Activity)
 *
 * Free of dashboard widgets, card farms, pill farms, and AI slop.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BotOverviewScreen(botId: String, onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val state by session.state.collectAsState()
    val connection by session.connection.collectAsState()
    val connectionId = connection?.id
    val scope = rememberCoroutineScope()

    var overview by remember(botId, connectionId) { mutableStateOf<BotOverview?>(null) }
    var loading by remember(botId, connectionId) { mutableStateOf(true) }
    var refreshing by remember(botId, connectionId) { mutableStateOf(false) }
    var failed by remember(botId, connectionId) { mutableStateOf(false) }
    var activeSheet by remember { mutableStateOf(OverviewDetailSheet.NONE) }
    var showCreateScheduleDialog by remember { mutableStateOf(false) }

    suspend fun refresh(showProgress: Boolean = false) {
        if (showProgress) refreshing = true
        try {
            val loaded = session.loadOverview(botId)
            failed = loaded == null
            if (loaded != null) overview = loaded
        } finally {
            if (showProgress) refreshing = false
        }
    }

    LaunchedEffect(botId, connectionId) {
        loading = true
        try {
            refresh()
        } finally {
            loading = false
        }
    }

    val bot = state.bot(botId)
    val botName = overview?.who?.name?.ifBlank { bot?.name.orEmpty() } ?: bot?.name.orEmpty()
    val title = botName.ifBlank { "Overview" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AppTheme.colors.background)
    ) {
        // Pinned Top Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.size(42.dp),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = AppTheme.colors.textPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
            Text(
                title,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )
            IconButton(
                onClick = { showCreateScheduleDialog = true },
                modifier = Modifier.size(42.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Add,
                    contentDescription = "Add Task",
                    tint = AppTheme.colors.textPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        HorizontalDivider(color = AppTheme.colors.hairline)

        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refresh(showProgress = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                val current = overview
                when {
                    loading -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                    current != null -> BotProductOverview(
                        bot = bot,
                        overview = current,
                        onOpenSheet = { activeSheet = it },
                    )
                    failed -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(OverviewRules.FAILED, color = AppTheme.colors.textSecondary)
                    }
                }
            }
        }
    }

    // Modal Bottom Sheets for Progressive Disclosure
    overview?.let { current ->
        when (activeSheet) {
            OverviewDetailSheet.CAPABILITIES -> {
                DetailListSheet(
                    title = "Capabilities",
                    onDismiss = { activeSheet = OverviewDetailSheet.NONE },
                ) {
                    if (current.abilities.isEmpty()) {
                        item {
                            EmptySheetNote("Default system tools configured.")
                        }
                    } else {
                        items(current.abilities, key = { it.id }) { ability ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(7.dp)
                                        .clip(CircleShape)
                                        .background(if (ability.available) AppTheme.colors.positive else AppTheme.colors.textTertiary)
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        humanizeAbilityName(ability.name),
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = AppTheme.colors.textPrimary,
                                    )
                                    if (ability.description.isNotBlank()) {
                                        Text(
                                            ability.description,
                                            fontSize = 12.sp,
                                            color = AppTheme.colors.textSecondary,
                                        )
                                    }
                                }
                            }
                            HorizontalDivider(color = AppTheme.colors.hairline)
                        }
                    }
                }
            }
            OverviewDetailSheet.MEMORY -> {
                DetailListSheet(
                    title = "Saved Memory",
                    onDismiss = { activeSheet = OverviewDetailSheet.NONE },
                ) {
                    if (current.memory.isEmpty()) {
                        item {
                            EmptySheetNote("No standing facts or preferences memorized yet.")
                        }
                    } else {
                        items(current.memory, key = { it.id }) { item ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(
                                    item.category.uppercase(),
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    letterSpacing = 0.6.sp,
                                    color = AppTheme.colors.textTertiary,
                                )
                                Text(
                                    item.text,
                                    fontSize = 13.sp,
                                    lineHeight = 18.sp,
                                    color = AppTheme.colors.textPrimary,
                                )
                            }
                            HorizontalDivider(color = AppTheme.colors.hairline)
                        }
                    }
                }
            }
            OverviewDetailSheet.AUTOMATIONS -> {
                DetailListSheet(
                    title = "Automations & Tasks",
                    onDismiss = { activeSheet = OverviewDetailSheet.NONE },
                ) {
                    if (current.automations.isEmpty()) {
                        item {
                            EmptySheetNote("No scheduled routines configured.")
                        }
                    } else {
                        items(current.automations, key = { it.id }) { auto ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        auto.name,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = AppTheme.colors.textPrimary,
                                    )
                                    Text(
                                        auto.schedule,
                                        fontSize = 12.sp,
                                        color = AppTheme.colors.textSecondary,
                                    )
                                }
                                val statusColor = when (auto.status.lowercase()) {
                                    "failed", "error" -> AppTheme.colors.danger
                                    "active" -> AppTheme.colors.positive
                                    else -> AppTheme.colors.textTertiary
                                }
                                Text(
                                    auto.status.replaceFirstChar { it.uppercase() },
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = statusColor,
                                )
                            }
                            HorizontalDivider(color = AppTheme.colors.hairline)
                        }
                    }
                }
            }
            OverviewDetailSheet.GOALS -> {
                DetailListSheet(
                    title = "Goals",
                    onDismiss = { activeSheet = OverviewDetailSheet.NONE },
                ) {
                    if (current.goals.isEmpty()) {
                        item {
                            EmptySheetNote("No standing goals.")
                        }
                    } else {
                        items(current.goals, key = { it.id }) { goal ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        goal.title,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = AppTheme.colors.textPrimary,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        val statusColor = when (goal.status) {
                                            "RUNNING", "active" -> AppTheme.colors.running
                                            "PAUSED_FOR_USER", "paused" -> AppTheme.colors.caution
                                            "COMPLETED", "completed" -> AppTheme.colors.positive
                                            "BLOCKED_DEPENDENCY", "blocked", "FAILED" -> AppTheme.colors.danger
                                            else -> AppTheme.colors.textSecondary
                                        }
                                        Text(
                                            goal.status.uppercase(),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = statusColor,
                                            modifier = Modifier
                                                .background(statusColor.copy(alpha = 0.12f), RoundedCornerShape(4.dp))
                                                .padding(horizontal = 6.dp, vertical = 2.dp),
                                        )
                                        Text(
                                            "${goal.progress}%",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium,
                                            color = AppTheme.colors.textSecondary,
                                        )
                                    }
                                }
                                if (goal.progress > 0) {
                                    LinearProgressIndicator(
                                        progress = { goal.progress / 100f },
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(2.dp)
                                            .clip(RoundedCornerShape(1.dp)),
                                        color = AppTheme.colors.accent,
                                        trackColor = AppTheme.colors.hairline,
                                    )
                                }
                                goal.nextAction?.let {
                                    Text("Next: $it", fontSize = 12.sp, color = AppTheme.colors.textSecondary)
                                }
                                goal.blockers.firstOrNull()?.let {
                                    Text("Blocker: $it", fontSize = 12.sp, color = AppTheme.colors.danger)
                                }
                            }
                            HorizontalDivider(color = AppTheme.colors.hairline)
                        }
                    }
                }
            }
            OverviewDetailSheet.WATCHES -> {
                DetailListSheet(
                    title = "Watches",
                    onDismiss = { activeSheet = OverviewDetailSheet.NONE },
                ) {
                    if (current.watches.isEmpty()) {
                        item {
                            EmptySheetNote("No active watches.")
                        }
                    } else {
                        items(current.watches, key = { it.id }) { watch ->
                            val cleanTarget = watch.target
                                .removePrefix("https://")
                                .removePrefix("http://")
                                .trimEnd('/')
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        watch.condition,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = AppTheme.colors.textPrimary,
                                    )
                                    Text(
                                        "Every ${watch.cadenceMinutes}m • $cleanTarget",
                                        fontSize = 12.sp,
                                        color = AppTheme.colors.textSecondary,
                                    )
                                }
                                val statusColor = when (watch.status.lowercase()) {
                                    "active" -> AppTheme.colors.positive
                                    "paused" -> AppTheme.colors.textTertiary
                                    "failed" -> AppTheme.colors.danger
                                    else -> AppTheme.colors.textSecondary
                                }
                                Text(
                                    watch.status.replaceFirstChar { it.uppercase() },
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = statusColor,
                                )
                            }
                            HorizontalDivider(color = AppTheme.colors.hairline)
                        }
                    }
                }
            }
            OverviewDetailSheet.ACTIVITY -> {
                DetailListSheet(
                    title = "Recent Activity",
                    onDismiss = { activeSheet = OverviewDetailSheet.NONE },
                ) {
                    if (current.activities.isEmpty()) {
                        item {
                            EmptySheetNote("No recent activity recorded.")
                        }
                    } else {
                        items(current.activities, key = { it.id }) { act ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.Top,
                            ) {
                                Text(
                                    act.summary,
                                    fontSize = 13.sp,
                                    color = AppTheme.colors.textPrimary,
                                    modifier = Modifier.weight(1f).padding(end = 8.dp),
                                )
                                Text(
                                    RelativeStamp.dateAndTime(act.at),
                                    fontSize = 11.sp,
                                    color = AppTheme.colors.textTertiary,
                                )
                            }
                            HorizontalDivider(color = AppTheme.colors.hairline)
                        }
                    }
                }
            }
            OverviewDetailSheet.NONE -> Unit
        }
    }

    if (showCreateScheduleDialog) {
        CreateScheduleDialog(
            botId = botId,
            onDismiss = { showCreateScheduleDialog = false },
            onCreated = {
                showCreateScheduleDialog = false
                scope.launch { refresh(showProgress = true) }
            },
        )
    }
}

@Composable
private fun BotProductOverview(
    bot: Bot?,
    overview: BotOverview,
    onOpenSheet: (OverviewDetailSheet) -> Unit,
) {
    // 1. Hero Identity: Avatar, Name, Title, Blurb, Capabilities Summary (Pure Typography & Whitespace)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 16.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (bot != null) {
            BotAvatar(bot = bot, size = 64.dp)
        } else {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(AppTheme.colors.surfaceRaised),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    overview.who.name.take(1).uppercase(),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                )
            }
        }

        Spacer(Modifier.height(14.dp))

        Text(
            overview.who.name,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textPrimary,
            textAlign = TextAlign.Center,
        )

        if (overview.who.title.isNotBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                overview.who.title,
                fontSize = 14.sp,
                fontWeight = FontWeight.Normal,
                color = AppTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }

        val lead = overview.who.soulLead.ifBlank { overview.who.blurb }
        if (lead.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                lead,
                fontSize = 13.sp,
                color = AppTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
                lineHeight = 18.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }

        val capabilitiesSummary = remember(overview.abilities) {
            formatOverviewCapabilities(overview.abilities)
        }
        Spacer(Modifier.height(10.dp))
        Text(
            capabilitiesSummary,
            fontSize = 12.sp,
            color = AppTheme.colors.textTertiary,
            textAlign = TextAlign.Center,
        )
    }

    // 2. Currently Working (Only shown when an active goal exists!)
    val activeGoal = remember(overview.goals) {
        overview.goals.firstOrNull { it.status == "active" || it.status == "blocked" }
    }
    if (activeGoal != null) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "Currently working",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textSecondary,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(22.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.border.copy(alpha = 0.5f), RoundedCornerShape(22.dp))
                    .padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        activeGoal.title,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "${activeGoal.progress}%",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = AppTheme.colors.textSecondary,
                    )
                }

                LinearProgressIndicator(
                    progress = { activeGoal.progress / 100f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .clip(RoundedCornerShape(1.dp)),
                    color = AppTheme.colors.accent,
                    trackColor = AppTheme.colors.hairline,
                )

                activeGoal.nextAction?.let { next ->
                    Text(
                        "Next: $next",
                        fontSize = 13.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }

                if (activeGoal.blockers.isNotEmpty()) {
                    Text(
                        "Blocker: ${activeGoal.blockers.joinToString()}",
                        fontSize = 12.sp,
                        color = AppTheme.colors.danger,
                    )
                }
            }
        }
    }

    // 3. Progressive Disclosure Navigation Rows (Standard SettingsSection)
    SettingsSection {
        val availableCount = overview.abilities.count { it.available }
        SettingsRow(
            title = "Capabilities",
            subtitle = if (availableCount == 1) "1 enabled" else if (availableCount > 0) "$availableCount enabled" else "System tools",
            showChevron = true,
            onClick = { onOpenSheet(OverviewDetailSheet.CAPABILITIES) },
        )
        HorizontalDivider(color = AppTheme.colors.hairline, modifier = Modifier.padding(horizontal = 16.dp))

        SettingsRow(
            title = "Memory",
            subtitle = if (overview.memory.size == 1) "1 saved fact" else if (overview.memory.isNotEmpty()) "${overview.memory.size} saved facts" else "No saved facts",
            showChevron = true,
            onClick = { onOpenSheet(OverviewDetailSheet.MEMORY) },
        )
        HorizontalDivider(color = AppTheme.colors.hairline, modifier = Modifier.padding(horizontal = 16.dp))

        SettingsRow(
            title = "Automations & Tasks",
            subtitle = if (overview.automations.size == 1) "1 routine" else if (overview.automations.isNotEmpty()) "${overview.automations.size} routines" else "None scheduled",
            showChevron = true,
            onClick = { onOpenSheet(OverviewDetailSheet.AUTOMATIONS) },
        )

        if (overview.goals.isNotEmpty()) {
            HorizontalDivider(color = AppTheme.colors.hairline, modifier = Modifier.padding(horizontal = 16.dp))
            SettingsRow(
                title = "Goals",
                subtitle = if (overview.goals.size == 1) "1 goal" else "${overview.goals.size} goals",
                showChevron = true,
                onClick = { onOpenSheet(OverviewDetailSheet.GOALS) },
            )
        }

        if (overview.watches.isNotEmpty()) {
            HorizontalDivider(color = AppTheme.colors.hairline, modifier = Modifier.padding(horizontal = 16.dp))
            SettingsRow(
                title = "Watches",
                subtitle = if (overview.watches.size == 1) "1 active watch" else "${overview.watches.size} active watches",
                showChevron = true,
                onClick = { onOpenSheet(OverviewDetailSheet.WATCHES) },
            )
        }

        if (overview.activities.isNotEmpty()) {
            HorizontalDivider(color = AppTheme.colors.hairline, modifier = Modifier.padding(horizontal = 16.dp))
            SettingsRow(
                title = "Recent activity",
                subtitle = if (overview.activities.size == 1) "1 event" else "${overview.activities.size} events",
                showChevron = true,
                onClick = { onOpenSheet(OverviewDetailSheet.ACTIVITY) },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailListSheet(
    title: String,
    onDismiss: () -> Unit,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = AppTheme.colors.surface,
        dragHandle = { BottomSheetDefaults.DragHandle() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                title,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
                modifier = Modifier.padding(bottom = 16.dp),
            )
            LazyColumn(modifier = Modifier.fillMaxWidth()) {
                content()
            }
        }
    }
}

@Composable
private fun EmptySheetNote(text: String) {
    Text(
        text,
        fontSize = 13.sp,
        color = AppTheme.colors.textTertiary,
        modifier = Modifier.padding(vertical = 16.dp),
    )
}

@Composable
private fun CreateScheduleDialog(
    botId: String,
    onDismiss: () -> Unit,
    onCreated: () -> Unit,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }
    var everyMinutes by remember { mutableStateOf("1440") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = AppTheme.colors.surface,
        title = {
            Text(
                "Schedule Task",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Task Title", color = AppTheme.colors.textSecondary) },
                    placeholder = { Text("e.g. Daily Tech Briefing", color = AppTheme.colors.textTertiary) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text("Task Instructions", color = AppTheme.colors.textSecondary) },
                    placeholder = { Text("e.g. Research AI breakthroughs and summarize.", color = AppTheme.colors.textTertiary) },
                    minLines = 3,
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = everyMinutes,
                    onValueChange = { everyMinutes = it.filter { c -> c.isDigit() } },
                    label = { Text("Cadence (minutes, 1440 = Daily)", color = AppTheme.colors.textSecondary) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (name.isBlank() || prompt.isBlank()) return@Button
                    busy = true
                    scope.launch {
                        try {
                            val mins = everyMinutes.toIntOrNull()?.coerceAtLeast(15) ?: 1440
                            val input = RoutineInput(
                                name = name.trim(),
                                prompt = prompt.trim(),
                                botId = botId,
                                schedule = RoutineSchedule(
                                    type = RoutineSchedule.Kind.INTERVAL,
                                    everyMinutes = mins,
                                    anchorAt = System.currentTimeMillis(),
                                ),
                            )
                            session.saveRoutine(input, id = null)
                            onCreated()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && name.isNotBlank() && prompt.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = AppTheme.colors.accent,
                    contentColor = AppTheme.colors.onAccent,
                ),
            ) {
                if (busy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = AppTheme.colors.onAccent,
                    )
                } else {
                    Text("Create", fontWeight = FontWeight.Medium)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = AppTheme.colors.textSecondary)
            }
        },
    )
}

private fun humanizeAbilityName(raw: String): String {
    val norm = raw.trim().lowercase().replace("-", "_")
    return when (norm) {
        "google_maps" -> "Google Maps"
        "googledrive", "google_drive" -> "Google Drive"
        "gmail" -> "Gmail"
        "neon_mcp", "neon" -> "Neon Database"
        "supabase" -> "Supabase"
        "firecrawl" -> "Firecrawl"
        "github" -> "GitHub"
        "slack" -> "Slack"
        "notion" -> "Notion"
        else -> {
            val stripped = raw.replace(Regex("_mcp$", RegexOption.IGNORE_CASE), "")
            stripped.split("_", " ")
                .filter { it.isNotBlank() }
                .joinToString(" ") { word ->
                    word.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
                }
        }
    }
}

private fun formatOverviewCapabilities(abilities: List<AbilityOverview>): String {
    val enabled = abilities.filter { it.available }
    if (enabled.isEmpty()) return "Web • Files • Tools"

    val coreLabels = mutableListOf<String>()
    var integrationsCount = 0

    for (ability in enabled) {
        val nameLower = ability.name.lowercase()
        val idLower = ability.id.lowercase()
        when {
            nameLower.contains("search") || nameLower.contains("web") -> {
                if ("Web" !in coreLabels) coreLabels.add("Web")
            }
            nameLower.contains("file") || nameLower.contains("workspace") -> {
                if ("Files" !in coreLabels) coreLabels.add("Files")
            }
            nameLower.contains("browser") -> {
                if ("Browser" !in coreLabels) coreLabels.add("Browser")
            }
            nameLower.contains("device") || nameLower.contains("control") || idLower.contains("device") -> {
                if ("Device control" !in coreLabels) coreLabels.add("Device control")
            }
            nameLower.contains("terminal") || nameLower.contains("cli") -> {
                if ("Terminal" !in coreLabels) coreLabels.add("Terminal")
            }
            else -> {
                integrationsCount++
            }
        }
    }

    val primary = coreLabels.take(3).toMutableList()
    if (integrationsCount > 0) {
        primary.add(if (integrationsCount == 1) "1 integration" else "$integrationsCount integrations")
    } else if (coreLabels.size > 3) {
        primary.add(coreLabels[3])
    }

    if (primary.isEmpty()) {
        return "Web • Files • Tools"
    }
    return primary.joinToString(" • ")
}

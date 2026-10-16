package com.openmausbot.companion.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.AbilityOverview
import com.openmausbot.companion.core.ActivityOverview
import com.openmausbot.companion.core.AutomationOverview
import com.openmausbot.companion.core.BotOverview
import com.openmausbot.companion.core.CalendarDayOverview
import com.openmausbot.companion.core.CalendarItemOverview
import com.openmausbot.companion.core.GoalOverview
import com.openmausbot.companion.core.MemoryItemOverview
import com.openmausbot.companion.core.RoutineInput
import com.openmausbot.companion.core.RoutineSchedule
import com.openmausbot.companion.core.UpcomingItemOverview
import com.openmausbot.companion.core.WatchOverview
import kotlinx.coroutines.launch

/**
 * Bot Command Center — Dynamic, proactive personal AI operating system view.
 *
 * Exposes real scheduled actions, persistent weekly calendar, durable memory,
 * active goals, world awareness watches, verified connected capabilities, and
 * human-readable activity history. Styled strictly adhering to the OLED dark/minimal
 * Grok-standard design system without emojis or marketing copy.
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

    val botName = overview?.who?.name ?: state.bot(botId)?.name.orEmpty()
    val title = if (botName.isNotBlank()) "$botName Command Center" else "Command Center"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AppTheme.colors.background)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    title,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = AppTheme.colors.textPrimary,
                )
                Text(
                    overview?.who?.title?.ifBlank { "Standing by" } ?: "Standing by",
                    fontSize = 12.sp,
                    color = AppTheme.colors.textSecondary,
                )
            }
            IconButton(onClick = { showCreateScheduleDialog = true }) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = "Add Schedule",
                    tint = AppTheme.colors.textPrimary,
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
                    .padding(vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                val current = overview
                when {
                    loading -> Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                    current != null -> CommandCenterBody(
                        botId = botId,
                        overview = current,
                        onAddSchedule = { showCreateScheduleDialog = true },
                        onRefresh = { scope.launch { refresh(showProgress = true) } },
                    )
                    failed -> FormSection(header = null) {
                        Text(OverviewRules.FAILED, color = AppTheme.colors.textSecondary)
                    }
                }
            }
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
private fun CommandCenterBody(
    botId: String,
    overview: BotOverview,
    onAddSchedule: () -> Unit,
    onRefresh: () -> Unit,
) {
    // 1. Identity Lead
    IdentitySection(overview)

    // 2. Weekly Calendar (Section 1)
    WeeklyCalendarSection(
        calendar = overview.calendar,
        onAddSchedule = onAddSchedule,
    )

    // 3. Upcoming Scheduled Actions (Section 2)
    if (overview.upcoming.isNotEmpty()) {
        UpcomingSection(upcoming = overview.upcoming, onRefresh = onRefresh)
    }

    // 4. Goals Engine (Part 2)
    if (overview.goals.isNotEmpty()) {
        GoalsSection(botId = botId, goals = overview.goals, onRefresh = onRefresh)
    }

    // 5. World Awareness / Watches (Part 3)
    if (overview.watches.isNotEmpty()) {
        WatchesSection(botId = botId, watches = overview.watches, onRefresh = onRefresh)
    }

    // 6. What I Remember (Section 3)
    MemorySection(memory = overview.memory)

    // 7. Automations & Routines (Section 4)
    if (overview.automations.isNotEmpty()) {
        AutomationsSection(automations = overview.automations)
    }

    // 8. Connected Abilities (Section 5)
    ConnectedAbilitiesSection(abilities = overview.abilities)

    // 9. Recent Activity (Section 6)
    if (overview.activities.isNotEmpty()) {
        RecentActivitySection(activities = overview.activities)
    }
}

@Composable
private fun IdentitySection(overview: BotOverview) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(AppTheme.colors.surface)
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(16.dp)),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    overview.who.name,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = AppTheme.colors.textPrimary,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(AppTheme.colors.positive)
                    )
                    Text(
                        "ONLINE",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.positive,
                        letterSpacing = 0.5.sp,
                    )
                }
            }
            if (overview.who.title.isNotBlank()) {
                Text(
                    overview.who.title,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = AppTheme.colors.textPrimary,
                )
            }
            if (overview.who.blurb.isNotBlank()) {
                Text(
                    overview.who.blurb,
                    fontSize = 13.sp,
                    color = AppTheme.colors.textSecondary,
                )
            }
            if (overview.who.soulLead.isNotBlank()) {
                Text(
                    overview.who.soulLead,
                    fontSize = 12.sp,
                    color = AppTheme.colors.textTertiary,
                )
            }
        }
    }
}

@Composable
private fun WeeklyCalendarSection(
    calendar: List<CalendarDayOverview>,
    onAddSchedule: () -> Unit,
) {
    val initialDay = calendar.find { it.isToday } ?: calendar.firstOrNull()
    var selectedDay by remember(calendar) { mutableStateOf(initialDay) }

    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "WEEKLY SCHEDULE",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textTertiary,
                letterSpacing = 1.sp,
            )
            TextButton(
                onClick = onAddSchedule,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
            ) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = AppTheme.colors.textPrimary,
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    "Add Task",
                    fontSize = 12.sp,
                    color = AppTheme.colors.textPrimary,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        // 7-day strip
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            calendar.take(7).forEach { day ->
                val isSelected = selectedDay?.dayDate == day.dayDate
                val hasItems = day.items.isNotEmpty()

                Column(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            when {
                                isSelected -> AppTheme.colors.textPrimary
                                day.isToday -> AppTheme.colors.surfaceRaised
                                else -> AppTheme.colors.surface
                            }
                        )
                        .border(
                            1.dp,
                            when {
                                isSelected -> AppTheme.colors.textPrimary
                                day.isToday -> AppTheme.colors.border
                                else -> AppTheme.colors.hairline
                            },
                            RoundedCornerShape(10.dp),
                        )
                        .clickable { selectedDay = day }
                        .padding(vertical = 10.dp, horizontal = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = day.dayName.uppercase(),
                        fontSize = 10.sp,
                        fontWeight = if (day.isToday) FontWeight.Bold else FontWeight.Medium,
                        color = if (isSelected) AppTheme.colors.background else AppTheme.colors.textTertiary,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = day.dayNumber.toString(),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isSelected) AppTheme.colors.background else AppTheme.colors.textPrimary,
                    )
                    Spacer(Modifier.height(4.dp))
                    Box(
                        modifier = Modifier
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(
                                when {
                                    hasItems && isSelected -> AppTheme.colors.background
                                    hasItems -> AppTheme.colors.brand
                                    else -> Color.Transparent
                                }
                            )
                    )
                }
            }
        }

        // Selected Day Details Card
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(AppTheme.colors.surface)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val currentSelected = selectedDay
                val dateTitle = if (currentSelected?.isToday == true) "Today's Schedule (${currentSelected.dayDate})" else "Schedule for ${currentSelected?.dayDate ?: "Selected Day"}"
                Text(
                    dateTitle,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = AppTheme.colors.textPrimary,
                )

                if (currentSelected == null || currentSelected.items.isEmpty()) {
                    Text(
                        "No scheduled items on this day.",
                        fontSize = 12.sp,
                        color = AppTheme.colors.textTertiary,
                    )
                } else {
                    currentSelected.items.forEach { item ->
                        CalendarItemRow(item)
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarItemRow(item: CalendarItemOverview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AppTheme.colors.surfaceSunken)
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(AppTheme.colors.surfaceRaised)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(4.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        ) {
            Text(
                item.time,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                color = AppTheme.colors.textSecondary,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                item.title,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = AppTheme.colors.textPrimary,
            )
            val desc = item.description
            if (!desc.isNullOrBlank()) {
                Text(
                    desc,
                    fontSize = 11.sp,
                    color = AppTheme.colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        StatusChip(
            text = item.status.uppercase(),
            isPositive = item.status == "completed" || item.status == "active",
        )
    }
}

@Composable
private fun UpcomingSection(
    upcoming: List<UpcomingItemOverview>,
    onRefresh: () -> Unit,
) {
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "UPCOMING ACTIONS",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(AppTheme.colors.surface)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                upcoming.take(5).forEach { item ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(AppTheme.colors.surfaceSunken)
                            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                item.title,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                color = AppTheme.colors.textPrimary,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(item.formattedTime, fontSize = 11.sp, color = AppTheme.colors.textTertiary)
                                item.cadence?.let {
                                    Text("• $it", fontSize = 11.sp, color = AppTheme.colors.textSecondary)
                                }
                            }
                        }
                        StatusChip(text = item.status.uppercase(), isPositive = true)
                    }
                }
            }
        }
    }
}

@Composable
private fun GoalsSection(
    botId: String,
    goals: List<GoalOverview>,
    onRefresh: () -> Unit,
) {
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "ACTIVE GOALS",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        goals.forEach { goal ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            goal.title,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                            color = AppTheme.colors.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                        StatusChip(
                            text = goal.status.uppercase(),
                            isPositive = goal.status == "completed",
                            isDanger = goal.status == "blocked",
                        )
                    }

                    // Progress bar
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(
                                "Milestones (${goal.completedMilestones}/${goal.milestoneCount})",
                                fontSize = 11.sp,
                                color = AppTheme.colors.textTertiary,
                            )
                            Text(
                                "${goal.progress}%",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = AppTheme.colors.textPrimary,
                            )
                        }
                        LinearProgressIndicator(
                            progress = { goal.progress / 100f },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp)),
                            color = AppTheme.colors.accent,
                            trackColor = AppTheme.colors.hairline,
                        )
                    }

                    // Next Action Callout (Zero Emojis)
                    goal.nextAction?.let { action ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(AppTheme.colors.surfaceRaised)
                                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(AppTheme.colors.surfaceSunken)
                                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(4.dp))
                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    "NEXT",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = AppTheme.colors.textPrimary,
                                    letterSpacing = 0.5.sp,
                                )
                            }
                            Text(
                                action,
                                fontSize = 12.sp,
                                color = AppTheme.colors.textPrimary,
                            )
                        }
                    }

                    // Blockers Callout (Zero Emojis)
                    if (goal.blockers.isNotEmpty()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(AppTheme.colors.danger.copy(alpha = 0.1f))
                                .border(1.dp, AppTheme.colors.danger.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(AppTheme.colors.danger.copy(alpha = 0.2f))
                                    .border(1.dp, AppTheme.colors.danger.copy(alpha = 0.5f), RoundedCornerShape(4.dp))
                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    "BLOCKER",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = AppTheme.colors.danger,
                                    letterSpacing = 0.5.sp,
                                )
                            }
                            Text(
                                goal.blockers.joinToString(),
                                fontSize = 12.sp,
                                color = AppTheme.colors.textPrimary,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WatchesSection(
    botId: String,
    watches: List<WatchOverview>,
    onRefresh: () -> Unit,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var checkingId by remember { mutableStateOf<String?>(null) }

    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "MONITORED CONDITIONS",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        watches.forEach { watch ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            watch.condition,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            color = AppTheme.colors.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                        StatusChip(
                            text = watch.status.uppercase(),
                            isPositive = watch.status == "active",
                            isWarning = watch.status == "triggered",
                        )
                    }

                    Text(
                        "Target: ${watch.target}",
                        fontSize = 11.sp,
                        color = AppTheme.colors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Every ${watch.cadenceMinutes}m",
                            fontSize = 11.sp,
                            color = AppTheme.colors.textTertiary,
                        )
                        OutlinedButton(
                            onClick = {
                                checkingId = watch.id
                                scope.launch {
                                    session.checkWatch(botId, watch.id)
                                    checkingId = null
                                    onRefresh()
                                }
                            },
                            enabled = checkingId != watch.id,
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                            modifier = Modifier.height(26.dp),
                            border = BorderStroke(1.dp, AppTheme.colors.hairline),
                            shape = RoundedCornerShape(6.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = AppTheme.colors.textPrimary,
                            ),
                        ) {
                            if (checkingId == watch.id) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(10.dp),
                                    strokeWidth = 1.5.dp,
                                    color = AppTheme.colors.textPrimary,
                                )
                            } else {
                                Icon(
                                    Icons.Filled.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(11.dp),
                                    tint = AppTheme.colors.textPrimary,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "Check Now",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MemorySection(memory: List<MemoryItemOverview>) {
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "PERSISTENT MEMORY",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        if (memory.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
            ) {
                Text(
                    "Nothing memorized yet. As you chat, standing facts and preferences will appear here.",
                    modifier = Modifier.padding(14.dp),
                    fontSize = 12.sp,
                    color = AppTheme.colors.textTertiary,
                )
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
            ) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    memory.forEach { item ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(AppTheme.colors.surfaceSunken)
                                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                                .padding(10.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(AppTheme.colors.surfaceRaised)
                                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    item.category.uppercase(),
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = AppTheme.colors.textSecondary,
                                    letterSpacing = 0.5.sp,
                                )
                            }
                            Text(
                                item.text,
                                fontSize = 12.sp,
                                color = AppTheme.colors.textPrimary,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AutomationsSection(automations: List<AutomationOverview>) {
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "ACTIVE AUTOMATIONS",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(AppTheme.colors.surface)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                automations.forEach { auto ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(AppTheme.colors.surfaceSunken)
                            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.ic_schedule),
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = AppTheme.colors.textSecondary,
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                auto.name,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                color = AppTheme.colors.textPrimary,
                            )
                            Text(
                                auto.schedule,
                                fontSize = 11.sp,
                                color = AppTheme.colors.textTertiary,
                            )
                        }
                        StatusChip(
                            text = auto.status.uppercase(),
                            isPositive = auto.status == "active",
                            isDanger = auto.status == "failed",
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConnectedAbilitiesSection(abilities: List<AbilityOverview>) {
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "CAPABILITIES & TOOLS",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(AppTheme.colors.surface)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
        ) {
            FlowRow(
                modifier = Modifier.padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                abilities.forEach { ability ->
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(AppTheme.colors.surfaceSunken)
                            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 5.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(if (ability.available) AppTheme.colors.positive else AppTheme.colors.textTertiary)
                        )
                        Text(
                            ability.name,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            color = AppTheme.colors.textPrimary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentActivitySection(activities: List<ActivityOverview>) {
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "RECENT ACTIVITY",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textTertiary,
            letterSpacing = 1.sp,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(AppTheme.colors.surface)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(14.dp)),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                activities.take(8).forEach { act ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(AppTheme.colors.surfaceSunken)
                            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                    ) {
                        Text(
                            act.summary,
                            fontSize = 12.sp,
                            color = AppTheme.colors.textPrimary,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            RelativeStamp.dateAndTime(act.at),
                            fontSize = 10.sp,
                            color = AppTheme.colors.textTertiary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusChip(
    text: String,
    isPositive: Boolean = false,
    isDanger: Boolean = false,
    isWarning: Boolean = false,
) {
    val (bg, fg, border) = when {
        isPositive -> Triple(AppTheme.colors.positive.copy(alpha = 0.12f), AppTheme.colors.positive, AppTheme.colors.positive.copy(alpha = 0.3f))
        isDanger -> Triple(AppTheme.colors.danger.copy(alpha = 0.12f), AppTheme.colors.danger, AppTheme.colors.danger.copy(alpha = 0.3f))
        isWarning -> Triple(AppTheme.colors.caution.copy(alpha = 0.12f), AppTheme.colors.caution, AppTheme.colors.caution.copy(alpha = 0.3f))
        else -> Triple(AppTheme.colors.surfaceRaised, AppTheme.colors.textSecondary, AppTheme.colors.hairline)
    }

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            letterSpacing = 0.5.sp,
        )
    }
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
    var everyMinutes by remember { mutableStateOf("1440") } // Default daily
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = AppTheme.colors.surface,
        title = {
            Text(
                "Schedule Bot Task",
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

package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import com.openmausbot.companion.core.DailyBriefingData
import com.openmausbot.companion.core.DailyBriefingSectionData
import com.openmausbot.companion.core.SmartRecapData
import com.openmausbot.companion.core.SmartRecapSectionData
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Delight Features & Contextual Surfaces (Phase V / Master Prompt P8)
 *
 * Provides native bottom sheets for:
 * 1. Smart Recap ("What changed while you were away?")
 * 2. Daily Briefing (Calm morning briefing with calendar, routines, tasks, weather)
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SmartRecapSheet(
    onDismiss: () -> Unit,
    botId: String? = null,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var recap by remember { mutableStateOf<SmartRecapData?>(null) }
    var loading by remember { mutableStateOf(true) }

    fun loadRecap() {
        scope.launch {
            loading = true
            recap = session.getSmartRecap(botId = botId)
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        loadRecap()
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "What changed while you were away",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = "Past 24 hours fleet activity",
                        fontSize = 12.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
                IconButton(onClick = { loadRecap() }) {
                    Icon(
                        imageVector = Icons.Filled.Refresh,
                        contentDescription = "Refresh",
                        tint = AppTheme.colors.textSecondary,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = AppTheme.colors.accent)
                }
            } else {
                val currentRecap = recap
                if (currentRecap == null || currentRecap.sections.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "Everything has been calm. No new tasks or errors.",
                            fontSize = 14.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .background(AppTheme.colors.accent.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        ) {
                            Text(
                                text = "${currentRecap.totalChanges} updates recorded",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = AppTheme.colors.accent,
                            )
                        }
                    }

                    LazyColumn(
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(currentRecap.sections) { section ->
                            RecapSectionCard(section)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecapSectionCard(section: SmartRecapSectionData) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(10.dp))
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = section.title,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textPrimary,
        )
        for (item in section.items) {
            val botPrefix = item.botName?.let { "[$it] " } ?: ""
            Text(
                text = "• $botPrefix${item.summary}",
                fontSize = 12.sp,
                color = AppTheme.colors.textSecondary,
                lineHeight = 16.sp,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DailyBriefingSheet(
    onDismiss: () -> Unit,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var briefing by remember { mutableStateOf<DailyBriefingData?>(null) }
    var loading by remember { mutableStateOf(true) }
    var showSettings by remember { mutableStateOf(false) }

    var calendarEnabled by remember { mutableStateOf(true) }
    var routinesEnabled by remember { mutableStateOf(true) }
    var tasksEnabled by remember { mutableStateOf(true) }
    var agentResultsEnabled by remember { mutableStateOf(true) }
    var weatherEnabled by remember { mutableStateOf(false) }

    fun loadBriefing() {
        scope.launch {
            loading = true
            briefing = session.getDailyBriefing()
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        loadBriefing()
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = briefing?.greeting ?: "Daily Briefing",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = briefing?.date ?: "Today",
                        fontSize = 12.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
                IconButton(onClick = { showSettings = !showSettings }) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = "Preferences",
                        tint = if (showSettings) AppTheme.colors.accent else AppTheme.colors.textSecondary,
                    )
                }
                IconButton(onClick = { loadBriefing() }) {
                    Icon(
                        imageVector = Icons.Filled.Refresh,
                        contentDescription = "Refresh",
                        tint = AppTheme.colors.textSecondary,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            if (showSettings) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(10.dp))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "Briefing Content Preferences",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    BriefingToggleRow("Calendar Events", calendarEnabled) { calendarEnabled = it }
                    BriefingToggleRow("Scheduled Routines", routinesEnabled) { routinesEnabled = it }
                    BriefingToggleRow("Priority Tasks", tasksEnabled) { tasksEnabled = it }
                    BriefingToggleRow("Agent Highlights", agentResultsEnabled) { agentResultsEnabled = it }
                    BriefingToggleRow("Weather", weatherEnabled) { weatherEnabled = it }

                    Button(
                        onClick = {
                            scope.launch {
                                val cfg = buildJsonObject {
                                    put("calendarEnabled", calendarEnabled)
                                    put("routinesEnabled", routinesEnabled)
                                    put("tasksEnabled", tasksEnabled)
                                    put("agentResultsEnabled", agentResultsEnabled)
                                    put("weatherEnabled", weatherEnabled)
                                }
                                session.updateDailyBriefingConfig(cfg)
                                showSettings = false
                                loadBriefing()
                            }
                        },
                        modifier = Modifier.align(Alignment.End),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text("Save & Update", fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(10.dp))
            }

            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = AppTheme.colors.accent)
                }
            } else {
                val currentBriefing = briefing
                if (currentBriefing == null || currentBriefing.sections.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No briefing content available.",
                            fontSize = 14.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(currentBriefing.sections) { section ->
                            BriefingSectionCard(section)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BriefingToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, fontSize = 12.sp, color = AppTheme.colors.textPrimary)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun BriefingSectionCard(section: DailyBriefingSectionData) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(10.dp))
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = section.title,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = AppTheme.colors.textPrimary,
        )
        if (section.items.isEmpty()) {
            Text(
                text = section.emptyMessage ?: "None scheduled.",
                fontSize = 12.sp,
                color = AppTheme.colors.textSecondary,
            )
        } else {
            for (item in section.items) {
                val sub = listOfNotNull(item.time, item.subtitle).joinToString(" • ")
                Text(
                    text = "• ${item.title}${if (sub.isNotEmpty()) " ($sub)" else ""}",
                    fontSize = 12.sp,
                    color = AppTheme.colors.textPrimary,
                    lineHeight = 16.sp,
                )
            }
        }
    }
}

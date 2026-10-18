package com.openmausbot.companion.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.ArtifactData
import com.openmausbot.companion.core.CalendarData
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChartData
import com.openmausbot.companion.core.ChecklistData
import com.openmausbot.companion.core.CodeData
import com.openmausbot.companion.core.ComparisonData
import com.openmausbot.companion.core.DashboardData
import com.openmausbot.companion.core.DecisionMatrixData
import com.openmausbot.companion.core.DiagramData
import com.openmausbot.companion.core.FormData
import com.openmausbot.companion.core.GanttData
import com.openmausbot.companion.core.KanbanData
import com.openmausbot.companion.core.MapData
import com.openmausbot.companion.core.MediaData
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.SemanticCardData
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import com.openmausbot.companion.core.CompletionCardData
import com.openmausbot.companion.core.DailyBriefingData
import com.openmausbot.companion.core.ProductData
import com.openmausbot.companion.core.ResearchResultData
import com.openmausbot.companion.core.SmartRecapData
import com.openmausbot.companion.core.SourcesData
import com.openmausbot.companion.core.StructuredComponent
import com.openmausbot.companion.core.StructuredResponseData
import com.openmausbot.companion.core.TableData
import com.openmausbot.companion.core.TextComponentData
import com.openmausbot.companion.core.TimelineData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive

/**
 * Native Structured Response System (Phase J)
 *
 * Declarative Jetpack Compose renderers for structured AI responses.
 * Mobile-first, accessible, theme-integrated, and interactive.
 */

private val jsonParser = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

@Composable
fun StructuredResponseView(
    chat: Chat,
    message: Message,
    structured: StructuredResponseData,
    modifier: Modifier = Modifier,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
    ) {
        for (component in structured.components) {
            if (component.type == "text") {
                TextRenderer(component)
            } else {
                ComponentContainer(component = component, onEvent = onEvent) {
                    when (component.type) {
                        "table" -> TableRenderer(component)
                        "chart" -> ChartRenderer(component)
                        "timeline" -> TimelineRenderer(component)
                        "kanban" -> KanbanRenderer(component)
                        "checklist" -> ChecklistRenderer(component, onEvent)
                        "comparison" -> ComparisonRenderer(component)
                        "decision_matrix" -> DecisionMatrixRenderer(component)
                        "dashboard" -> DashboardRenderer(component)
                        "card" -> SemanticCardRenderer(component)
                        "product" -> ProductCardRenderer(component, onEvent)
                        "result" -> ResearchResultCardRenderer(component, onEvent)
                        "sources" -> SourcesRenderer(component)
                        "code" -> CodeRenderer(component)
                        "diagram" -> DiagramRenderer(component)
                        "map" -> MapRenderer(component)
                        "calendar" -> CalendarRenderer(component)
                        "gantt" -> GanttRenderer(component)
                        "artifact" -> ArtifactRenderer(component, onEvent)
                        "form" -> FormRenderer(component, onEvent)
                        "media" -> MediaRenderer(component)
                        "completion" -> CompletionRenderer(component, onEvent)
                        "smart_recap" -> SmartRecapRenderer(component, onEvent)
                        "daily_briefing" -> DailyBriefingRenderer(component, onEvent)
                        else -> FallbackRenderer(component)
                    }
                }
            }
        }
    }
}

@Composable
private fun ComponentContainer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    var remixOpen by remember { mutableStateOf(false) }
    val isSelfContainedCard = component.type in listOf("result", "product")
    val title = component.title
    val subtitle = component.subtitle
    val showHeader = !isSelfContainedCard && (!title.isNullOrBlank() || !subtitle.isNullOrBlank() || onEvent != null)

    AppCard(
        modifier = Modifier.fillMaxWidth(),
        color = AppTheme.colors.surface,
        bordered = true,
        contentPadding = PaddingValues(if (isSelfContainedCard) 14.dp else AppSpacing.md),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(if (isSelfContainedCard) 10.dp else AppSpacing.sm),
        ) {
            if (showHeader) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        if (!title.isNullOrBlank()) {
                            Text(
                                text = title,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AppTheme.colors.textPrimary,
                        )
                    }
                    if (!subtitle.isNullOrBlank()) {
                        Text(
                            text = subtitle,
                            fontSize = 13.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }
                if (onEvent != null) {
                    Box {
                        TextButton(
                            onClick = { remixOpen = true },
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                        ) {
                            Text(
                                text = "Remix",
                                style = MaterialTheme.typography.labelSmall,
                                color = AppTheme.colors.textSecondary,
                            )
                        }
                        DropdownMenu(expanded = remixOpen, onDismissRequest = { remixOpen = false }) {
                            when (component.type) {
                                "chart" -> {
                                    DropdownMenuItem(
                                        text = { Text("Switch to Bar Chart") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "bar_chart"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Switch to Line Chart") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "line_chart"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Summarize Trends") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "trends"))
                                        },
                                    )
                                }
                                "table" -> {
                                    DropdownMenuItem(
                                        text = { Text("Convert to Chart") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "chart"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Highlight Key Metrics") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "metrics"))
                                        },
                                    )
                                }
                                "checklist" -> {
                                    DropdownMenuItem(
                                        text = { Text("Convert to Timeline") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "timeline"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Convert to Kanban") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "kanban"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Regenerate Items") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "regenerate"))
                                        },
                                    )
                                }
                                "kanban" -> {
                                    DropdownMenuItem(
                                        text = { Text("Convert to Checklist") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "checklist"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Convert to Timeline") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "timeline"))
                                        },
                                    )
                                }
                                "timeline" -> {
                                    DropdownMenuItem(
                                        text = { Text("Convert to Checklist") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "checklist"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Convert to Gantt") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "gantt"))
                                        },
                                    )
                                }
                                "gantt" -> {
                                    DropdownMenuItem(
                                        text = { Text("Convert to Timeline") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "timeline"))
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Convert to Checklist") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "checklist"))
                                        },
                                    )
                                }
                                "diagram" -> {
                                    DropdownMenuItem(
                                        text = { Text("Convert to Architecture Outline") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "outline"))
                                        },
                                    )
                                }
                                else -> {
                                    DropdownMenuItem(
                                        text = { Text("Regenerate Section") },
                                        onClick = {
                                            remixOpen = false
                                            onEvent(component.id, "remix", mapOf("targetType" to "regenerate"))
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        content()

            val actions = component.actions
            if (!actions.isNullOrEmpty()) {
                val uriHandler = LocalUriHandler.current
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    actions.forEach { action ->
                        val isPrimary = action.style == "primary"
                        val isDanger = action.style == "danger"
                        val actionUrl = action.url
                        val onClick: () -> Unit = {
                            if (!actionUrl.isNullOrBlank()) {
                                try { uriHandler.openUri(actionUrl) } catch (_: Exception) {}
                            }
                            onEvent?.invoke(component.id, action.id, actionUrl?.let { mapOf("url" to it) } ?: emptyMap())
                        }
                        if (isPrimary) {
                            Button(
                                onClick = onClick,
                                enabled = action.disabled != true,
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            ) {
                                Text(action.label, fontSize = 12.sp)
                            }
                        } else {
                            OutlinedButton(
                                onClick = onClick,
                                enabled = action.disabled != true,
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            ) {
                                Text(
                                    text = action.label,
                                    fontSize = 12.sp,
                                    color = if (isDanger) AppTheme.colors.danger else AppTheme.colors.textPrimary,
                                )
                            }
                        }
                    }
                }
            }

            val desc = component.description
            if (!desc.isNullOrBlank()) {
                Text(
                    text = desc,
                    fontSize = 11.sp,
                    color = AppTheme.colors.textSecondary,
                    modifier = Modifier.semantics {
                        contentDescription = desc
                    },
                )
            }
        }
    }
}

// ── 1. Table Renderer ──
@Composable
private fun TableRenderer(component: StructuredComponent) {
    val table = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<TableData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (table == null || table.columns.isEmpty() || table.rows.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    var sortColumnKey by remember { mutableStateOf<String?>(null) }
    var sortAscending by remember { mutableStateOf(true) }
    var showAllColumns by remember { mutableStateOf(false) }

    val visibleColumns = remember(table.columns, showAllColumns) {
        if (showAllColumns || table.columns.size <= 3) {
            table.columns
        } else {
            table.columns.filter { it.priority == 1 }.ifEmpty { table.columns.take(3) }
        }
    }

    val sortedRows = remember(table.rows, sortColumnKey, sortAscending) {
        val key = sortColumnKey
        if (key == null) table.rows
        else {
            table.rows.sortedWith { a, b ->
                val vA = a[key]?.jsonPrimitive?.content ?: ""
                val vB = b[key]?.jsonPrimitive?.content ?: ""
                val numA = vA.toDoubleOrNull()
                val numB = vB.toDoubleOrNull()
                val cmp = if (numA != null && numB != null) numA.compareTo(numB) else vA.compareTo(vB)
                if (sortAscending) cmp else -cmp
            }
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        // Table Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                .padding(vertical = 8.dp, horizontal = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            for (col in visibleColumns) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(enabled = col.sortable) {
                            if (sortColumnKey == col.key) {
                                sortAscending = !sortAscending
                            } else {
                                sortColumnKey = col.key
                                sortAscending = true
                            }
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = if (col.numeric) Arrangement.End else Arrangement.Start,
                ) {
                    Text(
                        text = col.label,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (sortColumnKey == col.key) {
                        Text(
                            text = if (sortAscending) " ↑" else " ↓",
                            fontSize = 12.sp,
                            color = AppTheme.colors.accent,
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Table Rows
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            sortedRows.take(15).forEachIndexed { index, row ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            if (index % 2 == 1) AppTheme.colors.surfaceRaised else Color.Transparent,
                            RoundedCornerShape(4.dp),
                        )
                        .padding(vertical = 6.dp, horizontal = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    for (col in visibleColumns) {
                        val rawValue = row[col.key]?.jsonPrimitive?.content ?: "—"
                        Text(
                            text = rawValue,
                            fontSize = 13.sp,
                            color = AppTheme.colors.textPrimary,
                            modifier = Modifier.weight(1f),
                            textAlign = if (col.numeric) TextAlign.End else TextAlign.Start,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }

        if (table.columns.size > 3) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = if (showAllColumns) "Show priority columns" else "Show all ${table.columns.size} columns",
                fontSize = 12.sp,
                color = AppTheme.colors.accent,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clickable { showAllColumns = !showAllColumns }
                    .padding(vertical = 4.dp),
            )
        }
    }
}

// ── 2. Chart Renderer ──
@Composable
private fun ChartRenderer(component: StructuredComponent) {
    val chart = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<ChartData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (chart == null || chart.labels.isEmpty() || chart.series.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    val primaryColor = AppTheme.colors.accent

    val accessibleDescription = chart.accessibleText ?: buildString {
        append("Chart type: ${chart.chartType}. ")
        chart.series.forEach { s ->
            append("${s.name}: ${s.data.joinToString(", ")}. ")
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = accessibleDescription },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val series = chart.series.firstOrNull()
        if (series != null && series.data.isNotEmpty()) {
            val maxVal = remember(series.data) {
                val max = series.data.maxOrNull() ?: 1.0
                if (max <= 0.0) 1.0 else max
            }

            if (chart.chartType == "horizontal_bar") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    series.data.forEachIndexed { i, valD ->
                        val label = chart.labels.getOrElse(i) { "Item ${i + 1}" }
                        val fraction = (valD / maxVal).coerceIn(0.0, 1.0).toFloat()
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = label,
                                fontSize = 12.sp,
                                modifier = Modifier.width(70.dp),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(18.dp)
                                    .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(4.dp)),
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth(fraction)
                                        .height(18.dp)
                                        .background(primaryColor, RoundedCornerShape(4.dp)),
                                )
                            }
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "${valD.toInt()}${chart.unit ?: ""}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.width(40.dp),
                                textAlign = TextAlign.End,
                            )
                        }
                    }
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(140.dp)
                        .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                ) {
                    Canvas(modifier = Modifier.matchParentSize()) {
                        val count = series.data.size
                        val barWidth = (size.width / (count * 1.5f)).coerceAtLeast(8.dp.toPx())
                        val spacing = (size.width - (barWidth * count)) / (count + 1)

                        if (chart.chartType == "line" || chart.chartType == "sparkline") {
                            val path = Path()
                            series.data.forEachIndexed { index, v ->
                                val x = spacing + index * (barWidth + spacing) + barWidth / 2
                                val y = size.height - ((v / maxVal).toFloat() * (size.height - 16.dp.toPx())) - 8.dp.toPx()
                                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                                drawCircle(color = primaryColor, radius = 4.dp.toPx(), center = Offset(x, y))
                            }
                            drawPath(
                                path = path,
                                color = primaryColor,
                                style = Stroke(width = 3.dp.toPx()),
                            )
                        } else {
                            series.data.forEachIndexed { index, v ->
                                val barHeight = ((v / maxVal).toFloat() * (size.height - 16.dp.toPx())).coerceAtLeast(4.dp.toPx())
                                val left = spacing + index * (barWidth + spacing)
                                val top = size.height - barHeight
                                drawRoundRect(
                                    color = primaryColor,
                                    topLeft = Offset(left, top),
                                    size = Size(barWidth, barHeight),
                                    cornerRadius = CornerRadius(4.dp.toPx(), 4.dp.toPx()),
                                    style = Fill,
                                )
                            }
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    chart.labels.take(6).forEach { label ->
                        Text(
                            text = label,
                            fontSize = 11.sp,
                            color = AppTheme.colors.textSecondary,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

// ── 3. Timeline Renderer ──
@Composable
private fun TimelineRenderer(component: StructuredComponent) {
    val timeline = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<TimelineData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (timeline == null || timeline.items.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        timeline.items.forEachIndexed { index, item ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.width(24.dp),
                ) {
                    val dotColor = when (item.status) {
                        "completed" -> Color(0xFF10B981)
                        "in_progress" -> Color(0xFF3B82F6)
                        "cancelled" -> Color(0xFFEF4444)
                        else -> AppTheme.colors.textSecondary
                    }
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(dotColor, CircleShape),
                    )
                    if (index < timeline.items.size - 1) {
                        Box(
                            modifier = Modifier
                                .width(2.dp)
                                .height(32.dp)
                                .background(AppTheme.colors.hairline),
                        )
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = item.title,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AppTheme.colors.textPrimary,
                        )
                        val ts = item.timestamp
                        if (!ts.isNullOrBlank()) {
                            Text(
                                text = ts,
                                fontSize = 11.sp,
                                color = AppTheme.colors.textSecondary,
                            )
                        }
                    }
                    val itemDesc = item.description
                    if (!itemDesc.isNullOrBlank()) {
                        Text(
                            text = itemDesc,
                            fontSize = 12.sp,
                            color = AppTheme.colors.textSecondary,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

// ── 4. Kanban Renderer ──
@Composable
private fun KanbanRenderer(component: StructuredComponent) {
    val kanban = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<KanbanData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (kanban == null || kanban.columns.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    var selectedTabIndex by remember { mutableIntStateOf(0) }
    val currentColumn = kanban.columns.getOrElse(selectedTabIndex) { kanban.columns.first() }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ScrollableTabRow(
            selectedTabIndex = selectedTabIndex,
            edgePadding = 0.dp,
            containerColor = Color.Transparent,
            divider = {},
            modifier = Modifier.fillMaxWidth(),
        ) {
            kanban.columns.forEachIndexed { i, col ->
                Tab(
                    selected = selectedTabIndex == i,
                    onClick = { selectedTabIndex = i },
                    text = {
                        Text(
                            text = "${col.title} (${col.cards.size})",
                            fontSize = 13.sp,
                            fontWeight = if (selectedTabIndex == i) FontWeight.Bold else FontWeight.Normal,
                        )
                    },
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (currentColumn.cards.isEmpty()) {
                Text(
                    text = "No cards in this column",
                    fontSize = 13.sp,
                    color = AppTheme.colors.textSecondary,
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                currentColumn.cards.forEach { card ->
                    AppCard(
                        modifier = Modifier.fillMaxWidth(),
                        color = AppTheme.colors.surfaceRaised,
                        contentPadding = PaddingValues(10.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = card.title,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AppTheme.colors.textPrimary,
                                    modifier = Modifier.weight(1f),
                                )
                                card.priority?.let { p ->
                                    val pillColor = when (p) {
                                        "urgent" -> Color(0xFFEF4444)
                                        "high" -> Color(0xFFF59E0B)
                                        "medium" -> Color(0xFF3B82F6)
                                        else -> AppTheme.colors.textSecondary
                                    }
                                    Text(
                                        text = p.uppercase(),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        modifier = Modifier
                                            .background(pillColor, CircleShape)
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                            }
                            val cardDesc = card.description
                            if (!cardDesc.isNullOrBlank()) {
                                Text(
                                    text = cardDesc,
                                    fontSize = 12.sp,
                                    color = AppTheme.colors.textSecondary,
                                )
                            }
                            val cardAssignee = card.assignee
                            if (!cardAssignee.isNullOrBlank()) {
                                Text(
                                    text = "Assignee: $cardAssignee",
                                    fontSize = 11.sp,
                                    color = AppTheme.colors.textSecondary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── 5. Checklist Renderer ──
@Composable
private fun ChecklistRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)?,
) {
    val checklist = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<ChecklistData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (checklist == null || checklist.items.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    val checkedMap = remember {
        mutableStateMapOf<String, Boolean>().apply {
            checklist.items.forEach { put(it.id, it.checked) }
        }
    }

    val total = checklist.items.size
    val completed = checkedMap.values.count { it }
    val progress = if (total > 0) completed.toFloat() / total else 0f

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "$completed of $total completed",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = AppTheme.colors.textSecondary,
            )
            Text(
                text = "${(progress * 100).toInt()}%",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.accent,
            )
        }
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(CircleShape),
            color = AppTheme.colors.accent,
            trackColor = AppTheme.colors.surfaceSunken,
        )

        Spacer(modifier = Modifier.height(4.dp))

        checklist.items.forEach { item ->
            val isChecked = checkedMap[item.id] ?: item.checked
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        val next = !isChecked
                        checkedMap[item.id] = next
                        onEvent?.invoke(component.id, "toggle", mapOf("itemId" to item.id))
                    }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(20.dp)
                        .background(
                            if (isChecked) AppTheme.colors.accent else AppTheme.colors.surfaceSunken,
                            RoundedCornerShape(4.dp),
                        )
                        .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(4.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (isChecked) {
                        Icon(
                            imageVector = Icons.Filled.Check,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                }

                Spacer(modifier = Modifier.width(10.dp))

                Text(
                    text = item.label,
                    fontSize = 14.sp,
                    color = if (isChecked) AppTheme.colors.textSecondary else AppTheme.colors.textPrimary,
                    textDecoration = if (isChecked) TextDecoration.LineThrough else TextDecoration.None,
                    modifier = Modifier.weight(1f),
                )

                item.priority?.let { p ->
                    Text(
                        text = p,
                        fontSize = 10.sp,
                        color = AppTheme.colors.textSecondary,
                        modifier = Modifier
                            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
        }
    }
}

// ── 6. Comparison Renderer ──
@Composable
private fun ComparisonRenderer(component: StructuredComponent) {
    val comparison = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<ComparisonData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (comparison == null || comparison.items.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        comparison.recommendation?.let { rec ->
            val winnerName = comparison.items.getOrNull(rec.itemIndex) ?: "Selected Option"
            AppCard(
                modifier = Modifier.fillMaxWidth(),
                color = Color(0xFFECFDF5),
                bordered = true,
                contentPadding = PaddingValues(10.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = "Recommendation: $winnerName",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF065F46),
                    )
                    Text(
                        text = rec.reason,
                        fontSize = 12.sp,
                        color = Color(0xFF047857),
                    )
                }
            }
        }

        comparison.criteria.forEach { criterion ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(8.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = criterion.name,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textPrimary,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    comparison.items.forEachIndexed { idx, item ->
                        val value = criterion.values.getOrNull(idx) ?: "—"
                        val isWinner = criterion.winnerIndex == idx
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = 4.dp),
                        ) {
                            Text(
                                text = item,
                                fontSize = 11.sp,
                                color = AppTheme.colors.textSecondary,
                            )
                            Text(
                                text = value,
                                fontSize = 13.sp,
                                fontWeight = if (isWinner) FontWeight.Bold else FontWeight.Normal,
                                color = if (isWinner) AppTheme.colors.accent else AppTheme.colors.textPrimary,
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── 7. Decision Matrix Renderer ──
@Composable
private fun DecisionMatrixRenderer(component: StructuredComponent) {
    val matrix = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<DecisionMatrixData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (matrix == null || matrix.options.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val rec = matrix.recommendation
        if (!rec.isNullOrBlank()) {
            Text(
                text = "Recommendation: $rec",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF059669),
            )
        }

        matrix.options.forEach { opt ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(4.dp))
                    .padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = opt.name,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                )
                val total = opt.totalScore ?: opt.scores.sum()
                Text(
                    text = "Score: ${"%.1f".format(total)}",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.accent,
                )
            }
        }
    }
}

// ── 8. Dashboard Renderer ──
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DashboardRenderer(component: StructuredComponent) {
    val dashboard = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<DashboardData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (dashboard == null || dashboard.metrics.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            maxItemsInEachRow = 2,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            dashboard.metrics.forEach { metric ->
                AppCard(
                    modifier = Modifier.weight(1f),
                    color = AppTheme.colors.surfaceRaised,
                    contentPadding = PaddingValues(10.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = metric.label,
                            fontSize = 11.sp,
                            color = AppTheme.colors.textSecondary,
                            maxLines = 1,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = metric.value,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = AppTheme.colors.textPrimary,
                            )
                            metric.change?.let { ch ->
                                val trendColor = when (metric.trend) {
                                    "up" -> Color(0xFF10B981)
                                    "down" -> Color(0xFFEF4444)
                                    else -> AppTheme.colors.textSecondary
                                }
                                Text(
                                    text = ch,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = trendColor,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── 9. Semantic Card Renderer ──
@Composable
private fun SemanticCardRenderer(component: StructuredComponent) {
    val card = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<SemanticCardData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (card == null) {
        FallbackRenderer(component)
        return
    }

    val accentColor = when (card.variant) {
        "success" -> Color(0xFF10B981)
        "warning" -> Color(0xFFF59E0B)
        "error" -> Color(0xFFEF4444)
        "recommendation" -> Color(0xFF6366F1)
        "approval" -> Color(0xFF14B8A6)
        else -> AppTheme.colors.accent
    }
    val bg = accentColor.copy(alpha = 0.12f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(12.dp))
            .border(1.dp, accentColor.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = card.headline,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                card.badge?.let { b ->
                    Text(
                        text = b,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = accentColor,
                        modifier = Modifier
                            .background(accentColor.copy(alpha = 0.15f), CircleShape)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            if (card.body.isNotBlank()) {
                Text(
                    text = card.body,
                    fontSize = 13.sp,
                    color = AppTheme.colors.textPrimary,
                )
            }
            card.metadata?.takeIf { it.isNotEmpty() }?.let { meta ->
                Spacer(modifier = Modifier.height(4.dp))
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(AppTheme.colors.surfaceSunken.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    meta.forEach { (k, v) ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(text = k, fontSize = 11.sp, color = AppTheme.colors.textSecondary)
                            Text(text = v, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                        }
                    }
                }
            }
        }
    }
}

// ── 10. Sources Renderer ──
@Composable
private fun SourcesRenderer(component: StructuredComponent) {
    val sources = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<SourcesData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (sources == null || sources.sources.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    val uriHandler = LocalUriHandler.current

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        sources.sources.forEach { s ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(8.dp))
                    .clickable {
                        try {
                            uriHandler.openUri(s.url)
                        } catch (_: Exception) {}
                    }
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = s.title,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    s.domain?.let { d ->
                        Text(
                            text = d,
                            fontSize = 11.sp,
                            color = AppTheme.colors.accent,
                        )
                    }
                }
                Text("Open", fontSize = 12.sp, color = AppTheme.colors.textSecondary)
            }
        }
    }
}

// ── 11. Code Renderer ──
@Composable
private fun CodeRenderer(component: StructuredComponent) {
    val code = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<CodeData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (code == null) {
        FallbackRenderer(component)
        return
    }

    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = code.filename ?: code.language.uppercase(),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textSecondary,
            )
            Text(
                text = if (copied) "Copied!" else "Copy",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = AppTheme.colors.accent,
                modifier = Modifier.clickable {
                    clipboard.setText(AnnotatedString(code.code))
                    copied = true
                },
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
        ) {
            Text(
                text = code.code,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = AppTheme.colors.textPrimary,
            )
        }
    }
}

// ── 12. Diagram Renderer ──
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DiagramRenderer(component: StructuredComponent) {
    val diagram = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<DiagramData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (diagram == null || diagram.nodes.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    var selectedNodeId by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = diagram.diagramType.replace('_', ' ').uppercase(),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.accent,
            )
            Text(
                text = "${diagram.nodes.size} nodes • ${diagram.edges.size} connections",
                fontSize = 11.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        val accessibleText = diagram.accessibleText
        if (!accessibleText.isNullOrBlank()) {
            Text(
                text = accessibleText,
                fontSize = 12.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            diagram.nodes.forEach { node ->
                val isSelected = selectedNodeId == node.id
                val statusColor = when (node.status) {
                    "ok" -> AppTheme.colors.positive
                    "warning" -> AppTheme.colors.caution
                    "error" -> AppTheme.colors.danger
                    "active" -> AppTheme.colors.accent
                    else -> AppTheme.colors.surfaceRaised
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(
                            if (isSelected) AppTheme.colors.surfaceRaised
                            else AppTheme.colors.surfaceSunken
                        )
                        .border(
                            width = if (isSelected) 1.5.dp else 1.dp,
                            color = if (isSelected) AppTheme.colors.accent else AppTheme.colors.hairline,
                            shape = RoundedCornerShape(8.dp),
                        )
                        .clickable {
                            selectedNodeId = if (isSelected) null else node.id
                        }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (node.status != null) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(statusColor)
                            )
                        }
                        Column {
                            Text(
                                text = node.label,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = AppTheme.colors.textPrimary,
                            )
                            node.type?.let { nodeType ->
                                Text(
                                    text = nodeType.lowercase(),
                                    fontSize = 10.sp,
                                    color = AppTheme.colors.textSecondary,
                                )
                            }
                        }
                    }
                }
            }
        }

        val selectedNode = diagram.nodes.find { it.id == selectedNodeId }
        if (selectedNode != null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(8.dp))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "Node Details: ${selectedNode.label}",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textPrimary,
                )
                val nodeDesc = selectedNode.description
                if (!nodeDesc.isNullOrBlank()) {
                    Text(
                        text = nodeDesc,
                        fontSize = 12.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }

                val outgoing = diagram.edges.filter { it.from == selectedNode.id }
                if (outgoing.isNotEmpty()) {
                    Text(
                        text = "Connects to: " + outgoing.joinToString { edge ->
                            val target = diagram.nodes.find { it.id == edge.to }?.label ?: edge.to
                            if (edge.label != null) "$target (${edge.label})" else target
                        },
                        fontSize = 11.sp,
                        color = AppTheme.colors.accent,
                    )
                }
            }
        } else if (diagram.edges.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "Connections",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textSecondary,
                )
                diagram.edges.take(5).forEach { edge ->
                    val fromName = diagram.nodes.find { it.id == edge.from }?.label ?: edge.from
                    val toName = diagram.nodes.find { it.id == edge.to }?.label ?: edge.to
                    val labelText = if (edge.label != null) " [${edge.label}]" else ""
                    Text(
                        text = "• $fromName → $toName$labelText",
                        fontSize = 11.sp,
                        color = AppTheme.colors.textPrimary,
                    )
                }
                if (diagram.edges.size > 5) {
                    Text(
                        text = "+ ${diagram.edges.size - 5} more connections",
                        fontSize = 10.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            }
        }
    }
}

// ── 13. Map Renderer ──
@Composable
private fun MapRenderer(component: StructuredComponent) {
    val map = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<MapData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (map == null) {
        FallbackRenderer(component)
        return
    }

    val uriHandler = LocalUriHandler.current

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(130.dp)
                .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "${map.markers.size} Location${if (map.markers.size > 1) "s" else ""}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textPrimary,
                )
                Text(
                    text = "Center: ${"%.4f".format(map.center.lat)}, ${"%.4f".format(map.center.lng)}",
                    fontSize = 11.sp,
                    color = AppTheme.colors.textSecondary,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Box(
                    modifier = Modifier
                        .background(AppTheme.colors.accent.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                        .clickable {
                            try {
                                val geoUri = "geo:${map.center.lat},${map.center.lng}?q=${map.center.lat},${map.center.lng}"
                                uriHandler.openUri(geoUri)
                            } catch (_: Exception) {}
                        }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = "Tap to open in Google Maps",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = AppTheme.colors.accent,
                    )
                }
            }
        }

        if (map.markers.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                map.markers.forEach { marker ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(6.dp))
                            .clickable {
                                try {
                                    val geoUri = "geo:${marker.lat},${marker.lng}?q=${marker.lat},${marker.lng}(${marker.title})"
                                    uriHandler.openUri(geoUri)
                                } catch (_: Exception) {}
                            }
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    text = marker.title,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AppTheme.colors.textPrimary,
                                )
                                marker.badge?.let { b ->
                                    Box(
                                        modifier = Modifier
                                            .background(AppTheme.colors.accent.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    ) {
                                        Text(text = b, fontSize = 10.sp, color = AppTheme.colors.accent)
                                    }
                                }
                            }
                            marker.snippet?.let { s ->
                                Text(
                                    text = s,
                                    fontSize = 11.sp,
                                    color = AppTheme.colors.textSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        Text("Open", fontSize = 12.sp, color = AppTheme.colors.textSecondary)
                    }
                }
            }
        }

        val routes = map.routes
        if (!routes.isNullOrEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                routes.forEach { route ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(6.dp))
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = route.name ?: "Route (${route.points.size} waypoints)",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = AppTheme.colors.textPrimary,
                        )
                        route.distance?.let { d ->
                            Text(text = d, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = AppTheme.colors.accent)
                        }
                    }
                }
            }
        }
    }
}

// ── 14. Calendar Renderer ──
@Composable
private fun CalendarRenderer(component: StructuredComponent) {
    val cal = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<CalendarData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (cal == null || cal.events.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    val endDate = cal.endDate

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "${cal.viewMode?.uppercase() ?: "AGENDA"} • ${cal.startDate}" + (if (!endDate.isNullOrBlank()) " – $endDate" else ""),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.accent,
            )
            Text(
                text = "${cal.events.size} event${if (cal.events.size > 1) "s" else ""}",
                fontSize = 11.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        cal.events.forEach { event ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(
                    modifier = Modifier.width(56.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = if (event.allDay) "ALL DAY" else event.start.substringAfter("T", event.start).take(5),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    val eventEnd = event.end
                    if (!event.allDay && !eventEnd.isNullOrBlank()) {
                        Text(
                            text = eventEnd.substringAfter("T", eventEnd).take(5),
                            fontSize = 10.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .height(36.dp)
                        .background(AppTheme.colors.accent, RoundedCornerShape(1.5.dp))
                )

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = event.title,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AppTheme.colors.textPrimary,
                        )
                        event.category?.let { cat ->
                            Box(
                                modifier = Modifier
                                    .background(AppTheme.colors.accent.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Text(text = cat, fontSize = 9.sp, color = AppTheme.colors.accent)
                            }
                        }
                    }
                    val location = event.location
                    if (!location.isNullOrBlank()) {
                        Text(
                            text = location,
                            fontSize = 11.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                    val eventDesc = event.description
                    if (!eventDesc.isNullOrBlank()) {
                        Text(
                            text = eventDesc,
                            fontSize = 11.sp,
                            color = AppTheme.colors.textSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

// ── 15. Gantt Renderer ──
@Composable
private fun GanttRenderer(component: StructuredComponent) {
    val gantt = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<GanttData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (gantt == null || gantt.tasks.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "${gantt.startDate} → ${gantt.endDate}",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.accent,
            )
            Text(
                text = "${gantt.tasks.size} tasks",
                fontSize = 11.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        gantt.tasks.forEach { task ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = task.name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = "${task.progress.toInt()}%",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (task.progress >= 100.0) AppTheme.colors.positive else AppTheme.colors.accent,
                    )
                }

                LinearProgressIndicator(
                    progress = { (task.progress / 100.0).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = if (task.progress >= 100.0) AppTheme.colors.positive else AppTheme.colors.accent,
                    trackColor = AppTheme.colors.surfaceRaised,
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "${task.start} – ${task.end}",
                        fontSize = 10.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                    task.status?.let { st ->
                        Text(
                            text = st.uppercase(),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium,
                            color = when (st) {
                                "done" -> AppTheme.colors.positive
                                "blocked" -> AppTheme.colors.danger
                                "in_progress" -> AppTheme.colors.accent
                                else -> AppTheme.colors.textSecondary
                            },
                        )
                    }
                }
            }
        }

        val milestones = gantt.milestones
        if (!milestones.isNullOrEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                milestones.forEach { m ->
                    Row(
                        modifier = Modifier
                            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(if (m.completed) AppTheme.colors.positive else AppTheme.colors.caution, CircleShape),
                        )
                        Text(text = m.name, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = AppTheme.colors.textPrimary)
                        Text(text = "(${m.date})", fontSize = 10.sp, color = AppTheme.colors.textSecondary)
                    }
                }
            }
        }
    }
}

// ── 16. Artifact Renderer ──
@Composable
private fun ArtifactRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val artifact = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<ArtifactData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (artifact == null) {
        FallbackRenderer(component)
        return
    }

    val uriHandler = LocalUriHandler.current
    var expanded by remember { mutableStateOf(false) }

    val typeBadge = when (artifact.artifactType) {
        "pdf" -> "PDF"
        "document" -> "DOC"
        "spreadsheet", "csv" -> "CSV"
        "image" -> "IMG"
        "video" -> "VID"
        "audio" -> "AUD"
        "code_project" -> "CODE"
        "archive" -> "ZIP"
        "report" -> "REP"
        "dataset" -> "DATA"
        else -> "FILE"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(8.dp))
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(AppTheme.colors.accent.copy(alpha = 0.12f), RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = typeBadge,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    color = AppTheme.colors.accent,
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = artifact.title,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val filename = artifact.filename
                val sizeBytes = artifact.sizeBytes
                val mimeType = artifact.mimeType
                val subtitle = buildString {
                    filename?.let { append(it) }
                    sizeBytes?.let {
                        if (isNotEmpty()) append(" • ")
                        append(if (it >= 1024 * 1024) "${it / (1024 * 1024)} MB" else "${it / 1024} KB")
                    }
                    mimeType?.let {
                        if (isNotEmpty()) append(" • ")
                        append(it)
                    }
                }
                if (subtitle.isNotEmpty()) {
                    Text(
                        text = subtitle,
                        fontSize = 11.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            }
        }

        val summary = artifact.summary
        if (!summary.isNullOrBlank()) {
            Text(
                text = summary,
                fontSize = 12.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        if (artifact.previewLines.isNotEmpty()) {
            val linesToShow = if (expanded) artifact.previewLines else artifact.previewLines.take(3)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(6.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                linesToShow.forEach { line ->
                    Text(
                        text = line,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = AppTheme.colors.textPrimary,
                    )
                }
                if (artifact.previewLines.size > 3) {
                    Text(
                        text = if (expanded) "Show less" else "+ ${artifact.previewLines.size - 3} more lines",
                        fontSize = 11.sp,
                        color = AppTheme.colors.accent,
                        modifier = Modifier.clickable { expanded = !expanded },
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val artifactUrl = artifact.url
            if (!artifactUrl.isNullOrBlank()) {
                TextButton(
                    onClick = {
                        try {
                            uriHandler.openUri(artifactUrl)
                        } catch (_: Exception) {}
                    },
                ) {
                    Text("Open Artifact", fontSize = 12.sp, color = AppTheme.colors.accent)
                }
            }
            if (onEvent != null) {
                TextButton(
                    onClick = {
                        onEvent(component.id, "open_artifact", mapOf("title" to artifact.title))
                    },
                ) {
                    Text("View Details", fontSize = 12.sp, color = AppTheme.colors.textSecondary)
                }
            }
        }
    }
}

// ── 17. Form Renderer ──
@Composable
private fun FormRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val form = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<FormData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (form == null || form.fields.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    val formValues = remember {
        mutableStateMapOf<String, String>().apply {
            form.fields.forEach { f ->
                val initVal = f.value?.jsonPrimitive?.content ?: ""
                put(f.id, initVal)
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        form.fields.forEach { field ->
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = field.label + if (field.required) " *" else "",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = AppTheme.colors.textPrimary,
                )

                when (field.type) {
                    "toggle" -> {
                        val isChecked = formValues[field.id]?.toBooleanStrictOrNull() ?: false
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Switch(
                                checked = isChecked,
                                onCheckedChange = { formValues[field.id] = it.toString() },
                            )
                            Text(
                                text = if (isChecked) "Enabled" else "Disabled",
                                fontSize = 12.sp,
                                color = AppTheme.colors.textSecondary,
                            )
                        }
                    }
                    "single_choice" -> {
                        val currentVal = formValues[field.id] ?: ""
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            field.options.forEach { opt ->
                                val selected = currentVal == opt
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(if (selected) AppTheme.colors.accent else AppTheme.colors.surfaceRaised)
                                        .border(1.dp, if (selected) AppTheme.colors.accent else AppTheme.colors.hairline, RoundedCornerShape(16.dp))
                                        .clickable { formValues[field.id] = opt }
                                        .padding(horizontal = 12.dp, vertical = 6.dp),
                                ) {
                                    Text(
                                        text = opt,
                                        fontSize = 12.sp,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (selected) AppTheme.colors.onAccent else AppTheme.colors.textPrimary,
                                    )
                                }
                            }
                        }
                    }
                    "slider" -> {
                        val currentFloat = formValues[field.id]?.toFloatOrNull() ?: (field.min?.toFloat() ?: 0f)
                        val min = field.min?.toFloat() ?: 0f
                        val max = field.max?.toFloat() ?: 100f
                        Column {
                            Slider(
                                value = currentFloat.coerceIn(min, max),
                                onValueChange = { formValues[field.id] = it.toInt().toString() },
                                valueRange = min..max,
                            )
                            Text(
                                text = "Value: ${formValues[field.id] ?: min.toInt().toString()}",
                                fontSize = 11.sp,
                                color = AppTheme.colors.textSecondary,
                            )
                        }
                    }
                    else -> {
                        OutlinedTextField(
                            value = formValues[field.id] ?: "",
                            onValueChange = { formValues[field.id] = it },
                            placeholder = {
                                field.placeholder?.let { Text(it, fontSize = 12.sp) }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                    }
                }
            }
        }

        Button(
            onClick = {
                onEvent?.invoke(component.id, "submit_form", formValues.toMap())
            },
            modifier = Modifier.align(Alignment.End),
        ) {
            Text(form.submitLabel ?: "Submit", fontSize = 13.sp)
        }
    }
}

// ── 18. Media Renderer ──
@Composable
private fun MediaRenderer(component: StructuredComponent) {
    val media = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<MediaData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (media == null || media.items.isEmpty()) {
        FallbackRenderer(component)
        return
    }

    val uriHandler = LocalUriHandler.current

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = media.mediaType.uppercase(),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.accent,
            )
            Text(
                text = "${media.items.size} item${if (media.items.size > 1) "s" else ""}",
                fontSize = 11.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        media.items.forEach { item ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(8.dp))
                    .clickable {
                        try {
                            uriHandler.openUri(item.url)
                        } catch (_: Exception) {}
                    }
                    .padding(10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val mediaBadge = when (media.mediaType) {
                        "video" -> "VID"
                        "audio" -> "AUD"
                        else -> "IMG"
                    }
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .background(AppTheme.colors.accent.copy(alpha = 0.12f), RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = mediaBadge,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = AppTheme.colors.accent,
                        )
                    }

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = item.title ?: "Media Attachment",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AppTheme.colors.textPrimary,
                        )
                        val caption = item.caption
                        if (!caption.isNullOrBlank()) {
                            Text(
                                text = caption,
                                fontSize = 11.sp,
                                color = AppTheme.colors.textSecondary,
                            )
                        }
                        val duration = item.durationSeconds
                        if (duration != null) {
                            Text(
                                text = "Duration: ${duration.toInt()}s",
                                fontSize = 10.sp,
                                color = AppTheme.colors.accent,
                            )
                        }
                    }

                    Text("Open", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.accent)
                }
            }
        }
    }
}

// ── 19. Completion Card Renderer (Phase V) ──
@Composable
private fun CompletionRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val completion = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<CompletionCardData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (completion == null) {
        FallbackRenderer(component)
        return
    }

    val clipboardManager = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(12.dp))
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(12.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Task complete",
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
            )
            Spacer(Modifier.weight(1f))
            if (completion.durationSeconds != null) {
                Box(
                    modifier = Modifier
                        .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        text = "%.1fs".format(completion.durationSeconds),
                        fontSize = 11.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            }
        }

        Text(
            text = completion.taskTitle,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = AppTheme.colors.textSecondary,
        )

        if (completion.outcomes.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "Created:",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                )
                for (outcome in completion.outcomes) {
                    val countPrefix = outcome.count?.let { "$it " } ?: ""
                    val detailSuffix = outcome.detail?.let { " ($it)" } ?: ""
                    Text(
                        text = "• $countPrefix${outcome.label}$detailSuffix",
                        fontSize = 12.sp,
                        color = AppTheme.colors.textPrimary,
                    )
                }
            }
        }

        // Action controls: [Open result] [Preview] [Share]
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                onClick = {
                    onEvent?.invoke(
                        component.id,
                        "open_result",
                        mapOf("artifactId" to (completion.artifactId ?: ""))
                    )
                },
                shape = RoundedCornerShape(8.dp),
            ) {
                Text("Open result", fontSize = 12.sp)
            }

            val previewUrl = completion.previewUrl
            if (!previewUrl.isNullOrBlank()) {
                OutlinedButton(
                    onClick = {
                        try {
                            uriHandler.openUri(previewUrl)
                        } catch (_: Exception) {}
                        onEvent?.invoke(
                            component.id,
                            "preview",
                            mapOf("url" to previewUrl)
                        )
                    },
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text("Preview", fontSize = 12.sp)
                }
            }

            OutlinedButton(
                onClick = {
                    val shareContent = buildString {
                        append("Task complete: ${completion.taskTitle}\n")
                        if (completion.outcomes.isNotEmpty()) {
                            append("Created:\n")
                            for (o in completion.outcomes) {
                                append("- ${o.count?.let { "$it " } ?: ""}${o.label}\n")
                            }
                        }
                    }
                    clipboardManager.setText(AnnotatedString(shareContent))
                    onEvent?.invoke(component.id, "share", mapOf("content" to shareContent))
                },
                shape = RoundedCornerShape(8.dp),
            ) {
                Text("Share", fontSize = 12.sp)
            }
        }
    }
}

// ── 20. Smart Recap Renderer (Phase V) ──
@Composable
private fun SmartRecapRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val recap = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<SmartRecapData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (recap == null) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(12.dp))
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(12.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = recap.headline,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
            )
            Spacer(Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .background(AppTheme.colors.accent.copy(alpha = 0.12f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    text = "${recap.totalChanges} updates",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.accent,
                )
            }
        }

        if (recap.sections.isEmpty()) {
            Text(
                text = "Everything was calm while you were away.",
                fontSize = 12.sp,
                color = AppTheme.colors.textSecondary,
            )
        } else {
            for (section in recap.sections) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = section.title,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    for (item in section.items) {
                        val botPrefix = item.botName?.let { "[$it] " } ?: ""
                        Text(
                            text = "• $botPrefix${item.summary}",
                            fontSize = 11.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }
            }
        }
    }
}

// ── 21. Daily Briefing Renderer (Phase V) ──
@Composable
private fun DailyBriefingRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val briefing = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<DailyBriefingData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (briefing == null) {
        FallbackRenderer(component)
        return
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(12.dp))
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(12.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = briefing.greeting,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = briefing.date,
                fontSize = 12.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        for (section in briefing.sections) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = section.title,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textPrimary,
                )
                if (section.items.isEmpty()) {
                    Text(
                        text = section.emptyMessage ?: "None scheduled.",
                        fontSize = 11.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                } else {
                    for (item in section.items) {
                        val sub = listOfNotNull(item.time, item.subtitle).joinToString(" • ")
                        Text(
                            text = "• ${item.title}${if (sub.isNotEmpty()) " ($sub)" else ""}",
                            fontSize = 11.sp,
                            color = AppTheme.colors.textPrimary,
                        )
                    }
                }
            }
        }
    }
}

// ── 23. Product Card Renderer ──
@Composable
private fun ProductCardRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val product = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<ProductData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (product == null) {
        FallbackRenderer(component)
        return
    }

    val uriHandler = LocalUriHandler.current
    val session = LocalCompanion.current.session

    var imageBitmap by remember(product.imageUrl) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(product.imageUrl) {
        val url = product.imageUrl?.trim()
        if (url.isNullOrEmpty()) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            try {
                if (url.startsWith("/api/attachments/") || url.startsWith("attachment:")) {
                    val path = if (url.startsWith("attachment:")) "/api/attachments/" + url.removePrefix("attachment:") else url
                    val bytes = session.attachmentImage(path)
                    if (bytes != null) {
                        imageBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                    }
                } else if (url.startsWith("http://") || url.startsWith("https://")) {
                    val conn = (java.net.URI(url).toURL().openConnection() as java.net.HttpURLConnection).apply {
                        connectTimeout = 5000
                        readTimeout = 5000
                        instanceFollowRedirects = true
                        setRequestProperty("User-Agent", "Mozilla/5.0 OpenMausBot")
                    }
                    if (conn.responseCode in 200..299) {
                        conn.inputStream.use { stream ->
                            val bytes = stream.readBytes()
                            if (bytes.isNotEmpty()) {
                                imageBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Graceful fallback: do not invent or break if image fails
            }
        }
    }

    val brandColor = AppTheme.colors.accent
    val priceColor = Color(0xFF10B981)

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Badge & Retailer row
        val badge = product.badge
        val retailer = product.retailer
        if (!badge.isNullOrBlank() || !retailer.isNullOrBlank()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!badge.isNullOrBlank()) {
                    Text(
                        text = badge,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = brandColor,
                        modifier = Modifier
                            .background(brandColor.copy(alpha = 0.12f), RoundedCornerShape(6.dp))
                            .border(1.dp, brandColor.copy(alpha = 0.30f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                } else {
                    Spacer(modifier = Modifier.weight(1f))
                }
                if (!retailer.isNullOrBlank()) {
                    Text(
                        text = retailer,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            }
        }

        // 2. Product Image (if available)
        imageBitmap?.let { bitmap ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 200.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(AppTheme.colors.surfaceSunken)
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    bitmap = bitmap,
                    contentDescription = product.name,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().padding(4.dp),
                )
            }
        }

        // 3. Name & Brand
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = product.name,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
            )
            if (!product.brand.isNullOrBlank()) {
                Text(
                    text = "by ${product.brand}",
                    fontSize = 12.sp,
                    color = AppTheme.colors.textSecondary,
                )
            }
        }

        // 4. Price & Rating row
        val price = product.price
        if (!price.isNullOrBlank() || product.rating != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!price.isNullOrBlank()) {
                    Text(
                        text = price,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = priceColor,
                    )
                }
                if (product.rating != null) {
                    val ratingStr = "%.1f / 5.0".format(java.util.Locale.US, product.rating) +
                        (product.reviewsCount?.let { " ($it)" } ?: "")
                    Text(
                        text = ratingStr,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFF59E0B),
                    )
                }
            }
        }

        // 5. Recommendation Reason
        val reason = product.reason
        if (!reason.isNullOrBlank()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(brandColor.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
                    .border(1.dp, brandColor.copy(alpha = 0.20f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Text(
                    text = reason,
                    fontSize = 12.5.sp,
                    lineHeight = 17.sp,
                    color = AppTheme.colors.textPrimary,
                )
            }
        }

        // 6. Key Details / Specs
        if (product.details.isNotEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                product.details.forEach { detail ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            text = "•",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = brandColor,
                        )
                        Text(
                            text = detail,
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }
            }
        }

        // 7. Metadata Key-Value Table (if present)
        product.metadata?.takeIf { it.isNotEmpty() }?.let { meta ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                meta.forEach { (k, v) ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(text = k, fontSize = 11.sp, color = AppTheme.colors.textSecondary)
                        Text(text = v, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                    }
                }
            }
        }

        // 8. Native Clickable Action Button ("View product")
        val destinationUrl = product.sourceUrl
        if (!destinationUrl.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(2.dp))
            Button(
                onClick = {
                    try {
                        uriHandler.openUri(destinationUrl)
                    } catch (_: Exception) {}
                    onEvent?.invoke(component.id, "view_product", mapOf("url" to destinationUrl))
                },
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(
                    text = product.actionLabel ?: "View product",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

// ── Generic Rich Research Result Card Renderer ──
@Composable
private fun ResearchResultCardRenderer(
    component: StructuredComponent,
    onEvent: ((componentId: String, action: String, payload: Map<String, String>) -> Unit)? = null,
) {
    val result = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<ResearchResultData>(it) }
        } catch (_: Exception) {
            null
        }
    }

    if (result == null) {
        FallbackRenderer(component)
        return
    }

    val uriHandler = LocalUriHandler.current
    val session = LocalCompanion.current.session

    var imageBitmap by remember(result.imageUrl) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(result.imageUrl) {
        val url = result.imageUrl?.trim()
        if (url.isNullOrEmpty()) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            try {
                if (url.startsWith("/api/attachments/") || url.startsWith("attachment:")) {
                    val path = if (url.startsWith("attachment:")) "/api/attachments/" + url.removePrefix("attachment:") else url
                    val bytes = session.attachmentImage(path)
                    if (bytes != null) {
                        imageBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                    }
                } else if (url.startsWith("http://") || url.startsWith("https://")) {
                    val conn = (java.net.URI(url).toURL().openConnection() as java.net.HttpURLConnection).apply {
                        connectTimeout = 5000
                        readTimeout = 5000
                        instanceFollowRedirects = true
                        setRequestProperty("User-Agent", "Mozilla/5.0 OpenMausBot")
                    }
                    if (conn.responseCode in 200..299) {
                        conn.inputStream.use { stream ->
                            val bytes = stream.readBytes()
                            if (bytes.isNotEmpty()) {
                                imageBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Graceful fallback: do not invent or break if image fails
            }
        }
    }

    val brandColor = AppTheme.colors.accent
    val priceColor = Color(0xFF10B981)

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Badge & Source row
        val badge = result.badge
        val source = result.source ?: result.sourceDomain
        if (!badge.isNullOrBlank() || !source.isNullOrBlank()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!badge.isNullOrBlank()) {
                    Text(
                        text = badge,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = brandColor,
                        modifier = Modifier
                            .background(brandColor.copy(alpha = 0.12f), RoundedCornerShape(6.dp))
                            .border(1.dp, brandColor.copy(alpha = 0.30f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                } else {
                    Spacer(modifier = Modifier.weight(1f))
                }
                if (!source.isNullOrBlank()) {
                    Text(
                        text = if (source.startsWith("Source:", ignoreCase = true)) source else "Source: $source",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            }
        }

        // 2. Legitimate Image (if available) - renders exactly once, clean fallback if absent
        imageBitmap?.let { bitmap ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 200.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(AppTheme.colors.surfaceSunken)
                    .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    bitmap = bitmap,
                    contentDescription = result.title,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().padding(4.dp),
                )
            }
        }

        // 3. Title & Subtitle / Company / Location
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = result.title,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
            )
            val sublineParts = listOfNotNull(
                result.company,
                result.location,
                result.subtitle?.takeIf { it != result.company && it != result.location }
            )
            if (sublineParts.isNotEmpty()) {
                Text(
                    text = sublineParts.joinToString(" • "),
                    fontSize = 12.sp,
                    color = AppTheme.colors.textSecondary,
                )
            }
        }

        // 4. Tags / Pills row (skills, technologies, key specs)
        val allTags = (result.tags + result.details).distinct().filter { it.isNotBlank() }
        if (allTags.isNotEmpty()) {
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                allTags.take(8).forEach { tag ->
                    Box(
                        modifier = Modifier
                            .background(AppTheme.colors.surfaceSunken, RoundedCornerShape(6.dp))
                            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(6.dp))
                            .padding(horizontal = 7.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = tag,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }
            }
        }

        // 5. Price / Salary & Rating row
        val priceOrSalary = result.salary ?: result.price
        if (!priceOrSalary.isNullOrBlank() || result.rating != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!priceOrSalary.isNullOrBlank()) {
                    Text(
                        text = priceOrSalary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = priceColor,
                    )
                }
                if (result.rating != null) {
                    val ratingStr = "%.1f / 5.0".format(java.util.Locale.US, result.rating) +
                        (result.reviewsCount?.let { " ($it)" } ?: "")
                    Text(
                        text = ratingStr,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFF59E0B),
                    )
                }
            }
        }

        // 6. Recommendation Reason / Match Rationale
        val reason = result.reason
        if (!reason.isNullOrBlank()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(brandColor.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
                    .border(1.dp, brandColor.copy(alpha = 0.20f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Text(
                    text = reason,
                    fontSize = 12.5.sp,
                    lineHeight = 17.sp,
                    color = AppTheme.colors.textPrimary,
                )
            }
        }

        // 7. Description (if different from reason)
        val desc = result.description
        if (!desc.isNullOrBlank() && desc != reason) {
            Text(
                text = desc,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = AppTheme.colors.textSecondary,
            )
        }

        // 8. Metadata Key-Value Table (if present)
        result.metadata?.takeIf { it.isNotEmpty() }?.let { meta ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.surfaceSunken.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                meta.forEach { (k, v) ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(text = k, fontSize = 11.sp, color = AppTheme.colors.textSecondary)
                        Text(text = v, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                    }
                }
            }
        }

        // 9. Native Clickable Action Button ("View Job", "View Product", "Book", etc.)
        val destinationUrl = result.actionUrl ?: result.sourceUrl ?: result.url
        if (!destinationUrl.isNullOrBlank() && (destinationUrl.startsWith("http://") || destinationUrl.startsWith("https://"))) {
            val label = result.actionLabel ?: when (result.resultType?.lowercase()) {
                "job" -> "View Job"
                "product" -> "View Product"
                "hotel", "travel" -> "View Hotel"
                "course" -> "View Course"
                "event" -> "View Event"
                else -> "Open Website"
            }
            Spacer(modifier = Modifier.height(2.dp))
            Button(
                onClick = {
                    try {
                        uriHandler.openUri(destinationUrl)
                    } catch (_: Exception) {}
                    onEvent?.invoke(component.id, "open_result", mapOf("url" to destinationUrl, "resultType" to (result.resultType ?: "general")))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(38.dp),
                shape = RoundedCornerShape(10.dp),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
            ) {
                Text(
                    text = label,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

// ── Prose / Markdown Text Renderer ──
@Composable
private fun TextRenderer(component: StructuredComponent) {
    val textData = remember(component.data) {
        try {
            component.data?.let { jsonParser.decodeFromJsonElement<TextComponentData>(it) }
        } catch (_: Exception) {
            null
        }
    }
    val content = textData?.text ?: component.data?.jsonPrimitive?.content ?: component.title ?: ""
    val sanitized = remember(content) { stripEmojis(content) }
    if (sanitized.isNotBlank()) {
        Column(
            modifier = Modifier
                .background(BubbleColor.theirs, RoundedCornerShape(18.dp))
                .padding(horizontal = 16.dp, vertical = 13.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            MarkdownText(
                source = sanitized,
            )
        }
    }
}

// ── Safe Fallback Renderer ──
@Composable
private fun FallbackRenderer(component: StructuredComponent) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.surfaceRaised, RoundedCornerShape(8.dp))
            .padding(10.dp),
    ) {
        Text(
            text = component.data?.toString() ?: component.title ?: "Structured content",
            fontSize = 12.sp,
            color = AppTheme.colors.textSecondary,
        )
    }
}

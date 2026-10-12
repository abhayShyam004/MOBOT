package com.openmausbot.companion.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class StructuredResponseData(
    val version: Int = 1,
    val components: List<StructuredComponent> = emptyList(),
)

@Serializable
data class StructuredComponent(
    val id: String,
    val type: String,
    val title: String? = null,
    val subtitle: String? = null,
    val description: String? = null,
    val data: JsonElement? = null,
    val actions: List<ComponentAction>? = null,
)

@Serializable
data class ComponentAction(
    val id: String,
    val label: String,
    val style: String? = null,
    val disabled: Boolean? = null,
)

// ── 1. Table ──
@Serializable
data class TableColumn(
    val key: String,
    val label: String,
    val numeric: Boolean = false,
    val sortable: Boolean = true,
    val priority: Int = 1,
)

@Serializable
data class TableData(
    val columns: List<TableColumn> = emptyList(),
    val rows: List<Map<String, JsonElement>> = emptyList(),
    val compact: Boolean = false,
    val expandable: Boolean = false,
)

// ── 2. Chart ──
@Serializable
data class ChartSeries(
    val name: String,
    val data: List<Double> = emptyList(),
    val color: String? = null,
)

@Serializable
data class ChartData(
    val chartType: String = "bar",
    val labels: List<String> = emptyList(),
    val series: List<ChartSeries> = emptyList(),
    val unit: String? = null,
    val accessibleText: String? = null,
)

// ── 3. Timeline ──
@Serializable
data class TimelineItem(
    val id: String,
    val title: String,
    val timestamp: String? = null,
    val description: String? = null,
    val status: String = "completed",
    val icon: String? = null,
)

@Serializable
data class TimelineData(
    val items: List<TimelineItem> = emptyList(),
)

// ── 4. Kanban ──
@Serializable
data class KanbanCard(
    val id: String,
    val title: String,
    val description: String? = null,
    val priority: String? = "medium",
    val assignee: String? = null,
    val tag: String? = null,
)

@Serializable
data class KanbanColumn(
    val id: String,
    val title: String,
    val cards: List<KanbanCard> = emptyList(),
)

@Serializable
data class KanbanData(
    val columns: List<KanbanColumn> = emptyList(),
)

// ── 5. Checklist ──
@Serializable
data class ChecklistSubtask(
    val id: String,
    val label: String,
    val checked: Boolean = false,
)

@Serializable
data class ChecklistItem(
    val id: String,
    val label: String,
    val checked: Boolean = false,
    val priority: String? = null,
    val dueDate: String? = null,
    val subtasks: List<ChecklistSubtask>? = null,
)

@Serializable
data class ChecklistData(
    val items: List<ChecklistItem> = emptyList(),
)

// ── 6. Comparison ──
@Serializable
data class ComparisonCriterion(
    val name: String,
    val values: List<String> = emptyList(),
    val winnerIndex: Int? = null,
)

@Serializable
data class ComparisonRecommendation(
    val itemIndex: Int = 0,
    val reason: String = "",
)

@Serializable
data class ComparisonData(
    val items: List<String> = emptyList(),
    val criteria: List<ComparisonCriterion> = emptyList(),
    val recommendation: ComparisonRecommendation? = null,
    val pros: Map<String, List<String>>? = null,
    val cons: Map<String, List<String>>? = null,
)

// ── 7. Decision Matrix ──
@Serializable
data class DecisionCriterion(
    val name: String,
    val weight: Double = 1.0,
)

@Serializable
data class DecisionOption(
    val name: String,
    val scores: List<Double> = emptyList(),
    val totalScore: Double? = null,
)

@Serializable
data class DecisionMatrixData(
    val criteria: List<DecisionCriterion> = emptyList(),
    val options: List<DecisionOption> = emptyList(),
    val recommendation: String? = null,
    val explanation: String? = null,
)

// ── 8. Dashboard ──
@Serializable
data class MetricTile(
    val id: String,
    val label: String,
    val value: String,
    val change: String? = null,
    val trend: String? = "neutral",
    val status: String? = "normal",
)

@Serializable
data class DashboardAlert(
    val id: String,
    val message: String,
    val severity: String = "info",
)

@Serializable
data class DashboardData(
    val metrics: List<MetricTile> = emptyList(),
    val alerts: List<DashboardAlert>? = null,
)

// ── 9. Semantic Card ──
@Serializable
data class SemanticCardData(
    val variant: String = "info",
    val headline: String,
    val body: String,
    val badge: String? = null,
    val metadata: Map<String, String>? = null,
)

// ── 10. Sources ──
@Serializable
data class SourceItem(
    val url: String,
    val title: String,
    val domain: String? = null,
    val snippet: String? = null,
    val date: String? = null,
)

@Serializable
data class SourcesData(
    val sources: List<SourceItem> = emptyList(),
)

// ── 11. Code ──
@Serializable
data class CodeData(
    val language: String = "text",
    val code: String,
    val filename: String? = null,
    val collapsible: Boolean = false,
    val highlightLines: List<Int>? = null,
)

// ── 12. Diagram ──
@Serializable
data class DiagramNode(
    val id: String,
    val label: String,
    val type: String? = null,
    val description: String? = null,
    val status: String? = null,
)

@Serializable
data class DiagramEdge(
    val from: String,
    val to: String,
    val label: String? = null,
    val style: String? = null,
)

@Serializable
data class DiagramData(
    val diagramType: String = "flowchart",
    val nodes: List<DiagramNode> = emptyList(),
    val edges: List<DiagramEdge> = emptyList(),
    val accessibleText: String? = null,
)

// ── 13. Map ──
@Serializable
data class MapCoordinate(
    val lat: Double,
    val lng: Double,
)

@Serializable
data class MapMarker(
    val id: String,
    val title: String,
    val lat: Double,
    val lng: Double,
    val snippet: String? = null,
    val badge: String? = null,
)

@Serializable
data class MapRoute(
    val id: String,
    val name: String? = null,
    val points: List<MapCoordinate> = emptyList(),
    val distance: String? = null,
)

@Serializable
data class MapData(
    val center: MapCoordinate,
    val zoom: Double? = null,
    val markers: List<MapMarker> = emptyList(),
    val routes: List<MapRoute> = emptyList(),
)

// ── 14. Calendar ──
@Serializable
data class CalendarEvent(
    val id: String,
    val title: String,
    val start: String,
    val end: String? = null,
    val allDay: Boolean = false,
    val category: String? = null,
    val color: String? = null,
    val description: String? = null,
    val location: String? = null,
    val recurrence: String? = null,
)

@Serializable
data class CalendarData(
    val viewMode: String? = "agenda",
    val startDate: String,
    val endDate: String? = null,
    val events: List<CalendarEvent> = emptyList(),
)

// ── 15. Gantt ──
@Serializable
data class GanttTask(
    val id: String,
    val name: String,
    val start: String,
    val end: String,
    val progress: Double = 0.0,
    val dependencies: List<String> = emptyList(),
    val status: String? = null,
    val assignee: String? = null,
)

@Serializable
data class GanttMilestone(
    val id: String,
    val name: String,
    val date: String,
    val completed: Boolean = false,
)

@Serializable
data class GanttData(
    val startDate: String,
    val endDate: String,
    val tasks: List<GanttTask> = emptyList(),
    val milestones: List<GanttMilestone> = emptyList(),
)

// ── 16. Artifact ──
@Serializable
data class ArtifactData(
    val artifactType: String = "document",
    val title: String,
    val filename: String? = null,
    val sizeBytes: Long? = null,
    val mimeType: String? = null,
    val summary: String? = null,
    val url: String? = null,
    val previewLines: List<String> = emptyList(),
    val metadata: Map<String, String>? = null,
)

// ── 17. Form ──
@Serializable
data class FormField(
    val id: String,
    val label: String,
    val type: String,
    val value: JsonElement? = null,
    val options: List<String> = emptyList(),
    val placeholder: String? = null,
    val required: Boolean = false,
    val min: Double? = null,
    val max: Double? = null,
    val step: Double? = null,
)

@Serializable
data class FormData(
    val fields: List<FormField> = emptyList(),
    val submitLabel: String? = "Submit",
)

// ── 18. Media ──
@Serializable
data class MediaItem(
    val url: String,
    val title: String? = null,
    val caption: String? = null,
    val thumbnail: String? = null,
    val durationSeconds: Double? = null,
)

@Serializable
data class MediaData(
    val mediaType: String = "image",
    val items: List<MediaItem> = emptyList(),
)

// ── 19. Completion Card (Phase V) ──
@Serializable
data class CompletionOutcome(
    val label: String,
    val count: Int? = null,
    val detail: String? = null,
)

@Serializable
data class CompletionCardData(
    val taskTitle: String,
    val status: String = "completed",
    val durationSeconds: Double? = null,
    val outcomes: List<CompletionOutcome> = emptyList(),
    val artifactId: String? = null,
    val previewUrl: String? = null,
)

// ── 20. Smart Recap (Phase V) ──
@Serializable
data class SmartRecapItemData(
    val id: String,
    val botId: String? = null,
    val botName: String? = null,
    val threadId: String? = null,
    val summary: String,
    val timestamp: Long = 0L,
)

@Serializable
data class SmartRecapSectionData(
    val category: String,
    val title: String,
    val items: List<SmartRecapItemData> = emptyList(),
)

@Serializable
data class SmartRecapData(
    val headline: String = "What changed while you were away",
    val sinceTimestamp: Long = 0L,
    val generatedAt: Long = 0L,
    val totalChanges: Int = 0,
    val sections: List<SmartRecapSectionData> = emptyList(),
    val formattedMarkdown: String? = null,
)

// ── 21. Daily Briefing (Phase V) ──
@Serializable
data class DailyBriefingItemData(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val time: String? = null,
    val status: String? = null,
    val priority: String? = null,
)

@Serializable
data class DailyBriefingSectionData(
    val id: String,
    val title: String,
    val items: List<DailyBriefingItemData> = emptyList(),
    val emptyMessage: String? = null,
)

@Serializable
data class DailyBriefingData(
    val date: String,
    val greeting: String,
    val sections: List<DailyBriefingSectionData> = emptyList(),
    val formattedMarkdown: String? = null,
)

@Serializable
data class SmartRecapResponse(
    val recap: SmartRecapData,
)

@Serializable
data class DailyBriefingResponse(
    val briefing: DailyBriefingData,
)



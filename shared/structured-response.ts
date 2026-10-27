// MOBOT Structured Response Protocol (Phase J)
//
// Declarative, versioned contract for native components in chat.
// Designed for mobile-first rendering in Jetpack Compose, persisted in SQLite,
// and interactively responsive via structured events.

export const STRUCTURED_PROTOCOL_VERSION = 1;

export const LIMITS = {
  MAX_COMPONENTS: 20,
  MAX_TABLE_ROWS: 500,
  MAX_TABLE_COLS: 30,
  MAX_CHART_POINTS: 200,
  MAX_PAYLOAD_BYTES: 256 * 1024,
  MAX_STRING_LENGTH: 10_000,
} as const;

export type StructuredComponentType =
  | "table"
  | "chart"
  | "timeline"
  | "kanban"
  | "checklist"
  | "comparison"
  | "decision_matrix"
  | "dashboard"
  | "diagram"
  | "map"
  | "calendar"
  | "gantt"
  | "code"
  | "artifact"
  | "form"
  | "media"
  | "card"
  | "sources"
  | "product"
  | "result"
  | "text"
  | "match_scorecard"
  | "player_stats"
  | "standings_table"
  | "medal_tally"
  | "data_card";

export interface ComponentAction {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  url?: string;
}

// ── 1. Table ──
export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  priority?: number; // 1 = high (always visible on mobile), 2 = normal, 3 = expandable
}

export interface TableComponentData {
  columns: TableColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  compact?: boolean;
  expandable?: boolean;
}

// ── 2. Chart ──
export type ChartType =
  | "line"
  | "bar"
  | "horizontal_bar"
  | "area"
  | "stacked_bar"
  | "stacked_area"
  | "pie"
  | "donut"
  | "scatter"
  | "histogram"
  | "heatmap"
  | "radar"
  | "sparkline";

export interface ChartSeries {
  name: string;
  data: number[];
  color?: string;
}

export interface ChartComponentData {
  chartType: ChartType;
  labels: string[];
  series: ChartSeries[];
  unit?: string;
  accessibleText?: string;
}

// ── 3. Timeline ──
export interface TimelineItem {
  id: string;
  title: string;
  timestamp?: string;
  description?: string;
  status?: "completed" | "in_progress" | "pending" | "cancelled";
  icon?: string;
}

export interface TimelineComponentData {
  items: TimelineItem[];
}

// ── 4. Kanban ──
export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  assignee?: string;
  tag?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export interface KanbanComponentData {
  columns: KanbanColumn[];
}

// ── 5. Checklist ──
export interface ChecklistSubtask {
  id: string;
  label: string;
  checked: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  priority?: "low" | "medium" | "high";
  dueDate?: string;
  subtasks?: ChecklistSubtask[];
}

export interface ChecklistComponentData {
  items: ChecklistItem[];
}

// ── 6. Comparison ──
export interface ComparisonCriterion {
  name: string;
  values: string[];
  winnerIndex?: number;
}

export interface ComparisonComponentData {
  items: string[];
  criteria: ComparisonCriterion[];
  recommendation?: {
    itemIndex: number;
    reason: string;
  };
  pros?: Record<string, string[]>;
  cons?: Record<string, string[]>;
}

// ── 7. Decision Matrix ──
export interface DecisionCriterion {
  name: string;
  weight: number; // 0.0 - 1.0 or percentage
}

export interface DecisionOption {
  name: string;
  scores: number[];
  totalScore?: number;
}

export interface DecisionMatrixComponentData {
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  recommendation?: string;
  explanation?: string;
}

// ── 8. Dashboard ──
export interface MetricTile {
  id: string;
  label: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  status?: "normal" | "warning" | "alert";
}

export interface DashboardAlert {
  id: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface DashboardComponentData {
  metrics: MetricTile[];
  alerts?: DashboardAlert[];
}

// ── 9. Diagram ──
export type DiagramType =
  | "flowchart"
  | "architecture"
  | "sequence"
  | "state_machine"
  | "decision_tree"
  | "dependency_graph"
  | "er_diagram"
  | "mind_map"
  | "process"
  | "org_chart";

export interface DiagramNode {
  id: string;
  label: string;
  type?: "start" | "end" | "process" | "decision" | "database" | "server" | "client" | "queue" | "actor";
  description?: string;
  status?: "ok" | "warning" | "error" | "active";
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed" | "arrow";
}

export interface DiagramComponentData {
  diagramType: DiagramType;
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
  accessibleText?: string;
}

// ── 10. Map ──
export interface MapCoordinate {
  lat: number;
  lng: number;
}

export interface MapMarker {
  id: string;
  title: string;
  lat: number;
  lng: number;
  snippet?: string;
  badge?: string;
}

export interface MapRoute {
  id: string;
  name?: string;
  points: MapCoordinate[];
  distance?: string;
}

export interface MapComponentData {
  center: MapCoordinate;
  zoom?: number;
  markers: MapMarker[];
  routes?: MapRoute[];
}

// ── 11. Calendar ──
export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end?: string;
  allDay?: boolean;
  category?: string;
  color?: string;
  description?: string;
  location?: string;
  recurrence?: string;
}

export interface CalendarComponentData {
  viewMode?: "agenda" | "month" | "week" | "day";
  startDate: string;
  endDate?: string;
  events: CalendarEvent[];
}

// ── 12. Gantt ──
export interface GanttTask {
  id: string;
  name: string;
  start: string; // ISO date YYYY-MM-DD
  end: string;
  progress: number; // 0 - 100
  dependencies?: string[];
  status?: "done" | "in_progress" | "blocked" | "pending";
  assignee?: string;
}

export interface GanttMilestone {
  id: string;
  name: string;
  date: string;
  completed?: boolean;
}

export interface GanttComponentData {
  startDate: string;
  endDate: string;
  tasks: GanttTask[];
  milestones?: GanttMilestone[];
}

// ── 13. Code / Developer View ──
export interface CodeComponentData {
  language: string;
  code: string;
  filename?: string;
  collapsible?: boolean;
  highlightLines?: number[];
}

// ── 14. Artifact ──
export type ArtifactType =
  | "pdf"
  | "document"
  | "spreadsheet"
  | "csv"
  | "image"
  | "video"
  | "audio"
  | "code_project"
  | "archive"
  | "report"
  | "dataset";

export interface ArtifactComponentData {
  artifactType: ArtifactType;
  title: string;
  filename?: string;
  sizeBytes?: number;
  mimeType?: string;
  summary?: string;
  url?: string;
  previewLines?: string[];
  metadata?: Record<string, string>;
}

// ── 15. Form / Interactive Controls ──
export type FormFieldType =
  | "single_choice"
  | "multiple_choice"
  | "text"
  | "number"
  | "date"
  | "time"
  | "toggle"
  | "slider"
  | "dropdown";

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  value?: string | number | boolean | string[] | null;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface FormComponentData {
  fields: FormField[];
  submitLabel?: string;
}

// ── 16. Rich Media ──
export type MediaType = "image" | "gallery" | "video" | "audio";

export interface MediaItem {
  url: string;
  title?: string;
  caption?: string;
  thumbnail?: string;
  durationSeconds?: number;
}

export interface MediaComponentData {
  mediaType: MediaType;
  items: MediaItem[];
}

// ── Semantic Card ──
export type SemanticCardVariant =
  | "info"
  | "warning"
  | "success"
  | "error"
  | "recommendation"
  | "product"
  | "profile"
  | "location"
  | "event"
  | "artifact"
  | "task"
  | "approval"
  | "question"
  | "source";

export interface SemanticCardComponentData {
  variant: SemanticCardVariant;
  headline: string;
  body: string;
  badge?: string;
  metadata?: Record<string, string>;
}

// ── Sources ──
export interface SourceItem {
  url: string;
  title: string;
  domain?: string;
  snippet?: string;
  date?: string;
}

export interface SourcesComponentData {
  sources: SourceItem[];
}

// ── Product Card ──
export interface ProductComponentData {
  name: string;
  brand?: string;
  price?: string;
  rating?: number;
  reviewsCount?: number;
  retailer?: string;
  sourceUrl?: string;
  imageUrl?: string;
  reason?: string;
  details?: string[];
  badge?: string;
  metadata?: Record<string, string>;
  actionLabel?: string;
}

// ── Research Result Card ──
export type ResearchResultType =
  | "job"
  | "product"
  | "service"
  | "hotel"
  | "restaurant"
  | "software"
  | "course"
  | "event"
  | "travel"
  | "company"
  | "general";

export interface ResearchResultProvenance {
  sourceUrl?: string;
  sourceType?: string;
  retrievalTimestamp?: number;
  extractedFields?: string[];
  verified?: boolean;
}

export interface ResearchResultComponentData {
  resultType?: ResearchResultType | string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  source?: string;
  sourceDomain?: string;
  sourceUrl?: string;
  url?: string;
  actionLabel?: string;
  actionUrl?: string;
  price?: string;
  currency?: string;
  salary?: string;
  location?: string;
  company?: string;
  rating?: number;
  reviewsCount?: number;
  metadata?: Record<string, string>;
  reason?: string;
  matchScore?: number;
  tags?: string[];
  details?: string[];
  badge?: string;
  provenance?: ResearchResultProvenance;
  timestamp?: number;
}

// ── Prose / Text Section ──
export interface TextComponentData {
  text: string;
  format?: "markdown" | "plain";
}

// ── Match Scorecard (Cricket / Football / Generic) ──
export interface MatchTeam {
  name: string;
  shortName?: string;
  score: string;
  overs?: string | number;
  wickets?: number;
  isWinner?: boolean;
  logoUrl?: string;
  color?: string;
}

export interface CricketBatterSummary {
  name: string;
  runs: number;
  balls: number;
  fours?: number;
  sixes?: number;
  strikeRate?: number | string;
  dismissal?: string;
  notOut?: boolean;
}

export interface CricketBowlerSummary {
  name: string;
  overs: number | string;
  maidens?: number;
  runs: number;
  wickets: number;
  economy?: number | string;
}

export interface CricketInnings {
  teamName: string;
  runs: number;
  wickets: number;
  overs: number | string;
  runRate?: string | number;
  topBatters?: CricketBatterSummary[];
  topBowlers?: CricketBowlerSummary[];
}

export interface FootballMatchEvent {
  type: "goal" | "yellow_card" | "red_card" | "sub";
  minute: string | number;
  teamName: string;
  playerName: string;
  assistPlayerName?: string;
  detail?: string;
}

export interface FootballMatchStat {
  label: string;
  homeValue: string | number;
  awayValue: string | number;
}

export interface MatchScorecardComponentData {
  sport: "cricket" | "football" | "generic";
  competition: string;
  fixtureTitle: string;
  status: "live" | "finished" | "upcoming";
  statusDetail?: string;
  date?: string;
  venue?: string;
  teams: [MatchTeam, MatchTeam] | MatchTeam[];
  innings?: CricketInnings[];
  events?: FootballMatchEvent[];
  stats?: FootballMatchStat[];
  sourceUrl?: string;
  sourceName?: string;
  retrievalTimestamp?: number;
}

// ── Player Statistics ──
export interface PlayerStatItem {
  label: string;
  value: string | number;
  highlight?: boolean;
  subtext?: string;
}

export interface PlayerStatsComponentData {
  playerName: string;
  sport: "cricket" | "football" | "generic";
  teamName: string;
  opponentName?: string;
  competition?: string;
  fixtureTitle?: string;
  fixtureDate?: string;
  role?: string;
  headlineStat: string;
  headlineLabel?: string;
  stats: PlayerStatItem[];
  sourceUrl?: string;
  sourceName?: string;
  retrievalTimestamp?: number;
}

// ── Standings / League Tables ──
export interface StandingRow {
  rank: number | string;
  teamName: string;
  teamShort?: string;
  logoUrl?: string;
  played: number;
  won: number;
  drawn?: number;
  lost: number;
  diff?: string | number;
  points: number;
  form?: string[];
  qualificationZone?: string;
}

export interface QualificationZoneLegend {
  zone: string;
  label: string;
  color: string;
}

export interface StandingsTableComponentData {
  competition: string;
  season?: string;
  group?: string;
  columns?: string[];
  rows: StandingRow[];
  qualificationLegend?: QualificationZoneLegend[];
  sourceUrl?: string;
  sourceName?: string;
  retrievalTimestamp?: number;
}

// ── Olympic & Multi-Sport Medal Tallies ──
export interface MedalRow {
  rank: number;
  nation: string;
  nocCode?: string;
  flagUrl?: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export interface MedalTallyComponentData {
  competition: string;
  year?: number | string;
  rankingMethod?: "gold_first" | "total_first";
  rankingMethodLabel?: string;
  freshness?: string;
  rows: MedalRow[];
  sourceUrl?: string;
  sourceName?: string;
  retrievalTimestamp?: number;
}

// ── Generic Extensible Data Card ──
export interface DataMetric {
  label: string;
  value: string | number;
  unit?: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
}

export interface DataRow {
  key: string;
  value: string;
  subtext?: string;
}

export interface DataSection {
  heading: string;
  content: string;
}

export interface DataCardComponentData {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeType?: "info" | "success" | "warning" | "accent";
  metrics?: DataMetric[];
  rows?: DataRow[];
  sections?: DataSection[];
  sourceUrl?: string;
  sourceName?: string;
  retrievalTimestamp?: number;
}

// ── Structured Component Envelope ──
export interface StructuredComponent {
  id: string;
  type: StructuredComponentType;
  title?: string;
  subtitle?: string;
  description?: string;
  data: any;
  actions?: ComponentAction[];
}

export interface StructuredResponseData {
  version: number;
  components: StructuredComponent[];
}

export interface StructuredResponseEvent {
  componentId: string;
  componentType: StructuredComponentType;
  action: string;
  payload?: Record<string, unknown>;
  threadId: string;
  messageId: string;
  timestamp?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: StructuredResponseData;
}

// ── Component Registry Definition ──
export interface ComponentRegistryEntry {
  type: StructuredComponentType;
  schemaVersion: number;
  semanticPurpose: string;
  supportedInteractions: string[];
  mobileLayout: "compact" | "scrollable" | "adaptive" | "responsive";
  viewSwitchableTo?: StructuredComponentType[];
}

export const STRUCTURED_COMPONENT_REGISTRY: Record<StructuredComponentType, ComponentRegistryEntry> = {
  table: {
    type: "table",
    schemaVersion: 1,
    semanticPurpose: "Display sortable, structured tabular records with numeric alignment and expandable rows.",
    supportedInteractions: ["sort", "expand_row", "filter"],
    mobileLayout: "scrollable",
    viewSwitchableTo: ["chart"],
  },
  chart: {
    type: "chart",
    schemaVersion: 1,
    semanticPurpose: "Render data visualisations including line, bar, area, pie, donut, scatter, radar, and sparklines.",
    supportedInteractions: ["select_point", "hover_tooltip", "switch_series"],
    mobileLayout: "adaptive",
    viewSwitchableTo: ["table"],
  },
  timeline: {
    type: "timeline",
    schemaVersion: 1,
    semanticPurpose: "Chronological sequence of milestones, activity logs, or project events.",
    supportedInteractions: ["select_event", "expand_item"],
    mobileLayout: "compact",
    viewSwitchableTo: ["checklist", "kanban"],
  },
  kanban: {
    type: "kanban",
    schemaVersion: 1,
    semanticPurpose: "Horizontal swimlanes for task boards, pipeline stages, or category tracking.",
    supportedInteractions: ["move_card", "select_card", "open_details"],
    mobileLayout: "scrollable",
    viewSwitchableTo: ["checklist", "timeline"],
  },
  checklist: {
    type: "checklist",
    schemaVersion: 1,
    semanticPurpose: "Interactive tasks and action lists with checkable states and progress indicators.",
    supportedInteractions: ["check_item", "toggle_subtask", "select_task"],
    mobileLayout: "compact",
    viewSwitchableTo: ["kanban", "timeline"],
  },
  comparison: {
    type: "comparison",
    schemaVersion: 1,
    semanticPurpose: "Side-by-side evaluation of candidates, products, architectures, or models with pros/cons.",
    supportedInteractions: ["select_winner", "toggle_pros_cons"],
    mobileLayout: "adaptive",
    viewSwitchableTo: ["table"],
  },
  decision_matrix: {
    type: "decision_matrix",
    schemaVersion: 1,
    semanticPurpose: "Multi-criteria weighted evaluation matrix scoring competing solutions.",
    supportedInteractions: ["adjust_weight", "highlight_option"],
    mobileLayout: "scrollable",
    viewSwitchableTo: ["table"],
  },
  dashboard: {
    type: "dashboard",
    schemaVersion: 1,
    semanticPurpose: "High-level KPI metric tiles, performance health, and actionable alerts.",
    supportedInteractions: ["select_metric", "dismiss_alert"],
    mobileLayout: "responsive",
  },
  diagram: {
    type: "diagram",
    schemaVersion: 1,
    semanticPurpose: "Architectural, flow, sequence, state, or entity diagrams with connected nodes.",
    supportedInteractions: ["select_node", "pan_zoom", "expand_node"],
    mobileLayout: "adaptive",
  },
  map: {
    type: "map",
    schemaVersion: 1,
    semanticPurpose: "Geographic locations, markers, routes, and geographic entity inspection.",
    supportedInteractions: ["select_marker", "open_in_maps"],
    mobileLayout: "adaptive",
  },
  calendar: {
    type: "calendar",
    schemaVersion: 1,
    semanticPurpose: "Date agendas, schedules, upcoming events, and recurring appointments.",
    supportedInteractions: ["select_date", "open_event", "change_view"],
    mobileLayout: "compact",
  },
  gantt: {
    type: "gantt",
    schemaVersion: 1,
    semanticPurpose: "Project schedule tracking along time axis with task dependencies and milestones.",
    supportedInteractions: ["scroll_timeline", "select_task"],
    mobileLayout: "scrollable",
    viewSwitchableTo: ["timeline", "checklist"],
  },
  code: {
    type: "code",
    schemaVersion: 1,
    semanticPurpose: "Syntax-highlighted code snippets, diffs, configuration blocks, or terminal logs.",
    supportedInteractions: ["copy_code", "toggle_collapse"],
    mobileLayout: "scrollable",
  },
  artifact: {
    type: "artifact",
    schemaVersion: 1,
    semanticPurpose: "File cards and preview summaries for documents, PDFs, spreadsheets, or project bundles.",
    supportedInteractions: ["open_artifact", "download_file"],
    mobileLayout: "compact",
  },
  form: {
    type: "form",
    schemaVersion: 1,
    semanticPurpose: "Native input collection with text, choice, toggle, slider, and submit actions.",
    supportedInteractions: ["change_field", "submit_form"],
    mobileLayout: "compact",
  },
  media: {
    type: "media",
    schemaVersion: 1,
    semanticPurpose: "Image galleries, video previews, and audio tracks with native media players.",
    supportedInteractions: ["open_fullscreen", "play_audio", "next_slide"],
    mobileLayout: "adaptive",
  },
  card: {
    type: "card",
    schemaVersion: 1,
    semanticPurpose: "Semantic status cards (info, warning, success, error, recommendation, profile, product).",
    supportedInteractions: ["click_action", "expand_card"],
    mobileLayout: "compact",
  },
  sources: {
    type: "sources",
    schemaVersion: 1,
    semanticPurpose: "Referenced URLs, citations, verification evidence, and external documentation.",
    supportedInteractions: ["open_link"],
    mobileLayout: "compact",
  },
  product: {
    type: "product",
    schemaVersion: 1,
    semanticPurpose: "Rich product cards with image, price, specs, rating, retailer, and direct action link.",
    supportedInteractions: ["open_product", "view_details"],
    mobileLayout: "compact",
  },
  result: {
    type: "result",
    schemaVersion: 1,
    semanticPurpose: "Generic rich research result cards (jobs, products, services, hotels, courses, software, events) with metadata, specs, verified action button, and match rationale.",
    supportedInteractions: ["open_action", "view_details"],
    mobileLayout: "compact",
    viewSwitchableTo: ["card", "comparison"],
  },
  text: {
    type: "text",
    schemaVersion: 1,
    semanticPurpose: "Interleaved prose and markdown sections flowing between structured components.",
    supportedInteractions: [],
    mobileLayout: "compact",
  },
  match_scorecard: {
    type: "match_scorecard",
    schemaVersion: 1,
    semanticPurpose: "Live or final sports scorecards (cricket, football, etc.) with innings, overs, wickets, events, and stats.",
    supportedInteractions: ["switch_innings", "view_details", "open_source"],
    mobileLayout: "adaptive",
    viewSwitchableTo: ["table", "card"],
  },
  player_stats: {
    type: "player_stats",
    schemaVersion: 1,
    semanticPurpose: "Individual player match or career statistics tied to resolved fixture with headline metric and stat grid.",
    supportedInteractions: ["view_details", "open_source"],
    mobileLayout: "compact",
    viewSwitchableTo: ["table", "card"],
  },
  standings_table: {
    type: "standings_table",
    schemaVersion: 1,
    semanticPurpose: "Ranked league and tournament standings with qualification zones, form badges, and mobile horizontal scrolling.",
    supportedInteractions: ["sort", "filter_group", "open_source"],
    mobileLayout: "scrollable",
    viewSwitchableTo: ["table"],
  },
  medal_tally: {
    type: "medal_tally",
    schemaVersion: 1,
    semanticPurpose: "Olympic and multi-sport medal tallies with Gold/Silver/Bronze breakdown, ranking methodology, and freshness.",
    supportedInteractions: ["switch_ranking_method", "open_source"],
    mobileLayout: "scrollable",
    viewSwitchableTo: ["table"],
  },
  data_card: {
    type: "data_card",
    schemaVersion: 1,
    semanticPurpose: "Extensible multi-metric data cards with key-value rows, expandable sections, badges, and source attribution.",
    supportedInteractions: ["expand_section", "open_source"],
    mobileLayout: "compact",
    viewSwitchableTo: ["card", "dashboard"],
  },
};

/**
 * Validates and bounds a structured response against security and resource limits.
 */
export function validateStructuredResponse(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["Structured response must be a non-null object."] };
  }

  const raw = input as Record<string, unknown>;
  const version = typeof raw.version === "number" ? raw.version : 1;

  if (version > STRUCTURED_PROTOCOL_VERSION) {
    return {
      valid: false,
      errors: [`Unsupported protocol version ${version} (max supported is ${STRUCTURED_PROTOCOL_VERSION}).`],
    };
  }

  if (!Array.isArray(raw.components)) {
    return { valid: false, errors: ["'components' must be an array."] };
  }

  if (raw.components.length > LIMITS.MAX_COMPONENTS) {
    errors.push(`Exceeded maximum components limit of ${LIMITS.MAX_COMPONENTS}. Truncating.`);
  }

  const sanitizedComponents: StructuredComponent[] = [];

  for (let i = 0; i < Math.min(raw.components.length, LIMITS.MAX_COMPONENTS); i++) {
    const comp = raw.components[i];
    if (!comp || typeof comp !== "object") {
      errors.push(`Component at index ${i} is not a valid object.`);
      continue;
    }

    const compId = typeof comp.id === "string" && comp.id.trim() ? comp.id.trim() : `comp-${i + 1}`;
    const compType = typeof comp.type === "string" ? comp.type : "";

    const sanitizedComp: StructuredComponent = {
      id: compId,
      type: compType as StructuredComponentType,
      title: sanitizeString(comp.title),
      subtitle: sanitizeString(comp.subtitle),
      description: sanitizeString(comp.description),
      data: comp.data,
      actions: sanitizeActions(comp.actions),
    };

    switch (compType) {
      case "table": {
        const table = comp.data as TableComponentData | undefined;
        if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
          errors.push(`Component '${compId}' (table) missing valid columns or rows.`);
          break;
        }
        sanitizedComp.data = {
          columns: table.columns.slice(0, LIMITS.MAX_TABLE_COLS).map((col) => ({
            key: sanitizeString(col.key) || "col",
            label: sanitizeString(col.label) || "Column",
            numeric: Boolean(col.numeric),
            sortable: col.sortable !== false,
            priority: typeof col.priority === "number" ? col.priority : 1,
          })),
          rows: table.rows.slice(0, LIMITS.MAX_TABLE_ROWS).map((row) => sanitizeRow(row)),
          compact: Boolean(table.compact),
          expandable: Boolean(table.expandable),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "chart": {
        const chart = comp.data as ChartComponentData | undefined;
        if (!chart || !Array.isArray(chart.labels) || !Array.isArray(chart.series)) {
          errors.push(`Component '${compId}' (chart) missing valid labels or series.`);
          break;
        }
        const validChartTypes: ChartType[] = [
          "line", "bar", "horizontal_bar", "area", "stacked_bar", "stacked_area",
          "pie", "donut", "scatter", "histogram", "heatmap", "radar", "sparkline"
        ];
        sanitizedComp.data = {
          chartType: validChartTypes.includes(chart.chartType) ? chart.chartType : "bar",
          labels: chart.labels.slice(0, LIMITS.MAX_CHART_POINTS).map((l) => sanitizeString(l) || ""),
          series: chart.series.slice(0, 10).map((s) => ({
            name: sanitizeString(s.name) || "Series",
            data: Array.isArray(s.data)
              ? s.data.slice(0, LIMITS.MAX_CHART_POINTS).map((v) => (typeof v === "number" && !isNaN(v) ? v : 0))
              : [],
            color: sanitizeColor(s.color),
          })),
          unit: sanitizeString(chart.unit),
          accessibleText: sanitizeString(chart.accessibleText),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "timeline": {
        const timeline = comp.data as TimelineComponentData | undefined;
        if (!timeline || !Array.isArray(timeline.items)) {
          errors.push(`Component '${compId}' (timeline) missing items array.`);
          break;
        }
        sanitizedComp.data = {
          items: timeline.items.slice(0, 50).map((item, idx) => ({
            id: sanitizeString(item.id) || `time-${idx + 1}`,
            title: sanitizeString(item.title) || "Event",
            timestamp: sanitizeString(item.timestamp),
            description: sanitizeString(item.description),
            status: ["completed", "in_progress", "pending", "cancelled"].includes(item.status || "")
              ? item.status
              : "completed",
            icon: sanitizeString(item.icon),
          })),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "kanban": {
        const kanban = comp.data as KanbanComponentData | undefined;
        if (!kanban || !Array.isArray(kanban.columns)) {
          errors.push(`Component '${compId}' (kanban) missing columns array.`);
          break;
        }
        sanitizedComp.data = {
          columns: kanban.columns.slice(0, 8).map((col, cIdx) => ({
            id: sanitizeString(col.id) || `col-${cIdx + 1}`,
            title: sanitizeString(col.title) || `Column ${cIdx + 1}`,
            cards: Array.isArray(col.cards)
              ? col.cards.slice(0, 50).map((card, cardIdx) => ({
                  id: sanitizeString(card.id) || `card-${cardIdx + 1}`,
                  title: sanitizeString(card.title) || "Task",
                  description: sanitizeString(card.description),
                  priority: ["low", "medium", "high", "urgent"].includes(card.priority || "")
                    ? card.priority
                    : "medium",
                  assignee: sanitizeString(card.assignee),
                  tag: sanitizeString(card.tag),
                }))
              : [],
          })),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "checklist": {
        const cl = comp.data as ChecklistComponentData | undefined;
        if (!cl || !Array.isArray(cl.items)) {
          errors.push(`Component '${compId}' (checklist) missing items array.`);
          break;
        }
        sanitizedComp.data = {
          items: cl.items.slice(0, 100).map((item, idx) => ({
            id: sanitizeString(item.id) || `item-${idx + 1}`,
            label: sanitizeString(item.label) || "Task",
            checked: Boolean(item.checked),
            priority: ["low", "medium", "high"].includes(item.priority || "") ? item.priority : undefined,
            dueDate: sanitizeString(item.dueDate),
            subtasks: Array.isArray(item.subtasks)
              ? item.subtasks.slice(0, 20).map((sub, sIdx) => ({
                  id: sanitizeString(sub.id) || `sub-${sIdx + 1}`,
                  label: sanitizeString(sub.label) || "Subtask",
                  checked: Boolean(sub.checked),
                }))
              : undefined,
          })),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "comparison": {
        const compData = comp.data as ComparisonComponentData | undefined;
        if (!compData || !Array.isArray(compData.items) || !Array.isArray(compData.criteria)) {
          errors.push(`Component '${compId}' (comparison) missing items or criteria.`);
          break;
        }
        sanitizedComp.data = {
          items: compData.items.slice(0, 6).map((item) => sanitizeString(item) || "Item"),
          criteria: compData.criteria.slice(0, 20).map((c) => ({
            name: sanitizeString(c.name) || "Criterion",
            values: Array.isArray(c.values) ? c.values.slice(0, 6).map((v) => sanitizeString(v) || "-") : [],
            winnerIndex: typeof c.winnerIndex === "number" ? c.winnerIndex : undefined,
          })),
          recommendation: compData.recommendation
            ? {
                itemIndex: typeof compData.recommendation.itemIndex === "number" ? compData.recommendation.itemIndex : 0,
                reason: sanitizeString(compData.recommendation.reason) || "",
              }
            : undefined,
          pros: compData.pros,
          cons: compData.cons,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "decision_matrix": {
        const dm = comp.data as DecisionMatrixComponentData | undefined;
        if (!dm || !Array.isArray(dm.criteria) || !Array.isArray(dm.options)) {
          errors.push(`Component '${compId}' (decision_matrix) missing criteria or options.`);
          break;
        }
        sanitizedComp.data = {
          criteria: dm.criteria.slice(0, 15).map((c) => ({
            name: sanitizeString(c.name) || "Criterion",
            weight: typeof c.weight === "number" ? Math.max(0, c.weight) : 1,
          })),
          options: dm.options.slice(0, 10).map((opt) => ({
            name: sanitizeString(opt.name) || "Option",
            scores: Array.isArray(opt.scores)
              ? opt.scores.slice(0, 15).map((s) => (typeof s === "number" ? s : 0))
              : [],
            totalScore: typeof opt.totalScore === "number" ? opt.totalScore : undefined,
          })),
          recommendation: sanitizeString(dm.recommendation),
          explanation: sanitizeString(dm.explanation),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "dashboard": {
        const dash = comp.data as DashboardComponentData | undefined;
        if (!dash || !Array.isArray(dash.metrics)) {
          errors.push(`Component '${compId}' (dashboard) missing metrics.`);
          break;
        }
        sanitizedComp.data = {
          metrics: dash.metrics.slice(0, 24).map((m, idx) => ({
            id: sanitizeString(m.id) || `m-${idx + 1}`,
            label: sanitizeString(m.label) || "Metric",
            value: typeof m.value === "number" ? m.value : sanitizeString(String(m.value || "")) || "0",
            change: sanitizeString(m.change),
            trend: ["up", "down", "neutral"].includes(m.trend || "") ? m.trend : "neutral",
            status: ["normal", "warning", "alert"].includes(m.status || "") ? m.status : "normal",
          })),
          alerts: Array.isArray(dash.alerts)
            ? dash.alerts.slice(0, 10).map((a, idx) => ({
                id: sanitizeString(a.id) || `a-${idx + 1}`,
                message: sanitizeString(a.message) || "Alert",
                severity: ["info", "warning", "error"].includes(a.severity) ? a.severity : "info",
              }))
            : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "diagram": {
        const diag = comp.data as DiagramComponentData | undefined;
        if (!diag || !Array.isArray(diag.nodes)) {
          errors.push(`Component '${compId}' (diagram) missing nodes array.`);
          break;
        }
        const validTypes: DiagramType[] = [
          "flowchart", "architecture", "sequence", "state_machine", "decision_tree",
          "dependency_graph", "er_diagram", "mind_map", "process", "org_chart"
        ];
        sanitizedComp.data = {
          diagramType: validTypes.includes(diag.diagramType) ? diag.diagramType : "architecture",
          nodes: diag.nodes.slice(0, 50).map((n, idx) => ({
            id: sanitizeString(n.id) || `node-${idx + 1}`,
            label: sanitizeString(n.label) || `Node ${idx + 1}`,
            type: n.type || "process",
            description: sanitizeString(n.description),
            status: ["ok", "warning", "error", "active"].includes(n.status || "") ? n.status : undefined,
          })),
          edges: Array.isArray(diag.edges)
            ? diag.edges.slice(0, 100).map((e) => ({
                from: sanitizeString(e.from) || "",
                to: sanitizeString(e.to) || "",
                label: sanitizeString(e.label),
                style: ["solid", "dashed", "arrow"].includes(e.style || "") ? e.style : "arrow",
              }))
            : undefined,
          accessibleText: sanitizeString(diag.accessibleText),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "map": {
        const mapData = comp.data as MapComponentData | undefined;
        if (!mapData || !mapData.center || typeof mapData.center.lat !== "number" || typeof mapData.center.lng !== "number") {
          errors.push(`Component '${compId}' (map) missing valid center coordinate.`);
          break;
        }
        sanitizedComp.data = {
          center: { lat: mapData.center.lat, lng: mapData.center.lng },
          zoom: typeof mapData.zoom === "number" ? Math.min(20, Math.max(1, mapData.zoom)) : 12,
          markers: Array.isArray(mapData.markers)
            ? mapData.markers.slice(0, 50).map((m, idx) => ({
                id: sanitizeString(m.id) || `marker-${idx + 1}`,
                title: sanitizeString(m.title) || "Marker",
                lat: typeof m.lat === "number" ? m.lat : mapData.center.lat,
                lng: typeof m.lng === "number" ? m.lng : mapData.center.lng,
                snippet: sanitizeString(m.snippet),
                badge: sanitizeString(m.badge),
              }))
            : [],
          routes: Array.isArray(mapData.routes)
            ? mapData.routes.slice(0, 5).map((r, idx) => ({
                id: sanitizeString(r.id) || `route-${idx + 1}`,
                name: sanitizeString(r.name),
                points: Array.isArray(r.points)
                  ? r.points.slice(0, 100).map((p) => ({ lat: p.lat, lng: p.lng }))
                  : [],
                distance: sanitizeString(r.distance),
              }))
            : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "calendar": {
        const cal = comp.data as CalendarComponentData | undefined;
        if (!cal || !cal.startDate || !Array.isArray(cal.events)) {
          errors.push(`Component '${compId}' (calendar) missing startDate or events.`);
          break;
        }
        sanitizedComp.data = {
          viewMode: ["agenda", "month", "week", "day"].includes(cal.viewMode || "") ? cal.viewMode : "agenda",
          startDate: sanitizeString(cal.startDate) || new Date().toISOString(),
          endDate: sanitizeString(cal.endDate),
          events: cal.events.slice(0, 100).map((ev, idx) => ({
            id: sanitizeString(ev.id) || `ev-${idx + 1}`,
            title: sanitizeString(ev.title) || "Event",
            start: sanitizeString(ev.start) || cal.startDate,
            end: sanitizeString(ev.end),
            allDay: Boolean(ev.allDay),
            category: sanitizeString(ev.category),
            color: sanitizeColor(ev.color),
            description: sanitizeString(ev.description),
            location: sanitizeString(ev.location),
            recurrence: sanitizeString(ev.recurrence),
          })),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "gantt": {
        const gantt = comp.data as GanttComponentData | undefined;
        if (!gantt || !gantt.startDate || !gantt.endDate || !Array.isArray(gantt.tasks)) {
          errors.push(`Component '${compId}' (gantt) missing startDate, endDate, or tasks.`);
          break;
        }
        sanitizedComp.data = {
          startDate: sanitizeString(gantt.startDate) || "",
          endDate: sanitizeString(gantt.endDate) || "",
          tasks: gantt.tasks.slice(0, 50).map((t, idx) => ({
            id: sanitizeString(t.id) || `gt-${idx + 1}`,
            name: sanitizeString(t.name) || "Task",
            start: sanitizeString(t.start) || gantt.startDate,
            end: sanitizeString(t.end) || gantt.endDate,
            progress: typeof t.progress === "number" ? Math.max(0, Math.min(100, t.progress)) : 0,
            dependencies: Array.isArray(t.dependencies) ? t.dependencies.slice(0, 5).map((d) => String(d)) : undefined,
            status: ["done", "in_progress", "blocked", "pending"].includes(t.status || "") ? t.status : "pending",
            assignee: sanitizeString(t.assignee),
          })),
          milestones: Array.isArray(gantt.milestones)
            ? gantt.milestones.slice(0, 10).map((m, idx) => ({
                id: sanitizeString(m.id) || `ms-${idx + 1}`,
                name: sanitizeString(m.name) || "Milestone",
                date: sanitizeString(m.date) || gantt.startDate,
                completed: Boolean(m.completed),
              }))
            : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "code": {
        const code = comp.data as CodeComponentData | undefined;
        if (!code || typeof code.code !== "string") {
          errors.push(`Component '${compId}' (code) missing code content.`);
          break;
        }
        sanitizedComp.data = {
          language: sanitizeString(code.language) || "text",
          code: code.code.slice(0, LIMITS.MAX_STRING_LENGTH),
          filename: sanitizeString(code.filename),
          collapsible: Boolean(code.collapsible),
          highlightLines: Array.isArray(code.highlightLines)
            ? code.highlightLines.filter((n) => typeof n === "number")
            : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "artifact": {
        const art = comp.data as ArtifactComponentData | undefined;
        if (!art || !art.title) {
          errors.push(`Component '${compId}' (artifact) missing title.`);
          break;
        }
        const validArtTypes: ArtifactType[] = [
          "pdf", "document", "spreadsheet", "csv", "image", "video", "audio",
          "code_project", "archive", "report", "dataset"
        ];
        sanitizedComp.data = {
          artifactType: validArtTypes.includes(art.artifactType) ? art.artifactType : "document",
          title: sanitizeString(art.title) || "Artifact",
          filename: sanitizeString(art.filename),
          sizeBytes: typeof art.sizeBytes === "number" ? art.sizeBytes : undefined,
          mimeType: sanitizeString(art.mimeType),
          summary: sanitizeString(art.summary),
          url: sanitizeUrl(art.url),
          previewLines: Array.isArray(art.previewLines)
            ? art.previewLines.slice(0, 20).map((l) => sanitizeString(l) || "")
            : undefined,
          metadata: art.metadata,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "form": {
        const form = comp.data as FormComponentData | undefined;
        if (!form || !Array.isArray(form.fields)) {
          errors.push(`Component '${compId}' (form) missing fields array.`);
          break;
        }
        const validFieldTypes: FormFieldType[] = [
          "single_choice", "multiple_choice", "text", "number", "date", "time", "toggle", "slider", "dropdown"
        ];
        sanitizedComp.data = {
          fields: form.fields.slice(0, 20).map((f, idx) => ({
            id: sanitizeString(f.id) || `field-${idx + 1}`,
            label: sanitizeString(f.label) || `Field ${idx + 1}`,
            type: validFieldTypes.includes(f.type) ? f.type : "text",
            value: f.value,
            options: Array.isArray(f.options) ? f.options.slice(0, 15).map((o) => sanitizeString(o) || "") : undefined,
            placeholder: sanitizeString(f.placeholder),
            required: Boolean(f.required),
            min: typeof f.min === "number" ? f.min : undefined,
            max: typeof f.max === "number" ? f.max : undefined,
            step: typeof f.step === "number" ? f.step : undefined,
          })),
          submitLabel: sanitizeString(form.submitLabel) || "Submit",
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "media": {
        const media = comp.data as MediaComponentData | undefined;
        if (!media || !Array.isArray(media.items)) {
          errors.push(`Component '${compId}' (media) missing items array.`);
          break;
        }
        const validMediaTypes: MediaType[] = ["image", "gallery", "video", "audio"];
        sanitizedComp.data = {
          mediaType: validMediaTypes.includes(media.mediaType) ? media.mediaType : "image",
          items: media.items.slice(0, 12).map((m) => ({
            url: sanitizeUrl(m.url) || "https://example.com/media",
            title: sanitizeString(m.title),
            caption: sanitizeString(m.caption),
            thumbnail: sanitizeUrl(m.thumbnail),
            durationSeconds: typeof m.durationSeconds === "number" ? m.durationSeconds : undefined,
          })),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "card": {
        const card = comp.data as SemanticCardComponentData | undefined;
        if (!card || !card.headline) {
          errors.push(`Component '${compId}' (card) missing headline.`);
          break;
        }
        const validVariants: SemanticCardVariant[] = [
          "info", "warning", "success", "error", "recommendation", "product", "profile",
          "location", "event", "artifact", "task", "approval", "question", "source"
        ];
        sanitizedComp.data = {
          variant: validVariants.includes(card.variant) ? card.variant : "info",
          headline: sanitizeString(card.headline) || "",
          body: sanitizeString(card.body) || "",
          badge: sanitizeString(card.badge),
          metadata: card.metadata,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "sources": {
        const src = comp.data as SourcesComponentData | undefined;
        if (!src || !Array.isArray(src.sources)) {
          errors.push(`Component '${compId}' (sources) missing sources array.`);
          break;
        }
        sanitizedComp.data = {
          sources: src.sources.slice(0, 50).map((s) => ({
            url: sanitizeUrl(s.url) || "https://example.com",
            title: sanitizeString(s.title) || "Source",
            domain: sanitizeString(s.domain),
            snippet: sanitizeString(s.snippet),
            date: sanitizeString(s.date),
          })),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "product": {
        const prod = comp.data as (ProductComponentData & Record<string, unknown>) | undefined;
        const resData = comp.data as (ResearchResultComponentData & Record<string, unknown>) | undefined;
        const prodTitle = sanitizeString(prod?.name || resData?.title || comp.title);
        if (!prodTitle) {
          errors.push(`Component '${compId}' (product) missing product name or title.`);
          break;
        }

        // If data aligns with rich research result shape (has resultType, company, tags, or used title instead of name)
        if (resData?.resultType || resData?.company || resData?.tags || (!prod?.name && resData?.title)) {
          sanitizedComp.type = "result";
          const actionUrl = sanitizeUrl(resData?.actionUrl || resData?.sourceUrl || resData?.url || prod?.sourceUrl);
          const sourceUrl = sanitizeUrl(resData?.sourceUrl || resData?.url || resData?.actionUrl || prod?.sourceUrl);
          const source = sanitizeString(resData?.source || prod?.retailer || prod?.brand || resData?.company);
          let sourceDomain = sanitizeString(resData?.sourceDomain);
          if (!sourceDomain && sourceUrl) {
            try {
              sourceDomain = new URL(sourceUrl, "https://example.com").hostname.replace(/^www\./, "");
            } catch {
              // Keep empty if invalid URL
            }
          }

          sanitizedComp.data = {
            resultType: sanitizeString(resData?.resultType) || "product",
            title: prodTitle,
            subtitle: sanitizeString(resData?.subtitle || comp.subtitle || prod?.brand),
            description: sanitizeString(resData?.description || comp.description),
            imageUrl: sanitizeUrl(resData?.imageUrl || prod?.imageUrl),
            source,
            sourceDomain,
            sourceUrl,
            actionLabel: sanitizeString(resData?.actionLabel || prod?.actionLabel) || "View product",
            actionUrl,
            price: sanitizeString(resData?.price || prod?.price),
            currency: sanitizeString(resData?.currency),
            location: sanitizeString(resData?.location),
            company: sanitizeString(resData?.company || prod?.retailer || prod?.brand),
            rating: typeof (resData?.rating ?? prod?.rating) === "number" ? Math.min(5, Math.max(0, (resData?.rating ?? prod?.rating)!)) : undefined,
            reviewsCount: typeof (resData?.reviewsCount ?? prod?.reviewsCount) === "number" ? Math.max(0, Math.floor((resData?.reviewsCount ?? prod?.reviewsCount)!)) : undefined,
            metadata: (resData?.metadata || prod?.metadata) as Record<string, string> | undefined,
            reason: sanitizeString(resData?.reason || prod?.reason),
            matchScore: typeof resData?.matchScore === "number" ? resData.matchScore : undefined,
            tags: Array.isArray(resData?.tags) ? resData.tags.slice(0, 15).map(t => sanitizeString(t) || "").filter(Boolean) : (Array.isArray(prod?.details) ? prod.details.slice(0, 15).map(d => sanitizeString(d) || "").filter(Boolean) : undefined),
            details: Array.isArray(resData?.details) ? resData.details.slice(0, 15).map(d => sanitizeString(d) || "").filter(Boolean) : (Array.isArray(prod?.details) ? prod.details.slice(0, 15).map(d => sanitizeString(d) || "").filter(Boolean) : undefined),
            badge: sanitizeString(resData?.badge || prod?.badge),
          };
          sanitizedComponents.push(sanitizedComp);
          break;
        }

        sanitizedComp.data = {
          name: prodTitle,
          brand: sanitizeString(prod?.brand),
          price: sanitizeString(prod?.price),
          rating: typeof prod?.rating === "number" ? Math.min(5, Math.max(0, prod.rating)) : undefined,
          reviewsCount: typeof prod?.reviewsCount === "number" ? prod.reviewsCount : undefined,
          retailer: sanitizeString(prod?.retailer),
          sourceUrl: sanitizeUrl(prod?.sourceUrl),
          imageUrl: sanitizeUrl(prod?.imageUrl),
          reason: sanitizeString(prod?.reason),
          details: Array.isArray(prod?.details)
            ? prod.details.slice(0, 10).map((d) => sanitizeString(d) || "").filter(Boolean)
            : undefined,
          badge: sanitizeString(prod?.badge),
          metadata: prod?.metadata,
          actionLabel: sanitizeString(prod?.actionLabel) || "View product",
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "result": {
        const res = comp.data as (ResearchResultComponentData & Record<string, unknown>) | undefined;
        const resTitle = sanitizeString(res?.title || res?.name || comp.title);
        if (!resTitle) {
          errors.push(`Component '${compId}' (result) missing title.`);
          break;
        }
        const actionUrl = sanitizeUrl(res?.actionUrl || res?.sourceUrl || res?.url);
        const sourceUrl = sanitizeUrl(res?.sourceUrl || res?.url || res?.actionUrl);
        const source = sanitizeString(res?.source || res?.company || res?.retailer || res?.brand);
        let sourceDomain = sanitizeString(res?.sourceDomain);
        if (!sourceDomain && sourceUrl) {
          try {
            sourceDomain = new URL(sourceUrl, "https://example.com").hostname.replace(/^www\./, "");
          } catch {
            // Keep empty if invalid URL
          }
        }

        sanitizedComp.data = {
          resultType: sanitizeString(res?.resultType) || "general",
          title: resTitle,
          subtitle: sanitizeString(res?.subtitle || comp.subtitle || res?.brand),
          description: sanitizeString(res?.description || comp.description),
          imageUrl: sanitizeUrl(res?.imageUrl),
          source,
          sourceDomain,
          sourceUrl,
          actionLabel: sanitizeString(res?.actionLabel) || (actionUrl ? "View" : undefined),
          actionUrl,
          price: sanitizeString(res?.price),
          currency: sanitizeString(res?.currency),
          salary: sanitizeString(res?.salary),
          location: sanitizeString(res?.location),
          company: sanitizeString(res?.company || res?.retailer || res?.brand),
          rating: typeof res?.rating === "number" && !isNaN(res.rating) ? Math.min(5, Math.max(0, res.rating)) : undefined,
          reviewsCount: typeof res?.reviewsCount === "number" && !isNaN(res.reviewsCount) ? Math.max(0, Math.floor(res.reviewsCount)) : undefined,
          metadata: res?.metadata && typeof res.metadata === "object" ? res.metadata : undefined,
          reason: sanitizeString(res?.reason),
          matchScore: typeof res?.matchScore === "number" && !isNaN(res.matchScore) ? res.matchScore : undefined,
          tags: Array.isArray(res?.tags) ? res.tags.slice(0, 15).map(t => sanitizeString(t) || "").filter(Boolean) : undefined,
          details: Array.isArray(res?.details) ? res.details.slice(0, 15).map(d => sanitizeString(d) || "").filter(Boolean) : undefined,
          badge: sanitizeString(res?.badge),
          provenance: res?.provenance && typeof res.provenance === "object" ? {
            sourceUrl: sanitizeUrl(res.provenance.sourceUrl),
            sourceType: sanitizeString(res.provenance.sourceType),
            retrievalTimestamp: typeof res.provenance.retrievalTimestamp === "number" ? res.provenance.retrievalTimestamp : undefined,
            verified: Boolean(res.provenance.verified),
          } : undefined,
          timestamp: typeof res?.timestamp === "number" ? res.timestamp : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "text": {
        const txt = comp.data as TextComponentData | undefined;
        const bodyText = typeof txt?.text === "string" ? txt.text : typeof comp.data === "string" ? comp.data : "";
        sanitizedComp.data = {
          text: sanitizeString(bodyText) || "",
          format: txt?.format === "plain" ? "plain" : "markdown",
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "match_scorecard": {
        const card = comp.data as MatchScorecardComponentData | undefined;
        if (!card || !card.fixtureTitle || !Array.isArray(card.teams) || card.teams.length < 2) {
          errors.push(`Component '${compId}' (match_scorecard) missing valid fixtureTitle or at least 2 teams.`);
          break;
        }
        const validSports = ["cricket", "football", "generic"];
        const sport = validSports.includes(card.sport) ? card.sport : "generic";
        const validStatuses = ["live", "finished", "upcoming"];
        const status = validStatuses.includes(card.status) ? card.status : "finished";

        sanitizedComp.data = {
          sport,
          competition: sanitizeString(card.competition) || "Sports Fixture",
          fixtureTitle: sanitizeString(card.fixtureTitle) || "Match",
          status,
          statusDetail: sanitizeString(card.statusDetail),
          date: sanitizeString(card.date),
          venue: sanitizeString(card.venue),
          teams: card.teams.slice(0, 4).map((t) => ({
            name: sanitizeString(t.name) || "Team",
            shortName: sanitizeString(t.shortName),
            score: sanitizeString(t.score) || "0",
            overs: typeof t.overs === "number" || typeof t.overs === "string" ? t.overs : undefined,
            wickets: typeof t.wickets === "number" ? t.wickets : undefined,
            isWinner: Boolean(t.isWinner),
            logoUrl: sanitizeUrl(t.logoUrl),
            color: sanitizeColor(t.color),
          })),
          innings: Array.isArray(card.innings)
            ? card.innings.slice(0, 4).map((inn) => ({
                teamName: sanitizeString(inn.teamName) || "Team",
                runs: typeof inn.runs === "number" ? inn.runs : 0,
                wickets: typeof inn.wickets === "number" ? inn.wickets : 0,
                overs: typeof inn.overs === "number" || typeof inn.overs === "string" ? String(inn.overs) : "0",
                runRate: sanitizeString(String(inn.runRate ?? "")),
                topBatters: Array.isArray(inn.topBatters)
                  ? inn.topBatters.slice(0, 11).map((b) => ({
                      name: sanitizeString(b.name) || "Batter",
                      runs: typeof b.runs === "number" ? b.runs : 0,
                      balls: typeof b.balls === "number" ? b.balls : 0,
                      fours: typeof b.fours === "number" ? b.fours : undefined,
                      sixes: typeof b.sixes === "number" ? b.sixes : undefined,
                      strikeRate: typeof b.strikeRate === "number" || typeof b.strikeRate === "string" ? String(b.strikeRate) : undefined,
                      dismissal: sanitizeString(b.dismissal),
                      notOut: Boolean(b.notOut),
                    }))
                  : undefined,
                topBowlers: Array.isArray(inn.topBowlers)
                  ? inn.topBowlers.slice(0, 11).map((bw) => ({
                      name: sanitizeString(bw.name) || "Bowler",
                      overs: typeof bw.overs === "number" || typeof bw.overs === "string" ? String(bw.overs) : "0",
                      maidens: typeof bw.maidens === "number" ? bw.maidens : undefined,
                      runs: typeof bw.runs === "number" ? bw.runs : 0,
                      wickets: typeof bw.wickets === "number" ? bw.wickets : 0,
                      economy: typeof bw.economy === "number" || typeof bw.economy === "string" ? String(bw.economy) : undefined,
                    }))
                  : undefined,
              }))
            : undefined,
          events: Array.isArray(card.events)
            ? card.events.slice(0, 30).map((ev) => ({
                type: ["goal", "yellow_card", "red_card", "sub"].includes(ev.type) ? ev.type : "goal",
                minute: sanitizeString(String(ev.minute ?? "")) || "",
                teamName: sanitizeString(ev.teamName) || "",
                playerName: sanitizeString(ev.playerName) || "Player",
                assistPlayerName: sanitizeString(ev.assistPlayerName),
                detail: sanitizeString(ev.detail),
              }))
            : undefined,
          stats: Array.isArray(card.stats)
            ? card.stats.slice(0, 20).map((st) => ({
                label: sanitizeString(st.label) || "Stat",
                homeValue: sanitizeString(String(st.homeValue ?? "")) || "0",
                awayValue: sanitizeString(String(st.awayValue ?? "")) || "0",
              }))
            : undefined,
          sourceUrl: sanitizeUrl(card.sourceUrl),
          sourceName: sanitizeString(card.sourceName),
          retrievalTimestamp: typeof card.retrievalTimestamp === "number" ? card.retrievalTimestamp : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "player_stats": {
        const p = comp.data as PlayerStatsComponentData | undefined;
        if (!p || !p.playerName || !p.headlineStat || !Array.isArray(p.stats)) {
          errors.push(`Component '${compId}' (player_stats) missing playerName, headlineStat, or stats array.`);
          break;
        }
        sanitizedComp.data = {
          playerName: sanitizeString(p.playerName) || "Player",
          sport: ["cricket", "football", "generic"].includes(p.sport) ? p.sport : "generic",
          teamName: sanitizeString(p.teamName) || "",
          opponentName: sanitizeString(p.opponentName),
          competition: sanitizeString(p.competition),
          fixtureTitle: sanitizeString(p.fixtureTitle),
          fixtureDate: sanitizeString(p.fixtureDate),
          role: sanitizeString(p.role),
          headlineStat: sanitizeString(p.headlineStat) || "",
          headlineLabel: sanitizeString(p.headlineLabel),
          stats: p.stats.slice(0, 25).map((s) => ({
            label: sanitizeString(s.label) || "Metric",
            value: typeof s.value === "number" || typeof s.value === "string" ? s.value : String(s.value ?? ""),
            highlight: Boolean(s.highlight),
            subtext: sanitizeString(s.subtext),
          })),
          sourceUrl: sanitizeUrl(p.sourceUrl),
          sourceName: sanitizeString(p.sourceName),
          retrievalTimestamp: typeof p.retrievalTimestamp === "number" ? p.retrievalTimestamp : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "standings_table": {
        const stand = comp.data as StandingsTableComponentData | undefined;
        if (!stand || !stand.competition || !Array.isArray(stand.rows)) {
          errors.push(`Component '${compId}' (standings_table) missing competition or rows array.`);
          break;
        }
        sanitizedComp.data = {
          competition: sanitizeString(stand.competition) || "Standings",
          season: sanitizeString(stand.season),
          group: sanitizeString(stand.group),
          columns: Array.isArray(stand.columns)
            ? stand.columns.slice(0, 15).map((c) => sanitizeString(c) || "").filter(Boolean)
            : undefined,
          rows: stand.rows.slice(0, LIMITS.MAX_TABLE_ROWS).map((r, idx) => ({
            rank: typeof r.rank === "number" ? r.rank : (parseInt(String(r.rank), 10) || idx + 1),
            teamName: sanitizeString(r.teamName) || "Team",
            teamShort: sanitizeString(r.teamShort),
            logoUrl: sanitizeUrl(r.logoUrl),
            played: typeof r.played === "number" ? r.played : 0,
            won: typeof r.won === "number" ? r.won : 0,
            drawn: typeof r.drawn === "number" ? r.drawn : undefined,
            lost: typeof r.lost === "number" ? r.lost : 0,
            diff: typeof r.diff === "number" || typeof r.diff === "string" ? String(r.diff) : undefined,
            points: typeof r.points === "number" ? r.points : 0,
            form: Array.isArray(r.form) ? r.form.slice(0, 6).map((f) => sanitizeString(f) || "").filter(Boolean) : undefined,
            qualificationZone: sanitizeString(r.qualificationZone),
          })),
          qualificationLegend: Array.isArray(stand.qualificationLegend)
            ? stand.qualificationLegend.slice(0, 10).map((l) => ({
                zone: sanitizeString(l.zone) || "zone",
                label: sanitizeString(l.label) || "",
                color: sanitizeColor(l.color) || "#58A6FF",
              }))
            : undefined,
          sourceUrl: sanitizeUrl(stand.sourceUrl),
          sourceName: sanitizeString(stand.sourceName),
          retrievalTimestamp: typeof stand.retrievalTimestamp === "number" ? stand.retrievalTimestamp : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "medal_tally": {
        const medal = comp.data as MedalTallyComponentData | undefined;
        if (!medal || !medal.competition || !Array.isArray(medal.rows)) {
          errors.push(`Component '${compId}' (medal_tally) missing competition or rows array.`);
          break;
        }
        sanitizedComp.data = {
          competition: sanitizeString(medal.competition) || "Medal Tally",
          year: typeof medal.year === "number" || typeof medal.year === "string" ? medal.year : undefined,
          rankingMethod: ["gold_first", "total_first"].includes(medal.rankingMethod || "")
            ? medal.rankingMethod
            : "gold_first",
          rankingMethodLabel: sanitizeString(medal.rankingMethodLabel),
          freshness: sanitizeString(medal.freshness),
          rows: medal.rows.slice(0, 100).map((r, idx) => ({
            rank: typeof r.rank === "number" ? r.rank : idx + 1,
            nation: sanitizeString(r.nation) || "Nation",
            nocCode: sanitizeString(r.nocCode),
            flagUrl: sanitizeUrl(r.flagUrl),
            gold: typeof r.gold === "number" ? Math.max(0, r.gold) : 0,
            silver: typeof r.silver === "number" ? Math.max(0, r.silver) : 0,
            bronze: typeof r.bronze === "number" ? Math.max(0, r.bronze) : 0,
            total: typeof r.total === "number" ? Math.max(0, r.total) : (typeof r.gold === "number" ? r.gold : 0) + (typeof r.silver === "number" ? r.silver : 0) + (typeof r.bronze === "number" ? r.bronze : 0),
          })),
          sourceUrl: sanitizeUrl(medal.sourceUrl),
          sourceName: sanitizeString(medal.sourceName),
          retrievalTimestamp: typeof medal.retrievalTimestamp === "number" ? medal.retrievalTimestamp : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      case "data_card": {
        const dc = comp.data as DataCardComponentData | undefined;
        const dcTitle = sanitizeString(dc?.title || comp.title);
        if (!dcTitle) {
          errors.push(`Component '${compId}' (data_card) missing title.`);
          break;
        }
        sanitizedComp.data = {
          title: dcTitle,
          subtitle: sanitizeString(dc?.subtitle || comp.subtitle),
          badge: sanitizeString(dc?.badge),
          badgeType: ["info", "success", "warning", "accent"].includes(dc?.badgeType || "")
            ? dc?.badgeType
            : "info",
          metrics: Array.isArray(dc?.metrics)
            ? dc.metrics.slice(0, 12).map((m) => ({
                label: sanitizeString(m.label) || "Metric",
                value: typeof m.value === "number" || typeof m.value === "string" ? m.value : String(m.value ?? ""),
                unit: sanitizeString(m.unit),
                change: sanitizeString(m.change),
                trend: ["up", "down", "neutral"].includes(m.trend || "") ? m.trend : undefined,
              }))
            : undefined,
          rows: Array.isArray(dc?.rows)
            ? dc.rows.slice(0, 30).map((r) => ({
                key: sanitizeString(r.key) || "",
                value: sanitizeString(r.value) || "",
                subtext: sanitizeString(r.subtext),
              }))
            : undefined,
          sections: Array.isArray(dc?.sections)
            ? dc.sections.slice(0, 10).map((s) => ({
                heading: sanitizeString(s.heading) || "",
                content: sanitizeString(s.content) || "",
              }))
            : undefined,
          sourceUrl: sanitizeUrl(dc?.sourceUrl),
          sourceName: sanitizeString(dc?.sourceName),
          retrievalTimestamp: typeof dc?.retrievalTimestamp === "number" ? dc?.retrievalTimestamp : undefined,
        };
        sanitizedComponents.push(sanitizedComp);
        break;
      }

      default:
        // Graceful fallback for unknown component types
        sanitizedComp.type = "card";
        sanitizedComp.data = {
          variant: "info",
          headline: sanitizedComp.title || "Structured Content",
          body: typeof comp.data === "string" ? comp.data : JSON.stringify(comp.data || {}, null, 2),
        };
        sanitizedComponents.push(sanitizedComp);
        break;
    }
  }

  const sanitized: StructuredResponseData = {
    version,
    components: sanitizedComponents,
  };

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Converts a structured response to an accessible plain-text / markdown representation
 * for non-visual clients, screen readers, and backward compatibility.
 */
export function structuredResponseToFallbackText(resp: StructuredResponseData): string {
  const parts: string[] = [];

  for (const comp of resp.components) {
    if (comp.title) parts.push(`### ${comp.title}`);
    if (comp.subtitle) parts.push(`*${comp.subtitle}*`);

    switch (comp.type) {
      case "table": {
        const data = comp.data as TableComponentData;
        if (data.columns && data.rows) {
          const header = "| " + data.columns.map((c) => c.label).join(" | ") + " |";
          const divider = "| " + data.columns.map(() => "---").join(" | ") + " |";
          const rows = data.rows.map(
            (r) => "| " + data.columns.map((c) => String(r[c.key] ?? "")).join(" | ") + " |"
          );
          parts.push([header, divider, ...rows].join("\n"));
        }
        break;
      }

      case "chart": {
        const data = comp.data as ChartComponentData;
        if (data.accessibleText) {
          parts.push(data.accessibleText);
        } else {
          parts.push(`Chart (${data.chartType}): ${data.series.map((s) => `${s.name}: [${s.data.join(", ")}]`).join("; ")}`);
        }
        break;
      }

      case "checklist": {
        const data = comp.data as ChecklistComponentData;
        for (const item of data.items) {
          parts.push(`- [${item.checked ? "x" : " "}] ${item.label}`);
        }
        break;
      }

      case "timeline": {
        const data = comp.data as TimelineComponentData;
        for (const item of data.items) {
          parts.push(`• ${item.timestamp ? `[${item.timestamp}] ` : ""}${item.title}${item.description ? `: ${item.description}` : ""}`);
        }
        break;
      }

      case "kanban": {
        const data = comp.data as KanbanComponentData;
        for (const col of data.columns) {
          parts.push(`**${col.title}**\n` + col.cards.map((c) => `  - ${c.title}${c.priority ? ` [${c.priority}]` : ""}`).join("\n"));
        }
        break;
      }

      case "comparison": {
        const data = comp.data as ComparisonComponentData;
        parts.push(`Comparison between: ${data.items.join(", ")}`);
        if (data.recommendation) {
          parts.push(`**Recommendation**: ${data.items[data.recommendation.itemIndex]} — ${data.recommendation.reason}`);
        }
        break;
      }

      case "decision_matrix": {
        const data = comp.data as DecisionMatrixComponentData;
        parts.push(`Decision Matrix: ${data.options.map((o) => `${o.name} (${o.totalScore ?? "N/A"})`).join(", ")}`);
        if (data.recommendation) parts.push(`**Recommended**: ${data.recommendation}`);
        break;
      }

      case "dashboard": {
        const data = comp.data as DashboardComponentData;
        parts.push(data.metrics.map((m) => `${m.label}: ${m.value}${m.change ? ` (${m.change})` : ""}`).join(" | "));
        break;
      }

      case "diagram": {
        const data = comp.data as DiagramComponentData;
        if (data.accessibleText) {
          parts.push(data.accessibleText);
        } else {
          parts.push(`Diagram (${data.diagramType}): ${data.nodes.map((n) => n.label).join(" -> ")}`);
        }
        break;
      }

      case "map": {
        const data = comp.data as MapComponentData;
        parts.push(`Map centered at ${data.center.lat}, ${data.center.lng} with ${data.markers.length} markers: ${data.markers.map((m) => m.title).join(", ")}`);
        break;
      }

      case "calendar": {
        const data = comp.data as CalendarComponentData;
        parts.push(`Calendar Schedule starting ${data.startDate}:\n` + data.events.map((e) => `• [${e.start}] ${e.title}`).join("\n"));
        break;
      }

      case "gantt": {
        const data = comp.data as GanttComponentData;
        parts.push(`Gantt Timeline (${data.startDate} to ${data.endDate}):\n` + data.tasks.map((t) => `• ${t.name}: ${t.start} - ${t.end} (${t.progress}%)`).join("\n"));
        break;
      }

      case "artifact": {
        const data = comp.data as ArtifactComponentData;
        parts.push(`**Artifact: ${data.title}** (${data.artifactType})${data.summary ? `\n${data.summary}` : ""}`);
        break;
      }

      case "form": {
        const data = comp.data as FormComponentData;
        parts.push(`Form with fields:\n` + data.fields.map((f) => `- ${f.label} (${f.type})`).join("\n"));
        break;
      }

      case "media": {
        const data = comp.data as MediaComponentData;
        const itemLines = data.items.map((i) => `• ${i.title || "Item"}: ${i.url}`).join("\n");
        parts.push(`Media Gallery (${data.mediaType}): ${data.items.length} items${itemLines ? `\n${itemLines}` : ""}`);
        break;
      }

      case "card": {
        const data = comp.data as SemanticCardComponentData;
        parts.push(`**${data.headline}**\n${data.body}`);
        break;
      }

      case "sources": {
        const data = comp.data as SourcesComponentData;
        for (const s of data.sources) {
          parts.push(`- [${s.title}](${s.url})`);
        }
        break;
      }

      case "code": {
        const data = comp.data as CodeComponentData;
        parts.push(`\`\`\`${data.language}\n${data.code}\n\`\`\``);
        break;
      }

      case "product": {
        const data = comp.data as ProductComponentData;
        const brand = data.brand ? `${data.brand} ` : "";
        const price = data.price ? ` (${data.price})` : "";
        parts.push(`**${brand}${data.name}**${price}`);
        if (data.reason) parts.push(`*${data.reason}*`);
        if (data.details && data.details.length) {
          parts.push(data.details.map((d) => `- ${d}`).join("\n"));
        }
        if (data.sourceUrl) {
          parts.push(`[${data.actionLabel || "View product"}](${data.sourceUrl})`);
        }
        break;
      }

      case "match_scorecard": {
        const data = comp.data as MatchScorecardComponentData;
        parts.push(`**${data.competition}** — ${data.fixtureTitle} (${data.status.toUpperCase()})`);
        if (data.statusDetail) parts.push(`*${data.statusDetail}*`);
        if (data.teams && data.teams.length >= 2) {
          parts.push(`${data.teams[0].name}: ${data.teams[0].score} vs ${data.teams[1].name}: ${data.teams[1].score}`);
        }
        if (data.sourceUrl) {
          parts.push(`Source: [${data.sourceName || "Official Scorecard"}](${data.sourceUrl})`);
        }
        break;
      }

      case "player_stats": {
        const data = comp.data as PlayerStatsComponentData;
        parts.push(`**${data.playerName}** (${data.teamName}) — ${data.headlineStat}`);
        if (data.headlineLabel) parts.push(`*${data.headlineLabel}*`);
        if (data.stats && data.stats.length) {
          parts.push(data.stats.map((s) => `- ${s.label}: ${s.value}`).join("\n"));
        }
        if (data.sourceUrl) {
          parts.push(`Source: [${data.sourceName || "Match Report"}](${data.sourceUrl})`);
        }
        break;
      }

      case "standings_table": {
        const data = comp.data as StandingsTableComponentData;
        parts.push(`**${data.competition} Standings**`);
        if (data.rows && data.rows.length) {
          const header = "| Pos | Team | P | W | D | L | GD/NRR | PTS |";
          const divider = "|---|---|---|---|---|---|---|---|";
          const rows = data.rows.map(
            (r) => `| ${r.rank} | ${r.teamName} | ${r.played} | ${r.won} | ${r.drawn ?? "-"} | ${r.lost} | ${r.diff ?? "-"} | ${r.points} |`
          );
          parts.push([header, divider, ...rows].join("\n"));
        }
        if (data.sourceUrl) {
          parts.push(`Source: [${data.sourceName || "Official Table"}](${data.sourceUrl})`);
        }
        break;
      }

      case "medal_tally": {
        const data = comp.data as MedalTallyComponentData;
        parts.push(`**${data.competition} Medal Tally**`);
        if (data.freshness) parts.push(`*${data.freshness}*`);
        if (data.rows && data.rows.length) {
          const header = "| Rank | Nation | Gold | Silver | Bronze | Total |";
          const divider = "|---|---|---|---|---|---|";
          const rows = data.rows.map(
            (r) => `| ${r.rank} | ${r.nation} | ${r.gold} | ${r.silver} | ${r.bronze} | ${r.total} |`
          );
          parts.push([header, divider, ...rows].join("\n"));
        }
        if (data.sourceUrl) {
          parts.push(`Source: [${data.sourceName || "Medal Standings"}](${data.sourceUrl})`);
        }
        break;
      }

      case "data_card": {
        const data = comp.data as DataCardComponentData;
        parts.push(`**${data.title}**`);
        if (data.subtitle) parts.push(`*${data.subtitle}*`);
        if (data.metrics && data.metrics.length) {
          parts.push(data.metrics.map((m) => `- ${m.label}: ${m.value}${m.unit ? ` ${m.unit}` : ""}`).join("\n"));
        }
        if (data.rows && data.rows.length) {
          parts.push(data.rows.map((r) => `- **${r.key}**: ${r.value}`).join("\n"));
        }
        if (data.sourceUrl) {
          parts.push(`Source: [${data.sourceName || "Data Source"}](${data.sourceUrl})`);
        }
        break;
      }

      default:
        if (typeof comp.data === "string") parts.push(comp.data);
        else parts.push(JSON.stringify(comp.data));
        break;
    }
  }

  return parts.join("\n\n");
}

function sanitizeString(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  return val.trim().slice(0, LIMITS.MAX_STRING_LENGTH) || undefined;
}

function sanitizeColor(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^(rgb|hsl)a?\(.+?\)$/.test(trimmed)) return trimmed;
  return undefined;
}

function sanitizeUrl(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (trimmed.startsWith("/api/")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return trimmed;
    }
  } catch {}
  return undefined;
}

function sanitizeActions(val: unknown): ComponentAction[] | undefined {
  if (!Array.isArray(val)) return undefined;
  return val.slice(0, 5).map((a, idx) => ({
    id: sanitizeString(a.id) || `act-${idx + 1}`,
    label: sanitizeString(a.label) || "Action",
    style: ["primary", "secondary", "danger"].includes(a.style) ? a.style : "secondary",
    disabled: Boolean(a.disabled),
    url: sanitizeUrl(a.url),
  }));
}

function sanitizeRow(row: unknown): Record<string, string | number | boolean | null> {
  if (!row || typeof row !== "object") return {};
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (typeof v === "string") clean[k] = v.slice(0, 1000);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) clean[k] = v;
    else clean[k] = String(v).slice(0, 1000);
  }
  return clean;
}

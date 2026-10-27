package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ChartData
import com.openmausbot.companion.core.ChecklistData
import com.openmausbot.companion.core.ChecklistItem
import com.openmausbot.companion.core.CodeData
import com.openmausbot.companion.core.ComparisonData
import com.openmausbot.companion.core.DashboardData
import com.openmausbot.companion.core.DecisionMatrixData
import com.openmausbot.companion.core.KanbanData
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.SemanticCardData
import com.openmausbot.companion.core.SourcesData
import com.openmausbot.companion.core.StructuredComponent
import com.openmausbot.companion.core.StructuredResponseData
import com.openmausbot.companion.core.TableColumn
import com.openmausbot.companion.core.TableData
import com.openmausbot.companion.core.TimelineData
import com.openmausbot.companion.core.MatchScorecardData
import com.openmausbot.companion.core.MatchTeam
import com.openmausbot.companion.core.CricketInnings
import com.openmausbot.companion.core.CricketBatterSummary
import com.openmausbot.companion.core.CricketBowlerSummary
import com.openmausbot.companion.core.PlayerStatsData
import com.openmausbot.companion.core.PlayerStatItem
import com.openmausbot.companion.core.StandingsTableData
import com.openmausbot.companion.core.StandingRow
import com.openmausbot.companion.core.QualificationZoneLegend
import com.openmausbot.companion.core.MedalTallyData
import com.openmausbot.companion.core.MedalRow
import com.openmausbot.companion.core.GenericDataCardData
import com.openmausbot.companion.core.DataMetric
import com.openmausbot.companion.core.DataRow
import com.openmausbot.companion.core.DataSection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put

/**
 * Phase J: Structured Response System Presentation & Serialization Test.
 */
class StructuredResponsePresentationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun `serializes and deserializes structured response message correctly`() {
        val structured = StructuredResponseData(
            version = 1,
            components = listOf(
                StructuredComponent(
                    id = "comp-1",
                    type = "table",
                    title = "Sales Report",
                    data = json.encodeToJsonElement(
                        TableData(
                            columns = listOf(
                                TableColumn(key = "item", label = "Item"),
                                TableColumn(key = "qty", label = "Quantity", numeric = true),
                            ),
                            rows = listOf(
                                mapOf("item" to json.encodeToJsonElement("Apples"), "qty" to json.encodeToJsonElement(50)),
                            ),
                        ),
                    ),
                ),
                StructuredComponent(
                    id = "comp-2",
                    type = "checklist",
                    title = "Sprint Tasks",
                    data = json.encodeToJsonElement(
                        ChecklistData(
                            items = listOf(
                                ChecklistItem(id = "t1", label = "Build native UI", checked = true),
                                ChecklistItem(id = "t2", label = "Test on Samsung SM-A075F", checked = false),
                            ),
                        ),
                    ),
                ),
            ),
        )

        val message = Message(
            id = "msg-struct-1",
            role = Message.Role.BOT,
            kind = Message.Kind.STRUCTURED,
            at = 1791620000.0,
            text = "Here is your requested sprint report.",
            structured = structured,
        )

        val raw = json.encodeToString(Message.serializer(), message)
        val decoded = json.decodeFromString(Message.serializer(), raw)

        assertEquals(Message.Kind.STRUCTURED, decoded.kind)
        val decodedStructured = decoded.structured
        assertNotNull(decodedStructured)
        assertEquals(2, decodedStructured.components.size)
        assertEquals("table", decodedStructured.components[0].type)
        assertEquals("checklist", decodedStructured.components[1].type)

        val checklistData = json.decodeFromJsonElement<ChecklistData>(decodedStructured.components[1].data!!)
        assertEquals(2, checklistData.items.size)
        assertTrue(checklistData.items[0].checked)
        assertEquals("t2", checklistData.items[1].id)
    }

    @Test
    fun `supports semantic card variants`() {
        val cardData = SemanticCardData(
            variant = "success",
            headline = "Deployment Live",
            body = "Production cluster updated cleanly.",
            badge = "READY",
        )
        val encoded = json.encodeToJsonElement(cardData)
        val decoded = json.decodeFromJsonElement<SemanticCardData>(encoded)

        assertEquals("success", decoded.variant)
        assertEquals("Deployment Live", decoded.headline)
        assertEquals("READY", decoded.badge)
    }

    @Test
    fun `supports dashboard metrics and alert components`() {
        val dash = DashboardData(
            metrics = listOf(
                com.openmausbot.companion.core.MetricTile(
                    id = "m1",
                    label = "Server CPU",
                    value = "14%",
                    change = "-3%",
                    trend = "down",
                ),
            ),
            alerts = listOf(
                com.openmausbot.companion.core.DashboardAlert(
                    id = "a1",
                    message = "Memory usage normal",
                    severity = "info",
                ),
            ),
        )
        val encoded = json.encodeToJsonElement(dash)
        val decoded = json.decodeFromJsonElement<DashboardData>(encoded)

        assertEquals(1, decoded.metrics.size)
        assertEquals("14%", decoded.metrics[0].value)
        assertEquals(1, decoded.alerts?.size)
    }

    @Test
    fun `supports diagram components and node connections`() {
        val diagram = com.openmausbot.companion.core.DiagramData(
            diagramType = "architecture",
            nodes = listOf(
                com.openmausbot.companion.core.DiagramNode(id = "client", label = "Android App", type = "client", status = "ok"),
                com.openmausbot.companion.core.DiagramNode(id = "server", label = "Node.js Server", type = "server", status = "active"),
                com.openmausbot.companion.core.DiagramNode(id = "db", label = "SQLite Database", type = "database", status = "ok"),
            ),
            edges = listOf(
                com.openmausbot.companion.core.DiagramEdge(from = "client", to = "server", label = "HTTP/WS"),
                com.openmausbot.companion.core.DiagramEdge(from = "server", to = "db", label = "SQL"),
            ),
            accessibleText = "Architecture: Client connects to Server which connects to Database",
        )
        val encoded = json.encodeToJsonElement(diagram)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.DiagramData>(encoded)

        assertEquals("architecture", decoded.diagramType)
        assertEquals(3, decoded.nodes.size)
        assertEquals(2, decoded.edges.size)
        assertEquals("Android App", decoded.nodes[0].label)
        assertEquals("client", decoded.edges[0].from)
        assertEquals("server", decoded.edges[0].to)
    }

    @Test
    fun `supports map coordinates markers and routes`() {
        val mapData = com.openmausbot.companion.core.MapData(
            center = com.openmausbot.companion.core.MapCoordinate(lat = 37.7749, lng = -122.4194),
            zoom = 12.0,
            markers = listOf(
                com.openmausbot.companion.core.MapMarker(
                    id = "m1",
                    title = "Headquarters",
                    lat = 37.7749,
                    lng = -122.4194,
                    snippet = "Main office",
                    badge = "HQ",
                ),
            ),
            routes = listOf(
                com.openmausbot.companion.core.MapRoute(
                    id = "r1",
                    name = "Commute Path",
                    points = listOf(
                        com.openmausbot.companion.core.MapCoordinate(lat = 37.7749, lng = -122.4194),
                        com.openmausbot.companion.core.MapCoordinate(lat = 37.7833, lng = -122.4167),
                    ),
                    distance = "2.4 km",
                ),
            ),
        )
        val encoded = json.encodeToJsonElement(mapData)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.MapData>(encoded)

        assertEquals(37.7749, decoded.center.lat)
        assertEquals(1, decoded.markers.size)
        assertEquals("HQ", decoded.markers[0].badge)
        assertEquals(1, decoded.routes.size)
        assertEquals("2.4 km", decoded.routes[0].distance)
    }

    @Test
    fun `supports calendar agenda and recurring schedule serialization`() {
        val calendar = com.openmausbot.companion.core.CalendarData(
            viewMode = "agenda",
            startDate = "2026-10-12",
            endDate = "2026-10-18",
            events = listOf(
                com.openmausbot.companion.core.CalendarEvent(
                    id = "ev1",
                    title = "Sprint Planning",
                    start = "2026-10-12T10:00:00Z",
                    end = "2026-10-12T11:00:00Z",
                    allDay = false,
                    category = "Work",
                    location = "Room A",
                ),
            ),
        )
        val encoded = json.encodeToJsonElement(calendar)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.CalendarData>(encoded)

        assertEquals("agenda", decoded.viewMode)
        assertEquals(1, decoded.events.size)
        assertEquals("Sprint Planning", decoded.events[0].title)
        assertEquals("Room A", decoded.events[0].location)
    }

    @Test
    fun `supports gantt timeline tasks and milestones`() {
        val gantt = com.openmausbot.companion.core.GanttData(
            startDate = "2026-10-01",
            endDate = "2026-10-31",
            tasks = listOf(
                com.openmausbot.companion.core.GanttTask(
                    id = "g1",
                    name = "Phase J Protocol",
                    start = "2026-10-01",
                    end = "2026-10-15",
                    progress = 100.0,
                    status = "done",
                ),
            ),
            milestones = listOf(
                com.openmausbot.companion.core.GanttMilestone(
                    id = "m1",
                    name = "Phase J Release",
                    date = "2026-10-15",
                    completed = true,
                ),
            ),
        )
        val encoded = json.encodeToJsonElement(gantt)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.GanttData>(encoded)

        assertEquals(1, decoded.tasks.size)
        assertEquals(100.0, decoded.tasks[0].progress)
        assertEquals(1, decoded.milestones.size)
        assertTrue(decoded.milestones[0].completed)
    }

    @Test
    fun `supports artifact preview and metadata`() {
        val artifact = com.openmausbot.companion.core.ArtifactData(
            artifactType = "pdf",
            title = "Quarterly Report",
            filename = "Q3_Report.pdf",
            sizeBytes = 2048576,
            mimeType = "application/pdf",
            summary = "Summary of Q3 milestones and deliverables",
            url = "file:///sdcard/Download/Q3_Report.pdf",
            previewLines = listOf("Page 1: Executive Summary", "Page 2: Financials"),
            metadata = mapOf("author" to "MOBOT", "version" to "1.0"),
        )
        val encoded = json.encodeToJsonElement(artifact)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.ArtifactData>(encoded)

        assertEquals("pdf", decoded.artifactType)
        assertEquals("Q3_Report.pdf", decoded.filename)
        assertEquals(2048576L, decoded.sizeBytes)
        assertEquals(2, decoded.previewLines.size)
        assertEquals("MOBOT", decoded.metadata?.get("author"))
    }

    @Test
    fun `supports interactive form components`() {
        val form = com.openmausbot.companion.core.FormData(
            fields = listOf(
                com.openmausbot.companion.core.FormField(
                    id = "theme",
                    label = "Color Theme",
                    type = "single_choice",
                    options = listOf("Light", "Dark", "System"),
                ),
                com.openmausbot.companion.core.FormField(
                    id = "enable_cache",
                    label = "Enable Offline Cache",
                    type = "toggle",
                ),
            ),
            submitLabel = "Save Configuration",
        )
        val encoded = json.encodeToJsonElement(form)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.FormData>(encoded)

        assertEquals(2, decoded.fields.size)
        assertEquals("single_choice", decoded.fields[0].type)
        assertEquals("Save Configuration", decoded.submitLabel)
    }

    @Test
    fun `supports rich media components`() {
        val media = com.openmausbot.companion.core.MediaData(
            mediaType = "gallery",
            items = listOf(
                com.openmausbot.companion.core.MediaItem(
                    url = "https://example.com/screenshot1.png",
                    title = "Dashboard View",
                    caption = "Primary analytics card",
                ),
            ),
        )
        val encoded = json.encodeToJsonElement(media)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.MediaData>(encoded)

        assertEquals("gallery", decoded.mediaType)
        assertEquals(1, decoded.items.size)
        assertEquals("Dashboard View", decoded.items[0].title)
    }

    @Test
    fun `component actions are serialized correctly`() {
        val action = com.openmausbot.companion.core.ComponentAction(
            id = "deploy_btn",
            label = "Deploy Now",
            style = "primary",
            disabled = false,
        )
        val encoded = json.encodeToJsonElement(action)
        val decoded = json.decodeFromJsonElement<com.openmausbot.companion.core.ComponentAction>(encoded)

        assertEquals("deploy_btn", decoded.id)
        assertEquals("Deploy Now", decoded.label)
        assertEquals("primary", decoded.style)
        assertEquals(false, decoded.disabled)
    }

    @Test
    fun `supports cricket and football match scorecards`() {
        val scorecard = MatchScorecardData(
            sport = "cricket",
            competition = "ICC Men's T20 World Cup 2024",
            fixtureTitle = "Final: India vs South Africa",
            status = "finished",
            statusDetail = "India won by 7 runs",
            teams = listOf(
                MatchTeam(name = "India", shortName = "IND", score = "176/7 (20.0)", isWinner = true),
                MatchTeam(name = "South Africa", shortName = "SA", score = "169/8 (20.0)", isWinner = false),
            ),
            innings = listOf(
                CricketInnings(
                    teamName = "India",
                    runs = 176,
                    wickets = 7,
                    overs = "20.0",
                    topBatters = listOf(
                        CricketBatterSummary(name = "Virat Kohli", runs = 76, balls = 59, fours = 6, sixes = 2, strikeRate = "128.81"),
                    ),
                    topBowlers = listOf(
                        CricketBowlerSummary(name = "Anrich Nortje", overs = "4.0", runs = 26, wickets = 2, economy = "6.50"),
                    ),
                ),
            ),
            sourceUrl = "https://www.icc-cricket.com/matches/final-ind-vs-sa-2024",
            sourceName = "ICC Official",
        )

        val encoded = json.encodeToJsonElement(scorecard)
        val decoded = json.decodeFromJsonElement<MatchScorecardData>(encoded)

        assertEquals("cricket", decoded.sport)
        assertEquals("Final: India vs South Africa", decoded.fixtureTitle)
        assertEquals(2, decoded.teams.size)
        assertTrue(decoded.teams[0].isWinner)
        assertEquals("176/7 (20.0)", decoded.teams[0].score)
        assertEquals(1, decoded.innings.size)
        assertEquals("Virat Kohli", decoded.innings[0].topBatters[0].name)
        assertEquals(76, decoded.innings[0].topBatters[0].runs)
        assertEquals("https://www.icc-cricket.com/matches/final-ind-vs-sa-2024", decoded.sourceUrl)
    }

    @Test
    fun `supports player statistics components`() {
        val playerStats = PlayerStatsData(
            playerName = "Sanju Samson",
            sport = "cricket",
            teamName = "India",
            opponentName = "South Africa",
            competition = "T20 International",
            headlineStat = "107 (50)",
            headlineLabel = "Centurion",
            stats = listOf(
                PlayerStatItem(label = "Runs", value = "107", highlight = true),
                PlayerStatItem(label = "Balls", value = "50"),
                PlayerStatItem(label = "4s", value = "7"),
                PlayerStatItem(label = "6s", value = "10", highlight = true),
            ),
            sourceUrl = "https://www.bcci.tv/match/456",
        )

        val encoded = json.encodeToJsonElement(playerStats)
        val decoded = json.decodeFromJsonElement<PlayerStatsData>(encoded)

        assertEquals("Sanju Samson", decoded.playerName)
        assertEquals("107 (50)", decoded.headlineStat)
        assertEquals(4, decoded.stats.size)
        assertEquals("7", decoded.stats.find { it.label == "4s" }?.value)
        assertEquals("10", decoded.stats.find { it.label == "6s" }?.value)
        assertTrue(decoded.stats[0].highlight)
    }

    @Test
    fun `supports league standings table components`() {
        val standings = StandingsTableData(
            competition = "Premier League 2024/25",
            season = "2024/25",
            columns = listOf("Pos", "Team", "P", "W", "D", "L", "GD", "PTS"),
            rows = listOf(
                StandingRow(rank = 1, teamName = "Arsenal", played = 20, won = 15, drawn = 3, lost = 2, diff = "+30", points = 48, qualificationZone = "champions_league"),
                StandingRow(rank = 2, teamName = "Manchester City", played = 20, won = 14, drawn = 4, lost = 2, diff = "+28", points = 46, qualificationZone = "champions_league"),
            ),
            qualificationLegend = listOf(
                QualificationZoneLegend(zone = "champions_league", label = "Champions League", color = "#58A6FF"),
            ),
            sourceUrl = "https://www.premierleague.com/tables",
        )

        val encoded = json.encodeToJsonElement(standings)
        val decoded = json.decodeFromJsonElement<StandingsTableData>(encoded)

        assertEquals("Premier League 2024/25", decoded.competition)
        assertEquals(2, decoded.rows.size)
        assertEquals("Arsenal", decoded.rows[0].teamName)
        assertEquals(48, decoded.rows[0].points)
        assertEquals("+30", decoded.rows[0].diff)
    }

    @Test
    fun `supports olympic and multi-sport medal tally components`() {
        val medalTally = MedalTallyData(
            competition = "Paris 2024 Olympic Games",
            rankingMethod = "gold_first",
            rankingMethodLabel = "Ranked by Gold medals first",
            freshness = "Final Tally",
            rows = listOf(
                MedalRow(rank = 1, nation = "United States", nocCode = "USA", gold = 40, silver = 44, bronze = 42, total = 126),
                MedalRow(rank = 2, nation = "China", nocCode = "CHN", gold = 40, silver = 27, bronze = 24, total = 91),
            ),
            sourceUrl = "https://olympics.com/paris-2024/medals",
        )

        val encoded = json.encodeToJsonElement(medalTally)
        val decoded = json.decodeFromJsonElement<MedalTallyData>(encoded)

        assertEquals("Paris 2024 Olympic Games", decoded.competition)
        assertEquals("gold_first", decoded.rankingMethod)
        assertEquals(2, decoded.rows.size)
        assertEquals("United States", decoded.rows[0].nation)
        assertEquals(40, decoded.rows[0].gold)
        assertEquals(126, decoded.rows[0].total)
    }

    @Test
    fun `supports extensible generic data card components`() {
        val dataCard = GenericDataCardData(
            title = "Q4 Financial Report",
            subtitle = "Earnings Review",
            badge = "Verified",
            badgeType = "success",
            metrics = listOf(
                DataMetric(label = "Revenue", value = "$12.4B", change = "+14%", trend = "up"),
            ),
            rows = listOf(
                DataRow(key = "Operating Cash Flow", value = "$3.2B"),
            ),
            sections = listOf(
                DataSection(heading = "Summary", content = "Strong quarterly performance."),
            ),
            sourceUrl = "https://example.com/report",
        )

        val encoded = json.encodeToJsonElement(dataCard)
        val decoded = json.decodeFromJsonElement<GenericDataCardData>(encoded)

        assertEquals("Q4 Financial Report", decoded.title)
        assertEquals("Verified", decoded.badge)
        assertEquals(1, decoded.metrics.size)
        assertEquals("$12.4B", decoded.metrics[0].value)
        assertEquals(1, decoded.rows.size)
        assertEquals("Operating Cash Flow", decoded.rows[0].key)
    }
}

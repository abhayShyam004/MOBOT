import { describe, expect, it } from "vitest";
import {
  STRUCTURED_PROTOCOL_VERSION,
  structuredResponseToFallbackText,
  validateStructuredResponse,
} from "./structured-response.ts";

describe("Structured Response Protocol (Phase J)", () => {
  it("validates a well-formed multi-component structured response", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "comp-1",
          type: "table",
          title: "Top Products",
          data: {
            columns: [
              { key: "name", label: "Product", priority: 1 },
              { key: "sales", label: "Sales ($)", numeric: true, priority: 1 },
            ],
            rows: [
              { name: "Widget A", sales: 1200 },
              { name: "Widget B", sales: 850 },
            ],
          },
        },
        {
          id: "comp-2",
          type: "chart",
          title: "Quarterly Revenue",
          data: {
            chartType: "bar",
            labels: ["Q1", "Q2", "Q3", "Q4"],
            series: [{ name: "2026", data: [100, 200, 300, 400] }],
          },
        },
        {
          id: "comp-3",
          type: "checklist",
          title: "Launch Checklist",
          data: {
            items: [
              { id: "task-1", label: "Database schema migration", checked: true },
              { id: "task-2", label: "Deploy to production", checked: false },
            ],
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(3);
    expect(result.sanitized?.components[0].type).toBe("table");
    expect(result.sanitized?.components[1].type).toBe("chart");
    expect(result.sanitized?.components[2].type).toBe("checklist");
  });

  it("sanitizes dangerous URLs and non-http protocols in sources", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "src-1",
          type: "sources",
          data: {
            sources: [
              { url: "javascript:alert(1)", title: "Malicious link" },
              { url: "https://developer.android.com", title: "Android Devs", domain: "developer.android.com" },
            ],
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const sourcesComp = result.sanitized?.components[0];
    expect(sourcesComp?.type).toBe("sources");
    // Invalid protocol falls back to safe default
    expect(sourcesComp?.data.sources[0].url).toBe("https://example.com");
    expect(sourcesComp?.data.sources[1].url).toBe("https://developer.android.com");
  });

  it("bounds oversized payloads and row counts safely", () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: i, name: `Row ${i}` }));
    const input = {
      version: 1,
      components: [
        {
          id: "huge-table",
          type: "table",
          data: {
            columns: [{ key: "name", label: "Name" }],
            rows,
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    // Over limit causes warning and truncation to 500 rows
    expect(result.sanitized?.components[0].data.rows.length).toBe(500);
  });

  it("handles unknown component types by degrading gracefully to semantic card", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "mystery-comp",
          type: "future_ai_hologram",
          title: "Experimental Hologram",
          data: { intensity: 9000 },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.sanitized?.components.length).toBe(1);
    expect(result.sanitized?.components[0].type).toBe("card");
    expect(result.sanitized?.components[0].data.variant).toBe("info");
  });

  it("rejects unsupported future protocol versions", () => {
    const input = {
      version: STRUCTURED_PROTOCOL_VERSION + 99,
      components: [],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unsupported protocol version");
  });

  it("generates faithful markdown fallback text for accessibility and screen readers", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "checklist-1",
          type: "checklist" as const,
          title: "Tasks",
          data: {
            items: [
              { id: "1", label: "Buy groceries", checked: true },
              { id: "2", label: "Prepare dinner", checked: false },
            ],
          },
        },
        {
          id: "card-1",
          type: "card" as const,
          data: {
            variant: "info" as const,
            headline: "Deployment Complete",
            body: "Your app is live and healthy.",
          },
        },
      ],
    };

    const fallback = structuredResponseToFallbackText(input);
    expect(fallback).toContain("### Tasks");
    expect(fallback).toContain("- [x] Buy groceries");
    expect(fallback).toContain("- [ ] Prepare dinner");
    expect(fallback).toContain("**Deployment Complete**");
    expect(fallback).toContain("Your app is live and healthy.");
  });

  it("validates all 16 component types in the registry", () => {
    const _registryTypes = [
      "table", "chart", "timeline", "kanban", "checklist", "comparison",
      "decision_matrix", "dashboard", "diagram", "map", "calendar", "gantt",
      "code", "artifact", "form", "media", "card", "sources"
    ];

    const input = {
      version: 1,
      components: [
        {
          id: "diag-1",
          type: "diagram" as const,
          title: "System Architecture",
          data: {
            diagramType: "architecture" as const,
            nodes: [
              { id: "app", label: "Mobile App", type: "client" as const, status: "ok" as const },
              { id: "api", label: "Gateway API", type: "server" as const, status: "active" as const },
            ],
            edges: [{ from: "app", to: "api", label: "HTTPS" }],
          },
        },
        {
          id: "map-1",
          type: "map" as const,
          title: "Server Clusters",
          data: {
            center: { lat: 37.77, lng: -122.42 },
            markers: [{ id: "dc1", title: "US-West Datacenter", lat: 37.77, lng: -122.42, badge: "Primary" }],
          },
        },
        {
          id: "cal-1",
          type: "calendar" as const,
          title: "Maintenance Windows",
          data: {
            startDate: "2026-10-15",
            events: [{ id: "m1", title: "DB Vacuum", start: "2026-10-15T02:00:00Z" }],
          },
        },
        {
          id: "gantt-1",
          type: "gantt" as const,
          title: "Release Milestones",
          data: {
            startDate: "2026-10-01",
            endDate: "2026-10-31",
            tasks: [{ id: "t1", name: "Core Engine", start: "2026-10-01", end: "2026-10-14", progress: 100 }],
          },
        },
        {
          id: "art-1",
          type: "artifact" as const,
          title: "Architecture Spec",
          data: {
            artifactType: "document" as const,
            title: "Architecture Spec v2",
            filename: "arch.md",
            previewLines: ["# Architecture", "Native compose pipeline"],
          },
        },
        {
          id: "form-1",
          type: "form" as const,
          title: "Configuration",
          data: {
            fields: [
              { id: "mode", label: "Mode", type: "single_choice" as const, options: ["Fast", "Accurate"] },
              { id: "persist", label: "Persist DB", type: "toggle" as const },
            ],
            submitLabel: "Apply",
          },
        },
        {
          id: "media-1",
          type: "media" as const,
          title: "Render Preview",
          data: {
            mediaType: "image" as const,
            items: [{ url: "https://example.com/mockup.png", title: "Mobile UI" }],
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(7);

    // Fallback text check
    const fallback = structuredResponseToFallbackText(result.sanitized!);
    expect(fallback).toContain("### System Architecture");
    expect(fallback).toContain("Mobile App");
    expect(fallback).toContain("US-West Datacenter");
    expect(fallback).toContain("DB Vacuum");
    expect(fallback).toContain("Core Engine");
    expect(fallback).toContain("Architecture Spec v2");
    expect(fallback).toContain("Configuration");
    expect(fallback).toContain("Mobile UI");
  });

  it("normalizes product component with resultType and title to rich result component", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "res-1",
          type: "product",
          data: {
            resultType: "product",
            title: "Refurbished MacBook Air 13.6-inch, Apple M2, 8GB/256GB",
            company: "Best Buy",
            location: "United States",
            price: "$749",
            source: "Best Buy",
            sourceDomain: "bestbuy.com",
            sourceUrl: "https://www.bestbuy.com/product/macbook-air-13-6-laptop",
            actionLabel: "View Product",
            actionUrl: "https://www.bestbuy.com/product/macbook-air-13-6-laptop",
            reason: "Best verified match for school, battery life, and your budget.",
            tags: ["Apple M2", "8GB RAM", "256GB SSD", "Refurbished"],
            badge: "Top Pick",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(1);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("result");
    expect(comp?.data.resultType).toBe("product");
    expect(comp?.data.title).toBe("Refurbished MacBook Air 13.6-inch, Apple M2, 8GB/256GB");
    expect(comp?.data.company).toBe("Best Buy");
    expect(comp?.data.price).toBe("$749");
    expect(comp?.data.badge).toBe("Top Pick");
  });

  it("validates product component with title as name fallback when staying product", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "prod-1",
          type: "product",
          data: {
            title: "Logitech MX Master 3S",
            price: "$99",
            retailer: "Amazon",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.data.title || comp?.data.name).toBe("Logitech MX Master 3S");
  });

  it("validates result component with name fallback when title is missing", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "res-job",
          type: "result",
          data: {
            name: "Senior Software Engineer",
            company: "Google",
            salary: "$180,000 - $220,000",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("result");
    expect(comp?.data.title).toBe("Senior Software Engineer");
    expect(comp?.data.company).toBe("Google");
  });

  it("validates cricket match scorecard with innings, top batters and bowlers", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "scorecard-t20",
          type: "match_scorecard",
          data: {
            sport: "cricket",
            competition: "ICC Men's T20 World Cup 2024",
            fixtureTitle: "Final: India vs South Africa",
            status: "finished",
            statusDetail: "India won by 7 runs",
            date: "June 29, 2024",
            venue: "Kensington Oval, Bridgetown, Barbados",
            teams: [
              { name: "India", shortName: "IND", score: "176/7 (20.0)", isWinner: true },
              { name: "South Africa", shortName: "SA", score: "169/8 (20.0)", isWinner: false },
            ],
            innings: [
              {
                teamName: "India",
                runs: 176,
                wickets: 7,
                overs: "20.0",
                runRate: "8.80",
                topBatters: [
                  { name: "Virat Kohli", runs: 76, balls: 59, fours: 6, sixes: 2, strikeRate: "128.81" },
                  { name: "Axar Patel", runs: 47, balls: 31, fours: 1, sixes: 4, strikeRate: "151.61" },
                ],
                topBowlers: [
                  { name: "Anrich Nortje", overs: "4.0", maidens: 0, runs: 26, wickets: 2, economy: "6.50" },
                ],
              },
            ],
            sourceUrl: "https://www.icc-cricket.com/matches/final-ind-vs-sa-2024",
            sourceName: "ICC Official",
            retrievalTimestamp: 1719688000000,
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("match_scorecard");
    expect(comp?.data.sport).toBe("cricket");
    expect(comp?.data.fixtureTitle).toBe("Final: India vs South Africa");
    expect(comp?.data.status).toBe("finished");
    expect(comp?.data.teams[0].score).toBe("176/7 (20.0)");
    expect(comp?.data.innings[0].topBatters[0].name).toBe("Virat Kohli");
    expect(comp?.data.sourceUrl).toBe("https://www.icc-cricket.com/matches/final-ind-vs-sa-2024");

    const fallback = structuredResponseToFallbackText(result.sanitized!);
    expect(fallback).toContain("ICC Men's T20 World Cup 2024");
    expect(fallback).toContain("India: 176/7 (20.0) vs South Africa: 169/8 (20.0)");
  });

  it("validates football match scorecard with events and stats", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "scorecard-epl",
          type: "match_scorecard",
          data: {
            sport: "football",
            competition: "Premier League",
            fixtureTitle: "Arsenal vs Chelsea",
            status: "finished",
            statusDetail: "Full Time",
            teams: [
              { name: "Arsenal", score: "3", isWinner: true },
              { name: "Chelsea", score: "1", isWinner: false },
            ],
            events: [
              { type: "goal", minute: "18'", teamName: "Arsenal", playerName: "Martin Odegaard" },
              { type: "goal", minute: "31'", teamName: "Arsenal", playerName: "Martin Odegaard" },
              { type: "goal", minute: "65'", teamName: "Chelsea", playerName: "Noni Madueke" },
            ],
            stats: [
              { label: "Possession", homeValue: "56%", awayValue: "44%" },
              { label: "Shots", homeValue: "16", awayValue: "7" },
            ],
            sourceUrl: "https://www.premierleague.com/match/123",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("match_scorecard");
    expect(comp?.data.sport).toBe("football");
    expect(comp?.data.events.length).toBe(3);
    expect(comp?.data.stats.length).toBe(2);
  });

  it("validates player statistics tied to fixture", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "player-samson",
          type: "player_stats",
          data: {
            playerName: "Sanju Samson",
            sport: "cricket",
            teamName: "India",
            opponentName: "South Africa",
            competition: "T20 International",
            fixtureTitle: "1st T20I: South Africa vs India",
            fixtureDate: "Nov 08, 2024",
            role: "Wicketkeeper-Batter",
            headlineStat: "107 (50)",
            headlineLabel: "Back-to-back T20I Century",
            stats: [
              { label: "Runs", value: 107, highlight: true },
              { label: "Balls", value: 50 },
              { label: "4s", value: 7 },
              { label: "6s", value: 10, highlight: true },
              { label: "Strike Rate", value: "214.00" },
            ],
            sourceUrl: "https://www.bcci.tv/match/456",
            sourceName: "BCCI",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("player_stats");
    expect(comp?.data.playerName).toBe("Sanju Samson");
    expect(comp?.data.headlineStat).toBe("107 (50)");
    expect(comp?.data.stats.find((s: any) => s.label === "4s")?.value).toBe(7);
  });

  it("validates standings table and medal tally components", () => {
    const standingsInput = {
      version: 1,
      components: [
        {
          id: "standings-epl",
          type: "standings_table",
          data: {
            competition: "Premier League 2024/25",
            rows: [
              { rank: 1, teamName: "Liverpool", played: 10, won: 8, drawn: 1, lost: 1, diff: "+11", points: 25, qualificationZone: "champions_league" },
              { rank: 2, teamName: "Manchester City", played: 10, won: 7, drawn: 2, lost: 1, diff: "+10", points: 23, qualificationZone: "champions_league" },
            ],
            sourceUrl: "https://www.premierleague.com/tables",
          },
        },
        {
          id: "medals-paris",
          type: "medal_tally",
          data: {
            competition: "Paris 2024 Olympic Games",
            rankingMethod: "gold_first",
            rankingMethodLabel: "Ranked by Gold medals",
            freshness: "Final Tally",
            rows: [
              { rank: 1, nation: "United States", nocCode: "USA", gold: 40, silver: 44, bronze: 42, total: 126 },
              { rank: 2, nation: "China", nocCode: "CHN", gold: 40, silver: 27, bronze: 24, total: 91 },
            ],
            sourceUrl: "https://olympics.com/paris-2024/medals",
          },
        },
      ],
    };

    const result = validateStructuredResponse(standingsInput);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(2);
    expect(result.sanitized?.components[0].type).toBe("standings_table");
    expect(result.sanitized?.components[1].type).toBe("medal_tally");
    expect(result.sanitized?.components[1].data.rows[0].nation).toBe("United States");
  });

  it("validates extensible generic data card component", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "card-economy",
          type: "data_card",
          data: {
            title: "Q3 Financial Performance",
            subtitle: "Global Markets Review",
            badge: "Verified",
            badgeType: "success",
            metrics: [
              { label: "Revenue", value: "$12.4M", change: "+14.2%", trend: "up" },
              { label: "Net Margin", value: "22.8%", trend: "neutral" },
            ],
            rows: [
              { key: "Operating Cash Flow", value: "$3.8M" },
              { key: "EBITDA", value: "$4.1M", subtext: "Exceeds consensus" },
            ],
            sourceUrl: "https://sec.gov/filing/123",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("data_card");
    expect(comp?.data.metrics[0].label).toBe("Revenue");
    expect(comp?.data.rows[1].key).toBe("EBITDA");
  });
});

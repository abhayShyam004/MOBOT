import { describe, expect, it } from "vitest";
import {
  structuredResponseToFallbackText,
  type StandingsTableComponentData,
  type MatchScorecardComponentData,
} from "../shared/structured-response.ts";
import { extractStructuredContent } from "./structured-extract.ts";
import {
  recordSportsContext,
  getSportsContext,
  resolveFollowUpQuery,
  clearSportsContext,
} from "./sports-context.ts";

describe("Universal Rich Data Cards & Structured Results Experience", () => {
  it("Scenario 1: Cricket Match Scorecard (Innings, Overs, Wickets, Batters, Bowlers, Provenance)", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "match-t20wc-final",
      "type": "match_scorecard",
      "data": {
        "sport": "cricket",
        "competition": "ICC Men's T20 World Cup 2024",
        "fixtureTitle": "Final: India vs South Africa",
        "status": "finished",
        "statusDetail": "India won by 7 runs",
        "date": "June 29, 2024",
        "venue": "Kensington Oval, Bridgetown, Barbados",
        "teams": [
          { "name": "India", "shortName": "IND", "score": "176/7 (20.0)", "isWinner": true },
          { "name": "South Africa", "shortName": "SA", "score": "169/8 (20.0)", "isWinner": false }
        ],
        "innings": [
          {
            "teamName": "India",
            "runs": 176,
            "wickets": 7,
            "overs": "20.0",
            "runRate": "8.80",
            "topBatters": [
              { "name": "Virat Kohli", "runs": 76, "balls": 59, "fours": 6, "sixes": 2, "strikeRate": "128.81", "dismissal": "c Rabada b Jansen" },
              { "name": "Axar Patel", "runs": 47, "balls": 31, "fours": 1, "sixes": 4, "strikeRate": "151.61", "dismissal": "run out (de Kock)" }
            ],
            "topBowlers": [
              { "name": "Anrich Nortje", "overs": "4.0", "maidens": 0, "runs": 26, "wickets": 2, "economy": "6.50" },
              { "name": "Keshav Maharaj", "overs": "3.0", "maidens": 0, "runs": 23, "wickets": 2, "economy": "7.67" }
            ]
          },
          {
            "teamName": "South Africa",
            "runs": 169,
            "wickets": 8,
            "overs": "20.0",
            "runRate": "8.45",
            "topBatters": [
              { "name": "Heinrich Klaasen", "runs": 52, "balls": 27, "fours": 2, "sixes": 5, "strikeRate": "192.59", "dismissal": "c Pant b Hardik Pandya" },
              { "name": "Quinton de Kock", "runs": 39, "balls": 31, "fours": 4, "sixes": 1, "strikeRate": "125.80", "dismissal": "c Kuldeep b Arshdeep Singh" }
            ],
            "topBowlers": [
              { "name": "Hardik Pandya", "overs": "3.0", "maidens": 0, "runs": 20, "wickets": 3, "economy": "6.67" },
              { "name": "Jasprit Bumrah", "overs": "4.0", "maidens": 0, "runs": 18, "wickets": 2, "economy": "4.50" }
            ]
          }
        ],
        "sourceUrl": "https://www.icc-cricket.com/matches/final-ind-vs-sa-2024",
        "sourceName": "ICC Official",
        "retrievalTimestamp": 1719688000000
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw, { threadId: "thread-cricket-1" });
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();
    expect(res.structured?.components.length).toBe(1);

    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("match_scorecard");
    expect(comp?.data.sport).toBe("cricket");
    expect(comp?.data.teams[0].score).toBe("176/7 (20.0)");
    expect(comp?.data.innings[0].topBatters[0].name).toBe("Virat Kohli");
    expect(comp?.data.sourceUrl).toBe("https://www.icc-cricket.com/matches/final-ind-vs-sa-2024");

    // Verify context was recorded for thread
    const ctx = getSportsContext("thread-cricket-1");
    expect(ctx).toBeDefined();
    expect(ctx?.competition).toBe("ICC Men's T20 World Cup 2024");
    expect(ctx?.teams).toContain("India");
    expect(ctx?.teams).toContain("South Africa");
    expect(ctx?.playerStatsCache["viratkohli"].runs).toBe(76);
  });

  it("Scenario 2: Football Match Scorecard (Goals, Minutes, Possession, Match Stats, Source Attribution)", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "match-epl-derby",
      "type": "match_scorecard",
      "data": {
        "sport": "football",
        "competition": "Premier League",
        "fixtureTitle": "Arsenal vs Chelsea",
        "status": "finished",
        "statusDetail": "Full Time",
        "date": "March 15, 2026",
        "venue": "Emirates Stadium, London",
        "teams": [
          { "name": "Arsenal", "shortName": "ARS", "score": "3", "isWinner": true, "color": "#EF0107" },
          { "name": "Chelsea", "shortName": "CHE", "score": "1", "isWinner": false, "color": "#034694" }
        ],
        "events": [
          { "type": "goal", "minute": "18'", "teamName": "Arsenal", "playerName": "Martin Odegaard", "assistPlayerName": "Bukayo Saka" },
          { "type": "goal", "minute": "31'", "teamName": "Arsenal", "playerName": "Martin Odegaard", "assistPlayerName": "Declan Rice" },
          { "type": "goal", "minute": "65'", "teamName": "Chelsea", "playerName": "Noni Madueke" },
          { "type": "goal", "minute": "84'", "teamName": "Arsenal", "playerName": "Gabriel Jesus" }
        ],
        "stats": [
          { "label": "Possession", "homeValue": "58%", "awayValue": "42%" },
          { "label": "Shots (on target)", "homeValue": "14 (7)", "awayValue": "8 (3)" },
          { "label": "Corners", "homeValue": "6", "awayValue": "2" },
          { "label": "Fouls", "homeValue": "9", "awayValue": "13" }
        ],
        "sourceUrl": "https://www.premierleague.com/match/12345",
        "sourceName": "Premier League Official",
        "retrievalTimestamp": 1773590000000
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw, { threadId: "thread-football-1" });
    expect(res.cleanText).toBe("");
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("match_scorecard");
    expect(comp?.data.sport).toBe("football");
    expect(comp?.data.events.length).toBe(4);
    expect(comp?.data.stats.length).toBe(4);
    expect(comp?.data.teams[0].score).toBe("3");
  });

  it("Scenario 3: Player Statistics strictly tied to resolved fixture", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "player-sanju",
      "type": "player_stats",
      "data": {
        "playerName": "Sanju Samson",
        "sport": "cricket",
        "teamName": "India",
        "opponentName": "South Africa",
        "competition": "India tour of South Africa 2024",
        "fixtureTitle": "1st T20I: South Africa vs India",
        "fixtureDate": "November 08, 2024",
        "role": "Wicketkeeper-Batter",
        "headlineStat": "107 (50)",
        "headlineLabel": "Player of the Match",
        "stats": [
          { "label": "Runs", "value": 107, "highlight": true },
          { "label": "Balls", "value": 50 },
          { "label": "4s", "value": 7 },
          { "label": "6s", "value": 10, "highlight": true },
          { "label": "Strike Rate", "value": "214.00" },
          { "label": "Catches", "value": 1 }
        ],
        "sourceUrl": "https://www.bcci.tv/match/ind-sa-1st-t20i-2024",
        "sourceName": "BCCI Official",
        "retrievalTimestamp": 1731080000000
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw, { threadId: "thread-samson-1" });
    expect(res.cleanText).toBe("");
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("player_stats");
    expect(comp?.data.playerName).toBe("Sanju Samson");
    expect(comp?.data.headlineStat).toBe("107 (50)");
    expect(comp?.data.stats.find((s: any) => s.label === "4s")?.value).toBe(7);
    expect(comp?.data.stats.find((s: any) => s.label === "6s")?.value).toBe(10);

    // Verify context was stored
    const ctx = getSportsContext("thread-samson-1");
    expect(ctx?.playerStatsCache["sanjusamson"].fours).toBe(7);
    expect(ctx?.playerStatsCache["sanjusamson"].sixes).toBe(10);
  });

  it("Scenario 4: Follow-up query resolution preserving active fixture without context switching", () => {
    // Thread already has Samson context from Scenario 3
    const resolutionFours = resolveFollowUpQuery("thread-samson-1", "How many fours did Sanju Samson hit in that match?");
    expect(resolutionFours.isFollowUp).toBe(true);
    expect(resolutionFours.matchedPlayer).toBe("Sanju Samson");
    expect(resolutionFours.requestedMetric).toBe("fours");
    expect(resolutionFours.resolvedValue).toBe(7);
    expect(resolutionFours.answerSummary).toContain("Sanju Samson hit 7 fours");

    const resolutionSixes = resolveFollowUpQuery("thread-samson-1", "And how many sixes did Samson hit?");
    expect(resolutionSixes.isFollowUp).toBe(true);
    expect(resolutionSixes.requestedMetric).toBe("sixes");
    expect(resolutionSixes.resolvedValue).toBe(10);
    expect(resolutionSixes.answerSummary).toContain("Sanju Samson hit 10 sixes");
  });

  it("Scenario 5: League Standings Table (Rank, P, W, D, L, GD/NRR, PTS, Qualification Zones)", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "epl-table-2026",
      "type": "standings_table",
      "data": {
        "competition": "Premier League 2025/26",
        "season": "2025/26",
        "columns": ["Pos", "Team", "P", "W", "D", "L", "GD", "PTS"],
        "rows": [
          { "rank": 1, "teamName": "Arsenal", "played": 28, "won": 21, "drawn": 4, "lost": 3, "diff": "+42", "points": 67, "qualificationZone": "champions_league", "form": ["W", "W", "D", "W", "W"] },
          { "rank": 2, "teamName": "Manchester City", "played": 28, "won": 20, "drawn": 5, "lost": 3, "diff": "+38", "points": 65, "qualificationZone": "champions_league", "form": ["W", "D", "W", "W", "L"] },
          { "rank": 3, "teamName": "Liverpool", "played": 28, "won": 19, "drawn": 6, "lost": 3, "diff": "+35", "points": 63, "qualificationZone": "champions_league", "form": ["D", "W", "W", "W", "W"] },
          { "rank": 4, "teamName": "Chelsea", "played": 28, "won": 15, "drawn": 6, "lost": 7, "diff": "+18", "points": 51, "qualificationZone": "champions_league", "form": ["L", "W", "D", "W", "D"] },
          { "rank": 5, "teamName": "Tottenham", "played": 28, "won": 14, "drawn": 6, "lost": 8, "diff": "+12", "points": 48, "qualificationZone": "europa_league", "form": ["W", "L", "W", "D", "L"] },
          { "rank": 18, "teamName": "Everton", "played": 28, "won": 6, "drawn": 7, "lost": 15, "diff": "-19", "points": 25, "qualificationZone": "relegation", "form": ["L", "L", "D", "L", "W"] }
        ],
        "qualificationLegend": [
          { "zone": "champions_league", "label": "Champions League (Top 4)", "color": "#58A6FF" },
          { "zone": "europa_league", "label": "Europa League (5th)", "color": "#F0883E" },
          { "zone": "relegation", "label": "Relegation Zone", "color": "#F85149" }
        ],
        "sourceUrl": "https://www.premierleague.com/tables",
        "sourceName": "Premier League",
        "retrievalTimestamp": 1773595000000
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("");
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("standings_table");
    expect(comp?.data.rows.length).toBe(6);
    expect(comp?.data.rows[0].teamName).toBe("Arsenal");
    expect(comp?.data.rows[0].points).toBe(67);
    expect(comp?.data.qualificationLegend.length).toBe(3);
  });

  it("Scenario 6: Olympic & Multi-Sport Medal Tallies (Gold/Silver/Bronze/Total, Freshness & Ranking Rule)", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "paris-medals",
      "type": "medal_tally",
      "data": {
        "competition": "Paris 2024 Olympic Games",
        "year": 2024,
        "rankingMethod": "gold_first",
        "rankingMethodLabel": "Ranked by Gold medals first (IOC official rule)",
        "freshness": "Final Standings",
        "rows": [
          { "rank": 1, "nation": "United States", "nocCode": "USA", "gold": 40, "silver": 44, "bronze": 42, "total": 126 },
          { "rank": 2, "nation": "China", "nocCode": "CHN", "gold": 40, "silver": 27, "bronze": 24, "total": 91 },
          { "rank": 3, "nation": "Japan", "nocCode": "JPN", "gold": 20, "silver": 12, "bronze": 13, "total": 45 },
          { "rank": 4, "nation": "Australia", "nocCode": "AUS", "gold": 18, "silver": 19, "bronze": 16, "total": 53 },
          { "rank": 5, "nation": "France", "nocCode": "FRA", "gold": 16, "silver": 26, "bronze": 22, "total": 64 }
        ],
        "sourceUrl": "https://olympics.com/en/paris-2024/medals",
        "sourceName": "International Olympic Committee",
        "retrievalTimestamp": 1723420800000
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("");
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("medal_tally");
    expect(comp?.data.rankingMethod).toBe("gold_first");
    expect(comp?.data.rows[0].gold).toBe(40);
    expect(comp?.data.rows[0].silver).toBe(44);
    expect(comp?.data.rows[0].total).toBe(126);
    expect(comp?.data.rows[1].gold).toBe(40);
    expect(comp?.data.rows[1].total).toBe(91);
  });

  it("Scenario 7: Extensible Generic Data Cards (Metrics, Key-Value Rows, Sections)", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "generic-financials",
      "type": "data_card",
      "data": {
        "title": "Alphabet Q4 Earnings Breakdown",
        "subtitle": "Financial highlights and business segment review",
        "badge": "Audited",
        "badgeType": "success",
        "metrics": [
          { "label": "Revenue", "value": "$96.5B", "change": "+15.2%", "trend": "up" },
          { "label": "Operating Income", "value": "$31.8B", "change": "+30.4%", "trend": "up" },
          { "label": "EPS", "value": "$2.15", "change": "+31%", "trend": "up" }
        ],
        "rows": [
          { "key": "Google Services", "value": "$82.1B", "subtext": "Search, YouTube, Ads" },
          { "key": "Google Cloud", "value": "$11.4B", "subtext": "+35% YoY growth" },
          { "key": "Capital Expenditures", "value": "$13.1B", "subtext": "Technical infrastructure" }
        ],
        "sections": [
          { "heading": "Guidance Summary", "content": "Management anticipates continued momentum in AI-driven cloud infrastructure and enterprise subscriptions." }
        ],
        "sourceUrl": "https://abc.xyz/investor/earnings/q4-2025/",
        "sourceName": "Alphabet IR"
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("");
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("data_card");
    expect(comp?.data.metrics.length).toBe(3);
    expect(comp?.data.rows.length).toBe(3);
    expect(comp?.data.sections.length).toBe(1);
    expect(comp?.data.badge).toBe("Audited");
  });

  it("Scenario 8: Autonomous synthesis for Markdown Standings tables", () => {
    const markdown = `
Here are the latest tournament standings:

### IPL 2024 Points Table
| Pos | Team | P | W | L | NRR | PTS |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Kolkata Knight Riders | 14 | 9 | 3 | +1.428 | 20 |
| 2 | Sunrisers Hyderabad | 14 | 8 | 5 | +0.414 | 17 |
| 3 | Rajasthan Royals | 14 | 8 | 5 | +0.273 | 17 |
| 4 | Royal Challengers Bengaluru | 14 | 7 | 7 | +0.459 | 14 |

The top 4 teams qualified for the playoffs.
`;
    const res = extractStructuredContent(markdown);
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();

    const comp = res.structured?.components.find((c) => c.type === "standings_table");
    expect(comp).toBeDefined();
    expect(comp?.data.competition).toBe("IPL 2024 Points Table");
    expect(comp?.data.rows.length).toBe(4);
    expect(comp?.data.rows[0].teamName).toBe("Kolkata Knight Riders");
    expect(comp?.data.rows[0].points).toBe(20);
    expect(comp?.data.rows[3].points).toBe(14);
  });

  it("Scenario 9: Autonomous synthesis for Markdown Medal Tallies", () => {
    const markdown = `
### Commonwealth Games 2026 Medal Tally
| Rank | Country | Gold | Silver | Bronze | Total |
| --- | --- | --- | --- | --- | --- |
| 1 | Australia | 67 | 57 | 54 | 178 |
| 2 | England | 57 | 66 | 53 | 176 |
| 3 | Canada | 26 | 32 | 34 | 92 |
| 4 | India | 22 | 16 | 23 | 61 |

Official medal standings updated daily.
`;
    const res = extractStructuredContent(markdown);
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();

    const comp = res.structured?.components.find((c) => c.type === "medal_tally");
    expect(comp).toBeDefined();
    expect(comp?.data.competition).toBe("Commonwealth Games 2026 Medal Tally");
    expect(comp?.data.rows.length).toBe(4);
    expect(comp?.data.rows[0].nation).toBe("Australia");
    expect(comp?.data.rows[0].gold).toBe(67);
    expect(comp?.data.rows[3].nation).toBe("India");
    expect(comp?.data.rows[3].gold).toBe(22);
  });

  it("Scenario 10: Missing sources handled without fabrication or guessing", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "match-no-source",
      "type": "match_scorecard",
      "data": {
        "sport": "cricket",
        "competition": "Local League",
        "fixtureTitle": "North vs South",
        "status": "live",
        "teams": [
          { "name": "North", "score": "120/3 (15.2)" },
          { "name": "South", "score": "Yet to bat" }
        ]
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    const comp = res.structured?.components[0];
    expect(comp?.data.sourceUrl).toBeUndefined();
    expect(comp?.data.sourceName).toBeUndefined();
    expect(comp?.data.status).toBe("live");
    // Verify fallback does not invent a source
    const fallback = structuredResponseToFallbackText(res.structured!);
    expect(fallback).not.toContain("Source:");
  });

  it("Scenario 11: Malformed payloads degrade gracefully without throwing", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "bad-card",
      "type": "unknown_future_card",
      "data": { "foo": "bar" }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("card"); // degrades gracefully to semantic card
  });

  it("Scenario 12: Context manager isolation between multiple threads", () => {
    clearSportsContext("thread-a");
    clearSportsContext("thread-b");

    recordSportsContext("thread-a", {
      competition: "La Liga",
      fixtureTitle: "Real Madrid vs Barcelona",
      teams: ["Real Madrid", "Barcelona"],
      playerStatsCache: {
        vinicius: { playerName: "Vinicius Jr", goals: 2 },
      },
    });

    recordSportsContext("thread-b", {
      competition: "Serie A",
      fixtureTitle: "Inter vs Milan",
      teams: ["Inter", "Milan"],
      playerStatsCache: {
        martinez: { playerName: "Lautaro Martinez", goals: 1 },
      },
    });

    const resA = resolveFollowUpQuery("thread-a", "How many goals did Vinicius score?");
    expect(resA.isFollowUp).toBe(true);
    expect(resA.matchedPlayer).toBe("Vinicius Jr");
    expect(resA.resolvedValue).toBe(2);

    const resB = resolveFollowUpQuery("thread-b", "How many goals did Lautaro score?");
    expect(resB.isFollowUp).toBe(true);
    expect(resB.matchedPlayer).toBe("Lautaro Martinez");
    expect(resB.resolvedValue).toBe(1);

    // Thread A should NOT find Lautaro
    const resACross = resolveFollowUpQuery("thread-a", "How many goals did Lautaro score?");
    expect(resACross.matchedPlayer).toBeUndefined();
  });

  it("Scenario 13: IPL Standings without explicit Pos column and with long team names", () => {
    const markdown = `### IPL 2024 Points Table

| Team | Pld | Won | Lost | Tied | N/R | Net RR | Pts |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Kolkata Knight Riders | 14 | 9 | 3 | 0 | 2 | +1.428 | 20 |
| Sunrisers Hyderabad | 14 | 8 | 5 | 0 | 1 | +0.414 | 17 |
| Rajasthan Royals | 14 | 8 | 5 | 0 | 1 | +0.273 | 17 |
| Royal Challengers Bengaluru | 14 | 7 | 7 | 0 | 0 | +0.459 | 14 |
| Chennai Super Kings | 14 | 7 | 7 | 0 | 0 | +0.415 | 14 |
| Delhi Capitals | 14 | 7 | 7 | 0 | 0 | -0.377 | 14 |
| Lucknow Super Giants | 14 | 7 | 7 | 0 | 0 | -0.667 | 14 |
| Gujarat Titans | 14 | 5 | 7 | 0 | 2 | -1.063 | 12 |
| Punjab Kings | 14 | 5 | 9 | 0 | 0 | -0.356 | 10 |
| Mumbai Indians | 14 | 4 | 10 | 0 | 0 | -0.271 | 8 |

Source: [IPL Official](https://www.iplt20.com/points-table/men/2024)
`;

    const res = extractStructuredContent(markdown);
    expect(res.structured).toBeDefined();
    const tableComp = res.structured!.components.find((c) => c.type === "standings_table");
    expect(tableComp).toBeDefined();
    const data = tableComp!.data as StandingsTableComponentData;
    expect(data.competition).toBe("IPL 2024 Points Table");
    expect(data.rows.length).toBe(10);
    // Rank 1
    expect(data.rows[0]!.rank).toBe(1);
    expect(data.rows[0]!.teamName).toBe("Kolkata Knight Riders");
    expect(data.rows[0]!.points).toBe(20);
    expect(data.rows[0]!.diff).toBe("+1.428");
    expect(data.rows[0]!.qualificationZone).toBe("champions_league");
    // Rank 4 - Royal Challengers Bengaluru preserved without clipping
    expect(data.rows[3]!.rank).toBe(4);
    expect(data.rows[3]!.teamName).toBe("Royal Challengers Bengaluru");
    expect(data.rows[3]!.points).toBe(14);
    expect(data.rows[3]!.diff).toBe("+0.459");
    expect(data.rows[3]!.qualificationZone).toBe("champions_league");
    // Provenance
    expect(data.sourceUrl).toBe("https://www.iplt20.com/points-table/men/2024");
    expect(data.sourceName).toBe("IPL Official");
  });

  it("Scenario 14: Standings table without outer markdown pipes synthesizes cleanly", () => {
    const markdown = `Premier League Standings

Pos | Team | P | W | D | L | GD | PTS
---|---|---|---|---|---|---|---
1 | Arsenal | 28 | 20 | 4 | 4 | +45 | 64
2 | Liverpool | 28 | 19 | 7 | 2 | +39 | 64
3 | Manchester City | 28 | 19 | 6 | 3 | +35 | 63
`;

    const res = extractStructuredContent(markdown);
    expect(res.structured).toBeDefined();
    const tableComp = res.structured!.components.find((c) => c.type === "standings_table");
    expect(tableComp).toBeDefined();
    const data = tableComp!.data as StandingsTableComponentData;
    expect(data.rows.length).toBe(3);
    expect(data.rows[0]!.teamName).toBe("Arsenal");
    expect(data.rows[0]!.points).toBe(64);
  });

  it("Scenario 15: Markdown football match scoreline synthesizes to match_scorecard", () => {
    const markdown = `### Premier League Matchday 30
**Arsenal 3 - 1 Chelsea**
Arsenal dominated the London derby at Emirates Stadium.
Source: https://www.premierleague.com/match/12345
`;

    const res = extractStructuredContent(markdown);
    expect(res.structured).toBeDefined();
    const scorecardComp = res.structured!.components.find((c) => c.type === "match_scorecard");
    expect(scorecardComp).toBeDefined();
    const data = scorecardComp!.data as MatchScorecardComponentData;
    expect(data.sport).toBe("football");
    expect(data.fixtureTitle).toBe("Arsenal vs Chelsea");
    expect(data.teams[0]!.name).toBe("Arsenal");
    expect(data.teams[0]!.score).toBe("3");
    expect(data.teams[0]!.isWinner).toBe(true);
    expect(data.teams[1]!.name).toBe("Chelsea");
    expect(data.teams[1]!.score).toBe("1");
    expect(data.teams[1]!.isWinner).toBe(false);
  });

  it("Scenario 16: User exact IPL 2025 table with Pos, Team, Points and surrounding prose", () => {
    const userOutput = `Assuming “last year” means **IPL 2025**, the final league-stage table was:

| Pos. | Team | Points |
|---:|---|---:|
| 1 | Punjab Kings | 19 |
| 2 | Royal Challengers Bengaluru | 19 |
| 3 | Gujarat Titans | 18 |
| 4 | Mumbai Indians | 16 |
| 5 | Delhi Capitals | 15 |
| 6 | Sunrisers Hyderabad | 12 |
| 7 | Lucknow Super Giants | 12 |
| 8 | Kolkata Knight Riders | 12 |
| 9 | Rajasthan Royals | 8 |
| 10 | Chennai Super Kings | 8 |

Punjab Kings finished first on net run rate, ahead of RCB.`;

    const res = extractStructuredContent(userOutput);
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();
    expect(res.structured!.components.length).toBe(2);

    // Prose preserved as text component
    const textComp = res.structured!.components[0]!;
    expect(textComp.type).toBe("text");
    expect(textComp.data.text).toContain("Assuming “last year” means **IPL 2025**");
    expect(textComp.data.text).toContain("Punjab Kings finished first on net run rate");

    // Standings table component
    const standingsComp = res.structured!.components[1]!;
    expect(standingsComp.type).toBe("standings_table");
    const data = standingsComp.data as StandingsTableComponentData;
    expect(data.competition).toBe("IPL 2025 Points Table");
    expect(data.season).toBe("2025");
    expect(data.rows.length).toBe(10);
    expect(data.rows[0]!.teamName).toBe("Punjab Kings");
    expect(data.rows[0]!.points).toBe(19);
    expect(data.rows[0]!.qualificationZone).toBe("champions_league");
    // Royal Challengers Bengaluru long name preserved
    expect(data.rows[1]!.teamName).toBe("Royal Challengers Bengaluru");
    expect(data.rows[1]!.rank).toBe(2);
    expect(data.rows[1]!.points).toBe(19);
    expect(data.rows[1]!.qualificationZone).toBe("champions_league");
    expect(data.sourceUrl).toBe("https://www.iplt20.com/points-table/men/2025");
  });

  it("Scenario 17: Table with only Pos and Team in standings context synthesizes to standings_table", () => {
    const raw = `Here are the top teams in the tournament standings:

| Pos | Team |
| 1 | Mumbai Indians |
| 2 | Chennai Super Kings |
| 3 | Kolkata Knight Riders |
| 4 | Royal Challengers Bengaluru |
`;

    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const tableComp = res.structured!.components.find((c) => c.type === "standings_table");
    expect(tableComp).toBeDefined();
    const data = tableComp!.data as StandingsTableComponentData;
    expect(data.rows.length).toBe(4);
    expect(data.rows[3]!.teamName).toBe("Royal Challengers Bengaluru");
    expect(data.rows[3]!.rank).toBe(4);
  });

  it("Scenario 18: Flat structured component (without 'data' wrapper) normalizes and validates cleanly", () => {
    const raw = `Assuming “last year” means **IPL 2025**, here is the final league-stage table.

\`\`\`structured
{
 "version": 1,
 "components": [
 {
 "type": "standings_table",
 "competition": "Indian Premier League",
 "season": "2025",
 "columns": ["Rank", "Team", "Played", "Won", "Lost", "Points"],
 "rows": [
 {"rank": 1, "teamName": "Punjab Kings", "played": 14, "won": 9, "lost": 4, "points": 19},
 {"rank": 2, "teamName": "Royal Challengers Bengaluru", "played": 14, "won": 9, "lost": 4, "points": 19}
 ],
 "sourceName": "IPL Official",
 "sourceUrl": "https://www.iplt20.com"
 }
 ]
}
\`\`\`
`;

    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    expect(res.structured!.components.length).toBe(2); // text + standings_table
    const tableComp = res.structured!.components.find((c) => c.type === "standings_table");
    expect(tableComp).toBeDefined();
    const data = tableComp!.data as StandingsTableComponentData;
    expect(data.competition).toBe("Indian Premier League");
    expect(data.season).toBe("2025");
    expect(data.rows.length).toBe(2);
    expect(data.rows[1]!.teamName).toBe("Royal Challengers Bengaluru");
  });

  it("Scenario 19: Unfenced raw structured JSON emitted directly by model extracts cleanly", () => {
    const raw = `{
  "version": 1,
  "components": [
    {
      "type": "standings_table",
      "data": {
        "competition": "Premier League 2024/25",
        "season": "2024/25",
        "rows": [
          { "rank": 1, "teamName": "Arsenal", "points": 89 },
          { "rank": 2, "teamName": "Manchester City", "points": 88 }
        ]
      }
    }
  ]
}`;

    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const tableComp = res.structured!.components.find((c) => c.type === "standings_table");
    expect(tableComp).toBeDefined();
    const data = tableComp!.data as StandingsTableComponentData;
    expect(data.competition).toBe("Premier League 2024/25");
    expect(data.rows.length).toBe(2);
  });

  it("Scenario 20: ```json fenced structured response extracts into structured data", () => {
    const raw = `Here is the medal tally:

\`\`\`json
{
  "version": 1,
  "components": [
    {
      "type": "medal_tally",
      "data": {
        "competition": "Paris 2024 Olympic Games",
        "rankingMethod": "gold_first",
        "rows": [
          { "rank": 1, "nation": "United States", "gold": 40, "silver": 44, "bronze": 42, "total": 126 },
          { "rank": 2, "nation": "China", "gold": 40, "silver": 27, "bronze": 24, "total": 91 }
        ]
      }
    }
  ]
}
\`\`\`
`;

    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const medalComp = res.structured!.components.find((c) => c.type === "medal_tally");
    expect(medalComp).toBeDefined();
  });

  it("Scenario 21: Tennis match scorecard with sets, seed, and statusLabel", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "tennis-wimbledon-final",
      "type": "match_scorecard",
      "data": {
        "sport": "tennis",
        "competition": "Wimbledon 2024",
        "fixtureTitle": "Men's Singles Final",
        "status": "completed",
        "statusLabel": "FINAL",
        "statusDetail": "Carlos Alcaraz won in straight sets",
        "outcomeHeadline": "Carlos Alcaraz won in straight sets (6-2, 6-2, 7-6)",
        "venue": "Centre Court, London",
        "teams": [
          { "name": "Carlos Alcaraz", "shortName": "ESP", "seed": "3", "score": "6 6 7(7)", "isWinner": true, "sets": ["6", "6", "7(7)"] },
          { "name": "Novak Djokovic", "shortName": "SRB", "seed": "2", "score": "2 2 6(4)", "isWinner": false, "sets": ["2", "2", "6(4)"] }
        ],
        "sourceUrl": "https://www.wimbledon.com/en_GB/scores/results/day14.html",
        "sourceName": "Wimbledon Official"
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("match_scorecard");
    expect(comp?.data.sport).toBe("tennis");
    expect(comp?.data.teams[0].sets).toEqual(["6", "6", "7(7)"]);
    expect(comp?.data.teams[0].seed).toBe("3");
    expect(comp?.data.statusLabel).toBe("FINAL");
  });

  it("Scenario 22: Phone Task Execution card with lifecycle stages and screenshot preview", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "task-cricinfo-capture",
      "type": "task_execution",
      "data": {
        "title": "Capture Cricket Match on ESPN Cricinfo",
        "deviceName": "Samsung Galaxy A07",
        "status": "completed",
        "statusLabel": "Completed",
        "stages": [
          { "name": "Launch ESPN Cricinfo", "timestamp": "10:14:02", "completed": true },
          { "name": "Navigate to India vs SA match", "timestamp": "10:14:05", "completed": true },
          { "name": "Capture screen", "timestamp": "10:14:08", "completed": true },
          { "name": "Deliver image to chat", "timestamp": "10:14:09", "completed": true }
        ],
        "screenshotUrl": "https://example.com/cricinfo_screen.png",
        "durationSeconds": 7.4
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("task_execution");
    expect(comp?.data.title).toBe("Capture Cricket Match on ESPN Cricinfo");
    expect(comp?.data.stages.length).toBe(4);
    expect(comp?.data.stages[0].name).toBe("Launch ESPN Cricinfo");
    expect(comp?.data.status).toBe("completed");
  });

  it("Scenario 23: Sourced match status inference without defaulting to FINAL", () => {
    const liveText = `### ICC Men's T20 World Cup
**India vs Pakistan**
- India: 140/3 (15.2 ov)
- Pakistan: 0/0
Match in progress (Live on Star Sports)
Source: [ESPNcricinfo](https://www.espncricinfo.com)`;

    const liveRes = extractStructuredContent(liveText);
    expect(liveRes.structured).toBeDefined();
    const liveComp = liveRes.structured?.components.find((c) => c.type === "match_scorecard");
    expect(liveComp).toBeDefined();
    expect(liveComp?.data.status).toBe("live");
    expect(liveComp?.data.statusLabel).toBe("LIVE");

    const delayedText = `### Premier League
**Arsenal 0 - 0 Chelsea**
Match delayed due to severe rain
Source: [Premier League](https://www.premierleague.com)`;

    const delayedRes = extractStructuredContent(delayedText);
    expect(delayedRes.structured).toBeDefined();
    const delayedComp = delayedRes.structured?.components.find((c) => c.type === "match_scorecard");
    expect(delayedComp).toBeDefined();
    expect(delayedComp?.data.status).toBe("delayed");
    expect(delayedComp?.data.statusLabel).toBe("DELAYED");
  });

  it("Scenario 24: Player stats card with highlights bullets and avatarUrl", () => {
    const raw = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "player-virat-kohli",
      "type": "player_stats",
      "data": {
        "playerName": "Virat Kohli",
        "sport": "cricket",
        "teamName": "Royal Challengers Bengaluru",
        "competition": "IPL 2024",
        "role": "Top-order Batter",
        "headlineStat": "741",
        "headlineLabel": "Season Total Runs",
        "stats": [
          { "label": "Runs", "value": "741", "highlight": true },
          { "label": "Inns", "value": "15" },
          { "label": "Avg", "value": "61.75" },
          { "label": "SR", "value": "154.69" },
          { "label": "100s/50s", "value": "1/5" }
        ],
        "highlights": [
          "Orange Cap winner for the 2024 season",
          "Highest individual score: 113* vs RR",
          "8 sixes in a single innings against PBKS"
        ],
        "actionLabel": "Full Scorecard",
        "sourceUrl": "https://www.iplt20.com/stats/2024",
        "sourceName": "IPL T20 Official"
      }
    }
  ]
}
\`\`\`
`;
    const res = extractStructuredContent(raw);
    expect(res.structured).toBeDefined();
    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("player_stats");
    expect(comp?.data.highlights.length).toBe(3);
    expect(comp?.data.highlights[0]).toContain("Orange Cap");
    expect(comp?.data.actionLabel).toBe("Full Scorecard");
  });
});

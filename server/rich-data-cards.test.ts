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
});

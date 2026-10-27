import type {
  MatchScorecardComponentData,
  PlayerStatsComponentData,
} from "../shared/structured-response.ts";

export interface CachedPlayerPerformance {
  playerName: string;
  teamName?: string;
  role?: string;
  runs?: number;
  balls?: number;
  fours?: number;
  sixes?: number;
  strikeRate?: number | string;
  dismissal?: string;
  overs?: number | string;
  maidens?: number;
  bowlingRuns?: number;
  wickets?: number;
  economy?: number | string;
  goals?: number;
  assists?: number;
  rawStats?: Record<string, string | number>;
}

export interface ActiveFixtureContext {
  threadId: string;
  fixtureId: string;
  sport: "cricket" | "football" | "generic";
  competition: string;
  fixtureTitle: string;
  teams: string[];
  date?: string;
  venue?: string;
  status: string;
  statusDetail?: string;
  playerStatsCache: Record<string, CachedPlayerPerformance>;
  sourceUrl?: string;
  sourceName?: string;
  updatedAt: number;
}

export interface FollowUpResolution {
  isFollowUp: boolean;
  context?: ActiveFixtureContext;
  matchedPlayer?: string;
  playerStats?: CachedPlayerPerformance;
  requestedMetric?: string;
  resolvedValue?: string | number;
  answerSummary?: string;
}

const activeContexts = new Map<string, ActiveFixtureContext>();

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function generateFixtureId(competition: string, fixtureTitle: string): string {
  return `${competition}-${fixtureTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Records or updates the active sports fixture context for a thread.
 */
export function recordSportsContext(
  threadId: string,
  context: Partial<ActiveFixtureContext> & { competition: string; fixtureTitle: string }
): ActiveFixtureContext {
  const existing = activeContexts.get(threadId);
  const fixtureId = context.fixtureId || existing?.fixtureId || generateFixtureId(context.competition, context.fixtureTitle);

  const updated: ActiveFixtureContext = {
    threadId,
    fixtureId,
    sport: context.sport || existing?.sport || "generic",
    competition: context.competition || existing?.competition || "",
    fixtureTitle: context.fixtureTitle || existing?.fixtureTitle || "",
    teams: context.teams || existing?.teams || [],
    date: context.date || existing?.date,
    venue: context.venue || existing?.venue,
    status: context.status || existing?.status || "finished",
    statusDetail: context.statusDetail || existing?.statusDetail,
    playerStatsCache: {
      ...existing?.playerStatsCache,
      ...context.playerStatsCache,
    },
    sourceUrl: context.sourceUrl || existing?.sourceUrl,
    sourceName: context.sourceName || existing?.sourceName,
    updatedAt: Date.now(),
  };

  activeContexts.set(threadId, updated);
  return updated;
}

/**
 * Extracts and records fixture context from a parsed MatchScorecardComponentData.
 */
export function recordScorecardContext(
  threadId: string,
  scorecard: MatchScorecardComponentData
): ActiveFixtureContext {
  const teams = scorecard.teams.map((t) => t.name);
  const playerStatsCache: Record<string, CachedPlayerPerformance> = {};

  if (scorecard.innings) {
    for (const inn of scorecard.innings) {
      if (inn.topBatters) {
        for (const b of inn.topBatters) {
          const key = normalizeName(b.name);
          playerStatsCache[key] = {
            playerName: b.name,
            teamName: inn.teamName,
            runs: b.runs,
            balls: b.balls,
            fours: b.fours,
            sixes: b.sixes,
            strikeRate: b.strikeRate,
            dismissal: b.dismissal,
          };
        }
      }
      if (inn.topBowlers) {
        for (const bw of inn.topBowlers) {
          const key = normalizeName(bw.name);
          const existing = playerStatsCache[key] || { playerName: bw.name };
          playerStatsCache[key] = {
            ...existing,
            playerName: bw.name,
            overs: bw.overs,
            maidens: bw.maidens,
            bowlingRuns: bw.runs,
            wickets: bw.wickets,
            economy: bw.economy,
          };
        }
      }
    }
  }

  if (scorecard.events) {
    for (const ev of scorecard.events) {
      if (ev.type === "goal" && ev.playerName) {
        const key = normalizeName(ev.playerName);
        const existing = playerStatsCache[key] || { playerName: ev.playerName, teamName: ev.teamName, goals: 0 };
        existing.goals = (existing.goals || 0) + 1;
        playerStatsCache[key] = existing;
      }
    }
  }

  return recordSportsContext(threadId, {
    sport: scorecard.sport,
    competition: scorecard.competition,
    fixtureTitle: scorecard.fixtureTitle,
    teams,
    date: scorecard.date,
    venue: scorecard.venue,
    status: scorecard.status,
    statusDetail: scorecard.statusDetail,
    playerStatsCache,
    sourceUrl: scorecard.sourceUrl,
    sourceName: scorecard.sourceName,
  });
}

/**
 * Records player statistics from PlayerStatsComponentData into the active context.
 */
export function recordPlayerStatsContext(
  threadId: string,
  playerStats: PlayerStatsComponentData
): ActiveFixtureContext {
  const key = normalizeName(playerStats.playerName);
  const rawStats: Record<string, string | number> = {};
  let runs: number | undefined;
  let balls: number | undefined;
  let fours: number | undefined;
  let sixes: number | undefined;
  let strikeRate: string | number | undefined;
  let wickets: number | undefined;
  let overs: string | number | undefined;
  let economy: string | number | undefined;
  let goals: number | undefined;
  let assists: number | undefined;

  for (const s of playerStats.stats) {
    rawStats[s.label.toLowerCase()] = s.value;
    const l = s.label.toLowerCase();
    if (l === "runs" || l === "r") runs = Number(s.value);
    else if (l === "balls" || l === "b") balls = Number(s.value);
    else if (l === "4s" || l === "fours" || l === "4's") fours = Number(s.value);
    else if (l === "6s" || l === "sixes" || l === "6's") sixes = Number(s.value);
    else if (l.includes("strike rate") || l === "sr") strikeRate = s.value;
    else if (l === "wickets" || l === "w" || l === "wkts") wickets = Number(s.value);
    else if (l === "overs" || l === "o") overs = s.value;
    else if (l === "economy" || l === "econ") economy = s.value;
    else if (l === "goals") goals = Number(s.value);
    else if (l === "assists") assists = Number(s.value);
  }

  const performance: CachedPlayerPerformance = {
    playerName: playerStats.playerName,
    teamName: playerStats.teamName,
    role: playerStats.role,
    runs,
    balls,
    fours,
    sixes,
    strikeRate,
    wickets,
    overs,
    economy,
    goals,
    assists,
    rawStats,
  };

  const existing = activeContexts.get(threadId);
  const teams = existing?.teams && existing.teams.length > 0 ? existing.teams : [playerStats.teamName, playerStats.opponentName || ""].filter(Boolean);

  return recordSportsContext(threadId, {
    sport: playerStats.sport,
    competition: playerStats.competition || existing?.competition || "Sports Fixture",
    fixtureTitle: playerStats.fixtureTitle || existing?.fixtureTitle || `${playerStats.teamName} vs ${playerStats.opponentName || "Opponent"}`,
    teams,
    date: playerStats.fixtureDate || existing?.date,
    playerStatsCache: { [key]: performance },
    sourceUrl: playerStats.sourceUrl || existing?.sourceUrl,
    sourceName: playerStats.sourceName || existing?.sourceName,
  });
}

/**
 * Returns the active sports context for a thread, or undefined.
 */
export function getSportsContext(threadId: string): ActiveFixtureContext | undefined {
  return activeContexts.get(threadId);
}

/**
 * Clears the active sports context for a thread.
 */
export function clearSportsContext(threadId: string): void {
  activeContexts.delete(threadId);
}

/**
 * Resolves follow-up queries that reference the active fixture or specific players.
 * E.g.: "How many fours did Sanju Samson hit in that match?"
 */
export function resolveFollowUpQuery(
  threadId: string,
  userQuery: string
): FollowUpResolution {
  const context = activeContexts.get(threadId);
  if (!context) {
    return { isFollowUp: false };
  }

  const q = userQuery.toLowerCase();
  const followUpIndicators = [
    "that match",
    "this match",
    "that game",
    "this game",
    "in that innings",
    "in this innings",
    "how many",
    "what was the score",
    "who won",
    "who scored",
    "top scorer",
    "who bowled",
    "strike rate",
    "run rate",
  ];

  const hasIndicator = followUpIndicators.some((ind) => q.includes(ind));

  // Search for player name match in cached players
  let matchedPerformance: CachedPlayerPerformance | undefined;

  for (const [, perf] of Object.entries(context.playerStatsCache)) {
    const rawName = perf.playerName.toLowerCase();
    const parts = rawName.split(/\s+/).filter((p) => p.length >= 3);

    if (q.includes(rawName) || parts.some((p) => q.includes(p))) {
      matchedPerformance = perf;
      break;
    }
  }

  // If query uses pronouns ("he", "his", "him", "their") or asks about an innings stat
  // without explicitly naming an unknown player, resolve to the active player in cache!
  if (!matchedPerformance) {
    const cachedPlayers = Object.values(context.playerStatsCache);
    if (cachedPlayers.length > 0 && /\b(?:he|him|his|they|their|she|her)\b/i.test(q)) {
      matchedPerformance = cachedPlayers[0];
    } else if (cachedPlayers.length === 1) {
      const subjectMatch =
        q.match(/\b(?:did|by)\s+([a-z]{3,})\b/) ||
        q.match(/\b([a-z]{3,})'s\b/) ||
        q.match(/\b([a-z]{3,})\s+(?:scored?|hit|took|bowled|batted)\b/);
      if (!subjectMatch) {
        matchedPerformance = cachedPlayers[0];
      }
    }
  }

  if (!hasIndicator && !matchedPerformance) {
    return { isFollowUp: false, context };
  }

  let requestedMetric: string | undefined;
  let resolvedValue: string | number | undefined;
  let answerSummary: string | undefined;

  if (matchedPerformance) {
    if (/\b(?:fours?|4s?)\b/i.test(q)) {
      requestedMetric = "fours";
      resolvedValue = matchedPerformance.fours ?? matchedPerformance.rawStats?.["4s"];
      if (resolvedValue !== undefined) {
        answerSummary = `${matchedPerformance.playerName} hit ${resolvedValue} four${resolvedValue === 1 ? "" : "s"} in ${context.fixtureTitle}.`;
      }
    } else if (/\b(?:sixes?|6s?)\b/i.test(q)) {
      requestedMetric = "sixes";
      resolvedValue = matchedPerformance.sixes ?? matchedPerformance.rawStats?.["6s"];
      if (resolvedValue !== undefined) {
        answerSummary = `${matchedPerformance.playerName} hit ${resolvedValue} six${resolvedValue === 1 ? "" : "es"} in ${context.fixtureTitle}.`;
      }
    } else if (/\b(?:runs?)\b/i.test(q)) {
      requestedMetric = "runs";
      resolvedValue = matchedPerformance.runs ?? matchedPerformance.rawStats?.["runs"];
      if (resolvedValue !== undefined) {
        const ballsText = matchedPerformance.balls ? ` off ${matchedPerformance.balls} balls` : "";
        answerSummary = `${matchedPerformance.playerName} scored ${resolvedValue} runs${ballsText} in ${context.fixtureTitle}.`;
      }
    } else if (/\b(?:strike\s*rate|sr)\b/i.test(q)) {
      requestedMetric = "strikeRate";
      resolvedValue = matchedPerformance.strikeRate ?? matchedPerformance.rawStats?.["strike rate"];
      if (resolvedValue !== undefined) {
        answerSummary = `${matchedPerformance.playerName}'s strike rate was ${resolvedValue} in ${context.fixtureTitle}.`;
      }
    } else if (/\b(?:wickets?|wkts?)\b/i.test(q)) {
      requestedMetric = "wickets";
      resolvedValue = matchedPerformance.wickets ?? matchedPerformance.rawStats?.["wickets"];
      if (resolvedValue !== undefined) {
        const oversText = matchedPerformance.overs ? ` in ${matchedPerformance.overs} overs` : "";
        answerSummary = `${matchedPerformance.playerName} took ${resolvedValue} wicket${resolvedValue === 1 ? "" : "s"}${oversText} in ${context.fixtureTitle}.`;
      }
    } else if (/\b(?:goals?)\b/i.test(q)) {
      requestedMetric = "goals";
      resolvedValue = matchedPerformance.goals ?? matchedPerformance.rawStats?.["goals"];
      if (resolvedValue !== undefined) {
        answerSummary = `${matchedPerformance.playerName} scored ${resolvedValue} goal${resolvedValue === 1 ? "" : "s"} in ${context.fixtureTitle}.`;
      }
    }
  }

  return {
    isFollowUp: true,
    context,
    matchedPlayer: matchedPerformance?.playerName,
    playerStats: matchedPerformance,
    requestedMetric,
    resolvedValue,
    answerSummary,
  };
}

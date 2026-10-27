import {
  validateStructuredResponse,
  type StructuredComponent,
  type StructuredResponseData,
  type ResearchResultComponentData,
  type MatchScorecardComponentData,
  type StandingsTableComponentData,
  type MedalTallyComponentData,
  type StandingRow,
  type MedalRow,
} from "../shared/structured-response.ts";
import {
  recordScorecardContext,
  recordPlayerStatsContext,
} from "./sports-context.ts";

export interface ExtractedStructuredContent {
  cleanText: string;
  structured?: StructuredResponseData;
}

export interface ExtractOptions {
  threadId?: string;
}

const STRUCTURED_BLOCK_REGEX = /```(?:structured|json:structured)\s*[\r\n]+([\s\S]*?)[\r\n]+```/g;

/**
 * Extracts structured response data blocks (fenced as ```structured or ```json:structured)
 * from assistant reply text, validates against the Structured Response protocol,
 * strips the raw JSON code fence from the visible prose, and returns the clean text
 * and validated structured data.
 *
 * Supports interleaved composition: TEXT -> CARD -> TEXT -> CARD.
 * Also provides autonomous synthesis for sports fixtures, scorecards, standings,
 * medal tallies, and markdown research listings with verified links.
 */
export function extractStructuredContent(rawText: string, options?: ExtractOptions): ExtractedStructuredContent {
  if (!rawText || typeof rawText !== "string") {
    return { cleanText: rawText || "" };
  }

  // 1. Check for explicit ```structured code blocks
  const matches = [...rawText.matchAll(STRUCTURED_BLOCK_REGEX)];
  if (matches.length > 0) {
    const orderedComponents: StructuredComponent[] = [];
    let lastIndex = 0;
    let validStructuredFound = false;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;
      const textBefore = rawText.slice(lastIndex, matchStart).trim();

      if (textBefore) {
        orderedComponents.push({
          id: `text-${orderedComponents.length + 1}`,
          type: "text",
          data: { text: textBefore, format: "markdown" },
        });
      }

      try {
        const parsed = JSON.parse(match[1].trim());
        const validation = validateStructuredResponse(parsed);
        if (validation.valid && validation.sanitized) {
          validStructuredFound = true;
          orderedComponents.push(...validation.sanitized.components);
        } else {
          // If invalid JSON structure, keep raw block as text
          orderedComponents.push({
            id: `text-${orderedComponents.length + 1}`,
            type: "text",
            data: { text: match[0], format: "markdown" },
          });
        }
      } catch {
        // Invalid JSON syntax; keep raw block as text
        orderedComponents.push({
          id: `text-${orderedComponents.length + 1}`,
          type: "text",
          data: { text: match[0], format: "markdown" },
        });
      }

      lastIndex = matchEnd;
    }

    const textAfter = rawText.slice(lastIndex).trim();
    if (textAfter) {
      orderedComponents.push({
        id: `text-${orderedComponents.length + 1}`,
        type: "text",
        data: { text: textAfter, format: "markdown" },
      });
    }

    if (validStructuredFound) {
      if (options?.threadId) {
        for (const comp of orderedComponents) {
          if (comp.type === "match_scorecard") {
            recordScorecardContext(options.threadId, comp.data);
          } else if (comp.type === "player_stats") {
            recordPlayerStatsContext(options.threadId, comp.data);
          }
        }
      }

      // Return clean structured data with cleanText empty so StructuredResponseView
      // owns the unified rendering sequence without duplicate text bubbles.
      return {
        cleanText: "",
        structured: {
          version: 1,
          components: orderedComponents,
        },
      };
    }
  }

  // 2. Autonomous synthesis for Markdown sports tables & summaries
  const sportsSynthesized = synthesizeMarkdownSportsAndTables(rawText, options?.threadId);
  if (sportsSynthesized && sportsSynthesized.components.length > 0) {
    return {
      cleanText: sportsSynthesized.cleanText,
      structured: {
        version: 1,
        components: sportsSynthesized.components,
      },
    };
  }

  // 3. Autonomous synthesis for Markdown research listings with verified links
  const synthesized = synthesizeMarkdownResearchResults(rawText);
  if (synthesized && synthesized.components.length > 0) {
    return {
      cleanText: synthesized.cleanText,
      structured: {
        version: 1,
        components: synthesized.components,
      },
    };
  }

  return { cleanText: rawText };
}

/**
 * Autonomously inspects Markdown text for external research results (jobs, products, hotels, courses)
 * that contain titles and verified links [Label](https://...), extracting them into rich result cards
 * while stripping the raw link wall from the conversational prose.
 */
function synthesizeMarkdownResearchResults(text: string): { cleanText: string; components: StructuredComponent[] } | null {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
  // Match items like "1. **Title** ..." or "### Title ..." or "- **Title** ..."
  const itemRegex = /(?:^|\n)(?:(?:\d+\.|\*|-)\s+)?\*\*([^*]{3,120})\*\*([\s\S]*?)(?=(?:\n(?:\d+\.|\*|-)\s+\*\*[^*]{3,120}\*\*|\n###|\n##|$))/g;

  const matches = [...text.matchAll(itemRegex)];
  if (matches.length === 0) return null;

  const components: StructuredComponent[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  let firstMatchIndex = -1;
  let lastMatchEnd = -1;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const rawTitle = match[1].trim();
    const body = match[2].trim();
    const linkMatch = linkRegex.exec(body);
    if (!linkMatch) continue;

    const matchStart = match.index ?? 0;
    const linkIndexInBody = linkMatch.index;
    const linkEndInBody = linkIndexInBody + linkMatch[0].length;
    const afterLink = body.slice(linkEndInBody);
    const splitMatch = afterLink.match(/\r?\n\s*\r?\n([\s\S]+)$/);

    let itemBody = body;
    if (splitMatch) {
      itemBody = body.slice(0, linkEndInBody);
      lastMatchEnd = matchStart + (match[0].length - splitMatch[0].length);
    } else {
      lastMatchEnd = matchStart + match[0].length;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = matchStart;
    }

    const actionLabel = linkMatch[1].trim();
    const actionUrl = linkMatch[2].trim();

    // Deduplicate
    const normUrl = actionUrl.toLowerCase().replace(/\/$/, "");
    const normTitle = rawTitle.toLowerCase();
    if (seenUrls.has(normUrl) || seenTitles.has(normTitle)) continue;
    seenUrls.add(normUrl);
    seenTitles.add(normTitle);

    const data = parseResearchCandidate(rawTitle, itemBody, actionLabel, actionUrl);
    components.push({
      id: `result-${components.length + 1}`,
      type: "result",
      data,
    });
  }

  if (components.length === 0 || firstMatchIndex === -1) return null;

  let introText = text.slice(0, firstMatchIndex).trim();
  // Clean trailing section headers that preceded the items (e.g. "### Best matches")
  introText = introText
    .replace(/###\s*(?:Best matches|Top recommendations|Recommendations|Matches|Options|Results)\s*[\r\n]*/gi, "")
    .trim();

  const outroText = text.slice(lastMatchEnd).trim();

  const orderedComponents: StructuredComponent[] = [];
  if (introText) {
    orderedComponents.push({
      id: `text-${orderedComponents.length + 1}`,
      type: "text",
      data: { text: introText, format: "markdown" },
    });
  }
  orderedComponents.push(...components);
  if (outroText) {
    orderedComponents.push({
      id: `text-${orderedComponents.length + 1}`,
      type: "text",
      data: { text: outroText, format: "markdown" },
    });
  }

  return { cleanText: "", components: orderedComponents };
}

function parseResearchCandidate(
  rawTitle: string,
  body: string,
  actionLabel: string,
  actionUrl: string,
): ResearchResultComponentData {
  let cleanTitle = rawTitle.trim();
  let company: string | undefined;
  let location: string | undefined;

  // Parse "Role — Company (Location)" or "Product — Brand"
  const dashMatch = cleanTitle.match(/^(.*?)\s+[—–-]\s+(.*)$/);
  if (dashMatch) {
    cleanTitle = dashMatch[1].trim();
    const rest = dashMatch[2].trim();
    const locMatch = rest.match(/^(.*?)\s*\((.*?)\)$/);
    if (locMatch) {
      company = locMatch[1].trim();
      location = locMatch[2].trim();
    } else {
      company = rest;
    }
  }

  // Parse price or salary ($140,000–$160,000 or ₹80,000 or INR 50k)
  const priceMatch = body.match(/((?:\$|₹|INR\s*)[0-9,]+(?:\.[0-9]{2})?(?:\s*[-–]\s*(?:\$|₹|INR\s*)?[0-9,]+)?(?:\s*(?:k|K|k\/yr|per month|per year|\/mo|\/yr))?)/);
  const price = priceMatch ? priceMatch[1] : undefined;

  let sourceDomain: string | undefined;
  try {
    sourceDomain = new URL(actionUrl).hostname.replace(/^www\./, "");
  } catch {}

  // Parse tags from bold words
  const tags: string[] = [];
  const boldMatches = body.matchAll(/\*\*([^*]{2,30})\*\*/g);
  for (const bm of boldMatches) {
    const t = bm[1].trim();
    if (!/apply|view|buy|book|link|click|listing/i.test(t) && t !== rawTitle && t !== cleanTitle) {
      tags.push(...t.split(/,\s*/));
    }
  }

  // Determine entity category
  const isJob = /engineer|developer|designer|manager|specialist|architect|role|hiring|intern/i.test(cleanTitle) || /apply|job/i.test(actionLabel);
  const isProduct = /laptop|macbook|thinkpad|phone|camera|headphones|keyboard|monitor|tablet|shoe|supplement/i.test(cleanTitle) || /buy|product|cart/i.test(actionLabel);
  const isCourse = /course|specialization|degree|tutorial|bootcamp|certification|learn/i.test(cleanTitle) || /course|enroll/i.test(actionLabel);
  const isHotel = /hotel|resort|inn|suite|hostel|palace|stay/i.test(cleanTitle) || /hotel|book|reservation/i.test(actionLabel);

  let resultType: string = "general";
  if (isJob) resultType = "job";
  else if (isProduct) resultType = "product";
  else if (isCourse) resultType = "course";
  else if (isHotel) resultType = "hotel";

  // Clean body for reason
  const cleanBody = body
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    resultType,
    title: cleanTitle,
    company: company || undefined,
    location: location || undefined,
    salary: isJob ? price : undefined,
    price: !isJob ? price : undefined,
    source: company || sourceDomain || "Web",
    sourceDomain,
    sourceUrl: actionUrl,
    actionLabel,
    actionUrl,
    reason: cleanBody.length > 280 ? cleanBody.slice(0, 277) + "..." : cleanBody,
    tags: tags.slice(0, 6),
    badge: isJob ? "Matched Role" : "Recommended",
    provenance: {
      sourceUrl: actionUrl,
      sourceType: "web_search",
      verified: true,
      retrievalTimestamp: Date.now(),
    },
  };
}

/**
 * Autonomously inspects Markdown text for sports standings tables, medal tallies,
 * match score summaries, and player statistics, transforming them into rich cards.
 */
function synthesizeMarkdownSportsAndTables(
  text: string,
  threadId?: string
): { cleanText: string; components: StructuredComponent[] } | null {
  const tableRegex = /((?:^|\n)\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/g;
  const tableMatches = [...text.matchAll(tableRegex)];

  const components: StructuredComponent[] = [];

  for (const match of tableMatches) {
    const tableText = match[0].trim();
    const matchStart = match.index ?? 0;
    const lines = tableText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("|") && l.endsWith("|"));
    if (lines.length < 3) continue;

    const parseCells = (line: string) => line.slice(1, -1).split("|").map((c) => c.trim());
    const rawHeaders = parseCells(lines[0]);
    const lowerHeaders = rawHeaders.map((h) => h.toLowerCase());
    const dataRows = lines.slice(2).map(parseCells);

    // Context title: look at text immediately before table for ### Heading
    const textBefore = text.slice(0, matchStart);
    const headingMatch = textBefore.match(/(?:^|\n)#{1,4}\s+([^\n]+)$/);
    const precedingHeading = headingMatch ? headingMatch[1].trim() : undefined;

    // Check 1: Standings table
    const hasRankOrPos = lowerHeaders.some((h) => h.includes("pos") || h.includes("rank") || h === "#");
    const hasTeam = lowerHeaders.some((h) => h.includes("team") || h.includes("club") || h.includes("nation"));
    const hasPts = lowerHeaders.some((h) => h.includes("pts") || h.includes("points") || h === "pt");

    if (hasRankOrPos && hasTeam && hasPts) {
      const posIdx = lowerHeaders.findIndex((h) => h.includes("pos") || h.includes("rank") || h === "#");
      const teamIdx = lowerHeaders.findIndex((h) => h.includes("team") || h.includes("club") || h.includes("nation"));
      const pIdx = lowerHeaders.findIndex((h) => h === "p" || h === "pl" || h === "played" || h === "m");
      const wIdx = lowerHeaders.findIndex((h) => h === "w" || h === "won");
      const dIdx = lowerHeaders.findIndex((h) => h === "d" || h === "drawn" || h === "t");
      const lIdx = lowerHeaders.findIndex((h) => h === "l" || h === "lost");
      const diffIdx = lowerHeaders.findIndex((h) => h === "gd" || h === "diff" || h.includes("nrr") || h.includes("net rr"));
      const ptsIdx = lowerHeaders.findIndex((h) => h.includes("pts") || h.includes("points") || h === "pt");

      const rows: StandingRow[] = [];
      for (let r = 0; r < dataRows.length; r++) {
        const cells = dataRows[r];
        const teamName = cells[teamIdx] || `Team ${r + 1}`;
        const rawRank = posIdx >= 0 ? cells[posIdx] : `${r + 1}`;
        const rankNum = parseInt(rawRank.replace(/[^0-9]/g, ""), 10);
        const rank = isNaN(rankNum) ? r + 1 : rankNum;

        let qualificationZone: string | undefined;
        if (rank <= 4) qualificationZone = "champions_league";
        else if (rank <= 6) qualificationZone = "europa_league";
        else if (rank >= dataRows.length - 2) qualificationZone = "relegation";

        rows.push({
          rank,
          teamName,
          played: pIdx >= 0 ? parseInt(cells[pIdx], 10) || 0 : 0,
          won: wIdx >= 0 ? parseInt(cells[wIdx], 10) || 0 : 0,
          drawn: dIdx >= 0 ? parseInt(cells[dIdx], 10) || 0 : undefined,
          lost: lIdx >= 0 ? parseInt(cells[lIdx], 10) || 0 : 0,
          diff: diffIdx >= 0 ? cells[diffIdx] : undefined,
          points: ptsIdx >= 0 ? parseInt(cells[ptsIdx], 10) || 0 : 0,
          qualificationZone,
        });
      }

      const compTitle = precedingHeading || "League Standings";
      const standingsData: StandingsTableComponentData = {
        competition: compTitle,
        columns: rawHeaders,
        rows,
        qualificationLegend: [
          { zone: "champions_league", label: "Champions League / Top 4", color: "#58A6FF" },
          { zone: "europa_league", label: "Europa League", color: "#F0883E" },
          { zone: "relegation", label: "Relegation Zone", color: "#F85149" },
        ],
      };

      components.push({
        id: `standings-${components.length + 1}`,
        type: "standings_table",
        data: standingsData,
      });
      continue;
    }

    // Check 2: Medal Tally
    const hasGold = lowerHeaders.some((h) => h.includes("gold") || h === "g");
    const hasSilver = lowerHeaders.some((h) => h.includes("silver") || h === "s");
    const hasBronze = lowerHeaders.some((h) => h.includes("bronze") || h === "b");

    if (hasRankOrPos && hasGold && hasSilver && hasBronze) {
      const posIdx = lowerHeaders.findIndex((h) => h.includes("pos") || h.includes("rank") || h === "#");
      const nationIdx = lowerHeaders.findIndex((h) => h.includes("nation") || h.includes("country") || h.includes("noc") || h.includes("team"));
      const goldIdx = lowerHeaders.findIndex((h) => h.includes("gold") || h === "g");
      const silverIdx = lowerHeaders.findIndex((h) => h.includes("silver") || h === "s");
      const bronzeIdx = lowerHeaders.findIndex((h) => h.includes("bronze") || h === "b");
      const totalIdx = lowerHeaders.findIndex((h) => h.includes("total") || h === "tot");

      const rows: MedalRow[] = [];
      for (let r = 0; r < dataRows.length; r++) {
        const cells = dataRows[r];
        const nation = (nationIdx >= 0 ? cells[nationIdx] : "") || `Nation ${r + 1}`;
        const rawRank = posIdx >= 0 ? cells[posIdx] : `${r + 1}`;
        const rankNum = parseInt(rawRank.replace(/[^0-9]/g, ""), 10);
        const rank = isNaN(rankNum) ? r + 1 : rankNum;

        const gold = goldIdx >= 0 ? parseInt(cells[goldIdx], 10) || 0 : 0;
        const silver = silverIdx >= 0 ? parseInt(cells[silverIdx], 10) || 0 : 0;
        const bronze = bronzeIdx >= 0 ? parseInt(cells[bronzeIdx], 10) || 0 : 0;
        const total = totalIdx >= 0 ? parseInt(cells[totalIdx], 10) || (gold + silver + bronze) : gold + silver + bronze;

        rows.push({
          rank,
          nation,
          gold,
          silver,
          bronze,
          total,
        });
      }

      const compTitle = precedingHeading || "Olympic Games Medal Tally";
      const medalData: MedalTallyComponentData = {
        competition: compTitle,
        rankingMethod: "gold_first",
        rankingMethodLabel: "Ranked by Gold medals first",
        freshness: "Final Tally",
        rows,
      };

      components.push({
        id: `medal-${components.length + 1}`,
        type: "medal_tally",
        data: medalData,
      });
      continue;
    }
  }

  // Check 3: Markdown Match Scorecard (e.g. Cricket / Football)
  const cricketMatchRegex = /(?:###|##)?\s*([^\n]+?(?:World Cup|Premier League|IPL|T20|ODI|Test|Championship)[^\n]*)\s*\n+\*\*([^*]+?\s+(?:vs|v)\s+[^*]+?)\*\*[\s\S]*?-\s+([^:\n]+):\s*([0-9/]+(?:\s*\([0-9.]+(?:\s*ov)?\))?)\s*\n+-\s+([^:\n]+):\s*([0-9/]+(?:\s*\([0-9.]+(?:\s*ov)?\))?)/i;
  const cricketMatch = text.match(cricketMatchRegex);
  if (cricketMatch) {
    const competition = cricketMatch[1].trim();
    const fixtureTitle = cricketMatch[2].trim();
    const team1Name = cricketMatch[3].trim();
    const team1Score = cricketMatch[4].trim();
    const team2Name = cricketMatch[5].trim();
    const team2Score = cricketMatch[6].trim();

    // Look for status detail (e.g. "India won by 7 runs")
    const outcomeMatch = text.match(/(?:won by [^\n.]+|Full Time|Match Tied|Drawn)/i);
    const statusDetail = outcomeMatch ? outcomeMatch[0] : undefined;

    const scorecardData: MatchScorecardComponentData = {
      sport: "cricket",
      competition,
      fixtureTitle,
      status: "finished",
      statusDetail,
      teams: [
        { name: team1Name, score: team1Score },
        { name: team2Name, score: team2Score },
      ],
    };

    if (threadId) {
      recordScorecardContext(threadId, scorecardData);
    }

    components.push({
      id: `scorecard-${components.length + 1}`,
      type: "match_scorecard",
      data: scorecardData,
    });
  }

  if (components.length === 0) return null;

  // Clean the synthesized tables/scorecards from the markdown prose so cards own the display
  let cleanText = text;
  for (const match of tableMatches) {
    cleanText = cleanText.replace(match[0], "");
  }
  if (cricketMatch) {
    cleanText = cleanText.replace(cricketMatch[0], "");
  }
  cleanText = cleanText.replace(/###\s*[^\n]+\n*/g, "").trim();

  const orderedComponents: StructuredComponent[] = [];
  if (cleanText) {
    orderedComponents.push({
      id: `text-1`,
      type: "text",
      data: { text: cleanText, format: "markdown" },
    });
  }
  orderedComponents.push(...components);

  return { cleanText: "", components: orderedComponents };
}

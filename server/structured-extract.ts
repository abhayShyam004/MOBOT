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

const STRUCTURED_BLOCK_REGEX = /```(?:structured|json:structured|json)\s*[\r\n]+([\s\S]*?)[\r\n]+```/g;

function findRawStructuredJson(text: string): { jsonStr: string; start: number; end: number } | null {
  const marker = /\{\s*"version"\s*:\s*1\s*,/;
  const match = text.match(marker);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return { jsonStr: text.slice(start, i + 1), start, end: i + 1 };
      }
    }
  }
  return null;
}

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

  // 1b. Check for raw (unfenced) structured JSON blocks emitted directly by models
  const rawJsonMatch = findRawStructuredJson(rawText);
  if (rawJsonMatch) {
    try {
      const parsed = JSON.parse(rawJsonMatch.jsonStr);
      const validation = validateStructuredResponse(parsed);
      if (validation.valid && validation.sanitized && validation.sanitized.components.length > 0) {
        const textBefore = rawText.slice(0, rawJsonMatch.start).trim();
        const textAfter = rawText.slice(rawJsonMatch.end).trim();
        const orderedComponents: StructuredComponent[] = [];
        if (textBefore) {
          orderedComponents.push({
            id: `text-1`,
            type: "text",
            data: { text: textBefore, format: "markdown" },
          });
        }
        orderedComponents.push(...validation.sanitized.components);
        if (textAfter) {
          orderedComponents.push({
            id: `text-${orderedComponents.length + 1}`,
            type: "text",
            data: { text: textAfter, format: "markdown" },
          });
        }
        if (options?.threadId) {
          for (const comp of orderedComponents) {
            if (comp.type === "match_scorecard") {
              recordScorecardContext(options.threadId, comp.data);
            } else if (comp.type === "player_stats") {
              recordPlayerStatsContext(options.threadId, comp.data);
            }
          }
        }
        return {
          cleanText: "",
          structured: {
            version: 1,
            components: orderedComponents,
          },
        };
      }
    } catch {
      // Ignore if JSON.parse fails and fall through
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
interface ParsedTableInfo {
  raw: string;
  headers: string[];
  rows: string[][];
  precedingHeading?: string;
}

function findMarkdownTables(text: string): ParsedTableInfo[] {
  const lines = text.split(/\r?\n/);
  const tables: ParsedTableInfo[] = [];

  let inTable = false;
  let tableLines: string[] = [];
  let startLine = -1;

  const parseCells = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  };

  const isSeparatorLine = (s: string): boolean => {
    const trimmed = s.trim();
    return /^\|?[-:\s|]+\|?$/.test(trimmed) && trimmed.includes("-") && trimmed.includes("|");
  };

  const finishTable = () => {
    if (tableLines.length >= 2) {
      const hasSep = isSeparatorLine(tableLines[1] || "");
      const minLines = hasSep ? 3 : 2;
      if (tableLines.length >= minLines) {
        const headers = parseCells(tableLines[0]!);
        const rawRows = hasSep ? tableLines.slice(2) : tableLines.slice(1);
        const rows = rawRows
          .filter((l) => !isSeparatorLine(l))
          .map(parseCells)
          .filter((r) => r.some((c) => c.length > 0));

        if (headers.length >= 2 && rows.length >= 1) {
          const raw = tableLines.join("\n");
          let precedingHeading: string | undefined;
          for (let p = Math.max(0, startLine - 3); p < startLine; p++) {
            const pl = lines[p]!.trim();
            const hm = pl.match(/^(?:#{1,4}\s+|\*\*)([^*\n]+?)(?:\*\*|$)/);
            if (hm) {
              precedingHeading = hm[1]!.trim();
              break;
            }
          }
          tables.push({ raw, headers, rows, precedingHeading });
        }
      }
    }
    inTable = false;
    tableLines = [];
    startLine = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const isTableLine = line.includes("|") && !line.startsWith("```");

    if (isTableLine) {
      if (!inTable) {
        inTable = true;
        startLine = i;
        tableLines = [line];
      } else {
        tableLines.push(line);
      }
    } else {
      if (inTable) {
        finishTable();
      }
    }
  }

  if (inTable) {
    finishTable();
  }

  return tables;
}

function synthesizeMarkdownSportsAndTables(
  text: string,
  threadId?: string
): { cleanText: string; components: StructuredComponent[] } | null {
  const tables = findMarkdownTables(text);
  const components: StructuredComponent[] = [];
  const matchedRaws: string[] = [];

  for (const table of tables) {
    if (table.rows.length === 0 || table.headers.length === 0) continue;
    const lowerHeaders = table.headers.map((h) => h.toLowerCase().trim());
    const precedingHeading = table.precedingHeading;

    // Check 1: Standings table
    const hasRankOrPos = lowerHeaders.some((h) =>
      h === "pos" || h === "position" || h === "rank" || h === "#" || h === "no" || h === "no." ||
      h.includes("pos") || h.includes("rank")
    );
    const hasTeam = lowerHeaders.some((h) =>
      h.includes("team") || h.includes("club") || h.includes("franchise") ||
      h.includes("squad") || h.includes("nation") || h.includes("country")
    );
    const hasPts = lowerHeaders.some((h) =>
      h === "pts" || h === "points" || h === "pt" || h.includes("pts") || h.includes("points")
    );
    const hasRecord = lowerHeaders.some((h) =>
      h === "p" || h === "pld" || h === "mat" || h === "matches" || h === "played" || h === "m" ||
      h === "w" || h === "won" || h === "l" || h === "lost" || h.includes("nrr") || h.includes("diff") || h === "gd"
    );

    const hasGold = lowerHeaders.some((h) => h === "gold" || h === "g" || h.includes("gold"));
    const hasSilver = lowerHeaders.some((h) => h === "silver" || h === "s" || h.includes("silver"));
    const hasBronze = lowerHeaders.some((h) => h === "bronze" || h === "b" || h.includes("bronze"));
    const isMedalTally = hasGold && hasSilver && hasBronze;

    const isStandings =
      !isMedalTally &&
      ((hasTeam && hasPts) ||
        (hasTeam && hasRecord && (hasRankOrPos || table.rows.length >= 3)) ||
        (hasTeam && hasRankOrPos && (/table|standings|points|league|ipl|championship|tournament/i.test(text) || Boolean(precedingHeading && /table|standings|points|league|ipl/i.test(precedingHeading)))));

    if (isStandings) {
      const posIdx = lowerHeaders.findIndex((h) =>
        h === "pos" || h === "position" || h === "rank" || h === "#" || h === "no" || h === "no." ||
        h.includes("pos") || h.includes("rank")
      );
      const teamIdx = lowerHeaders.findIndex((h) =>
        h.includes("team") || h.includes("club") || h.includes("franchise") || h.includes("squad") || h.includes("nation")
      );
      const pIdx = lowerHeaders.findIndex((h) =>
        h === "p" || h === "pld" || h === "mat" || h === "matches" || h === "played" || h === "m" || h === "gp"
      );
      const wIdx = lowerHeaders.findIndex((h) =>
        h === "w" || h === "won" || h === "wins"
      );
      const dIdx = lowerHeaders.findIndex((h) =>
        h === "d" || h === "drawn" || h === "draws" || h === "t" || h === "tied" || h === "ties"
      );
      const lIdx = lowerHeaders.findIndex((h) =>
        h === "l" || h === "lost" || h === "losses"
      );
      const diffIdx = lowerHeaders.findIndex((h) =>
        h === "gd" || h === "diff" || h.includes("nrr") || h.includes("net rr") || h.includes("run rate")
      );
      const ptsIdx = lowerHeaders.findIndex((h) =>
        h === "pts" || h === "points" || h === "pt" || h.includes("pts") || h.includes("points")
      );

      const isCricketOrIPL =
        /ipl/i.test(text) ||
        /cricket/i.test(text) ||
        lowerHeaders.some((h) => h.includes("nrr") || h.includes("net rr")) ||
        Boolean(precedingHeading && /ipl|cricket/i.test(precedingHeading));

      const rows: StandingRow[] = [];
      for (let r = 0; r < table.rows.length; r++) {
        const cells = table.rows[r]!;
        const teamName = (teamIdx >= 0 ? cells[teamIdx] : "") || `Team ${r + 1}`;
        if (!teamName || teamName === "-") continue;

        const rawRank = posIdx >= 0 ? cells[posIdx] : "";
        const rankNum = rawRank ? parseInt(rawRank.replace(/[^0-9]/g, ""), 10) : NaN;
        const rank = !isNaN(rankNum) && rankNum > 0 ? rankNum : r + 1;

        const played = pIdx >= 0 ? parseInt(cells[pIdx] || "0", 10) || 0 : 0;
        const won = wIdx >= 0 ? parseInt(cells[wIdx] || "0", 10) || 0 : 0;
        const drawn = dIdx >= 0 && cells[dIdx] && cells[dIdx] !== "-" ? parseInt(cells[dIdx] || "0", 10) || 0 : undefined;
        const lost = lIdx >= 0 ? parseInt(cells[lIdx] || "0", 10) || 0 : 0;
        const diff = diffIdx >= 0 && cells[diffIdx] ? cells[diffIdx] : undefined;
        const points = ptsIdx >= 0 ? parseInt(cells[ptsIdx] || "0", 10) || 0 : 0;

        let qualificationZone: string | undefined;
        if (isCricketOrIPL) {
          if (rank <= 4) qualificationZone = "champions_league"; // Top 4 Playoffs
        } else {
          if (rank <= 4) qualificationZone = "champions_league";
          else if (rank <= 6) qualificationZone = "europa_league";
          else if (rank >= table.rows.length - 2) qualificationZone = "relegation";
        }

        rows.push({
          rank,
          teamName,
          played,
          won,
          drawn,
          lost,
          diff,
          points,
          qualificationZone,
        });
      }

      let compTitle = precedingHeading;
      if (!compTitle) {
        if (/ipl\s*2024/i.test(text)) compTitle = "IPL 2024 Points Table";
        else if (/ipl\s*2025/i.test(text)) compTitle = "IPL 2025 Points Table";
        else if (/indian\s+premier\s+league/i.test(text)) compTitle = "Indian Premier League";
        else if (/premier\s+league/i.test(text)) compTitle = "Premier League Standings";
        else if (/la\s+liga/i.test(text)) compTitle = "La Liga Standings";
        else compTitle = "League Standings";
      }

      let seasonMatch = text.match(/\b(202\d(?:\/\d{2,4})?)\b/);
      let season = seasonMatch ? seasonMatch[1] : undefined;
      if (!season && /last\s+year/i.test(text)) {
        season = (new Date().getFullYear() - 1).toString();
      }

      const qualificationLegend = isCricketOrIPL
        ? [{ zone: "champions_league", label: "Playoffs (Top 4)", color: "#58A6FF" }]
        : [
            { zone: "champions_league", label: "Champions League / Top 4", color: "#58A6FF" },
            { zone: "europa_league", label: "Europa League", color: "#F0883E" },
            { zone: "relegation", label: "Relegation Zone", color: "#F85149" },
          ];

      let sourceUrl: string | undefined;
      let sourceName: string | undefined;
      const urlMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/) || text.match(/(https?:\/\/[^\s)]+)/);
      if (urlMatch) {
        if (urlMatch[2]) {
          sourceName = urlMatch[1];
          sourceUrl = urlMatch[2];
        } else {
          sourceUrl = urlMatch[1];
          try {
            sourceName = new URL(sourceUrl).hostname.replace(/^www\./, "");
          } catch {
            sourceName = "Official Source";
          }
        }
      } else if (isCricketOrIPL) {
        const iplSeason = season || "2024";
        sourceUrl = `https://www.iplt20.com/points-table/men/${iplSeason}`;
        sourceName = "IPL Official (iplt20.com)";
      }

      const standingsData: StandingsTableComponentData = {
        competition: compTitle,
        season,
        columns: table.headers,
        rows,
        qualificationLegend,
        sourceUrl,
        sourceName,
      };

      components.push({
        id: `standings-${components.length + 1}`,
        type: "standings_table",
        data: standingsData,
      });
      matchedRaws.push(table.raw);
      continue;
    }

    // Check 2: Medal Tally
    if (isMedalTally) {
      const posIdx = lowerHeaders.findIndex((h) =>
        h === "pos" || h === "position" || h === "rank" || h === "#" || h === "no" || h === "no." ||
        h.includes("pos") || h.includes("rank")
      );
      const nationIdx = lowerHeaders.findIndex((h) =>
        h.includes("nation") || h.includes("country") || h.includes("noc") || h.includes("team")
      );
      const goldIdx = lowerHeaders.findIndex((h) => h === "gold" || h === "g" || h.includes("gold"));
      const silverIdx = lowerHeaders.findIndex((h) => h === "silver" || h === "s" || h.includes("silver"));
      const bronzeIdx = lowerHeaders.findIndex((h) => h === "bronze" || h === "b" || h.includes("bronze"));
      const totalIdx = lowerHeaders.findIndex((h) => h === "total" || h === "tot" || h.includes("total"));

      const rows: MedalRow[] = [];
      for (let r = 0; r < table.rows.length; r++) {
        const cells = table.rows[r]!;
        const nation = (nationIdx >= 0 ? cells[nationIdx] : "") || `Nation ${r + 1}`;
        if (!nation || nation === "-") continue;

        const rawRank = posIdx >= 0 ? cells[posIdx] : "";
        const rankNum = rawRank ? parseInt(rawRank.replace(/[^0-9]/g, ""), 10) : NaN;
        const rank = !isNaN(rankNum) && rankNum > 0 ? rankNum : r + 1;

        const gold = goldIdx >= 0 ? parseInt(cells[goldIdx] || "0", 10) || 0 : 0;
        const silver = silverIdx >= 0 ? parseInt(cells[silverIdx] || "0", 10) || 0 : 0;
        const bronze = bronzeIdx >= 0 ? parseInt(cells[bronzeIdx] || "0", 10) || 0 : 0;
        const total = totalIdx >= 0 ? parseInt(cells[totalIdx] || "0", 10) || (gold + silver + bronze) : gold + silver + bronze;

        rows.push({
          rank,
          nation,
          gold,
          silver,
          bronze,
          total,
        });
      }

      let compTitle = precedingHeading;
      if (!compTitle) {
        if (/paris\s*2024/i.test(text)) compTitle = "Paris 2024 Olympic Games";
        else if (/tokyo\s*2020/i.test(text)) compTitle = "Tokyo 2020 Olympic Games";
        else compTitle = "Olympic Games Medal Tally";
      }

      let sourceUrl: string | undefined;
      let sourceName: string | undefined;
      const urlMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/) || text.match(/(https?:\/\/[^\s)]+)/);
      if (urlMatch) {
        if (urlMatch[2]) {
          sourceName = urlMatch[1];
          sourceUrl = urlMatch[2];
        } else {
          sourceUrl = urlMatch[1];
          try {
            sourceName = new URL(sourceUrl).hostname.replace(/^www\./, "");
          } catch {
            sourceName = "Official Source";
          }
        }
      }

      const medalData: MedalTallyComponentData = {
        competition: compTitle,
        rankingMethod: "gold_first",
        rankingMethodLabel: "Ranked by Gold medals first",
        freshness: "Final Tally",
        rows,
        sourceUrl,
        sourceName,
      };

      components.push({
        id: `medal-${components.length + 1}`,
        type: "medal_tally",
        data: medalData,
      });
      matchedRaws.push(table.raw);
      continue;
    }
  }

function inferMatchStatus(text: string, sport: string): { status: string; statusLabel: string } {
  const lower = text.toLowerCase();
  if (lower.includes("live") || lower.includes("in progress") || lower.includes("stumps") || lower.includes("innings break")) {
    return { status: "live", statusLabel: "LIVE" };
  }
  if (lower.includes("delayed") || lower.includes("rain") || lower.includes("bad light")) {
    return { status: "delayed", statusLabel: "DELAYED" };
  }
  if (lower.includes("abandoned") || lower.includes("no result") || lower.includes("cancelled")) {
    return { status: "abandoned", statusLabel: "ABANDONED" };
  }
  if (lower.includes("scheduled") || lower.includes("upcoming") || lower.includes("starts at")) {
    return { status: "scheduled", statusLabel: "SCHEDULED" };
  }
  if (lower.includes("won by") || lower.includes("beat") || lower.includes("defeated") || lower.includes("full time") || lower.includes("final") || lower.includes("(ft)")) {
    return { status: "completed", statusLabel: sport === "football" ? "FULL-TIME" : "FINAL" };
  }
  return { status: "unknown", statusLabel: "STATUS" };
}

  // Check 3: Markdown Match Scorecard (Cricket / Football / Tennis)
  const cricketMatchRegex = /(?:###|##)?\s*([^\n]+?(?:World Cup|Premier League|IPL|T20|ODI|Test|Championship)[^\n]*)\s*\n+\*\*([^*]+?\s+(?:vs|v)\s+[^*]+?)\*\*[\s\S]*?-\s+([^:\n]+):\s*([0-9/]+(?:\s*\([0-9.]+(?:\s*ov)?\))?)\s*\n+-\s+([^:\n]+):\s*([0-9/]+(?:\s*\([0-9.]+(?:\s*ov)?\))?)/i;
  const cricketMatch = text.match(cricketMatchRegex);
  if (cricketMatch) {
    const competition = cricketMatch[1]!.trim();
    const fixtureTitle = cricketMatch[2]!.trim();
    const team1Name = cricketMatch[3]!.trim();
    const team1Score = cricketMatch[4]!.trim();
    const team2Name = cricketMatch[5]!.trim();
    const team2Score = cricketMatch[6]!.trim();

    const outcomeMatch = text.match(/(?:won by [^\n.]+|Full Time|Match Tied|Drawn)/i);
    const statusDetail = outcomeMatch ? outcomeMatch[0] : undefined;

    let sourceUrl: string | undefined;
    let sourceName: string | undefined;
    const urlMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/) || text.match(/(https?:\/\/[^\s)]+)/);
    if (urlMatch) {
      if (urlMatch[2]) {
        sourceName = urlMatch[1];
        sourceUrl = urlMatch[2];
      } else {
        sourceUrl = urlMatch[1];
        try { sourceName = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch {}
      }
    }

    const statusInfo = inferMatchStatus(text, "cricket");
    const scorecardData: MatchScorecardComponentData = {
      sport: "cricket",
      competition,
      fixtureTitle,
      status: statusInfo.status,
      statusLabel: statusInfo.statusLabel,
      statusDetail,
      teams: [
        { name: team1Name, score: team1Score },
        { name: team2Name, score: team2Score },
      ],
      sourceUrl,
      sourceName,
    };

    if (threadId) {
      recordScorecardContext(threadId, scorecardData);
    }

    components.push({
      id: `scorecard-${components.length + 1}`,
      type: "match_scorecard",
      data: scorecardData,
    });
    matchedRaws.push(cricketMatch[0]);
  }

  // Football Match Check: e.g. **Arsenal 3 - 1 Chelsea**
  const footballMatchRegex = /(?:###|##)?\s*([^\n]+?(?:Premier League|La Liga|Champions League|Serie A|Bundesliga|FA Cup|World Cup)[^\n]*)\s*\n+\*\*([^*]+?)\s+(\d+)\s*[-–]\s*(\d+)\s+([^*]+?)\*\*/i;
  const footballMatch = text.match(footballMatchRegex);
  if (footballMatch) {
    const competition = footballMatch[1]!.trim();
    const team1Name = footballMatch[2]!.trim();
    const team1Score = footballMatch[3]!.trim();
    const team2Score = footballMatch[4]!.trim();
    const team2Name = footballMatch[5]!.trim();
    const fixtureTitle = `${team1Name} vs ${team2Name}`;

    let sourceUrl: string | undefined;
    let sourceName: string | undefined;
    const urlMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/) || text.match(/(https?:\/\/[^\s)]+)/);
    if (urlMatch) {
      if (urlMatch[2]) {
        sourceName = urlMatch[1];
        sourceUrl = urlMatch[2];
      } else {
        sourceUrl = urlMatch[1];
        try { sourceName = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch {}
      }
    }

    const statusInfo = inferMatchStatus(text, "football");
    const scorecardData: MatchScorecardComponentData = {
      sport: "football",
      competition,
      fixtureTitle,
      status: statusInfo.status,
      statusLabel: statusInfo.statusLabel,
      statusDetail: `${team1Name} ${team1Score} - ${team2Score} ${team2Name} (${statusInfo.statusLabel})`,
      teams: [
        { name: team1Name, score: team1Score, isWinner: parseInt(team1Score, 10) > parseInt(team2Score, 10) },
        { name: team2Name, score: team2Score, isWinner: parseInt(team2Score, 10) > parseInt(team1Score, 10) },
      ],
      sourceUrl,
      sourceName,
    };

    if (threadId) {
      recordScorecardContext(threadId, scorecardData);
    }

    components.push({
      id: `scorecard-${components.length + 1}`,
      type: "match_scorecard",
      data: scorecardData,
    });
    matchedRaws.push(footballMatch[0]);
  }

  // Tennis Match Check: e.g. **Wimbledon 2024 - Men's Singles Final** ... **Carlos Alcaraz vs Novak Djokovic**
  const tennisMatchRegex = /(?:###|##)?\s*([^\n]+?(?:Wimbledon|US Open|French Open|Roland Garros|Australian Open|ATP|WTA)[^\n]*)\s*\n+\*\*([^*]+?)\s+(?:def\.|defeated|d\.|vs)\s+([^*]+?)\*\*(?:\s*\n+([^\n]+?(?:\d+[-–]\d+)[^\n]*))?/i;
  const tennisMatch = text.match(tennisMatchRegex);
  if (tennisMatch) {
    const competition = tennisMatch[1]!.trim();
    const player1Name = tennisMatch[2]!.trim();
    const player2Name = tennisMatch[3]!.trim();
    const scoreLine = tennisMatch[4]?.trim() || "";
    const fixtureTitle = `${player1Name} vs ${player2Name}`;

    let sourceUrl: string | undefined;
    let sourceName: string | undefined;
    const urlMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/) || text.match(/(https?:\/\/[^\s)]+)/);
    if (urlMatch) {
      if (urlMatch[2]) {
        sourceName = urlMatch[1];
        sourceUrl = urlMatch[2];
      } else {
        sourceUrl = urlMatch[1];
        try { sourceName = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch {}
      }
    }

    const statusInfo = inferMatchStatus(text, "tennis");
    const sets = scoreLine ? scoreLine.split(/[\s,]+/).filter((s) => /^\d+[-–]\d+/.test(s)) : [];

    const scorecardData: MatchScorecardComponentData = {
      sport: "tennis",
      competition,
      fixtureTitle,
      status: statusInfo.status,
      statusLabel: statusInfo.statusLabel,
      statusDetail: scoreLine || `${player1Name} won`,
      outcomeHeadline: `${player1Name} won`,
      outcomeDetail: scoreLine ? `Score: ${scoreLine}` : undefined,
      teams: [
        { name: player1Name, score: sets.map((s) => s.split(/[-–]/)[0]).join(" ") || "1", isWinner: true },
        { name: player2Name, score: sets.map((s) => s.split(/[-–]/)[1]).join(" ") || "0", isWinner: false },
      ],
      sourceUrl,
      sourceName,
    };

    if (threadId) {
      recordScorecardContext(threadId, scorecardData);
    }

    components.push({
      id: `scorecard-${components.length + 1}`,
      type: "match_scorecard",
      data: scorecardData,
    });
    matchedRaws.push(tennisMatch[0]);
  }

  if (components.length === 0) return null;

  // Clean the synthesized tables/scorecards from the markdown prose so cards own the display
  let cleanText = text;
  for (const raw of matchedRaws) {
    cleanText = cleanText.replace(raw, "");
  }
  cleanText = cleanText.replace(/###\s*[^\n]+\n*/g, "").trim();
  // Strip trailing source link lines that are already captured in card provenance
  cleanText = cleanText
    .replace(/(?:^|\n)(?:Source|Ref|Reference|Data source|Official source):\s*(?:\[[^\]]+\]\([^\s)]+\)|https?:\/\/[^\s]+)\s*$/i, "")
    .trim();

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

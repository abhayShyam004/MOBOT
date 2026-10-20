import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export type LocationProvenance =
  | "DEVICE_LIVE"
  | "USER_EXPLICIT"
  | "SAVED_USER"
  | "CONVERSATION_CONTEXT"
  | "UNKNOWN/UNAVAILABLE";

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  provenance: LocationProvenance;
  source?: "ip" | "device" | "profile" | "user_set" | "timezone_inferred";
  updatedAt?: number;
  enabled?: boolean;
  isFixture?: boolean;
}

export type LocationScope =
  | "default"
  | "explicit_override"
  | "destination"
  | "suppressed"
  | "unrelated";

export interface ResolvedLocationRequest {
  scope: LocationScope;
  effectiveLocation: UserLocation | null;
  explicitLocationName?: string;
  isTravelDestination?: boolean;
  isSuppressed?: boolean;
  reason: string;
}

const LOCATION_FILE = "user-location.json";

/**
 * Validates a location object: ensures numbers are finite and in geographic bounds,
 * string fields are bounded and trimmed, provenance is verified, and eliminates
 * invalid, corrupted, or fixture records.
 */
export function validateUserLocation(raw: unknown): UserLocation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // Reject test fixture objects from being treated as real saved user locations
  if (obj.isFixture === true || obj.test === true) {
    return null;
  }

  const cleanString = (val: unknown, maxLen = 100): string | undefined => {
    if (typeof val !== "string") return undefined;
    const trimmed = val.trim();
    if (!trimmed || trimmed.length > maxLen) return undefined;
    return trimmed;
  };

  const cleanNumber = (val: unknown, min: number, max: number): number | undefined => {
    if (typeof val !== "number" || !Number.isFinite(val)) return undefined;
    if (val < min || val > max) return undefined;
    return val;
  };

  const city = cleanString(obj.city);
  const region = cleanString(obj.region);
  const country = cleanString(obj.country);
  const countryCode = cleanString(obj.countryCode, 10)?.toUpperCase();
  const postalCode = cleanString(obj.postalCode, 20);
  const timezone = cleanString(obj.timezone, 60);

  const latitude = cleanNumber(obj.latitude, -90, 90);
  const longitude = cleanNumber(obj.longitude, -180, 180);

  const validProvenances = new Set<LocationProvenance>([
    "DEVICE_LIVE",
    "USER_EXPLICIT",
    "SAVED_USER",
    "CONVERSATION_CONTEXT",
    "UNKNOWN/UNAVAILABLE",
  ]);

  let provenance: LocationProvenance = "SAVED_USER";
  if (typeof obj.provenance === "string" && validProvenances.has(obj.provenance as LocationProvenance)) {
    provenance = obj.provenance as LocationProvenance;
  } else if (obj.source === "device") {
    provenance = "DEVICE_LIVE";
  } else if (obj.source === "user_set" || obj.source === "profile") {
    provenance = "SAVED_USER";
  }

  // UNKNOWN/UNAVAILABLE is an explicit lack of location, not a valid saved location
  if (provenance === "UNKNOWN/UNAVAILABLE") {
    return null;
  }

  const validSources = new Set(["ip", "device", "profile", "user_set", "timezone_inferred"]);
  const source = typeof obj.source === "string" && validSources.has(obj.source)
    ? (obj.source as UserLocation["source"])
    : undefined;

  const enabled = obj.enabled === false ? false : true;
  const updatedAt = typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
    ? obj.updatedAt
    : Date.now();

  // If everything is blank and no coordinates, it's invalid
  if (!city && !region && !country && !countryCode && !postalCode && latitude === undefined && longitude === undefined) {
    return null;
  }

  return {
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
    ...(countryCode ? { countryCode } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(timezone ? { timezone } : {}),
    ...(source ? { source } : {}),
    provenance,
    updatedAt,
    enabled,
  };
}

/**
 * Loads persistent user location from ~/.openmausbot/user-location.json or fallback profile.
 * Returns null if location is unconfigured or unavailable.
 * CRITICAL: Never falls back to a coarse timezone or invented location.
 */
export function loadUserLocation(customDataDir: string = DATA_DIR): UserLocation | null {
  const filePath = join(customDataDir, LOCATION_FILE);
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      const validated = validateUserLocation(parsed);
      if (validated && validated.enabled !== false) return validated;
    } catch {
      // Corrupted file handled safely
    }
  }

  // Profile configuration fallback
  const configPath = join(customDataDir, "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      if (cfg?.profile?.location) {
        const validated = validateUserLocation(cfg.profile.location);
        if (validated && validated.enabled !== false) return validated;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Persists user location to ~/.openmausbot/user-location.json atomically.
 * Enforces provenance: must be SAVED_USER or USER_EXPLICIT.
 * Prevents test suites from mutating the production DATA_DIR.
 */
export function saveUserLocation(location: UserLocation, customDataDir: string = DATA_DIR): boolean {
  if (customDataDir === DATA_DIR && (process.env.VITEST || process.env.NODE_ENV === "test")) {
    throw new Error("Tests must NEVER mutate production DATA_DIR! Provide an isolated fixture directory.");
  }

  if (location.isFixture === true || (location as any).test === true) {
    return false;
  }

  const payload: UserLocation = {
    ...location,
    provenance: location.provenance || "SAVED_USER",
  };

  const validated = validateUserLocation(payload);
  if (!validated) return false;

  try {
    mkdirSync(customDataDir, { recursive: true });
    const filePath = join(customDataDir, LOCATION_FILE);
    writeFileAtomic(filePath, JSON.stringify(validated, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears persistent user location, deleting the file and reverting state to UNKNOWN/UNAVAILABLE.
 */
export function clearUserLocation(customDataDir: string = DATA_DIR): void {
  try {
    const filePath = join(customDataDir, LOCATION_FILE);
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  } catch {}
}

/**
 * Disables user location by clearing the persisted location file.
 */
export function disableUserLocation(customDataDir: string = DATA_DIR): void {
  clearUserLocation(customDataDir);
}

/**
 * Resolves how location should be interpreted for a given user turn.
 * Distinguishes:
 * 1. Default user location
 * 2. Explicit location override ("restaurants in Mumbai")
 * 3. Travel / destination requests ("find me a hotel")
 * 4. Suppressed / global requests ("don't use my location", "search globally")
 * 5. Unrelated requests (math, code, general facts)
 */
export function resolveLocationIntent(
  userText: string,
  defaultLocation: UserLocation | null,
  previousExplicitLocation?: string,
): ResolvedLocationRequest {
  const text = (userText || "").trim();

  // 1. Explicit suppression checks
  const suppressionPatterns = [
    /(?:don't|do not|never|stop|disable|turn off|hide|without)\s+(?:use|using|track|tracking|share|sharing|need|needing|include|including|disclose|disclosing)?\s*(?:my\s+)?(?:location|city|country|gps|coords|coordinates)/i,
    /search\s+globally/i,
    /without\s+(?:my\s+)?(?:location|city|country|gps)/i,
    /ignore\s+(?:my\s+)?(?:location|city|country|gps)/i,
    /globally\s+rather\s+than\s+locally/i,
    /no\s+location\s+context/i,
    /private\s+(?:mode|search)/i,
    /incognito/i,
  ];

  if (suppressionPatterns.some((pattern) => pattern.test(text))) {
    return {
      scope: "suppressed",
      effectiveLocation: null,
      isSuppressed: true,
      reason: "User explicitly requested not to use location or to search globally.",
    };
  }

  // 2. Explicit destination or travel requests
  const travelKeywords = [
    /\b(?:hotel|hotels|hostel|resort|lodging|motel)\b/i,
    /\b(?:flights?|flight\s+tickets?|fly\s+to|airline)\b/i,
    /\b(?:trip\s+to|vacation\s+in|visit\s+to|travel\s+to|tour\s+to)\b/i,
  ];

  const hasTravel = travelKeywords.some((p) => p.test(text));

  // 3. Explicit location extraction from current prompt
  // Matches "in <City>", "near <City>", "around <City>", "for <City>", "at <City>", "to <City>"
  const nonLocations = new Set([
    "python", "javascript", "typescript", "java", "rust", "c", "c++", "go", "kotlin", "swift",
    "english", "spanish", "french", "german", "hindi", "japanese", "chinese",
    "general", "detail", "summary", "brief", "short", "bullet", "bullets", "markdown",
    "code", "practice", "theory", "reality", "addition", "advance", "fact", "future",
    "past", "minutes", "hours", "days", "weeks", "months", "years", "time",
    "today", "tomorrow", "yesterday", "now", "later", "tonight", "this", "that", "these", "those",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "weekend",
    "breakfast", "lunch", "dinner", "brunch", "morning", "afternoon", "evening", "night",
    "here", "there", "everywhere", "anywhere", "nowhere", "place", "places", "area", "areas", "neighborhood",
    "my area", "town", "city", "my city", "home", "work", "school", "office", "store",
    "me", "us", "you", "them", "him", "her", "it",
    "back", "return", "default",
    "sale", "sales", "deal", "deals", "discount", "discounts", "free", "cheap", "best",
    "utc", "gmt", "est", "edt", "cst", "cdt", "mst", "mdt", "pst", "pdt", "ist", "cet", "cest", "bst", "aest", "aedt", "zulu",
  ]);

  // 3. Return to default / home location requested explicitly
  const returnToDefaultPattern = /\b(?:my\s+home\s+city|back\s+home|default\s+location|here\s+at\s+home|in\s+my\s+city)\b/i;
  if (returnToDefaultPattern.test(text)) {
    return {
      scope: "default",
      effectiveLocation: defaultLocation?.enabled !== false && defaultLocation?.provenance === "SAVED_USER" ? defaultLocation : null,
      reason: "User requested return to default home location.",
    };
  }

  // 4. Direct location inquiries: "where am I?", "what city am I in?", "what's my location?", "check my location", "my current location"
  const directLocationQueryPattern = /\b(?:where\s+am\s+i|(?:what|which)\s+(?:city|country|state|place|town|region)\s+am\s+i\s+in|what(?:'s|\s+is)\s+my\s+(?:current\s+|new\s+|saved\s+)?location|check\s+my\s+(?:current\s+|new\s+|saved\s+)?location|my\s+current\s+location|what(?:'s|\s+is)\s+near\s+me)\b/i;
  if (directLocationQueryPattern.test(text)) {
    if (defaultLocation && defaultLocation.enabled !== false && (defaultLocation.provenance === "SAVED_USER" || defaultLocation.provenance === "DEVICE_LIVE")) {
      return {
        scope: "default",
        effectiveLocation: defaultLocation,
        reason: defaultLocation.provenance === "DEVICE_LIVE"
          ? "Direct location query; answered with live device GPS location."
          : "Direct location query; answered with explicitly saved default user location.",
      };
    }
    return {
      scope: "default",
      effectiveLocation: null,
      reason: "Direct location query, but live device location is unavailable and no saved default location is configured.",
    };
  }

  // 5. Explicit location extraction from current prompt
  // Matches "in <City>", "near <City>", "around <City>", "for <City>", "at <City>", "to <City>"
  const explicitLocationRegex = /\b(?:in|near|around|at|for|to|check|about)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})/i;
  const explicitMatch = text.match(explicitLocationRegex);
  let explicitTarget: string | null = null;

  if (explicitMatch && explicitMatch[1]) {
    const rawCandidate = explicitMatch[1].replace(/[.,?!]+$/, "").trim();
    const stopWords = new Set(["and", "then", "with", "or", "the", "a", "an", "but", "so"]);
    const filteredWords: string[] = [];
    for (const w of rawCandidate.split(/\s+/)) {
      if (stopWords.has(w.toLowerCase())) break;
      filteredWords.push(w);
    }
    const cleanTarget = filteredWords.join(" ").trim();
    if (cleanTarget) {
      const firstWord = cleanTarget.split(/\s+/)[0].toLowerCase();
      if (!nonLocations.has(firstWord) && !nonLocations.has(cleanTarget.toLowerCase())) {
        // Normalize casing nicely (Title Case)
        explicitTarget = cleanTarget.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      }
    }
  }

  if (explicitTarget) {
    const explicitLocation: UserLocation = {
      city: explicitTarget,
      provenance: "USER_EXPLICIT",
      source: "user_set",
      enabled: true,
      updatedAt: Date.now(),
    };
    return {
      scope: "explicit_override",
      effectiveLocation: explicitLocation,
      explicitLocationName: explicitTarget,
      isTravelDestination: hasTravel,
      reason: `User explicitly specified destination/location: "${explicitTarget}".`,
    };
  }

  // 6. Multi-turn location reuse: if previous turn used explicit location and user asks follow-up
  const followUpReusePattern = /\b(?:there|same\s+(?:city|location|place|area|neighborhood)|in\s+that\s+(?:same\s+)?(?:city|place|area|neighborhood)|tomorrow|yesterday|today|tonight|this\s+weekend|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
  if (previousExplicitLocation && followUpReusePattern.test(text)) {
    const reusedLocation: UserLocation = {
      city: previousExplicitLocation,
      provenance: "CONVERSATION_CONTEXT",
      source: "user_set",
      enabled: true,
      updatedAt: Date.now(),
    };
    return {
      scope: "explicit_override",
      effectiveLocation: reusedLocation,
      explicitLocationName: previousExplicitLocation,
      isTravelDestination: hasTravel,
      reason: `Reusing explicit location from previous context: "${previousExplicitLocation}".`,
    };
  }

  if (hasTravel) {
    return {
      scope: "destination",
      effectiveLocation: defaultLocation?.enabled !== false && defaultLocation?.provenance === "SAVED_USER" ? defaultLocation : null,
      isTravelDestination: true,
      reason: "Travel or lodging request without destination specified; location may act as origin or prompt for destination.",
    };
  }

  // 7. Geographically-relevant requests
  const localRelevanceKeywords = [
    /\b(?:restaurant|restaurants|food|cafe|dining|dinner|lunch|breakfast|brunch|pizza|burger|coffee|bakery|diner)\b/i,
    /\b(?:pharmacy|pharmacies|chemist|drugstore|hospital|clinic|doctor|dentist)\b/i,
    /\b(?:supermarket|grocery|groceries|store|stores|shop|shops|mall|market)\b/i,
    /\b(?:weather|temperature|forecast|rain|snow|humidity)\b/i,
    /\b(?:deals?|discounts?|offers?|coupons?|sales?)\b/i,
    /\b(?:laptop|phone|tv|electronics|gadget|monitor|appliance|hardware)\b/i,
    /\b(?:supplement|supplements|vitamins?|whey|creatine|protein)\b/i,
    /\b(?:plumber|electrician|locksmith|mechanic|repair|services?|gym|fitness)\b/i,
    /\b(?:delivery|shipping|uber|cab|taxi|courier)\b/i,
    /\b(?:directions?|navigate|navigation|route|routes|commute|traffic|transit|maps?|nearby|closest|near\s+me)\b/i,
  ];

  const isLocalRelevant = localRelevanceKeywords.some((p) => p.test(text));

  if (isLocalRelevant) {
    if (defaultLocation && defaultLocation.enabled !== false && (defaultLocation.provenance === "SAVED_USER" || defaultLocation.provenance === "DEVICE_LIVE" || defaultLocation.provenance === "CONVERSATION_CONTEXT")) {
      return {
        scope: "default",
        effectiveLocation: defaultLocation,
        reason: defaultLocation.provenance === "DEVICE_LIVE"
          ? "Geographically relevant request; interpreted with live device GPS location."
          : defaultLocation.provenance === "SAVED_USER"
          ? "Geographically relevant request; interpreted with persistent user location."
          : "Geographically relevant request; interpreted with active conversation location.",
      };
    } else {
      return {
        scope: "default",
        effectiveLocation: null,
        reason: "Geographically relevant request, but no valid location is configured or enabled.",
      };
    }
  }

  // 8. Unrelated tasks (coding, mathematics, creative writing, science)
  return {
    scope: "unrelated",
    effectiveLocation: null,
    reason: "Unrelated task without geographic dependency; location context should not be exposed.",
  };
}

/**
 * Builds the structural system prompt block for user location context.
 */
export function formatLocationPromptBlock(location: UserLocation | null): string {
  if (!location || location.enabled === false || location.provenance === "UNKNOWN/UNAVAILABLE") {
    return (
      " PERSISTENT USER LOCATION CONTEXT:\n" +
      "- Status: UNKNOWN/UNAVAILABLE (Provenance: UNKNOWN/UNAVAILABLE)\n" +
      "- Live device location: UNAVAILABLE (no live GPS reading is active).\n" +
      "- Saved default location: NONE (the user has NOT configured a default location).\n" +
      "- MANDATORY INVARIANTS:\n" +
      "  1. ZERO FABRICATION: You MUST NEVER invent, fabricate, assume, or guess a user location. NEVER substitute any arbitrary, demo, mock, or unconfigured location.\n" +
      "  2. Direct Location Questions: If the user asks 'Where am I?', 'What is my location?', 'Check my current location', 'Check my new location', or asks for nearby recommendations ('what's near me?', 'weather here') without specifying a city:\n" +
      "     You MUST state plainly and truthfully that live location access is unavailable and no default location has been configured.\n" +
      "  3. Explicit User Context: The user may provide an explicit location for any query (e.g. 'restaurants in Seattle') or ask to save a default location.\n" +
      "  4. Non-Geographic Tasks: For unrelated tasks (coding, math, general science, creative writing), NEVER mention or speculate about location."
    );
  }

  const parts: string[] = [];
  if (location.city) parts.push(`City: ${location.city}`);
  if (location.region) parts.push(`Region/State: ${location.region}`);
  if (location.country) parts.push(`Country: ${location.country}${location.countryCode ? ` [${location.countryCode}]` : ""}`);
  if (location.postalCode) parts.push(`Postal Code: ${location.postalCode}`);
  if (location.latitude !== undefined && location.longitude !== undefined) {
    parts.push(`Coordinates: ${location.latitude}, ${location.longitude}`);
  }
  parts.push(`Provenance: ${location.provenance || "SAVED_USER"}`);

  if (location.provenance === "DEVICE_LIVE") {
    return (
      " PERSISTENT USER LOCATION CONTEXT (Live device reading):\n" +
      `- Status: LIVE_DEVICE_ACTIVE (Provenance: DEVICE_LIVE)\n` +
      `- Live Device Location: ${parts.join(", ")}\n` +
      `- Live device location: ACTIVE (real-time GPS/network fix from device).\n` +
      `- Saved default location: NOT CONFIGURED (or secondary to live GPS).\n` +
      `- MANDATORY INVARIANTS:\n` +
      `  1. Real-time Device Inquiries: When the user asks 'Where am I?', 'What's near me?', 'What's the weather here?', or asks for nearby places, use this LIVE device location.\n` +
      `  2. Explicit Override: When the user explicitly names a different city (e.g. 'restaurants in Tokyo'), that explicit location overrides this device location for that task.\n` +
      `  3. Transient Nature: This live device location is transient and does NOT automatically alter the user's permanent saved default location.\n` +
      `  4. Privacy & Unrelated Tasks: Do NOT mention or inject location into unrelated tasks (coding, math, general science, creative writing).\n` +
      `  5. ZERO FABRICATION: Never invent streets, coordinates, or postal codes beyond this verified reading.`
    );
  }

  if (location.provenance === "CONVERSATION_CONTEXT") {
    return (
      " PERSISTENT USER LOCATION CONTEXT (Conversation-scoped context):\n" +
      `- Status: CONVERSATION_ONLY (Provenance: CONVERSATION_CONTEXT)\n` +
      `- In-Conversation Location: ${parts.join(", ")}\n` +
      `- Scope: ACTIVE THREAD ONLY (this location was mentioned during the active conversation, NOT saved as user default).\n` +
      `- Live device location: UNAVAILABLE.\n` +
      `- MANDATORY INVARIANTS:\n` +
      `  1. Conversation Scope: Use this location for follow-up requests in this conversation (e.g. 'what about tomorrow?', 'what's near there?').\n` +
      `  2. Thread Isolation: Do NOT leak or carry this location over to other bots, other chats, or after restart.\n` +
      `  3. Explicit Override: If the user names a new location, switch to the new location.\n` +
      `  4. Privacy & Unrelated Tasks: Never mention location for unrelated tasks.\n` +
      `  5. ZERO FABRICATION: Never fabricate location details.`
    );
  }

  if (location.provenance === "USER_EXPLICIT") {
    return (
      " PERSISTENT USER LOCATION CONTEXT (Turn-specific explicit location):\n" +
      `- Status: EXPLICIT_OVERRIDE (Provenance: USER_EXPLICIT)\n` +
      `- Explicit Target Location: ${parts.join(", ")}\n` +
      `- Scope: CURRENT TURN ONLY.\n` +
      `- MANDATORY INVARIANTS:\n` +
      `  1. Immediate Priority: This explicitly specified location takes precedence over all other locations for this turn.\n` +
      `  2. Non-Persistent: This is NOT the user's home or saved default location unless they explicitly ask to save it.`
    );
  }

  return (
    ` PERSISTENT USER LOCATION CONTEXT (Durable user context across all bots and turns):\n` +
    `- Status: CONFIGURED (Provenance: ${location.provenance || "SAVED_USER"})\n` +
    `- Saved Default Location: ${parts.join(", ")}\n` +
    `- Live device location: UNAVAILABLE (this is the user's saved default setting, NOT a live GPS reading).\n` +
    `- MANDATORY INVARIANTS:\n` +
    `  1. Location-Relevant Requests: For queries where geographic location naturally influences results (e.g. 'weather', 'find a pharmacy', 'good restaurant') and no explicit city is named, interpret the request in the context of this saved default location.\n` +
    `  2. Explicit Override: When the user explicitly mentions a city or country in their request (e.g. 'restaurants in Mumbai', 'weather in Seattle'), that explicit location MUST completely override this default location for that task.\n` +
    `  3. Live Location Clarification: If the user explicitly asks for live device location ('check my GPS', 'what is my live location?'), clarify that live device location is unavailable and this is their saved default location.\n` +
    `  4. Travel / Lodging: When the user asks for travel, flights, or hotels without destination specified, consider this location as the potential origin or ask for the destination.\n` +
    `  5. Suppression: If the user says 'don't use my location', 'search globally', or 'ignore my location', suppress this location completely for that request.\n` +
    `  6. Discretion & Privacy: Do NOT needlessly mention or inject the user's location on unrelated tasks (coding, math, general science, creative writing).\n` +
    `  7. ZERO FABRICATION: Never invent fake street addresses, coordinates, or postal codes beyond what is registered.`
  );
}

/**
 * Localizes a search query when appropriate, avoiding duplicate location terms.
 */
export function localizeSearchQuery(query: string, location: UserLocation | null): string {
  const trimmed = (query || "").trim();
  if (!trimmed || !location || location.enabled === false || location.provenance === "UNKNOWN/UNAVAILABLE") return trimmed;

  const intent = resolveLocationIntent(trimmed, location);
  if (intent.scope === "suppressed" || intent.scope === "unrelated") return trimmed;
  if (intent.scope === "explicit_override") return trimmed; // Already has explicit location

  const locName = location.city || location.region || location.country;
  if (!locName) return trimmed;

  // If query already contains the location name, don't duplicate
  if (trimmed.toLowerCase().includes(locName.toLowerCase())) return trimmed;

  return `${trimmed} ${locName}`;
}

export interface LocationPrecedenceOptions {
  userText: string;
  liveDeviceLocation?: UserLocation | null;
  savedUserLocation?: UserLocation | null;
  conversationLocation?: UserLocation | null;
  previousExplicitLocation?: string;
}

/**
 * Resolves the effective location decision across all 5 provenance sources according
 * to strict provenance precedence:
 * USER_EXPLICIT > DEVICE_LIVE > SAVED_USER > CONVERSATION_CONTEXT > UNKNOWN/UNAVAILABLE
 */
export function resolveEffectiveLocation(options: LocationPrecedenceOptions): ResolvedLocationRequest {
  const { userText, liveDeviceLocation, savedUserLocation, conversationLocation, previousExplicitLocation } = options;
  const text = (userText || "").trim();

  // 1. Suppression checks take absolute precedence
  const suppression = resolveLocationIntent(text, null);
  if (suppression.scope === "suppressed") {
    return suppression;
  }

  // 2. Explicit location extracted from current user query (USER_EXPLICIT)
  const explicitIntent = resolveLocationIntent(text, null);
  if (explicitIntent.scope === "explicit_override" && explicitIntent.effectiveLocation?.provenance === "USER_EXPLICIT") {
    return explicitIntent;
  }

  // 3. Direct location inquiry: "where am I?", "what's my location?", "check my location"
  const directLocationQueryPattern = /\b(?:where\s+am\s+i|what(?:'s|\s+is)\s+my\s+(?:current\s+|new\s+|saved\s+)?location|check\s+my\s+(?:current\s+|new\s+|saved\s+)?location|my\s+current\s+location|what(?:'s|\s+is)\s+near\s+me)\b/i;
  if (directLocationQueryPattern.test(text)) {
    // DEVICE_LIVE takes top precedence for real-time where-am-I queries
    if (liveDeviceLocation && liveDeviceLocation.enabled !== false && liveDeviceLocation.provenance === "DEVICE_LIVE") {
      return {
        scope: "default",
        effectiveLocation: liveDeviceLocation,
        reason: "Direct location query; answered with live device GPS location.",
      };
    }
    // SAVED_USER is persistent fallback
    if (savedUserLocation && savedUserLocation.enabled !== false && savedUserLocation.provenance === "SAVED_USER") {
      return {
        scope: "default",
        effectiveLocation: savedUserLocation,
        reason: "Direct location query; live GPS unavailable, answered with saved default user location.",
      };
    }
    // CONVERSATION_CONTEXT is next fallback for active conversation
    if (conversationLocation && conversationLocation.enabled !== false && conversationLocation.provenance === "CONVERSATION_CONTEXT") {
      return {
        scope: "default",
        effectiveLocation: conversationLocation,
        reason: "Direct location query; answered with active conversation location.",
      };
    }
    return {
      scope: "default",
      effectiveLocation: null,
      reason: "Direct location query, but live device location is unavailable and no saved default location is configured.",
    };
  }

  // 4. Follow-up / multi-turn reuse check (CONVERSATION_CONTEXT)
  const contextTarget = previousExplicitLocation || conversationLocation?.city;
  if (contextTarget) {
    const followUpIntent = resolveLocationIntent(text, null, contextTarget);
    if (followUpIntent.scope === "explicit_override") {
      return followUpIntent;
    }
  }

  // 5. Geographically-relevant queries (weather, restaurants, maps, nearby)
  // Precedence: DEVICE_LIVE > SAVED_USER > CONVERSATION_CONTEXT
  const baseLoc = (liveDeviceLocation && liveDeviceLocation.enabled !== false && liveDeviceLocation.provenance === "DEVICE_LIVE")
    ? liveDeviceLocation
    : (savedUserLocation && savedUserLocation.enabled !== false && savedUserLocation.provenance === "SAVED_USER")
    ? savedUserLocation
    : (conversationLocation && conversationLocation.enabled !== false && conversationLocation.provenance === "CONVERSATION_CONTEXT")
    ? conversationLocation
    : null;

  return resolveLocationIntent(text, baseLoc);
}


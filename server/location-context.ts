import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  source?: "ip" | "device" | "profile" | "user_set" | "timezone_inferred";
  updatedAt?: number;
  enabled?: boolean;
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
 * string fields are bounded and trimmed, and eliminates invalid or corrupted records.
 */
export function validateUserLocation(raw: unknown): UserLocation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

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

  const validSources = new Set(["ip", "device", "profile", "user_set", "timezone_inferred"]);
  const source = typeof obj.source === "string" && validSources.has(obj.source)
    ? (obj.source as UserLocation["source"])
    : undefined;

  const enabled = obj.enabled === false ? false : true;
  const updatedAt = typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
    ? obj.updatedAt
    : Date.now();

  // If everything is blank and no coordinates/timezone, it's invalid
  if (!city && !region && !country && !countryCode && !postalCode && latitude === undefined && !timezone) {
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
    updatedAt,
    enabled,
  };
}

/**
 * Loads persistent user location from ~/.openmausbot/user-location.json or fallback profile/env.
 */
export function loadUserLocation(customDataDir: string = DATA_DIR): UserLocation | null {
  const filePath = join(customDataDir, LOCATION_FILE);
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      const validated = validateUserLocation(parsed);
      if (validated) return validated;
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
        if (validated) return validated;
      }
    } catch {
      // ignore
    }
  }

  // System timezone fallback as legitimate coarse location context
  // NOTE: Timezone identifier (e.g. Asia/Kolkata, America/Chicago) only provides the timezone
  // and continental area. It must NEVER be used to guess a specific city, as that would
  // fabricate location precision beyond what is legitimately known.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") {
      const parts = tz.includes("/") ? tz.split("/") : [];
      const region = parts.length > 0 ? parts[0] : undefined;
      return {
        region,
        timezone: tz,
        source: "timezone_inferred",
        enabled: true,
        updatedAt: Date.now(),
      };
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Persists user location to ~/.openmausbot/user-location.json atomically.
 */
export function saveUserLocation(location: UserLocation, customDataDir: string = DATA_DIR): boolean {
  const validated = validateUserLocation(location);
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
 * Clears or disables user location.
 */
export function disableUserLocation(customDataDir: string = DATA_DIR): void {
  const current = loadUserLocation(customDataDir) || {};
  saveUserLocation({ ...current, enabled: false }, customDataDir);
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
  defaultLocation: UserLocation | null
): ResolvedLocationRequest {
  const text = (userText || "").trim();

  // 1. Explicit suppression checks
  const suppressionPatterns = [
    /(?:don't|do not|never|stop)\s+(?:use|track|share|need)\s+(?:my\s+)?(?:location|city|country|gps)/i,
    /search\s+globally/i,
    /without\s+(?:my\s+)?location/i,
    /ignore\s+(?:my\s+)?location/i,
    /globally\s+rather\s+than\s+locally/i,
    /no\s+location\s+context/i,
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

  // 3. Explicit location override in the prompt
  // Matches "in <City>", "near <City>", "around <City>", "for <Country>", "at <City>"
  // Handles single or multi-word capitalized place names, e.g., "in Mumbai", "near Tokyo", "in San Francisco"
  const explicitLocationRegex = /\b(?:in|near|around|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/;
  const explicitMatch = text.match(explicitLocationRegex);

  if (explicitMatch && explicitMatch[1]) {
    const rawTarget = explicitMatch[1].replace(/[.,?!]+$/, "").trim();
    // Filter out common non-location words that follow "in" (e.g. "in Python", "in general", "in English", "in markdown")
    const nonLocations = new Set([
      "python", "javascript", "typescript", "java", "rust", "c", "c++", "go", "kotlin",
      "english", "spanish", "french", "german", "hindi",
      "general", "detail", "summary", "brief", "short", "bullet", "bullets", "markdown",
      "code", "practice", "theory", "reality", "addition", "advance", "fact",
    ]);

    if (!nonLocations.has(rawTarget.toLowerCase())) {
      const explicitLocation: UserLocation = {
        city: rawTarget,
        source: "user_set",
        enabled: true,
        updatedAt: Date.now(),
      };
      return {
        scope: "explicit_override",
        effectiveLocation: explicitLocation,
        explicitLocationName: rawTarget,
        isTravelDestination: hasTravel,
        reason: `User explicitly specified destination/location: "${rawTarget}".`,
      };
    }
  }

  if (hasTravel) {
    return {
      scope: "destination",
      effectiveLocation: defaultLocation?.enabled !== false ? defaultLocation : null,
      isTravelDestination: true,
      reason: "Travel or lodging request without destination specified; location may act as origin or prompt for destination.",
    };
  }

  // 4. Geographically-relevant requests
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
  ];

  const isLocalRelevant = localRelevanceKeywords.some((p) => p.test(text));

  if (isLocalRelevant) {
    if (defaultLocation && defaultLocation.enabled !== false) {
      return {
        scope: "default",
        effectiveLocation: defaultLocation,
        reason: "Geographically relevant request; interpreted with persistent user location.",
      };
    } else {
      return {
        scope: "default",
        effectiveLocation: null,
        reason: "Geographically relevant request, but no valid location is configured or enabled.",
      };
    }
  }

  // 5. Unrelated tasks (coding, mathematics, creative writing, science)
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
  if (!location || location.enabled === false) {
    return (
      " PERSISTENT USER LOCATION CONTEXT: Location context is currently unconfigured or suppressed by user preference.\n" +
      " When a task requires geographic context (e.g., local recommendations, services, or local deals), do NOT assume or invent a location; ask the user or provide general recommendations."
    );
  }

  const parts: string[] = [];
  if (location.city) {
    parts.push(`City: ${location.city}`);
  } else {
    parts.push(`Specific City: Unknown (do NOT guess or assume specific city)`);
  }
  if (location.region) parts.push(`Region/State: ${location.region}`);
  if (location.country) parts.push(`Country: ${location.country}${location.countryCode ? ` [${location.countryCode}]` : ""}`);
  if (location.postalCode) parts.push(`Postal Code: ${location.postalCode}`);
  if (location.timezone) parts.push(`Timezone: ${location.timezone}`);
  if (location.source) parts.push(`Provenance: ${location.source}`);

  return (
    ` PERSISTENT USER LOCATION CONTEXT (Durable user context across all bots and turns):\n` +
    `- Default Location: ${parts.join(", ")}\n` +
    `- HOW TO USE LOCATION CONTEXT:\n` +
    `  1. Location-Relevant Requests: For queries where geographic location naturally influences availability, pricing, currency, retailers, stores, services, dining, weather, or delivery (e.g. 'find me a pharmacy', 'good restaurant', 'find me the best laptop', 'best deals'), interpret the request in the context of this default location.\n` +
    `  2. Specific City Unknown: If specific city is Unknown, do NOT invent or guess one from the timezone. If hyper-local details are strictly required, ask the user or provide general options.\n` +
    `  3. Explicit Override: When the user explicitly mentions a city, region, or country in their request (e.g. 'restaurants in Mumbai', 'laptops in US stores'), that explicit location MUST completely override the default location for that task.\n` +
    `  4. Travel / Lodging: When the user asks for travel, flights, or hotels (e.g. 'find me a hotel'), consider this location as the potential origin or ask for the travel destination if not stated.\n` +
    `  5. Suppression: If the user says 'don't use my location', 'search globally', or 'ignore my location', suppress this location completely for that request.\n` +
    `  6. Discretion & Privacy: Do NOT needlessly announce, recite, or inject the user's location on unrelated tasks (e.g. coding, math, general science, creative writing). Never say 'Since you are in [City]...' unless location is directly relevant to what the user asked for.\n` +
    `  7. Zero Fabrication: Never invent fake street addresses, coordinates, or postal codes beyond what is registered.`
  );
}

/**
 * Localizes a search query when appropriate, avoiding duplicate location terms.
 */
export function localizeSearchQuery(query: string, location: UserLocation | null): string {
  const trimmed = (query || "").trim();
  if (!trimmed || !location || location.enabled === false) return trimmed;

  const intent = resolveLocationIntent(trimmed, location);
  if (intent.scope === "suppressed" || intent.scope === "unrelated") return trimmed;
  if (intent.scope === "explicit_override") return trimmed; // Already has explicit location

  const locName = location.city || location.region || location.country;
  if (!locName) return trimmed;

  // If query already contains the location name, don't duplicate
  if (trimmed.toLowerCase().includes(locName.toLowerCase())) return trimmed;

  return `${trimmed} ${locName}`;
}

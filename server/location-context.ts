import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export type ProvenanceSource =
  | "DEVICE_LIVE"
  | "USER_EXPLICIT"
  | "SAVED_USER"
  | "CONVERSATION_CONTEXT"
  | "UNKNOWN/UNAVAILABLE";

export type LocationProvenance = ProvenanceSource;

export interface ProvenanceRecord<T> {
  value: T;
  source: ProvenanceSource;
  confidenceScore: number;
  collectedAtMs: number;
  expiresAtMs: number;
  verificationEvidence?: string;
  isSyntheticOrFixture: boolean;
}

export interface ProvenanceDiagnostic {
  code: "ERR_PROVENANCE_CONTAMINATION" | "ERR_PROVENANCE_STALE" | "ERR_PROVENANCE_INVALID";
  message: string;
  timestamp: number;
  source?: ProvenanceSource;
  isSynthetic?: boolean;
  evidence?: string;
}

export class ProvenanceContaminationError extends Error {
  readonly code = "ERR_PROVENANCE_CONTAMINATION";
  readonly diagnostic?: ProvenanceDiagnostic;
  constructor(message: string, diagnostic?: ProvenanceDiagnostic) {
    super(message);
    this.name = "ProvenanceContaminationError";
    this.diagnostic = diagnostic;
  }
}

export class ProvenanceStaleError extends Error {
  readonly code = "ERR_PROVENANCE_STALE";
  readonly diagnostic?: ProvenanceDiagnostic;
  constructor(message: string, diagnostic?: ProvenanceDiagnostic) {
    super(message);
    this.name = "ProvenanceStaleError";
    this.diagnostic = diagnostic;
  }
}

const recentProvenanceDiagnostics: ProvenanceDiagnostic[] = [];

export function recordProvenanceDiagnostic(diag: ProvenanceDiagnostic): void {
  recentProvenanceDiagnostics.push(diag);
  if (recentProvenanceDiagnostics.length > 50) {
    recentProvenanceDiagnostics.shift();
  }
}

export function getLastProvenanceDiagnostic(): ProvenanceDiagnostic | null {
  return recentProvenanceDiagnostics.length > 0
    ? recentProvenanceDiagnostics[recentProvenanceDiagnostics.length - 1]
    : null;
}

export function getRecentProvenanceDiagnostics(): ProvenanceDiagnostic[] {
  return [...recentProvenanceDiagnostics];
}

export function clearProvenanceDiagnostics(): void {
  recentProvenanceDiagnostics.length = 0;
}

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  provenance: ProvenanceSource;
  source?: "ip" | "device" | "profile" | "user_set" | "timezone_inferred";
  updatedAt?: number;
  enabled?: boolean;
  isFixture?: boolean;
  isSyntheticOrFixture?: boolean;
  confidenceScore?: number;
  collectedAtMs?: number;
  expiresAtMs?: number;
  verificationEvidence?: string;
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
 * Validates a ProvenanceRecord strictly:
 * - source is one of the 5 canonical ProvenanceSource values
 * - confidenceScore is numeric, finite, and strictly bounded to [0.00, 1.00]
 * - collectedAtMs and expiresAtMs are real positive timestamps
 * - expiresAtMs >= collectedAtMs
 * - isSyntheticOrFixture is boolean
 */
export function validateProvenanceRecord<T>(raw: unknown): ProvenanceRecord<T> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const validSources = new Set<ProvenanceSource>([
    "DEVICE_LIVE",
    "USER_EXPLICIT",
    "SAVED_USER",
    "CONVERSATION_CONTEXT",
    "UNKNOWN/UNAVAILABLE",
  ]);

  if (typeof r.source !== "string" || !validSources.has(r.source as ProvenanceSource)) {
    return null;
  }

  if (
    typeof r.confidenceScore !== "number" ||
    !Number.isFinite(r.confidenceScore) ||
    r.confidenceScore < 0.0 ||
    r.confidenceScore > 1.0
  ) {
    return null;
  }

  if (
    typeof r.collectedAtMs !== "number" ||
    !Number.isFinite(r.collectedAtMs) ||
    r.collectedAtMs <= 0
  ) {
    return null;
  }

  if (
    typeof r.expiresAtMs !== "number" ||
    !Number.isFinite(r.expiresAtMs) ||
    r.expiresAtMs <= 0 ||
    r.expiresAtMs < r.collectedAtMs
  ) {
    return null;
  }

  if (typeof r.isSyntheticOrFixture !== "boolean") {
    return null;
  }

  let verificationEvidence: string | undefined;
  if (typeof r.verificationEvidence === "string") {
    verificationEvidence = r.verificationEvidence.trim();
  }

  return {
    value: r.value as T,
    source: r.source as ProvenanceSource,
    confidenceScore: r.confidenceScore,
    collectedAtMs: r.collectedAtMs,
    expiresAtMs: r.expiresAtMs,
    verificationEvidence,
    isSyntheticOrFixture: r.isSyntheticOrFixture,
  };
}

/**
 * Creates a canonical ProvenanceRecord with validated bounds.
 * Enforces fail-closed validation: invalid confidence values (negative, > 1.0, NaN, Infinity)
 * are rejected with ERR_PROVENANCE_INVALID and return null rather than being silently clamped.
 */
export function createProvenanceRecord<T>(params: {
  value: T;
  source: ProvenanceSource;
  confidenceScore: number;
  collectedAtMs?: number;
  expiresAtMs?: number;
  ttlMs?: number;
  verificationEvidence?: string;
  isSyntheticOrFixture?: boolean;
}): ProvenanceRecord<T> | null {
  const validSources = new Set<ProvenanceSource>([
    "DEVICE_LIVE",
    "USER_EXPLICIT",
    "SAVED_USER",
    "CONVERSATION_CONTEXT",
    "UNKNOWN/UNAVAILABLE",
  ]);

  if (!params || !validSources.has(params.source)) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_INVALID",
      message: `Invalid provenance source: ${params?.source}`,
      timestamp: Date.now(),
    });
    return null;
  }

  const confidence = params.confidenceScore;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0.0 ||
    confidence > 1.0
  ) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_INVALID",
      message: `Invalid confidence score: ${confidence}`,
      timestamp: Date.now(),
      source: params.source,
    });
    return null;
  }

  const now = Date.now();
  const collected = params.collectedAtMs ?? now;
  if (typeof collected !== "number" || !Number.isFinite(collected) || collected <= 0) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_INVALID",
      message: `Invalid collectedAtMs timestamp: ${collected}`,
      timestamp: now,
      source: params.source,
    });
    return null;
  }

  const ttl = params.ttlMs ?? (params.source === "DEVICE_LIVE" ? 300_000 : 86_400_000 * 30);
  const expires = params.expiresAtMs ?? (collected + ttl);
  if (typeof expires !== "number" || !Number.isFinite(expires) || expires < collected) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_INVALID",
      message: `Invalid expiresAtMs timestamp: ${expires} (collected: ${collected})`,
      timestamp: now,
      source: params.source,
    });
    return null;
  }

  return {
    value: params.value,
    source: params.source,
    confidenceScore: confidence,
    collectedAtMs: collected,
    expiresAtMs: expires,
    verificationEvidence: params.verificationEvidence?.trim() || undefined,
    isSyntheticOrFixture: Boolean(params.isSyntheticOrFixture),
  };
}

/**
 * Checks if a provenance record is still fresh according to its expiration time.
 */
export function isProvenanceFresh<T>(record: ProvenanceRecord<T>, referenceTimeMs?: number): boolean {
  const now = referenceTimeMs ?? Date.now();
  return now <= record.expiresAtMs;
}

/**
 * Freshness check that automatically records ERR_PROVENANCE_STALE and downgrades
 * expired DEVICE_LIVE records to UNKNOWN/UNAVAILABLE per Invariant 2.
 */
export function checkProvenanceFreshness<T>(
  record: ProvenanceRecord<T>,
  referenceTimeMs?: number
): { fresh: boolean; record: ProvenanceRecord<T> } {
  const now = referenceTimeMs ?? Date.now();
  if (now <= record.expiresAtMs) {
    return { fresh: true, record };
  }

  recordProvenanceDiagnostic({
    code: "ERR_PROVENANCE_STALE",
    message: `Provenance record of source ${record.source} expired at ${record.expiresAtMs} (now: ${now})`,
    timestamp: now,
    source: record.source,
  });

  if (record.source === "DEVICE_LIVE") {
    const downgraded: ProvenanceRecord<T> = {
      ...record,
      source: "UNKNOWN/UNAVAILABLE",
      confidenceScore: 0.0,
      verificationEvidence: "Downgraded from stale DEVICE_LIVE reading",
    };
    return { fresh: false, record: downgraded };
  }

  return { fresh: false, record };
}

/**
 * Converts a UserLocation into a canonical ProvenanceRecord.
 */
export function toLocationProvenanceRecord(loc: UserLocation): ProvenanceRecord<UserLocation> {
  const now = Date.now();
  const collected = loc.collectedAtMs || loc.updatedAt || now;
  const isLive = loc.provenance === "DEVICE_LIVE";
  const ttl = isLive ? 300_000 : 86_400_000 * 30;
  const expires = loc.expiresAtMs || (collected + ttl);
  const confidence = loc.confidenceScore !== undefined
    ? loc.confidenceScore
    : (loc.provenance === "USER_EXPLICIT" ? 1.0 : loc.provenance === "DEVICE_LIVE" ? 0.98 : loc.provenance === "SAVED_USER" ? 0.90 : loc.provenance === "CONVERSATION_CONTEXT" ? 0.75 : 0.0);

  return {
    value: loc,
    source: loc.provenance,
    confidenceScore: confidence,
    collectedAtMs: collected,
    expiresAtMs: expires,
    verificationEvidence: loc.verificationEvidence,
    isSyntheticOrFixture: Boolean(loc.isFixture || loc.isSyntheticOrFixture),
  };
}

/**
 * Validates a location object: ensures numbers are finite and in geographic bounds,
 * string fields are bounded and trimmed, provenance is verified, and eliminates
 * invalid, corrupted, or fixture records.
 */
export function validateUserLocation(raw: unknown): UserLocation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // Reject test fixture or synthetic objects from being treated as real saved user locations
  if (obj.isFixture === true || obj.isSyntheticOrFixture === true || obj.test === true) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_CONTAMINATION",
      message: "Rejected synthetic or fixture location from being treated as production user location",
      timestamp: Date.now(),
      isSynthetic: true,
      source: (obj.source as ProvenanceSource) || (obj.provenance as ProvenanceSource) || "UNKNOWN/UNAVAILABLE",
    });
    return null;
  }

  // Timezone inference is strictly non-authoritative and must never be saved as real user location
  if (obj.source === "timezone_inferred") {
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

  // If latitude is provided, it must be valid and within [-90, 90]
  if (obj.latitude !== undefined) {
    if (typeof obj.latitude !== "number" || !Number.isFinite(obj.latitude) || obj.latitude < -90 || obj.latitude > 90) {
      return null;
    }
  }

  // If longitude is provided, it must be valid and within [-180, 180]
  if (obj.longitude !== undefined) {
    if (typeof obj.longitude !== "number" || !Number.isFinite(obj.longitude) || obj.longitude < -180 || obj.longitude > 180) {
      return null;
    }
  }

  // If confidenceScore is provided, it must be finite and within [0.00, 1.00]
  let confidenceScore: number | undefined;
  if (obj.confidenceScore !== undefined) {
    if (
      typeof obj.confidenceScore !== "number" ||
      !Number.isFinite(obj.confidenceScore) ||
      obj.confidenceScore < 0.0 ||
      obj.confidenceScore > 1.0
    ) {
      return null;
    }
    confidenceScore = obj.confidenceScore;
  }

  const city = cleanString(obj.city);
  const region = cleanString(obj.region);
  const country = cleanString(obj.country);
  const countryCode = cleanString(obj.countryCode, 10)?.toUpperCase();
  const postalCode = cleanString(obj.postalCode, 20);
  const timezone = cleanString(obj.timezone, 60);

  const latitude = cleanNumber(obj.latitude, -90, 90);
  const longitude = cleanNumber(obj.longitude, -180, 180);

  const validProvenances = new Set<ProvenanceSource>([
    "DEVICE_LIVE",
    "USER_EXPLICIT",
    "SAVED_USER",
    "CONVERSATION_CONTEXT",
    "UNKNOWN/UNAVAILABLE",
  ]);

  let provenance: ProvenanceSource = "SAVED_USER";
  if (typeof obj.provenance === "string" && validProvenances.has(obj.provenance as ProvenanceSource)) {
    provenance = obj.provenance as ProvenanceSource;
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

  const collectedAtMs = typeof obj.collectedAtMs === "number" && Number.isFinite(obj.collectedAtMs)
    ? obj.collectedAtMs
    : updatedAt;

  const expiresAtMs = typeof obj.expiresAtMs === "number" && Number.isFinite(obj.expiresAtMs)
    ? obj.expiresAtMs
    : (updatedAt + (provenance === "DEVICE_LIVE" ? 300_000 : 86_400_000 * 30));

  const verificationEvidence = typeof obj.verificationEvidence === "string"
    ? obj.verificationEvidence.trim()
    : undefined;

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
    ...(confidenceScore !== undefined ? { confidenceScore } : {}),
    ...(collectedAtMs !== undefined ? { collectedAtMs } : {}),
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    ...(verificationEvidence ? { verificationEvidence } : {}),
    isSyntheticOrFixture: false,
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
 * Intercepts synthetic/fixture records with ERR_PROVENANCE_CONTAMINATION.
 */
export function saveUserLocation(
  location: UserLocation | ProvenanceRecord<UserLocation>,
  customDataDir: string = DATA_DIR,
  options?: { throwOnError?: boolean },
): boolean {
  if (customDataDir === DATA_DIR && (process.env.VITEST || process.env.NODE_ENV === "test")) {
    throw new Error("Tests must NEVER mutate production DATA_DIR! Provide an isolated fixture directory.");
  }

  // Intercept synthetic / test fixture contamination before writing to disk
  const rawObj = location as unknown as Record<string, unknown>;
  const isSynthetic =
    rawObj.isSyntheticOrFixture === true ||
    rawObj.isFixture === true ||
    rawObj.test === true ||
    (rawObj.value && typeof rawObj.value === "object" && (
      (rawObj.value as any).isSyntheticOrFixture === true ||
      (rawObj.value as any).isFixture === true ||
      (rawObj.value as any).test === true
    ));

  if (isSynthetic) {
    const diag: ProvenanceDiagnostic = {
      code: "ERR_PROVENANCE_CONTAMINATION",
      message: "Blocked attempt to persist synthetic or fixture location to production storage",
      timestamp: Date.now(),
      isSynthetic: true,
      source: (rawObj.source as ProvenanceSource) || (rawObj.provenance as ProvenanceSource) || "UNKNOWN/UNAVAILABLE",
    };
    recordProvenanceDiagnostic(diag);
    if (options?.throwOnError) {
      throw new ProvenanceContaminationError(diag.message, diag);
    }
    return false;
  }

  // Extract actual UserLocation object if wrapped in ProvenanceRecord
  const loc: UserLocation = (rawObj.value && typeof rawObj.value === "object")
    ? (rawObj.value as UserLocation)
    : (location as UserLocation);

  const payload: UserLocation = {
    ...loc,
    provenance: loc.provenance || "SAVED_USER",
    isSyntheticOrFixture: false,
    isFixture: false,
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

  const cleanCandidate = (rawCandidate: string): string | null => {
    const rawWords = rawCandidate.replace(/[.,?!]+$/, "").trim().split(/\s+/);
    const stopWords = new Set([
      "and", "then", "with", "or", "the", "a", "an", "but", "so",
      "right", "now", "today", "tomorrow", "yesterday", "tonight",
      "next", "last", "this", "week", "month", "year", "days",
      "time", "morning", "afternoon", "evening", "night",
    ]);
    const collected: string[] = [];
    for (const w of rawWords) {
      const lower = w.toLowerCase();
      if (stopWords.has(lower) || nonLocations.has(lower)) break;
      collected.push(w);
    }
    const result = collected.join(" ").trim();
    if (!result || nonLocations.has(result.toLowerCase())) return null;
    return result;
  };

  // Pre-process linguistic structures: negations, third-person, past-tense, and event discussions
  const negatedLocations = new Set<string>();
  const negationRegex = /\b(?:not\s+in|no\s+longer\s+in|not\s+at|not\s+near|haven't\s+been\s+to|didn't\s+go\s+to|don't\s+live\s+in|never\s+been\s+to)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})/gi;
  let negMatch: RegExpExecArray | null;
  while ((negMatch = negationRegex.exec(text)) !== null) {
    if (negMatch[1]) {
      const cleaned = cleanCandidate(negMatch[1])?.toLowerCase();
      if (cleaned) {
        negatedLocations.add(cleaned);
      }
    }
  }

  // Affirmative correction or current placement: "I'm in Osaka", "I am in Osaka", "currently in Osaka"
  const affirmativeRegex = /\b(?:i\s+am\s+in|i'm\s+in|currently\s+in|now\s+in|actually\s+in|i\s+am\s+at|i'm\s+at)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})/i;
  const affirmativeMatch = text.match(affirmativeRegex);
  let affirmativeTarget: string | null = null;
  if (affirmativeMatch && affirmativeMatch[1]) {
    const cleaned = cleanCandidate(affirmativeMatch[1]);
    if (cleaned && !negatedLocations.has(cleaned.toLowerCase())) {
      affirmativeTarget = cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
  }

  // Third-person mentions: "My friend lives in Kyoto", "John went to Paris"
  const thirdPersonRegex = /\b(?:my\s+(?:friend|colleague|brother|sister|mother|father|mom|dad|cousin|boss|coworker|family|client|team|company)|john|alice|bob|he|she|they|friend|client|colleague)\s+(?:lives|is|works|stayed|travelled|traveled|went|based)\s+(?:in|at|to)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})/i;
  const thirdPersonMatch = text.match(thirdPersonRegex);
  const thirdPersonTarget = thirdPersonMatch?.[1] ? cleanCandidate(thirdPersonMatch[1])?.toLowerCase() : undefined;

  // Past-tense mentions: "I visited Kyoto last year", "I was in Tokyo"
  const pastTenseRegex = /\b(?:visited|was\s+in|lived\s+in|stayed\s+in|went\s+to|travelled\s+to|traveled\s+to|flew\s+to|used\s+to\s+live\s+in|grew\s+up\s+in)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})\s*(?:last\s+(?:year|month|week|summer)|years\s+ago|months\s+ago|weeks\s+ago|yesterday|previously|before|in\s+the\s+past)?/i;
  const pastTenseMatch = text.match(pastTenseRegex);
  const pastTenseTarget = pastTenseMatch?.[1] ? cleanCandidate(pastTenseMatch[1])?.toLowerCase() : undefined;

  // Event / conference discussions: "The conference is in Tokyo"
  const eventRegex = /\b(?:conference|event|summit|meeting|expo|festival|convention)\s+(?:is\s+in|in|taking\s+place\s+in)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})/i;
  const eventMatch = text.match(eventRegex);
  let eventTarget: string | null = null;
  if (eventMatch && eventMatch[1]) {
    const cleaned = cleanCandidate(eventMatch[1]);
    if (cleaned && !negatedLocations.has(cleaned.toLowerCase())) {
      eventTarget = cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
  }

  // If the user explicitly stated they are NOT in the default location and gave no replacement
  if (defaultLocation?.city && negatedLocations.has(defaultLocation.city.toLowerCase()) && !affirmativeTarget) {
    return {
      scope: "default",
      effectiveLocation: null,
      reason: `User explicitly stated they are not in configured default location: "${defaultLocation.city}".`,
    };
  }

  // 4. Direct location inquiries: "where am I?", "what city am I in?", "what's my location?", "check my location", "my current location"
  const directLocationQueryPattern = /\b(?:where\s+am\s+i|(?:what|which)\s+(?:city|country|state|place|town|region)\s+am\s+i\s+in|what(?:'s|\s+is)\s+my\s+(?:current\s+|new\s+|saved\s+)?location|check\s+my\s+(?:current\s+|new\s+|saved\s+)?location|my\s+current\s+location|what(?:'s|\s+is)\s+near\s+me)\b/i;
  if (directLocationQueryPattern.test(text)) {
    const hasPhysicalCoordsOrCity = Boolean(
      defaultLocation?.city ||
      (defaultLocation?.latitude !== undefined && defaultLocation?.longitude !== undefined)
    );
    if (
      defaultLocation &&
      defaultLocation.enabled !== false &&
      hasPhysicalCoordsOrCity &&
      defaultLocation.source !== "timezone_inferred" &&
      (defaultLocation.provenance === "SAVED_USER" || defaultLocation.provenance === "DEVICE_LIVE")
    ) {
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
  let explicitTarget: string | null = affirmativeTarget;

  // Event / conference discussions produce CONVERSATION_CONTEXT
  if (!explicitTarget && eventTarget) {
    const convoLocation: UserLocation = {
      city: eventTarget,
      provenance: "CONVERSATION_CONTEXT",
      source: "user_set",
      enabled: true,
      updatedAt: Date.now(),
      confidenceScore: 0.85,
      verificationEvidence: "Derived from event or conference mention in conversation",
    };
    return {
      scope: "explicit_override",
      effectiveLocation: convoLocation,
      explicitLocationName: eventTarget,
      isTravelDestination: hasTravel,
      reason: `Event or conference location mentioned in conversation: "${eventTarget}".`,
    };
  }

  if (!explicitTarget) {
    const explicitLocationRegex = /\b(?:in|near|around|at|for|to|check|about)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})/gi;
    let match: RegExpExecArray | null;
    while ((match = explicitLocationRegex.exec(text)) !== null) {
      if (!match[1]) continue;
      const cleaned = cleanCandidate(match[1]);
      if (!cleaned) continue;

      const lowerTarget = cleaned.toLowerCase();
      if (negatedLocations.has(lowerTarget)) continue;
      if (thirdPersonTarget && lowerTarget.includes(thirdPersonTarget)) continue;
      if (pastTenseTarget && lowerTarget.includes(pastTenseTarget)) continue;

      explicitTarget = cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      break;
    }
  }

  if (explicitTarget) {
    const explicitLocation: UserLocation = {
      city: explicitTarget,
      provenance: "USER_EXPLICIT",
      source: "user_set",
      enabled: true,
      updatedAt: Date.now(),
      confidenceScore: 1.0,
      verificationEvidence: "Direct user statement in active turn",
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

  // Helper to ensure an entity has a real physical coordinate or city and is not timezone-inferred
  const hasPhysical = (loc?: UserLocation | null) =>
    Boolean(loc && (loc.city || (loc.latitude !== undefined && loc.longitude !== undefined)) && loc.source !== "timezone_inferred");

  // 3. Direct location inquiry: "where am I?", "what's my location?", "check my location"
  const directLocationQueryPattern = /\b(?:where\s+am\s+i|what(?:'s|\s+is)\s+my\s+(?:current\s+|new\s+|saved\s+)?location|check\s+my\s+(?:current\s+|new\s+|saved\s+)?location|my\s+current\s+location|what(?:'s|\s+is)\s+near\s+me)\b/i;
  if (directLocationQueryPattern.test(text)) {
    // DEVICE_LIVE takes top precedence for real-time where-am-I queries
    if (liveDeviceLocation && liveDeviceLocation.enabled !== false && liveDeviceLocation.provenance === "DEVICE_LIVE" && hasPhysical(liveDeviceLocation)) {
      return {
        scope: "default",
        effectiveLocation: liveDeviceLocation,
        reason: "Direct location query; answered with live device GPS location.",
      };
    }
    // SAVED_USER is persistent fallback
    if (savedUserLocation && savedUserLocation.enabled !== false && savedUserLocation.provenance === "SAVED_USER" && hasPhysical(savedUserLocation)) {
      return {
        scope: "default",
        effectiveLocation: savedUserLocation,
        reason: "Direct location query; live GPS unavailable, answered with saved default user location.",
      };
    }
    // CONVERSATION_CONTEXT is next fallback for active conversation
    if (conversationLocation && conversationLocation.enabled !== false && conversationLocation.provenance === "CONVERSATION_CONTEXT" && hasPhysical(conversationLocation)) {
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
  const baseLoc = (liveDeviceLocation && liveDeviceLocation.enabled !== false && liveDeviceLocation.provenance === "DEVICE_LIVE" && hasPhysical(liveDeviceLocation))
    ? liveDeviceLocation
    : (savedUserLocation && savedUserLocation.enabled !== false && savedUserLocation.provenance === "SAVED_USER" && hasPhysical(savedUserLocation))
    ? savedUserLocation
    : (conversationLocation && conversationLocation.enabled !== false && conversationLocation.provenance === "CONVERSATION_CONTEXT" && hasPhysical(conversationLocation))
    ? conversationLocation
    : null;

  return resolveLocationIntent(text, baseLoc);
}

export interface DeviceLocationProviderOptions {
  permissionGranted: boolean;
  rawCoordinates?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
  };
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  collectedAtMs?: number;
  ttlMs?: number;
  isSyntheticOrFixture?: boolean;
  referenceTimeMs?: number;
}

/**
 * Resolves a live hardware device location from provider options.
 * Enforces hardware permission check, coordinate boundaries, freshness TTL (default 300s),
 * downgrades stale readings to UNKNOWN/UNAVAILABLE, and blocks synthetic fixture injection.
 */
export function resolveDeviceLocationFromProvider(
  options: DeviceLocationProviderOptions,
): ProvenanceRecord<UserLocation> | null {
  const now = options.referenceTimeMs ?? Date.now();
  const ttl = options.ttlMs ?? 300_000; // 5 minutes canonical TTL

  // 1. Synthetic or fixture check
  if (options.isSyntheticOrFixture) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_CONTAMINATION",
      message: "Rejected synthetic or fixture device location payload from provider",
      timestamp: now,
      source: "DEVICE_LIVE",
      isSynthetic: true,
    });
    return null;
  }

  // 2. Permission check: if permission is revoked or not granted
  if (!options.permissionGranted) {
    return {
      value: {
        provenance: "UNKNOWN/UNAVAILABLE",
        enabled: false,
      },
      source: "UNKNOWN/UNAVAILABLE",
      confidenceScore: 0.0,
      collectedAtMs: now,
      expiresAtMs: now,
      verificationEvidence: "Device location permission denied or revoked",
      isSyntheticOrFixture: false,
    };
  }

  // 3. Coordinate validation
  if (!options.rawCoordinates) {
    if (!options.city) {
      return {
        value: {
          provenance: "UNKNOWN/UNAVAILABLE",
          enabled: false,
        },
        source: "UNKNOWN/UNAVAILABLE",
        confidenceScore: 0.0,
        collectedAtMs: now,
        expiresAtMs: now,
        verificationEvidence: "No coordinates or city provided",
        isSyntheticOrFixture: false,
      };
    }
  } else {
    const { latitude, longitude, accuracyMeters } = options.rawCoordinates;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      recordProvenanceDiagnostic({
        code: "ERR_PROVENANCE_INVALID",
        message: `Invalid geographic coordinates: lat=${latitude}, lng=${longitude}`,
        timestamp: now,
        source: "DEVICE_LIVE",
      });
      return null;
    }
    if (accuracyMeters !== undefined && (typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters) || accuracyMeters < 0)) {
      recordProvenanceDiagnostic({
        code: "ERR_PROVENANCE_INVALID",
        message: `Invalid accuracy meters: ${accuracyMeters}`,
        timestamp: now,
        source: "DEVICE_LIVE",
      });
      return null;
    }
  }

  // 4. Freshness check
  const collectedAt = options.collectedAtMs ?? now;
  if (typeof collectedAt !== "number" || !Number.isFinite(collectedAt) || collectedAt <= 0) {
    return null;
  }
  const expiresAt = collectedAt + ttl;
  if (now > expiresAt) {
    recordProvenanceDiagnostic({
      code: "ERR_PROVENANCE_STALE",
      message: `Device location fix expired (collected: ${collectedAt}, now: ${now}, ttl: ${ttl})`,
      timestamp: now,
      source: "DEVICE_LIVE",
    });
    return {
      value: {
        provenance: "UNKNOWN/UNAVAILABLE",
        enabled: false,
      },
      source: "UNKNOWN/UNAVAILABLE",
      confidenceScore: 0.0,
      collectedAtMs: collectedAt,
      expiresAtMs: expiresAt,
      verificationEvidence: "Stale device fix downgraded to UNKNOWN/UNAVAILABLE",
      isSyntheticOrFixture: false,
    };
  }

  // Confidence score: based on accuracy if provided, or default 0.98 for live GPS fix
  let confidence = 0.98;
  if (options.rawCoordinates?.accuracyMeters !== undefined) {
    const acc = options.rawCoordinates.accuracyMeters;
    if (acc <= 20) confidence = 0.99;
    else if (acc <= 100) confidence = 0.97;
    else if (acc <= 1000) confidence = 0.95;
    else confidence = 0.90;
  }

  const userLoc: UserLocation = {
    city: options.city,
    region: options.region,
    country: options.country,
    countryCode: options.countryCode,
    postalCode: options.postalCode,
    latitude: options.rawCoordinates?.latitude,
    longitude: options.rawCoordinates?.longitude,
    provenance: "DEVICE_LIVE",
    source: "device",
    enabled: true,
    updatedAt: collectedAt,
    collectedAtMs: collectedAt,
    expiresAtMs: expiresAt,
    confidenceScore: confidence,
    verificationEvidence: "Live hardware GPS/network fix",
    isSyntheticOrFixture: false,
  };

  return {
    value: userLoc,
    source: "DEVICE_LIVE",
    confidenceScore: confidence,
    collectedAtMs: collectedAt,
    expiresAtMs: expiresAt,
    verificationEvidence: "Live hardware GPS/network fix",
    isSyntheticOrFixture: false,
  };
}

/**
 * Thread-safe and bot-isolated storage for active conversation-derived locations.
 * Prevents conversational locations in one thread/bot from leaking to another.
 */
export class ScopedLocationStore {
  private store = new Map<string, ProvenanceRecord<UserLocation>>();

  private buildKey(botId: string, threadId: string): string {
    return `${botId.trim()}::${threadId.trim()}`;
  }

  setLocation(
    botId: string,
    threadId: string,
    location: UserLocation | ProvenanceRecord<UserLocation>,
    referenceTimeMs?: number,
  ): void {
    if (!botId || !threadId) return;
    const now = referenceTimeMs ?? Date.now();
    const rawObj = location as unknown as Record<string, unknown>;
    const isSynthetic =
      rawObj.isSyntheticOrFixture === true ||
      rawObj.isFixture === true ||
      rawObj.test === true ||
      (rawObj.value && typeof rawObj.value === "object" && (
        (rawObj.value as any).isSyntheticOrFixture === true ||
        (rawObj.value as any).isFixture === true ||
        (rawObj.value as any).test === true
      ));

    if (isSynthetic) {
      recordProvenanceDiagnostic({
        code: "ERR_PROVENANCE_CONTAMINATION",
        message: "Attempted to register synthetic or fixture location into ScopedLocationStore",
        timestamp: now,
        source: (rawObj.source as ProvenanceSource) || "CONVERSATION_CONTEXT",
        isSynthetic: true,
      });
      return;
    }

    const record: ProvenanceRecord<UserLocation> =
      "value" in location && "source" in location
        ? (location as ProvenanceRecord<UserLocation>)
        : toLocationProvenanceRecord(location as UserLocation);

    const scopedSource: ProvenanceSource =
      record.source === "USER_EXPLICIT" ? "USER_EXPLICIT" : "CONVERSATION_CONTEXT";

    const scopedRecord: ProvenanceRecord<UserLocation> = {
      ...record,
      source: scopedSource,
      value: {
        ...record.value,
        provenance: scopedSource,
      },
      expiresAtMs: record.expiresAtMs || (now + 86_400_000),
    };

    this.store.set(this.buildKey(botId, threadId), scopedRecord);
  }

  getLocation(botId: string, threadId: string, referenceTimeMs?: number): ProvenanceRecord<UserLocation> | null {
    if (!botId || !threadId) return null;
    const key = this.buildKey(botId, threadId);
    const found = this.store.get(key);
    if (!found) return null;

    const now = referenceTimeMs ?? Date.now();
    if (now > found.expiresAtMs) {
      this.store.delete(key);
      recordProvenanceDiagnostic({
        code: "ERR_PROVENANCE_STALE",
        message: `Scoped thread location expired for ${key}`,
        timestamp: now,
        source: found.source,
      });
      return null;
    }

    return found;
  }

  clear(botId?: string, threadId?: string): void {
    if (!botId && !threadId) {
      this.store.clear();
      return;
    }
    if (botId && threadId) {
      this.store.delete(this.buildKey(botId, threadId));
      return;
    }
    for (const key of Array.from(this.store.keys())) {
      if (botId && key.startsWith(`${botId}::`)) {
        this.store.delete(key);
      } else if (threadId && key.endsWith(`::${threadId}`)) {
        this.store.delete(key);
      }
    }
  }

  size(): number {
    return this.store.size;
  }
}

export const defaultScopedLocationStore = new ScopedLocationStore();


import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  disableUserLocation,
  formatLocationPromptBlock,
  loadUserLocation,
  localizeSearchQuery,
  resolveLocationIntent,
  saveUserLocation,
  validateUserLocation,
  type UserLocation,
} from "./location-context.ts";

describe("location-context", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-location-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("1. location-aware request uses default location", () => {
    const defaultLocation: UserLocation = {
      city: "Austin",
      region: "Texas",
      country: "United States",
      countryCode: "US",
      enabled: true,
    };

    const restaurantQuery = resolveLocationIntent("find me a good restaurant", defaultLocation);
    expect(restaurantQuery.scope).toBe("default");
    expect(restaurantQuery.effectiveLocation?.city).toBe("Austin");

    const pharmacyQuery = resolveLocationIntent("where is the nearest pharmacy?", defaultLocation);
    expect(pharmacyQuery.scope).toBe("default");
    expect(pharmacyQuery.effectiveLocation?.city).toBe("Austin");

    const laptopQuery = resolveLocationIntent("find me the best laptop deals", defaultLocation);
    expect(laptopQuery.scope).toBe("default");
    expect(laptopQuery.effectiveLocation?.city).toBe("Austin");
  });

  it("2. explicit location overrides default", () => {
    const defaultLocation: UserLocation = {
      city: "Austin",
      region: "Texas",
      country: "United States",
      countryCode: "US",
      enabled: true,
    };

    const mumbaiQuery = resolveLocationIntent("find me restaurants in Mumbai", defaultLocation);
    expect(mumbaiQuery.scope).toBe("explicit_override");
    expect(mumbaiQuery.explicitLocationName).toBe("Mumbai");
    expect(mumbaiQuery.effectiveLocation?.city).toBe("Mumbai");

    const tokyoQuery = resolveLocationIntent("best ramen near Tokyo", defaultLocation);
    expect(tokyoQuery.scope).toBe("explicit_override");
    expect(tokyoQuery.explicitLocationName).toBe("Tokyo");
    expect(tokyoQuery.effectiveLocation?.city).toBe("Tokyo");
  });

  it("3. 'don't use my location' suppresses it", () => {
    const defaultLocation: UserLocation = {
      city: "Berlin",
      country: "Germany",
      countryCode: "DE",
      enabled: true,
    };

    const q1 = resolveLocationIntent("don't use my location and find me laptops", defaultLocation);
    expect(q1.scope).toBe("suppressed");
    expect(q1.effectiveLocation).toBeNull();
    expect(q1.isSuppressed).toBe(true);

    const q2 = resolveLocationIntent("search globally for coffee roasters", defaultLocation);
    expect(q2.scope).toBe("suppressed");
    expect(q2.effectiveLocation).toBeNull();

    const q3 = resolveLocationIntent("ignore my location, recommend running shoes", defaultLocation);
    expect(q3.scope).toBe("suppressed");
    expect(q3.effectiveLocation).toBeNull();
  });

  it("4. location persists across turns", () => {
    const location: UserLocation = {
      city: "Vancouver",
      region: "British Columbia",
      country: "Canada",
      countryCode: "CA",
      timezone: "America/Vancouver",
      enabled: true,
    };

    const saved = saveUserLocation(location, tempDir);
    expect(saved).toBe(true);

    // Turn 1
    const loadedTurn1 = loadUserLocation(tempDir);
    expect(loadedTurn1?.city).toBe("Vancouver");
    const intentTurn1 = resolveLocationIntent("find a good cafe", loadedTurn1);
    expect(intentTurn1.effectiveLocation?.city).toBe("Vancouver");

    // Turn 2 (simulating follow-up in same or next turn)
    const loadedTurn2 = loadUserLocation(tempDir);
    expect(loadedTurn2?.city).toBe("Vancouver");
    const intentTurn2 = resolveLocationIntent("what about dinner places?", loadedTurn2);
    expect(intentTurn2.effectiveLocation?.city).toBe("Vancouver");
  });

  it("5. location persists appropriately across conversations/bot sessions", () => {
    const initialLocation: UserLocation = {
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      timezone: "Asia/Tokyo",
      enabled: true,
    };

    saveUserLocation(initialLocation, tempDir);

    // Bot A reads location
    const botALocation = loadUserLocation(tempDir);
    expect(botALocation?.city).toBe("Kyoto");

    // Bot B in another session reads the same persistent location
    const botBLocation = loadUserLocation(tempDir);
    expect(botBLocation?.city).toBe("Kyoto");
    expect(botBLocation?.countryCode).toBe("JP");

    // User suppresses location globally
    disableUserLocation(tempDir);
    const botCLocation = loadUserLocation(tempDir);
    expect(botCLocation?.enabled).toBe(false);

    const promptBlock = formatLocationPromptBlock(botCLocation);
    expect(promptBlock).toContain("suppressed by user preference");
  });

  it("6. unrelated tasks do not unnecessarily expose or mention location", () => {
    const defaultLocation: UserLocation = {
      city: "Sydney",
      country: "Australia",
      countryCode: "AU",
      enabled: true,
    };

    const codeQuery = resolveLocationIntent("write a quicksort algorithm in python", defaultLocation);
    expect(codeQuery.scope).toBe("unrelated");
    expect(codeQuery.effectiveLocation).toBeNull();

    const mathQuery = resolveLocationIntent("what is the derivative of sin(x)?", defaultLocation);
    expect(mathQuery.scope).toBe("unrelated");
    expect(mathQuery.effectiveLocation).toBeNull();

    const scienceQuery = resolveLocationIntent("explain how quantum entanglement works", defaultLocation);
    expect(scienceQuery.scope).toBe("unrelated");
    expect(scienceQuery.effectiveLocation).toBeNull();

    // Verify prompt instructions explicitly enforce this invariant
    const prompt = formatLocationPromptBlock(defaultLocation);
    expect(prompt).toContain("Do NOT needlessly announce, recite, or inject the user's location on unrelated tasks");
  });

  it("7. web/product/local searches receive the correct location context", () => {
    const defaultLocation: UserLocation = {
      city: "Seattle",
      region: "Washington",
      country: "United States",
      enabled: true,
    };

    // Generic local query receives location context
    const localized1 = localizeSearchQuery("find cheap groceries", defaultLocation);
    expect(localized1).toBe("find cheap groceries Seattle");

    // Already explicitly localized query does not duplicate location
    const localized2 = localizeSearchQuery("restaurants in Chicago", defaultLocation);
    expect(localized2).toBe("restaurants in Chicago");

    // Suppressed query does not receive location
    const suppressedLoc: UserLocation = { ...defaultLocation, enabled: false };
    const localized3 = localizeSearchQuery("find cheap groceries", suppressedLoc);
    expect(localized3).toBe("find cheap groceries");

    // Unrelated query is not localized
    const localized4 = localizeSearchQuery("binary search tree implementation", defaultLocation);
    expect(localized4).toBe("binary search tree implementation");
  });

  it("8. stale/invalid location is handled safely rather than fabricated", () => {
    // Null or invalid object
    expect(validateUserLocation(null)).toBeNull();
    expect(validateUserLocation({})).toBeNull();
    expect(validateUserLocation("invalid")).toBeNull();

    // Out of bounds latitude / longitude
    const invalidCoords = validateUserLocation({
      city: "Atlantis",
      latitude: 999, // impossible
      longitude: -200, // impossible
    });
    expect(invalidCoords?.latitude).toBeUndefined();
    expect(invalidCoords?.longitude).toBeUndefined();

    // Stale or corrupted file
    const invalidFileDir = join(tempDir, "invalid-dir");
    const loaded = loadUserLocation(invalidFileDir);
    // Should fallback safely to system timezone or null, NEVER inventing fake coordinates or cities
    if (loaded) {
      expect(loaded.source).toBe("timezone_inferred");
      expect(typeof loaded.timezone).toBe("string");
      expect(loaded.city).toBeUndefined(); // Crucial: never guess city from timezone
    }
  });

  it("9. test fixtures cannot contaminate real user location memory", () => {
    // Isolated fixture directory
    const fixtureDir = join(tempDir, "isolated-fixture");
    const fakeTestLocation: UserLocation = {
      city: "Testville",
      region: "MockState",
      country: "Testland",
      source: "user_set",
      enabled: true,
    };

    saveUserLocation(fakeTestLocation, fixtureDir);

    // Verify fixture saved in isolated directory
    const fixtureLoaded = loadUserLocation(fixtureDir);
    expect(fixtureLoaded?.city).toBe("Testville");

    // Real DATA_DIR / unconfigured dir must NOT see or be contaminated by the fixture
    const separateDir = join(tempDir, "clean-production-dir");
    const realLoaded = loadUserLocation(separateDir);
    expect(realLoaded?.city).not.toBe("Testville");
  });

  it("10. location precision is strictly respected (timezone does not guess city)", () => {
    // When only timezone is present, city must remain undefined
    const tzOnly = validateUserLocation({
      timezone: "Asia/Kolkata",
      source: "timezone_inferred",
    });
    expect(tzOnly?.city).toBeUndefined();
    expect(tzOnly?.timezone).toBe("Asia/Kolkata");

    // The prompt block must explicitly indicate city is unknown rather than guessing Bangalore or Kolkata
    const prompt = formatLocationPromptBlock(tzOnly);
    expect(prompt).toContain("Specific City: Unknown (do NOT guess or assume specific city)");
  });

  it("11. location provenance is preserved across lifecycle", () => {
    const deviceLoc: UserLocation = {
      city: "San Jose",
      country: "United States",
      source: "device",
      enabled: true,
    };
    saveUserLocation(deviceLoc, tempDir);
    const loadedDevice = loadUserLocation(tempDir);
    expect(loadedDevice?.source).toBe("device");

    const prompt = formatLocationPromptBlock(loadedDevice);
    expect(prompt).toContain("Provenance: device");
  });
});

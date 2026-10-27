import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkProvenanceFreshness,
  clearProvenanceDiagnostics,
  clearUserLocation,
  createProvenanceRecord,
  formatLocationPromptBlock,
  getLastProvenanceDiagnostic,
  isProvenanceFresh,
  loadUserLocation,
  localizeSearchQuery,
  ProvenanceContaminationError,
  resolveDeviceLocationFromProvider,
  resolveEffectiveLocation,
  resolveLocationIntent,
  saveUserLocation,
  ScopedLocationStore,
  validateProvenanceRecord,
  validateUserLocation,
  resolveLocationContext,
  LOCATION_FRESHNESS_TTL_MS,
  isLocationContextDisabled,
  setLocationContextEnabled,
  setCachedDeviceFix,
  clearCachedDeviceFix,
  formatLocationResolutionPromptBlock,
  type ProvenanceRecord,
  type ProvenanceSource,
  type UserLocation,
} from "./location-context.ts";
import { DATA_DIR } from "./config.ts";

describe("location-context", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-location-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("1. location-aware request uses saved default location", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      countryCode: "US",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const restaurantQuery = resolveLocationIntent("find me a good restaurant", defaultLocation);
    expect(restaurantQuery.scope).toBe("default");
    expect(restaurantQuery.effectiveLocation?.city).toBe("Denver");
    expect(restaurantQuery.effectiveLocation?.provenance).toBe("SAVED_USER");

    const pharmacyQuery = resolveLocationIntent("where is the nearest pharmacy?", defaultLocation);
    expect(pharmacyQuery.scope).toBe("default");
    expect(pharmacyQuery.effectiveLocation?.city).toBe("Denver");

    const laptopQuery = resolveLocationIntent("find me the best laptop deals", defaultLocation);
    expect(laptopQuery.scope).toBe("default");
    expect(laptopQuery.effectiveLocation?.city).toBe("Denver");
  });

  it("2. explicit location overrides default", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      countryCode: "US",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const mumbaiQuery = resolveLocationIntent("find me restaurants in Mumbai", defaultLocation);
    expect(mumbaiQuery.scope).toBe("explicit_override");
    expect(mumbaiQuery.explicitLocationName).toBe("Mumbai");
    expect(mumbaiQuery.effectiveLocation?.city).toBe("Mumbai");
    expect(mumbaiQuery.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

    const tokyoQuery = resolveLocationIntent("best ramen near Tokyo", defaultLocation);
    expect(tokyoQuery.scope).toBe("explicit_override");
    expect(tokyoQuery.effectiveLocation?.city).toBe("Tokyo");
    expect(tokyoQuery.effectiveLocation?.provenance).toBe("USER_EXPLICIT");
  });

  it("3. suppressed location drops effective location", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      country: "United States",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const q1 = resolveLocationIntent("don't use my location and find me laptops", defaultLocation);
    expect(q1.scope).toBe("suppressed");
    expect(q1.isSuppressed).toBe(true);
    expect(q1.effectiveLocation).toBeNull();

    const q2 = resolveLocationIntent("search globally for coffee roasters", defaultLocation);
    expect(q2.scope).toBe("suppressed");
    expect(q2.effectiveLocation).toBeNull();

    const q3 = resolveLocationIntent("ignore my location, recommend running shoes", defaultLocation);
    expect(q3.scope).toBe("suppressed");
    expect(q3.effectiveLocation).toBeNull();
  });

  it("4. unrelated requests have unrelated scope and no location exposure", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      country: "United States",
      provenance: "SAVED_USER",
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
  });

  it("5. prompt block format produces required invariants", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      countryCode: "US",
      postalCode: "80202",
      timezone: "America/Denver",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const prompt = formatLocationPromptBlock(defaultLocation);
    expect(prompt).toContain("PERSISTENT USER LOCATION CONTEXT");
    expect(prompt).toContain("Denver");
    expect(prompt).toContain("Colorado");
    expect(prompt).toContain("United States [US]");
    expect(prompt).toContain("Provenance: SAVED_USER");
    expect(prompt).toContain("ZERO FABRICATION");
  });

  it("6. query localization appends default location only when relevant", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const localized1 = localizeSearchQuery("find cheap groceries", defaultLocation);
    expect(localized1).toBe("find cheap groceries Denver");

    // Does not duplicate if already present
    const localized2 = localizeSearchQuery("restaurants in Chicago", defaultLocation);
    expect(localized2).toBe("restaurants in Chicago");

    // Suppressed or disabled location does not localize
    const suppressedLoc: UserLocation = { ...defaultLocation, enabled: false };
    const localized3 = localizeSearchQuery("find cheap groceries", suppressedLoc);
    expect(localized3).toBe("find cheap groceries");

    // Unrelated tasks do not localize
    const localized4 = localizeSearchQuery("binary search tree implementation", defaultLocation);
    expect(localized4).toBe("binary search tree implementation");
  });

  it("7. persistence round-trip saves, loads, and clears reliably", () => {
    const location: UserLocation = {
      city: "Seattle",
      region: "Washington",
      country: "United States",
      countryCode: "US",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const saved = saveUserLocation(location, tempDir);
    expect(saved).toBe(true);

    const loadedTurn1 = loadUserLocation(tempDir);
    expect(loadedTurn1?.city).toBe("Seattle");
    expect(loadedTurn1?.provenance).toBe("SAVED_USER");

    // Clearing location reverts to null (UNKNOWN/UNAVAILABLE)
    clearUserLocation(tempDir);
    const afterClear = loadUserLocation(tempDir);
    expect(afterClear).toBeNull();
  });

  it("8. validates input: rejects corrupted fields, fixtures, and out-of-bounds coords", () => {
    expect(validateUserLocation(null)).toBeNull();
    expect(validateUserLocation({})).toBeNull();
    expect(validateUserLocation("invalid")).toBeNull();

    // Rejects test fixtures
    expect(validateUserLocation({ city: "MockCity", isFixture: true })).toBeNull();
    expect(validateUserLocation({ city: "MockCity", test: true })).toBeNull();

    // Out of bounds latitude / longitude
    const invalidCoords = validateUserLocation({
      city: "Atlantis",
      latitude: 999, // impossible
      longitude: -200, // impossible
      provenance: "SAVED_USER",
    });
    expect(invalidCoords?.latitude).toBeUndefined();
    expect(invalidCoords?.longitude).toBeUndefined();

    // Corrupted file directory returns null
    const invalidFileDir = join(tempDir, "invalid-dir");
    const loaded = loadUserLocation(invalidFileDir);
    expect(loaded).toBeNull();
  });

  it("9. test fixtures cannot contaminate real user location memory", () => {
    const fixtureDir = join(tempDir, "isolated-fixture");
    const fakeTestLocation: UserLocation = {
      city: "Testville",
      region: "MockState",
      country: "Testland",
      provenance: "SAVED_USER",
      enabled: true,
    };

    saveUserLocation(fakeTestLocation, fixtureDir);

    const fixtureLoaded = loadUserLocation(fixtureDir);
    expect(fixtureLoaded?.city).toBe("Testville");

    // Real clean directory must NOT see or be contaminated by the fixture
    const separateDir = join(tempDir, "clean-production-dir");
    const realLoaded = loadUserLocation(separateDir);
    expect(realLoaded).toBeNull();
  });

  it("10. tests attempting to mutate production DATA_DIR are blocked", () => {
    const fakeLoc: UserLocation = {
      city: "ForbiddenCity",
      provenance: "SAVED_USER",
      enabled: true,
    };

    expect(() => saveUserLocation(fakeLoc, DATA_DIR)).toThrow(
      /Tests must NEVER mutate production DATA_DIR/
    );
  });

  it("11. location provenance is preserved across lifecycle", () => {
    const deviceLoc: UserLocation = {
      city: "San Jose",
      country: "United States",
      provenance: "DEVICE_LIVE",
      enabled: true,
    };
    saveUserLocation(deviceLoc, tempDir);
    const loadedDevice = loadUserLocation(tempDir);
    expect(loadedDevice?.provenance).toBe("DEVICE_LIVE");

    const prompt = formatLocationPromptBlock(loadedDevice);
    expect(prompt).toContain("Provenance: DEVICE_LIVE");
  });

  it("12. case-insensitive location and preposition overrides", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const q1 = resolveLocationIntent("weather in tokyo", defaultLocation);
    expect(q1.scope).toBe("explicit_override");
    expect(q1.effectiveLocation?.city).toBe("Tokyo");
    expect(q1.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

    const q2 = resolveLocationIntent("restaurants in new york", defaultLocation);
    expect(q2.scope).toBe("explicit_override");
    expect(q2.effectiveLocation?.city).toBe("New York");

    const q3 = resolveLocationIntent("weather for Seattle", defaultLocation);
    expect(q3.scope).toBe("explicit_override");
    expect(q3.effectiveLocation?.city).toBe("Seattle");

    const q4 = resolveLocationIntent("travel to Paris", defaultLocation);
    expect(q4.scope).toBe("explicit_override");
    expect(q4.effectiveLocation?.city).toBe("Paris");
    expect(q4.isTravelDestination).toBe(true);

    const q5 = resolveLocationIntent("flights from Chicago to London", defaultLocation);
    expect(q5.scope).toBe("explicit_override");
    expect(q5.effectiveLocation?.city).toBe("London");
    expect(q5.isTravelDestination).toBe(true);
  });

  it("13. multi-turn location context reuse and reversion", () => {
    const defaultLocation: UserLocation = {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      provenance: "SAVED_USER",
      enabled: true,
    };

    // Turn 1 specifies Seattle
    const t1 = resolveLocationIntent("how is the weather in Seattle?", defaultLocation);
    expect(t1.effectiveLocation?.city).toBe("Seattle");
    expect(t1.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

    // Turn 2 follow up reuses Seattle
    const t2 = resolveLocationIntent("what about tomorrow?", defaultLocation, "Seattle");
    expect(t2.scope).toBe("explicit_override");
    expect(t2.effectiveLocation?.city).toBe("Seattle");
    expect(t2.effectiveLocation?.provenance).toBe("CONVERSATION_CONTEXT");

    // Turn 3 asks for coffee there
    const t3 = resolveLocationIntent("recommend a good coffee shop there", defaultLocation, "Seattle");
    expect(t3.scope).toBe("explicit_override");
    expect(t3.effectiveLocation?.city).toBe("Seattle");

    // Turn 4 changes to Chicago
    const t4 = resolveLocationIntent("now check Chicago", defaultLocation, "Seattle");
    expect(t4.scope).toBe("explicit_override");
    expect(t4.effectiveLocation?.city).toBe("Chicago");

    // Turn 5 reverts to default home location
    const t5 = resolveLocationIntent("what about back home?", defaultLocation, "Chicago");
    expect(t5.scope).toBe("default");
    expect(t5.effectiveLocation?.city).toBe("Denver");
    expect(t5.effectiveLocation?.provenance).toBe("SAVED_USER");
  });

  it("14. privacy suppression across various user phrasings", () => {
    const defaultLocation: UserLocation = {
      city: "Chicago",
      country: "United States",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const p1 = resolveLocationIntent("hide my location and find restaurants", defaultLocation);
    expect(p1.scope).toBe("suppressed");
    expect(p1.effectiveLocation).toBeNull();

    const p2 = resolveLocationIntent("don't include location for this search", defaultLocation);
    expect(p2.scope).toBe("suppressed");
    expect(p2.effectiveLocation).toBeNull();

    const p3 = resolveLocationIntent("disable location and look for hotels", defaultLocation);
    expect(p3.scope).toBe("suppressed");
    expect(p3.effectiveLocation).toBeNull();

    const p4 = resolveLocationIntent("private mode: find nearby stores", defaultLocation);
    expect(p4.scope).toBe("suppressed");
    expect(p4.effectiveLocation).toBeNull();
  });

  it("15. direct location inquiry when unconfigured reports unavailable without fabricating", () => {
    // Unconfigured location (null)
    const q1 = resolveLocationIntent("Where am I?", null);
    expect(q1.scope).toBe("default");
    expect(q1.effectiveLocation).toBeNull();
    expect(q1.reason).toContain("unavailable");

    const q2 = resolveLocationIntent("Check my current location", null);
    expect(q2.scope).toBe("default");
    expect(q2.effectiveLocation).toBeNull();

    const q3 = resolveLocationIntent("What's my location?", null);
    expect(q3.scope).toBe("default");
    expect(q3.effectiveLocation).toBeNull();

    const q4 = resolveLocationIntent("What's near me?", null);
    expect(q4.scope).toBe("default");
    expect(q4.effectiveLocation).toBeNull();

    // The unconfigured prompt block must contain strict anti-fabrication instructions
    const prompt = formatLocationPromptBlock(null);
    expect(prompt).toContain("Status: UNKNOWN/UNAVAILABLE (Provenance: UNKNOWN/UNAVAILABLE)");
    expect(prompt).toContain("Live device location: UNAVAILABLE");
    expect(prompt).toContain("Saved default location: NONE");
    expect(prompt).toContain("ZERO FABRICATION");
    expect(prompt).not.toContain("Austin");
    expect(prompt).not.toContain("Texas");
  });

  it("16. direct location inquiry with saved location reports SAVED_USER provenance", () => {
    const savedLocation: UserLocation = {
      city: "Portland",
      region: "Oregon",
      country: "United States",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const q1 = resolveLocationIntent("Where am I?", savedLocation);
    expect(q1.scope).toBe("default");
    expect(q1.effectiveLocation?.city).toBe("Portland");
    expect(q1.effectiveLocation?.provenance).toBe("SAVED_USER");

    const qCity1 = resolveLocationIntent("What city am I in?", savedLocation);
    expect(qCity1.scope).toBe("default");
    expect(qCity1.effectiveLocation?.city).toBe("Portland");

    const qCity2 = resolveLocationIntent("Which city am I in?", savedLocation);
    expect(qCity2.scope).toBe("default");
    expect(qCity2.effectiveLocation?.city).toBe("Portland");

    const prompt = formatLocationPromptBlock(savedLocation);
    expect(prompt).toContain("Status: CONFIGURED (Provenance: SAVED_USER)");
    expect(prompt).toContain("Saved Default Location: City: Portland, Region/State: Oregon");
    expect(prompt).toContain("Live device location: UNAVAILABLE (this is the user's saved default setting, NOT a live GPS reading)");
  });

  describe("Final Location Provenance Matrix", () => {
    const liveGps: UserLocation = {
      city: "San Francisco",
      region: "California",
      country: "United States",
      countryCode: "US",
      latitude: 37.7749,
      longitude: -122.4194,
      provenance: "DEVICE_LIVE",
      source: "device",
      enabled: true,
    };

    const savedUser: UserLocation = {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      countryCode: "US",
      provenance: "SAVED_USER",
      enabled: true,
    };

    const convoContext: UserLocation = {
      city: "Kyoto",
      country: "Japan",
      provenance: "CONVERSATION_CONTEXT",
      enabled: true,
    };

    it("17. Provenance source: UNKNOWN/UNAVAILABLE tested across all request types", () => {
      // "Where am I?"
      const whereAmI = resolveEffectiveLocation({ userText: "Where am I?", liveDeviceLocation: null, savedUserLocation: null });
      expect(whereAmI.effectiveLocation).toBeNull();
      expect(whereAmI.reason).toContain("unavailable");

      // "What's near me?"
      const nearMe = resolveEffectiveLocation({ userText: "What's near me?", liveDeviceLocation: null, savedUserLocation: null });
      expect(nearMe.effectiveLocation).toBeNull();

      // "What's the weather here?"
      const weatherHere = resolveEffectiveLocation({ userText: "What's the weather here?", liveDeviceLocation: null, savedUserLocation: null });
      expect(weatherHere.effectiveLocation).toBeNull();

      // Maps/nearby request
      const mapsNearby = resolveEffectiveLocation({ userText: "find nearest grocery store", liveDeviceLocation: null, savedUserLocation: null });
      expect(mapsNearby.effectiveLocation).toBeNull();

      // Unrelated request (code, math)
      const unrelated = resolveEffectiveLocation({ userText: "implement a binary search tree in typescript", liveDeviceLocation: null, savedUserLocation: null });
      expect(unrelated.scope).toBe("unrelated");
      expect(unrelated.effectiveLocation).toBeNull();

      // Follow-up request with no context
      const followUp = resolveEffectiveLocation({ userText: "what about tomorrow?", liveDeviceLocation: null, savedUserLocation: null });
      expect(followUp.effectiveLocation).toBeNull();

      // Prompt block contains mandatory anti-fabrication rules
      const prompt = formatLocationPromptBlock(null);
      expect(prompt).toContain("UNKNOWN/UNAVAILABLE");
      expect(prompt).toContain("ZERO FABRICATION");
      expect(prompt).not.toContain("Austin");
      expect(prompt).not.toContain("Denver");
    });

    it("18. Provenance source: DEVICE_LIVE tested across all request types", () => {
      // "Where am I?" uses live GPS
      const whereAmI = resolveEffectiveLocation({ userText: "Where am I?", liveDeviceLocation: liveGps, savedUserLocation: null });
      expect(whereAmI.effectiveLocation?.city).toBe("San Francisco");
      expect(whereAmI.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // "What's near me?" uses live GPS
      const nearMe = resolveEffectiveLocation({ userText: "What's near me?", liveDeviceLocation: liveGps, savedUserLocation: null });
      expect(nearMe.effectiveLocation?.city).toBe("San Francisco");
      expect(nearMe.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // "What's the weather here?" uses live GPS
      const weatherHere = resolveEffectiveLocation({ userText: "What's the weather here?", liveDeviceLocation: liveGps, savedUserLocation: null });
      expect(weatherHere.effectiveLocation?.city).toBe("San Francisco");
      expect(weatherHere.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // Maps/nearby request
      const mapsNearby = resolveEffectiveLocation({ userText: "find nearby coffee shops", liveDeviceLocation: liveGps, savedUserLocation: null });
      expect(mapsNearby.effectiveLocation?.city).toBe("San Francisco");
      expect(mapsNearby.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // Unrelated request: location does not leak
      const unrelated = resolveEffectiveLocation({ userText: "solve this quadratic equation: x^2 - 4 = 0", liveDeviceLocation: liveGps, savedUserLocation: null });
      expect(unrelated.scope).toBe("unrelated");
      expect(unrelated.effectiveLocation).toBeNull();

      // Prompt block format specifically distinguishes LIVE_DEVICE_ACTIVE
      const prompt = formatLocationPromptBlock(liveGps);
      expect(prompt).toContain("Status: LIVE_DEVICE_ACTIVE (Provenance: DEVICE_LIVE)");
      expect(prompt).toContain("Live Device Location: City: San Francisco");
      expect(prompt).toContain("Live device location: ACTIVE");
      expect(prompt).toContain("Transient Nature");
    });

    it("19. Provenance source: USER_EXPLICIT tested across all request types", () => {
      // Explicit location in query overrides live GPS and saved user
      const explicitQuery = resolveEffectiveLocation({
        userText: "find me great sushi in Tokyo",
        liveDeviceLocation: liveGps,
        savedUserLocation: savedUser,
      });
      expect(explicitQuery.scope).toBe("explicit_override");
      expect(explicitQuery.effectiveLocation?.city).toBe("Tokyo");
      expect(explicitQuery.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

      // Maps/nearby with explicit location
      const explicitMaps = resolveEffectiveLocation({
        userText: "coffee shops in New York",
        liveDeviceLocation: liveGps,
        savedUserLocation: savedUser,
      });
      expect(explicitMaps.scope).toBe("explicit_override");
      expect(explicitMaps.effectiveLocation?.city).toBe("New York");

      // Prompt block for USER_EXPLICIT
      const explicitLoc: UserLocation = { city: "Tokyo", country: "Japan", provenance: "USER_EXPLICIT" };
      const prompt = formatLocationPromptBlock(explicitLoc);
      expect(prompt).toContain("Status: EXPLICIT_OVERRIDE (Provenance: USER_EXPLICIT)");
      expect(prompt).toContain("Explicit Target Location: City: Tokyo");
      expect(prompt).toContain("CURRENT TURN ONLY");
    });

    it("20. Provenance source: SAVED_USER tested across all request types and lifecycle", () => {
      // "Where am I?" with saved default (live GPS unavailable)
      const whereAmI = resolveEffectiveLocation({ userText: "Where am I?", liveDeviceLocation: null, savedUserLocation: savedUser });
      expect(whereAmI.effectiveLocation?.city).toBe("Denver");
      expect(whereAmI.effectiveLocation?.provenance).toBe("SAVED_USER");

      // "What's near me?" uses saved default
      const nearMe = resolveEffectiveLocation({ userText: "What's near me?", liveDeviceLocation: null, savedUserLocation: savedUser });
      expect(nearMe.effectiveLocation?.city).toBe("Denver");

      // "What's the weather here?" uses saved default
      const weatherHere = resolveEffectiveLocation({ userText: "What's the weather here?", liveDeviceLocation: null, savedUserLocation: savedUser });
      expect(weatherHere.effectiveLocation?.city).toBe("Denver");

      // Unrelated request: location does not leak
      const unrelated = resolveEffectiveLocation({ userText: "write an essay on thermodynamics", liveDeviceLocation: null, savedUserLocation: savedUser });
      expect(unrelated.scope).toBe("unrelated");
      expect(unrelated.effectiveLocation).toBeNull();

      // Lifecycle: persistence across restart in isolated directory
      expect(saveUserLocation(savedUser, tempDir)).toBe(true);
      const reloaded = loadUserLocation(tempDir);
      expect(reloaded?.city).toBe("Denver");
      expect(reloaded?.provenance).toBe("SAVED_USER");

      // Lifecycle: clearing saved location reverts to UNKNOWN/UNAVAILABLE
      clearUserLocation(tempDir);
      const afterClear = loadUserLocation(tempDir);
      expect(afterClear).toBeNull();
    });

    it("21. Provenance source: CONVERSATION_CONTEXT tested across follow-ups and switches", () => {
      // Follow-up using conversation context
      const followUp1 = resolveEffectiveLocation({
        userText: "what about tomorrow?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: convoContext,
      });
      expect(followUp1.scope).toBe("explicit_override");
      expect(followUp1.effectiveLocation?.city).toBe("Kyoto");
      expect(followUp1.effectiveLocation?.provenance).toBe("CONVERSATION_CONTEXT");

      const followUp2 = resolveEffectiveLocation({
        userText: "recommend some cafes there",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: convoContext,
      });
      expect(followUp2.effectiveLocation?.city).toBe("Kyoto");

      // Unrelated request ignores conversation context
      const unrelated = resolveEffectiveLocation({
        userText: "how does DNS resolution work?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: convoContext,
      });
      expect(unrelated.scope).toBe("unrelated");
      expect(unrelated.effectiveLocation).toBeNull();

      // Conversation switch / bot switch: when conversationLocation is null, context is isolated
      const switchedBot = resolveEffectiveLocation({
        userText: "what about tomorrow?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: null,
      });
      expect(switchedBot.effectiveLocation).toBeNull();

      // Prompt block distinguishes CONVERSATION_ONLY
      const prompt = formatLocationPromptBlock(convoContext);
      expect(prompt).toContain("Status: CONVERSATION_ONLY (Provenance: CONVERSATION_CONTEXT)");
      expect(prompt).toContain("In-Conversation Location: City: Kyoto");
      expect(prompt).toContain("Scope: ACTIVE THREAD ONLY");
      expect(prompt).toContain("Thread Isolation");
    });

    it("22. Strict provenance precedence matrix verification", () => {
      // USER_EXPLICIT beats DEVICE_LIVE, SAVED_USER, and CONVERSATION_CONTEXT
      const explicitWins = resolveEffectiveLocation({
        userText: "weather in Chicago",
        liveDeviceLocation: liveGps,
        savedUserLocation: savedUser,
        conversationLocation: convoContext,
      });
      expect(explicitWins.effectiveLocation?.city).toBe("Chicago");
      expect(explicitWins.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

      // DEVICE_LIVE beats SAVED_USER and CONVERSATION_CONTEXT for live direct inquiries
      const liveWins = resolveEffectiveLocation({
        userText: "Where am I?",
        liveDeviceLocation: liveGps,
        savedUserLocation: savedUser,
        conversationLocation: convoContext,
      });
      expect(liveWins.effectiveLocation?.city).toBe("San Francisco");
      expect(liveWins.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // SAVED_USER is used when DEVICE_LIVE is unavailable and no explicit query
      const savedWins = resolveEffectiveLocation({
        userText: "Where am I?",
        liveDeviceLocation: null,
        savedUserLocation: savedUser,
        conversationLocation: convoContext,
      });
      expect(savedWins.effectiveLocation?.city).toBe("Denver");
      expect(savedWins.effectiveLocation?.provenance).toBe("SAVED_USER");

      // CONVERSATION_CONTEXT is used when neither LIVE nor SAVED is available for follow-ups
      const convoWins = resolveEffectiveLocation({
        userText: "what about tomorrow?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: convoContext,
      });
      expect(convoWins.effectiveLocation?.city).toBe("Kyoto");
      expect(convoWins.effectiveLocation?.provenance).toBe("CONVERSATION_CONTEXT");

      // UNKNOWN/UNAVAILABLE when nothing is configured or available
      const unknownWins = resolveEffectiveLocation({
        userText: "Where am I?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: null,
      });
      expect(unknownWins.effectiveLocation).toBeNull();

      // Suppression suppresses everything, including live GPS and saved user
      const suppressedWins = resolveEffectiveLocation({
        userText: "don't use my location and find bookstores",
        liveDeviceLocation: liveGps,
        savedUserLocation: savedUser,
        conversationLocation: convoContext,
      });
      expect(suppressedWins.scope).toBe("suppressed");
      expect(suppressedWins.effectiveLocation).toBeNull();
    });

    it("23. Live device location does not get confused with saved location", () => {
      // A live device reading does not mutate or replace the saved user location on disk
      expect(saveUserLocation(savedUser, tempDir)).toBe(true);

      // Querying with live device location active returns live location for the turn
      const decision = resolveEffectiveLocation({
        userText: "Where am I right now?",
        liveDeviceLocation: liveGps,
        savedUserLocation: loadUserLocation(tempDir),
      });
      expect(decision.effectiveLocation?.city).toBe("San Francisco");
      expect(decision.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // But on disk, saved location remains Denver with SAVED_USER provenance
      const persisted = loadUserLocation(tempDir);
      expect(persisted?.city).toBe("Denver");
      expect(persisted?.provenance).toBe("SAVED_USER");
    });

    it("24. Conversation-only location does not become persistent saved location", () => {
      // When a user discusses a city in conversation, it must never write to disk as saved default
      const decision = resolveEffectiveLocation({
        userText: "what about tomorrow?",
        conversationLocation: convoContext,
      });
      expect(decision.effectiveLocation?.city).toBe("Kyoto");
      expect(decision.effectiveLocation?.provenance).toBe("CONVERSATION_CONTEXT");

      // Disk storage is still empty / null
      expect(loadUserLocation(tempDir)).toBeNull();
    });

    it("25. Test fixture / mock rejection invariant", () => {
      const mockFixture: UserLocation = {
        city: "Austin",
        region: "Texas",
        country: "United States",
        provenance: "SAVED_USER",
        isFixture: true,
      };

      // Validation must refuse fixtures
      expect(validateUserLocation(mockFixture)).toBeNull();

      // Saving must refuse fixtures
      expect(saveUserLocation(mockFixture, tempDir)).toBe(false);
      expect(loadUserLocation(tempDir)).toBeNull();
    });
  });

  // =========================================================================
  // CANONICAL 14 PROVENANCE BOUNDARY TESTS (PHASE 3)
  // =========================================================================
  describe("Phase 3 Canonical 14 Provenance Boundary Tests", () => {
    beforeEach(() => {
      clearProvenanceDiagnostics();
    });

    it("Canonical 1: DEVICE_LIVE valid GPS fix within 5-minute TTL", () => {
      const now = 1700000000000;
      const res = resolveDeviceLocationFromProvider({
        permissionGranted: true,
        rawCoordinates: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracyMeters: 15,
        },
        city: "San Francisco",
        region: "California",
        country: "United States",
        countryCode: "US",
        collectedAtMs: now - 60_000, // 1 min old
        ttlMs: 300_000, // 5 min TTL
        referenceTimeMs: now,
      });

      expect(res).not.toBeNull();
      expect(res!.source).toBe("DEVICE_LIVE");
      expect(res!.confidenceScore).toBeGreaterThanOrEqual(0.95);
      expect(res!.isSyntheticOrFixture).toBe(false);
      expect(res!.value.city).toBe("San Francisco");
      expect(res!.value.latitude).toBe(37.7749);
      expect(res!.value.longitude).toBe(-122.4194);
      expect(res!.value.provenance).toBe("DEVICE_LIVE");
      expect(res!.verificationEvidence).toContain("hardware GPS");
    });

    it("Canonical 2: DEVICE_LIVE stale fix downgrades to UNKNOWN/UNAVAILABLE", () => {
      const now = 1700000000000;
      const staleCollectedAt = now - 301_000; // 5 min + 1 sec
      const res = resolveDeviceLocationFromProvider({
        permissionGranted: true,
        rawCoordinates: {
          latitude: 37.7749,
          longitude: -122.4194,
        },
        city: "San Francisco",
        collectedAtMs: staleCollectedAt,
        ttlMs: 300_000,
        referenceTimeMs: now,
      });

      expect(res).not.toBeNull();
      expect(res!.source).toBe("UNKNOWN/UNAVAILABLE");
      expect(res!.confidenceScore).toBe(0.0);
      expect(res!.value.provenance).toBe("UNKNOWN/UNAVAILABLE");

      const diag = getLastProvenanceDiagnostic();
      expect(diag).not.toBeNull();
      expect(diag!.code).toBe("ERR_PROVENANCE_STALE");
      expect(diag!.source).toBe("DEVICE_LIVE");
    });

    it("Canonical 3: USER_EXPLICIT direct user statement takes precedence and has 1.00 confidence", () => {
      const explicit = resolveLocationIntent("I am in Kyoto", null);
      expect(explicit.scope).toBe("explicit_override");
      expect(explicit.effectiveLocation?.city).toBe("Kyoto");
      expect(explicit.effectiveLocation?.provenance).toBe("USER_EXPLICIT");
      expect(explicit.effectiveLocation?.confidenceScore).toBe(1.0);

      const tokyo = resolveLocationIntent("I'm in Tokyo right now", null);
      expect(tokyo.scope).toBe("explicit_override");
      expect(tokyo.effectiveLocation?.city).toBe("Tokyo");
      expect(tokyo.effectiveLocation?.provenance).toBe("USER_EXPLICIT");
    });

    it("Canonical 4: SAVED_USER persistent profile setting loaded from disk storage", () => {
      const savedProfile: UserLocation = {
        city: "Denver",
        region: "Colorado",
        country: "United States",
        provenance: "SAVED_USER",
        confidenceScore: 0.90,
        enabled: true,
      };

      expect(saveUserLocation(savedProfile, tempDir)).toBe(true);
      const loaded = loadUserLocation(tempDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.city).toBe("Denver");
      expect(loaded!.provenance).toBe("SAVED_USER");
      expect(loaded!.confidenceScore).toBe(0.90);
    });

    it("Canonical 5: CONVERSATION_CONTEXT active thread entity discussion does not persist to disk", () => {
      const eventIntent = resolveLocationIntent("The conference is in Tokyo next month", null);
      expect(eventIntent.scope).toBe("explicit_override");
      expect(eventIntent.effectiveLocation?.city).toBe("Tokyo");
      expect(eventIntent.effectiveLocation?.provenance).toBe("CONVERSATION_CONTEXT");

      // Verify that conversation-only locations are never persisted as saved user location
      expect(loadUserLocation(tempDir)).toBeNull();
    });

    it("Canonical 6: UNKNOWN/UNAVAILABLE missing location reports truthfully with zero fabrication", () => {
      const query = resolveLocationIntent("Where am I?", null);
      expect(query.scope).toBe("default");
      expect(query.effectiveLocation).toBeNull();
      expect(query.reason).toContain("unavailable");

      const prompt = formatLocationPromptBlock(null);
      expect(prompt).toContain("Status: UNKNOWN/UNAVAILABLE (Provenance: UNKNOWN/UNAVAILABLE)");
      expect(prompt).toContain("Live device location: UNAVAILABLE");
      expect(prompt).toContain("Saved default location: NONE");
      expect(prompt).toContain("ZERO FABRICATION");
    });

    it("Canonical 7: Timezone strictly never yields physical city", () => {
      const timezoneOnlyLocation: UserLocation = {
        timezone: "Asia/Tokyo",
        provenance: "SAVED_USER",
        enabled: true,
      };

      // Asking "Where am I?" with only timezone configured must NOT resolve to Tokyo
      const query = resolveLocationIntent("Where am I?", timezoneOnlyLocation);
      expect(query.effectiveLocation).toBeNull();

      // Passing timezone_inferred source must be rejected by validator
      const inferredLoc: UserLocation = {
        city: "Tokyo",
        source: "timezone_inferred",
        provenance: "SAVED_USER",
        enabled: true,
      };
      expect(validateUserLocation(inferredLoc)).toBeNull();

      // resolveEffectiveLocation must reject timezone-only records
      const effective = resolveEffectiveLocation({
        userText: "What city am I in?",
        savedUserLocation: timezoneOnlyLocation,
      });
      expect(effective.effectiveLocation).toBeNull();
    });

    it("Canonical 8: Synthetic fixture detection and rejection (ERR_PROVENANCE_CONTAMINATION)", () => {
      const syntheticLoc: UserLocation = {
        city: "San Francisco",
        latitude: 37.7749,
        longitude: -122.4194,
        provenance: "DEVICE_LIVE",
        isSyntheticOrFixture: true,
      };

      // Must be rejected by validation
      expect(validateUserLocation(syntheticLoc)).toBeNull();

      // Must be rejected by saveUserLocation
      expect(saveUserLocation(syntheticLoc, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");

      // With throwOnError: true, throws ProvenanceContaminationError
      expect(() => {
        saveUserLocation(syntheticLoc, tempDir, { throwOnError: true });
      }).toThrowError(ProvenanceContaminationError);

      // Rejects from provider resolution
      const providerRes = resolveDeviceLocationFromProvider({
        permissionGranted: true,
        city: "San Francisco",
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        isSyntheticOrFixture: true,
      });
      expect(providerRes).toBeNull();
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
    });

    it("Canonical 9: Confidence score boundary validation ([0.00, 1.00]) and fail-closed rejection", () => {
      // 1. Valid confidence values: 0, 1, 0.95, 0.5
      for (const validScore of [0, 1, 0.95, 0.5]) {
        const record = createProvenanceRecord({
          value: "test",
          source: "DEVICE_LIVE",
          confidenceScore: validScore,
        });
        expect(record).not.toBeNull();
        expect(record!.confidenceScore).toBe(validScore);

        const validated = validateProvenanceRecord({
          value: "test",
          source: "DEVICE_LIVE",
          confidenceScore: validScore,
          collectedAtMs: Date.now(),
          expiresAtMs: Date.now() + 1000,
          isSyntheticOrFixture: false,
        });
        expect(validated).not.toBeNull();
        expect(validated!.confidenceScore).toBe(validScore);
      }

      // 2. Invalid confidence values: must fail-closed (return null, never clamp)
      const invalidScores = [
        -0.001,
        -1,
        -999,
        1.0001,
        2,
        999,
        NaN,
        Infinity,
        -Infinity,
        "0.95" as any,
        null as any,
        undefined as any,
        {} as any,
      ];

      for (const invalidScore of invalidScores) {
        // createProvenanceRecord must return null (never clamp to 0 or 1)
        const record = createProvenanceRecord({
          value: "test",
          source: "DEVICE_LIVE",
          confidenceScore: invalidScore,
        });
        expect(record).toBeNull();

        // validateProvenanceRecord must return null
        const validated = validateProvenanceRecord({
          value: "test",
          source: "DEVICE_LIVE",
          confidenceScore: invalidScore,
          collectedAtMs: Date.now(),
          expiresAtMs: Date.now() + 1000,
          isSyntheticOrFixture: false,
        });
        expect(validated).toBeNull();
      }

      // 3. Confirm diagnostic recorded on failure
      const diag = getLastProvenanceDiagnostic();
      expect(diag).not.toBeNull();
      expect(diag!.code).toBe("ERR_PROVENANCE_INVALID");
    });

    it("Canonical 10: Expiry handling and isProvenanceFresh", () => {
      const now = 1700000000000;
      const record = createProvenanceRecord({
        value: { city: "San Francisco", provenance: "DEVICE_LIVE" as ProvenanceSource },
        source: "DEVICE_LIVE",
        confidenceScore: 0.98,
        collectedAtMs: now - 100_000,
        expiresAtMs: now + 200_000,
      });

      expect(record).not.toBeNull();
      expect(isProvenanceFresh(record!, now)).toBe(true);
      expect(isProvenanceFresh(record!, now + 200_001)).toBe(false);

      const freshnessCheck = checkProvenanceFreshness(record!, now + 200_001);
      expect(freshnessCheck.fresh).toBe(false);
      expect(freshnessCheck.record.source).toBe("UNKNOWN/UNAVAILABLE");
      expect(freshnessCheck.record.confidenceScore).toBe(0.0);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_STALE");
    });

    it("Canonical 11: Persistence provenance constraints prevent non-user-approved disk writes", () => {
      // Direct attempt to persist synthetic record wrapped inside ProvenanceRecord
      const wrappedSynthetic: ProvenanceRecord<UserLocation> = {
        value: {
          city: "San Francisco",
          latitude: 37.7749,
          longitude: -122.4194,
          provenance: "DEVICE_LIVE",
        },
        source: "DEVICE_LIVE",
        confidenceScore: 0.99,
        collectedAtMs: Date.now(),
        expiresAtMs: Date.now() + 300_000,
        isSyntheticOrFixture: true,
      };

      expect(saveUserLocation(wrappedSynthetic, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
      expect(loadUserLocation(tempDir)).toBeNull();
    });

    it("Canonical 12: Hardware location permission revocation returns UNKNOWN/UNAVAILABLE", () => {
      const revokedRes = resolveDeviceLocationFromProvider({
        permissionGranted: false,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        city: "San Francisco",
      });

      expect(revokedRes).not.toBeNull();
      expect(revokedRes!.source).toBe("UNKNOWN/UNAVAILABLE");
      expect(revokedRes!.confidenceScore).toBe(0.0);
      expect(revokedRes!.verificationEvidence).toContain("permission denied or revoked");
    });

    it("Canonical 13: Cross-thread and cross-bot isolation with ScopedLocationStore", () => {
      const store = new ScopedLocationStore();

      const locA: UserLocation = {
        city: "Tokyo",
        provenance: "CONVERSATION_CONTEXT",
        enabled: true,
      };

      // Set for bot1 in thread1
      store.setLocation("bot1", "thread1", locA);

      // Accessible in bot1 thread1
      const retrieved = store.getLocation("bot1", "thread1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.value.city).toBe("Tokyo");
      expect(retrieved!.source).toBe("CONVERSATION_CONTEXT");

      // Isolated from thread2
      expect(store.getLocation("bot1", "thread2")).toBeNull();

      // Isolated from bot2
      expect(store.getLocation("bot2", "thread1")).toBeNull();

      // Rejects synthetic fixture
      store.setLocation("bot1", "thread3", {
        city: "FakeCity",
        provenance: "CONVERSATION_CONTEXT",
        isFixture: true,
      });
      expect(store.getLocation("bot1", "thread3")).toBeNull();
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");

      // Clean clearing
      store.clear("bot1", "thread1");
      expect(store.getLocation("bot1", "thread1")).toBeNull();
    });

    it("Canonical 14: Natural language intent discrimination (negation, past-tense, third-person)", () => {
      // 1. Negation with affirmative correction: "I am not in Kyoto. I'm in Osaka."
      const correction = resolveLocationIntent("I am not in Kyoto. I'm in Osaka.", null);
      expect(correction.scope).toBe("explicit_override");
      expect(correction.effectiveLocation?.city).toBe("Osaka");
      expect(correction.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

      // 2. Negation of default location without replacement drops effective location
      const defaultLoc: UserLocation = {
        city: "Denver",
        provenance: "SAVED_USER",
        enabled: true,
      };
      const negatedDefault = resolveLocationIntent("I am not in Denver right now", defaultLoc);
      expect(negatedDefault.effectiveLocation).toBeNull();

      // 3. Past-tense mention is omitted from current user location
      const pastTense = resolveLocationIntent("I visited Kyoto last year", null);
      expect(pastTense.effectiveLocation).toBeNull();
      expect(pastTense.scope).toBe("unrelated");

      // 4. Third-person mention is omitted from user location
      const thirdPerson = resolveLocationIntent("My friend lives in Kyoto", null);
      expect(thirdPerson.effectiveLocation).toBeNull();
      expect(thirdPerson.scope).toBe("unrelated");
    });
  });

  describe("Official Roadmap Phase 36: Location as Real Context (mobot_54_phases_prompt.md:1951-1995)", () => {
    const fixedNow = 1_793_000_000_000; // Deterministic test epoch

    beforeEach(() => {
      clearCachedDeviceFix();
    });

    afterEach(() => {
      clearCachedDeviceFix();
    });

    // ── 1. Freshness & Invariant: 15-minute boundary ──
    describe("Freshness & 15-Minute Expiry Policy", () => {
      it("resolves fresh hardware fix (age <= 15 min) as AVAILABLE with full coordinates", async () => {
        const fixTimestamp = fixedNow - 5 * 60 * 1000; // 5 minutes old
        const res = await resolveLocationContext({
          referenceTimeMs: fixedNow,
          customDataDir: tempDir,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 37.7749, longitude: -122.4194, accuracyMeters: 12 },
            timestampMs: fixTimestamp,
            city: "San Francisco",
          }),
        });

        expect(res.status).toBe("AVAILABLE");
        expect(res.location).toBeDefined();
        expect(res.location?.latitude).toBe(37.7749);
        expect(res.location?.longitude).toBe(-122.4194);
        expect(res.location?.accuracyMeters).toBe(12);
        expect(res.location?.city).toBe("San Francisco");
        expect(res.location?.provenance).toBe("DEVICE_LIVE");
        expect(res.location?.timestampMs).toBe(fixTimestamp);
      });

      it("marks fix at exactly 15 minutes as AVAILABLE, but older than 15 minutes as STALE", async () => {
        // Exactly at 15 minutes (900,000 ms)
        const boundaryTimestamp = fixedNow - LOCATION_FRESHNESS_TTL_MS;
        const resBoundary = await resolveLocationContext({
          referenceTimeMs: fixedNow,
          customDataDir: tempDir,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 37.7749, longitude: -122.4194, accuracyMeters: 10 },
            timestampMs: boundaryTimestamp,
          }),
        });
        expect(resBoundary.status).toBe("AVAILABLE");

        // 1 millisecond past 15 minutes (900,001 ms)
        const expiredTimestamp = fixedNow - (LOCATION_FRESHNESS_TTL_MS + 1);
        const resExpired = await resolveLocationContext({
          referenceTimeMs: fixedNow,
          customDataDir: tempDir,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 37.7749, longitude: -122.4194, accuracyMeters: 10 },
            timestampMs: expiredTimestamp,
          }),
        });
        expect(resExpired.status).toBe("STALE");
        expect(resExpired.location).toBeDefined();
        expect(resExpired.location?.timestampMs).toBe(expiredTimestamp);
        expect(resExpired.policyNotice).toContain("older than 15 minutes");
      });

      it("fails safely on invalid, zero, or future-dated timestamps", async () => {
        // Future timestamp (> now + 60s)
        const futureTimestamp = fixedNow + 5 * 60 * 1000;
        const resFuture = await resolveLocationContext({
          referenceTimeMs: fixedNow,
          customDataDir: tempDir,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
            timestampMs: futureTimestamp,
          }),
        });
        expect(resFuture.status).toBe("UNKNOWN");
        expect(resFuture.policyNotice).toContain("Future-dated");

        // Invalid NaN timestamp
        const resNaN = await resolveLocationContext({
          referenceTimeMs: fixedNow,
          customDataDir: tempDir,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
            timestampMs: NaN,
          }),
        });
        expect(resNaN.status).toBe("UNKNOWN");
      });
    });

    // ── 2. Disabled-by-User Invariant ──
    describe("Disabled-by-User Invariant", () => {
      it("returns DISABLED_BY_USER immediately and NEVER calls provider when setting is disabled", async () => {
        // Disable location in settings
        setLocationContextEnabled(false, tempDir);
        expect(isLocationContextDisabled(tempDir)).toBe(true);

        let providerCalled = false;
        const res = await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
          mockProvider: async () => {
            providerCalled = true;
            return {
              permissionGranted: true,
              rawCoordinates: { latitude: 40.7128, longitude: -74.006 },
            };
          },
        });

        expect(res.status).toBe("DISABLED_BY_USER");
        expect(res.location).toBeUndefined();
        expect(providerCalled).toBe(false); // CRITICAL: Never attempted sensor read
        expect(res.policyNotice).toContain("disabled by user");
      });

      it("does not allow cached location to bypass disabled setting", async () => {
        // Populate cache with fresh fix
        setCachedDeviceFix({
          latitude: 37.7749,
          longitude: -122.4194,
          accuracyMeters: 5,
          timestampMs: fixedNow - 1000,
          provenance: "DEVICE_LIVE",
        });

        // Now user disables location context
        setLocationContextEnabled(false, tempDir);

        const res = await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
        });

        expect(res.status).toBe("DISABLED_BY_USER");
        expect(res.location).toBeUndefined();
      });

      it("re-enabling location setting allows live resolution subject to permissions", async () => {
        setLocationContextEnabled(false, tempDir);
        const disabledRes = await resolveLocationContext({ customDataDir: tempDir });
        expect(disabledRes.status).toBe("DISABLED_BY_USER");

        // Re-enable
        setLocationContextEnabled(true, tempDir);
        expect(isLocationContextDisabled(tempDir)).toBe(false);

        const enabledRes = await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 51.5074, longitude: -0.1278, accuracyMeters: 15 },
            timestampMs: fixedNow,
          }),
        });

        expect(enabledRes.status).toBe("AVAILABLE");
        expect(enabledRes.location?.latitude).toBe(51.5074);
      });
    });

    // ── 3. Permission Revocation & Failure Handling ──
    describe("Permission Denial & ERR_LOCATION_PERMISSION_REVOKED", () => {
      it("returns PERMISSION_DENIED when Android OS reports permission missing or revoked", async () => {
        const res = await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
          mockProvider: async () => ({
            permissionGranted: false,
          }),
        });

        expect(res.status).toBe("PERMISSION_DENIED");
        expect(res.location).toBeUndefined();
        expect(res.policyNotice).toContain("ERR_LOCATION_PERMISSION_REVOKED");
      });

      it("does not return cached live fix as AVAILABLE when permission is revoked", async () => {
        // Cache had a fix
        setCachedDeviceFix({
          latitude: 37.7749,
          longitude: -122.4194,
          accuracyMeters: 5,
          timestampMs: fixedNow - 1000,
          provenance: "DEVICE_LIVE",
        });

        // But permission check fails (e.g. user revoked in Android settings)
        const res = await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
          mockProvider: async () => ({
            permissionGranted: false,
          }),
        });

        expect(res.status).toBe("PERMISSION_DENIED");
        expect(res.location).toBeUndefined();
      });
    });

    // ── 4. Provenance & Privacy Invariants ──
    describe("Provenance & Privacy Invariants", () => {
      it("preserves DEVICE_LIVE provenance and rejects synthetic fixture injection", async () => {
        const syntheticRes = await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
            isSyntheticOrFixture: true, // Malicious or synthetic test payload
          }),
        });

        expect(syntheticRes.status).toBe("UNKNOWN");
        expect(syntheticRes.policyNotice).toContain("Synthetic or fixture location rejected");
      });

      it("never persists live GPS coordinates into long-term user profile without command", async () => {
        // Resolving live GPS location
        await resolveLocationContext({
          customDataDir: tempDir,
          referenceTimeMs: fixedNow,
          mockProvider: async () => ({
            permissionGranted: true,
            rawCoordinates: { latitude: 48.8566, longitude: 2.3522, accuracyMeters: 8 },
            timestampMs: fixedNow,
          }),
        });

        // Verify user-location.json was NOT created or modified by live GPS read
        const saved = loadUserLocation(tempDir);
        expect(saved).toBeNull();
      });

      it("generates correct system prompt block matching resolution status", () => {
        const disabledBlock = formatLocationResolutionPromptBlock({
          status: "DISABLED_BY_USER",
          policyNotice: "Disabled by user",
        });
        expect(disabledBlock).toContain("Status: DISABLED_BY_USER");
        expect(disabledBlock).toContain("MANDATORY INVARIANT");

        const deniedBlock = formatLocationResolutionPromptBlock({
          status: "PERMISSION_DENIED",
          policyNotice: "Permission revoked",
        });
        expect(deniedBlock).toContain("Status: PERMISSION_DENIED");

        const staleBlock = formatLocationResolutionPromptBlock({
          status: "STALE",
          location: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracyMeters: 10,
            provenance: "DEVICE_LIVE",
            timestampMs: fixedNow - 20 * 60 * 1000,
          },
        });
        expect(staleBlock).toContain("Status: STALE");
        expect(staleBlock).toContain("37.7749");
      });
    });
  });
});

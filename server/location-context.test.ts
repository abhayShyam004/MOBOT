import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearUserLocation,
  formatLocationPromptBlock,
  loadUserLocation,
  localizeSearchQuery,
  resolveEffectiveLocation,
  resolveLocationIntent,
  saveUserLocation,
  validateUserLocation,
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
});

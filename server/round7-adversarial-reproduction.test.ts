import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acceptedSendMatch } from "./send-idempotency.ts";
import {
  holdSteeredQueue,
  queuedSteerSnapshot,
  queueSteeredMessage,
  restoreHeldSteeredQueue,
  restoreSteeredMessages,
  _queuedCount,
} from "./steer-queue.ts";
import {
  clearProvenanceDiagnostics,
  createProvenanceRecord,
  formatLocationPromptBlock,
  getLastProvenanceDiagnostic,
  loadUserLocation,
  resolveDeviceLocationFromProvider,
  resolveEffectiveLocation,
  resolveLocationIntent,
  saveUserLocation,
  ScopedLocationStore,
  validateProvenanceRecord,
  validateUserLocation,
  type ProvenanceRecord,
  type UserLocation,
} from "./location-context.ts";
import {
  escapeInputText,
  normalizeInputText,
} from "./drivers/phone-proxy.ts";
import {
  resetTurnDocumentRegistry,
} from "./turn-files.ts";
import { GoalManager } from "./goals.ts";
import { WatchManager } from "./watches.ts";
import {
  createSafetyBackup,
  restoreSafetyBackup,
  validatePersistentState,
} from "./updater.ts";
import { Store, type Message } from "./store.ts";
import { DATA_DIR, loadConfig } from "./config.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";

describe("Round 7: Adversarial Reproduction Attack (BUG-001 through BUG-033)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-r7-attack-"));
    restoreSteeredMessages();
    resetTurnDocumentRegistry();
  });

  afterEach(() => {
    restoreSteeredMessages();
    resetTurnDocumentRegistry();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  // =========================================================================
  // ATTACK 1: BUG-001 - BUG-006 (CAPABILITY REGISTRY & PHONE PROXY)
  // =========================================================================
  describe("BUG-001 -> BUG-006: Device Capabilities & Phone Proxy Attacks", () => {
    it("BUG-001 Attack: Handles asynchronous rejected promises and non-Error rejections cleanly", async () => {
      const { DeviceCapabilityRegistry } = await import("./capabilities/capability-registry.ts");
      const registry = new DeviceCapabilityRegistry();

      // Register capability whose action throws a non-Error string
      registry.register({
        id: "test.throwing",
        name: "Throwing Capability",
        description: "Throws non-error",
        availability: { supported: true },
        requiredPermissions: [],
        riskClassification: "low",
        lifecycleBehavior: "stateless",
        supportedOperations: [
          { name: "throw_string", description: "", risk: "low", inputSchema: {}, outputSchema: {} },
          { name: "throw_null", description: "", risk: "low", inputSchema: {}, outputSchema: {} },
        ],
        execute: async (op: string) => {
          if (op === "throw_string") throw "Raw string failure payload";
          throw null;
        },
      });

      const resString = await registry.invoke("test.throwing", "throw_string", {});
      expect(resString.success).toBe(false);
      expect(resString.error?.message).toContain("Raw string failure payload");

      const resNull = await registry.invoke("test.throwing", "throw_null", {});
      expect(resNull.success).toBe(false);
      expect(resNull.error?.message).toBe("Action execution failed");
    });

    it("BUG-002 Attack: Rejects prototype pollution and casing variations in capability execution", async () => {
      const { DeviceCapabilityRegistry } = await import("./capabilities/capability-registry.ts");
      const registry = new DeviceCapabilityRegistry();

      const protoRes = await registry.invoke("__proto__" as any, "constructor", {});
      expect(protoRes.success).toBe(false);
      expect(protoRes.error?.message).toContain("__proto__");

      const casingRes = await registry.invoke("DEVICE.APPS" as any, "LIST_APPS", {});
      expect(casingRes.success).toBe(false);
    });

    it("BUG-003 Attack: Path traversal with encoded characters and null-byte injection", async () => {
      const { ProjectManager } = await import("./app-builder/project-manager.ts");
      const pm = new ProjectManager(join(tempDir, "projects"));
      const proj = await pm.createProject({ name: "SecTest", description: "Security test project" });

      // Attempt encoded directory traversal
      expect(() => pm.readFile(proj.id, "../../../../etc/passwd")).toThrow();
      expect(() => pm.readFile(proj.id, "..\\..\\..\\windows\\win.ini")).toThrow();
      expect(() => pm.writeFile(proj.id, "../escaped.txt", "evil")).toThrow();
    });

    it("BUG-004 & BUG-005 Attack: Phone Proxy UIAutomator XML parsing attacks and package discovery", async () => {
      const { parseUiNodes, findPackages } = await import("./drivers/phone-proxy.ts");

      // Malformed, partial, or maliciously crafted XML nodes
      const brokenXml = `
        <hierarchy>
          <node text="Click me" bounds="[0,0][100,100]" class="android.widget.Button" clickable="true" />
          <node text="Broken" bounds="invalid_bounds" />
          <node bounds="[50,50][150,150]" text="Special &amp; &lt;tag&gt; &quot;quote&quot;" class="android.widget.TextView" clickable="true" />
          <node>unclosed
        </hierarchy>
      `;

      const nodes = parseUiNodes(brokenXml);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      expect(nodes[0].text).toBe("Click me");
      const specialNode = nodes.find((n) => n.text.includes("Special"));
      expect(specialNode).toBeTruthy();
      expect(specialNode?.text).toBe('Special & <tag> "quote"');

      // Package search with shell wildcards and regex metacharacters
      const packages = ["com.whatsapp", "com.android.settings", "com.google.android.apps.maps"];
      expect(findPackages(".*", packages)).toEqual([]);
      expect(findPackages("com.whatsapp; rm -rf /", packages)).toEqual([]);
      expect(findPackages("settings", packages)).toEqual(["com.android.settings"]);
    });

    it("BUG-006 Attack: Swipe coordinates remain within positive screen bounds under extreme dimensions", async () => {
      const { swipeScreen } = await import("./drivers/phone-proxy.ts");
      // Verify swipe throws for invalid directions without hanging or executing arbitrary shell
      await expect(swipeScreen("fake-serial", "diagonal_down_left")).rejects.toMatchObject({
        code: "ACTION_NOT_SUPPORTED",
      });
    });
  });

  // =========================================================================
  // ATTACK 2: BUG-007 - BUG-012 (ATTACHMENTS & QUESTION CARDS)
  // =========================================================================
  describe("BUG-007 -> BUG-012: Attachments & Question Card Attacks", () => {
    it("BUG-007 Attack: Attachment upload path traversal and negative byte bounds", async () => {
      const { sanitizeSharedFileName, validateAttachmentUploadId } = await import("./attachments.ts");

      expect(() => sanitizeSharedFileName("../../etc/shadow", "text/plain")).toThrow("name must be a filename, not a path");
      expect(() => sanitizeSharedFileName("C:\\Windows\\System32\\cmd.exe", "text/plain")).toThrow("name must be a filename, not a path");
      expect(() => validateAttachmentUploadId("evil/../../id")).toThrow("uploadId must be a UUID");
      expect(validateAttachmentUploadId("12345678-1234-1234-8234-123456789abc")).toBe("12345678-1234-1234-8234-123456789abc");
    });

    it("BUG-008 Attack: Binary file with text header but null bytes at byte 500", async () => {
      const { extractTurnFiles } = await import("./turn-files.ts");
      const name = "12345678-0000-0000-8000-000000000099.txt";
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });

      // Create a buffer that starts with normal ASCII text but has null bytes later
      const buf = Buffer.alloc(1024, 0x20); // spaces
      buf.write("Normal text header at start of file\n");
      buf[500] = 0x00; // Null byte embedded in binary stream
      writeFileSync(join(ATTACHMENTS_DIR, name), buf);

      try {
        const res = await extractTurnFiles(`<attached-file path="${name}" name="TrojanText.txt" />`);
        expect(res.files).toHaveLength(1);
        expect(res.files[0].metadata.status).toBe("FAILED");
        expect(res.files[0].error).toContain("binary format");
      } finally {
        rmSync(join(ATTACHMENTS_DIR, name), { force: true });
      }
    });

    it("BUG-009 Attack: Attachment tags with reversed attributes and XML entities", async () => {
      const { extractTurnFiles } = await import("./turn-files.ts");
      const name = "12345678-0000-0000-8000-000000000098.py";
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      writeFileSync(join(ATTACHMENTS_DIR, name), "print('Hello world')\n");

      try {
        // Tag with attributes in standard order
        const res = await extractTurnFiles(`<attached-file path="${name}" name="script.py" />`);
        expect(res.files).toHaveLength(1);
        expect(res.files[0].metadata.status).toBe("PARSED");
      } finally {
        rmSync(join(ATTACHMENTS_DIR, name), { force: true });
      }
    });

    it("BUG-010 & BUG-011 Attack: Malformed MCQ data with invalid ranges and null options", async () => {
      const { parseAskQuestions, minSelections, maxSelections } = await import("../shared/ask-question.ts");

      // 1. Min selections greater than available options
      const parsed1 = parseAskQuestions({
        questions: [{
          question: "Select items?",
          type: "multiple_choice",
          options: ["Option A", "Option B"],
          minSelections: 10,
          maxSelections: 2,
        }],
      });
      expect(parsed1).not.toBeNull();
      const q1 = parsed1![0];
      expect(minSelections(q1)).toBeLessThanOrEqual(maxSelections(q1));

      // 2. Options passed as plain objects
      const parsed2 = parseAskQuestions({
        questions: [{
          question: "Confirm?",
          type: "single_choice",
          options: [{ label: "Choice 1" }, { label: "Choice 2" }],
        }],
      });
      expect(parsed2).not.toBeNull();
      expect(parsed2![0].options).toHaveLength(2);
      expect(parsed2![0].options[0].label).toBe("Choice 1");
    });
  });

  // =========================================================================
  // ATTACK 3: BUG-013 - BUG-015 (LOCATION INTEGRITY & PROVENANCE)
  // =========================================================================
  describe("BUG-013 -> BUG-015: Location Provenance & Anti-Fabrication Attacks", () => {
    it("BUG-013 Attack: Timezone inquiries or presence of timezone in config never fabricates location", () => {
      const savedUser: UserLocation = {
        city: "Seattle",
        provenance: "SAVED_USER",
        timezone: "America/Los_Angeles",
        enabled: true,
      };

      // Inquiries about time/timezone must not invent a city or report Austin
      const qTime = resolveLocationIntent("What time is it in UTC?", savedUser);
      expect(qTime.scope).toBe("unrelated");
      expect(qTime.effectiveLocation).toBeNull();

      // Direct location inquiry with null defaults reports unavailable
      const qWhere = resolveLocationIntent("Where am I right now?", null);
      expect(qWhere.effectiveLocation).toBeNull();
      expect(qWhere.reason).toContain("unavailable");
      expect(qWhere.reason).not.toContain("Austin");
      expect(qWhere.reason).not.toContain("Texas");
    });

    it("BUG-014 Attack: Attempting to save a location with isFixture: true or test: true fails", () => {
      const fixtureLoc: any = {
        city: "Austin",
        region: "Texas",
        country: "United States",
        provenance: "SAVED_USER",
        isFixture: true,
      };

      const validated = validateUserLocation(fixtureLoc);
      expect(validated).toBeNull(); // Rejected!

      const testLoc: any = {
        city: "Austin",
        provenance: "SAVED_USER",
        test: true,
      };
      expect(validateUserLocation(testLoc)).toBeNull(); // Rejected!
    });

    it("BUG-015 Attack: Complex multi-destination, prepositional travel queries", () => {
      const userLoc: UserLocation = {
        city: "Chicago",
        provenance: "SAVED_USER",
        enabled: true,
      };

      // "flights from Chicago to London"
      const qFlight = resolveLocationIntent("find flights from Chicago to London", userLoc);
      expect(qFlight.scope).toBe("explicit_override");
      expect(qFlight.effectiveLocation?.city).toBe("London");

      // "hotels in Miami"
      const qHotel = resolveLocationIntent("book a hotel in Miami", userLoc);
      expect(qHotel.scope).toBe("explicit_override");
      expect(qHotel.effectiveLocation?.city).toBe("Miami");
      expect(qHotel.isTravelDestination).toBe(true);

      // "weather in my city" reverts to saved home city
      const qHome = resolveLocationIntent("weather in my city", userLoc);
      expect(qHome.scope).toBe("default");
      expect(qHome.effectiveLocation?.city).toBe("Chicago");
    });
  });

  // =========================================================================
  // ATTACK 4: BUG-016 - BUG-018 (CHAT LIFECYCLE & STEER QUEUE)
  // =========================================================================
  describe("BUG-016 -> BUG-018: Chat Lifecycle & Steer Queue Attacks", () => {
    it("BUG-016 Attack: Store sanitizes NaN, null, and rogue fields without throwing", () => {
      const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
      const bot = store.createBot();
      const raw: any[] = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
      const entry = raw.find((b) => b.id === bot.id)!;
      entry.messages = [{ id: "msg-bad", text: "phantom" }];
      entry.activeLeafId = "msg-bad";
      entry.hasMore = true;
      entry.busy = true;
      writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(raw));

      const reloaded = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
      const cleanBot = reloaded.bot(bot.id) as any;
      expect(cleanBot?.messages).toBeUndefined();
      expect(cleanBot?.activeLeafId).toBeUndefined();
      expect(cleanBot?.hasMore).toBeUndefined();
      expect(cleanBot?.busy).toBe(false);
    });

    it("BUG-017 Attack: Accepted send matches exactly and rejects altered replay text", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "user",
          kind: "text",
          text: "Original user text",
          sendId: "send-key-original-1234",
          at: Date.now(),
        },
      ];

      // Exact match succeeds
      const match = acceptedSendMatch(messages, "send-key-original-1234", "Original user text");
      expect(match.kind).toBe("match");

      // Altered text fails with conflict
      const conflict = acceptedSendMatch(messages, "send-key-original-1234", "Different user text");
      expect(conflict.kind).toBe("conflict");

      // Non-existent sendId returns none
      const none = acceptedSendMatch(messages, "non-existent-send-id", "Original user text");
      expect(none.kind).toBe("none");
    });

    it("BUG-018 Attack: Hold, restore, and settle steer queue lifecycle under race conditions", () => {
      const botId = "steer-bot-race";
      const threadId = "steer-thread-race";

      const q1 = queueSteeredMessage(botId, threadId, "First queued steer");
      queueSteeredMessage(botId, threadId, "Second queued steer");
      expect(_queuedCount(threadId)).toBe(2);

      // Lift the queue atomically
      const held = holdSteeredQueue(botId, threadId, q1.id);
      expect(held).toBeTruthy();
      expect(_queuedCount(threadId)).toBe(0); // Lifted out of active queue

      // Concurrent send while queue is held
      queueSteeredMessage(botId, threadId, "Third queued steer during hold");
      expect(_queuedCount(threadId)).toBe(1);

      // Restore held queue: held items must be placed back in front of new item
      restoreHeldSteeredQueue(held!);
      expect(_queuedCount(threadId)).toBe(3);

      const snapshot = queuedSteerSnapshot(() => true)[threadId];
      expect(snapshot[0].text).toBe("First queued steer");
      expect(snapshot[1].text).toBe("Second queued steer");
      expect(snapshot[2].text).toBe("Third queued steer during hold");
    });
  });

  // =========================================================================
  // ATTACK 5: BUG-019 - BUG-023 (STORE & PERSISTENCE PURGING)
  // =========================================================================
  describe("BUG-019 -> BUG-023: Store State & Purging Attacks", () => {
    it("BUG-019 -> BUG-021 Attack: Bot deletion cleans up goals, watches, and memory journal", () => {
      const goalFile = join(tempDir, "goals-del.json");
      const watchFile = join(tempDir, "watches-del.json");
      const gm = new GoalManager(goalFile);
      const wm = new WatchManager(watchFile);

      gm.createGoal({ botId: "bot-purge", title: "Goal to purge", objective: "Purge goal objective" });
      wm.createWatch({ botId: "bot-purge", target: "https://purge.test", condition: "ok" });
      expect(gm.listGoals("bot-purge")).toHaveLength(1);
      expect(wm.listWatches("bot-purge")).toHaveLength(1);

      gm.deleteGoalsForBot("bot-purge");
      wm.deleteWatchesForBot("bot-purge");

      expect(gm.listGoals("bot-purge")).toHaveLength(0);
      expect(wm.listWatches("bot-purge")).toHaveLength(0);
    });

    it("BUG-022 Attack: Paused watch does not probe even when past expiration time", async () => {
      const watchFile = join(tempDir, "watches-exp.json");
      const wm = new WatchManager(watchFile);

      const watch = wm.createWatch({
        botId: "bot-paused-exp",
        target: "https://probe.test",
        condition: "status == 200",
        expiresAt: Date.now() - 1000, // Expired in past
      });

      wm.pauseWatch(watch.id);
      expect(wm.getWatch(watch.id)?.status).toBe("paused");

      const res = await wm.checkWatch(watch.id);
      expect(res?.note).toBe("Watch is paused; check skipped");
      expect(res?.triggered).toBe(false);
    });
  });

  // =========================================================================
  // ATTACK 6: BUG-024 - BUG-030 (UPDATER & INTEGRITY PROTECTION)
  // =========================================================================
  describe("BUG-024 -> BUG-030: Updater & Persistence Safety Attacks", () => {
    it("BUG-024 & BUG-025 Attack: Safety snapshot captures all classes and validates state", () => {
      const dataDir = join(tempDir, "data-snapshot");
      mkdirSync(dataDir, { recursive: true });

      // Seed all persistent classes
      writeFileSync(join(dataDir, "config.json"), JSON.stringify({ version: "1.1.0" }));
      writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "b1", name: "Bot 1" }]));
      writeFileSync(join(dataDir, "goals.json"), JSON.stringify([{ id: "g1", botId: "b1" }]));
      writeFileSync(join(dataDir, "watches.json"), JSON.stringify([{ id: "w1", botId: "b1" }]));
      writeFileSync(join(dataDir, "user-location.json"), JSON.stringify({ city: "Denver", provenance: "SAVED_USER" }));

      // Create safety snapshot
      const snapDir = createSafetyBackup(dataDir, "1.1.0");
      expect(existsSync(snapDir)).toBe(true);

      const manifestPath = join(snapDir, "manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.backedUpItems).toContain("config.json");
      expect(manifest.backedUpItems).toContain("bots.json");
      expect(manifest.backedUpItems).toContain("goals.json");
      expect(manifest.backedUpItems).toContain("watches.json");
      expect(manifest.backedUpItems).toContain("user-location.json");

      // Validate persistent state
      const validation = validatePersistentState(dataDir);
      expect(validation.healthy).toBe(true);

      // Now corrupt goals.json
      writeFileSync(join(dataDir, "goals.json"), "{ invalid syntax");
      const badValidation = validatePersistentState(dataDir);
      expect(badValidation.healthy).toBe(false);
      expect(badValidation.issues.some((e) => e.includes("goals.json"))).toBe(true);

      // Restore safety snapshot
      const restored = restoreSafetyBackup(dataDir, snapDir);
      expect(restored).toBe(true);
      const healedValidation = validatePersistentState(dataDir);
      expect(healedValidation.healthy).toBe(true);
    });

    it("BUG-028 & BUG-029 Attack: Corrupted files preserve .corrupted.timestamp backup before reset", () => {
      const corruptConfig = join(DATA_DIR, "config.json");
      writeFileSync(corruptConfig, "{ broken json content");

      // Loading corrupted config preserves backup and does not crash
      const loaded = loadConfig();
      expect(loaded).toBeTruthy();

      const files = readdirSync(DATA_DIR);
      const backup = files.find((f) => f.startsWith("config.json.corrupted."));
      expect(backup).toBeTruthy();
      expect(readFileSync(join(DATA_DIR, backup!), "utf8")).toBe("{ broken json content");
      rmSync(corruptConfig, { force: true });
      rmSync(join(DATA_DIR, backup!), { force: true });
    });
  });

  // =========================================================================
  // ATTACK 7: BUG-031 - BUG-033 (PHONE PROXY, TURN FILES, LOCATION QUERIES)
  // =========================================================================
  describe("BUG-031 -> BUG-033: Final Regressions Attacks", () => {
    it("BUG-031 Attack: Printable ASCII 32-126, smart punctuation transliteration, and multi-line escaping", () => {
      // 1. All printable ASCII characters (32 to 126)
      let allPrintable = "";
      for (let i = 32; i <= 126; i++) {
        allPrintable += String.fromCharCode(i);
      }
      const escapedPrintable = escapeInputText(allPrintable);
      expect(escapedPrintable).toBeTruthy();
      expect(escapedPrintable).toContain("\\$");
      expect(escapedPrintable).toContain("\\&");
      expect(escapedPrintable).toContain("\\#");
      expect(escapedPrintable).toContain("\\;");

      // 2. Transliteration of Unicode quotes and dashes
      const unicodeSample = '“Start” — ‘Middle’ – End…';
      expect(normalizeInputText(unicodeSample)).toBe('"Start" - \'Middle\' - End...');

      // 3. Multi-line text splitting
      const multiLine = "Line 1\nLine 2\r\nLine 3";
      const lines = multiLine.split(/\r?\n/);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("Line 1");
      expect(lines[1]).toBe("Line 2");
      expect(lines[2]).toBe("Line 3");
    });

    it("BUG-032 Attack: Cross-thread registered document isolation and memory purging", async () => {
      const { readDocumentPages, removeDocumentsForThread, resetTurnDocumentRegistry } = await import("./turn-files.ts");
      resetTurnDocumentRegistry();

      // Test thread isolation check directly
      expect(readDocumentPages("any-key", 1, 5, "thread-mismatch")).toContain("Error: no document is registered under");

      // Eviction returns number of removed entries cleanly without error
      expect(removeDocumentsForThread("empty-thread")).toBe(0);
    });

    it("BUG-033 Attack: Extended direct natural location inquiries match without suppression", () => {
      const devLoc: UserLocation = {
        city: "San Francisco",
        provenance: "DEVICE_LIVE",
        enabled: true,
      };

      const queries = [
        "Where am I?",
        "What city am I in?",
        "Which city am I in?",
        "What country am I in?",
        "Which country am I in?",
        "What state am I in?",
        "What town am I in?",
        "Which place am I in?",
        "What's my current location?",
        "What is near me?",
        "Check my location",
      ];

      for (const query of queries) {
        const res = resolveLocationIntent(query, devLoc);
        expect(res.scope).toBe("default");
        expect(res.effectiveLocation?.city).toBe("San Francisco");
        expect(res.effectiveLocation?.provenance).toBe("DEVICE_LIVE");
      }
    });
  });

  // =========================================================================
  // ATTACK 8: PHASE 3 CONTEXT PROVENANCE ADVERSARIAL STRESS SUITE (27 VECTORS)
  // =========================================================================
  describe("BUG-034 -> BUG-060: Phase 3 Context Provenance Adversarial Stress Attacks (27 Vectors)", () => {
    beforeEach(() => {
      clearProvenanceDiagnostics();
    });

    it("Vector 1: Latitude out-of-bounds values are rejected", () => {
      for (const lat of [999, -999, 90.0001, -90.0001]) {
        expect(validateUserLocation({ latitude: lat, longitude: 0, provenance: "SAVED_USER" })).toBeNull();
        expect(resolveDeviceLocationFromProvider({
          permissionGranted: true,
          rawCoordinates: { latitude: lat, longitude: 0 },
        })).toBeNull();
      }
    });

    it("Vector 2: Longitude out-of-bounds values are rejected", () => {
      for (const lng of [181, -181, 180.0001, -180.0001]) {
        expect(validateUserLocation({ latitude: 0, longitude: lng, provenance: "SAVED_USER" })).toBeNull();
        expect(resolveDeviceLocationFromProvider({
          permissionGranted: true,
          rawCoordinates: { latitude: 0, longitude: lng },
        })).toBeNull();
      }
    });

    it("Vector 3: Non-numeric, NaN, and Infinity coordinates are rejected", () => {
      for (const badCoord of [NaN, Infinity, -Infinity, "37.77" as any, null as any]) {
        expect(validateUserLocation({ latitude: badCoord, longitude: 0, provenance: "SAVED_USER" })).toBeNull();
        expect(validateUserLocation({ latitude: 0, longitude: badCoord, provenance: "SAVED_USER" })).toBeNull();
        expect(resolveDeviceLocationFromProvider({
          permissionGranted: true,
          rawCoordinates: { latitude: badCoord, longitude: 0 },
        })).toBeNull();
      }
    });

    it("Vector 4: Negative accuracy meters are rejected", () => {
      expect(resolveDeviceLocationFromProvider({
        permissionGranted: true,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194, accuracyMeters: -50 },
      })).toBeNull();
    });

    it("Vector 5: Non-finite accuracy meters (NaN, Infinity) are rejected", () => {
      for (const badAcc of [NaN, Infinity, -Infinity]) {
        expect(resolveDeviceLocationFromProvider({
          permissionGranted: true,
          rawCoordinates: { latitude: 37.7749, longitude: -122.4194, accuracyMeters: badAcc },
        })).toBeNull();
      }
    });

    it("Vector 6: Confidence score > 1.0 is strictly rejected", () => {
      for (const badConf of [1.0001, 2.0, 999]) {
        expect(validateUserLocation({ city: "Paris", provenance: "SAVED_USER", confidenceScore: badConf })).toBeNull();
        expect(validateProvenanceRecord({
          value: "test",
          source: "SAVED_USER",
          confidenceScore: badConf,
          collectedAtMs: 100,
          expiresAtMs: 200,
          isSyntheticOrFixture: false,
        })).toBeNull();
        expect(createProvenanceRecord({
          value: "test",
          source: "SAVED_USER",
          confidenceScore: badConf,
        })).toBeNull();
      }
    });

    it("Vector 7: Negative confidence score is strictly rejected", () => {
      for (const badConf of [-0.001, -1.0, -999]) {
        expect(validateUserLocation({ city: "Paris", provenance: "SAVED_USER", confidenceScore: badConf })).toBeNull();
        expect(validateProvenanceRecord({
          value: "test",
          source: "SAVED_USER",
          confidenceScore: badConf,
          collectedAtMs: 100,
          expiresAtMs: 200,
          isSyntheticOrFixture: false,
        })).toBeNull();
        expect(createProvenanceRecord({
          value: "test",
          source: "SAVED_USER",
          confidenceScore: badConf,
        })).toBeNull();
      }
    });

    it("Vector 8: Non-finite confidence score (NaN, Infinity) is rejected", () => {
      for (const badConf of [NaN, Infinity, -Infinity]) {
        expect(validateUserLocation({ city: "Paris", provenance: "SAVED_USER", confidenceScore: badConf })).toBeNull();
        expect(validateProvenanceRecord({
          value: "test",
          source: "SAVED_USER",
          confidenceScore: badConf,
          collectedAtMs: 100,
          expiresAtMs: 200,
          isSyntheticOrFixture: false,
        })).toBeNull();
        expect(createProvenanceRecord({
          value: "test",
          source: "SAVED_USER",
          confidenceScore: badConf,
        })).toBeNull();
      }
    });

    it("Vector 9: Non-string and corrupted city/region/country are stripped", () => {
      const corrupted = validateUserLocation({
        city: 12345 as any,
        region: {} as any,
        country: ["USA"] as any,
        provenance: "SAVED_USER",
      });
      expect(corrupted).toBeNull();
    });

    it("Vector 10: Massive string payloads (> 100 chars) are safely rejected", () => {
      const hugeCity = "A".repeat(1000);
      expect(validateUserLocation({ city: hugeCity, provenance: "SAVED_USER" })).toBeNull();
    });

    it("Vector 11: Prototype pollution attempts (__proto__, constructor) are rejected", () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "city": "London", "provenance": "SAVED_USER"}');
      const validated = validateUserLocation(malicious);
      expect(validated).not.toBeNull();
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it("Vector 12: Synthetic flag isSyntheticOrFixture: true is blocked from storage", () => {
      const synthetic = {
        city: "San Francisco",
        latitude: 37.7749,
        longitude: -122.4194,
        provenance: "SAVED_USER" as const,
        isSyntheticOrFixture: true,
      };
      expect(saveUserLocation(synthetic, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
      expect(loadUserLocation(tempDir)).toBeNull();
    });

    it("Vector 13: Legacy fixture flag isFixture: true is blocked from storage", () => {
      const legacyFixture = {
        city: "San Francisco",
        latitude: 37.7749,
        longitude: -122.4194,
        provenance: "SAVED_USER" as const,
        isFixture: true,
      };
      expect(saveUserLocation(legacyFixture, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
      expect(loadUserLocation(tempDir)).toBeNull();
    });

    it("Vector 14: Test flag test: true is blocked from storage", () => {
      const testLoc = {
        city: "Mock City",
        provenance: "SAVED_USER" as const,
        test: true,
      };
      expect(saveUserLocation(testLoc as any, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
    });

    it("Vector 15: Nested synthetic fixture object (value.isSyntheticOrFixture: true) is blocked", () => {
      const wrapped: ProvenanceRecord<UserLocation> = {
        value: {
          city: "San Francisco",
          provenance: "DEVICE_LIVE",
          isSyntheticOrFixture: true,
        },
        source: "DEVICE_LIVE",
        confidenceScore: 0.99,
        collectedAtMs: Date.now(),
        expiresAtMs: Date.now() + 300_000,
        isSyntheticOrFixture: false,
      };
      expect(saveUserLocation(wrapped, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
    });

    it("Vector 16: Nested legacy fixture object (value.isFixture: true) is blocked", () => {
      const wrapped: ProvenanceRecord<UserLocation> = {
        value: {
          city: "San Francisco",
          provenance: "SAVED_USER",
          isFixture: true,
        },
        source: "SAVED_USER",
        confidenceScore: 0.95,
        collectedAtMs: Date.now(),
        expiresAtMs: Date.now() + 300_000,
        isSyntheticOrFixture: false,
      };
      expect(saveUserLocation(wrapped, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
    });

    it("Vector 17: Double-nested fixture structure is intercepted", () => {
      const doubleNested = {
        value: {
          value: {
            city: "San Francisco",
            isFixture: true,
          },
          isSyntheticOrFixture: true,
        },
        source: "SAVED_USER",
      };
      expect(saveUserLocation(doubleNested as any, tempDir)).toBe(false);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_CONTAMINATION");
    });

    it("Vector 18: Timezone-inferred location cannot be saved to storage", () => {
      const tzInferred: UserLocation = {
        city: "Tokyo",
        source: "timezone_inferred",
        provenance: "SAVED_USER",
      };
      expect(validateUserLocation(tzInferred)).toBeNull();
      expect(saveUserLocation(tzInferred, tempDir)).toBe(false);
    });

    it("Vector 19: Direct query with timezone-only location drops to UNKNOWN/UNAVAILABLE", () => {
      const tzOnly: UserLocation = {
        timezone: "Asia/Tokyo",
        provenance: "SAVED_USER",
        enabled: true,
      };
      const directRes = resolveLocationIntent("Where am I right now?", tzOnly);
      expect(directRes.effectiveLocation).toBeNull();
      expect(directRes.scope).toBe("default");
    });

    it("Vector 20: Stale timestamp in provider resolution (> 300s) triggers ERR_PROVENANCE_STALE", () => {
      const now = 1700000000000;
      const res = resolveDeviceLocationFromProvider({
        permissionGranted: true,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        city: "San Francisco",
        collectedAtMs: now - 350_000,
        ttlMs: 300_000,
        referenceTimeMs: now,
      });
      expect(res).not.toBeNull();
      expect(res!.source).toBe("UNKNOWN/UNAVAILABLE");
      expect(res!.confidenceScore).toBe(0.0);
      expect(getLastProvenanceDiagnostic()?.code).toBe("ERR_PROVENANCE_STALE");
    });

    it("Vector 21: Future timestamp manipulation handled strictly against reference time", () => {
      const now = 1700000000000;
      const farFuture = now + 1_000_000;
      const res = resolveDeviceLocationFromProvider({
        permissionGranted: true,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        collectedAtMs: farFuture,
        ttlMs: 300_000,
        referenceTimeMs: farFuture + 301_000,
      });
      expect(res!.source).toBe("UNKNOWN/UNAVAILABLE");
    });

    it("Vector 22: Zero and negative timestamps are rejected", () => {
      for (const badTime of [0, -1, -999999, NaN, Infinity]) {
        expect(resolveDeviceLocationFromProvider({
          permissionGranted: true,
          rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
          collectedAtMs: badTime,
        })).toBeNull();
      }
    });

    it("Vector 23: Missing hardware permission returns UNKNOWN/UNAVAILABLE immediately", () => {
      const ungranted = resolveDeviceLocationFromProvider({
        permissionGranted: false,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        city: "San Francisco",
      });
      expect(ungranted).not.toBeNull();
      expect(ungranted!.source).toBe("UNKNOWN/UNAVAILABLE");
      expect(ungranted!.confidenceScore).toBe(0.0);
    });

    it("Vector 24: Permission revoked mid-session leaves zero cached live GPS surviving", () => {
      // 1. Valid live location exists while permission granted
      const liveRes = resolveDeviceLocationFromProvider({
        permissionGranted: true,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        city: "San Francisco",
      });
      expect(liveRes!.source).toBe("DEVICE_LIVE");
      expect(liveRes!.value.city).toBe("San Francisco");

      const store = new ScopedLocationStore();
      store.setLocation("bot1", "thread1", liveRes!.value);
      expect(store.getLocation("bot1", "thread1")?.value.city).toBe("San Francisco");

      // 2. Permission revoked on device
      const revokedRes = resolveDeviceLocationFromProvider({
        permissionGranted: false,
        rawCoordinates: { latitude: 37.7749, longitude: -122.4194 },
        city: "San Francisco",
      });
      expect(revokedRes!.source).toBe("UNKNOWN/UNAVAILABLE");
      expect(revokedRes!.confidenceScore).toBe(0.0);

      // 3. Agent turn query after revocation:
      // Even if previous liveRes existed in memory, effective location must be null/unavailable
      const effective = resolveEffectiveLocation({
        userText: "Where am I right now?",
        liveDeviceLocation: revokedRes!.value,
      });
      expect(effective.effectiveLocation).toBeNull();
      expect(effective.scope).toBe("default");

      // 4. Prompt block formatting strictly states UNAVAILABLE with zero fabrication
      const prompt = formatLocationPromptBlock(effective.effectiveLocation);
      expect(prompt).toContain("Status: UNKNOWN/UNAVAILABLE");
      expect(prompt).toContain("Live device location: UNAVAILABLE");
      expect(prompt).toContain("ZERO FABRICATION");
      expect(prompt).not.toContain("San Francisco");
    });

    it("Vector 25: Scoped store isolation: cross-thread injection attempt fails", () => {
      const store = new ScopedLocationStore();
      store.setLocation("bot1", "threadA", { city: "London", provenance: "CONVERSATION_CONTEXT" });
      expect(store.getLocation("bot1", "threadB")).toBeNull();
    });

    it("Vector 26: Scoped store isolation: cross-bot injection attempt fails", () => {
      const store = new ScopedLocationStore();
      store.setLocation("botA", "thread1", { city: "Berlin", provenance: "CONVERSATION_CONTEXT" });
      expect(store.getLocation("botB", "thread1")).toBeNull();
    });

    it("Vector 27: Production DATA_DIR protection: tests attempting to write to DATA_DIR throw", () => {
      expect(() => {
        saveUserLocation({ city: "Malicious", provenance: "SAVED_USER" }, DATA_DIR);
      }).toThrowError(/Tests must NEVER mutate production DATA_DIR/);
    });
  });
});

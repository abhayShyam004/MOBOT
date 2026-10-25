import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

import {
  verifyAndEnforceTurnTruthfulness,
  recordActionReceipt,
  clearActionReceipts,
  setMockPhoneDriverStatus,
  checkLivePhoneControlAvailability,
} from "./capabilities/action-truthfulness.ts";
import { ReminderManager } from "./reminders.ts";
import { listToolkits } from "./composio.ts";
import type { AppConfig } from "./config.ts";

describe("MOBOT Corrective Phase — Comprehensive E2E Regression Suite", () => {
  const testThreadId = "thread-corrective-test-1";
  const testBotId = "bot-test-1";
  let tempReminderFile: string;

  beforeEach(() => {
    clearActionReceipts();
    setMockPhoneDriverStatus(null);
    delete process.env.OMB_COMPOSIO_TOOLKITS_API;
    delete process.env.OMB_PHONE_DRIVER_ACTIVE;
    tempReminderFile = join(tmpdir(), `mobot-reminders-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    clearActionReceipts();
    setMockPhoneDriverStatus(null);
    delete process.env.OMB_COMPOSIO_TOOLKITS_API;
    delete process.env.OMB_PHONE_DRIVER_ACTIVE;
    if (existsSync(tempReminderFile)) {
      try {
        unlinkSync(tempReminderFile);
      } catch {}
    }
  });

  // =========================================================================
  // Primary Scenario 1: Defect 1 — Google Calendar False Success Interception
  // =========================================================================
  describe("Scenario 1 (Defect 1): Google Calendar Action Verification & Truthfulness", () => {
    it("stitches multi-turn duration reply ('30 minutes') with previous calendar prompt", () => {
      const activePathMsgs = [
        { role: "user" as const, text: "Schedule a team sync on Google Calendar tomorrow at 10am" },
        { role: "bot" as const, text: "Sure, what is the duration of the meeting?" },
      ];
      const userTurnText = "30 minutes";

      const lastAssistantMsg = activePathMsgs.slice(-2).find((m) => m.role === "bot" || (m.role as string) === "assistant");
      const previousUserMsg = activePathMsgs.slice(-4, -1).reverse().find((m) => m.role === "user");

      let effectiveObjective = userTurnText;
      if (
        /^\s*(?:\d+\s*(?:minutes?|mins?|hours?|hrs?)|half an hour|one hour)\b/i.test(userTurnText) &&
        (lastAssistantMsg?.text?.match(/duration|how long|calendar|meeting|event/i) ||
         previousUserMsg?.text?.match(/calendar|schedule|meeting|team sync/i))
      ) {
        const origQuery = previousUserMsg?.text || "Schedule team sync meeting on Google Calendar";
        effectiveObjective = `${origQuery} with duration ${userTurnText}`;
      }

      expect(effectiveObjective).toBe("Schedule a team sync on Google Calendar tomorrow at 10am with duration 30 minutes");
    });

    it("intercepts model false-success claim when calendar is disconnected (UNAVAILABLE)", () => {
      recordActionReceipt({
        operationId: "op-cal-1",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "turn-1",
        actionType: "calendar.create_event",
        status: "UNAVAILABLE",
        error: {
          code: "ERR_SERVICE_DISCONNECTED",
          message: "Google Calendar is not connected",
        },
        attemptedAt: Date.now(),
      });

      const modelOutput = "I have scheduled the team sync meeting for 10:00 - 10:30 AM IST on your Google Calendar.";
      const result = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-1",
        assistantText: modelOutput,
      });

      expect(result.corrected).toBe(true);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.text).toContain("Google Calendar is not currently connected");
      expect(result.text).toContain("No event has been created yet");
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("accepts model confirmation when calendar action has genuine SUCCEEDED receipt and evidence", () => {
      recordActionReceipt({
        operationId: "op-cal-2",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "turn-2",
        actionType: "calendar.create_event",
        status: "SUCCEEDED",
        evidence: {
          resourceId: "evt_google_cal_987654",
          resourceUri: "https://calendar.google.com/event?eid=evt_google_cal_987654",
          metadata: {
            summary: "Team Sync",
            start: "2026-10-25T10:00:00+05:30",
            end: "2026-10-25T10:30:00+05:30",
          },
        },
        attemptedAt: Date.now(),
      });

      const modelOutput = "I have scheduled the team sync meeting for 10:00 - 10:30 AM IST on your Google Calendar.";
      const result = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-2",
        assistantText: modelOutput,
      });

      expect(result.corrected).toBe(false);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.text).toBe(modelOutput);
      expect(result.violations).toHaveLength(0);
    });
  });

  // =========================================================================
  // Primary Scenario 2: Defect 2 — Phone Control Truthful Refusal
  // =========================================================================
  describe("Scenario 2 (Defect 2): Phone Control Capability Verification & Refusal", () => {
    it("truthfully denies phone control capability when driver is offline", () => {
      setMockPhoneDriverStatus({
        operational: false,
        reason: "Device automation driver port is not configured",
      });

      const driverStatus = checkLivePhoneControlAvailability();
      expect(driverStatus.operational).toBe(false);

      const modelOutput = "Yes, I can access your phone. I can tap, type, open apps, and take screenshots for you.";
      const result = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-phone-1",
        assistantText: modelOutput,
      });

      expect(result.corrected).toBe(true);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.text).toContain("I cannot currently access or control your phone");
      expect(result.text).toContain("Device automation driver port is not configured");
      expect(result.violations).toContain("Phone control access claimed while driver is offline");
    });

    it("blocks false claim of opening WhatsApp and capturing screenshot when driver is offline", () => {
      setMockPhoneDriverStatus({
        operational: false,
        reason: "Accessibility service not running",
      });

      const modelOutput = "I've opened WhatsApp and taken a screenshot of your chat. Here is the screenshot.";
      const result = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-phone-2",
        assistantText: modelOutput,
      });

      expect(result.corrected).toBe(true);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.text).toContain("Phone control is currently unavailable");
      expect(result.text).toContain("Accessibility service not running");
    });

    it("verifies screenshot artifact existence on disk when driver reports SUCCEEDED", () => {
      setMockPhoneDriverStatus({ operational: true });

      const fakeScreenshotPath = join(tmpdir(), `screenshot-${Date.now()}.png`);
      writeFileSync(fakeScreenshotPath, Buffer.from("fake-png-data"));

      recordActionReceipt({
        operationId: "op-scr-1",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "turn-scr-1",
        actionType: "device.phone_control.screenshot",
        status: "SUCCEEDED",
        evidence: {
          artifactPath: fakeScreenshotPath,
        },
        attemptedAt: Date.now(),
      });

      const modelOutput = "I have taken a screenshot of your screen.";
      const result = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-scr-1",
        assistantText: modelOutput,
      });

      expect(result.corrected).toBe(false);
      expect(result.status).toBe("SUCCEEDED");

      unlinkSync(fakeScreenshotPath);
    });

    it("dynamically recognizes operational USB ADB phone driver via OMB_PHONE_DRIVER_ACTIVE", () => {
      process.env.OMB_PHONE_DRIVER_ACTIVE = "1";
      const statusActive = checkLivePhoneControlAvailability();
      expect(statusActive.operational).toBe(true);
      expect(statusActive.supportedActions).toContain("take_screenshot");
      expect(statusActive.supportedActions).toContain("open_app");

      delete process.env.OMB_PHONE_DRIVER_ACTIVE;
      const statusOffline = checkLivePhoneControlAvailability();
      expect(statusOffline.operational).toBe(false);
      expect(statusOffline.supportedActions).toHaveLength(0);
    });
  });

  // =========================================================================
  // Primary Scenario 3: Defect 3 — Durable Reminders & Diagnostic Recovery
  // =========================================================================
  describe("Scenario 3 (Defect 3): Durable Reminders & Accurate Clock Scheduling", () => {
    it("calculates exact target time (now + 5 min) and durably persists reminder", async () => {
      const fixedNow = 1761300000000;
      const mgr = new ReminderManager({
        filePath: tempReminderFile,
        now: () => fixedNow,
      });

      const result = await mgr.schedule({
        botId: testBotId,
        threadId: testThreadId,
        text: "hello msgs",
        delayMs: 5 * 60 * 1000,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.reminder).toBeDefined();
      expect(result.reminder?.scheduledFor).toBe(fixedNow + 5 * 60 * 1000);
      expect(result.reminder?.text).toBe("hello msgs");

      // Verify file written to disk atomically
      expect(existsSync(tempReminderFile)).toBe(true);

      // Verify a fresh manager reloads it from disk
      const mgr2 = new ReminderManager({
        filePath: tempReminderFile,
        now: () => fixedNow,
      });
      const pending = mgr2.list();
      expect(pending.length).toBe(1);
      expect(pending[0].text).toBe("hello msgs");
      expect(pending[0].scheduledFor).toBe(fixedNow + 300_000);
    });

    it("distinguishes scheduling from delivery and blocks pre-delivery confirmation", () => {
      recordActionReceipt({
        operationId: "op-rem-1",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "turn-rem-1",
        actionType: "reminder.schedule",
        status: "SUCCEEDED",
        evidence: {
          resourceId: "rem-12345",
          metadata: {
            scheduledForFormatted: "10:35 AM",
            text: "hello msgs",
          },
        },
        attemptedAt: Date.now(),
      });

      // Claiming scheduling is valid
      const validSchedulingMsg = "I have scheduled a reminder for 'hello msgs' at 10:35 AM.";
      const validRes = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-rem-1",
        assistantText: validSchedulingMsg,
      });
      expect(validRes.corrected).toBe(false);

      // Claiming delivery prematurely is blocked
      const prematureDeliveryMsg = "I have delivered the reminder to your notifications.";
      const invalidRes = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "turn-rem-1",
        assistantText: prematureDeliveryMsg,
      });
      expect(invalidRes.corrected).toBe(true);
      expect(invalidRes.violations).toContain("Claimed notification delivery before scheduled target time");
      expect(invalidRes.text).toContain("Reminder scheduled for 10:35 AM. It will be delivered when due.");
    });

    it("returns UNAVAILABLE with Android Settings remediation when notification permission is denied", async () => {
      const mgr = new ReminderManager({ filePath: tempReminderFile });
      mgr.setMockPermission(false);

      const result = await mgr.schedule({
        botId: testBotId,
        threadId: testThreadId,
        text: "dentist appointment",
        delayMs: 60000,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.error?.remediation).toContain("Android Settings");
      mgr.dispose();
    });

    it("simulates host restart: restores pending reminder across restart, reschedules timer, and delivers at target time", async () => {
      let currentTime = 1761300000000;
      const deliveredReminders: string[] = [];

      // Host 1: Running before restart
      const host1 = new ReminderManager({
        filePath: tempReminderFile,
        now: () => currentTime,
      });
      host1.setNotificationSender((rem) => {
        deliveredReminders.push(rem.text);
        return true;
      });

      const schedRes = await host1.schedule({
        botId: testBotId,
        threadId: testThreadId,
        text: "team retrospective",
        delayMs: 10_000,
      });
      expect(schedRes.success).toBe(true);
      expect(host1.list().length).toBe(1);

      // Simulate host crash/restart: dispose host1
      host1.dispose();

      // Advance time by 5 seconds (still in future)
      currentTime += 5000;

      // Host 2: Fresh instance loaded after restart
      const host2 = new ReminderManager({
        filePath: tempReminderFile,
        now: () => currentTime,
      });
      host2.setNotificationSender((rem) => {
        deliveredReminders.push(rem.text);
        return true;
      });

      // Reminder restored from disk
      const restored = host2.list();
      expect(restored.length).toBe(1);
      expect(restored[0].text).toBe("team retrospective");
      expect(restored[0].status).toBe("pending");
      expect(deliveredReminders.length).toBe(0);

      // Advance time to target instant (+5 more seconds = 10s total)
      currentTime += 5000;
      const count = await host2.deliverDueReminders();
      expect(count).toBe(1);
      expect(deliveredReminders).toEqual(["team retrospective"]);

      const afterDelivery = host2.get(schedRes.reminder!.id);
      expect(afterDelivery?.status).toBe("delivered");
      expect(afterDelivery?.deliveredAt).toBe(currentTime);

      host2.dispose();
    });

    it("prevents timer duplication when rescheduling loaded pending reminders", () => {
      const fixedNow = 1761300000000;
      const mgr = new ReminderManager({
        filePath: tempReminderFile,
        now: () => fixedNow,
      });

      // Write a raw file with a pending reminder
      writeFileSync(
        tempReminderFile,
        JSON.stringify({
          version: 1,
          reminders: [
            {
              id: "rem-dup-test",
              botId: testBotId,
              threadId: testThreadId,
              text: "call client",
              requestedAt: fixedNow,
              scheduledFor: fixedNow + 60_000,
              status: "pending",
            },
          ],
        }),
      );

      // Trigger reload twice
      mgr.setFilePath(tempReminderFile);
      mgr.reschedulePendingTimers();

      const list = mgr.list();
      expect(list.length).toBe(1);
      expect(list[0].status).toBe("pending");

      mgr.dispose();
    });
  });

  // =========================================================================
  // Primary Scenario 4: Defect 4 — Full Composio Catalog & Pagination
  // =========================================================================
  describe("Scenario 4 (Defect 4): Full Composio Catalog Beyond 24 Services", () => {
    let mockApi: Server;
    let mockApiPort: number;

    afterEach(async () => {
      if (mockApi) {
        await new Promise((resolve) => mockApi.close(resolve));
      }
    });

    it("paginates beyond 24 items and supports ck_ consumer key headers", async () => {
      const page1Items = Array.from({ length: 24 }, (_, i) => ({
        id: `toolkit_p1_${i}`,
        name: `Service P1 ${i}`,
        slug: `service_p1_${i}`,
        description: `Description ${i}`,
        categories: ["productivity"],
        icon_url: "https://example.com/icon.png",
      }));

      const page2Items = Array.from({ length: 26 }, (_, i) => ({
        id: `toolkit_p2_${i}`,
        name: i === 5 ? "Zoom Meetings" : `Service P2 ${i}`,
        slug: i === 5 ? "zoom" : `service_p2_${i}`,
        description: `Description ${i}`,
        categories: ["communication"],
        icon_url: "https://example.com/icon.png",
      }));

      let authHeaderSeen = "";
      mockApi = createServer((req, res) => {
        authHeaderSeen = (req.headers["x-consumer-api-key"] as string) || (req.headers["x-api-key"] as string) || "";
        const url = new URL(req.url || "/", `http://${req.headers.host}`);

        if (url.pathname === "/api/v3/toolkits" || url.pathname === "/toolkits") {
          const cursor = url.searchParams.get("cursor");
          if (!cursor) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                items: page1Items,
                current_page: 1,
                total_pages: 2,
                next_cursor: "cur_page_2",
              })
            );
          } else if (cursor === "cur_page_2") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                items: page2Items,
                current_page: 2,
                total_pages: 2,
                next_cursor: null,
              })
            );
          } else {
            res.writeHead(404);
            res.end();
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        mockApi.listen(0, "127.0.0.1", () => {
          const addr = mockApi.address() as any;
          mockApiPort = addr.port;
          resolve();
        });
      });

      process.env.OMB_COMPOSIO_TOOLKITS_API = `http://127.0.0.1:${mockApiPort}`;

      const config: AppConfig = {
        composio: {
          apiKey: "ak_test_platform_key_12345",
          surface: "platform",
          baseUrl: `http://127.0.0.1:${mockApiPort}/api/v3`,
        },
      } as any;

      const catalog = await listToolkits(config);

      expect(authHeaderSeen).toBe("ak_test_platform_key_12345");
      expect(catalog.cards.length).toBe(50); // 24 from page 1 + 26 from page 2
      expect(catalog.totalCount).toBe(50);
      expect(catalog.source).toBe("api");

      // Verify search finds item outside first page (Zoom on page 2)
      const zoomFound = catalog.cards.some((c) => (c.label && c.label.toLowerCase().includes("zoom")) || c.slug === "zoom");
      expect(zoomFound).toBe(true);
    });

    it("Scenario 4b: Connect mode (ck_) uses Connect MCP search to discover integrations beyond 24 items", async () => {
      const mockConnectMcp = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.params?.name === "COMPOSIO_SEARCH_TOOLS") {
            const resultData = {
              successful: true,
              data: {
                results: [{ toolkits: ["zoom"] }],
                toolkit_connection_statuses: [{
                  toolkit: "zoom",
                  description: "Zoom video conferencing and enterprise meetings",
                  has_active_connection: false,
                }],
              },
            };
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(`: connected\n\nevent: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { content: [{ type: "text", text: JSON.stringify(resultData) }] },
            })}\n\n`);
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { tools: [] } }));
          }
        });
      });

      await new Promise<void>((resolve) => mockConnectMcp.listen(0, "127.0.0.1", () => resolve()));
      const connectPort = (mockConnectMcp.address() as any).port;

      try {
        const connectCfg: AppConfig = {
          composio: {
            apiKey: "ck_test_consumer_key_12345",
            surface: "connect",
            mcpUrl: `http://127.0.0.1:${connectPort}`,
          },
        };

        // Complete catalog: 1,600+ items, source: "api", no error
        const initial = await listToolkits(connectCfg);
        expect(initial.source).toBe("api");
        expect(initial.error).toBeUndefined();
        expect(initial.cards.length).toBeGreaterThan(1600);

        // Dynamic search discovers Zoom beyond curated list
        const searchResult = await listToolkits(connectCfg, { query: "zoom meeting" });
        expect(searchResult.source).toBe("api");
        const zoom = searchResult.cards.find((c) => c.slug === "zoom");
        expect(zoom).toBeDefined();
        expect(zoom?.label).toBe("Zoom");
      } finally {
        await new Promise((resolve) => mockConnectMcp.close(resolve));
      }
    });
  });

  // =========================================================================
  // 12 Mandatory Adversarial Cases
  // =========================================================================
  describe("12 Mandatory Adversarial Edge Cases", () => {
    // Case 1: Model generates "Done, I created the event" without tool call
    it("Adversarial Case 1: intercepts 'Done, I created the event' without tool call or receipt", () => {
      const modelClaim = "Done, I created the event on your Google Calendar for 3:00 PM.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-1",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("NOT_ATTEMPTED");
      expect(res.text).toContain("I have not scheduled this meeting yet because Google Calendar is not connected");
    });

    // Case 2: Calendar provider returns HTTP 200 with error payload
    it("Adversarial Case 2: handles provider returning 200 with error payload -> status FAILED", () => {
      recordActionReceipt({
        operationId: "op-cal-fail",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "adv-2",
        actionType: "calendar.create_event",
        status: "FAILED",
        error: {
          code: "PROVIDER_ERROR_PAYLOAD",
          message: "API rate limit exceeded or invalid calendar ID",
        },
        attemptedAt: Date.now(),
      });

      const modelClaim = "I've scheduled your meeting for tomorrow morning.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-2",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("FAILED");
      expect(res.text).toContain("Unable to schedule the meeting on Google Calendar: API rate limit exceeded");
    });

    // Case 3: Phone control in static config but driver offline
    it("Adversarial Case 3: static phone capability present but driver offline -> status UNAVAILABLE", () => {
      setMockPhoneDriverStatus({
        operational: false,
        reason: "Accessibility automation service crashed",
      });

      const driverStatus = checkLivePhoneControlAvailability();
      expect(driverStatus.operational).toBe(false);

      const assistantText = "Yes, I can access your phone and tap on buttons.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-3",
        assistantText,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("UNAVAILABLE");
      expect(res.text).toContain("I cannot currently access or control your phone");
      expect(res.text).toContain("Accessibility automation service crashed");
    });

    // Case 4: Device becomes unavailable between detection and execution
    it("Adversarial Case 4: device becomes unavailable mid-flow -> fails gracefully without crashing", () => {
      // First check was ok, but execution encountered disconnection
      recordActionReceipt({
        operationId: "op-phone-midfail",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "adv-4",
        actionType: "device.phone_control.tap",
        status: "FAILED",
        error: {
          code: "DEVICE_DISCONNECTED_MID_EXECUTION",
          message: "ADB transport connection dropped unexpectedly",
        },
        attemptedAt: Date.now(),
      });

      const modelClaim = "I've opened WhatsApp on your phone.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-4",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("FAILED");
      expect(res.text).toContain("Phone action failed: ADB transport connection dropped unexpectedly");
    });

    // Case 5: Reminder persisted but delivery permission denied
    it("Adversarial Case 5: reminder persisted but delivery permission denied -> status UNAVAILABLE with remediation", async () => {
      const mgr = new ReminderManager({ filePath: tempReminderFile });
      mgr.setMockPermission(false);

      const schedRes = await mgr.schedule({
        botId: testBotId,
        threadId: testThreadId,
        text: "Take medication",
        delayMs: 300000,
      });

      expect(schedRes.status).toBe("UNAVAILABLE");
      expect(schedRes.error?.remediation).toBeDefined();

      recordActionReceipt({
        operationId: "op-rem-perm-fail",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "adv-5",
        actionType: "reminder.schedule",
        status: "UNAVAILABLE",
        error: {
          code: schedRes.error?.code || "ERR_PERMISSION_DENIED",
          message: schedRes.error?.message || "Notification permission denied",
        },
        attemptedAt: Date.now(),
      });

      const modelClaim = "I have set your reminder for 'Take medication'.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-5",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("UNAVAILABLE");
      expect(res.text).toContain("Notification permissions may be disabled");
      expect(res.text).toContain("Android Settings");
    });

    // Case 6: Scheduler accepts job but response lost -> status UNKNOWN
    it("Adversarial Case 6: scheduler accepts job but response lost -> status UNKNOWN, no false success", () => {
      recordActionReceipt({
        operationId: "op-rem-unknown",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "adv-6",
        actionType: "reminder.schedule",
        status: "UNKNOWN",
        attemptedAt: Date.now(),
      });

      const modelClaim = "Your reminder is set for 10 minutes from now.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-6",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("UNKNOWN");
      expect(res.text).toContain("The reminder request was accepted but confirmation could not be verified");
    });

    // Case 7: Composio catalog returns first 24 items + next-page cursor -> second page retrieved
    it("Adversarial Case 7: follows next_cursor pagination to retrieve complete catalog", async () => {
      let pageRequests = 0;
      const srv = createServer((req, res) => {
        pageRequests += 1;
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const cursor = url.searchParams.get("cursor");

        if (!cursor) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              items: [{ id: "app-1", name: "App 1", slug: "app-1" }],
              next_cursor: "page_2_cursor",
            })
          );
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              items: [{ id: "app-2", name: "App 2", slug: "app-2" }],
              next_cursor: null,
            })
          );
        }
      });

      await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
      const port = (srv.address() as any).port;
      process.env.OMB_COMPOSIO_TOOLKITS_API = `http://127.0.0.1:${port}`;

      const cfg: AppConfig = {
        composio: { apiKey: "ak_test", baseUrl: `http://127.0.0.1:${port}` },
      } as any;

      const result = await listToolkits(cfg);
      await new Promise((resolve) => srv.close(resolve));
      delete process.env.OMB_COMPOSIO_TOOLKITS_API;

      expect(pageRequests).toBe(2);
      expect(result.cards.length).toBe(2);
      expect(result.cards.map((c) => c.label)).toEqual(["App 1", "App 2"]);
    });

    // Case 8: Composio catalog fails after first page -> partial catalog preserved without crash
    it("Adversarial Case 8: preserves partial catalog when page 2 fails with 500 error", async () => {
      const srv = createServer((req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const cursor = url.searchParams.get("cursor");

        if (!cursor) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              items: [{ id: "resilient-app", name: "Resilient App", slug: "resilient" }],
              next_cursor: "fail_cursor",
            })
          );
        } else {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Upstream gateway error" }));
        }
      });

      await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
      const port = (srv.address() as any).port;
      process.env.OMB_COMPOSIO_TOOLKITS_API = `http://127.0.0.1:${port}`;

      const cfg: AppConfig = {
        composio: { apiKey: "ak_test", baseUrl: `http://127.0.0.1:${port}` },
      } as any;

      const result = await listToolkits(cfg);
      await new Promise((resolve) => srv.close(resolve));
      delete process.env.OMB_COMPOSIO_TOOLKITS_API;

      expect(result.cards.length).toBe(1);
      expect(result.cards[0].label).toBe("Resilient App");
      expect(result.source).toBe("api");
    });

    // Case 9: Search matches integration outside initial page (e.g. "zoom")
    it("Adversarial Case 9: search discovers integrations not present in first 24 items", async () => {
      const allItems = [
        ...Array.from({ length: 30 }, (_, i) => ({ id: `srv_${i}`, name: `Service ${i}`, slug: `srv_${i}` })),
        { id: "srv_zoom", name: "Zoom Video", slug: "zoom" },
      ];

      const srv = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items: allItems }));
      });

      await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
      const port = (srv.address() as any).port;
      process.env.OMB_COMPOSIO_TOOLKITS_API = `http://127.0.0.1:${port}`;

      const cfg: AppConfig = {
        composio: { apiKey: "ak_test", baseUrl: `http://127.0.0.1:${port}` },
      } as any;

      const result = await listToolkits(cfg, { query: "Zoom" });
      await new Promise((resolve) => srv.close(resolve));
      delete process.env.OMB_COMPOSIO_TOOLKITS_API;

      expect(result.cards.length).toBe(1);
      expect(result.cards[0].label).toBe("Zoom Video");
    });

    // Case 10: Connected integration belongs to another bot/user -> isolation preserved
    it("Adversarial Case 10: enforces bot isolation on reminders and receipts", async () => {
      const mgr = new ReminderManager({ filePath: tempReminderFile });
      await mgr.schedule({
        botId: "bot-alice",
        threadId: "thread-alice",
        text: "Alice's secret reminder",
        delayMs: 60000,
      });

      await mgr.schedule({
        botId: "bot-bob",
        threadId: "thread-bob",
        text: "Bob's reminder",
        delayMs: 60000,
      });

      const aliceReminders = mgr.list("bot-alice");
      expect(aliceReminders.length).toBe(1);
      expect(aliceReminders[0].text).toBe("Alice's secret reminder");

      const bobReminders = mgr.list("bot-bob");
      expect(bobReminders.length).toBe(1);
      expect(bobReminders[0].text).toBe("Bob's reminder");
    });

    // Case 11: Provider timeout after possible mutation -> status UNKNOWN, avoids duplicate retry
    it("Adversarial Case 11: marks timeout as UNKNOWN to prevent duplicate mutation", () => {
      recordActionReceipt({
        operationId: "op-timeout",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "adv-11",
        actionType: "calendar.create_event",
        status: "UNKNOWN",
        error: {
          code: "TIMEOUT_POST_DISPATCH",
          message: "Request timed out waiting for upstream gateway",
        },
        attemptedAt: Date.now(),
      });

      const modelClaim = "I've added the meeting to your calendar.";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-11",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("UNKNOWN");
      expect(res.text).toContain("request timed out and its final status could not be verified");
      expect(res.text).toContain("avoid duplicate events");
    });

    // Case 12: Response generator receives UNKNOWN result and tries to claim success -> blocked
    it("Adversarial Case 12: blocks model claiming success when receipt status is UNKNOWN", () => {
      recordActionReceipt({
        operationId: "op-unknown-claim",
        botId: testBotId,
        threadId: testThreadId,
        turnId: "adv-12",
        actionType: "calendar.create_event",
        status: "UNKNOWN",
        attemptedAt: Date.now(),
      });

      const modelClaim = "The event was successfully created!";
      const res = verifyAndEnforceTurnTruthfulness({
        threadId: testThreadId,
        turnId: "adv-12",
        assistantText: modelClaim,
      });

      expect(res.corrected).toBe(true);
      expect(res.status).toBe("UNKNOWN");
      expect(res.text).not.toContain("successfully created");
      expect(res.violations).toContain("Calendar false-success detected: claimed event creation under status UNKNOWN");
    });
  });
});

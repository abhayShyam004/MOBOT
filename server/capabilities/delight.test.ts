import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SmartRecapService,
  DailyBriefingService,
  CompletionCardGenerator,
} from "./delight-services.ts";
import { sharedObservability } from "./observability.ts";
import { DeviceCapabilityRegistry } from "./capability-registry.ts";

describe("Phase V: Delight Features & Contextual Surfaces", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "delight-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("SmartRecapService", () => {
    it("aggregates completed tasks, pending questions, artifacts, and errors into a clean recap", () => {
      const now = Date.now();
      const mockStore: any = {
        bots: [
          { id: "bot-1", name: "Vega" },
          { id: "bot-2", name: "Olive" },
        ],
        tasks: vi.fn((botId: string) => {
          if (botId === "bot-1") {
            return [
              {
                threadId: "thread-1",
                title: "Build landing page",
                closedBy: { at: now - 3600000, reason: "done" },
              },
            ];
          }
          return [
            {
              threadId: "thread-2",
              title: "Analyze spreadsheet",
            },
          ];
        }),
        messagesFor: vi.fn((threadId: string) => {
          if (threadId === "thread-1") {
            return [
              {
                id: "m-1",
                role: "bot",
                at: now - 3000000,
                turnTerminal: true,
                text: "### Milestone Reached\nCreated landing page assets.",
              },
              {
                id: "m-2",
                role: "bot",
                at: now - 2000000,
                kind: "structured",
                structured: {
                  components: [
                    { id: "c-1", type: "artifact", title: "Landing Page Report" },
                  ],
                },
              },
            ];
          }
          if (threadId === "thread-2") {
            return [
              {
                id: "m-3",
                role: "bot",
                at: now - 1800000,
                kind: "options",
                card: { title: "Choose export format", subtitle: "format", options: ["csv", "json"] },
              },
              {
                id: "m-4",
                role: "bot",
                at: now - 1200000,
                failure: {
                  kind: "invalid_request",
                  title: "Calculation Overflow",
                  detail: "Value exceeded 64-bit integer limit",
                  advice: "Try smaller numbers",
                  provider: "local",
                  model: "gpt-4",
                },
              },
            ];
          }
          return [];
        }),
      };

      const recapService = new SmartRecapService(mockStore);
      const recap = recapService.generateRecap({ since: now - 7200000 });

      expect(recap.totalChanges).toBeGreaterThan(0);
      expect(recap.sections.some((s) => s.category === "completed_tasks")).toBe(true);
      expect(recap.sections.some((s) => s.category === "created_artifacts")).toBe(true);
      expect(recap.sections.some((s) => s.category === "pending_questions")).toBe(true);
      expect(recap.sections.some((s) => s.category === "meaningful_errors")).toBe(true);
      expect(recap.sections.some((s) => s.category === "important_messages")).toBe(true);

      expect(recap.formattedMarkdown).toContain("What changed while you were away");
      expect(recap.formattedMarkdown).toContain("Vega");
      expect(recap.formattedMarkdown).toContain("Olive");

      // Verify observability event
      const recentEvents = sharedObservability.getEvents({ limit: 10 });
      expect(recentEvents.some((e) => e.type === "SMART_RECAP_CREATED")).toBe(true);
    });

    it("filters recap by specific botId when requested", () => {
      const now = Date.now();
      const mockStore: any = {
        bots: [
          { id: "bot-1", name: "Vega" },
          { id: "bot-2", name: "Olive" },
        ],
        tasks: vi.fn((botId: string) => [
          {
            threadId: `thread-${botId}`,
            title: `Task for ${botId}`,
            closedBy: { at: now - 1000, reason: "done" },
          },
        ]),
        messagesFor: vi.fn(() => []),
      };

      const recapService = new SmartRecapService(mockStore);
      const recap = recapService.generateRecap({ since: now - 5000, botId: "bot-1" });

      expect(mockStore.tasks).toHaveBeenCalledWith("bot-1");
      expect(mockStore.tasks).not.toHaveBeenCalledWith("bot-2");
      expect(recap.totalChanges).toBe(1);
    });
  });

  describe("DailyBriefingService", () => {
    it("loads and persists configuration changes", () => {
      const configPath = join(tempDir, "briefing-config.json");
      const mockStore: any = { bots: [] };
      const registry = new DeviceCapabilityRegistry();

      const service = new DailyBriefingService(mockStore, registry, undefined, configPath);
      const initial = service.getConfig();
      expect(initial.calendarEnabled).toBe(true);
      expect(initial.weatherEnabled).toBe(false);

      service.updateConfig({ weatherEnabled: true });
      expect(service.getConfig().weatherEnabled).toBe(true);
      expect(existsSync(configPath)).toBe(true);

      // Verify reloaded instance gets updated value
      const reloaded = new DailyBriefingService(mockStore, registry, undefined, configPath);
      expect(reloaded.getConfig().weatherEnabled).toBe(true);
    });

    it("generates a calm briefing aggregating calendar, routines, and tasks", async () => {
      const configPath = join(tempDir, "briefing-config.json");
      const registry = new DeviceCapabilityRegistry();

      // Create calendar event via real DeviceCapabilityRegistry calendar capability
      await registry.invoke("device.calendar", "create_event", {
        title: "Sprint Planning",
        location: "Room A",
        startTime: Date.now() + 1800000,
        endTime: Date.now() + 5400000,
      });

      const mockStore: any = {
        bots: [
          { id: "bot-1", name: "Hazel" },
        ],
        bot: vi.fn((_id: string) => ({ id: "bot-1", name: "Hazel" })),
        tasks: vi.fn(() => [
          {
            threadId: "t-1",
            title: "Prepare Release Notes",
            unread: true,
          },
        ]),
        messagesFor: vi.fn(() => [
          {
            id: "m-1",
            role: "bot",
            at: Date.now() - 3600000,
            turnTerminal: true,
            text: "Completed initial migration draft.",
          },
        ]),
      };

      const mockRoutines: any = {
        listRoutines: vi.fn(() => [
          {
            id: "r-1",
            name: "Morning Sync",
            enabled: true,
            botId: "bot-1",
            schedule: { type: "daily", time: "09:30" },
          },
        ]),
      };

      const service = new DailyBriefingService(mockStore, registry, mockRoutines, configPath);
      const briefing = await service.generateBriefing(new Date());

      expect(briefing.greeting).toMatch(/Good morning|Good afternoon|Good evening/);
      expect(briefing.sections.some((s) => s.id === "calendar")).toBe(true);
      expect(briefing.sections.find((s) => s.id === "calendar")?.items.length).toBe(1);
      expect(briefing.sections.find((s) => s.id === "calendar")?.items[0].title).toBe("Sprint Planning");

      expect(briefing.sections.some((s) => s.id === "routines")).toBe(true);
      expect(briefing.sections.find((s) => s.id === "routines")?.items[0].title).toBe("Morning Sync");

      expect(briefing.sections.some((s) => s.id === "tasks")).toBe(true);
      expect(briefing.sections.find((s) => s.id === "tasks")?.items[0].title).toBe("Prepare Release Notes");

      expect(briefing.sections.some((s) => s.id === "agent_results")).toBe(true);
      expect(briefing.formattedMarkdown).toContain("Sprint Planning");
      expect(briefing.formattedMarkdown).toContain("Morning Sync");

      // Verify observability event
      const recentEvents = sharedObservability.getEvents({ limit: 10 });
      expect(recentEvents.some((e) => e.type === "DAILY_BRIEFING_CREATED")).toBe(true);
    });

    it("handles weather capability when enabled but unconfigured gracefully", async () => {
      const configPath = join(tempDir, "briefing-config.json");
      const registry = new DeviceCapabilityRegistry(); // no weather capability registered
      const mockStore: any = { bots: [], tasks: vi.fn(() => []), messagesFor: vi.fn(() => []) };

      const service = new DailyBriefingService(mockStore, registry, undefined, configPath);
      service.updateConfig({ weatherEnabled: true });

      const briefing = await service.generateBriefing();
      const weatherSec = briefing.sections.find((s) => s.id === "weather");
      expect(weatherSec).toBeDefined();
      expect(weatherSec?.items[0].title).toBe("Weather capability not configured");
    });
  });

  describe("CompletionCardGenerator", () => {
    it("generates rich completion moment cards with quantified outcomes and action controls", () => {
      const generator = new CompletionCardGenerator();
      const result = generator.createCompletionCard({
        taskTitle: "Build E-Commerce Web App",
        status: "completed",
        durationSeconds: 14.8,
        outcomes: [
          { label: "Files created", count: 8 },
          { label: "Unit tests passing", count: 12 },
          { label: "Live preview deployed", detail: "http://127.0.0.1:3000" },
        ],
        artifactId: "proj-ecommerce",
        previewUrl: "http://127.0.0.1:3000",
      });

      expect(result.card.type).toBe("completion");
      expect(result.card.data.taskTitle).toBe("Build E-Commerce Web App");
      expect(result.card.data.status).toBe("completed");
      expect(result.card.data.durationSeconds).toBe(14.8);
      expect(result.card.data.outcomes.length).toBe(3);

      // Verify action buttons [Open result], [Preview], [Share]
      expect(result.card.actions).toEqual([
        { id: "open_result", label: "Open result", style: "primary" },
        { id: "preview", label: "Preview", style: "secondary" },
        { id: "share", label: "Share", style: "secondary" },
      ]);

      // Verify shareText
      expect(result.shareText).toContain("Task Complete: Build E-Commerce Web App");
      expect(result.shareText).toContain("Files created");
      expect(result.shareText).toContain("14.8s");

      // Verify observability event
      const recentEvents = sharedObservability.getEvents({ limit: 10 });
      expect(recentEvents.some((e) => e.type === "COMPLETION_CARD_CREATED")).toBe(true);
    });
  });
});

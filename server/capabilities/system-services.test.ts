import { describe, it, expect, beforeEach } from "vitest";
import {
  UniversalSearchService,
  QuickCaptureService,
  SmartLinkService,
  SystemServicesBridge,
} from "./system-services.ts";
import { sharedObservability } from "./observability.ts";
import { DeviceCapabilityRegistry } from "./capability-registry.ts";

describe("Phase VI — System Services & Integrations", () => {
  let mockStore: any;
  let mockRoutines: any;
  let registry: DeviceCapabilityRegistry;

  beforeEach(() => {
    mockStore = {
      bots: [
        {
          id: "bot-rio",
          name: "Rio",
          title: "GitHub Assistant",
          description: "Specialized in repository actions",
          soul: "Helpful developer assistant",
          createdAt: 1791200000000,
          color: "teal",
        },
        {
          id: "bot-panko",
          name: "Panko",
          title: "Web Builder",
          description: "Creates web apps and HTML pages",
          createdAt: 1791100000000,
          color: "yellow",
        },
      ],
      tasks: (botId: string) => [
        {
          threadId: `thread-${botId}`,
          title: "Task 1",
          cwd: "/tmp/test",
        },
      ],
      messagesFor: (threadId: string) => [
        {
          id: "msg-1",
          threadId,
          role: "user",
          at: 1791200010000,
          text: "Can you help me build a fullstack website with sqlite?",
        },
        {
          id: "msg-2",
          threadId,
          role: "bot",
          at: 1791200020000,
          text: "Sure! I can set up Next.js and SQLite for you right now.",
        },
      ],
    };

    mockRoutines = {
      list: () => [
        {
          id: "routine-1",
          name: "Morning Fleet Audit",
          prompt: "Audit all active bots and review git status",
          schedule: { type: "cron", cron: "0 9 * * *" },
          enabled: true,
          botId: "bot-rio",
          targetBotId: "bot-rio",
          lastRunAt: 1791190000000,
        },
      ],
      listRoutines: () => [
        {
          id: "routine-1",
          name: "Morning Fleet Audit",
          prompt: "Audit all active bots and review git status",
          schedule: { type: "cron", cron: "0 9 * * *" },
          enabled: true,
          botId: "bot-rio",
          targetBotId: "bot-rio",
          lastRunAt: 1791190000000,
        },
      ],
    };

    registry = new DeviceCapabilityRegistry();
  });

  describe("UniversalSearchService", () => {
    it("returns empty results for empty or whitespace query", () => {
      const searchService = new UniversalSearchService(mockStore, mockRoutines);
      const res = searchService.search("   ");
      expect(res.totalMatches).toBe(0);
      expect(res.results).toEqual([]);
    });

    it("searches and finds bots matching query", () => {
      const searchService = new UniversalSearchService(mockStore, mockRoutines);
      const res = searchService.search("Rio");
      expect(res.totalMatches).toBeGreaterThanOrEqual(1);
      const rioHit = res.results.find((r) => r.category === "bots" && r.title === "Rio");
      expect(rioHit).toBeDefined();
      expect(rioHit?.targetRoute).toBe("/chat/bot-rio");
      expect(rioHit?.badge).toBe("teal");
    });

    it("searches and finds routines matching prompt or name", () => {
      const searchService = new UniversalSearchService(mockStore, mockRoutines);
      const res = searchService.search("Fleet Audit");
      expect(res.totalMatches).toBeGreaterThanOrEqual(1);
      const hit = res.results.find((r) => r.category === "routines");
      expect(hit).toBeDefined();
      expect(hit?.title).toBe("Morning Fleet Audit");
      expect(hit?.badge).toBe("Active");
    });

    it("respects category filter", () => {
      const searchService = new UniversalSearchService(mockStore, mockRoutines);
      const resBotsOnly = searchService.search("Rio", { category: "bots" });
      expect(resBotsOnly.results.every((r) => r.category === "bots")).toBe(true);
    });

    it("emits UNIVERSAL_SEARCH_PERFORMED observability event", () => {
      let eventFired = false;
      const unsubscribe = sharedObservability.subscribe((evt) => {
        if (evt.type === "UNIVERSAL_SEARCH_PERFORMED") {
          eventFired = true;
          expect(evt.payload.query).toBe("Panko");
        }
      });

      const searchService = new UniversalSearchService(mockStore, mockRoutines);
      searchService.search("Panko");
      unsubscribe();
      expect(eventFired).toBe(true);
    });
  });

  describe("QuickCaptureService", () => {
    it("processes text capture and generates suggested actions", () => {
      const captureService = new QuickCaptureService(mockStore);
      const packet = captureService.processCapture({
        type: "text",
        content: "Meeting notes: remember to deploy the API to Render tomorrow at 10 AM.",
        userPrompt: "Extract tasks",
      });

      expect(packet.captureId).toMatch(/^cap_\d+_/);
      expect(packet.type).toBe("text");
      expect(packet.summary).toContain("Meeting notes");
      expect(packet.suggestedActions).toContain("Extract action items");
      expect(packet.recommendedBotId).toBeDefined();
    });

    it("processes link capture and targets preferred bot", () => {
      const captureService = new QuickCaptureService(mockStore);
      const packet = captureService.processCapture({
        type: "link",
        content: "https://news.ycombinator.com",
        targetBotId: "bot-rio",
      });

      expect(packet.type).toBe("link");
      expect(packet.summary).toContain("https://news.ycombinator.com");
      expect(packet.recommendedBotId).toBe("bot-rio");
      expect(packet.suggestedActions).toContain("Summarize webpage");
    });

    it("processes screenshot capture with appropriate actions", () => {
      const captureService = new QuickCaptureService(mockStore);
      const packet = captureService.processCapture({
        type: "screenshot",
        fileUri: "/tmp/screen.png",
      });

      expect(packet.type).toBe("screenshot");
      expect(packet.suggestedActions).toContain("Analyze UI/UX layout");
      expect(packet.suggestedActions).toContain("Extract visible text (OCR)");
    });

    it("emits QUICK_CAPTURE_TRIGGERED observability event", () => {
      let eventFired = false;
      const unsubscribe = sharedObservability.subscribe((evt) => {
        if (evt.type === "QUICK_CAPTURE_TRIGGERED") {
          eventFired = true;
          expect(evt.payload.type).toBe("file");
        }
      });

      const captureService = new QuickCaptureService(mockStore);
      captureService.processCapture({
        type: "file",
        fileName: "report.pdf",
      });
      unsubscribe();
      expect(eventFired).toBe(true);
    });
  });

  describe("SmartLinkService & SSRF Security", () => {
    it("strictly blocks private IPv4 subnets and localhost", () => {
      const linkService = new SmartLinkService();

      expect(linkService.isSafeUrl("http://localhost:3000").safe).toBe(false);
      expect(linkService.isSafeUrl("http://127.0.0.1:8080").safe).toBe(false);
      expect(linkService.isSafeUrl("http://10.0.0.5").safe).toBe(false);
      expect(linkService.isSafeUrl("http://192.168.1.1").safe).toBe(false);
      expect(linkService.isSafeUrl("http://172.20.0.1").safe).toBe(false);
      expect(linkService.isSafeUrl("http://169.254.169.254/metadata").safe).toBe(false);
      expect(linkService.isSafeUrl("file:///etc/passwd").safe).toBe(false);
      expect(linkService.isSafeUrl("ftp://ftp.example.com").safe).toBe(false);
    });

    it("approves legitimate public URLs", () => {
      const linkService = new SmartLinkService();
      expect(linkService.isSafeUrl("https://github.com").safe).toBe(true);
      expect(linkService.isSafeUrl("https://en.wikipedia.org/wiki/Android").safe).toBe(true);
    });

    it("returns blocked analysis packet for unsafe URLs without making HTTP requests", async () => {
      const linkService = new SmartLinkService();
      const analysis = await linkService.analyzeUrl("http://169.254.169.254/latest/meta-data");

      expect(analysis.isSafe).toBe(false);
      expect(analysis.contentType).toBe("blocked");
      expect(analysis.securityNotice).toBeDefined();
      expect(analysis.suggestedActions).toEqual([]);
    });

    it("emits SMART_LINK_ANALYZED observability event", async () => {
      let eventFired = false;
      const unsubscribe = sharedObservability.subscribe((evt) => {
        if (evt.type === "SMART_LINK_ANALYZED") {
          eventFired = true;
          expect(evt.payload.domain).toBe("example.com");
        }
      });

      const linkService = new SmartLinkService();
      await linkService.analyzeUrl("https://example.com");
      unsubscribe();
      expect(eventFired).toBe(true);
    });
  });

  describe("SystemServicesBridge", () => {
    it("executes calendar query when capability is present", async () => {
      const bridge = new SystemServicesBridge(registry);
      const overview = await bridge.getCalendarOverview();
      expect(overview.configured).toBe(true);
      expect(Array.isArray(overview.events)).toBe(true);
    });

    it("reports unconfigured calendar gracefully when capability is missing", async () => {
      const emptyRegistry = new DeviceCapabilityRegistry();
      emptyRegistry.unregister("device.calendar");
      const bridge = new SystemServicesBridge(emptyRegistry);
      const overview = await bridge.getCalendarOverview();
      expect(overview.configured).toBe(false);
      expect(overview.events).toEqual([]);
      expect(overview.message).toContain("not configured");
    });

    it("executes contacts search when capability is present", async () => {
      const bridge = new SystemServicesBridge(registry);
      const result = await bridge.searchContacts("Alice");
      expect(result.configured).toBe(true);
      expect(Array.isArray(result.contacts)).toBe(true);
    });

    it("reports unconfigured contacts gracefully when capability is missing", async () => {
      const emptyRegistry = new DeviceCapabilityRegistry();
      emptyRegistry.unregister("device.contacts");
      const bridge = new SystemServicesBridge(emptyRegistry);
      const result = await bridge.searchContacts("Alice");
      expect(result.configured).toBe(false);
      expect(result.contacts).toEqual([]);
      expect(result.message).toContain("not configured");
    });
  });
});

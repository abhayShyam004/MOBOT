import { describe, it, expect } from "vitest";
import { buildBotOverview, type OverviewFacts } from "./bot-overview.ts";

describe("buildBotOverview Command Center extensions", () => {
  const baseFacts: OverviewFacts = {
    bot: {
      name: "Taffy",
      title: "Assistant",
      description: "Personal AI",
      soul: "Helpful companion",
      computer: "local",
      cloudBackend: undefined,
      cwd: "/workspace",
      autoApprove: false,
      approvalMode: "ask",
      approvePeerComms: false,
      peers: [],
      composio: true,
      browser: true,
      chiefOfStaff: false,
      managedSections: [],
    },
    routines: [
      {
        id: "r-1",
        name: "Morning Briefing",
        enabled: true,
        schedule: { type: "interval", everyMinutes: 1440, anchorAt: Date.now() },
        nextRunAt: Date.now() + 3600000,
        prompt: "Summarize today's headlines",
      },
      {
        id: "r-2",
        name: "Old task",
        enabled: false,
        schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() },
        nextRunAt: null,
      },
    ],
    runs: [
      {
        routineId: "r-1",
        status: "completed",
        finishedAt: Date.now() - 3600000,
        scheduledFor: Date.now() - 3600000,
      },
    ],
    webhooks: [],
    skills: [],
    engine: {
      agentsMcp: true,
      composioMcp: true,
      browserMcp: true,
      computerMcp: true,
    },
    browserEnabled: true,
    connectedApps: {
      configured: true,
      authoritative: true,
      services: ["gmail", "github"],
    },
    sectionPeers: 0,
    timeZone: "UTC",
    recent: [{ at: Date.now() - 10000, summary: "Learned user preference" }],
    goals: [
      {
        id: "g-1",
        botId: "bot-1",
        title: "Launch v2 app",
        objective: "Ship the new major release",
        status: "active",
        progress: 60,
        milestones: [
          {
            id: "m-1",
            title: "Build features",
            completed: true,
            tasks: [{ id: "t-1", title: "API endpoints", status: "completed" }],
          },
          {
            id: "m-2",
            title: "QA verification",
            completed: false,
            dueDate: Date.now() + 86400000,
            tasks: [{ id: "t-2", title: "Device tests", status: "pending" }],
          },
        ],
        blockers: [],
        nextAction: "Run device tests",
        relevantMemories: [],
        relevantDocuments: [],
        associatedSpecialists: [],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
      },
    ],
    watches: [
      {
        id: "w-1",
        botId: "bot-1",
        target: "https://example.com/status",
        condition: "server status != 200",
        source: "server",
        cadenceMinutes: 15,
        status: "active",
        lastChecked: Date.now() - 600000,
        lastKnownState: "status:200",
        currentState: "status:200",
        notificationPolicy: "on_change",
        history: [{ at: Date.now() - 600000, state: "status:200" }],
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now(),
      },
    ],
    memoryText: `# Memory\n- 2026-10-15 · Prefers concise answers and dark mode.\n- 2026-10-16 · Always use metric units.\n- Project Phoenix deadline is Friday.`,
  };

  it("produces a 7-day calendar with today flagged and items mapped", () => {
    const overview = buildBotOverview(baseFacts);
    expect(overview.calendar.length).toBe(7);
    const today = overview.calendar.find((d) => d.isToday);
    expect(today).toBeDefined();
    expect(today?.items.length).toBeGreaterThan(0);
  });

  it("produces upcoming items, automations, and categorized memory", () => {
    const overview = buildBotOverview(baseFacts);

    // Upcoming
    expect(overview.upcoming.length).toBeGreaterThan(0);
    expect(overview.upcoming.some((u) => u.title.includes("Morning Briefing"))).toBe(true);

    // Automations
    expect(overview.automations.length).toBe(2);
    const active = overview.automations.find((a) => a.id === "r-1");
    const paused = overview.automations.find((a) => a.id === "r-2");
    expect(active?.status).toBe("active");
    expect(paused?.status).toBe("paused");

    // Memory categorization
    expect(overview.memory.length).toBe(3);
    const pref = overview.memory.find((m) => m.text.includes("concise answers"));
    const instr = overview.memory.find((m) => m.text.includes("metric units"));
    const context = overview.memory.find((m) => m.text.includes("Project Phoenix"));

    expect(pref?.category).toBe("preference");
    expect(instr?.category).toBe("instruction");
    expect(context?.category).toBe("context");

    // Goals & Watches
    expect(overview.goals.length).toBe(1);
    expect(overview.goals[0].title).toBe("Launch v2 app");
    expect(overview.goals[0].progress).toBe(60);

    expect(overview.watches.length).toBe(1);
    expect(overview.watches[0].condition).toBe("server status != 200");

    // Abilities
    expect(overview.abilities.some((a) => a.id === "web")).toBe(true);
    expect(overview.abilities.some((a) => a.id === "browser" && a.available)).toBe(true);
    expect(overview.abilities.some((a) => a.id === "connected_gmail")).toBe(true);
  });
});

// Delight Features & Contextual Surfaces (Phase V / Master Prompt P8)
//
// Implements:
// 1. Smart Recaps ("What changed while you were away?")
// 2. Daily Briefing Surface (calendar, routines, tasks, agent results, weather)
// 3. Beautiful Completion Moments (Task complete summary cards with [Open result], [Preview], [Share])
// 4. Observability integration (SMART_RECAP_CREATED, DAILY_BRIEFING_CREATED, COMPLETION_CARD_CREATED)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { writeFileAtomic } from "../atomic.ts";
import { sharedObservability } from "./observability.ts";
import type { Store } from "../store.ts";
import type { RoutineManager } from "../routines.ts";
import type { DeviceCapabilityRegistry } from "./capability-registry.ts";

export interface SmartRecapItem {
  id: string;
  botId?: string;
  botName?: string;
  threadId?: string;
  summary: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface SmartRecapSection {
  category:
    | "completed_tasks"
    | "important_messages"
    | "created_artifacts"
    | "pending_questions"
    | "meaningful_errors"
    | "routine_results";
  title: string;
  items: SmartRecapItem[];
}

export interface SmartRecap {
  headline: string;
  sinceTimestamp: number;
  generatedAt: number;
  totalChanges: number;
  sections: SmartRecapSection[];
  formattedMarkdown: string;
}

export interface SmartRecapQuery {
  since?: number | string;
  botId?: string;
}

export interface DailyBriefingConfig {
  calendarEnabled: boolean;
  routinesEnabled: boolean;
  tasksEnabled: boolean;
  agentResultsEnabled: boolean;
  weatherEnabled: boolean;
}

export interface DailyBriefingItem {
  id: string;
  title: string;
  subtitle?: string;
  time?: string;
  status?: string;
  priority?: "low" | "medium" | "high";
}

export interface DailyBriefingSection {
  id: "calendar" | "routines" | "tasks" | "agent_results" | "weather";
  title: string;
  items: DailyBriefingItem[];
  emptyMessage?: string;
}

export interface DailyBriefing {
  date: string;
  greeting: string;
  sections: DailyBriefingSection[];
  formattedMarkdown: string;
}

export interface CompletionOutcome {
  label: string;
  count?: number;
  detail?: string;
}

export interface CompletionCardOptions {
  taskTitle: string;
  status?: "completed" | "failed" | "cancelled";
  durationSeconds?: number;
  outcomes?: CompletionOutcome[];
  artifactId?: string;
  previewUrl?: string;
  shareText?: string;
}

export interface CompletionCardResult {
  card: {
    type: "completion";
    data: {
      taskTitle: string;
      status: "completed" | "failed" | "cancelled";
      durationSeconds?: number;
      outcomes: CompletionOutcome[];
      artifactId?: string;
      previewUrl?: string;
    };
    actions: Array<{ id: string; label: string; style?: string }>;
  };
  shareText: string;
}

/**
 * 1. SmartRecapService
 *
 * Scans conversation transcripts and task states across bots to assemble
 * a calm, structured summary of what changed while the user was away.
 */
export class SmartRecapService {
  private readonly store: Store;
  private readonly routines?: RoutineManager;

  constructor(store: Store, routines?: RoutineManager) {
    this.store = store;
    this.routines = routines;
  }

  generateRecap(query: SmartRecapQuery = {}): SmartRecap {
    const now = Date.now();
    let sinceMs: number;
    if (typeof query.since === "number") {
      sinceMs = query.since;
    } else if (typeof query.since === "string" && !isNaN(Number(query.since))) {
      sinceMs = Number(query.since);
    } else if (typeof query.since === "string") {
      const parsed = Date.parse(query.since);
      sinceMs = isNaN(parsed) ? now - 24 * 60 * 60 * 1000 : parsed;
    } else {
      sinceMs = now - 24 * 60 * 60 * 1000; // default 24h
    }

    const completedTasks: SmartRecapItem[] = [];
    const importantMessages: SmartRecapItem[] = [];
    const createdArtifacts: SmartRecapItem[] = [];
    const pendingQuestions: SmartRecapItem[] = [];
    const meaningfulErrors: SmartRecapItem[] = [];
    const routineResults: SmartRecapItem[] = [];

    const targetBots = query.botId
      ? this.store.bots.filter((b) => b.id === query.botId)
      : this.store.bots;

    for (const bot of targetBots) {
      const tasks = this.store.tasks(bot.id);
      for (const task of tasks) {
        // Check if task closed after sinceMs
        if (task.closedBy && task.closedBy.at >= sinceMs) {
          completedTasks.push({
            id: `task-closed-${task.threadId}`,
            botId: bot.id,
            botName: bot.name,
            threadId: task.threadId,
            summary: `Task "${task.title || "Untitled"}" closed`,
            timestamp: task.closedBy.at,
          });
        }

        const messages = this.store.messagesFor(task.threadId);
        if (!messages || messages.length === 0) continue;

        // Scan messages within timeframe
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          if (m.at < sinceMs) continue;

          // Pending questions / ask_user cards
          if (m.role === "bot" && (m.kind === "options" || Boolean(m.card))) {
            // Check if there is an answer following this message
            const hasAnswer = messages.slice(i + 1).some((after) => after.role === "user");
            if (!hasAnswer) {
              pendingQuestions.push({
                id: `question-${m.id}`,
                botId: bot.id,
                botName: bot.name,
                threadId: task.threadId,
                summary: m.card?.title || m.text || "Pending user decision",
                timestamp: m.at,
              });
            }
          }

          // Meaningful errors & failures
          if (m.failure) {
            meaningfulErrors.push({
              id: `error-${m.id}`,
              botId: bot.id,
              botName: bot.name,
              threadId: task.threadId,
              summary: `${m.failure.title || "Turn failed"}: ${m.failure.detail || ""}`.trim(),
              timestamp: m.at,
              details: { provider: m.failure.provider, model: m.failure.model },
            });
          } else if (m.tool && (m.tool.ok === false || m.tool.error)) {
            meaningfulErrors.push({
              id: `tool-err-${m.id}`,
              botId: bot.id,
              botName: bot.name,
              threadId: task.threadId,
              summary: `Tool ${m.tool.name} encountered an error: ${m.tool.error || "failed"}`,
              timestamp: m.at,
            });
          }

          // Created artifacts
          if (m.kind === "structured" && m.structured?.components) {
            for (const c of m.structured.components) {
              if (c.type === "artifact") {
                createdArtifacts.push({
                  id: `artifact-${c.id || m.id}`,
                  botId: bot.id,
                  botName: bot.name,
                  threadId: task.threadId,
                  summary: c.title || `Artifact created (${c.type})`,
                  timestamp: m.at,
                });
              }
            }
          } else if (m.tool && (m.tool.name === "write_to_file" || m.tool.name === "fs_write" || m.tool.name === "project_create_file") && m.tool.ok !== false) {
            createdArtifacts.push({
              id: `file-${m.id}`,
              botId: bot.id,
              botName: bot.name,
              threadId: task.threadId,
              summary: `Created file via ${m.tool.name}`,
              timestamp: m.at,
            });
          }

          // Routine execution results
          if (m.routineRun) {
            routineResults.push({
              id: `routine-run-${m.id}`,
              botId: bot.id,
              botName: bot.name,
              threadId: task.threadId,
              summary: `Routine ${m.routineRun.routineName}: ${m.routineRun.summary || m.routineRun.status}`,
              timestamp: m.at,
              details: { status: m.routineRun.status },
            });
          }

          // Important bot messages / settled milestones
          if (m.role === "bot" && m.turnTerminal && m.text && m.text.length > 30) {
            // Pick headline or first line
            const firstLine = m.text.split("\n")[0].trim().replace(/^#+\s*/, "");
            importantMessages.push({
              id: `msg-${m.id}`,
              botId: bot.id,
              botName: bot.name,
              threadId: task.threadId,
              summary: firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine,
              timestamp: m.at,
            });
          }
        }
      }
    }

    if (this.routines) {
      try {
        const routinesList = this.routines.listRoutines();
        for (const r of routinesList) {
          if (r.nextRunAt && r.nextRunAt >= sinceMs) {
            routineResults.push({
              id: `routine-${r.id}`,
              botId: r.botId,
              botName: this.store.bot(r.botId)?.name,
              summary: `Scheduled routine "${r.name}"`,
              timestamp: r.nextRunAt,
            });
          }
        }
      } catch {}
    }

    const sections: SmartRecapSection[] = [];
    if (completedTasks.length > 0) {
      sections.push({ category: "completed_tasks", title: "Completed Tasks", items: completedTasks });
    }
    if (pendingQuestions.length > 0) {
      sections.push({ category: "pending_questions", title: "Pending Questions", items: pendingQuestions });
    }
    if (createdArtifacts.length > 0) {
      sections.push({ category: "created_artifacts", title: "Newly Created Artifacts & Files", items: createdArtifacts });
    }
    if (meaningfulErrors.length > 0) {
      sections.push({ category: "meaningful_errors", title: "Important Errors & Recovery", items: meaningfulErrors });
    }
    if (routineResults.length > 0) {
      sections.push({ category: "routine_results", title: "Routine Results", items: routineResults });
    }
    if (importantMessages.length > 0) {
      sections.push({ category: "important_messages", title: "Key Updates & Milestones", items: importantMessages });
    }

    const totalChanges =
      completedTasks.length +
      pendingQuestions.length +
      createdArtifacts.length +
      meaningfulErrors.length +
      routineResults.length +
      importantMessages.length;

    // Build human-friendly formatted markdown
    const mdLines: string[] = [
      `# What changed while you were away`,
      ``,
      totalChanges === 0
        ? `Everything has been calm. No new tasks or errors since your last check-in.`
        : `**${totalChanges} updates** recorded across your fleet since ${new Date(sinceMs).toLocaleString()}.`,
      ``,
    ];

    for (const sec of sections) {
      mdLines.push(`### ${sec.title}`);
      for (const item of sec.items) {
        const prefix = item.botName ? `**[${item.botName}]** ` : "";
        mdLines.push(`- ${prefix}${item.summary}`);
      }
      mdLines.push(``);
    }

    const recap: SmartRecap = {
      headline: "What changed while you were away",
      sinceTimestamp: sinceMs,
      generatedAt: now,
      totalChanges,
      sections,
      formattedMarkdown: mdLines.join("\n").trim(),
    };

    sharedObservability.emit("SMART_RECAP_CREATED", {
      totalChanges,
      sectionsCount: sections.length,
      botId: query.botId,
      sinceMs,
    });

    return recap;
  }
}

/**
 * 2. DailyBriefingService
 *
 * Provides a morning / daily summary aggregating calendar, routines,
 * active tasks, and recent agent accomplishments with user-controllable toggles.
 */
export class DailyBriefingService {
  private readonly store: Store;
  private readonly capabilityRegistry: DeviceCapabilityRegistry;
  private readonly routines?: RoutineManager;
  private readonly configFilePath: string;
  private config: DailyBriefingConfig;

  constructor(
    store: Store,
    capabilityRegistry: DeviceCapabilityRegistry,
    routines?: RoutineManager,
    customConfigPath?: string,
  ) {
    this.store = store;
    this.capabilityRegistry = capabilityRegistry;
    this.routines = routines;
    this.configFilePath = customConfigPath || join(DATA_DIR, "daily-briefing-config.json");
    this.config = this.loadConfig();
  }

  private loadConfig(): DailyBriefingConfig {
    const defaults: DailyBriefingConfig = {
      calendarEnabled: true,
      routinesEnabled: true,
      tasksEnabled: true,
      agentResultsEnabled: true,
      weatherEnabled: false,
    };
    if (existsSync(this.configFilePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.configFilePath, "utf8"));
        return { ...defaults, ...parsed };
      } catch {
        return defaults;
      }
    }
    return defaults;
  }

  getConfig(): DailyBriefingConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<DailyBriefingConfig>): DailyBriefingConfig {
    this.config = { ...this.config, ...patch };
    try {
      writeFileAtomic(this.configFilePath, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.warn("[daily-briefing] failed to persist config:", err);
    }
    return this.getConfig();
  }

  async generateBriefing(nowDate: Date = new Date()): Promise<DailyBriefing> {
    const hours = nowDate.getHours();
    let greeting = "Good morning";
    if (hours >= 12 && hours < 17) greeting = "Good afternoon";
    else if (hours >= 17) greeting = "Good evening";

    const dateStr = nowDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

    const sections: DailyBriefingSection[] = [];

    // 1. Calendar section
    if (this.config.calendarEnabled) {
      const calendarItems: DailyBriefingItem[] = [];
      if (this.capabilityRegistry.has("device.calendar")) {
        const startOfDay = new Date(
          nowDate.getFullYear(),
          nowDate.getMonth(),
          nowDate.getDate(),
        ).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
        try {
          const res = await this.capabilityRegistry.invoke(
            "device.calendar",
            "list_events",
            { startTime: startOfDay, endTime: endOfDay },
          );
          if (res.success && Array.isArray((res.data as any)?.events)) {
            for (const ev of (res.data as any).events) {
              const startFormatted = ev.startTime
                ? new Date(ev.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "";
              calendarItems.push({
                id: ev.id || `cal-${Math.random().toString(36).slice(2)}`,
                title: ev.title || "Untitled Event",
                subtitle: ev.location,
                time: startFormatted,
              });
            }
          }
        } catch {
          // Graceful fallback
        }
      }
      sections.push({
        id: "calendar",
        title: "Calendar",
        items: calendarItems,
        emptyMessage: calendarItems.length === 0 ? "No calendar events scheduled for today." : undefined,
      });
    }

    // 2. Routines section
    if (this.config.routinesEnabled) {
      const routineItems: DailyBriefingItem[] = [];
      if (this.routines) {
        try {
          const list = this.routines.listRoutines();
          const activeRoutines = list.filter((r) => r.enabled !== false);
          for (const r of activeRoutines) {
            const bot = this.store.bot(r.botId);
            const scheduleDesc =
              r.schedule?.type === "daily"
                ? `Daily at ${r.schedule.time || "09:00"}`
                : r.schedule?.type === "interval"
                ? `Every ${r.schedule.everyMinutes || 60}m`
                : "Scheduled";
            routineItems.push({
              id: r.id,
              title: r.name,
              subtitle: bot ? `Assigned to ${bot.name}` : undefined,
              time: scheduleDesc,
              status: "active",
            });
          }
        } catch {
          // Graceful fallback
        }
      }
      sections.push({
        id: "routines",
        title: "Scheduled Routines",
        items: routineItems,
        emptyMessage: routineItems.length === 0 ? "No active routines scheduled." : undefined,
      });
    }

    // 3. Important Tasks section
    if (this.config.tasksEnabled) {
      const taskItems: DailyBriefingItem[] = [];
      for (const bot of this.store.bots) {
        for (const task of this.store.tasks(bot.id)) {
          if (task.archivedAt) continue;
          if (task.unread || (task.activity && task.activity !== "idle")) {
            taskItems.push({
              id: task.threadId,
              title: task.title || "Active conversation",
              subtitle: bot.name,
              status: task.activity || (task.unread ? "unread" : "active"),
              priority: "high",
            });
          }
        }
      }
      sections.push({
        id: "tasks",
        title: "Active & Priority Tasks",
        items: taskItems,
        emptyMessage: taskItems.length === 0 ? "All tasks are up to date." : undefined,
      });
    }

    // 4. Agent Results section
    if (this.config.agentResultsEnabled) {
      const resultItems: DailyBriefingItem[] = [];
      const since24h = Date.now() - 24 * 60 * 60 * 1000;
      for (const bot of this.store.bots) {
        for (const task of this.store.tasks(bot.id)) {
          const msgs = this.store.messagesFor(task.threadId);
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg && lastMsg.role === "bot" && lastMsg.at >= since24h && lastMsg.turnTerminal) {
            const preview = (lastMsg.text || "").split("\n")[0].trim().replace(/^#+\s*/, "");
            if (preview) {
              resultItems.push({
                id: `res-${lastMsg.id}`,
                title: task.title || bot.name,
                subtitle: `${bot.name}: ${preview.slice(0, 60)}`,
                time: new Date(lastMsg.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              });
            }
          }
        }
      }
      sections.push({
        id: "agent_results",
        title: "Recent Agent Highlights",
        items: resultItems.slice(0, 5),
        emptyMessage: resultItems.length === 0 ? "No agent outputs in the last 24 hours." : undefined,
      });
    }

    // 5. Weather section (only if capability is configured and available)
    if (this.config.weatherEnabled) {
      const weatherItems: DailyBriefingItem[] = [];
      const hasWeather =
        this.capabilityRegistry.has("device.weather") ||
        this.capabilityRegistry.has("weather");
      if (!hasWeather) {
        weatherItems.push({
          id: "weather-not-configured",
          title: "Weather capability not configured",
          subtitle: "Configure a weather provider in Settings → Capabilities",
          status: "unavailable",
        });
      }
      sections.push({
        id: "weather",
        title: "Weather",
        items: weatherItems,
      });
    }

    // Assemble calm markdown
    const md: string[] = [
      `# ${greeting} • ${dateStr}`,
      ``,
    ];
    for (const sec of sections) {
      md.push(`### ${sec.title}`);
      if (sec.items.length === 0 && sec.emptyMessage) {
        md.push(`_${sec.emptyMessage}_`);
      } else {
        for (const it of sec.items) {
          const detail = [it.time, it.subtitle].filter(Boolean).join(" • ");
          md.push(`- **${it.title}**${detail ? ` (${detail})` : ""}`);
        }
      }
      md.push(``);
    }

    const briefing: DailyBriefing = {
      date: dateStr,
      greeting,
      sections,
      formattedMarkdown: md.join("\n").trim(),
    };

    sharedObservability.emit("DAILY_BRIEFING_CREATED", {
      date: dateStr,
      sectionsCount: sections.length,
      config: this.config,
    });

    return briefing;
  }
}

/**
 * 3. CompletionCardGenerator
 *
 * Produces structured completion moment cards when long-running tasks conclude,
 * presenting quantifiable outcomes, durations, and action affordances ([Open result], [Preview], [Share]).
 */
export class CompletionCardGenerator {
  createCompletionCard(options: CompletionCardOptions): CompletionCardResult {
    const status = options.status || "completed";
    const outcomes = options.outcomes || [];

    const actions: Array<{ id: string; label: string; style?: string }> = [
      { id: "open_result", label: "Open result", style: "primary" },
      { id: "preview", label: "Preview", style: "secondary" },
      { id: "share", label: "Share", style: "secondary" },
    ];

    const outcomesText =
      outcomes.length > 0
        ? outcomes
            .map(
              (o) =>
                `- ${o.count !== undefined ? `${o.count} ` : ""}${o.label}${
                  o.detail ? ` (${o.detail})` : ""
                }`,
            )
            .join("\n")
        : "- Task execution completed successfully";

    const durationText = options.durationSeconds
      ? `Duration: ${options.durationSeconds.toFixed(1)}s`
      : "";

    const shareText =
      options.shareText ||
      [
        `Task Complete: ${options.taskTitle}`,
        `Status: ${status}`,
        durationText,
        "",
        "Created:",
        outcomesText,
      ]
        .filter(Boolean)
        .join("\n");

    const result: CompletionCardResult = {
      card: {
        type: "completion",
        data: {
          taskTitle: options.taskTitle,
          status,
          durationSeconds: options.durationSeconds,
          outcomes,
          artifactId: options.artifactId,
          previewUrl: options.previewUrl,
        },
        actions,
      },
      shareText,
    };

    sharedObservability.emit("COMPLETION_CARD_CREATED", {
      taskTitle: options.taskTitle,
      status,
      durationSeconds: options.durationSeconds,
      outcomesCount: outcomes.length,
    });

    return result;
  }
}

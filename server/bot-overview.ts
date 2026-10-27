// One builder for "what does this bot do" plain-language sentences, so the
// phones (step 5) and the web settings dialog agree on the same wording. The
// route in index.ts (botOverview()) is the only place that reads server-only
// state (engine capabilities, connected-apps inventory, history); everything
// here is pure and takes that state already gathered as OverviewFacts.
import type { BotRecord } from "./store.ts";
import type { Routine } from "./routines.ts";
import type { RoutineRequestSchedule } from "../shared/routine-request.ts";
import { approvalModeFor } from "../shared/approval-mode.ts";
import { cronScheduleLabel } from "../shared/cron-label.ts";

import type { Goal } from "./goals.ts";
import type { Watch } from "./watches.ts";
import { sharedPersistentJobManager } from "./tasks.ts";

export interface CalendarItemOverview {
  id: string;
  title: string;
  type: "routine" | "run" | "watch" | "goal" | "reminder";
  time: string;
  status: string;
  description?: string;
  routineId?: string;
}

export interface CalendarDayOverview {
  dayDate: string; // YYYY-MM-DD
  dayName: string; // e.g. Mon, Tue, Wed
  dayNumber: number; // e.g. 16
  isToday: boolean;
  items: CalendarItemOverview[];
}

export interface UpcomingItemOverview {
  id: string;
  title: string;
  scheduledAt: number;
  formattedTime: string;
  type: "routine" | "watch" | "goal";
  status: "active" | "paused" | "pending";
  cadence?: string;
  target?: string;
}

export interface MemoryItemOverview {
  id: string;
  text: string;
  category: "preference" | "fact" | "instruction" | "context";
  source?: string;
  date?: string;
}

export interface AutomationOverview {
  id: string;
  name: string;
  status: "active" | "paused" | "failed";
  schedule: string;
  lastRunAt?: number;
  lastRunStatus?: string;
  nextRunAt?: number;
}

export interface AbilityOverview {
  id: string;
  name: string;
  description: string;
  available: boolean;
  category: "core" | "device" | "connected";
}

export interface GoalOverview {
  id: string;
  title: string;
  status: "active" | "paused" | "completed" | "blocked" | "QUEUED" | "RUNNING" | "PAUSED_FOR_USER" | "BLOCKED_DEPENDENCY" | "FAILED" | "CANCELLED";
  progress: number;
  milestoneCount: number;
  completedMilestones: number;
  nextAction?: string;
  blockers: string[];
}

export interface WatchOverview {
  id: string;
  target: string;
  condition: string;
  source: string;
  status: "active" | "paused" | "triggered" | "expired";
  cadenceMinutes: number;
  lastChecked?: number;
  lastKnownState?: string;
}

export interface ActivityOverview {
  id: string;
  summary: string;
  at: number;
  type: "research" | "goal" | "watch" | "routine" | "memory";
}

export interface BotOverview {
  who: { name: string; title: string; blurb: string; soulLead: string };
  does: string[];
  reaches: string[];
  wont: string[];
  recent: Array<{ at: number; summary: string }>;
  /** Optional setup ideas, each pointing at the relevant settings section.
   * These are customization suggestions, not requirements for chatting. */
  setup: SetupStep[];
  // Command Center extensions
  calendar: CalendarDayOverview[];
  upcoming: UpcomingItemOverview[];
  memory: MemoryItemOverview[];
  automations: AutomationOverview[];
  abilities: AbilityOverview[];
  goals: GoalOverview[];
  watches: WatchOverview[];
  activities: ActivityOverview[];
}

export type SetupStepId = "identity" | "soul" | "folder" | "apps" | "schedule";
export type SetupStepSection = "identity" | "soul" | "access" | "routines";

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
  /** Bot-settings section for this customization. */
  section?: SetupStepSection;
}

export interface OverviewFacts {
  bot: Pick<
    BotRecord,
    | "name"
    | "title"
    | "description"
    | "soul"
    | "computer"
    | "cloudBackend"
    | "cwd"
    | "autoApprove"
    | "approvalMode"
    | "approvePeerComms"
    | "peers"
    | "composio"
    | "browser"
    | "chiefOfStaff"
    | "managedSections"
  >;
  routines: Array<{
    id: string;
    name: string;
    enabled: boolean;
    schedule: RoutineRequestSchedule | Routine["schedule"];
    nextRunAt: number | null;
    taskObjective?: string;
    prompt?: string;
  }>;
  runs: Array<{ routineId: string; status: string; finishedAt?: number; startedAt?: number; scheduledFor: number }>;
  webhooks: Array<{ name: string; enabled: boolean }>;
  skills: Array<{ name: string; description: string; enabled: boolean }>;
  engine: { agentsMcp?: boolean; composioMcp?: boolean; browserMcp?: boolean; computerMcp?: boolean } | null;
  browserEnabled?: boolean;
  connectedApps: { configured: boolean; authoritative: boolean; services: string[] };
  sectionPeers: number;
  timeZone: string;
  recent: Array<{ at: number; summary: string }>;
  // Command Center facts
  goals?: Goal[];
  watches?: Watch[];
  memoryText?: string;
  now?: number;
}

/** The first paragraph of a SOUL.md-style persona, capped at 240 characters
 * so a settings-dialog card never renders a full standing-instructions
 * document inline. */
export function soulLead(soul: string | undefined): string {
  const trimmed = (soul ?? "").trim();
  if (!trimmed) return "";
  const paragraph = (trimmed.split(/\r?\n\s*\r?\n/)[0] ?? trimmed).trim();
  return paragraph.length > 240 ? `${paragraph.slice(0, 240).trimEnd()}…` : paragraph;
}

function lowerFirst(value: string): string {
  return value.length ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function time(at: number, timeZone: string): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "09:05" → "9:05 AM" — the daily schedule's wall-clock time as a person
 * would say it, with no timezone suffix (the Overview is read in the
 * timezone it was built for). */
function clockTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map((part) => Number.parseInt(part, 10) || 0);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** The schedule as the opening phrase of a Does line — "Every 5 minutes",
 * "Every weekday at 9:00 AM", "Once on September 5 at 12:00 PM". The
 * approval card's scheduleText() carries the anchor instant and timezone
 * name because a card must be exact; a plain-language overview must not. */
function schedulePhrase(schedule: OverviewFacts["routines"][number]["schedule"], timeZone: string): string {
  if (schedule.type === "cron") return cronScheduleLabel(schedule);
  if (schedule.type === "once") {
    const date = new Date(schedule.at).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone });
    return `Once on ${date} at ${time(schedule.at, timeZone)}`;
  }
  if (schedule.type === "interval") {
    const minutes = schedule.everyMinutes;
    if (minutes < 60) return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
    if (minutes === 60) return "Every hour";
    if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
    return `Every ${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) === 1 ? "" : "s"} ${minutes % 60} minutes`;
  }
  const days = schedule.weekdays;
  const at = ` at ${clockTime(schedule.time)}`;
  if (days.length === 7) return `Every day${at}`;
  if (days.join(",") === "1,2,3,4,5") return `Every weekday${at}`;
  if (days.length === 1) return `Weekly on ${DAY_NAMES[days[0]!]}${at}`;
  return `${days.map((day) => DAY_NAMES[day]).join(", ")}${at}`;
}

/** The most recent run for a routine, by (finishedAt ?? startedAt ??
 * scheduledFor) — not merely the first match in `runs`, since callers may
 * hand this an unsorted or multi-routine list. */
function latestRunFor(runs: OverviewFacts["runs"], routineId: string): OverviewFacts["runs"][number] | undefined {
  let best: OverviewFacts["runs"][number] | undefined;
  let bestAt = -Infinity;
  for (const run of runs) {
    if (run.routineId !== routineId) continue;
    const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    if (at > bestAt) {
      bestAt = at;
      best = run;
    }
  }
  return best;
}

function doesLines(facts: OverviewFacts): string[] {
  const lines: string[] = [];
  for (const routine of facts.routines) {
    if (!routine.enabled) {
      lines.push(`Paused: ${routine.name}.`);
      continue;
    }
    const nextRun = routine.nextRunAt != null ? ` Next run ${time(routine.nextRunAt, facts.timeZone)}.` : "";
    const latest = latestRunFor(facts.runs, routine.id);
    const at = latest ? latest.finishedAt ?? latest.startedAt ?? latest.scheduledFor : undefined;
    const lastRun = latest ? ` Last run ${latest.status} at ${time(at!, facts.timeZone)}.` : "";
    lines.push(`${schedulePhrase(routine.schedule, facts.timeZone)}: ${routine.name}.${nextRun}${lastRun}`);
  }
  for (const skill of facts.skills) {
    if (!skill.enabled) continue;
    lines.push(`Knows how to ${lowerFirst(skill.description || skill.name)}.`);
  }
  for (const webhook of facts.webhooks) {
    if (!webhook.enabled) continue;
    lines.push(`Listens for “${webhook.name}” webhooks.`);
  }
  return lines;
}

/** The connected-apps facts for the route: reads the inventory only when a
 * connector is configured and the credential store was readable, and treats
 * a failing read (connector down, token rejected) as "unverified" rather
 * than letting it fail the whole Overview. `read` is injected so the
 * fallback is unit-testable without a live connector. */
export async function connectedAppsFacts(
  configured: boolean,
  availability: "configured" | "unconfigured" | "unreadable",
  read: () => Promise<Record<string, { connected: boolean }>>,
): Promise<OverviewFacts["connectedApps"]> {
  let authoritative = availability !== "unreadable";
  let services: string[] = [];
  if (configured && authoritative) {
    try {
      services = Object.entries(await read())
        .filter(([, state]) => state.connected)
        .map(([slug]) => slug);
    } catch {
      authoritative = false;
    }
  }
  return { configured, authoritative, services };
}

/** Whether this bot could use connected apps at all: apps on for the bot,
 * a connector configured, and an engine that mounts the Composio MCP. */
function couldUseApps(facts: OverviewFacts): boolean {
  return facts.bot.composio !== false && facts.connectedApps.configured && Boolean(facts.engine?.composioMcp);
}

function computerReach(computer: BotRecord["computer"]): string | null {
  switch (computer) {
    case "cloud":
      return "Computer preference: cloud computer.";
    case "vm":
      return "Computer preference: Local VM.";
    case "local":
      return "Computer preference: this computer.";
    case "browser":
      return "Computer preference: browser only.";
    case "off":
      return null;
    default:
      return "Computer preference: Auto; availability is checked when a task starts.";
  }
}

function reachesLines(facts: OverviewFacts): string[] {
  const lines: string[] = [];
  const computer = computerReach(facts.bot.computer);
  if (computer) lines.push(computer);
  lines.push(facts.bot.cwd ? `Works in ${facts.bot.cwd}.` : "Works in its private workspace.");
  const apps = facts.connectedApps;
  // Only a bot that could actually use apps gets an apps line here. When it
  // could, the inventory decides: verified and non-empty → list them;
  // unverified → say so rather than guess either way.
  if (couldUseApps(facts) && apps.authoritative && apps.services.length > 0) {
    const count = apps.services.length;
    lines.push(`Can use ${count} connected app${count === 1 ? "" : "s"}: ${apps.services.join(", ")}.`);
  } else if (couldUseApps(facts) && !apps.authoritative) {
    lines.push("Connected apps could not be checked.");
  }
  if (facts.browserEnabled && facts.engine?.browserMcp && facts.bot.browser !== false && facts.bot.computer !== "off") lines.push("Has the built-in browser.");
  if (facts.engine?.agentsMcp && facts.sectionPeers > 0 && facts.bot.peers?.length !== 0) {
    const scope = facts.bot.chiefOfStaff && facts.bot.managedSections?.length ? "its allowed teams" : "its section";
    lines.push(`Can talk to ${facts.sectionPeers} other bot${facts.sectionPeers === 1 ? "" : "s"} in ${scope}.`);
  }
  if (facts.bot.chiefOfStaff) lines.push("Coordinates its section as Chief of Staff.");
  if (facts.bot.chiefOfStaff && facts.bot.managedSections?.length) {
    lines.push(`May also coordinate these teams: ${facts.bot.managedSections.map(name => name || "General").join(", ")}.`);
  }
  return lines;
}

function wontLines(facts: OverviewFacts): string[] {
  const lines: string[] = [];
  const mode = approvalModeFor(facts.bot);
  if (mode === "ask") lines.push("Command approvals use Ask mode; saved permissions and provider rules still apply.");
  if (mode === "custom") lines.push("Command approvals follow the provider's custom configuration.");
  if (facts.bot.peers?.length === 0) lines.push("Cannot initiate contact with other bots.");
  else if (mode !== "full" && facts.bot.approvePeerComms) lines.push("Asks before contacting other bots.");
  // "Has no connected apps." is definite when apps are off for this bot,
  // not configured, or unsupported by its engine — no inventory needed. Only
  // the "configured but nothing connected" case rests on the inventory, so
  // only that case requires it to be authoritative.
  if (!couldUseApps(facts) || (facts.connectedApps.authoritative && facts.connectedApps.services.length === 0)) {
    lines.push("Has no connected apps.");
  }
  if (facts.bot.computer === "off") lines.push("Can't use a computer.");
  if (!facts.routines.some((routine) => routine.enabled)) lines.push("Won't act on a schedule.");
  if (mode !== "full") lines.push("Profile proposal cards require your approval.");
  return lines;
}

function formatDayDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildWeeklyCalendar(facts: OverviewFacts): CalendarDayOverview[] {
  const nowMs = facts.now ?? Date.now();
  const nowDate = new Date(nowMs);
  const tz = facts.timeZone;
  const todayStr = formatDayDate(nowDate, tz);

  const days: CalendarDayOverview[] = [];
  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(nowMs + offset * 86400000);
    const dayDate = formatDayDate(d, tz);
    const dayOfWeek = d.getDay();
    const dayNumber = d.getDate();
    const isToday = dayDate === todayStr;

    const items: CalendarItemOverview[] = [];

    for (const r of facts.routines) {
      if (!r.enabled) continue;
      if (r.nextRunAt) {
        const nextDate = formatDayDate(new Date(r.nextRunAt), tz);
        if (nextDate === dayDate) {
          items.push({
            id: `routine-${r.id}`,
            routineId: r.id,
            title: r.name,
            type: "routine",
            time: time(r.nextRunAt, tz),
            status: "active",
            description: r.prompt || r.taskObjective,
          });
        }
      } else if (r.schedule.type === "interval") {
        items.push({
          id: `routine-cadence-${r.id}`,
          routineId: r.id,
          title: r.name,
          type: "routine",
          time: schedulePhrase(r.schedule, tz),
          status: "active",
          description: r.prompt,
        });
      }
    }

    for (const run of facts.runs) {
      const runTime = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
      if (formatDayDate(new Date(runTime), tz) === dayDate) {
        const rName = facts.routines.find((rt) => rt.id === run.routineId)?.name ?? "Automation Run";
        items.push({
          id: `run-${run.routineId}-${runTime}`,
          routineId: run.routineId,
          title: rName,
          type: "run",
          time: time(runTime, tz),
          status: run.status,
        });
      }
    }

    for (const goal of facts.goals ?? []) {
      for (const m of goal.milestones) {
        if (m.dueDate && formatDayDate(new Date(m.dueDate), tz) === dayDate) {
          items.push({
            id: `goal-milestone-${m.id}`,
            title: `Milestone: ${m.title}`,
            type: "goal",
            time: "Deadline",
            status: m.completed ? "completed" : "pending",
            description: `Goal: ${goal.title}`,
          });
        }
      }
    }

    if (isToday) {
      for (const w of facts.watches ?? []) {
        if (w.status === "active") {
          items.push({
            id: `watch-${w.id}`,
            title: `Watch: ${w.target.slice(0, 30)}`,
            type: "watch",
            time: `Every ${w.cadenceMinutes}m`,
            status: w.status,
            description: w.condition,
          });
        }
      }
    }

    days.push({
      dayDate,
      dayName: SHORT_DAY_NAMES[dayOfWeek] ?? "Day",
      dayNumber,
      isToday,
      items,
    });
  }

  return days;
}

function buildUpcomingItems(facts: OverviewFacts): UpcomingItemOverview[] {
  const items: UpcomingItemOverview[] = [];
  const tz = facts.timeZone;

  for (const r of facts.routines) {
    if (!r.enabled) continue;
    if (r.nextRunAt) {
      items.push({
        id: `routine-${r.id}`,
        title: r.name,
        scheduledAt: r.nextRunAt,
        formattedTime: `${formatDayDate(new Date(r.nextRunAt), tz)} ${time(r.nextRunAt, tz)}`,
        type: "routine",
        status: "active",
        cadence: schedulePhrase(r.schedule, tz),
        target: r.prompt,
      });
    }
  }

  for (const w of facts.watches ?? []) {
    if (w.status === "active") {
      const nextCheck = (w.lastChecked ?? Date.now()) + w.cadenceMinutes * 60000;
      items.push({
        id: `watch-${w.id}`,
        title: `Watch: ${w.condition}`,
        scheduledAt: nextCheck,
        formattedTime: time(nextCheck, tz),
        type: "watch",
        status: "active",
        cadence: `Every ${w.cadenceMinutes} min`,
        target: w.target,
      });
    }
  }

  items.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return items.slice(0, 10);
}

function buildMemoryItems(facts: OverviewFacts): MemoryItemOverview[] {
  const items: MemoryItemOverview[] = [];
  const raw = facts.memoryText ?? "";

  const lines = raw.split(/\r?\n/);
  let idCounter = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;
    const content = trimmed.slice(2).trim();
    if (!content || content.startsWith("Durable notes") || content.startsWith("The first 200 lines")) continue;

    const lower = content.toLowerCase();
    let category: MemoryItemOverview["category"] = "fact";
    if (lower.includes("prefer") || lower.includes("like") || lower.includes("want") || lower.includes("favorite")) {
      category = "preference";
    } else if (lower.includes("must") || lower.includes("always") || lower.includes("never") || lower.includes("rule")) {
      category = "instruction";
    } else if (lower.includes("project") || lower.includes("working on") || lower.includes("repo") || lower.includes("app")) {
      category = "context";
    }

    const dateMatch = content.match(/^(\d{4}-\d{2}-\d{2}|\d{2}:\d{2})/);
    const date = dateMatch ? dateMatch[1] : undefined;
    const cleanText = date ? content.replace(/^(\d{4}-\d{2}-\d{2}|\d{2}:\d{2})\s*[·•-]?\s*/, "") : content;

    items.push({
      id: `mem-${idCounter++}`,
      text: cleanText,
      category,
      date,
    });
  }

  return items;
}

function buildAutomations(facts: OverviewFacts): AutomationOverview[] {
  const automations: AutomationOverview[] = [];
  const tz = facts.timeZone;

  for (const r of facts.routines) {
    const latest = latestRunFor(facts.runs, r.id);
    const lastRunAt = latest ? latest.finishedAt ?? latest.startedAt ?? latest.scheduledFor : undefined;
    automations.push({
      id: r.id,
      name: r.name,
      status: !r.enabled ? "paused" : latest?.status === "failed" ? "failed" : "active",
      schedule: schedulePhrase(r.schedule, tz),
      lastRunAt,
      lastRunStatus: latest?.status,
      nextRunAt: r.nextRunAt ?? undefined,
    });
  }

  return automations;
}

function humanizeServiceName(raw: string): string {
  const norm = raw.toLowerCase().trim();
  switch (norm) {
    case "google_maps":
    case "google-maps":
      return "Google Maps";
    case "googledrive":
    case "google_drive":
    case "google-drive":
      return "Google Drive";
    case "gmail":
      return "Gmail";
    case "neon_mcp":
    case "neon":
      return "Neon";
    case "supabase":
      return "Supabase";
    case "firecrawl":
      return "Firecrawl";
    case "github":
      return "GitHub";
    case "slack":
      return "Slack";
    case "notion":
      return "Notion";
    default: {
      const stripped = norm.replace(/_mcp$/i, "");
      return stripped
        .split(/[_-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
}

function buildAbilities(facts: OverviewFacts): AbilityOverview[] {
  const abilities: AbilityOverview[] = [
    {
      id: "web",
      name: "Web & Search",
      description: "Search current information, docs, and online products",
      available: true,
      category: "core",
    },
    {
      id: "files",
      name: "Device Files & Workspaces",
      description: facts.bot.cwd ? `Access to workspace at ${facts.bot.cwd}` : "Private sandboxed workspace storage",
      available: true,
      category: "core",
    },
    {
      id: "browser",
      name: "Autonomous Browser",
      description: "Direct headless browser navigation, page inspection, and DOM reading",
      available: facts.browserEnabled === true && facts.bot.browser !== false && facts.bot.computer !== "off",
      category: "device",
    },
    {
      id: "device_control",
      name: "Android Device Control",
      description: "Device capability layer: calendar, contacts, clipboard, and apps",
      available: true,
      category: "device",
    },
    {
      id: "terminal",
      name: "System Terminal",
      description: "Execution of local CLI commands and build scripts",
      available: facts.bot.computer !== "off",
      category: "core",
    },
  ];

  if (facts.connectedApps.configured) {
    for (const service of facts.connectedApps.services) {
      abilities.push({
        id: `connected_${service}`,
        name: humanizeServiceName(service),
        description: `Connected third-party service integration via Composio`,
        available: true,
        category: "connected",
      });
    }
  }

  return abilities;
}

function buildGoalOverviews(facts: OverviewFacts): GoalOverview[] {
  return (facts.goals ?? []).map((g) => {
    const persistentJob = sharedPersistentJobManager.getJob(`job-${g.id}`) ?? sharedPersistentJobManager.getJob(g.id);
    const status = (persistentJob ? persistentJob.state : g.status) as GoalOverview["status"];
    const progress = persistentJob ? persistentJob.progressPercent : g.progress;
    const completedMilestones = persistentJob
      ? persistentJob.currentMilestoneIndex
      : g.milestones.filter((m) => m.completed).length;
    let nextAction = g.nextAction;
    if (persistentJob) {
      if (persistentJob.state === "PAUSED_FOR_USER") {
        nextAction = "Authorization required: waiting for user confirmation";
      } else if (persistentJob.state === "BLOCKED_DEPENDENCY") {
        nextAction = "Blocked: waiting for dependency resolution";
      } else if (persistentJob.state === "RUNNING") {
        nextAction = `In progress: Milestone ${persistentJob.currentMilestoneIndex + 1}`;
      }
    }
    const blockers = persistentJob?.failureReason ? [...g.blockers, persistentJob.failureReason] : g.blockers;

    return {
      id: g.id,
      title: g.title,
      status,
      progress,
      milestoneCount: g.milestones.length,
      completedMilestones,
      nextAction,
      blockers,
    };
  });
}

function buildWatchOverviews(facts: OverviewFacts): WatchOverview[] {
  return (facts.watches ?? []).map((w) => ({
    id: w.id,
    target: w.target,
    condition: w.condition,
    source: w.source,
    status: w.status,
    cadenceMinutes: w.cadenceMinutes,
    lastChecked: w.lastChecked ?? undefined,
    lastKnownState: w.lastKnownState ?? undefined,
  }));
}

function buildActivityOverviews(facts: OverviewFacts): ActivityOverview[] {
  const activities: ActivityOverview[] = [];

  for (const r of facts.recent) {
    activities.push({
      id: `recent-${r.at}-${r.summary.slice(0, 10)}`,
      summary: r.summary,
      at: r.at,
      type: "memory",
    });
  }

  for (const run of facts.runs.slice(0, 5)) {
    const rName = facts.routines.find((rt) => rt.id === run.routineId)?.name ?? "Automation";
    const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    activities.push({
      id: `run-act-${run.routineId}-${at}`,
      summary: `Completed routine: "${rName}" (${run.status})`,
      at,
      type: "routine",
    });
  }

  for (const w of facts.watches ?? []) {
    for (const h of w.history.slice(0, 2)) {
      activities.push({
        id: `watch-act-${w.id}-${h.at}`,
        summary: h.triggered ? `Watch alert triggered: ${w.condition}` : `Checked condition: ${w.condition}`,
        at: h.at,
        type: "watch",
      });
    }
  }

  activities.sort((a, b) => b.at - a.at);
  return activities.slice(0, 15);
}

export function buildBotOverview(facts: OverviewFacts): BotOverview {
  return {
    who: {
      name: facts.bot.name,
      title: facts.bot.title,
      blurb: facts.bot.description,
      soulLead: soulLead(facts.bot.soul),
    },
    does: doesLines(facts),
    reaches: reachesLines(facts),
    wont: wontLines(facts),
    recent: facts.recent,
    setup: setupSteps(facts),
    // Enhanced Bot Command Center sections
    calendar: buildWeeklyCalendar(facts),
    upcoming: buildUpcomingItems(facts),
    memory: buildMemoryItems(facts),
    automations: buildAutomations(facts),
    abilities: buildAbilities(facts),
    goals: buildGoalOverviews(facts),
    watches: buildWatchOverviews(facts),
    activities: buildActivityOverviews(facts),
  };
}

const DEFAULT_BOT_NAMES = /^(new bot|bot|untitled)(\s*\d+)?$/i;

/** Optional customization ideas. Every step is derived from the same facts
 * the sentences use, so "done" here can never disagree with "Can reach". */
export function setupSteps(facts: OverviewFacts): SetupStep[] {
  const named = facts.bot.name.trim() !== "" && !DEFAULT_BOT_NAMES.test(facts.bot.name.trim());
  const described = facts.bot.title.trim() !== "" || facts.bot.description.trim() !== "";
  const apps = facts.connectedApps;
  const routines = facts.routines.some((routine) => routine.enabled);
  const webhooks = facts.webhooks.some((webhook) => webhook.enabled);
  const steps: SetupStep[] = [
    { id: "identity", label: "Give it a name and a role", done: named && described, section: "identity" },
    { id: "soul", label: "Write its standing instructions", done: (facts.bot.soul ?? "").trim() !== "", section: "soul" },
    { id: "folder", label: "Choose a working folder", done: Boolean(facts.bot.cwd), section: "access" },
  ];
  // Apps only count as a step when this bot could use them at all; a
  // bot on an engine without connected apps is not "missing" them.
  if (couldUseApps(facts)) {
    steps.push({
      id: "apps",
      label: "Connect the apps it needs",
      done: apps.authoritative && apps.services.length > 0,
      section: "access",
    });
  }
  steps.push({ id: "schedule", label: "Add a schedule or a trigger", done: routines || webhooks, section: "routines" });
  return steps;
}

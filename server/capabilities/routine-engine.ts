// Deep Routine Engine (Phase VI+ / Master Prompt & Deep Routine System Upgrade)
//
// Implements:
// 1. Routine Memory & Fingerprint Registry (Deduplication, Novelty, Change Detection)
// 2. Agentic Workflow Prompt Builder (Tiered Sources, Active Verification, Memory Injection)
// 3. Post-Execution Result Processor (Fingerprint persistence, Notification suppression)
// 4. Conversational Sequential Setup & Editing Coordinator (ask_user one-question-at-a-time)
// 5. Observability Telemetry Integration

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { sharedObservability } from "./observability.ts";
import type {
  Routine,
  RoutineRun,
  RoutineItemRecord,
  RoutineStateMemory,
} from "../../shared/routines.ts";

const ROUTINE_MEMORY_DIR = join(DATA_DIR, "routine-memory");

/**
 * 1. Routine Fingerprint & State Memory Registry
 * Manages persisted history, seen item fingerprints, and content snapshot hashes
 * across routine runs to prevent duplicate notifications and detect meaningful changes.
 */
export class RoutineMemoryRegistry {
  private static instance: RoutineMemoryRegistry | null = null;
  private readonly memoryDir: string;

  constructor(memoryDir = ROUTINE_MEMORY_DIR) {
    this.memoryDir = memoryDir;
    try {
      if (!existsSync(this.memoryDir)) {
        mkdirSync(this.memoryDir, { recursive: true });
      }
    } catch {}
  }

  static getInstance(): RoutineMemoryRegistry {
    if (!this.instance) {
      this.instance = new RoutineMemoryRegistry();
    }
    return this.instance;
  }

  private normalizeUrl(raw?: string): string {
    if (!raw) return "";
    try {
      const u = new URL(raw);
      u.searchParams.delete("utm_source");
      u.searchParams.delete("utm_medium");
      u.searchParams.delete("utm_campaign");
      u.searchParams.delete("utm_content");
      u.searchParams.delete("utm_term");
      u.searchParams.delete("ref");
      u.searchParams.delete("source");
      u.searchParams.delete("fbclid");
      u.searchParams.delete("gclid");
      let path = u.pathname;
      if (path.length > 1 && path.endsWith("/")) {
        path = path.slice(0, -1);
      }
      const search = u.searchParams.toString();
      return `${u.protocol}//${u.host}${path}${search ? `?${search}` : ""}`.toLowerCase();
    } catch {
      return raw.trim().toLowerCase();
    }
  }

  /** Stable hash for fingerprinting an item (job, news article, file, product) */
  computeFingerprint(item: {
    title?: string;
    url?: string;
    company?: string;
    location?: string;
    id?: string;
  }): string {
    const cleanUrl = this.normalizeUrl(item.url);
    const canonical = [
      (item.id || "").trim().toLowerCase(),
      (item.company || "").trim().toLowerCase(),
      (item.title || "").trim().toLowerCase(),
      (item.location || "").trim().toLowerCase(),
      cleanUrl,
    ].filter(Boolean).join("::");

    return createHash("sha256").update(canonical || String(Date.now())).digest("hex");
  }

  /** Compute sha256 hash of content string for change detection */
  computeContentHash(content: string): string {
    return createHash("sha256").update((content || "").trim()).digest("hex");
  }

  private getMemoryFilePath(routineId: string): string {
    return join(this.memoryDir, `${routineId}.json`);
  }

  loadMemory(routineId: string): RoutineStateMemory {
    const filePath = this.getMemoryFilePath(routineId);
    if (!existsSync(filePath)) {
      return {
        deliveredFingerprints: [],
        totalItemsFound: 0,
        totalItemsDelivered: 0,
        totalRunsCompleted: 0,
      };
    }

    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      return {
        deliveredFingerprints: Array.isArray(data.deliveredFingerprints) ? data.deliveredFingerprints : [],
        previousRunOutputSnippet: data.previousRunOutputSnippet,
        lastSnapshotHash: data.lastSnapshotHash,
        lastSnapshotContent: data.lastSnapshotContent,
        totalItemsFound: Number(data.totalItemsFound) || 0,
        totalItemsDelivered: Number(data.totalItemsDelivered) || 0,
        totalRunsCompleted: Number(data.totalRunsCompleted) || 0,
        lastVerifiedAt: data.lastVerifiedAt,
      };
    } catch {
      return {
        deliveredFingerprints: [],
        totalItemsFound: 0,
        totalItemsDelivered: 0,
        totalRunsCompleted: 0,
      };
    }
  }

  saveMemory(routineId: string, memory: RoutineStateMemory): void {
    const filePath = this.getMemoryFilePath(routineId);
    try {
      if (!existsSync(this.memoryDir)) {
        mkdirSync(this.memoryDir, { recursive: true });
      }
      // Bound stored fingerprints to 500 to keep persistence compact
      const boundedFingerprints = (memory.deliveredFingerprints || []).slice(-500);
      const toWrite = {
        ...memory,
        deliveredFingerprints: boundedFingerprints,
      };
      writeFileSync(filePath, JSON.stringify(toWrite, null, 2), "utf-8");
    } catch (e) {
      console.warn(`[RoutineMemoryRegistry] Failed to save memory for ${routineId}:`, e);
    }
  }

  /** Check if a given fingerprint was previously delivered */
  isDelivered(routineId: string, fingerprint: string): boolean {
    const mem = this.loadMemory(routineId);
    return (mem.deliveredFingerprints || []).includes(fingerprint);
  }

  /**
   * Filter a list of discovered items, returning only novel items (not seen before).
   * Attaches fingerprint and isNew flag.
   */
  filterNovelItems(routineId: string, items: Array<Partial<RoutineItemRecord>>): RoutineItemRecord[] {
    const mem = this.loadMemory(routineId);
    const seen = new Set(mem.deliveredFingerprints || []);
    const results: RoutineItemRecord[] = [];

    for (const raw of items) {
      const fp = raw.fingerprint || this.computeFingerprint({
        title: raw.title,
        url: raw.url,
        company: raw.company,
        location: raw.location,
        id: raw.id,
      });

      const isNovel = !seen.has(fp);
      results.push({
        id: raw.id || fp,
        title: raw.title || "Untitled Item",
        subtitle: raw.subtitle,
        url: raw.url,
        applicationUrl: raw.applicationUrl,
        company: raw.company,
        location: raw.location,
        sourceTier: raw.sourceTier || 2,
        sourceName: raw.sourceName,
        verified: raw.verified ?? true,
        verifiedAt: raw.verifiedAt || Date.now(),
        verificationNote: raw.verificationNote,
        snippet: raw.snippet,
        fingerprint: fp,
        isNew: isNovel,
        metadata: raw.metadata,
      });
    }

    return results;
  }

  /** Detect whether content meaningfully changed compared to last run */
  detectChange(routineId: string, currentContent: string): { changed: boolean; previousHash?: string; newHash: string } {
    const mem = this.loadMemory(routineId);
    const newHash = this.computeContentHash(currentContent);
    const previousHash = mem.lastSnapshotHash;

    const changed = previousHash ? previousHash !== newHash : true;
    return { changed, previousHash, newHash };
  }
}

/**
 * 2. Routine Execution Prompt Builder
 * Prepares the rich agentic prompt for executing a recurring routine turn.
 * Ensures the model follows strict verification, source hierarchy, deduplication,
 * and novelty rules.
 */
export class RoutineExecutionPromptBuilder {
  static buildPrompt(
    routine: Routine,
    options: {
      now?: number;
      memory?: RoutineStateMemory;
      manualRun?: boolean;
    } = {}
  ): string {
    const now = options.now || Date.now();
    const isoDate = new Date(now).toISOString();
    const mem = options.memory || RoutineMemoryRegistry.getInstance().loadMemory(routine.id);

    const parts: string[] = [];

    // Header & Run Identity
    parts.push(
      `[ROUTINE EXECUTION RUN]\n` +
      `Routine Name: "${routine.name}"\n` +
      `Routine ID: ${routine.id}\n` +
      `Timestamp: ${isoDate}\n` +
      `Trigger: ${options.manualRun ? "Manual (User Triggered Run Now)" : "Scheduled Recurrence"}`
    );

    // Primary Objective & Instructions
    const objective = routine.taskObjective || routine.workflowConfig?.taskObjective || routine.name;
    parts.push(
      `[PRIMARY OBJECTIVE]\n${objective}\n\n` +
      `[USER INSTRUCTIONS]\n${routine.prompt}`
    );

    // Workflow Constraints & Source Hierarchy
    const workflow = routine.workflowConfig;
    if (workflow) {
      const constraints: string[] = [];
      if (workflow.sourceStrategy) constraints.push(`- Source Strategy: ${workflow.sourceStrategy}`);
      if (workflow.freshnessWindowHours) constraints.push(`- Freshness Window: last ${workflow.freshnessWindowHours} hours`);
      if (workflow.minResultsThreshold) constraints.push(`- Minimum Results Threshold: ${workflow.minResultsThreshold}`);
      if (workflow.changeDetectionOnly) constraints.push(`- Mode: Change Detection Only (only notify if meaningful content changed)`);
      if (workflow.verificationRequired !== false) constraints.push(`- Active Verification: MANDATORY for every reported item`);

      if (constraints.length > 0) {
        parts.push(`[WORKFLOW CONSTRAINTS & CRITERIA]\n${constraints.join("\n")}`);
      }
    }

    // Agentic Source Hierarchy & Quality Mandate
    parts.push(
      `[SOURCE HIERARCHY & QUALITY MANDATE]\n` +
      `When gathering information from the web:\n` +
      `1. TIER 1 (Preferred / Authoritative): Official company careers pages, direct employer listings, official ATS boards (Greenhouse, Lever, Workday), and primary news publications.\n` +
      `2. TIER 2 (Secondary): Reputable platforms with direct listing/article pages (LinkedIn, Indeed, arXiv, official press releases).\n` +
      `3. TIER 3 (Discovery Only): Search engine snippets, aggregators. A search snippet is NEVER proof that an item or job is active.\n` +
      `Always attempt to inspect the actual source page before declaring an item verified.`
    );

    // Active Verification Rules
    parts.push(
      `[ACTIVE VERIFICATION & TRUTHFULNESS]\n` +
      `- Never fabricate or assume an item is active.\n` +
      `- If a job or link cannot be independently verified, explicitly mark it as: "Listing found, but active status could not be independently verified."\n` +
      `- Deduplicate results: never repeat the same opening/article across multiple aggregator listings.\n` +
      `- Prefer the canonical source URL and direct application URL whenever available.`
    );

    // Routine Memory & Novelty Check
    const recentFingerprints = (mem.deliveredFingerprints || []).slice(-30);
    if (recentFingerprints.length > 0 || mem.previousRunOutputSnippet) {
      const memLines: string[] = [
        `[ROUTINE STATE MEMORY — PREVIOUS RUN CONTEXT]`,
        `This routine has completed ${mem.totalRunsCompleted || 0} previous runs.`,
      ];

      if (mem.lastSnapshotHash) {
        memLines.push(`Previous content snapshot hash: ${mem.lastSnapshotHash}`);
      }

      if (recentFingerprints.length > 0) {
        memLines.push(
          `Known previously delivered item fingerprints (${recentFingerprints.length} most recent):\n` +
          `${recentFingerprints.slice(0, 15).join(", ")}${recentFingerprints.length > 15 ? "..." : ""}\n` +
          `RULE: Do NOT re-report items matching these fingerprints unless their status has materially changed.`
        );
      }

      if (mem.previousRunOutputSnippet) {
        memLines.push(`Previous run summary excerpt:\n${mem.previousRunOutputSnippet}`);
      }

      parts.push(memLines.join("\n"));
    }

    // Output Delivery Format
    parts.push(
      `[RESULT DELIVERY FORMAT]\n` +
      `Produce your final report clearly and concisely.\n` +
      `If you discover actionable items (jobs, news stories, research findings, or changes), present them as clean structured cards:\n` +
      `- Title / Role\n` +
      `- Company / Source / Author\n` +
      `- Location & Work Mode (Remote/Hybrid/Onsite)\n` +
      `- Key Requirements / Summary\n` +
      `- Canonical URL & Direct Link\n` +
      `- Verification Status (Verified Active / Unverified)\n\n` +
      `IMPORTANT NOTIFICATION DISCIPLINE:\n` +
      `If your search reveals NO new matches matching the user's criteria, clearly state that no new items were found. Do not invent items or send useless spam.`
    );

    return parts.join("\n\n");
  }
}

/**
 * 3. Routine Post-Execution Processor
 * Evaluates the completed output of a routine run, updates routine state memory,
 * extracts discovered/verified items, and determines whether an OS notification
 * should be dispatched or suppressed.
 */
export class RoutinePostExecutionProcessor {
  static processCompletedRun(
    routine: Routine,
    run: RoutineRun,
    options: RoutineMemoryRegistry | { memoryRegistry?: RoutineMemoryRegistry } = {}
  ): {
    itemsFound: number;
    itemsDelivered: number;
    suppressNotification: boolean;
    verificationStatus: "verified" | "unverified" | "partial";
    deliveredFingerprints: string[];
    summary: string;
  } {
    const memory = (options instanceof RoutineMemoryRegistry ? options : options?.memoryRegistry) || RoutineMemoryRegistry.getInstance();
    const output = (run.output || "").trim();

    // 1. Detect if the run produced "no new items"
    const lowerOutput = output.toLowerCase();
    const noItemsPatterns = [
      "no new items",
      "no new jobs",
      "no new job openings",
      "no new job",
      "no new openings",
      "no matching jobs found",
      "no matching jobs",
      "no new results",
      "no changes detected",
      "nothing new found",
      "0 new items",
      "0 new jobs",
      "no new matches",
    ];

    const isExplicitlyEmpty = noItemsPatterns.some((p) => lowerOutput.includes(p));

    // 2. Extract potential links / job titles / items
    const linkMatches = output.match(/https?:\/\/[^\s)\]]+/g) || [];
    const uniqueLinks = [...new Set(linkMatches)];

    // 3. Compute fingerprints for discovered items
    const newFingerprints: string[] = [];
    let itemsFound = 0;

    if (!isExplicitlyEmpty) {
      for (const link of uniqueLinks) {
        const fp = memory.computeFingerprint({ url: link, title: routine.name });
        if (!memory.isDelivered(routine.id, fp)) {
          newFingerprints.push(fp);
        }
        itemsFound++;
      }

      if (itemsFound === 0 && output.length > 50) {
        // If output is substantial text (e.g. news summary, analysis report), treat the turn output itself as an item
        const contentHash = memory.computeContentHash(output);
        if (!memory.isDelivered(routine.id, contentHash)) {
          newFingerprints.push(contentHash);
          itemsFound = 1;
        }
      }
    }

    const itemsDelivered = newFingerprints.length;

    // 4. Verification status
    let verificationStatus: "verified" | "unverified" | "partial" = "verified";
    if (lowerOutput.includes("could not be independently verified") || lowerOutput.includes("unverified")) {
      verificationStatus = itemsDelivered > 1 ? "partial" : "unverified";
    }

    // 5. Evaluate notification suppression
    // If no new items found and notifyIfEmpty is not explicitly true, suppress notification
    const notifyIfEmpty = routine.workflowConfig?.notifyIfEmpty ?? false;
    const suppressNotification = (itemsDelivered === 0 || isExplicitlyEmpty) && !notifyIfEmpty;

    // 6. Update Routine State Memory
    const currentMemory = memory.loadMemory(routine.id);
    const updatedMemory: RoutineStateMemory = {
      deliveredFingerprints: [...(currentMemory.deliveredFingerprints || []), ...newFingerprints],
      previousRunOutputSnippet: output.slice(0, 500),
      lastSnapshotHash: memory.computeContentHash(output),
      lastSnapshotContent: output.slice(0, 1000),
      totalItemsFound: (currentMemory.totalItemsFound || 0) + itemsFound,
      totalItemsDelivered: (currentMemory.totalItemsDelivered || 0) + itemsDelivered,
      totalRunsCompleted: (currentMemory.totalRunsCompleted || 0) + 1,
      lastVerifiedAt: Date.now(),
    };
    memory.saveMemory(routine.id, updatedMemory);

    // 7. Telemetry observability events
    sharedObservability.emit("ROUTINE_RUN_COMPLETED", {
      routineId: routine.id,
      runId: run.id,
      itemsFound,
      itemsDelivered,
      suppressNotification,
      verificationStatus,
    });

    if (itemsFound > 0) {
      sharedObservability.emit("ROUTINE_ITEMS_DISCOVERED", {
        routineId: routine.id,
        runId: run.id,
        itemsFound,
        itemsDelivered,
        verificationStatus,
      });
    }

    if (suppressNotification) {
      sharedObservability.emit("ROUTINE_NOTIFICATION_SUPPRESSED", {
        routineId: routine.id,
        runId: run.id,
        reason: "empty_result",
        detail: "No new items found and notifyIfEmpty is false",
      });
    } else {
      sharedObservability.emit("ROUTINE_NOTIFICATION_SENT", {
        routineId: routine.id,
        runId: run.id,
        itemsDelivered,
        notificationMode: routine.deliveryConfig?.notificationMode || "normal",
      });
    }

    const summary = isExplicitlyEmpty
      ? `Completed check: no new items discovered.`
      : itemsDelivered > 0
        ? `Delivered ${itemsDelivered} new verified item(s).`
        : `Routine run completed.`;

    return {
      itemsFound,
      itemsDelivered,
      suppressNotification,
      verificationStatus,
      deliveredFingerprints: newFingerprints,
      summary,
    };
  }
}

/**
 * 4. Routine Setup Coordinator
 * Guides the conversational sequential requirements discovery process.
 * Generates one focused question at a time using ask_user schemas.
 */
export interface RoutineSetupQuestion {
  step: number;
  totalSteps: number;
  question: string;
  header: string;
  type: "single_choice" | "multiple_choice" | "confirmation" | "free_text";
  options: Array<{ label: string; description?: string; id?: string }>;
  allowOther?: boolean;
}

export class RoutineSetupCoordinator {
  /**
   * Determine the next question in the sequential setup flow based on collected answers.
   */
  static getNextQuestion(
    userIntent: string,
    collectedAnswers: Record<string, string>
  ): RoutineSetupQuestion | null {
    const isJobIntent = /job|opening|hiring|internship|career/i.test(userIntent);
    const isNewsIntent = /news|headline|update|article|ai news/i.test(userIntent);

    // Step 1: Core Domain Scope / Target Role or Topic
    if (!collectedAnswers["domain_scope"]) {
      if (isJobIntent) {
        return {
          step: 1,
          totalSteps: 6,
          question: "What kind of jobs should I look for?",
          header: "Role Type",
          type: "single_choice",
          options: [
            { label: "Software Engineering / Backend", description: "Python, Go, Node.js, Java backend roles", id: "backend" },
            { label: "Frontend / Fullstack", description: "React, TypeScript, Mobile, Fullstack roles", id: "fullstack" },
            { label: "Data / AI / Machine Learning", description: "Data Science, LLMs, ML Engineering", id: "ai_data" },
            { label: "Internships & Entry-Level", description: "Student & fresh graduate openings", id: "entry" },
            { label: "All Engineering roles", description: "Broad engineering openings", id: "all_eng" },
          ],
          allowOther: true,
        };
      } else if (isNewsIntent) {
        return {
          step: 1,
          totalSteps: 6,
          question: "What topic should I track for news?",
          header: "Topic",
          type: "single_choice",
          options: [
            { label: "Artificial Intelligence & LLMs", description: "Major breakthroughs, labs, and models", id: "ai" },
            { label: "Tech Industry & Startups", description: "Tech companies, funding, product launches", id: "tech" },
            { label: "Software Development", description: "Frameworks, languages, open-source updates", id: "dev" },
            { label: "Science & Research", description: "Scientific discoveries and papers", id: "science" },
          ],
          allowOther: true,
        };
      } else {
        return {
          step: 1,
          totalSteps: 6,
          question: "What is the primary target or scope of this routine?",
          header: "Objective",
          type: "single_choice",
          options: [
            { label: "Monitor a webpage for changes", description: "Track content or price modifications", id: "web_monitor" },
            { label: "Daily activity summary", description: "Summarize project or conversation updates", id: "summary" },
            { label: "Periodic reminder with research", description: "Check external status and alert", id: "reminder" },
          ],
          allowOther: true,
        };
      }
    }

    // Step 2: Location / Specific Filters
    if (!collectedAnswers["filters"]) {
      if (isJobIntent) {
        return {
          step: 2,
          totalSteps: 6,
          question: "Where should I search for these openings?",
          header: "Location",
          type: "single_choice",
          options: [
            { label: "Remote + Hyderabad", description: "Both remote and Hyderabad locations", id: "remote_hyd" },
            { label: "Remote Only", description: "Anywhere remote", id: "remote_only" },
            { label: "Hyderabad Only", description: "Onsite or hybrid in Hyderabad", id: "hyd_only" },
            { label: "Any location in India", description: "Pan-India remote or onsite", id: "india" },
            { label: "Worldwide Remote", description: "Global remote roles", id: "global_remote" },
          ],
          allowOther: true,
        };
      } else if (isNewsIntent) {
        return {
          step: 2,
          totalSteps: 6,
          question: "What freshness window should I apply?",
          header: "Freshness",
          type: "single_choice",
          options: [
            { label: "Past 24 hours", description: "Only fresh stories from today", id: "24h" },
            { label: "Past 48 hours", description: "Stories from the last two days", id: "48h" },
            { label: "Past week", description: "Top stories of the week", id: "7d" },
          ],
          allowOther: false,
        };
      } else {
        return {
          step: 2,
          totalSteps: 6,
          question: "What specific criteria or threshold should trigger an alert?",
          header: "Criteria",
          type: "single_choice",
          options: [
            { label: "Any meaningful change", description: "Notify whenever content changes", id: "any_change" },
            { label: "Important updates only", description: "Filter out trivial edits", id: "important_only" },
          ],
          allowOther: true,
        };
      }
    }

    // Step 3: Recurrence Frequency
    if (!collectedAnswers["frequency"]) {
      return {
        step: 3,
        totalSteps: 6,
        question: "How often should this routine run?",
        header: "Schedule",
        type: "single_choice",
        options: [
          { label: "Every weekday (Monday–Friday)", description: "Runs on business days", id: "weekdays" },
          { label: "Every day", description: "Runs all 7 days a week", id: "daily" },
          { label: "Weekly (Every Sunday)", description: "Runs once per week", id: "weekly" },
          { label: "Every 2 days", description: "Runs every alternate day", id: "every_2_days" },
        ],
        allowOther: true,
      };
    }

    // Step 4: Time of Day
    if (!collectedAnswers["time_of_day"]) {
      return {
        step: 4,
        totalSteps: 6,
        question: "What time should it run?",
        header: "Time",
        type: "single_choice",
        options: [
          { label: "09:00 AM", description: "Morning check", id: "09:00" },
          { label: "08:00 AM", description: "Early morning check", id: "08:00" },
          { label: "12:00 PM", description: "Midday check", id: "12:00" },
          { label: "06:00 PM", description: "Evening wrap-up", id: "18:00" },
          { label: "08:00 PM", description: "Night check", id: "20:00" },
        ],
        allowOther: true,
      };
    }

    // Step 5: End Condition
    if (!collectedAnswers["end_condition"]) {
      return {
        step: 5,
        totalSteps: 6,
        question: "When should this routine stop?",
        header: "End Condition",
        type: "single_choice",
        options: [
          { label: "No end date (Run indefinitely)", description: "Keep running until paused or deleted", id: "indefinite" },
          { label: "After 30 days", description: "Stop after one month", id: "30_days" },
          { label: "After 10 successful runs", description: "Stop once 10 runs complete", id: "10_runs" },
        ],
        allowOther: true,
      };
    }

    // Step 6: Notification Mode
    if (!collectedAnswers["notification_mode"]) {
      return {
        step: 6,
        totalSteps: 6,
        question: "How should I alert you when results are found?",
        header: "Notification",
        type: "single_choice",
        options: [
          { label: "Sound + vibration", description: "Audible chime and haptic alert", id: "sound_vibrate" },
          { label: "Normal notification", description: "Standard status bar notification", id: "normal" },
          { label: "Vibrate only", description: "Silent haptic buzz", id: "vibrate" },
          { label: "Important alert", description: "High-priority heads-up banner", id: "important" },
        ],
        allowOther: false,
      };
    }

    // All steps answered
    return null;
  }

  /**
   * Determine sequential setup state and generate next question or confirmation preview.
   */
  static getNextStep(state: {
    topicOrRole?: string;
    filters?: string;
    frequency?: string;
    time?: string;
    endCondition?: string;
    deliveryMode?: string;
  }): {
    step: "topic_or_role" | "filters" | "frequency" | "time" | "end_condition" | "delivery_mode" | "confirm";
    question?: RoutineSetupQuestion;
    preview?: Partial<Routine>;
  } {
    if (!state.topicOrRole) {
      return {
        step: "topic_or_role",
        question: {
          step: 1,
          totalSteps: 6,
          header: "Topic or Role",
          question: "What topic or job role would you like this routine to track?",
          type: "single_choice",
          options: [
            { id: "ai", label: "AI and Machine Learning", description: "LLMs, research papers, model releases" },
            { id: "backend", label: "Backend Engineering", description: "Python, Go, Node.js, distributed systems" },
            { id: "fullstack", label: "Fullstack / Frontend", description: "React, TypeScript, web applications" },
            { id: "tech_news", label: "Tech Industry News", description: "Major company updates and tech breakthroughs" },
          ],
          allowOther: true,
        },
      };
    }

    if (!state.filters) {
      return {
        step: "filters",
        question: {
          step: 2,
          totalSteps: 6,
          header: "Filters & Criteria",
          question: "What specific criteria, location, or filters should apply?",
          type: "single_choice",
          options: [
            { id: "remote", label: "Remote Only", description: "Work from anywhere" },
            { id: "hyderabad", label: "Hyderabad + Remote", description: "Local openings and remote roles" },
            { id: "papers", label: "Research papers and breakthrough models", description: "High-impact academic and lab findings" },
            { id: "major_only", label: "Major publications and official sources only", description: "Tier 1 authoritative sources" },
          ],
          allowOther: true,
        },
      };
    }

    if (!state.frequency) {
      return {
        step: "frequency",
        question: {
          step: 3,
          totalSteps: 6,
          header: "Frequency",
          question: "How often should this routine run?",
          type: "single_choice",
          options: [
            { id: "daily", label: "Every day", description: "Daily morning check" },
            { id: "weekdays", label: "Every weekday (Mon-Fri)", description: "Business days only" },
            { id: "interval_3d", label: "Every 3 days", description: "Periodic pulse" },
            { id: "weekly", label: "Weekly (Every Sunday)", description: "Weekly roundup" },
          ],
          allowOther: true,
        },
      };
    }

    if (!state.time) {
      return {
        step: "time",
        question: {
          step: 4,
          totalSteps: 6,
          header: "Run Time",
          question: "What time should the routine trigger?",
          type: "single_choice",
          options: [
            { id: "08:00", label: "08:00 AM", description: "Early morning" },
            { id: "09:00", label: "09:00 AM", description: "Start of workday" },
            { id: "12:00", label: "12:00 PM", description: "Midday" },
            { id: "19:00", label: "07:00 PM", description: "Evening wrap-up" },
          ],
          allowOther: true,
        },
      };
    }

    if (!state.endCondition) {
      return {
        step: "end_condition",
        question: {
          step: 5,
          totalSteps: 6,
          header: "End Condition",
          question: "When should this routine stop?",
          type: "single_choice",
          options: [
            { id: "indefinite", label: "Run indefinitely", description: "Keep running until manually disabled" },
            { id: "30_days", label: "Stop after 30 days", description: "One month trial" },
            { id: "10_runs", label: "Stop after 10 successful runs", description: "Fixed count" },
            { id: "custom_date", label: "Specific end date", description: "Choose a target date" },
          ],
          allowOther: true,
        },
      };
    }

    if (!state.deliveryMode) {
      return {
        step: "delivery_mode",
        question: {
          step: 6,
          totalSteps: 6,
          header: "Notification Preference",
          question: "When and how should I alert you?",
          type: "single_choice",
          options: [
            { id: "on_new_items", label: "Only notify when new items are found", description: "Quietly record runs with no matches" },
            { id: "always", label: "Always notify every run", description: "Even if no new items are discovered" },
            { id: "sound_vibrate", label: "Sound + vibration for new items", description: "High-visibility alert" },
            { id: "silent", label: "Silent notification in background", description: "Check results at your convenience" },
          ],
          allowOther: false,
        },
      };
    }

    // All steps answered -> Confirmation preview
    return {
      step: "confirm",
      preview: {
        name: `${state.topicOrRole} Routine`,
        prompt: `Track ${state.topicOrRole}. Criteria: ${state.filters}.`,
        taskObjective: `Autonomous monitoring for ${state.topicOrRole}`,
        schedule: {
          type: "daily",
          time: state.time || "08:00",
          weekdays: state.frequency === "weekdays" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6],
        },
        deliveryConfig: {
          notificationMode: state.deliveryMode === "sound_vibrate" ? "sound_vibrate" : "normal",
        },
        workflowConfig: {
          verificationRequired: true,
          sourceStrategy: "primary_first",
          notifyIfEmpty: state.deliveryMode === "always",
        },
      },
    };
  }

  /**
   * Format a concise final confirmation preview after all sequential questions have been answered.
   */
  static formatPreview(
    name: string,
    answers: Record<string, string>
  ): string {
    const lines = [
      `### Routine Preview: ${name}`,
      `- **Objective**: ${answers["domain_scope"] || "General automated task"}`,
      `- **Scope / Location**: ${answers["filters"] || "Default criteria"}`,
      `- **Schedule**: ${answers["frequency"] || "Every weekday"} at ${answers["time_of_day"] || "09:00"}`,
      `- **End Policy**: ${answers["end_condition"] || "Run indefinitely"}`,
      `- **Notification Mode**: ${answers["notification_mode"] || "Sound + vibration"}`,
      `- **Active Verification**: Enforced (Tier 1 & Tier 2 verified sources only)`,
      `- **Deduplication**: Enabled (No repeated notifications for previously seen items)`,
      `- **Empty Runs**: Quietly recorded without notification spam`,
    ];
    return lines.join("\n");
  }
}

// Proactive Intelligence System Exports (Phase 19)
export {
  type ProactiveTriggerEvent,
  type ProactiveSuggestion,
  type SurfaceSuggestionOptions,
  type SuggestionEvaluationResult,
  RELEVANCE_THRESHOLD,
  FOUR_HOURS_MS,
  FORTY_EIGHT_HOURS_MS,
  ERR_SUGGESTION_SPAM_DETECTED,
  SuggestionSpamError,
  validateProactiveSuggestion,
  computeDeduplicationKey,
  ProactiveIntelligenceManager,
  sharedProactiveManager,
  detectCalendarConflict,
  detectApproachingDeadline,
  detectStaleDependency,
  detectWeatherAlert,
  publishSuggestionToAttention,
} from "../proactive-intelligence.ts";


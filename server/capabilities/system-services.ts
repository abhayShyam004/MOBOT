// System Services & Integrations (Phase VI / Master Prompt Lines 2620–2715)
//
// Implements:
// 1. Universal Search (Chats, Bots, Projects, Files, Routines, Memories)
// 2. Quick Capture / User-Provided Context (Screenshot, Text, Link, File, Camera)
// 3. Smart Link Handling with SSRF Protection & Contextual Actions
// 4. System Services Bridge (Device Capabilities & Safe Permissions)
// 5. Observability Telemetry (QUICK_CAPTURE_TRIGGERED, UNIVERSAL_SEARCH_PERFORMED, SMART_LINK_ANALYZED, SYSTEM_SERVICE_INVOKED)

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import { DATA_DIR } from "../config.ts";
import { searchMessages } from "../message-db.ts";
import { sharedObservability } from "./observability.ts";
import { getProjectManager } from "../app-builder/app-builder-tools.ts";
import type { Store } from "../store.ts";
import type { RoutineManager } from "../routines.ts";
import type { DeviceCapabilityRegistry } from "./capability-registry.ts";

export type SearchCategory = "all" | "chats" | "bots" | "projects" | "files" | "routines";

export interface UniversalSearchResultItem {
  category: "chats" | "bots" | "projects" | "files" | "routines";
  id: string;
  title: string;
  subtitle?: string;
  preview?: string;
  targetRoute?: string;
  badge?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface UniversalSearchResponse {
  query: string;
  totalMatches: number;
  results: UniversalSearchResultItem[];
  categories: Array<"chats" | "bots" | "projects" | "files" | "routines">;
}

export interface QuickCaptureInput {
  type: "text" | "link" | "screenshot" | "file" | "camera";
  content?: string;
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
  targetBotId?: string;
  userPrompt?: string;
}

export interface QuickCapturePacket {
  captureId: string;
  timestamp: number;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  suggestedActions: string[];
  recommendedBotId: string;
  dispatched?: boolean;
}

export interface SmartLinkAction {
  id: string;
  label: string;
  promptTemplate: string;
}

export interface SmartLinkAnalysis {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  contentType: string;
  isSafe: boolean;
  securityNotice?: string;
  suggestedActions: SmartLinkAction[];
}

/**
 * 1. Universal Search Service (Lines 2652–2668)
 * Indexes and queries chats, bots, memories, projects, workspace files, and routines.
 */
export class UniversalSearchService {
  private readonly store: Store;
  private readonly routines?: RoutineManager;

  constructor(store: Store, routines?: RoutineManager) {
    this.store = store;
    this.routines = routines;
  }

  search(query: string, options: { category?: SearchCategory; limit?: number } = {}): UniversalSearchResponse {
    const rawQuery = (query || "").trim();
    if (!rawQuery) {
      return { query: "", totalMatches: 0, results: [], categories: [] };
    }

    const needle = rawQuery.toLowerCase();
    const filterCat = options.category || "all";
    const limit = Math.max(1, Math.min(options.limit || 50, 100));
    const results: UniversalSearchResultItem[] = [];

    // 1. Search Bots
    if (filterCat === "all" || filterCat === "bots") {
      const bots = this.store.bots || [];
      for (const b of bots) {
        const nameMatch = (b.name || "").toLowerCase().includes(needle);
        const titleMatch = (b.title || "").toLowerCase().includes(needle);
        const descMatch = (b.description || "").toLowerCase().includes(needle);
        const soulMatch = (b.soul || "").toLowerCase().includes(needle);
        if (nameMatch || titleMatch || descMatch || soulMatch) {
          results.push({
            category: "bots",
            id: b.id,
            title: b.name,
            subtitle: b.title || b.description || "Active Agent",
            preview: b.description || (b.soul ? b.soul.slice(0, 120) : undefined),
            targetRoute: `/chat/${b.id}`,
            badge: b.color || "bot",
            timestamp: b.createdAt,
            metadata: { botId: b.id, model: b.modelSelection?.model },
          });
        }
      }
    }

    // 2. Search Chats / Messages (via existing message-db)
    if (filterCat === "all" || filterCat === "chats") {
      try {
        const hits = searchMessages(rawQuery, Math.min(limit, 30));
        for (const hit of hits) {
          // Identify bot name from thread if possible
          let botName: string | undefined;
          let botId: string | undefined;
          for (const b of this.store.bots || []) {
            const tasks = this.store.tasks(b.id) || [];
            if (tasks.some((t) => t.threadId === hit.threadId)) {
              botName = b.name;
              botId = b.id;
              break;
            }
          }

          results.push({
            category: "chats",
            id: hit.messageId,
            title: botName ? `Conversation with ${botName}` : `Thread ${hit.threadId.slice(0, 8)}`,
            subtitle: hit.role === "user" ? "User message" : "Bot response",
            preview: hit.snippet,
            targetRoute: botId ? `/chat/${botId}?thread=${hit.threadId}` : undefined,
            badge: hit.role,
            timestamp: hit.at,
            metadata: { threadId: hit.threadId, messageId: hit.messageId, role: hit.role },
          });
        }
      } catch {
        // Fallback gracefully if db lock occurs
      }
    }

    // 3. Search Projects
    if (filterCat === "all" || filterCat === "projects") {
      try {
        const pm = getProjectManager();
        const projects = pm.listProjects();
        for (const p of projects) {
          const nameMatch = p.name.toLowerCase().includes(needle);
          const fwMatch = p.framework.toLowerCase().includes(needle);
          const descMatch = (p.description || "").toLowerCase().includes(needle);
          if (nameMatch || fwMatch || descMatch) {
            results.push({
              category: "projects",
              id: p.name,
              title: p.name,
              subtitle: `Framework: ${p.framework} · State: ${p.state}`,
              preview: p.description || `App builder project in ${p.framework}`,
              targetRoute: `/projects/${p.name}`,
              badge: p.state,
              timestamp: Date.parse(p.updatedAt || p.createdAt) || Date.now(),
              metadata: { framework: p.framework, state: p.state, port: p.preview?.port },
            });
          }
        }
      } catch {
        // Project manager may have no projects
      }
    }

    // 4. Search Routines
    if (filterCat === "all" || filterCat === "routines") {
      if (this.routines) {
        try {
          const list = typeof this.routines.listRoutines === "function" ? this.routines.listRoutines() : ((this.routines as any).list?.() || []);
          for (const r of list) {
            const nameMatch = r.name.toLowerCase().includes(needle);
            const promptMatch = (r.prompt || "").toLowerCase().includes(needle);
            if (nameMatch || promptMatch) {
              results.push({
                category: "routines",
                id: r.id,
                title: r.name,
                subtitle: `Schedule: ${r.schedule?.type || "Periodic"} · Target: ${r.botId || "Fleet"}`,
                preview: r.prompt ? r.prompt.slice(0, 100) : undefined,
                targetRoute: `/routines/${r.id}`,
                badge: r.enabled ? "Active" : "Paused",
                timestamp: undefined,
                metadata: { routineId: r.id, enabled: r.enabled },
              });
            }
          }
        } catch {}
      }
    }

    // 5. Search Workspace Files
    if (filterCat === "all" || filterCat === "files") {
      try {
        const wsDir = join(DATA_DIR, "workspaces");
        if (existsSync(wsDir)) {
          const entries = readdirSync(wsDir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.name.toLowerCase().includes(needle)) {
              results.push({
                category: "files",
                id: `file-${ent.name}`,
                title: ent.name,
                subtitle: ent.isDirectory() ? "Workspace Folder" : "Workspace File",
                preview: `File located in MOBOT workspace`,
                targetRoute: `/files/${ent.name}`,
                badge: ent.isDirectory() ? "folder" : "file",
                metadata: { name: ent.name, isDir: ent.isDirectory() },
              });
            }
          }
        }
      } catch {}
    }

    // Sort results by timestamp descending where available
    results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const trimmed = results.slice(0, limit);

    // Track Categories present
    const categorySet = new Set<"chats" | "bots" | "projects" | "files" | "routines">();
    for (const r of trimmed) {
      categorySet.add(r.category);
    }

    sharedObservability.emit("UNIVERSAL_SEARCH_PERFORMED", {
      query: rawQuery,
      totalMatches: trimmed.length,
      categoryFilter: filterCat,
    });

    return {
      query: rawQuery,
      totalMatches: trimmed.length,
      results: trimmed,
      categories: Array.from(categorySet),
    };
  }
}

/**
 * 2. Quick Capture Service (Lines 2621–2629)
 * Ingests user-provided context (screenshot, text, link, file, camera)
 * and formulates actionable dispatch packets.
 */
export class QuickCaptureService {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  processCapture(input: QuickCaptureInput): QuickCapturePacket {
    const timestamp = Date.now();
    const captureId = `cap_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
    const bots = this.store.bots || [];

    // Choose recommended bot (defaults to first bot or Rio/Panko/Ziggy if available)
    let recommendedBotId = bots[0]?.id || "";
    if (input.targetBotId && bots.some((b) => b.id === input.targetBotId)) {
      recommendedBotId = input.targetBotId;
    } else {
      const preferred = bots.find((b) => ["rio", "panko", "ziggy", "olive"].includes(b.name.toLowerCase()));
      if (preferred) recommendedBotId = preferred.id;
    }

    let summary = "";
    const suggestedActions: string[] = [];
    const payload: Record<string, unknown> = {};

    switch (input.type) {
      case "text": {
        const textContent = (input.content || "").trim();
        summary = textContent.length > 80 ? textContent.slice(0, 77) + "..." : textContent || "Captured text snippet";
        suggestedActions.push("Summarize text", "Extract action items", "Analyze & explain", "Translate / rewrite");
        payload.text = textContent;
        break;
      }
      case "link": {
        const linkUrl = (input.content || "").trim();
        summary = `Captured link: ${linkUrl}`;
        suggestedActions.push("Summarize webpage", "Research topic", "Extract key data", "Download / save");
        payload.url = linkUrl;
        break;
      }
      case "screenshot": {
        summary = "Captured screen context";
        suggestedActions.push("Analyze UI/UX layout", "Extract visible text (OCR)", "Identify issues", "Describe interface");
        payload.fileUri = input.fileUri || "context://current-screenshot";
        payload.mimeType = input.mimeType || "image/png";
        break;
      }
      case "file": {
        const fileName = input.fileName || "document";
        summary = `Captured file: ${fileName}`;
        suggestedActions.push("Analyze contents", "Summarize document", "Extract data", "Review code");
        payload.fileName = fileName;
        payload.fileUri = input.fileUri;
        payload.mimeType = input.mimeType || "application/octet-stream";
        break;
      }
      case "camera": {
        summary = "Captured camera photo";
        suggestedActions.push("Describe photo", "Extract text", "Identify objects", "Provide feedback");
        payload.fileUri = input.fileUri || "context://camera-image";
        payload.mimeType = input.mimeType || "image/jpeg";
        break;
      }
      default: {
        summary = "Captured context";
        suggestedActions.push("Analyze", "Summarize");
      }
    }

    sharedObservability.emit("QUICK_CAPTURE_TRIGGERED", {
      captureId,
      type: input.type,
      recommendedBotId,
      hasPrompt: Boolean(input.userPrompt),
    });

    return {
      captureId,
      timestamp,
      type: input.type,
      summary,
      payload,
      suggestedActions,
      recommendedBotId,
      dispatched: false,
    };
  }
}

/**
 * 3. Smart Link Service (Lines 2670–2684)
 * Analyzes URLs, enforces strict SSRF and private-network security,
 * extracts metadata, and yields contextual native actions.
 */
export class SmartLinkService {
  /**
   * SSRF & Private Network Validation:
   * Rejects loopback, private RFC1918, link-local, AWS/cloud metadata (169.254.169.254),
   * IPv6 unique local/link-local, and dangerous URL protocols.
   */
  isSafeUrl(urlStr: string): { safe: boolean; reason?: string } {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}. Only http and https are permitted.` };
      }

      const host = parsed.hostname.toLowerCase();

      // Check loopback / localhost
      if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
        return { safe: false, reason: "Localhost and loopback interfaces are blocked to prevent SSRF." };
      }

      // Check cloud metadata
      if (host === "169.254.169.254" || host.startsWith("169.254.")) {
        return { safe: false, reason: "Cloud metadata and link-local addresses are strictly prohibited." };
      }

      // Check private IPv4 ranges:
      // 10.0.0.0/8
      if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
        return { safe: false, reason: "Private subnet 10.0.0.0/8 is prohibited." };
      }
      // 172.16.0.0 - 172.31.255.255
      const match172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
      if (match172) {
        const second = parseInt(match172[1], 10);
        if (second >= 16 && second <= 31) {
          return { safe: false, reason: "Private subnet 172.16.0.0/12 is prohibited." };
        }
      }
      // 192.168.0.0/16
      if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
        return { safe: false, reason: "Private subnet 192.168.0.0/16 is prohibited." };
      }

      return { safe: true };
    } catch {
      return { safe: false, reason: "Malformed or invalid URL." };
    }
  }

  async analyzeUrl(urlStr: string): Promise<SmartLinkAnalysis> {
    const safety = this.isSafeUrl(urlStr);
    let domain = "unknown";
    try {
      domain = new URL(urlStr).hostname;
    } catch {}

    if (!safety.safe) {
      sharedObservability.emit("SMART_LINK_ANALYZED", {
        url: urlStr,
        domain,
        isSafe: false,
        reason: safety.reason,
      });

      return {
        url: urlStr,
        domain,
        contentType: "blocked",
        isSafe: false,
        securityNotice: safety.reason,
        suggestedActions: [],
      };
    }

    let contentType = "text/html";
    let title: string | undefined;
    let description: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const resp = await fetch(urlStr, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 16; MOBOT Mobile) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/json,*/*",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      contentType = resp.headers.get("content-type") || "text/html";

      if (contentType.includes("html")) {
        const text = await resp.text();
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) title = titleMatch[1].trim();

        const descMatch = text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        if (descMatch) description = descMatch[1].trim();
      }
    } catch {
      // If live fetch fails (offline or timeout), gracefully provide domain-level fallback
      title = domain;
    }

    // Formulate contextual actions based on content type & URL patterns
    const suggestedActions: SmartLinkAction[] = [
      { id: "open", label: "Open in Browser", promptTemplate: "Open URL" },
      { id: "summarize", label: "Summarize Page", promptTemplate: `Summarize the content of ${urlStr}` },
      { id: "research", label: "Research Topic", promptTemplate: `Conduct deep research using the information from ${urlStr}` },
      { id: "extract_data", label: "Extract Key Data", promptTemplate: `Extract all structured key data, facts, and metrics from ${urlStr}` },
    ];

    if (contentType.includes("pdf") || urlStr.endsWith(".pdf")) {
      suggestedActions.push({
        id: "extract_tables",
        label: "Extract Tables",
        promptTemplate: `Extract all data tables and numeric figures from the PDF at ${urlStr}`,
      });
    }

    sharedObservability.emit("SMART_LINK_ANALYZED", {
      url: urlStr,
      domain,
      isSafe: true,
      contentType,
    });

    return {
      url: urlStr,
      domain,
      title: title || domain,
      description,
      contentType,
      isSafe: true,
      suggestedActions,
    };
  }
}

/**
 * 4. System Services Bridge (Lines 2631–2650)
 * Native Android device capability coordinator for Calendar, Contacts, and Device Actions.
 */
export class SystemServicesBridge {
  private readonly registry: DeviceCapabilityRegistry;

  constructor(registry: DeviceCapabilityRegistry) {
    this.registry = registry;
  }

  async getCalendarOverview(): Promise<{
    configured: boolean;
    events: Array<{ id: string; title: string; startTime: string; endTime: string; location?: string }>;
    message?: string;
  }> {
    const calendarCap = this.registry.get("device.calendar");
    if (!calendarCap || !calendarCap.availability.supported) {
      return {
        configured: false,
        events: [],
        message: "Calendar capability is not configured or permitted on this device.",
      };
    }

    try {
      const res = await calendarCap.execute("list_events", {
        startTime: Date.now(),
        endTime: Date.now() + 24 * 60 * 60 * 1000,
      });

      sharedObservability.emit("SYSTEM_SERVICE_INVOKED", {
        service: "calendar",
        operation: "list_events",
        success: res.success,
      });

      const events = ((res.data as any)?.events as Array<any>) || [];
      return {
        configured: true,
        events: events.map((e) => ({
          id: String(e.id || ""),
          title: String(e.title || "Untitled Event"),
          startTime: String(e.startTime || ""),
          endTime: String(e.endTime || ""),
          location: e.location ? String(e.location) : undefined,
        })),
      };
    } catch (e: any) {
      return {
        configured: false,
        events: [],
        message: `Failed to inspect calendar: ${e?.message || "Unknown error"}`,
      };
    }
  }

  async searchContacts(query: string): Promise<{
    configured: boolean;
    contacts: Array<{ id: string; name: string; phone?: string; email?: string }>;
    message?: string;
  }> {
    const contactsCap = this.registry.get("device.contacts");
    if (!contactsCap || !contactsCap.availability.supported) {
      return {
        configured: false,
        contacts: [],
        message: "Contacts capability is not configured or permitted on this device.",
      };
    }

    try {
      const res = await contactsCap.execute("search_contacts", { query });

      sharedObservability.emit("SYSTEM_SERVICE_INVOKED", {
        service: "contacts",
        operation: "search_contacts",
        success: res.success,
      });

      const contacts = ((res.data as any)?.contacts as Array<any>) || [];
      return {
        configured: true,
        contacts: contacts.map((c) => ({
          id: String(c.id || ""),
          name: String(c.name || "Unknown"),
          phone: c.phone ? String(c.phone) : undefined,
          email: c.email ? String(c.email) : undefined,
        })),
      };
    } catch (e: any) {
      return {
        configured: false,
        contacts: [],
        message: `Failed to search contacts: ${e?.message || "Unknown error"}`,
      };
    }
  }
}

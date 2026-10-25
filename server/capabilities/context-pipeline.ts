// Device Context Pipeline (Phase R)
//
// Ingests and bounds user-authorized device data (files, PDFs, images, calendar, contacts, URLs).
// Invariant:
// 1. The agent receives bounded, relevant context rather than dumping everything into prompt.
// 2. Extracts structured snippets with page / line citations.
// 3. Emits observability events without polluting normal chat.

import { extname } from "node:path";
import { sharedObservability } from "./observability.ts";
import { assembleMemoryForContext, MemoryStoreError } from "../memory-store.ts";

export type ContextSourceType =
  | "file"
  | "pdf"
  | "image"
  | "screenshot"
  | "camera"
  | "video"
  | "audio"
  | "url"
  | "text"
  | "calendar"
  | "contact"
  | "artifact";

export interface ContextItem {
  id: string;
  sourceType: ContextSourceType;
  title: string;
  content: string;
  metadata?: {
    path?: string;
    pageCount?: number;
    size?: number;
    url?: string;
    mimeType?: string;
    author?: string;
    createdAt?: string;
  };
}

export interface BoundedContextSnippet {
  itemId: string;
  sourceTitle: string;
  sourceType: ContextSourceType;
  citation: string; // e.g. "p. 7" or "L42-L50"
  snippet: string;
  relevanceScore: number;
}

export interface BoundedContextResult {
  query: string;
  totalCandidates: number;
  selectedSnippets: BoundedContextSnippet[];
  formattedContext: string;
  totalTokensApprox: number;
}

export class DeviceContextPipeline {
  private readonly items = new Map<string, ContextItem>();

  registerItem(item: ContextItem): void {
    this.items.set(item.id, item);
  }

  registerFile(path: string, content: string, title?: string): ContextItem {
    const ext = extname(path).toLowerCase();
    let sourceType: ContextSourceType = "file";
    if (ext === ".pdf") sourceType = "pdf";
    else if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) sourceType = "image";
    else if ([".mp4", ".mov", ".mkv"].includes(ext)) sourceType = "video";
    else if ([".mp3", ".wav", ".m4a"].includes(ext)) sourceType = "audio";

    const item: ContextItem = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sourceType,
      title: title || path.split("/").pop() || "Document",
      content,
      metadata: {
        path,
        size: Buffer.byteLength(content, "utf8"),
      },
    };

    this.registerItem(item);
    return item;
  }

  getItem(id: string): ContextItem | undefined {
    return this.items.get(id);
  }

  /**
   * Search registered items and return bounded, relevant context
   * with precise citations without dumping huge raw texts.
   */
  searchAndBoundContext(
    query: string,
    options: { maxSnippets?: number; maxCharsPerSnippet?: number; maxTotalTokens?: number } = {}
  ): BoundedContextResult {
    sharedObservability.emit("FILE_SEARCH_STARTED", { query });

    const maxSnippets = options.maxSnippets ?? 5;
    const maxChars = options.maxCharsPerSnippet ?? 400;
    const maxTokens = options.maxTotalTokens ?? 1500;

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const candidateSnippets: BoundedContextSnippet[] = [];

    for (const item of this.items.values()) {
      // Split content into paragraphs or pages
      const chunks = item.sourceType === "pdf"
        ? item.content.split(/(?=\n(?:---|===)\s*Page\s+\d+\s*(?:---|===)|\f)/i)
        : item.content.split(/\n\s*\n/);

      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx].trim();
        if (!chunk) continue;

        let score = 0;
        const lowerChunk = chunk.toLowerCase();
        for (const term of terms) {
          if (lowerChunk.includes(term)) score += 1;
        }

        if (score > 0) {
          let citation = `snippet ${idx + 1}`;
          if (item.sourceType === "pdf") {
            const pageMatch = chunk.match(/Page\s+(\d+)/i);
            citation = pageMatch ? `p. ${pageMatch[1]}` : `p. ${idx + 1}`;
          } else {
            citation = `section ${idx + 1}`;
          }

          candidateSnippets.push({
            itemId: item.id,
            sourceTitle: item.title,
            sourceType: item.sourceType,
            citation,
            snippet: chunk.length > maxChars ? chunk.slice(0, maxChars) + "..." : chunk,
            relevanceScore: score,
          });
        }
      }
    }

    // Sort by relevance score descending
    candidateSnippets.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Fallback: if query terms didn't match specific words, take leading sections from attached items
    if (candidateSnippets.length === 0) {
      for (const item of this.items.values()) {
        const chunks = item.sourceType === "pdf"
          ? item.content.split(/(?=\n(?:---|===)\s*Page\s+\d+\s*(?:---|===)|\f)/i)
          : item.content.split(/\n\s*\n/);
        for (let idx = 0; idx < Math.min(chunks.length, maxSnippets); idx++) {
          const chunk = chunks[idx].trim();
          if (!chunk) continue;
          let citation = item.sourceType === "pdf" ? `p. ${idx + 1}` : `section ${idx + 1}`;
          candidateSnippets.push({
            itemId: item.id,
            sourceTitle: item.title,
            sourceType: item.sourceType,
            citation,
            snippet: chunk.length > maxChars ? chunk.slice(0, maxChars) + "..." : chunk,
            relevanceScore: 1,
          });
        }
      }
    }

    const selected = candidateSnippets.slice(0, maxSnippets);

    // Format bounded context
    let formattedContext = "";
    let approxTokens = 0;

    for (const snip of selected) {
      const block = `[Source: ${snip.sourceTitle} (${snip.citation})]\n${snip.snippet}\n\n`;
      const blockTokens = Math.ceil(block.length / 4);
      if (approxTokens + blockTokens > maxTokens) break;
      formattedContext += block;
      approxTokens += blockTokens;
    }

    sharedObservability.emit("FILE_SEARCH_COMPLETED", {
      query,
      found: candidateSnippets.length,
      selected: selected.length,
    });

    return {
      query,
      totalCandidates: candidateSnippets.length,
      selectedSnippets: selected,
      formattedContext: formattedContext.trim(),
      totalTokensApprox: approxTokens,
    };
  }

  clear(): void {
    this.items.clear();
  }
}

// -----------------------------------------------------------------------------
// Phase 2: Dynamic Context Engine Core Types & Pipeline Implementation
// -----------------------------------------------------------------------------

export interface DynamicContextDiagnostics {
  overflowDetected: boolean;
  environmentalCompressionApplied: boolean;
  distantTurnSummarizationApplied: boolean;
  finalTokenEstimate: number;
  staleEnvironmentDetected?: boolean;
  environmentRefreshed?: boolean;
}

export interface DynamicContextFrame {
  turnId: string;
  botId: string;
  timestamp: number;
  tokenBudget: number;

  layers: {
    immediate: {
      activeConversation: Array<{
        role: "user" | "bot" | "tool";
        content: string;
      }>;

      activeDraftText?: string;

      activeAttachments: Array<{
        id: string;
        mimeType: string;
        snippet: string;
      }>;
    };

    persistent: {
      userPreferences: Record<string, string>;
      activeProjectSummary?: string;
      stableFacts: string[];
      /** Phase 6: the shared partition, still labelled as shared. */
      sharedMemory?: string[];
      /** Phase 6: this bot's private partition and only this bot's. */
      specializedMemory?: string[];
    };

    environmental: {
      deviceState: {
        batteryLevel?: number;
        isCharging?: boolean;
        networkType: "wifi" | "cellular" | "none";
      };

      activeWorkspaceRoot: string;

      openBrowserTabUrl?: string;

      activeComputerSessionId?: string;
    };
  };

  diagnostics?: DynamicContextDiagnostics;
}

export interface DeviceStateContext {
  batteryLevel?: number;
  isCharging?: boolean;
  networkType: "wifi" | "cellular" | "none";
  updatedAtMs?: number;
}

export type DeviceStateRefreshHandler = () => Promise<Partial<DeviceStateContext> | null> | Partial<DeviceStateContext> | null;

export class DeviceStateRegistry {
  private currentState: DeviceStateContext = {
    networkType: "wifi",
    updatedAtMs: Date.now(),
  };
  private refreshHandler?: DeviceStateRefreshHandler;

  registerRefreshHandler(handler: DeviceStateRefreshHandler): void {
    this.refreshHandler = handler;
  }

  getRefreshHandler(): DeviceStateRefreshHandler | undefined {
    return this.refreshHandler;
  }

  update(state: Partial<DeviceStateContext>): DeviceStateContext {
    this.currentState = {
      ...this.currentState,
      ...state,
      updatedAtMs: Date.now(),
    };
    return { ...this.currentState };
  }

  get(): DeviceStateContext {
    return { ...this.currentState };
  }

  isFresh(staleThresholdMs = 60_000, referenceTimestamp?: number): boolean {
    if (!this.currentState.updatedAtMs) return false;
    const now = referenceTimestamp ?? Date.now();
    return now - this.currentState.updatedAtMs <= staleThresholdMs;
  }

  refreshSync(): boolean {
    if (!this.refreshHandler) return false;
    try {
      const res = this.refreshHandler();
      if (res && !(res instanceof Promise)) {
        this.update(res);
        return true;
      }
    } catch {
      // Fail-closed
    }
    return false;
  }

  async refreshAsync(): Promise<boolean> {
    if (!this.refreshHandler) return false;
    try {
      const res = await this.refreshHandler();
      if (res) {
        this.update(res);
        return true;
      }
    } catch {
      // Fail-closed
    }
    return false;
  }

  clear(): void {
    this.currentState = {
      networkType: "wifi",
      updatedAtMs: Date.now(),
    };
  }
}

export const sharedDeviceStateRegistry = new DeviceStateRegistry();

/** Approximate token count helper (4 characters ~= 1 token). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Check sub-signal relevance for environmental signals. */
export function isBatteryRelevant(query?: string): boolean {
  if (!query) return false;
  return /\b(?:battery|power|charging?|charger|drain|soc)\b/i.test(query);
}

export function isNetworkRelevant(query?: string): boolean {
  if (!query) return false;
  return /\b(?:wifi|wi-fi|cellular|network|internet|offline|online|connection|disconnect|reconnect|signal)\b/i.test(query);
}

export function isBrowserRelevant(query?: string): boolean {
  if (!query) return false;
  return /\b(?:browser|webpage|page|url|tab|website|navigate|dom)\b/i.test(query);
}

export function isComputerSessionRelevant(query?: string): boolean {
  if (!query) return false;
  return /\b(?:computer session|active session|remote session|vps session)\b/i.test(query);
}

export function isWorkspaceRelevant(query?: string): boolean {
  if (!query) return false;
  return /\b(?:workspace|files?|directory|folder|disk|path|repo)\b/i.test(query);
}

export function isEnvironmentalContextRelevant(query?: string): boolean {
  if (!query) return false;
  return (
    isBatteryRelevant(query) ||
    isNetworkRelevant(query) ||
    isBrowserRelevant(query) ||
    isComputerSessionRelevant(query) ||
    isWorkspaceRelevant(query)
  );
}

export interface ContextAssemblyInput {
  turnId: string;
  botId: string;
  threadId: string;
  timestamp?: number;
  tokenBudget?: number;
  query?: string;
  customWorkspaceDir?: string;
  immediate: {
    transcript: Array<{ role: "user" | "bot" | "tool" | "assistant"; text?: string; content?: string }>;
    activeDraftText?: string;
    attachments?: Array<{ id: string; mimeType: string; title?: string; content: string }>;
  };
  persistent?: {
    userPreferences?: Record<string, string>;
    activeProjectSummary?: string;
    stableFacts?: string[];
    /** Phase 6 partitions, when the caller already resolved them. */
    sharedMemory?: string[];
    specializedMemory?: string[];
  };
  environmental?: {
    deviceState?: DeviceStateContext;
    activeWorkspaceRoot: string;
    openBrowserTabUrl?: string;
    activeComputerSessionId?: string;
    staleThresholdMs?: number;
    refreshHandler?: DeviceStateRefreshHandler;
  };
  forceIncludeEnvironmental?: boolean;
}

/**
 * Summarize distant conversation turns into a bounded concise digest.
 */
function summarizeDistantConversationTurns(
  turns: Array<{ role: "user" | "bot" | "tool"; content: string }>,
  maxChars = 200
): { role: "bot"; content: string } {
  const count = turns.length;
  const snippets = turns
    .slice(0, 3)
    .map((t) => `${t.role}: ${t.content.slice(0, 40).trim()}`)
    .join("; ");
  const text = `[Summary of earlier conversation (${count} turns): ${snippets}${turns.length > 3 ? "..." : ""}]`;
  return {
    role: "bot",
    content: text.length > maxChars ? text.slice(0, maxChars) + "...]" : text,
  };
}

/**
 * Assemble a bounded, relevance-filtered DynamicContextFrame.
 * Invariant: Immediate conversation history consumes a guaranteed minimum of 40% of the allocated context budget.
 * Invariant: Environmental context is injected only when explicitly relevant or requested.
 * Invariant: ERR_CONTEXT_OVERFLOW compresses environmental context first, then summarizes distant turns.
 * Invariant: ERR_STALE_ENVIRONMENT_STATE triggers out-of-band refresh and omits unverified live values on failure.
 */
export function assembleDynamicContextFrame(input: ContextAssemblyInput): DynamicContextFrame {
  const timestamp = input.timestamp ?? Date.now();
  // Safe positive token budget bounding (fail-closed against negative or NaN budget)
  const rawBudget = input.tokenBudget ?? 4000;
  const tokenBudget = Number.isFinite(rawBudget) && rawBudget > 0 ? Math.floor(rawBudget) : 400;

  // 1. Budget partitions
  // Invariant: Immediate conversation history consumes a guaranteed minimum of 40% of the allocated context budget
  const immediateMinBudget = Math.max(1, Math.floor(tokenBudget * 0.40));
  const persistentMaxBudget = Math.floor(tokenBudget * 0.20);
  const environmentalMaxBudget = Math.floor(tokenBudget * 0.10);
  const attachmentMaxBudget = Math.floor(tokenBudget * 0.30);

  const immediateInput = input.immediate ?? { transcript: [] };
  const rawTranscript = immediateInput.transcript ?? [];

  // Measure raw candidate tokens to detect overflow upfront
  const rawConvTokens = rawTranscript.reduce((sum, item) => {
    if (!item) return sum;
    return sum + estimateTokens((item.content ?? item.text ?? "").trim());
  }, 0);
  const rawDraftTokens = estimateTokens(immediateInput.activeDraftText || "");
  const rawAttachmentTokens = (immediateInput.attachments || []).reduce((sum, att) => {
    if (!att) return sum;
    return sum + estimateTokens(att.content || "");
  }, 0);
  const rawPersistentTokens = Object.entries(input.persistent?.userPreferences || {}).reduce((sum, [k, v]) => {
    return sum + estimateTokens(`${k}: ${v}`);
  }, 0) + (input.persistent?.stableFacts || []).reduce((sum, f) => sum + estimateTokens(f), 0) +
    estimateTokens(input.persistent?.activeProjectSummary || "");

  const totalRawTokens = rawConvTokens + rawDraftTokens + rawAttachmentTokens + rawPersistentTokens;
  let overflowDetected = totalRawTokens > tokenBudget;
  let environmentalCompressionApplied = false;
  let distantTurnSummarizationApplied = false;

  // 2. Persistent Layer Assembly (Phase 4 Structured Long-Term Memory Integration)
  let rawPreferences = input.persistent?.userPreferences ?? {};
  let rawProjectSummary = input.persistent?.activeProjectSummary;
  let rawStableFacts = input.persistent?.stableFacts ?? [];
  let rawSharedMemory = input.persistent?.sharedMemory ?? [];
  let rawSpecializedMemory = input.persistent?.specializedMemory ?? [];

  if (input.botId) {
    try {
      const mem = assembleMemoryForContext(input.botId, input.query, {
        customWorkspaceDir: input.customWorkspaceDir,
      });
      rawPreferences = { ...mem.userPreferences, ...rawPreferences };
      if (!rawProjectSummary && mem.activeProjectSummary) {
        rawProjectSummary = mem.activeProjectSummary;
      }
      if (mem.stableFacts && mem.stableFacts.length > 0) {
        rawStableFacts = [...mem.stableFacts, ...rawStableFacts];
      }
      // The partitions ride along as their own labelled layers. A bot switch
      // changes specializedMemory; sharedMemory is the same resolution for
      // every bot, which is what makes it shared rather than copied.
      if (mem.shared.length > 0) rawSharedMemory = [...mem.shared, ...rawSharedMemory];
      if (mem.specialized.length > 0) rawSpecializedMemory = [...mem.specialized, ...rawSpecializedMemory];
    } catch (error) {
      if (error instanceof MemoryStoreError) throw error;
    }
  }

  const userPreferences: Record<string, string> = {};
  let persistentTokens = 0;

  for (const [key, val] of Object.entries(rawPreferences)) {
    if (!key || typeof val !== "string") continue;
    const entryTokens = estimateTokens(`${key}: ${val}`);
    if (persistentTokens + entryTokens > persistentMaxBudget) {
      overflowDetected = true;
      break;
    }
    userPreferences[key] = val;
    persistentTokens += entryTokens;
  }

  let activeProjectSummary = rawProjectSummary;
  if (activeProjectSummary) {
    const summaryTokens = estimateTokens(activeProjectSummary);
    if (persistentTokens + summaryTokens > persistentMaxBudget) {
      overflowDetected = true;
      const allowedChars = Math.max(0, (persistentMaxBudget - persistentTokens) * 4);
      activeProjectSummary = allowedChars > 20 ? activeProjectSummary.slice(0, allowedChars) + "..." : undefined;
    }
    if (activeProjectSummary) {
      persistentTokens += estimateTokens(activeProjectSummary);
    }
  }

  const stableFacts: string[] = [];
  for (const fact of rawStableFacts) {
    if (!fact) continue;
    const factTokens = estimateTokens(fact);
    if (persistentTokens + factTokens > persistentMaxBudget) {
      overflowDetected = true;
      break;
    }
    stableFacts.push(fact);
    persistentTokens += factTokens;
  }

  // The labelled partitions share one bound with the rest of the persistent
  // layer, so a bot with a large memory cannot crowd out the conversation.
  const boundedPartition = (raw: string[]): string[] => {
    const kept: string[] = [];
    for (const line of raw) {
      if (!line || kept.includes(line)) continue;
      const lineTokens = estimateTokens(line);
      if (persistentTokens + lineTokens > persistentMaxBudget) {
        overflowDetected = true;
        break;
      }
      kept.push(line);
      persistentTokens += lineTokens;
    }
    return kept;
  };
  const sharedMemory = boundedPartition(rawSharedMemory);
  const specializedMemory = boundedPartition(rawSpecializedMemory);

  // 3. Environmental Layer Assembly (Relevance Filter + Stale Checking + Refresh)
  const isEnvRelevant = Boolean(input.forceIncludeEnvironmental) || isEnvironmentalContextRelevant(input.query);
  let deviceStateRaw = input.environmental?.deviceState ?? sharedDeviceStateRegistry.get();
  const staleThreshold = input.environmental?.staleThresholdMs ?? 60_000;
  let isStateStale = Boolean(deviceStateRaw.updatedAtMs && timestamp - deviceStateRaw.updatedAtMs > staleThreshold);
  let staleDetected = isStateStale;
  let environmentRefreshed = false;

  // Out-of-band state refresh probe (ERR_STALE_ENVIRONMENT_STATE recovery)
  if (isStateStale) {
    const refreshHandler = input.environmental?.refreshHandler ?? sharedDeviceStateRegistry.getRefreshHandler();
    if (refreshHandler) {
      try {
        const refreshResult = refreshHandler();
        if (refreshResult && !(refreshResult instanceof Promise)) {
          deviceStateRaw = {
            ...deviceStateRaw,
            ...refreshResult,
            updatedAtMs: timestamp,
          };
          sharedDeviceStateRegistry.update(refreshResult);
          isStateStale = false;
          environmentRefreshed = true;
        }
      } catch {
        // Refresh failed fail-closed
      }
    }
  }

  let deviceState: { batteryLevel?: number; isCharging?: boolean; networkType: "wifi" | "cellular" | "none" };
  let openBrowserTabUrl: string | undefined;
  let activeComputerSessionId: string | undefined;
  let activeWorkspaceRoot = input.environmental?.activeWorkspaceRoot ?? "";

  if (isEnvRelevant) {
    const batteryNeeded = Boolean(input.forceIncludeEnvironmental) || isBatteryRelevant(input.query);
    const networkNeeded = Boolean(input.forceIncludeEnvironmental) || isNetworkRelevant(input.query);
    const browserNeeded = Boolean(input.forceIncludeEnvironmental) || isBrowserRelevant(input.query);
    const computerNeeded = Boolean(input.forceIncludeEnvironmental) || isComputerSessionRelevant(input.query);
    const workspaceNeeded = Boolean(input.forceIncludeEnvironmental) || isWorkspaceRelevant(input.query);

    // If overflow detected: Stage 1 = Compress environmental context first
    if (overflowDetected) {
      environmentalCompressionApplied = true;
      // Drop optional session ID and URL when compressing
      openBrowserTabUrl = undefined;
      activeComputerSessionId = undefined;
    } else {
      openBrowserTabUrl = browserNeeded ? input.environmental?.openBrowserTabUrl : undefined;
      activeComputerSessionId = computerNeeded ? input.environmental?.activeComputerSessionId : undefined;
    }

    deviceState = {
      batteryLevel: isStateStale || !batteryNeeded ? undefined : deviceStateRaw.batteryLevel,
      isCharging: isStateStale || !batteryNeeded ? undefined : deviceStateRaw.isCharging,
      networkType: isStateStale || !networkNeeded ? "none" : (deviceStateRaw.networkType ?? "none"),
    };

    if (!workspaceNeeded && overflowDetected) {
      activeWorkspaceRoot = "";
    }
  } else {
    // Environmental context suppressed to avoid prompt bloat when not relevant
    deviceState = {
      networkType: "none",
    };
    openBrowserTabUrl = undefined;
    activeComputerSessionId = undefined;
  }

  // 4. Attachments Assembly (Bounded Snippets with Citations)
  const activeAttachments: Array<{ id: string; mimeType: string; snippet: string }> = [];
  let attachmentTokensUsed = 0;

  if (immediateInput.attachments && immediateInput.attachments.length > 0) {
    const pipeline = new DeviceContextPipeline();
    for (const att of immediateInput.attachments) {
      if (!att) continue;
      pipeline.registerFile(att.title || att.id, att.content, att.title);
    }

    const searchQuery = input.query || "summary overview document key findings";
    const bounded = pipeline.searchAndBoundContext(searchQuery, {
      maxSnippets: immediateInput.attachments.length * 2,
      maxCharsPerSnippet: 350,
      maxTotalTokens: attachmentMaxBudget,
    });

    for (const snippet of bounded.selectedSnippets) {
      const formattedSnippet = `[Source: ${snippet.sourceTitle} (${snippet.citation})]\n${snippet.snippet}`;
      const snipTokens = estimateTokens(formattedSnippet);
      if (attachmentTokensUsed + snipTokens > attachmentMaxBudget) {
        overflowDetected = true;
        break;
      }

      activeAttachments.push({
        id: snippet.itemId,
        mimeType: snippet.sourceType === "pdf" ? "application/pdf" : "text/plain",
        snippet: formattedSnippet,
      });
      attachmentTokensUsed += snipTokens;
    }
  }

  // 5. Immediate Conversation Assembly (Guaranteed Min 40% Token Allocation & Distant Turn Summarization)
  const remainingBudgetForImmediate = Math.max(
    immediateMinBudget,
    tokenBudget - persistentTokens - environmentalMaxBudget - attachmentTokensUsed
  );

  const rawItems = (immediateInput.transcript || []).filter((item) => {
    return Boolean(item && (item.content || item.text));
  });

  let immediateTokensUsed = 0;
  const reversedIncluded: Array<{ role: "user" | "bot" | "tool"; content: string }> = [];
  let omittedDistantTurns: Array<{ role: "user" | "bot" | "tool"; content: string }> = [];

  for (let i = rawItems.length - 1; i >= 0; i--) {
    const item = rawItems[i];
    if (!item) continue;
    const role: "user" | "bot" | "tool" =
      item.role === "assistant" ? "bot" : item.role === "tool" ? "tool" : "user";
    const content = (item.content ?? item.text ?? "").trim();
    if (!content) continue;

    const itemTokens = estimateTokens(content);
    if (reversedIncluded.length > 0 && immediateTokensUsed + itemTokens > remainingBudgetForImmediate) {
      // Collect omitted distant turns for summarization
      omittedDistantTurns = rawItems.slice(0, i + 1).map((m) => ({
        role: m.role === "assistant" ? "bot" : m.role === "tool" ? "tool" : "user",
        content: (m.content ?? m.text ?? "").trim(),
      }));
      overflowDetected = true;
      break;
    }

    // Tight budget single-item edge case: truncate if single item alone exceeds remaining budget
    if (reversedIncluded.length === 0 && itemTokens > remainingBudgetForImmediate) {
      const maxChars = Math.max(20, remainingBudgetForImmediate * 4);
      reversedIncluded.push({ role, content: content.slice(0, maxChars) + "..." });
      immediateTokensUsed += estimateTokens(reversedIncluded[0]?.content || "");
      break;
    }

    reversedIncluded.push({ role, content });
    immediateTokensUsed += itemTokens;
  }

  let activeConversation = reversedIncluded.reverse();

  // Stage 4: Summarize distant conversational turns if omitted turns exist
  if (omittedDistantTurns.length > 0) {
    distantTurnSummarizationApplied = true;
    const summaryItem = summarizeDistantConversationTurns(omittedDistantTurns);
    const summaryTokens = estimateTokens(summaryItem.content);
    // Make room for summary item if needed
    while (activeConversation.length > 1 && immediateTokensUsed + summaryTokens > remainingBudgetForImmediate) {
      const removed = activeConversation.shift();
      if (removed) {
        immediateTokensUsed -= estimateTokens(removed.content);
      }
    }
    activeConversation = [summaryItem, ...activeConversation];
  }

  const finalFrame: DynamicContextFrame = {
    turnId: input.turnId,
    botId: input.botId,
    timestamp,
    tokenBudget,
    layers: {
      immediate: {
        activeConversation,
        activeDraftText: immediateInput.activeDraftText?.trim() || undefined,
        activeAttachments,
      },
      persistent: {
        userPreferences,
        activeProjectSummary,
        stableFacts,
        sharedMemory,
        specializedMemory,
      },
      environmental: {
        deviceState,
        activeWorkspaceRoot,
        openBrowserTabUrl,
        activeComputerSessionId,
      },
    },
    diagnostics: {
      overflowDetected,
      environmentalCompressionApplied,
      distantTurnSummarizationApplied,
      finalTokenEstimate: estimateTokens(formatDynamicContextForPrompt({
        turnId: input.turnId,
        botId: input.botId,
        timestamp,
        tokenBudget,
        layers: {
          immediate: { activeConversation, activeDraftText: immediateInput.activeDraftText?.trim(), activeAttachments },
          persistent: { userPreferences, activeProjectSummary, stableFacts, sharedMemory, specializedMemory },
          environmental: { deviceState, activeWorkspaceRoot, openBrowserTabUrl, activeComputerSessionId },
        },
      })),
      staleEnvironmentDetected: staleDetected,
      environmentRefreshed,
    },
  };

  return finalFrame;
}

/**
 * Format a DynamicContextFrame into structured, deterministic prompt text for injection.
 * Produces zero emojis and clean section boundaries.
 */
export function formatDynamicContextForPrompt(frame: DynamicContextFrame | undefined): string {
  if (!frame) return "";

  const sections: string[] = [];

  // 1. Persistent Context
  const persistentLines: string[] = [];
  const sharedMemory = frame.layers.persistent.sharedMemory ?? [];
  const specializedMemory = frame.layers.persistent.specializedMemory ?? [];
  // A line that is already shown under its partition is not repeated in the
  // unlabelled block below: the label is the point, and the fact belongs to
  // exactly one partition.
  const alreadyLabelled = new Set([...sharedMemory, ...specializedMemory]);
  const prefs = Object.entries(frame.layers.persistent.userPreferences).filter(
    ([key, value]) => !alreadyLabelled.has(`${key}: ${value}`),
  );
  if (prefs.length > 0) {
    persistentLines.push("User Preferences:\n" + prefs.map(([k, v]) => `  - ${k}: ${v}`).join("\n"));
  }
  if (frame.layers.persistent.activeProjectSummary) {
    persistentLines.push(`Active Project: ${frame.layers.persistent.activeProjectSummary}`);
  }
  const unlabelledFacts = frame.layers.persistent.stableFacts.filter(
    (fact) => !alreadyLabelled.has(fact) && !alreadyLabelled.has(fact.replace(/^\[Prior event\] /, "")),
  );
  if (unlabelledFacts.length > 0) {
    persistentLines.push("Stable Facts:\n" + unlabelledFacts.map((f) => `  - ${f}`).join("\n"));
  }
  if (sharedMemory.length > 0) {
    persistentLines.push(
      "Shared Memory (relevant to every bot in this team):\n" + sharedMemory.map((line) => `  - ${line}`).join("\n"),
    );
  }
  if (specializedMemory.length > 0) {
    persistentLines.push(
      "Specialized Memory (private to this bot; other bots cannot read it):\n" +
        specializedMemory.map((line) => `  - ${line}`).join("\n"),
    );
  }
  if (persistentLines.length > 0) {
    sections.push("[Persistent Context]\n" + persistentLines.join("\n"));
  }

  // 2. Environmental Context (only if non-empty / relevant)
  const envLines: string[] = [];
  const dev = frame.layers.environmental.deviceState;
  const devParts: string[] = [];
  if (dev.batteryLevel !== undefined) {
    devParts.push(`Battery: ${dev.batteryLevel}%${dev.isCharging ? " (charging)" : ""}`);
  }
  if (dev.networkType && dev.networkType !== "none" && (dev.batteryLevel !== undefined || dev.networkType !== "wifi")) {
    devParts.push(`Network: ${dev.networkType}`);
  }
  if (devParts.length > 0) {
    envLines.push(`Device State: ${devParts.join(", ")}`);
  }
  if (frame.layers.environmental.activeWorkspaceRoot) {
    envLines.push(`Workspace Root: ${frame.layers.environmental.activeWorkspaceRoot}`);
  }
  if (frame.layers.environmental.openBrowserTabUrl) {
    envLines.push(`Active Browser Tab: ${frame.layers.environmental.openBrowserTabUrl}`);
  }
  if (frame.layers.environmental.activeComputerSessionId) {
    envLines.push(`Active Computer Session: ${frame.layers.environmental.activeComputerSessionId}`);
  }
  if (envLines.length > 0) {
    sections.push("[Environmental Context]\n" + envLines.join("\n"));
  }

  // 3. Active Attachments
  if (frame.layers.immediate.activeAttachments.length > 0) {
    const attachmentLines = frame.layers.immediate.activeAttachments.map(
      (att) => `Attachment [${att.id}] (${att.mimeType}):\n${att.snippet}`
    );
    sections.push("[Active Attachments Context]\n" + attachmentLines.join("\n\n"));
  }

  if (sections.length === 0) return "";

  return (
    `\n\n--- BEGIN DYNAMIC CONTEXT (turnId: ${frame.turnId}) ---\n` +
    sections.join("\n\n") +
    `\n--- END DYNAMIC CONTEXT ---`
  );
}


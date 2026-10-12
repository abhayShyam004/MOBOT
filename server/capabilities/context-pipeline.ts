// Device Context Pipeline (Phase R)
//
// Ingests and bounds user-authorized device data (files, PDFs, images, calendar, contacts, URLs).
// Invariant:
// 1. The agent receives bounded, relevant context rather than dumping everything into prompt.
// 2. Extracts structured snippets with page / line citations.
// 3. Emits observability events without polluting normal chat.

import { extname } from "node:path";
import { sharedObservability } from "./observability.ts";

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
        ? item.content.split(/(?=\n--- Page \d+ ---|\f)/)
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
            const pageMatch = chunk.match(/Page (\d+)/);
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

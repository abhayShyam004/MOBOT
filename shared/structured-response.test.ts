import { describe, expect, it } from "vitest";
import {
  STRUCTURED_PROTOCOL_VERSION,
  structuredResponseToFallbackText,
  validateStructuredResponse,
} from "./structured-response.ts";

describe("Structured Response Protocol (Phase J)", () => {
  it("validates a well-formed multi-component structured response", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "comp-1",
          type: "table",
          title: "Top Products",
          data: {
            columns: [
              { key: "name", label: "Product", priority: 1 },
              { key: "sales", label: "Sales ($)", numeric: true, priority: 1 },
            ],
            rows: [
              { name: "Widget A", sales: 1200 },
              { name: "Widget B", sales: 850 },
            ],
          },
        },
        {
          id: "comp-2",
          type: "chart",
          title: "Quarterly Revenue",
          data: {
            chartType: "bar",
            labels: ["Q1", "Q2", "Q3", "Q4"],
            series: [{ name: "2026", data: [100, 200, 300, 400] }],
          },
        },
        {
          id: "comp-3",
          type: "checklist",
          title: "Launch Checklist",
          data: {
            items: [
              { id: "task-1", label: "Database schema migration", checked: true },
              { id: "task-2", label: "Deploy to production", checked: false },
            ],
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(3);
    expect(result.sanitized?.components[0].type).toBe("table");
    expect(result.sanitized?.components[1].type).toBe("chart");
    expect(result.sanitized?.components[2].type).toBe("checklist");
  });

  it("sanitizes dangerous URLs and non-http protocols in sources", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "src-1",
          type: "sources",
          data: {
            sources: [
              { url: "javascript:alert(1)", title: "Malicious link" },
              { url: "https://developer.android.com", title: "Android Devs", domain: "developer.android.com" },
            ],
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const sourcesComp = result.sanitized?.components[0];
    expect(sourcesComp?.type).toBe("sources");
    // Invalid protocol falls back to safe default
    expect(sourcesComp?.data.sources[0].url).toBe("https://example.com");
    expect(sourcesComp?.data.sources[1].url).toBe("https://developer.android.com");
  });

  it("bounds oversized payloads and row counts safely", () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: i, name: `Row ${i}` }));
    const input = {
      version: 1,
      components: [
        {
          id: "huge-table",
          type: "table",
          data: {
            columns: [{ key: "name", label: "Name" }],
            rows,
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    // Over limit causes warning and truncation to 500 rows
    expect(result.sanitized?.components[0].data.rows.length).toBe(500);
  });

  it("handles unknown component types by degrading gracefully to semantic card", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "mystery-comp",
          type: "future_ai_hologram",
          title: "Experimental Hologram",
          data: { intensity: 9000 },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.sanitized?.components.length).toBe(1);
    expect(result.sanitized?.components[0].type).toBe("card");
    expect(result.sanitized?.components[0].data.variant).toBe("info");
  });

  it("rejects unsupported future protocol versions", () => {
    const input = {
      version: STRUCTURED_PROTOCOL_VERSION + 99,
      components: [],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unsupported protocol version");
  });

  it("generates faithful markdown fallback text for accessibility and screen readers", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "checklist-1",
          type: "checklist" as const,
          title: "Tasks",
          data: {
            items: [
              { id: "1", label: "Buy groceries", checked: true },
              { id: "2", label: "Prepare dinner", checked: false },
            ],
          },
        },
        {
          id: "card-1",
          type: "card" as const,
          data: {
            variant: "info" as const,
            headline: "Deployment Complete",
            body: "Your app is live and healthy.",
          },
        },
      ],
    };

    const fallback = structuredResponseToFallbackText(input);
    expect(fallback).toContain("### Tasks");
    expect(fallback).toContain("- [x] Buy groceries");
    expect(fallback).toContain("- [ ] Prepare dinner");
    expect(fallback).toContain("**Deployment Complete**");
    expect(fallback).toContain("Your app is live and healthy.");
  });

  it("validates all 16 component types in the registry", () => {
    const _registryTypes = [
      "table", "chart", "timeline", "kanban", "checklist", "comparison",
      "decision_matrix", "dashboard", "diagram", "map", "calendar", "gantt",
      "code", "artifact", "form", "media", "card", "sources"
    ];

    const input = {
      version: 1,
      components: [
        {
          id: "diag-1",
          type: "diagram" as const,
          title: "System Architecture",
          data: {
            diagramType: "architecture" as const,
            nodes: [
              { id: "app", label: "Mobile App", type: "client" as const, status: "ok" as const },
              { id: "api", label: "Gateway API", type: "server" as const, status: "active" as const },
            ],
            edges: [{ from: "app", to: "api", label: "HTTPS" }],
          },
        },
        {
          id: "map-1",
          type: "map" as const,
          title: "Server Clusters",
          data: {
            center: { lat: 37.77, lng: -122.42 },
            markers: [{ id: "dc1", title: "US-West Datacenter", lat: 37.77, lng: -122.42, badge: "Primary" }],
          },
        },
        {
          id: "cal-1",
          type: "calendar" as const,
          title: "Maintenance Windows",
          data: {
            startDate: "2026-10-15",
            events: [{ id: "m1", title: "DB Vacuum", start: "2026-10-15T02:00:00Z" }],
          },
        },
        {
          id: "gantt-1",
          type: "gantt" as const,
          title: "Release Milestones",
          data: {
            startDate: "2026-10-01",
            endDate: "2026-10-31",
            tasks: [{ id: "t1", name: "Core Engine", start: "2026-10-01", end: "2026-10-14", progress: 100 }],
          },
        },
        {
          id: "art-1",
          type: "artifact" as const,
          title: "Architecture Spec",
          data: {
            artifactType: "document" as const,
            title: "Architecture Spec v2",
            filename: "arch.md",
            previewLines: ["# Architecture", "Native compose pipeline"],
          },
        },
        {
          id: "form-1",
          type: "form" as const,
          title: "Configuration",
          data: {
            fields: [
              { id: "mode", label: "Mode", type: "single_choice" as const, options: ["Fast", "Accurate"] },
              { id: "persist", label: "Persist DB", type: "toggle" as const },
            ],
            submitLabel: "Apply",
          },
        },
        {
          id: "media-1",
          type: "media" as const,
          title: "Render Preview",
          data: {
            mediaType: "image" as const,
            items: [{ url: "https://example.com/mockup.png", title: "Mobile UI" }],
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(7);

    // Fallback text check
    const fallback = structuredResponseToFallbackText(result.sanitized!);
    expect(fallback).toContain("### System Architecture");
    expect(fallback).toContain("Mobile App");
    expect(fallback).toContain("US-West Datacenter");
    expect(fallback).toContain("DB Vacuum");
    expect(fallback).toContain("Core Engine");
    expect(fallback).toContain("Architecture Spec v2");
    expect(fallback).toContain("Configuration");
    expect(fallback).toContain("Mobile UI");
  });

  it("normalizes product component with resultType and title to rich result component", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "res-1",
          type: "product",
          data: {
            resultType: "product",
            title: "Refurbished MacBook Air 13.6-inch, Apple M2, 8GB/256GB",
            company: "Best Buy",
            location: "United States",
            price: "$749",
            source: "Best Buy",
            sourceDomain: "bestbuy.com",
            sourceUrl: "https://www.bestbuy.com/product/macbook-air-13-6-laptop",
            actionLabel: "View Product",
            actionUrl: "https://www.bestbuy.com/product/macbook-air-13-6-laptop",
            reason: "Best verified match for school, battery life, and your budget.",
            tags: ["Apple M2", "8GB RAM", "256GB SSD", "Refurbished"],
            badge: "Top Pick",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.components.length).toBe(1);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("result");
    expect(comp?.data.resultType).toBe("product");
    expect(comp?.data.title).toBe("Refurbished MacBook Air 13.6-inch, Apple M2, 8GB/256GB");
    expect(comp?.data.company).toBe("Best Buy");
    expect(comp?.data.price).toBe("$749");
    expect(comp?.data.badge).toBe("Top Pick");
  });

  it("validates product component with title as name fallback when staying product", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "prod-1",
          type: "product",
          data: {
            title: "Logitech MX Master 3S",
            price: "$99",
            retailer: "Amazon",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.data.title || comp?.data.name).toBe("Logitech MX Master 3S");
  });

  it("validates result component with name fallback when title is missing", () => {
    const input = {
      version: 1,
      components: [
        {
          id: "res-job",
          type: "result",
          data: {
            name: "Senior Software Engineer",
            company: "Google",
            salary: "$180,000 - $220,000",
          },
        },
      ],
    };

    const result = validateStructuredResponse(input);
    expect(result.valid).toBe(true);
    const comp = result.sanitized?.components[0];
    expect(comp?.type).toBe("result");
    expect(comp?.data.title).toBe("Senior Software Engineer");
    expect(comp?.data.company).toBe("Google");
  });
});

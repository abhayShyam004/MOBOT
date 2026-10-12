import { describe, expect, it, beforeEach } from "vitest";
import { ObservabilityBus, sharedObservability } from "./observability.ts";
import { DeviceContextPipeline } from "./context-pipeline.ts";
import { CapabilityOrchestrator } from "./orchestration.ts";

describe("Device Context Pipeline & Structured Orchestration (Phases R, S, T, U)", () => {
  beforeEach(() => {
    sharedObservability.clear();
  });

  describe("Phase U: ObservabilityBus", () => {
    it("emits and queries structured internal events without polluting normal chat", () => {
      const bus = new ObservabilityBus();
      bus.emit("STRUCTURED_RESPONSE_CREATED", { component: "table" });
      bus.emit("MEDIA_CAPABILITY_REQUESTED", { prompt: "sunset over mountains" });
      bus.emit("DEVICE_CAPABILITY_SUCCEEDED", { capability: "camera" });

      const all = bus.getEvents();
      expect(all.length).toBe(3);
      expect(all[0].type).toBe("STRUCTURED_RESPONSE_CREATED");

      const filtered = bus.getEvents({ type: "MEDIA_CAPABILITY_REQUESTED" });
      expect(filtered.length).toBe(1);
      expect(filtered[0].payload.prompt).toBe("sunset over mountains");

      const summary = bus.getMetricsSummary();
      expect(summary["STRUCTURED_RESPONSE_CREATED"]).toBe(1);
      expect(summary["MEDIA_CAPABILITY_REQUESTED"]).toBe(1);
      expect(summary["DEVICE_CAPABILITY_SUCCEEDED"]).toBe(1);
    });
  });

  describe("Phase R: DeviceContextPipeline", () => {
    it("bounds retrieved context into relevant snippets with page citations", () => {
      const pipeline = new DeviceContextPipeline();

      pipeline.registerItem({
        id: "pdf_quarterly_report",
        sourceType: "pdf",
        title: "FY2025 Financial Report.pdf",
        content: `
--- Page 1 ---
Executive Summary
Company overview and strategic priorities.

--- Page 2 ---
Financial Highlights
Total revenue grew 14% year-over-year reaching $4.2B. Operating margin expanded to 28%.

--- Page 3 ---
Risk Factors
Inflationary pressures and foreign exchange volatility.
        `,
      });

      const res = pipeline.searchAndBoundContext("revenue growth margin", { maxSnippets: 2 });
      expect(res.selectedSnippets.length).toBeGreaterThan(0);

      const hit = res.selectedSnippets[0];
      expect(hit.sourceTitle).toBe("FY2025 Financial Report.pdf");
      expect(hit.citation).toBe("p. 2");
      expect(hit.snippet).toContain("14% year-over-year");

      // Verify bounded formatted output
      expect(res.formattedContext).toContain("[Source: FY2025 Financial Report.pdf (p. 2)]");

      // Observability events were emitted
      const events = sharedObservability.getEvents();
      expect(events.some((e) => e.type === "FILE_SEARCH_STARTED")).toBe(true);
      expect(events.some((e) => e.type === "FILE_SEARCH_COMPLETED")).toBe(true);
    });
  });

  describe("Phases S & T: CapabilityOrchestrator", () => {
    it("compares resumes into structured native table with action triggers", async () => {
      const orchestrator = new CapabilityOrchestrator();
      const result = await orchestrator.compareResumes("resume");

      expect(result.intent).toBe("compare_resumes");
      expect(result.components.length).toBe(1);
      expect(result.components[0].type).toBe("table");

      const tableData = result.components[0].data as any;
      expect(tableData.headers).toContain("Document");
      expect(tableData.rows.length).toBe(3);

      // Verify actions
      expect(result.components[0].actions?.length).toBe(3);
      expect(result.components[0].actions?.[0].actionId).toBe("select_resume");

      // Verify observability events
      const events = sharedObservability.getEvents();
      expect(events.some((e) => e.type === "STRUCTURED_RESPONSE_CREATED")).toBe(true);
      expect(events.some((e) => e.type === "DEVICE_CAPABILITY_SUCCEEDED")).toBe(true);
    });

    it("extracts document data into validated native chart component", async () => {
      const orchestrator = new CapabilityOrchestrator();
      const metrics = [
        { label: "Q1", value: 120 },
        { label: "Q2", value: 155 },
        { label: "Q3", value: 180 },
        { label: "Q4", value: 210 },
      ];

      const result = await orchestrator.generateChartFromDocument("Annual Sales", metrics);
      expect(result.components[0].type).toBe("chart");
      const chartData = result.components[0].data as any;
      expect(chartData.dataPoints.length).toBe(4);
    });

    it("orchestrates media capability generation and tracks status lifecycle", async () => {
      const orchestrator = new CapabilityOrchestrator();
      const result = await orchestrator.requestMediaGeneration("cyberpunk cityscape at dusk", "image");

      expect(result.intent).toBe("generate_media");
      expect(result.components[0].type).toBe("action_card");

      const summary = sharedObservability.getMetricsSummary();
      expect(summary["MEDIA_CAPABILITY_REQUESTED"]).toBe(1);
      expect(summary["MEDIA_GENERATION_STARTED"]).toBe(1);
      expect(summary["MEDIA_GENERATION_SUCCEEDED"]).toBe(1);
    });
  });
});

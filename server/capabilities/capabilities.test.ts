import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilitiesManager } from "./capabilities-manager.ts";
import { DeviceFileManager } from "./device-files.ts";

describe("Global Specialized Capabilities (Phase K)", () => {
  it("initializes catalog with all 8 core capabilities and masked API keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "caps-test-"));
    const mgr = new CapabilitiesManager(dir);
    const list = mgr.listCapabilities();

    expect(list.length).toBe(8);
    expect(list.map((c) => c.id)).toContain("image_generation");
    expect(list.map((c) => c.id)).toContain("video_generation");
    expect(list.map((c) => c.id)).toContain("speech_tts");
    expect(list.map((c) => c.id)).toContain("vision_understanding");

    // All disabled by default with zero fake keys
    expect(list.every((c) => !c.enabled)).toBe(true);
    expect(list.every((c) => !c.hasApiKey)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("updates and persists capability configuration securely", () => {
    const dir = mkdtempSync(join(tmpdir(), "caps-test-"));
    const mgr = new CapabilitiesManager(dir);

    const updated = mgr.updateCapability("image_generation", {
      enabled: true,
      provider: "openai",
      model: "dall-e-3",
      apiKey: "sk-proj-1234567890abcdef",
    });

    expect(updated.enabled).toBe(true);
    expect(updated.hasApiKey).toBe(true);
    // Key must be masked on read
    expect(updated.apiKey).toContain("...");
    expect(updated.apiKey).not.toBe("sk-proj-1234567890abcdef");

    // Re-instantiate from storage to verify persistence
    const mgr2 = new CapabilitiesManager(dir);
    const readBack = mgr2.getCapability("image_generation");
    expect(readBack?.enabled).toBe(true);
    expect(readBack?.hasApiKey).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("truthfully rejects execution when capability is disabled or missing credentials", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caps-test-"));
    const mgr = new CapabilitiesManager(dir);

    // 1. Disabled
    const resDisabled = await mgr.executeCapability({
      capabilityId: "video_generation",
      prompt: "A neon cyborg running in rain",
    });
    expect(resDisabled.ok).toBe(false);
    expect(resDisabled.error).toContain("disabled");

    // 2. Enabled but no credentials
    mgr.updateCapability("video_generation", { enabled: true });
    const resNoKey = await mgr.executeCapability({
      capabilityId: "video_generation",
      prompt: "A neon cyborg running in rain",
    });
    expect(resNoKey.ok).toBe(false);
    expect(resNoKey.error).toContain("No API key configured");

    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes and searches files truthfully and organizes downloads safely", () => {
    const dir = mkdtempSync(join(tmpdir(), "files-test-"));
    const devMgr = new DeviceFileManager(dir);

    // Create fixture files
    const resumePath = join(dir, "Resume_2026.pdf");
    const logoPath = join(dir, "logo.png");
    writeFileSync(resumePath, "PDF content");
    writeFileSync(logoPath, "PNG content");

    // Search
    const searchResume = devMgr.searchFiles("resume");
    expect(searchResume.length).toBe(1);
    expect(searchResume[0].name).toBe("Resume_2026.pdf");
    expect(searchResume[0].category).toBe("pdf");

    // Storage Insights
    const insights = devMgr.getStorageInsights();
    expect(insights.totalFiles).toBeGreaterThanOrEqual(2);
    expect(insights.categories.pdf.count).toBe(1);
    expect(insights.categories.image.count).toBe(1);

    // Downloads Organizer
    const report = devMgr.organizeDownloads("downloads");
    expect(report.movedCount).toBe(0); // empty downloads dir

    rmSync(dir, { recursive: true, force: true });
  });
});

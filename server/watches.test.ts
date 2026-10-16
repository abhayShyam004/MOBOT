import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WatchManager } from "./watches.ts";

describe("WatchManager", () => {
  let tempDir: string;
  let file: string;
  let manager: WatchManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "watch-test-"));
    file = join(tempDir, "watches.json");
    manager = new WatchManager(file);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates, retrieves, and persists a watch condition", () => {
    const watch = manager.createWatch({
      botId: "bot-eval",
      target: "https://example.com/laptop",
      condition: "drops below ₹70,000",
      cadenceMinutes: 30,
      notificationPolicy: "on_change",
    });

    expect(watch.id).toBeDefined();
    expect(watch.status).toBe("active");
    expect(watch.cadenceMinutes).toBe(30);
    expect(watch.source).toBe("web");

    // Check persistence
    const reloaded = new WatchManager(file);
    const fetched = reloaded.getWatch(watch.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.condition).toBe("drops below ₹70,000");
  });

  it("checks a file watch and detects state change", async () => {
    const monitoredFile = join(tempDir, "monitored.txt");
    writeFileSync(monitoredFile, "initial content", "utf8");

    const watch = manager.createWatch({
      botId: "bot-eval",
      target: monitoredFile,
      condition: "content changed",
    });

    const check1 = await manager.checkWatch(watch.id);
    expect(check1?.changed).toBe(false);
    expect(check1?.currentState).toContain("sha256:");

    // Change file content
    writeFileSync(monitoredFile, "updated content with new data", "utf8");

    const check2 = await manager.checkWatch(watch.id);
    expect(check2?.changed).toBe(true);
    expect(check2?.previousState).toBe(check1?.currentState);

    // Verify history recorded
    const updated = manager.getWatch(watch.id);
    expect(updated?.history.length).toBe(2);
  });

  it("triggers condition when threshold is satisfied", async () => {
    const monitoredFile = join(tempDir, "price.txt");
    writeFileSync(monitoredFile, "Current Price: ₹65,000 in stock", "utf8");

    const watch = manager.createWatch({
      botId: "bot-eval",
      target: monitoredFile,
      condition: "price below ₹70,000",
    });

    const res = await manager.checkWatch(watch.id);
    expect(res?.triggered).toBe(true);
    const updated = manager.getWatch(watch.id);
    expect(updated?.status).toBe("triggered");
  });

  it("pauses, resumes, and deletes watches cleanly", () => {
    const watch = manager.createWatch({
      botId: "bot-eval",
      target: "https://example.com/item",
      condition: "in stock",
    });

    const paused = manager.pauseWatch(watch.id);
    expect(paused?.status).toBe("paused");

    const resumed = manager.resumeWatch(watch.id);
    expect(resumed?.status).toBe("active");

    const deleted = manager.deleteWatch(watch.id);
    expect(deleted).toBe(true);
    expect(manager.getWatch(watch.id)).toBeNull();
  });
});

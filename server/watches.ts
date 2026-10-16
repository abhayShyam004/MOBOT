import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export type WatchStatus = "active" | "paused" | "triggered" | "expired";
export type WatchSource = "web" | "browser" | "github" | "file" | "server" | "device";
export type NotificationPolicy = "always" | "on_change" | "on_threshold";

export interface WatchHistoryEntry {
  at: number;
  state: string;
  triggered?: boolean;
  note?: string;
}

export interface Watch {
  id: string;
  botId: string;
  target: string;
  condition: string;
  source: WatchSource;
  cadenceMinutes: number;
  status: WatchStatus;
  lastChecked: number | null;
  lastKnownState: string | null;
  currentState: string | null;
  notificationPolicy: NotificationPolicy;
  history: WatchHistoryEntry[];
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface CreateWatchInput {
  botId: string;
  target: string;
  condition: string;
  source?: WatchSource;
  cadenceMinutes?: number;
  notificationPolicy?: NotificationPolicy;
  expiresAt?: number;
}

export interface UpdateWatchInput {
  target?: string;
  condition?: string;
  source?: WatchSource;
  cadenceMinutes?: number;
  status?: WatchStatus;
  notificationPolicy?: NotificationPolicy;
  expiresAt?: number;
}

export interface WatchCheckResult {
  watchId: string;
  changed: boolean;
  triggered: boolean;
  previousState: string | null;
  currentState: string;
  note?: string;
}

interface WatchFile {
  version: 1;
  watches: Watch[];
}

export class WatchManager {
  private readonly file: string;
  private watches: Watch[] = [];
  private checkHandler?: (watch: Watch) => Promise<{ state: string; triggered: boolean; note?: string }>;

  constructor(file = join(DATA_DIR, "watches.json")) {
    this.file = file;
    this.load();
  }

  setCheckHandler(handler: (watch: Watch) => Promise<{ state: string; triggered: boolean; note?: string }>): void {
    this.checkHandler = handler;
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.watches = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as WatchFile;
      if (parsed && Array.isArray(parsed.watches)) {
        this.watches = parsed.watches;
      }
    } catch {
      this.watches = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: WatchFile = {
      version: 1,
      watches: this.watches,
    };
    writeFileAtomic(this.file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  listWatches(botId?: string): Watch[] {
    if (botId) {
      return this.watches.filter((w) => w.botId === botId);
    }
    return [...this.watches];
  }

  getWatch(id: string): Watch | null {
    return this.watches.find((w) => w.id === id) ?? null;
  }

  createWatch(input: CreateWatchInput): Watch {
    const now = Date.now();
    let inferredSource = input.source;
    if (!inferredSource) {
      if (input.target.startsWith("http://") || input.target.startsWith("https://")) {
        inferredSource = input.target.includes("github.com") ? "github" : "web";
      } else if (input.target.startsWith("/") || input.target.includes(".")) {
        inferredSource = "file";
      } else {
        inferredSource = "web";
      }
    }

    const watch: Watch = {
      id: randomUUID(),
      botId: input.botId,
      target: input.target,
      condition: input.condition,
      source: inferredSource,
      cadenceMinutes: Math.max(5, input.cadenceMinutes ?? 60),
      status: "active",
      lastChecked: null,
      lastKnownState: null,
      currentState: null,
      notificationPolicy: input.notificationPolicy ?? "on_change",
      history: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };

    this.watches.push(watch);
    this.save();
    return watch;
  }

  updateWatch(id: string, patch: UpdateWatchInput): Watch | null {
    const watch = this.watches.find((w) => w.id === id);
    if (!watch) return null;

    if (patch.target !== undefined) watch.target = patch.target;
    if (patch.condition !== undefined) watch.condition = patch.condition;
    if (patch.source !== undefined) watch.source = patch.source;
    if (patch.cadenceMinutes !== undefined) watch.cadenceMinutes = Math.max(5, patch.cadenceMinutes);
    if (patch.status !== undefined) watch.status = patch.status;
    if (patch.notificationPolicy !== undefined) watch.notificationPolicy = patch.notificationPolicy;
    if (patch.expiresAt !== undefined) watch.expiresAt = patch.expiresAt;

    watch.updatedAt = Date.now();
    this.save();
    return watch;
  }

  deleteWatch(id: string): boolean {
    const idx = this.watches.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    this.watches.splice(idx, 1);
    this.save();
    return true;
  }

  pauseWatch(id: string): Watch | null {
    return this.updateWatch(id, { status: "paused" });
  }

  resumeWatch(id: string): Watch | null {
    return this.updateWatch(id, { status: "active" });
  }

  async checkWatch(id: string): Promise<WatchCheckResult | null> {
    const watch = this.watches.find((w) => w.id === id);
    if (!watch) return null;

    if (watch.expiresAt && Date.now() > watch.expiresAt) {
      watch.status = "expired";
      watch.updatedAt = Date.now();
      this.save();
      return {
        watchId: watch.id,
        changed: false,
        triggered: false,
        previousState: watch.currentState,
        currentState: "expired",
        note: "Watch expired by time policy",
      };
    }

    const previousState = watch.currentState;
    let newState = "";
    let triggered = false;
    let note: string | undefined;

    if (this.checkHandler) {
      const res = await this.checkHandler(watch);
      newState = res.state;
      triggered = res.triggered;
      note = res.note;
    } else {
      // Default execution: probe target
      const res = await this.defaultProbe(watch);
      newState = res.state;
      triggered = res.triggered;
      note = res.note;
    }

    const now = Date.now();
    const changed = previousState !== null && previousState !== newState;

    watch.lastChecked = now;
    watch.lastKnownState = previousState;
    watch.currentState = newState;
    if (triggered) {
      watch.status = "triggered";
    }

    watch.history.unshift({
      at: now,
      state: newState,
      triggered,
      note,
    });
    if (watch.history.length > 50) {
      watch.history.splice(50);
    }

    watch.updatedAt = now;
    this.save();

    return {
      watchId: watch.id,
      changed,
      triggered,
      previousState,
      currentState: newState,
      note,
    };
  }

  private async defaultProbe(watch: Watch): Promise<{ state: string; triggered: boolean; note?: string }> {
    try {
      if (watch.source === "file") {
        if (!existsSync(watch.target)) {
          return { state: "missing", triggered: false, note: "File does not exist" };
        }
        const content = readFileSync(watch.target, "utf8");
        const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
        const triggered = this.evaluateCondition(content, watch.condition);
        return { state: `sha256:${hash}`, triggered, note: `File inspected, length: ${content.length}` };
      }

      if (watch.target.startsWith("http://") || watch.target.startsWith("https://")) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        try {
          const resp = await fetch(watch.target, { signal: controller.signal });
          clearTimeout(timeout);
          const text = await resp.text();
          const triggered = this.evaluateCondition(text, watch.condition, resp.status);
          const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
          return {
            state: `status:${resp.status}_hash:${hash}`,
            triggered,
            note: `HTTP ${resp.status}, size: ${text.length}`,
          };
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          return { state: "network_error", triggered: false, note: fetchErr.message };
        }
      }

      return { state: "active", triggered: false, note: "Monitored condition standing" };
    } catch (err: any) {
      return { state: "error", triggered: false, note: err.message };
    }
  }

  private evaluateCondition(content: string, condition: string, httpStatus?: number): boolean {
    const cond = condition.toLowerCase();

    // Check status condition (e.g. status != 200)
    if (httpStatus !== undefined) {
      if (cond.includes("status != 200") && httpStatus !== 200) return true;
      if (cond.includes("down") && httpStatus >= 400) return true;
    }

    // Check price condition: e.g. "drops below 70000" or "< 70000"
    const priceMatch = cond.match(/(?:below|<|under)\s*(?:₹|\$|rs\.?|inr)?\s*(\d[\d,]*)/i);
    if (priceMatch && priceMatch[1]) {
      const threshold = Number(priceMatch[1].replace(/,/g, ""));
      // Extract numbers near currency symbols in content
      const foundPrices = content.match(/(?:₹|\$|rs\.?|inr)\s*(\d[\d,]*)/gi);
      if (foundPrices) {
        for (const fp of foundPrices) {
          const num = Number(fp.replace(/[^0-9]/g, ""));
          if (num > 0 && num <= threshold) {
            return true;
          }
        }
      }
    }

    // Keyword condition
    if (cond.includes("closed") && content.toLowerCase().includes("closed")) return true;
    if (cond.includes("available") && content.toLowerCase().includes("in stock")) return true;

    return false;
  }
}

export const sharedWatchManager = new WatchManager();

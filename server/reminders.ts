import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "./atomic.ts";

export type ReminderStatus = "pending" | "delivered" | "failed" | "cancelled";

export interface ReminderRecord {
  id: string;
  botId: string;
  threadId: string;
  text: string;
  requestedAt: number;
  scheduledFor: number;
  status: ReminderStatus;
  deliveredAt?: number;
  failureReason?: string;
  idempotencyKey?: string;
  remediation?: string;
}

interface RemindersDataFile {
  version: 1;
  reminders: ReminderRecord[];
}

export interface ReminderScheduleResult {
  success: boolean;
  status: "SUCCEEDED" | "UNAVAILABLE" | "FAILED" | "UNKNOWN";
  reminder?: ReminderRecord;
  error?: {
    code: string;
    message: string;
    remediation?: string;
    alternative?: string;
  };
}

export class ReminderManager {
  private filePath: string;
  private reminders: Map<string, ReminderRecord> = new Map();
  private nowFn: () => number;
  private timerIds: Map<string, NodeJS.Timeout> = new Map();
  private mockPermissionGranted: boolean = true;
  private mockSchedulerOverride: { available: boolean; reason?: string } | null = null;
  private sendNotificationFn?: (text: string) => Promise<boolean>;
  private notificationSender?: (reminder: ReminderRecord) => Promise<boolean> | boolean;

  constructor(options?: {
    filePath?: string;
    now?: () => number;
    sendNotification?: (text: string) => Promise<boolean>;
  }) {
    this.filePath = options?.filePath || join(process.cwd(), "data", "reminders.json");
    this.nowFn = options?.now || (() => Date.now());
    this.sendNotificationFn = options?.sendNotification;
    this.load();
  }

  setClock(now: () => number): void {
    this.nowFn = now;
  }

  setFilePath(filePath: string): void {
    this.filePath = filePath;
    this.load();
  }

  reload(): void {
    this.load();
  }

  setNotificationSender(fn?: (reminder: ReminderRecord) => Promise<boolean> | boolean): void {
    this.notificationSender = fn;
  }

  dispose(): void {
    for (const timer of this.timerIds.values()) clearTimeout(timer);
    this.timerIds.clear();
  }

  setMockPermission(granted: boolean): void {
    this.mockPermissionGranted = granted;
  }

  setMockSchedulerStatus(status: { available: boolean; reason?: string } | null): void {
    this.mockSchedulerOverride = status;
  }

  checkNotificationPermission(): { granted: boolean; canRequest: boolean } {
    return {
      granted: this.mockPermissionGranted,
      canRequest: !this.mockPermissionGranted,
    };
  }

  reschedulePendingTimers(): void {
    const now = this.nowFn();
    for (const [id, rem] of this.reminders.entries()) {
      if (rem.status !== "pending") continue;
      if (this.timerIds.has(id)) continue;

      const timeoutMs = rem.scheduledFor - now;
      if (timeoutMs <= 0) {
        queueMicrotask(() => {
          void this.triggerReminder(id);
        });
      } else if (timeoutMs <= 24 * 60 * 60 * 1000) {
        const timer = setTimeout(() => {
          void this.triggerReminder(id);
        }, timeoutMs);
        this.timerIds.set(id, timer);
      }
    }
  }

  private load(): void {
    for (const timer of this.timerIds.values()) clearTimeout(timer);
    this.timerIds.clear();
    this.reminders.clear();
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed: RemindersDataFile = JSON.parse(raw);
      if (parsed.version === 1 && Array.isArray(parsed.reminders)) {
        for (const rem of parsed.reminders) {
          if (rem && typeof rem.id === "string") {
            this.reminders.set(rem.id, rem);
          }
        }
      }
    } catch {
      // Ignore corrupt file on load
    }
    this.reschedulePendingTimers();
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const payload: RemindersDataFile = {
        version: 1,
        reminders: Array.from(this.reminders.values()),
      };
      writeFileAtomic(this.filePath, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error("[ReminderManager] Failed to persist reminders:", err);
    }
  }

  async schedule(params: {
    botId: string;
    threadId: string;
    text: string;
    delayMs?: number;
    targetInstant?: number;
  }): Promise<ReminderScheduleResult> {
    // 1. Check scheduler availability
    if (this.mockSchedulerOverride !== null && !this.mockSchedulerOverride.available) {
      return {
        success: false,
        status: "UNAVAILABLE",
        error: {
          code: "ERR_SCHEDULER_UNAVAILABLE",
          message: this.mockSchedulerOverride.reason || "Device scheduler service is unavailable",
          remediation: "Check companion app status and restart the background host service",
          alternative: "Schedule a calendar call or alarm",
        },
      };
    }

    // 2. Check notification permission
    const perm = this.checkNotificationPermission();
    if (!perm.granted) {
      return {
        success: false,
        status: "UNAVAILABLE",
        error: {
          code: "ERR_NOTIFICATION_PERMISSION_DENIED",
          message: "Notification permission is not granted on this device",
          remediation: "Open Android Settings > Apps > OpenMausBot Companion > Notifications and allow notifications",
          alternative: "Keep this conversation open to receive in-chat updates",
        },
      };
    }

    const now = this.nowFn();
    const delay = params.delayMs !== undefined ? params.delayMs : 5 * 60 * 1000;
    const scheduledFor = params.targetInstant !== undefined ? params.targetInstant : now + delay;

    if (scheduledFor <= now) {
      return {
        success: false,
        status: "FAILED",
        error: {
          code: "ERR_PAST_TARGET_TIME",
          message: "The requested reminder time is already in the past",
          remediation: "Specify a future time (e.g. 5 minutes from now)",
        },
      };
    }

    // Deduplication check: same bot, thread, text, and within 60s of scheduledFor
    const idempotencyKey = `${params.botId}:${params.threadId}:${params.text.trim().toLowerCase()}:${Math.round(scheduledFor / 60000)}`;
    for (const existing of this.reminders.values()) {
      if (existing.status === "pending" && existing.idempotencyKey === idempotencyKey) {
        return {
          success: true,
          status: "SUCCEEDED",
          reminder: existing,
        };
      }
    }

    const id = `rem-${randomUUID()}`;
    const record: ReminderRecord = {
      id,
      botId: params.botId,
      threadId: params.threadId,
      text: params.text,
      requestedAt: now,
      scheduledFor,
      status: "pending",
      idempotencyKey,
    };

    this.reminders.set(id, record);
    this.save();

    // Set memory timer if within 24 hours
    const timeoutMs = scheduledFor - now;
    if (timeoutMs > 0 && timeoutMs <= 24 * 60 * 60 * 1000) {
      const timer = setTimeout(() => {
        void this.triggerReminder(id);
      }, timeoutMs);
      this.timerIds.set(id, timer);
    }

    return {
      success: true,
      status: "SUCCEEDED",
      reminder: record,
    };
  }

  async triggerReminder(id: string): Promise<boolean> {
    const rem = this.reminders.get(id);
    if (!rem || rem.status !== "pending") return false;

    try {
      if (this.notificationSender) {
        const ok = await this.notificationSender(rem);
        if (!ok) {
          rem.status = "failed";
          rem.failureReason = "Notification post rejected by system";
          this.save();
          return false;
        }
      } else if (this.sendNotificationFn) {
        const ok = await this.sendNotificationFn(rem.text);
        if (!ok) {
          rem.status = "failed";
          rem.failureReason = "Notification post rejected by system";
          this.save();
          return false;
        }
      }
      rem.status = "delivered";
      rem.deliveredAt = this.nowFn();
      this.save();
      return true;
    } catch (err: unknown) {
      rem.status = "failed";
      rem.failureReason = err instanceof Error ? err.message : String(err);
      this.save();
      return false;
    } finally {
      this.timerIds.delete(id);
    }
  }

  async deliverDueReminders(nowOverride?: number): Promise<number> {
    const now = nowOverride !== undefined ? nowOverride : this.nowFn();
    let deliveredCount = 0;
    for (const [id, rem] of this.reminders.entries()) {
      if (rem.status === "pending" && rem.scheduledFor <= now) {
        const ok = await this.triggerReminder(id);
        if (ok) deliveredCount++;
      }
    }
    return deliveredCount;
  }

  list(botId?: string, threadId?: string): ReminderRecord[] {
    let list = Array.from(this.reminders.values());
    if (botId) list = list.filter((r) => r.botId === botId);
    if (threadId) list = list.filter((r) => r.threadId === threadId);
    return list.sort((a, b) => a.scheduledFor - b.scheduledFor);
  }

  get(id: string): ReminderRecord | undefined {
    return this.reminders.get(id);
  }

  cancel(id: string): boolean {
    const rem = this.reminders.get(id);
    if (!rem || rem.status !== "pending") return false;
    rem.status = "cancelled";
    const timer = this.timerIds.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timerIds.delete(id);
    }
    this.save();
    return true;
  }

  clear(): void {
    for (const timer of this.timerIds.values()) clearTimeout(timer);
    this.timerIds.clear();
    this.reminders.clear();
    this.save();
  }
}

export const defaultReminderManager = new ReminderManager();

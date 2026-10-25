import { existsSync } from "node:fs";
import type { ActionResultReceipt, ActionResultStatus } from "./types.ts";

/** In-memory store of action receipts keyed by threadId and turnId */
const receiptsByThread = new Map<string, ActionResultReceipt[]>();

export function recordActionReceipt(receipt: ActionResultReceipt): ActionResultReceipt {
  const receipts = receiptsByThread.get(receipt.threadId || "global") || [];
  receipts.push(receipt);
  receiptsByThread.set(receipt.threadId || "global", receipts);
  return receipt;
}

export function getActionReceipts(threadId: string, turnId?: string): ActionResultReceipt[] {
  const all = receiptsByThread.get(threadId) || [];
  if (turnId) {
    return all.filter((r) => !r.turnId || r.turnId === turnId);
  }
  return all;
}

export function getLatestReceipt(
  threadId: string,
  actionType?: string,
  turnId?: string,
): ActionResultReceipt | undefined {
  const receipts = getActionReceipts(threadId, turnId);
  if (!actionType) return receipts[receipts.length - 1];
  return receipts.slice().reverse().find((r) => r.actionType === actionType || r.actionType.startsWith(actionType));
}

export function clearActionReceipts(threadId?: string): void {
  if (threadId) {
    receiptsByThread.delete(threadId);
  } else {
    receiptsByThread.clear();
  }
}

/** Check whether live phone control driver is operational for the current session */
export interface PhoneControlStatus {
  operational: boolean;
  driverPort?: string;
  reason?: string;
  supportedActions: string[];
}

let mockDriverOverride: { operational: boolean; reason?: string } | null = null;

export function setMockPhoneDriverStatus(override: { operational: boolean; reason?: string } | null): void {
  mockDriverOverride = override;
}

export function checkLivePhoneControlAvailability(driverPort?: string): PhoneControlStatus {
  if (mockDriverOverride !== null) {
    return {
      operational: mockDriverOverride.operational,
      driverPort,
      reason: mockDriverOverride.reason,
      supportedActions: mockDriverOverride.operational ? ["take_screenshot", "open_app"] : [],
    };
  }

  // 1. Native in-app Phone Driver (Android host loopback)
  const nativePort = driverPort || process.env.PH_DRIVER_PORT;
  if (nativePort && Number(nativePort) > 0) {
    return {
      operational: true,
      driverPort: String(nativePort),
      reason: "Native Android Phone Driver is configured via in-app loopback",
      supportedActions: ["take_screenshot", "open_app", "read_screen", "tap", "type_text", "scroll", "press_key"],
    };
  }

  // 2. Physical USB ADB phone driver
  if (process.env.OMB_PHONE_DRIVER_ACTIVE === "1") {
    return {
      operational: true,
      driverPort: driverPort || "adb-usb",
      reason: "Physical USB ADB phone driver is connected and operational",
      supportedActions: ["take_screenshot", "open_app", "read_screen", "tap", "type_text", "swipe"],
    };
  }

  // 3. AT_DRIVER_PORT from environment or param
  const port = process.env.AT_DRIVER_PORT;
  if (!port) {
    return {
      operational: false,
      reason: "Device automation driver port is not configured",
      supportedActions: [],
    };
  }

  return {
    operational: false, // Default to false unless explicitly connected/healthy
    driverPort: port,
    reason: "Phone control driver is offline / accessibility service not enabled for UI automation",
    supportedActions: [],
  };
}

/** Patterns indicating assistant claim of action success */
const CALENDAR_SUCCESS_PATTERNS = [
  /\b(?:i(?:'ve| have)?\s+(?:successfully\s+)?(?:scheduled|created|added))\b.*?\b(?:meeting|event|calendar|sync)\b/i,
  /\b(?:event|meeting)\b.*?\b(?:has been|is|was)(?:\s+\w+)?\s+(?:scheduled|created|added)\b/i,
  /\bcalendar\b.*?\bevent\s+(?:successfully\s+)?created\b/i,
  /\b(?:scheduled|created|added)\b.*?\b(?:calendar|meeting|event)\b/i,
];

const PHONE_ACCESS_CLAIM_PATTERNS = [
  /\byes,?\s+(?:i can\s+)?(?:access|control)\s+(?:your\s+)?phone\b/i,
  /\bi can\s+(?:tap|type|open apps|take screenshots|control your phone)\b/i,
  /\bi(?:'ve| have)?\s+(?:opened|launched)\s+whatsapp\b/i,
  /\bi(?:'ve| have)?\s+(?:taken|captured)\s+(?:a\s+)?screenshot\b/i,
  /\bhere(?:'s| is)\s+(?:the|your)\s+screenshot\b/i,
  /\bcopied\b.*?\bwhatsapp\b/i,
];

const REMINDER_SUCCESS_PATTERNS = [
  /\b(?:i(?:'ve| have)?\s+(?:set|scheduled|delivered))\b.*?\breminder\b/i,
  /\breminder\b.*?\b(?:is set|has been set|scheduled for|delivered)\b/i,
  /\bi will remind you\b/i,
];

export interface TruthfulnessCheckResult {
  text: string;
  corrected: boolean;
  violations: string[];
  status: ActionResultStatus;
}

/**
 * Enforces action-result truthfulness on generated assistant text.
 * Prevents assistant text from claiming that external mutations succeeded
 * without an authoritative SUCCEEDED receipt and verified evidence.
 */
export function verifyAndEnforceTurnTruthfulness(options: {
  threadId: string;
  turnId?: string;
  assistantText: string;
  userText?: string;
}): TruthfulnessCheckResult {
  const { threadId, turnId, assistantText } = options;
  const violations: string[] = [];
  let correctedText = assistantText;
  let dominantStatus: ActionResultStatus = "SUCCEEDED";

  // 1. Google Calendar Truthfulness Check
  const claimsCalendarSuccess = CALENDAR_SUCCESS_PATTERNS.some((pat) => pat.test(assistantText));
  if (claimsCalendarSuccess) {
    const calendarReceipt = getLatestReceipt(threadId, "calendar.create_event", turnId);
    if (!calendarReceipt || calendarReceipt.status !== "SUCCEEDED") {
      const status: ActionResultStatus = calendarReceipt ? calendarReceipt.status : "NOT_ATTEMPTED";
      dominantStatus = status;
      violations.push(`Calendar false-success detected: claimed event creation under status ${status}`);

      if (status === "UNAVAILABLE") {
        correctedText =
          "Google Calendar is not currently connected. To schedule this meeting, please connect your Google Calendar account using the connection card below. No event has been created yet.";
      } else if (status === "FAILED") {
        const errorMsg = calendarReceipt?.error?.message || "provider rejected event creation";
        correctedText = `Unable to schedule the meeting on Google Calendar: ${errorMsg}. Please try again or check your account permissions.`;
      } else if (status === "UNKNOWN") {
        correctedText =
          "The calendar event creation request timed out and its final status could not be verified. Please check your Google Calendar directly before trying again to avoid duplicate events.";
      } else {
        // NOT_ATTEMPTED
        correctedText =
          "I have not scheduled this meeting yet because Google Calendar is not connected to this bot. Please connect Google Calendar to allow event scheduling.";
      }
    } else {
      // Receipt says SUCCEEDED: verify evidence (must have trustworthy provider resourceId, never manufactured)
      const resourceId = calendarReceipt.evidence?.resourceId;
      if (!resourceId || typeof resourceId !== "string" || resourceId.startsWith("cal_evt_") || resourceId.length < 5) {
        violations.push("Calendar success claimed without verified provider resourceId evidence");
        correctedText =
          "The calendar event operation was requested, but no verified event confirmation was returned by the provider.";
        dominantStatus = "UNKNOWN";
      }
    }
  }

  // 2. Phone Control Truthfulness Check
  const claimsPhoneAccess = PHONE_ACCESS_CLAIM_PATTERNS.some((pat) => pat.test(assistantText));
  if (claimsPhoneAccess) {
    const phoneReceipt = getLatestReceipt(threadId, "device.phone_control", turnId);
    const driverStatus = checkLivePhoneControlAvailability();

    // Check general capability claim ("Can you access my phone?")
    const isGeneralCapabilityClaim =
      /\byes,?\s+(?:i can\s+)?(?:access|control)\s+(?:your\s+)?phone\b/i.test(assistantText) ||
      /\bi can\s+(?:tap|type|open apps|take screenshots|control your phone)\b/i.test(assistantText);

    if (isGeneralCapabilityClaim) {
      if (!driverStatus.operational) {
        violations.push("Phone control access claimed while driver is offline");
        dominantStatus = "UNAVAILABLE";
        correctedText =
          `I cannot currently access or control your phone. Phone control is unavailable in this session (${driverStatus.reason || "automation driver offline"}). I cannot tap, type, inspect other apps, or automate device actions without active driver support.`;
      }
    } else if (/whatsapp|screenshot/i.test(assistantText)) {
      if (!phoneReceipt || phoneReceipt.status !== "SUCCEEDED") {
        const status: ActionResultStatus = phoneReceipt ? phoneReceipt.status : (driverStatus.operational ? "NOT_ATTEMPTED" : "UNAVAILABLE");
        dominantStatus = status;
        violations.push(`Phone action false-success detected: claimed action under status ${status}`);

        if (status === "UNAVAILABLE") {
          correctedText =
            `Phone control is currently unavailable (${driverStatus.reason || "driver offline"}). I cannot open WhatsApp, inspect conversations, or capture screenshots in this session.`;
        } else if (status === "FAILED") {
          const errorMsg = phoneReceipt?.error?.message || "device action failed";
          correctedText = `Phone action failed: ${errorMsg}. The requested step could not be completed.`;
        } else {
          correctedText =
            "I could not complete the phone control request because the required device automation driver is not available in this session.";
        }
      } else {
        // Receipt is SUCCEEDED: if screenshot claimed, verify artifact exists on disk
        if (/screenshot/i.test(assistantText)) {
          const path = phoneReceipt.evidence?.artifactPath;
          if (!path || !existsSync(path)) {
            violations.push("Screenshot claimed but artifact file does not exist on disk");
            correctedText = "Screenshot capture failed: no valid screenshot file was generated.";
            dominantStatus = "FAILED";
          }
        }
      }
    }
  }

  // 3. Reminder Scheduling Truthfulness Check
  const claimsReminderSuccess = REMINDER_SUCCESS_PATTERNS.some((pat) => pat.test(assistantText));
  if (claimsReminderSuccess) {
    const reminderReceipt = getLatestReceipt(threadId, "reminder.schedule", turnId);
    if (!reminderReceipt || reminderReceipt.status !== "SUCCEEDED") {
      const status: ActionResultStatus = reminderReceipt ? reminderReceipt.status : "NOT_ATTEMPTED";
      dominantStatus = status;
      violations.push(`Reminder false-success detected: claimed reminder under status ${status}`);

      if (status === "UNAVAILABLE") {
        const reason = reminderReceipt?.error?.message || "scheduler service unavailable";
        correctedText =
          `I cannot schedule this reminder: ${reason}. Notification permissions may be disabled. You can grant notification permissions in Android Settings or schedule a calendar call instead.`;
      } else if (status === "FAILED") {
        const errorMsg = reminderReceipt?.error?.message || "scheduling failed";
        correctedText = `Unable to set reminder: ${errorMsg}.`;
      } else if (status === "UNKNOWN") {
        correctedText =
          "The reminder request was accepted but confirmation could not be verified. Please check your active reminders list.";
      } else {
        correctedText =
          "I have not set this reminder because the scheduler capability is not available. Supported alternative: use an Android system alarm or calendar event.";
      }
    } else {
      // Must not claim delivery when status is merely scheduled!
      if (/\bdelivered\b|\bi have notified you\b/i.test(assistantText)) {
        violations.push("Claimed notification delivery before scheduled target time");
        correctedText = `Reminder scheduled for ${reminderReceipt.evidence?.metadata?.scheduledForFormatted || "the requested time"}. It will be delivered when due.`;
      }
    }
  }

  return {
    text: correctedText,
    corrected: violations.length > 0,
    violations,
    status: dominantStatus,
  };
}

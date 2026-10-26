/**
 * MOBOT Reach: Native Call-Like Reminders & Dependable Alarms (Phase Reach).
 *
 * Provides OS-owned, reliable scheduling that rings alarms and presents full-screen
 * call-like reminders with screen off, app interface closed, device in Doze,
 * and independently of the Node.js agent runtime.
 */

import type {
  DeviceCapability,
  CapabilityResult,
  CapabilityContext,
  CapabilityHealthStatus,
  OperationSchema,
} from './types.ts';
import { randomUUID } from 'node:crypto';

export interface ReachEventDto {
  id: string;
  type: 'call_reminder' | 'alarm';
  title: string;
  message: string;
  triggerTimeMs: number;
  timezone: string;
  recurrence?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  state: 'scheduled' | 'ringing' | 'answered' | 'snoozed' | 'dismissed' | 'completed' | 'cancelled' | 'missed';
  snoozeMinutes: number;
  snoozeCount: number;
}

/**
 * Resolves natural language expressions, ISO timestamps, and relative offsets
 * into an absolute epoch millisecond timestamp.
 */
export function parseReachTriggerTime(
  input: string | number,
  nowMs: number = Date.now(),
  timezone?: string
): number {
  if (typeof input === 'number') {
    if (input < 100000000000) {
      // Input in seconds instead of ms
      input = input * 1000;
    }
    if (input < nowMs - 10000) {
      throw new Error(`Invalid trigger time: ${new Date(input).toISOString()} is in the past.`);
    }
    return Math.round(input);
  }

  const raw = String(input).trim().toLowerCase();

  // 1. Direct number string
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    return parseReachTriggerTime(num, nowMs, timezone);
  }

  // 2. Relative offsets: "in 10 minutes", "in 25 mins", "in 1 hour", "in 45 seconds"
  const relMatch = raw.match(/^in\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (relMatch) {
    const val = parseFloat(relMatch[1]!);
    const unit = relMatch[2]!;
    let multiplier = 60 * 1000;
    if (unit.startsWith('s')) multiplier = 1000;
    else if (unit.startsWith('h')) multiplier = 60 * 60 * 1000;
    else if (unit.startsWith('d')) multiplier = 24 * 60 * 60 * 1000;
    return nowMs + Math.round(val * multiplier);
  }

  if (raw === 'in half an hour') {
    return nowMs + 30 * 60 * 1000;
  }
  if (raw === 'in an hour') {
    return nowMs + 60 * 60 * 1000;
  }

  // 3. Full ISO / Date string check
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsedIso = Date.parse(raw);
    if (!isNaN(parsedIso)) {
      if (parsedIso < nowMs - 10000) {
        throw new Error(`Invalid trigger time: ${raw} is in the past.`);
      }
      return parsedIso;
    }
  }

  // 4. Absolute clock time: "at 6:30 am", "at 6:30 am tomorrow", "tomorrow at 7:00 am", "tomorrow 6:30am"
  const timeRegex = /(?:tomorrow\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+tomorrow)?/i;
  const timeMatch = raw.match(timeRegex);
  if (timeMatch && (raw.includes('at') || raw.includes('am') || raw.includes('pm') || raw.includes(':') || raw.includes('tomorrow'))) {
    let hours = parseInt(timeMatch[1]!, 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]!, 10) : 0;
    const ampm = timeMatch[3]?.toLowerCase();
    const isTomorrow = raw.includes('tomorrow');

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    const target = new Date(nowMs);
    target.setHours(hours, minutes, 0, 0);

    if (isTomorrow || target.getTime() <= nowMs) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (raw === 'tomorrow morning') {
    const target = new Date(nowMs);
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return target.getTime();
  }

  if (raw === 'tonight' || raw.startsWith('tonight at')) {
    const hourMatch = raw.match(/tonight\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    const target = new Date(nowMs);
    if (hourMatch) {
      let h = parseInt(hourMatch[1]!, 10);
      const m = hourMatch[2] ? parseInt(hourMatch[2]!, 10) : 0;
      if (h < 12) h += 12; // PM
      target.setHours(h, m, 0, 0);
    } else {
      target.setHours(21, 0, 0, 0); // Default 9 PM
    }
    if (target.getTime() <= nowMs) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  // 4. ISO Date parse
  const parsedIso = Date.parse(raw);
  if (!isNaN(parsedIso)) {
    if (parsedIso < nowMs - 10000) {
      throw new Error(`Invalid trigger time: ${raw} is in the past.`);
    }
    return parsedIso;
  }

  throw new Error(`Unable to resolve scheduled time from expression: "${input}". Please provide a valid time (e.g. "in 10 minutes", "at 6:30 AM tomorrow").`);
}

/**
 * In-memory / hermetic mock store used when running without active Android PhoneDriverServer.
 */
class HermeticReachMockStore {
  private events: Map<string, ReachEventDto> = new Map();

  schedule(event: ReachEventDto): ReachEventDto {
    const saved = { ...event, state: 'scheduled' as const, updatedAtMs: Date.now() };
    this.events.set(saved.id, saved);
    return saved;
  }

  cancel(id: string): boolean {
    const ev = this.events.get(id);
    if (!ev) return false;
    this.events.set(id, { ...ev, state: 'cancelled', updatedAtMs: Date.now() });
    return true;
  }

  snooze(id: string, snoozeMinutes: number = 10): ReachEventDto | null {
    const ev = this.events.get(id);
    if (!ev) return null;
    const snoozed: ReachEventDto = {
      ...ev,
      state: 'snoozed',
      triggerTimeMs: Date.now() + snoozeMinutes * 60 * 1000,
      snoozeMinutes,
      snoozeCount: ev.snoozeCount + 1,
      updatedAtMs: Date.now(),
    };
    this.events.set(id, snoozed);
    return snoozed;
  }

  list(): ReachEventDto[] {
    return Array.from(this.events.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  clear(): void {
    this.events.clear();
  }
}

export const defaultHermeticReachMockStore = new HermeticReachMockStore();

export class ReachCapability implements DeviceCapability {
  readonly id = 'device.reach';
  readonly name = 'MOBOT Reach (Calls & Alarms)';
  readonly description =
    'Schedule native call-like reminders and dependable alarms that trigger with screen off and interface closed without server/runtime dependencies.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.USE_FULL_SCREEN_INTENT',
  ];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'persistent' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'schedule_call',
      description: 'Schedule an incoming call-like reminder that rings and speaks the message via native TTS when answered.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Reminder title or reason for the call.' },
          message: { type: 'string', description: 'Detailed reminder text to be spoken aloud upon answering.' },
          time: { type: ['string', 'number'], description: 'Trigger time (e.g. "in 10 minutes", "at 6:30 AM tomorrow", or ISO string).' },
          snoozeMinutes: { type: 'number', description: 'Default snooze interval in minutes (default: 10).' },
        },
        required: ['title', 'time'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          scheduled: { type: 'boolean' },
          event: { type: 'object' },
          formattedTime: { type: 'string' },
        },
      },
    },
    {
      name: 'schedule_alarm',
      description: 'Schedule a dependable native alarm with optional spoken reminder and snooze controls.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Alarm title or purpose.' },
          time: { type: ['string', 'number'], description: 'Trigger time (e.g. "at 6:30 AM tomorrow", "in 25 minutes", or ISO string).' },
          message: { type: 'string', description: 'Optional reminder message to review or listen to upon waking.' },
          snoozeMinutes: { type: 'number', description: 'Default snooze interval in minutes (default: 10).' },
        },
        required: ['title', 'time'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          scheduled: { type: 'boolean' },
          event: { type: 'object' },
          formattedTime: { type: 'string' },
        },
      },
    },
    {
      name: 'list_events',
      description: 'List upcoming and active call reminders and alarms.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          activeOnly: { type: 'boolean', default: true, description: 'Only list scheduled or snoozed events.' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          events: { type: 'array' },
          count: { type: 'number' },
        },
      },
    },
    {
      name: 'cancel_event',
      description: 'Cancel a pending scheduled call reminder or alarm by id or title.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique event ID to cancel.' },
          title: { type: 'string', description: 'Title of the event to cancel if id is unknown.' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          cancelled: { type: 'boolean' },
          id: { type: 'string' },
        },
      },
    },
    {
      name: 'snooze_event',
      description: 'Snooze an active reach event for a specified duration.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique event ID to snooze.' },
          snoozeMinutes: { type: 'number', default: 10, description: 'Snooze minutes.' },
        },
        required: ['id'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          snoozed: { type: 'boolean' },
          event: { type: 'object' },
        },
      },
    },
    {
      name: 'check_readiness',
      description: 'Check device exact-alarm permission and notification readiness for MOBOT Reach.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          ready: { type: 'boolean' },
          exactAlarmPermitted: { type: 'boolean' },
          notificationsEnabled: { type: 'boolean' },
        },
      },
    },
  ];

  private isDriverAvailable(): boolean {
    const port = process.env.PH_DRIVER_PORT;
    return Boolean(port && Number(port) > 0);
  }

  private async callNativeDriver(endpoint: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<any> {
    const port = process.env.PH_DRIVER_PORT;
    const token = process.env.PH_DRIVER_TOKEN || '';
    if (!port || Number(port) <= 0) {
      throw new Error('ERR_DRIVER_OFFLINE: Native phone driver port is not configured');
    }

    const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Native driver returned HTTP ${res.status}: ${errText}`);
    }

    return await res.json();
  }

  async execute(
    operation: string,
    params: Record<string, unknown>,
    context?: CapabilityContext
  ): Promise<CapabilityResult> {
    try {
      switch (operation) {
        case 'schedule_call': {
          const title = String(params.title || '').trim();
          if (!title) {
            return { success: false, error: { code: 'INVALID_INPUT', message: 'Missing required title for call reminder.', category: 'invalid_input' } };
          }
          const message = String(params.message || title).trim();
          const triggerTimeMs = parseReachTriggerTime(params.time as string | number);
          const snoozeMinutes = typeof params.snoozeMinutes === 'number' ? params.snoozeMinutes : 10;

          if (this.isDriverAvailable()) {
            const resp = await this.callNativeDriver('/reach/schedule', {
              method: 'POST',
              body: {
                type: 'call_reminder',
                title,
                message,
                triggerTimeMs,
                snoozeMinutes,
              },
              signal: context?.signal,
            });
            return {
              success: true,
              data: {
                scheduled: true,
                event: resp.event,
                formattedTime: new Date(triggerTimeMs).toLocaleString(),
                kind: 'call_reminder',
              },
            };
          } else {
            // Hermetic mock fallback
            const event: ReachEventDto = {
              id: randomUUID(),
              type: 'call_reminder',
              title,
              message,
              triggerTimeMs,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
              state: 'scheduled',
              snoozeMinutes,
              snoozeCount: 0,
            };
            const saved = defaultHermeticReachMockStore.schedule(event);
            return {
              success: true,
              data: {
                scheduled: true,
                event: saved,
                formattedTime: new Date(triggerTimeMs).toLocaleString(),
                kind: 'call_reminder',
              },
            };
          }
        }

        case 'schedule_alarm': {
          const title = String(params.title || 'Alarm').trim();
          const message = String(params.message || '').trim();
          const triggerTimeMs = parseReachTriggerTime(params.time as string | number);
          const snoozeMinutes = typeof params.snoozeMinutes === 'number' ? params.snoozeMinutes : 10;

          if (this.isDriverAvailable()) {
            const resp = await this.callNativeDriver('/reach/schedule', {
              method: 'POST',
              body: {
                type: 'alarm',
                title,
                message,
                triggerTimeMs,
                snoozeMinutes,
              },
              signal: context?.signal,
            });
            return {
              success: true,
              data: {
                scheduled: true,
                event: resp.event,
                formattedTime: new Date(triggerTimeMs).toLocaleString(),
                kind: 'alarm',
              },
            };
          } else {
            // Hermetic mock fallback
            const event: ReachEventDto = {
              id: randomUUID(),
              type: 'alarm',
              title,
              message,
              triggerTimeMs,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
              state: 'scheduled',
              snoozeMinutes,
              snoozeCount: 0,
            };
            const saved = defaultHermeticReachMockStore.schedule(event);
            return {
              success: true,
              data: {
                scheduled: true,
                event: saved,
                formattedTime: new Date(triggerTimeMs).toLocaleString(),
                kind: 'alarm',
              },
            };
          }
        }

        case 'list_events': {
          const activeOnly = params.activeOnly !== false;
          let list: ReachEventDto[] = [];

          if (this.isDriverAvailable()) {
            const resp = await this.callNativeDriver('/reach/events', { signal: context?.signal });
            list = resp.events || [];
          } else {
            list = defaultHermeticReachMockStore.list();
          }

          if (activeOnly) {
            list = list.filter((e) => e.state === 'scheduled' || e.state === 'snoozed');
          }

          return {
            success: true,
            data: {
              events: list,
              count: list.length,
            },
          };
        }

        case 'cancel_event': {
          let targetId = String(params.id || '').trim();
          const targetTitle = String(params.title || '').trim().toLowerCase();

          if (!targetId && targetTitle) {
            // Find event by title
            let all: ReachEventDto[] = [];
            if (this.isDriverAvailable()) {
              const resp = await this.callNativeDriver('/reach/events', { signal: context?.signal });
              all = resp.events || [];
            } else {
              all = defaultHermeticReachMockStore.list();
            }
            const match = all.find(
              (e) => (e.state === 'scheduled' || e.state === 'snoozed') && e.title.toLowerCase().includes(targetTitle)
            );
            if (match) targetId = match.id;
          }

          if (!targetId) {
            return {
              success: false,
              error: { code: 'EVENT_NOT_FOUND', message: 'No matching scheduled event found to cancel.', category: 'invalid_input' },
            };
          }

          if (this.isDriverAvailable()) {
            const resp = await this.callNativeDriver('/reach/cancel', {
              method: 'POST',
              body: { id: targetId },
              signal: context?.signal,
            });
            return {
              success: true,
              data: { cancelled: resp.cancelled, id: targetId },
            };
          } else {
            const cancelled = defaultHermeticReachMockStore.cancel(targetId);
            return {
              success: true,
              data: { cancelled, id: targetId },
            };
          }
        }

        case 'snooze_event': {
          const targetId = String(params.id || '').trim();
          const snoozeMinutes = typeof params.snoozeMinutes === 'number' ? params.snoozeMinutes : 10;
          if (!targetId) {
            return {
              success: false,
              error: { code: 'INVALID_INPUT', message: 'Missing event ID to snooze.', category: 'invalid_input' },
            };
          }

          if (this.isDriverAvailable()) {
            const resp = await this.callNativeDriver('/reach/snooze', {
              method: 'POST',
              body: { id: targetId, snoozeMinutes },
              signal: context?.signal,
            });
            return {
              success: true,
              data: { snoozed: true, event: resp.event },
            };
          } else {
            const snoozed = defaultHermeticReachMockStore.snooze(targetId, snoozeMinutes);
            if (!snoozed) {
              return { success: false, error: { code: 'NOT_FOUND', message: 'Event not found to snooze', category: 'invalid_input' } };
            }
            return {
              success: true,
              data: { snoozed: true, event: snoozed },
            };
          }
        }

        case 'check_readiness': {
          if (this.isDriverAvailable()) {
            const resp = await this.callNativeDriver('/reach/status', { signal: context?.signal });
            return {
              success: true,
              data: {
                ready: resp.canSchedule ?? true,
                exactAlarmPermitted: resp.exactAlarmPermitted ?? true,
                notificationsEnabled: resp.notificationsEnabled ?? true,
                mode: 'native_driver',
              },
            };
          } else {
            return {
              success: true,
              data: {
                ready: true,
                exactAlarmPermitted: true,
                notificationsEnabled: true,
                mode: 'hermetic_mock',
              },
            };
          }
        }

        default:
          return {
            success: false,
            error: {
              code: 'OPERATION_NOT_SUPPORTED',
              message: `Operation '${operation}' is not supported by ${this.name}`,
              category: 'invalid_input',
            },
          };
      }
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: err.message || 'Reach operation failed',
          category: 'execution_failed',
        },
      };
    }
  }

  async checkHealth(
    _context?: CapabilityContext,
    signal?: AbortSignal
  ): Promise<CapabilityHealthStatus> {
    if (!this.isDriverAvailable()) {
      return {
        capabilityId: this.id,
        state: 'AVAILABLE',
        lastCheckedMs: Date.now(),
        diagnosticDetails: 'Native phone driver loopback port (PH_DRIVER_PORT) is not set; running in local mock fallback mode.',
      };
    }

    try {
      const statusData = await this.callNativeDriver('/reach/status', { signal });
      if (!statusData.exactAlarmPermitted) {
        return {
          capabilityId: this.id,
          state: 'PERMISSION_REQUIRED',
          lastCheckedMs: Date.now(),
          diagnosticDetails: 'Exact alarm permission is missing or revoked in Android Settings -> Special App Access -> Alarms & Reminders.',
          remediationAction: 'prompt_permission',
        };
      }
      return {
        capabilityId: this.id,
        state: 'AVAILABLE',
        lastCheckedMs: Date.now(),
        diagnosticDetails: 'Native reach scheduler and AlarmManager are fully operational.',
      };
    } catch (err: any) {
      return {
        capabilityId: this.id,
        state: 'TEMPORARILY_UNAVAILABLE',
        lastCheckedMs: Date.now(),
        diagnosticDetails: `Reach readiness probe failed: ${err.message}`,
        remediationAction: 'wait',
      };
    }
  }
}

export const defaultReachCapability = new ReachCapability();

// Observability System for MOBOT (Phase U)
//
// Structured internal events for capabilities, structured UI, file operations,
// media generation, and model availability.
//
// Invariant:
// 1. Raw event streams stay strictly OUT of normal chat.
// 2. Maintained in a bounded ring-buffer for telemetry and diagnostic inspection.

export type ObservabilityEventType =
  | "STRUCTURED_RESPONSE_CREATED"
  | "STRUCTURED_COMPONENT_RENDER_FAILED"
  | "STRUCTURED_COMPONENT_INTERACTION"
  | "MEDIA_CAPABILITY_REQUESTED"
  | "MEDIA_GENERATION_STARTED"
  | "MEDIA_GENERATION_SUCCEEDED"
  | "MEDIA_GENERATION_FAILED"
  | "DEVICE_CAPABILITY_REQUESTED"
  | "DEVICE_CAPABILITY_SUCCEEDED"
  | "DEVICE_CAPABILITY_FAILED"
  | "FILE_SEARCH_STARTED"
  | "FILE_SEARCH_COMPLETED"
  | "FILE_ACTION_APPROVAL_REQUESTED"
  | "FILE_ACTION_SUCCEEDED"
  | "PROVIDER_AUTH_STARTED"
  | "PROVIDER_AUTH_SUCCEEDED"
  | "PROVIDER_AUTH_FAILED"
  | "MODEL_AVAILABILITY_CHANGED"
  | "SMART_RECAP_CREATED"
  | "DAILY_BRIEFING_CREATED"
  | "COMPLETION_CARD_CREATED"
  // App Builder Events (master prompt Phase C, Phase U)
  | "APP_PROJECT_CREATED"
  | "APP_PROJECT_DELETED"
  | "APP_BUILD_STARTED"
  | "APP_BUILD_SUCCEEDED"
  | "APP_BUILD_FAILED"
  | "APP_TEST_STARTED"
  | "APP_TEST_SUCCEEDED"
  | "APP_TEST_FAILED"
  | "APP_PREVIEW_STARTED"
  | "APP_PREVIEW_STOPPED"
  | "APP_PREVIEW_FAILED"
  | "APP_DEPLOYMENT_STARTED"
  | "APP_DEPLOYMENT_SUCCEEDED"
  | "APP_DEPLOYMENT_FAILED"
  // Ask User interaction events
  | "ASK_USER_REQUESTED"
  | "ASK_USER_ANSWERED"
  | "ASK_USER_CANCELLED";


export interface ObservabilityEvent {
  id: string;
  type: ObservabilityEventType;
  timestamp: string;
  botId?: string;
  threadId?: string;
  payload: Record<string, unknown>;
}

export type EventListener = (event: ObservabilityEvent) => void;

export class ObservabilityBus {
  private readonly events: ObservabilityEvent[] = [];
  private readonly maxEvents: number;
  private readonly listeners = new Set<EventListener>();

  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  emit(type: ObservabilityEventType, payload: Record<string, unknown> = {}, context?: { botId?: string; threadId?: string }): ObservabilityEvent {
    const event: ObservabilityEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: new Date().toISOString(),
      botId: context?.botId,
      threadId: context?.threadId,
      payload,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }

    return event;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEvents(filter?: { type?: ObservabilityEventType; botId?: string; limit?: number }): ObservabilityEvent[] {
    let result = this.events;
    if (filter?.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    if (filter?.botId) {
      result = result.filter((e) => e.botId === filter.botId);
    }
    if (filter?.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  getMetricsSummary(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }

  clear(): void {
    this.events.length = 0;
  }
}

export const sharedObservability = new ObservabilityBus();

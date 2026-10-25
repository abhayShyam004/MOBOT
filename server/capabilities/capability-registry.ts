/**
 * Device Capability Registry (Phase P).
 *
 * Central registry and dispatcher for all Android device capabilities.
 * Allows adding, querying, and invoking capabilities with schemas and risk classifications.
 */

import {
  type DeviceCapability,
  type DeviceCapabilityMetadata,
  type DeviceCapabilityDescription,
  type CapabilityResult,
  type CapabilityContext,
  type CapabilityMatchRequest,
  type CapabilityMatchResolution,
  ERR_NO_CAPABLE_TOOL,
} from './types.ts';
import { recordActionReceipt } from './action-truthfulness.ts';
import {
  FilesCapability,
  CameraCapability,
  ScreenshotCapability,
  ShareCapability,
  ClipboardCapability,
  CalendarCapability,
  ContactsCapability,
  AppsCapability,
  NotificationsCapability,
  RemindersCapability,
  MediaCapability,
  LocationCapability,
  BrowserCapability,
  WebScraperCapability,
  ComposioServiceCapability,
} from './default-capabilities.ts';
import { PhoneControlCapability } from './phone-control.ts';

export class DeviceCapabilityRegistry {
  private readonly capabilities = new Map<string, DeviceCapability>();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register default built-in capabilities.
   */
  private registerDefaults(): void {
    this.register(new FilesCapability());
    this.register(new CameraCapability());
    this.register(new ScreenshotCapability());
    this.register(new ShareCapability());
    this.register(new ClipboardCapability());
    this.register(new CalendarCapability());
    this.register(new ContactsCapability());
    this.register(new AppsCapability());
    this.register(new NotificationsCapability());
    this.register(new RemindersCapability());
    this.register(new MediaCapability());
    this.register(new LocationCapability());
    this.register(new BrowserCapability());
    this.register(new WebScraperCapability());
    this.register(new ComposioServiceCapability());
    this.register(new PhoneControlCapability());
  }

  /**
   * Register a new or custom capability.
   */
  register(capability: DeviceCapability): void {
    this.capabilities.set(capability.id, capability);
  }

  /**
   * Unregister an existing capability by ID.
   */
  unregister(id: string): boolean {
    return this.capabilities.delete(id);
  }

  /**
   * Check if a capability exists.
   */
  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  /**
   * Retrieve a capability by ID.
   */
  get(id: string): DeviceCapability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * List all capabilities with high-level metadata.
   */
  list(): DeviceCapabilityMetadata[] {
    return Array.from(this.capabilities.values()).map((cap) => ({
      id: cap.id,
      name: cap.name,
      description: cap.description,
      availability: cap.availability,
      requiredPermissions: cap.requiredPermissions,
      riskClassification: cap.riskClassification,
      lifecycleBehavior: cap.lifecycleBehavior,
      supportedOperations: cap.supportedOperations.map((op) => ({
        name: op.name,
        description: op.description,
        risk: op.risk,
      })),
    }));
  }

  /**
   * Describe a capability in detail including full operation schemas.
   */
  describe(id: string): DeviceCapabilityDescription | undefined {
    const cap = this.capabilities.get(id);
    if (!cap) return undefined;
    return {
      id: cap.id,
      name: cap.name,
      description: cap.description,
      availability: cap.availability,
      requiredPermissions: cap.requiredPermissions,
      riskClassification: cap.riskClassification,
      lifecycleBehavior: cap.lifecycleBehavior,
      supportedOperations: cap.supportedOperations.map((op) => ({
        name: op.name,
        description: op.description,
        risk: op.risk,
      })),
      operations: cap.supportedOperations,
    };
  }

  /**
   * Invoke a capability operation.
   */
  async invoke(
    capabilityId: string,
    operation: string,
    params: Record<string, unknown> = {},
    context?: CapabilityContext
  ): Promise<CapabilityResult> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      return {
        success: false,
        error: {
          code: 'CAPABILITY_NOT_FOUND',
          message: `Device capability '${capabilityId}' is not registered.`,
          category: 'unavailable',
        },
      };
    }

    if (!cap.availability.supported) {
      return {
        success: false,
        error: {
          code: 'CAPABILITY_UNAVAILABLE',
          message: cap.availability.reason || `Device capability '${capabilityId}' is currently unavailable.`,
          category: 'unavailable',
        },
      };
    }

    const op = cap.supportedOperations.find((o) => o.name === operation);
    if (!op) {
      return {
        success: false,
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: `Capability '${capabilityId}' does not support operation '${operation}'.`,
          category: 'invalid_input',
        },
      };
    }

    try {
      const result = await cap.execute(operation, params, context);
      if (capabilityId === 'device.calendar' && operation === 'create_event') {
        if (result.success && result.data) {
          const resData = result.data as Record<string, unknown>;
          recordActionReceipt({
            operationId: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            botId: context?.botId || 'default',
            threadId: context?.threadId || 'default',
            turnId: context?.turnId || 'default',
            actionType: 'calendar.create_event',
            status: 'SUCCEEDED',
            evidence: {
              resourceId: String(resData.eventId || 'device_calendar_event'),
            },
            attemptedAt: Date.now(),
          });
        }
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : (typeof err === "string" ? err : "Action execution failed");
      return {
        success: false,
        error: {
          code: "EXECUTION_FAILED",
          message,
          category: "execution_failed",
        },
      };
    }
  }

  /**
   * Official Roadmap Phase 11: Intelligent Capability Selection (mobot_54_phases_prompt.md:740-804)
   *
   * Dynamically evaluates task objective, context keywords, required freshness,
   * target domain/device, and registered capabilities to resolve the optimal
   * ExecutionModality, primary capability, fallbacks, and calibrated confidence score.
   */
  matchCapability(request: CapabilityMatchRequest): CapabilityMatchResolution {
    // 0. Formal Contract Runtime Validation (mobot_54_phases_prompt.md:763-778)
    if (!request || typeof request !== "object") {
      return {
        chosenModality: "user_clarification",
        fallbackCapabilityIds: [],
        justification: "Invalid CapabilityMatchRequest: request must be a valid non-null object.",
        confidenceScore: 0.10,
      };
    }

    if (!request.activeBotId || typeof request.activeBotId !== "string" || !request.activeBotId.trim()) {
      return {
        chosenModality: "user_clarification",
        fallbackCapabilityIds: [],
        justification: "Authorization-sensitive routing rejected: missing or invalid activeBotId context.",
        confidenceScore: 0.10,
      };
    }

    const validFreshness = ["realtime", "static", "historical"];
    if (!request.requiredDataFreshness || !validFreshness.includes(request.requiredDataFreshness)) {
      return {
        chosenModality: "user_clarification",
        fallbackCapabilityIds: [],
        justification: `Invalid CapabilityMatchRequest: unrecognized or missing requiredDataFreshness '${request.requiredDataFreshness}'.`,
        confidenceScore: 0.10,
      };
    }

    const validTargets = ["android_local", "cloud_vps", "external_saas"];
    if (!request.targetDevice || !validTargets.includes(request.targetDevice)) {
      return {
        chosenModality: "user_clarification",
        fallbackCapabilityIds: [],
        justification: `Invalid CapabilityMatchRequest: unrecognized or missing targetDevice '${request.targetDevice}'.`,
        confidenceScore: 0.10,
      };
    }

    const obj = (request.objective || "").trim();
    const lowerObj = obj.toLowerCase();
    const keywords = (Array.isArray(request.contextKeywords) ? request.contextKeywords : [])
      .map((k) => (typeof k === "string" ? k.toLowerCase().trim() : ""))
      .filter(Boolean);
    const combinedTokens = new Set([
      ...lowerObj.split(/[\s,.;:!?_/\-()]+/).filter(Boolean),
      ...keywords,
    ]);

    const hasAnyToken = (...tokens: string[]): boolean =>
      tokens.some((t) => (t.includes(" ") ? lowerObj.includes(t) : combinedTokens.has(t)));

    // 1. Ambiguous, nonsensical, or completely missing objective -> user_clarification
    if (
      !obj ||
      obj.length < 3 ||
      /^[^a-zA-Z0-9]+$/.test(obj) ||
      /^(?:what|help|do it|fix it|\?+|can you help me with that thing)$/i.test(obj)
    ) {
      return {
        chosenModality: "user_clarification",
        fallbackCapabilityIds: [],
        justification: "Task objective is ambiguous, incomplete, or lacks actionable intent. Prompting user for clarification.",
        confidenceScore: 0.95,
      };
    }

    // 2. Simple Conversational Greetings or Pure Reasoning -> direct_answer
    // Anti-Pattern: Do not force simple conversational greetings through a heavy tool routing pipeline.
    const isGreeting =
      /^(?:hi|hello|hey|greetings|howdy|sup)(?:\s+\w+)?[\s!.]*$/i.test(obj) ||
      /^(?:good\s+(?:morning|afternoon|evening|day))[\s!.]*$/i.test(obj);
    const isPureReasoning =
      request.requiredDataFreshness !== "realtime" &&
      (
        /^(?:who\s+are\s+you|what\s+is\s+your\s+name|who\s+(?:built|made|created)\s+you)/i.test(obj) ||
        /^(?:tell\s+me\s+a\s+joke|write\s+a\s+poem|tell\s+(?:me\s+)?a\s+story)/i.test(obj) ||
        /^what\s+is\s+[\d\s+*/^().-]+\??$/i.test(obj) ||
        /^explain\s+/i.test(obj) ||
        (hasAnyToken("poem", "joke", "story", "reasoning", "philosophy") && !hasAnyToken("search", "browse", "file", "weather", "news", "today", "headlines", "latest")) ||
        (request.requiredDataFreshness === "historical" && !hasAnyToken("search", "browse", "file", "open", "launch", "click"))
      );

    if (isGreeting || isPureReasoning) {
      return {
        chosenModality: "direct_answer",
        fallbackCapabilityIds: [],
        justification: isGreeting
          ? "Conversational greeting handled via direct LLM generation without unnecessary tool routing."
          : "Conceptual, creative, or pure reasoning query satisfied via direct LLM synthesis without external mutation.",
        confidenceScore: 0.96,
      };
    }

    // 3. Specialist Handoff
    if (hasAnyToken("handoff", "delegate", "subagent", "specialist") && hasAnyToken("coder", "researcher", "reviewer", "auditor")) {
      return {
        chosenModality: "specialist_handoff",
        primaryCapabilityId: undefined,
        fallbackCapabilityIds: [],
        justification: "Task explicitly requires multi-agent coordination or specialist role handoff.",
        confidenceScore: 0.88,
      };
    }

    // 4. External Cloud SaaS -> composio_service
    const hasWebUrl = /(?:https?:\/\/|www\.)\S+/.test(lowerObj);
    const isSaasTarget =
      !hasWebUrl &&
      (request.targetDevice === "external_saas" ||
        hasAnyToken("gmail", "slack", "github", "linear", "notion", "jira", "salesforce", "trello", "hubspot", "email"));
    if (isSaasTarget) {
      const composioAvailable = this.has("composio.service");
      if (composioAvailable) {
        return {
          chosenModality: "composio_service",
          primaryCapabilityId: "composio.service",
          fallbackCapabilityIds: [],
          justification: "Task targets cloud SaaS integration managed through Composio connected services.",
          confidenceScore: 0.90,
        };
      }
      return {
        chosenModality: "composio_service",
        primaryCapabilityId: undefined,
        fallbackCapabilityIds: [],
        justification: `${ERR_NO_CAPABLE_TOOL}: External SaaS capability for '${obj}' requires connected service authentication (Phase 12).`,
        confidenceScore: 0.30,
      };
    }

    // 5. Terminal Command / Cloud VPS -> terminal_command
    const isTerminalTarget =
      !hasWebUrl &&
      (request.targetDevice === "cloud_vps" ||
        hasAnyToken("terminal", "bash", "shell", "exec", "curl", "npm", "pnpm", "git", "docker", "compile", "script", "command"));
    if (isTerminalTarget && !hasAnyToken("browser", "search", "headlines", "news")) {
      const primaryTool = this.has("system.terminal") ? "system.terminal" : (this.has("device.apps") ? "device.apps" : undefined);
      return {
        chosenModality: "terminal_command",
        primaryCapabilityId: primaryTool,
        fallbackCapabilityIds: [],
        justification: "Task requires terminal or shell command execution in a command-line environment.",
        confidenceScore: primaryTool ? 0.92 : 0.35,
      };
    }

    // 6. Filesystem Mutation -> filesystem_mutation
    const isFilesystem =
      hasAnyToken("file", "files", "document", "folder", "directory", "save", "write", "download", "workspace", "read", "delete") &&
      hasAnyToken("txt", "pdf", "json", "md", "csv", "log", "report", "file", "folder", "directory", "workspace", "storage") &&
      !hasAnyToken("browse", "website", "url", "http", "headlines", "news");
    if (isFilesystem) {
      const primaryTool = this.has("device.files") ? "device.files" : undefined;
      return {
        chosenModality: "filesystem_mutation",
        primaryCapabilityId: primaryTool,
        fallbackCapabilityIds: [],
        justification: "Task requires reading, writing, or managing files in local storage.",
        confidenceScore: primaryTool ? 0.94 : 0.35,
      };
    }

    // 7. Interactive Browser Session vs Simple Web Search
    // Interactive browser keywords: navigate, click, dom, form, session, visit url, inspect page
    const isInteractiveBrowser =
      hasAnyToken("browser_session", "session", "navigate", "click", "fill", "form", "dom", "inspect", "open url", "visit") ||
      /(?:https?:\/\/|www\.)\S+/.test(lowerObj);

    if (isInteractiveBrowser && !hasAnyToken("headlines", "search web for", "google search")) {
      const primaryTool = this.has("device.browser") ? "device.browser" : (this.has("web.scraper") ? "web.scraper" : undefined);
      const fallbacks = ["web.scraper"].filter((id) => id !== primaryTool && this.has(id));
      return {
        chosenModality: "browser_session",
        primaryCapabilityId: primaryTool,
        fallbackCapabilityIds: fallbacks,
        justification: "Task requires interactive browser navigation, DOM inspection, or session interaction.",
        confidenceScore: primaryTool ? 0.93 : 0.35,
      };
    }

    // 8. Factual Web Queries & News Requiring Real-Time Freshness -> web_search
    // Anti-Pattern: Do not route factual web queries to direct LLM generation without search verification when freshness is required.
    const isDeviceSensorQuery = hasAnyToken("screenshot", "location", "screen", "clipboard", "gps", "camera", "photo", "app", "apps", "application", "applications", "installed", "whatsapp", "reminder", "reminders", "alarm", "calendar");
    const isWebSearch =
      !isDeviceSensorQuery &&
      (request.requiredDataFreshness === "realtime" ||
        (request.requiredDataFreshness !== "historical" &&
          (hasAnyToken("search", "headlines", "news", "today", "weather", "stock", "price", "latest", "lookup", "recent") ||
            (hasAnyToken("current") && hasAnyToken("weather", "stock", "price", "news", "events", "exchange", "rate", "temperature"))
          )
        )
      );

    if (isWebSearch) {
      const primaryTool = this.has("device.browser") ? "device.browser" : (this.has("web.scraper") ? "web.scraper" : undefined);
      const fallbacks = ["web.scraper", "device.browser"].filter((id) => id !== primaryTool && this.has(id));
      return {
        chosenModality: "web_search",
        primaryCapabilityId: primaryTool,
        fallbackCapabilityIds: fallbacks,
        justification: "Factual query requires real-time data freshness; routed to web search capability to prevent hallucinations.",
        confidenceScore: primaryTool ? 0.94 : 0.40,
      };
    }

    // 9. Android Device Gesture / Hardware Sensor -> device_gesture
    let matchedDeviceTool: string | undefined;
    if (hasAnyToken("phone control", "control phone", "automation", "phone_control", "phone assistant", "tap screen", "type text", "scroll screen", "global action")) matchedDeviceTool = "device.phone_control";
    else if (hasAnyToken("post a notification", "notification", "notify")) matchedDeviceTool = "device.notifications";
    else if (hasAnyToken("remind", "reminder", "reminders", "alarm")) matchedDeviceTool = "device.reminders";
    else if (hasAnyToken("camera", "photo", "picture")) matchedDeviceTool = "device.camera";
    else if (hasAnyToken("screenshot", "capture screen")) matchedDeviceTool = "device.screenshot";
    else if (hasAnyToken("clipboard", "copy", "paste")) matchedDeviceTool = "device.clipboard";
    else if (hasAnyToken("calendar", "event", "schedule")) matchedDeviceTool = "device.calendar";
    else if (hasAnyToken("contact", "contacts", "phone number", "address book")) matchedDeviceTool = "device.contacts";
    else if (hasAnyToken("location", "gps", "coordinates", "where am i")) matchedDeviceTool = "device.location";
    else if (hasAnyToken("media", "audio", "music", "play")) matchedDeviceTool = "device.media";
    else if (hasAnyToken("app", "apps", "application", "applications", "launch", "open app", "installed", "whatsapp", "package", "packages")) matchedDeviceTool = "device.apps";
    else if (hasAnyToken("share")) matchedDeviceTool = "device.share";

    if (matchedDeviceTool) {
      if (this.has(matchedDeviceTool)) {
        return {
          chosenModality: "device_gesture",
          primaryCapabilityId: matchedDeviceTool,
          fallbackCapabilityIds: [],
          justification: `Task targets Android local device interaction (${matchedDeviceTool}).`,
          confidenceScore: 0.92,
        };
      }
      return {
        chosenModality: "user_clarification",
        primaryCapabilityId: undefined,
        fallbackCapabilityIds: [],
        justification: `${ERR_NO_CAPABLE_TOOL}: Android capability '${matchedDeviceTool}' is not available or disabled on this device.`,
        confidenceScore: 0.25,
      };
    }

    // 10. Fallback: Check if any registered capability matches the keywords
    for (const [id, cap] of this.capabilities.entries()) {
      if (hasAnyToken(id, cap.name.toLowerCase())) {
        return {
          chosenModality: "device_gesture",
          primaryCapabilityId: id,
          fallbackCapabilityIds: [],
          justification: `Task keywords matched registered capability '${id}'.`,
          confidenceScore: 0.85,
        };
      }
    }

    // 11. Unsupported Tool / Protocol: ERR_NO_CAPABLE_TOOL
    return {
      chosenModality: "user_clarification",
      primaryCapabilityId: undefined,
      fallbackCapabilityIds: [],
      justification: `${ERR_NO_CAPABLE_TOOL}: No registered capability satisfies the task requirements for '${obj}'.`,
      confidenceScore: 0.20,
    };
  }
}

/** Global singleton capability registry */
export const defaultCapabilityRegistry = new DeviceCapabilityRegistry();

/**
 * High-level agent tool definitions for the Device Capability layer.
 */
export const DEVICE_CAPABILITY_TOOLS = {
  device_capability_list: {
    description:
      'List all registered Android device capabilities (Files, Camera, Screenshot, Share, Clipboard, Calendar, Contacts, Apps, Notifications, Media) with their availability, required permissions, and risk tiers.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const capabilities = defaultCapabilityRegistry.list();
      return { capabilities };
    },
  },

  device_capability_describe: {
    description:
      'Get full operation schemas, parameter requirements, and lifecycle details for a specific device capability.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability identifier, e.g. "device.files"' },
      },
      required: ['id'],
    },
    handler: async (args: Record<string, unknown>) => {
      const id = String(args.id || '');
      const desc = defaultCapabilityRegistry.describe(id);
      if (!desc) {
        return { error: `Capability '${id}' not found.` };
      }
      return { capability: desc };
    },
  },

  device_capability_invoke: {
    description:
      'Invoke an operation on a device capability (e.g. read a file, copy to clipboard, create calendar event, open URL). Returns structured execution result.',
    inputSchema: {
      type: 'object',
      properties: {
        capabilityId: { type: 'string', description: 'Capability identifier, e.g. "device.files"' },
        operation: { type: 'string', description: 'Operation to perform, e.g. "read", "set_text"' },
        params: { type: 'object', description: 'Parameters for the operation' },
      },
      required: ['capabilityId', 'operation'],
    },
    handler: async (args: Record<string, unknown>, signal?: AbortSignal) => {
      const capabilityId = String(args.capabilityId || '');
      const operation = String(args.operation || '');
      const params = (args.params as Record<string, unknown>) || {};
      const res = await defaultCapabilityRegistry.invoke(capabilityId, operation, params, { signal });
      return res;
    },
  },
};

/**
 * Cleanly normalizes partial request parameters into a fully conformant CapabilityMatchRequest
 * adhering to the strict Phase 11 contract (mobot_54_phases_prompt.md:763-769).
 */
export function normalizeCapabilityMatchRequest(
  partial: Partial<CapabilityMatchRequest> & { objective: string }
): CapabilityMatchRequest {
  const obj = (partial.objective || "").trim();
  const lowerObj = obj.toLowerCase();

  // Inferred freshness if not provided
  let inferredFreshness: "realtime" | "static" | "historical" = partial.requiredDataFreshness ?? "static";
  if (!partial.requiredDataFreshness) {
    if (/\b(?:today|tonight|right now|live|current|latest|recent|news|headlines|weather|stock|price)\b/i.test(lowerObj)) {
      inferredFreshness = "realtime";
    } else if (/\b(?:historical|history|ancient|in \d{4}|who won.*(?:19\d\d|20[01]\d))\b/i.test(lowerObj)) {
      inferredFreshness = "historical";
    }
  }

  // Inferred target device if not provided
  let inferredTarget: "android_local" | "cloud_vps" | "external_saas" = partial.targetDevice ?? "android_local";
  if (!partial.targetDevice) {
    if (/\b(?:gmail|slack|github|linear|notion|jira|salesforce|trello|hubspot)\b/i.test(lowerObj)) {
      inferredTarget = "external_saas";
    } else if (/\b(?:vps|ssh|cloud server|docker|bash shell|terminal command)\b/i.test(lowerObj)) {
      inferredTarget = "cloud_vps";
    }
  }

  return {
    objective: obj,
    contextKeywords: Array.isArray(partial.contextKeywords) ? partial.contextKeywords : [],
    requiredDataFreshness: inferredFreshness,
    targetDevice: inferredTarget,
    activeBotId: (partial.activeBotId || "").trim() || "default",
  };
}

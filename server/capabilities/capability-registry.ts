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
  type CapabilityHealthStatus,
  ERR_NO_CAPABLE_TOOL,
  ERR_CAPABILITY_PROBE_FAILED,
  ERR_CONFIRMATION_REQUIRED,
} from './types.ts';
import {
  DeviceSafetyPolicy,
  defaultActionAuthorizationManager,
} from './safety-policy.ts';
import { sharedObservability } from './observability.ts';
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
import { ReachCapability } from './reach.ts';

export const CAPABILITY_PROBE_TIMEOUT_MS = 500;

export class DeviceCapabilityRegistry {
  private readonly capabilities = new Map<string, DeviceCapability>();
  private readonly healthStates = new Map<string, CapabilityHealthStatus>();
  private readonly probeGenerations = new Map<string, number>();

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
    this.register(new ReachCapability());
  }

  /**
   * Register a new or custom capability.
   */
  register(capability: DeviceCapability): void {
    this.capabilities.set(capability.id, capability);
  }

  /**
   * Resolve capability ID to its canonical registered ID, handling common aliases.
   */
  resolveCanonicalId(id: string): string {
    const raw = String(id || '').trim();
    if (this.capabilities.has(raw)) return raw;
    const lower = raw.toLowerCase().replace(/[-_]/g, '');
    for (const key of this.capabilities.keys()) {
      const keyLower = key.toLowerCase().replace(/[-_]/g, '');
      if (keyLower === lower || keyLower === `device${lower}` || `device${keyLower}` === lower) {
        return key;
      }
    }
    if (raw === 'phone-control' || raw === 'phone_control' || raw === 'device.phone-control' || raw === 'android_computer') {
      if (this.capabilities.has('device.phone_control')) return 'device.phone_control';
    }
    if (raw === 'apps' || raw === 'device.app' || raw === 'app') {
      if (this.capabilities.has('device.apps')) return 'device.apps';
    }
    if (raw === 'screenshot' || raw === 'device.screenshot') {
      if (this.capabilities.has('device.screenshot')) return 'device.screenshot';
    }
    if (raw === 'reach' || raw === 'device.reach') {
      if (this.capabilities.has('device.reach')) return 'device.reach';
    }
    return raw;
  }

  /**
   * Unregister an existing capability by ID.
   */
  unregister(id: string): boolean {
    const canonicalId = this.resolveCanonicalId(id);
    this.healthStates.delete(canonicalId);
    this.probeGenerations.delete(canonicalId);
    return this.capabilities.delete(canonicalId);
  }

  /**
   * Check if a capability exists.
   */
  has(id: string): boolean {
    return this.capabilities.has(this.resolveCanonicalId(id));
  }

  /**
   * Retrieve a capability by ID.
   */
  get(id: string): DeviceCapability | undefined {
    return this.capabilities.get(this.resolveCanonicalId(id));
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
    const canonicalId = this.resolveCanonicalId(id);
    const cap = this.capabilities.get(canonicalId);
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
   * Official Roadmap Phase 13: Capability State Awareness.
   * Retrieve authoritative operational state of a capability.
   */
  getHealthStatus(capabilityId: string): CapabilityHealthStatus {
    const canonicalId = this.resolveCanonicalId(capabilityId);
    const cached = this.healthStates.get(canonicalId);
    if (cached) return cached;

    const cap = this.capabilities.get(canonicalId);
    if (!cap) {
      return {
        capabilityId: canonicalId,
        state: 'DEPENDENCY_MISSING',
        lastCheckedMs: 0,
        diagnosticDetails: `Device capability '${capabilityId}' is not registered.`,
      };
    }

    if (!cap.availability.supported) {
      return {
        capabilityId,
        state: 'DEPENDENCY_MISSING',
        lastCheckedMs: 0,
        diagnosticDetails: cap.availability.reason || 'Capability unsupported on this platform.',
      };
    }

    return {
      capabilityId,
      state: 'AVAILABLE',
      lastCheckedMs: 0,
    };
  }

  /**
   * Set or override capability health status explicitly.
   */
  setHealthStatus(status: CapabilityHealthStatus): void {
    const previous = this.healthStates.get(status.capabilityId);
    this.healthStates.set(status.capabilityId, status);
    const gen = (this.probeGenerations.get(status.capabilityId) || 0) + 1;
    this.probeGenerations.set(status.capabilityId, gen);

    if (previous?.state !== status.state) {
      sharedObservability.emit('CAPABILITY_STATE_CHANGED', {
        capabilityId: status.capabilityId,
        previousState: previous?.state,
        currentState: status.state,
        remediationAction: status.remediationAction,
        diagnosticDetails: status.diagnosticDetails,
      });
    }
  }

  /**
   * Clear cached health states (useful for tests or full re-evaluation).
   */
  clearHealthStatus(capabilityId?: string): void {
    if (capabilityId) {
      this.healthStates.delete(capabilityId);
    } else {
      this.healthStates.clear();
      this.probeGenerations.clear();
    }
  }

  /**
   * Official Roadmap Phase 13: Live Health Probe with strict 500ms hard timeout.
   */
  async probeHealth(
    capabilityId: string,
    options?: { force?: boolean; signal?: AbortSignal; context?: CapabilityContext }
  ): Promise<CapabilityHealthStatus> {
    const canonicalId = this.resolveCanonicalId(capabilityId);
    const cached = this.healthStates.get(canonicalId);
    const now = Date.now();
    if (!options?.force && cached && cached.lastCheckedMs > 0 && now - cached.lastCheckedMs < 1000) {
      return cached;
    }

    const cap = this.capabilities.get(canonicalId);
    if (!cap) {
      const missing: CapabilityHealthStatus = {
        capabilityId: canonicalId,
        state: 'DEPENDENCY_MISSING',
        lastCheckedMs: now,
        diagnosticDetails: `Device capability '${capabilityId}' is not registered.`,
      };
      this.healthStates.set(canonicalId, missing);
      return missing;
    }

    const gen = (this.probeGenerations.get(canonicalId) || 0) + 1;
    this.probeGenerations.set(canonicalId, gen);

    const timeoutCtrl = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutCtrl.abort(new Error(ERR_CAPABILITY_PROBE_FAILED));
    }, CAPABILITY_PROBE_TIMEOUT_MS);

    const onExternalAbort = () => {
      timeoutCtrl.abort(options?.signal?.reason || new Error('Aborted'));
    };
    if (options?.signal) {
      if (options.signal.aborted) {
        timeoutCtrl.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    let status: CapabilityHealthStatus;
    try {
      if (typeof cap.checkHealth === 'function') {
        const probePromise = cap.checkHealth(options?.context, timeoutCtrl.signal);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutCtrl.signal.addEventListener(
            'abort',
            () => reject(timeoutCtrl.signal.reason || new Error(ERR_CAPABILITY_PROBE_FAILED)),
            { once: true }
          );
        });
        status = await Promise.race([probePromise, timeoutPromise]);
      } else {
        if (!cap.availability.supported) {
          status = {
            capabilityId,
            state: 'DEPENDENCY_MISSING',
            lastCheckedMs: Date.now(),
            diagnosticDetails: cap.availability.reason || 'Capability unsupported on this platform.',
          };
        } else {
          status = {
            capabilityId,
            state: 'AVAILABLE',
            lastCheckedMs: Date.now(),
          };
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout =
        (err instanceof Error && (err.message.includes(ERR_CAPABILITY_PROBE_FAILED) || err.name === 'AbortError' || err.name === 'TimeoutError')) ||
        timeoutCtrl.signal.aborted;

      if (isTimeout) {
        status = {
          capabilityId,
          state: 'TEMPORARILY_UNAVAILABLE',
          lastCheckedMs: Date.now(),
          diagnosticDetails: `${ERR_CAPABILITY_PROBE_FAILED}: Health probe for '${capabilityId}' exceeded ${CAPABILITY_PROBE_TIMEOUT_MS}ms hard deadline.`,
          remediationAction: 'wait',
        };
      } else {
        status = {
          capabilityId,
          state: 'DRIVER_OFFLINE',
          lastCheckedMs: Date.now(),
          diagnosticDetails: `Health probe failed: ${msg}`,
          remediationAction: 'restart_driver',
        };
      }
    } finally {
      clearTimeout(timeoutTimer);
      if (options?.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
    }

    if (this.probeGenerations.get(capabilityId) === gen) {
      this.healthStates.set(capabilityId, status);
      sharedObservability.emit('CAPABILITY_HEALTH_PROBED', {
        capabilityId,
        state: status.state,
        lastCheckedMs: status.lastCheckedMs,
        diagnosticDetails: status.diagnosticDetails,
        remediationAction: status.remediationAction,
      });
    }

    return status;
  }

  /**
   * Probe all registered capabilities in parallel.
   */
  async probeAll(
    options?: { force?: boolean; signal?: AbortSignal; context?: CapabilityContext }
  ): Promise<Map<string, CapabilityHealthStatus>> {
    const results = new Map<string, CapabilityHealthStatus>();
    const probes = Array.from(this.capabilities.keys()).map(async (id) => {
      const st = await this.probeHealth(id, options);
      results.set(id, st);
    });
    await Promise.all(probes);
    return results;
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
    const canonicalId = this.resolveCanonicalId(capabilityId);
    const cap = this.capabilities.get(canonicalId);
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

    // Official Roadmap Phase 13: Authoritative Pre-Dispatch Operational State Gate
    const currentHealth = this.getHealthStatus(canonicalId);
    if (currentHealth.state !== 'AVAILABLE') {
      return {
        success: false,
        error: {
          code: currentHealth.state,
          message: currentHealth.diagnosticDetails || `Device capability '${capabilityId}' cannot be invoked because it is ${currentHealth.state}.`,
          category: currentHealth.state === 'PERMISSION_REQUIRED' ? 'permission_denied' : 'unavailable',
          details: {
            capabilityId,
            state: currentHealth.state,
            remediationAction: currentHealth.remediationAction,
            lastCheckedMs: currentHealth.lastCheckedMs,
            diagnosticDetails: currentHealth.diagnosticDetails,
          },
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

    // Official Roadmap Phase 14: Authoritative Risk-Aware Autonomy Pre-Dispatch Gate
    const approvalMode = (context?.approvalMode === 'custom' ? 'auto' : context?.approvalMode) || 'ask';
    const riskResult = DeviceSafetyPolicy.evaluateRisk({
      capabilityId,
      operation,
      parameters: params,
      approvalMode: approvalMode as 'ask' | 'edits' | 'auto' | 'full',
    });

    sharedObservability.emit('CAPABILITY_RISK_EVALUATED', {
      capabilityId,
      operation,
      tier: riskResult.tier,
      requiresExplicitConfirmation: riskResult.requiresExplicitConfirmation,
      approvalMode,
    });

    if (riskResult.requiresExplicitConfirmation) {
      const grant = context?.confirmationGrant;
      const validation = defaultActionAuthorizationManager.validateAndConsumeGrant({
        grant,
        grantId: context?.confirmationToken,
        capabilityId,
        operation,
        parameters: params,
        botId: context?.botId,
      });

      if (!validation.valid) {
        sharedObservability.emit('CAPABILITY_CONFIRMATION_REQUIRED', {
          capabilityId,
          operation,
          reason: validation.reason,
          code: validation.code,
        });

        return {
          success: false,
          error: {
            code: validation.code || ERR_CONFIRMATION_REQUIRED,
            message: validation.reason || `Explicit user confirmation required for ${riskResult.tier}-risk operation: ${riskResult.consequentialImpactDescription}`,
            category: 'permission_denied',
            details: {
              tier: riskResult.tier,
              requiresExplicitConfirmation: true,
              consequentialImpactDescription: riskResult.consequentialImpactDescription,
              reversible: riskResult.reversible,
              isMassDeletion: riskResult.isMassDeletion,
              remediationAction: 'prompt_auth',
            },
          },
        };
      }

      sharedObservability.emit('CAPABILITY_CONFIRMATION_GRANTED', {
        capabilityId,
        operation,
        grantId: grant?.grantId || context?.confirmationToken,
      });
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
    const isLocalAppQuery =
      (hasAnyToken("open", "launch", "start", "switch to", "detect", "installed", "find", "check") && hasAnyToken("app", "application", "whatsapp")) ||
      (hasAnyToken("whatsapp") && hasAnyToken("phone", "device", "installed", "detect"));
    const isSaasTarget =
      !hasWebUrl &&
      !isLocalAppQuery &&
      (request.targetDevice === "external_saas" ||
        hasAnyToken("gmail", "slack", "github", "linear", "notion", "jira", "salesforce", "trello", "hubspot", "email") ||
        (hasAnyToken("whatsapp") && hasAnyToken("message", "send", "chat", "text", "dm", "notify")));
    if (isSaasTarget) {
      const composioAvailable = this.has("composio.service");
      if (composioAvailable) {
        const health = this.getHealthStatus("composio.service");
        if (health.state === "AVAILABLE") {
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
          justification: `[${health.state}]: Connected SaaS capability 'composio.service' is currently ${health.state}.${health.diagnosticDetails ? ` ${health.diagnosticDetails}` : ""}${health.remediationAction ? ` Remediation: ${health.remediationAction}.` : ""}`,
          confidenceScore: 0.30,
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
      const candidates = ["system.terminal", "device.apps"].filter((id) => this.has(id));
      const healthyCandidates = candidates.filter((id) => this.getHealthStatus(id).state === "AVAILABLE");
      const primaryTool = healthyCandidates[0];
      const fallbacks = healthyCandidates.slice(1);
      return {
        chosenModality: "terminal_command",
        primaryCapabilityId: primaryTool,
        fallbackCapabilityIds: fallbacks,
        justification: primaryTool
          ? "Task requires terminal or shell command execution in a command-line environment."
          : `${ERR_NO_CAPABLE_TOOL}: Terminal capabilities are currently offline or unavailable.`,
        confidenceScore: primaryTool ? 0.92 : 0.35,
      };
    }

    // 6. Filesystem Mutation -> filesystem_mutation
    const isFilesystem =
      hasAnyToken("file", "files", "document", "folder", "directory", "save", "write", "download", "workspace", "read", "delete") &&
      hasAnyToken("txt", "pdf", "json", "md", "csv", "log", "report", "file", "folder", "directory", "workspace", "storage") &&
      !hasAnyToken("browse", "website", "url", "http", "headlines", "news");
    if (isFilesystem) {
      const candidates = ["device.files"].filter((id) => this.has(id));
      const healthyCandidates = candidates.filter((id) => this.getHealthStatus(id).state === "AVAILABLE");
      const primaryTool = healthyCandidates[0];
      if (primaryTool) {
        return {
          chosenModality: "filesystem_mutation",
          primaryCapabilityId: primaryTool,
          fallbackCapabilityIds: [],
          justification: "Task requires reading, writing, or managing files in local storage.",
          confidenceScore: 0.94,
        };
      }
      const filesHealth = this.getHealthStatus("device.files");
      return {
        chosenModality: "filesystem_mutation",
        primaryCapabilityId: undefined,
        fallbackCapabilityIds: [],
        justification: `[${filesHealth.state}]: Filesystem capability is currently unavailable (${filesHealth.state}).${filesHealth.remediationAction ? ` Remediation: ${filesHealth.remediationAction}.` : ""}`,
        confidenceScore: 0.35,
      };
    }

    // 7. Interactive Browser Session vs Simple Web Search
    // Interactive browser keywords: navigate, click, dom, form, session, visit url, inspect page
    const isInteractiveBrowser =
      hasAnyToken("browser_session", "session", "navigate", "click", "fill", "form", "dom", "inspect", "open url", "visit") ||
      /(?:https?:\/\/|www\.)\S+/.test(lowerObj);

    if (isInteractiveBrowser && !hasAnyToken("headlines", "search web for", "google search")) {
      const candidates = ["device.browser", "web.scraper"].filter((id) => this.has(id));
      const healthyCandidates = candidates.filter((id) => this.getHealthStatus(id).state === "AVAILABLE");
      const primaryTool = healthyCandidates[0];
      const fallbacks = healthyCandidates.slice(1);
      if (primaryTool) {
        return {
          chosenModality: "browser_session",
          primaryCapabilityId: primaryTool,
          fallbackCapabilityIds: fallbacks,
          justification: primaryTool === "device.browser"
            ? "Task requires interactive browser navigation, DOM inspection, or session interaction."
            : `Primary browser 'device.browser' is unavailable (${this.getHealthStatus("device.browser").state}); routed to healthy alternative '${primaryTool}'.`,
          confidenceScore: 0.93,
        };
      }
      const browserHealth = this.getHealthStatus("device.browser");
      return {
        chosenModality: "user_clarification",
        primaryCapabilityId: undefined,
        fallbackCapabilityIds: [],
        justification: `[${browserHealth.state}]: Interactive browser capability is currently unavailable (${browserHealth.state}).${browserHealth.diagnosticDetails ? ` ${browserHealth.diagnosticDetails}` : ""}${browserHealth.remediationAction ? ` Remediation: ${browserHealth.remediationAction}.` : ""}`,
        confidenceScore: 0.25,
      };
    }

    // 8. Factual Web Queries & News Requiring Real-Time Freshness -> web_search
    // Anti-Pattern: Do not route factual web queries to direct LLM generation without search verification when freshness is required.
    const isDeviceSensorQuery = hasAnyToken("screenshot", "location", "screen", "clipboard", "gps", "camera", "photo", "app", "apps", "application", "applications", "installed", "whatsapp", "reminder", "reminders", "alarm", "calendar", "call", "wake", "reach");
    const isWebSearch =
      !isDeviceSensorQuery &&
      (request.requiredDataFreshness === "realtime" ||
        (request.requiredDataFreshness !== "historical" &&
          (hasAnyToken(
            "search", "headlines", "news", "today", "weather", "stock", "price", "latest", "lookup", "recent",
            "internet", "from the internet", "web", "online", "ipl", "table", "standings", "scorecard", "score",
            "match", "tournament", "league", "points", "game", "last game", "last match", "fours", "sixes",
            "goals", "runs", "wickets", "stats", "statistics", "who won", "how many", "winner", "result", "results",
            "box office", "nobel"
          ) ||
            (hasAnyToken("current") && hasAnyToken("weather", "stock", "price", "news", "events", "exchange", "rate", "temperature"))
          )
        )
      );

    if (isWebSearch) {
      const candidates = ["device.browser", "web.scraper"].filter((id) => this.has(id));
      const healthyCandidates = candidates.filter((id) => this.getHealthStatus(id).state === "AVAILABLE");
      const primaryTool = healthyCandidates[0];
      const fallbacks = healthyCandidates.slice(1);
      if (primaryTool) {
        return {
          chosenModality: "web_search",
          primaryCapabilityId: primaryTool,
          fallbackCapabilityIds: fallbacks,
          justification: primaryTool === "device.browser"
            ? "Factual query requires real-time data freshness; routed to web search capability to prevent hallucinations."
            : `Factual query routed to healthy web scraper '${primaryTool}' because browser is ${this.getHealthStatus("device.browser").state}.`,
          confidenceScore: 0.94,
        };
      }
      return {
        chosenModality: "user_clarification",
        primaryCapabilityId: undefined,
        fallbackCapabilityIds: [],
        justification: `${ERR_NO_CAPABLE_TOOL}: Web search capabilities are currently offline or unavailable.`,
        confidenceScore: 0.20,
      };
    }

    // 9. Android Device Gesture / Hardware Sensor -> device_gesture
    let matchedDeviceTool: string | undefined;
    if (hasAnyToken("phone control", "control phone", "automation", "phone_control", "phone assistant", "tap screen", "type text", "scroll screen", "global action")) matchedDeviceTool = "device.phone_control";
    else if (
      hasAnyToken("call me", "call-like", "wake me up", "wake me", "alarm", "reach") ||
      (hasAnyToken("call") && hasAnyToken("minute", "minutes", "hour", "hours", "remind", "reminder", "at", "tomorrow", "tonight", "in"))
    ) {
      matchedDeviceTool = "device.reach";
    }
    else if (hasAnyToken("post a notification", "notification", "notify")) matchedDeviceTool = "device.notifications";
    else if (hasAnyToken("remind", "reminder", "reminders")) matchedDeviceTool = "device.reminders";
    else if (hasAnyToken("camera", "photo", "picture")) matchedDeviceTool = "device.camera";
    else if (hasAnyToken("screenshot", "capture screen")) matchedDeviceTool = "device.screenshot";
    else if (hasAnyToken("clipboard", "copy", "paste")) matchedDeviceTool = "device.clipboard";
    else if (hasAnyToken("calendar", "event", "schedule")) matchedDeviceTool = "device.calendar";
    else if (hasAnyToken("contact", "contacts", "phone number", "address book")) matchedDeviceTool = "device.contacts";
    else if (hasAnyToken("location", "gps", "coordinates", "where am i")) matchedDeviceTool = "device.location";
    else if (hasAnyToken("media", "audio", "music", "play")) matchedDeviceTool = "device.media";
    else if (hasAnyToken("app", "apps", "application", "applications", "launch", "open app", "installed", "package", "packages") || isLocalAppQuery) matchedDeviceTool = "device.apps";
    else if (hasAnyToken("share")) matchedDeviceTool = "device.share";

    if (matchedDeviceTool) {
      if (this.has(matchedDeviceTool)) {
        const health = this.getHealthStatus(matchedDeviceTool);
        if (health.state === "AVAILABLE") {
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
          justification: `[${health.state}]: Android capability '${matchedDeviceTool}' cannot be selected because it is currently ${health.state}.${health.diagnosticDetails ? ` ${health.diagnosticDetails}` : ""}${health.remediationAction ? ` Remediation: ${health.remediationAction}.` : ""}`,
          confidenceScore: 0.20,
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
        const health = this.getHealthStatus(id);
        if (health.state === "AVAILABLE") {
          return {
            chosenModality: "device_gesture",
            primaryCapabilityId: id,
            fallbackCapabilityIds: [],
            justification: `Task keywords matched registered capability '${id}'.`,
            confidenceScore: 0.85,
          };
        }
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

  device_capability_health: {
    description:
      'Check authoritative live operational state and health diagnostics of registered Android capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        capabilityId: { type: 'string', description: 'Optional capability ID, e.g. "device.browser". If omitted, probes all capabilities.' },
        force: { type: 'boolean', description: 'Force bypass health cache.' },
      },
    },
    handler: async (args: Record<string, unknown>, signal?: AbortSignal) => {
      const capabilityId = typeof args.capabilityId === 'string' ? args.capabilityId.trim() : '';
      const force = Boolean(args.force);
      if (capabilityId) {
        const status = await defaultCapabilityRegistry.probeHealth(capabilityId, { force, signal });
        return { status };
      }
      const all = await defaultCapabilityRegistry.probeAll({ force, signal });
      return { statuses: Object.fromEntries(all.entries()) };
    },
  },

  device_capability_risk: {
    description:
      'Evaluate the risk tier, confirmation requirements, reversibility, and impact description for an action under an approval mode.',
    inputSchema: {
      type: 'object',
      properties: {
        capabilityId: { type: 'string', description: 'Capability identifier, e.g. "device.files"' },
        operation: { type: 'string', description: 'Operation name, e.g. "delete"' },
        parameters: { type: 'object', description: 'Parameters for the operation' },
        approvalMode: { type: 'string', enum: ['ask', 'edits', 'auto', 'full'], default: 'ask' },
      },
      required: ['capabilityId', 'operation'],
    },
    handler: async (args: Record<string, unknown>) => {
      const capabilityId = String(args.capabilityId || '');
      const operation = String(args.operation || '');
      const parameters = (args.parameters as Record<string, unknown>) || {};
      const approvalMode = (args.approvalMode as 'ask' | 'edits' | 'auto' | 'full') || 'ask';
      const evaluation = DeviceSafetyPolicy.evaluateRisk({
        capabilityId,
        operation,
        parameters,
        approvalMode,
      });
      return { evaluation };
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
    if (/\b(?:today|tonight|right now|live|current|latest|recent|news|headlines|weather|stock|price|last\s+(?:game|match|innings|season|race|fight)|fours?|sixes?|scorecard|runs?|wickets?|goals?|stats?|who\s+won|points\s+table|standings)\b/i.test(lowerObj)) {
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

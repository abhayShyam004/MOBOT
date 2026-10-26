/**
 * Types and interfaces for the Device Capability Registry (Phase P).
 *
 * Provides a clean, extensible abstraction layer over Android device actions
 * so the agent sees capabilities, schemas, and risk tiers rather than
 * implementation-specific Android internals.
 */

export type RiskTier = 'low' | 'medium' | 'high';

export type LifecycleBehavior = 'stateless' | 'transient' | 'persistent';

export type CapabilityErrorCategory =
  | 'permission_denied'
  | 'unavailable'
  | 'invalid_input'
  | 'execution_failed'
  | 'cancelled';

export interface CapabilityError {
  code: string;
  message: string;
  category: CapabilityErrorCategory;
  details?: unknown;
}

export interface CapabilityResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: CapabilityError;
}

export interface OperationSchema {
  name: string;
  description: string;
  risk: RiskTier;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface CapabilityAvailability {
  supported: boolean;
  reason?: string;
}

export interface CapabilityContext {
  workspace?: string;
  botId?: string;
  threadId?: string;
  turnId?: string;
  signal?: AbortSignal;
  approvalMode?: 'ask' | 'edits' | 'auto' | 'full' | 'custom';
  askApproval?: (summary: string) => Promise<boolean>;
  confirmationGrant?: ActionConfirmationGrant;
  confirmationToken?: string;
}

export interface DeviceCapabilityMetadata {
  id: string;
  name: string;
  description: string;
  availability: CapabilityAvailability;
  requiredPermissions: string[];
  riskClassification: RiskTier;
  lifecycleBehavior: LifecycleBehavior;
  supportedOperations: Array<{
    name: string;
    description: string;
    risk: RiskTier;
  }>;
}

export interface DeviceCapabilityDescription extends DeviceCapabilityMetadata {
  operations: OperationSchema[];
}

export interface DeviceCapability {
  id: string;
  name: string;
  description: string;
  availability: CapabilityAvailability;
  requiredPermissions: string[];
  supportedOperations: OperationSchema[];
  riskClassification: RiskTier;
  lifecycleBehavior: LifecycleBehavior;

  execute(
    operation: string,
    params: Record<string, unknown>,
    context?: CapabilityContext
  ): Promise<CapabilityResult>;

  /**
   * Official Roadmap Phase 13: Capability State Awareness live probe.
   * Probes active driver, permissions, external authentication, and connectivity.
   */
  checkHealth?(
    context?: CapabilityContext,
    signal?: AbortSignal
  ): Promise<CapabilityHealthStatus>;
}

// ── Official Roadmap Phase 13: Capability State Awareness (mobot_54_phases_prompt.md:868-925) ──

export const ERR_CAPABILITY_PROBE_FAILED = 'ERR_CAPABILITY_PROBE_FAILED';

export type CapabilityOperationalState =
  | 'AVAILABLE'
  | 'PERMISSION_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'DRIVER_OFFLINE'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_MISSING'
  | 'TEMPORARILY_UNAVAILABLE';

export type CapabilityRemediationAction =
  | 'prompt_permission'
  | 'prompt_auth'
  | 'restart_driver'
  | 'wait';

export interface CapabilityHealthStatus {
  capabilityId: string;
  state: CapabilityOperationalState;
  lastCheckedMs: number;
  diagnosticDetails?: string;
  remediationAction?: CapabilityRemediationAction;
}

// ── Official Roadmap Phase 14: Risk-Aware Autonomy (mobot_54_phases_prompt.md:925-995) ──

export const ERR_CONFIRMATION_REQUIRED = 'ERR_CONFIRMATION_REQUIRED';
export const ERR_CONFIRMATION_REJECTED = 'ERR_CONFIRMATION_REJECTED';
export const ERR_CONFIRMATION_EXPIRED = 'ERR_CONFIRMATION_EXPIRED';
export const ERR_CONFIRMATION_INVALID = 'ERR_CONFIRMATION_INVALID';

export interface RiskEvaluationRequest {
  capabilityId: string;
  operation: string;
  parameters: Record<string, unknown>;
  approvalMode: 'ask' | 'edits' | 'auto' | 'full';
}

export interface RiskEvaluationResult {
  tier: RiskTier;
  requiresExplicitConfirmation: boolean;
  consequentialImpactDescription: string;
  reversible: boolean;
  isMassDeletion?: boolean;
}

export interface ActionConfirmationGrant {
  grantId: string;
  capabilityId: string;
  operation: string;
  parameterHash: string;
  approvedAtMs: number;
  expiresAtMs: number;
  consumed: boolean;
  botId?: string;
  threadId?: string;
}

// ── Official Roadmap Phase 11: Intelligent Capability Selection (mobot_54_phases_prompt.md:752-778) ──

export const ERR_NO_CAPABLE_TOOL = 'ERR_NO_CAPABLE_TOOL';

export type ExecutionModality =
  | 'direct_answer'
  | 'web_search'
  | 'browser_session'
  | 'terminal_command'
  | 'filesystem_mutation'
  | 'device_gesture'
  | 'composio_service'
  | 'specialist_handoff'
  | 'user_clarification';

export interface CapabilityMatchRequest {
  objective: string;
  contextKeywords: string[];
  requiredDataFreshness: 'realtime' | 'static' | 'historical';
  targetDevice: 'android_local' | 'cloud_vps' | 'external_saas';
  activeBotId: string;
}

export interface CapabilityMatchResolution {
  chosenModality: ExecutionModality;
  primaryCapabilityId?: string;
  fallbackCapabilityIds: string[];
  justification: string;
  confidenceScore: number;
}

// ── Corrective Phase: Enforceable Action-Result Truthfulness Framework ──

export type ActionResultStatus =
  | 'UNAVAILABLE'
  | 'NOT_ATTEMPTED'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

export interface ActionResultEvidence {
  resourceId?: string;
  resourceUri?: string;
  artifactPath?: string;
  verifiedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ActionResultReceipt {
  operationId: string;
  actionType: 'calendar.create_event' | 'device.phone_control' | 'reminder.schedule' | 'service.mutation' | string;
  status: ActionResultStatus;
  evidence?: ActionResultEvidence;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  attemptedAt: number;
  botId?: string;
  threadId?: string;
  turnId?: string;
}


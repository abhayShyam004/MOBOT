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


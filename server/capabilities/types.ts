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

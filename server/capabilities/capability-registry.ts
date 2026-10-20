/**
 * Device Capability Registry (Phase P).
 *
 * Central registry and dispatcher for all Android device capabilities.
 * Allows adding, querying, and invoking capabilities with schemas and risk classifications.
 */

import type {
  DeviceCapability,
  DeviceCapabilityMetadata,
  DeviceCapabilityDescription,
  CapabilityResult,
  CapabilityContext,
} from './types.ts';
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
  MediaCapability,
  LocationCapability,
} from './default-capabilities.ts';

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
    this.register(new MediaCapability());
    this.register(new LocationCapability());
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
      return await cap.execute(operation, params, context);
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

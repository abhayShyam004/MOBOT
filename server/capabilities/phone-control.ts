/**
 * Native Android Phone Control Capability (Phase 35 Foundation).
 *
 * Provides user-authorized phone automation without runtime ADB dependency:
 * - Semantic UI hierarchy observation & element targeting
 * - Native gesture dispatch (tap, swipe, scroll, text injection)
 * - Native application launching via Android Intents
 * - API 30+ native screenshot acquisition
 * - Communicates with in-app PhoneDriverServer over loopback HTTP or falls back to ADB
 */

import { basename } from 'node:path';
import type {
  DeviceCapability,
  CapabilityResult,
  CapabilityContext,
  CapabilityHealthStatus,
  OperationSchema,
  CapabilityErrorCategory,
} from './types.ts';
import { checkLivePhoneControlAvailability } from './action-truthfulness.ts';
import { validateScreenFrameBytes } from '../screen-frame-gate.ts';
import { saveImage } from '../attachments.ts';

export type PhoneControlState =
  | 'UNAVAILABLE'
  | 'DRIVER_STARTING'
  | 'DRIVER_NOT_READY'
  | 'DRIVER_READY'
  | 'ACCESSIBILITY_DISABLED'
  | 'ACCESSIBILITY_CONNECTING'
  | 'ACCESSIBILITY_DISCONNECTED'
  | 'ACCESSIBILITY_READY'
  | 'PERMISSION_SETUP_REQUIRED'
  | 'AWAITING_USER_SYSTEM_ACTION'
  | 'APP_LAUNCH_REQUESTED'
  | 'APP_FOREGROUND_PENDING'
  | 'APP_FOREGROUND_VERIFIED'
  | 'TARGET_CONTENT_PENDING'
  | 'TARGET_CONTENT_VERIFIED'
  | 'INTERACTION_PENDING'
  | 'INTERACTION_VERIFIED'
  | 'SCREEN_CAPTURE_PENDING'
  | 'SCREEN_CAPTURE_VERIFIED'
  | 'RECOVERABLE_FAILURE'
  | 'TERMINAL_FAILURE';

export interface PhoneControlStatusReport {
  state: PhoneControlState;
  operational: boolean;
  accessibilityEnabled: boolean;
  connected: boolean;
  foregroundPackage: string;
  mode: 'native_loopback' | 'adb_usb' | 'offline';
  reason?: string;
  timestampMs: number;
}

export interface SuspendedPhoneControlTask {
  taskId: string;
  threadId: string;
  botId: string;
  objective: string;
  missingRequirement: 'accessibility' | 'notification' | 'overlay' | 'provider';
  pendingAction: {
    capabilityId: string;
    operation: string;
    parameters: Record<string, unknown>;
  };
  state: PhoneControlState;
  createdAtMs: number;
}

export class PhoneControlTaskCheckpointManager {
  private static instance: PhoneControlTaskCheckpointManager;
  private readonly checkpoints = new Map<string, SuspendedPhoneControlTask>();

  static getInstance(): PhoneControlTaskCheckpointManager {
    if (!PhoneControlTaskCheckpointManager.instance) {
      PhoneControlTaskCheckpointManager.instance = new PhoneControlTaskCheckpointManager();
    }
    return PhoneControlTaskCheckpointManager.instance;
  }

  suspendTask(checkpoint: SuspendedPhoneControlTask): void {
    this.checkpoints.set(checkpoint.threadId, checkpoint);
  }

  getSuspendedTask(threadId: string): SuspendedPhoneControlTask | undefined {
    return this.checkpoints.get(threadId);
  }

  clearTask(threadId: string): void {
    this.checkpoints.delete(threadId);
  }
}

export class PhoneControlCapability implements DeviceCapability {
  readonly id = 'device.phone_control';
  readonly name = 'Phone Control & Automation';
  readonly description =
    'Perform user-authorized cross-app automation, semantic screen observation, and native gestures without ADB at runtime.';
  readonly availability = { supported: true };
  readonly requiredPermissions = ['android.permission.BIND_ACCESSIBILITY_SERVICE'];
  readonly riskClassification = 'medium' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'status',
      description: 'Check operational status of native Android phone automation and AccessibilityService.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          operational: { type: 'boolean' },
          accessibilityEnabled: { type: 'boolean' },
          foregroundPackage: { type: 'string' },
          mode: { type: 'string', enum: ['native_loopback', 'adb_usb', 'offline'] },
        },
      },
    },
    {
      name: 'read_screen',
      description: 'Read the active foreground package and semantic UI hierarchy of the connected Android screen.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          currentPackage: { type: 'string' },
          nodeCount: { type: 'number' },
          nodes: { type: 'array' },
        },
      },
    },
    {
      name: 'tap',
      description: 'Tap on a UI element matching text/id or screen coordinates.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Semantic text or contentDescription to tap' },
          id: { type: 'string', description: 'Resource view ID to tap' },
          x: { type: 'number', description: 'Screen X coordinate' },
          y: { type: 'number', description: 'Screen Y coordinate' },
          exact: { type: 'boolean', description: 'Whether text matching is exact' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          tapped: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'type_text',
      description: 'Inject text into the active focused input field.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to input' },
        },
        required: ['text'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          typed: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'scroll',
      description: 'Scroll the active window or container.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right', 'forward', 'backward'],
            description: 'Scroll direction',
          },
        },
        required: ['direction'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          scrolled: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'press_key',
      description: 'Perform a global Android navigation action (back, home, recents, notifications).',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: ['back', 'home', 'recents', 'notifications'],
            description: 'Global action key',
          },
        },
        required: ['key'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          pressed: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'open_app',
      description: 'Launch an application by its package name or human name.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          packageName: { type: 'string', description: 'Package name to launch' },
        },
        required: ['packageName'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          launched: { type: 'boolean' },
          packageName: { type: 'string' },
          foregroundPackage: { type: 'string' },
        },
      },
    },
    {
      name: 'take_screenshot',
      description: 'Capture a native screenshot of the Android screen without ADB.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          includeBase64: { type: 'boolean', description: 'Whether to return image base64 data' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          base64: { type: 'string' },
        },
      },
    },
    {
      name: 'setup_permission',
      description: 'Initiate user-controlled permission setup flow (accessibility settings, app details settings, or notifications) on Android.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['accessibility', 'app_settings', 'notifications'], description: 'Type of permission setup to open' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          opened: { type: 'boolean' },
          type: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'list_apps',
      description: 'List installed launchable applications directly from native Android PackageManager.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          apps: { type: 'array' },
          count: { type: 'number' },
        },
      },
    },
    {
      name: 'restore_host',
      description: 'Restore the MOBOT companion application to the foreground after controlling another app.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          restored: { type: 'boolean' },
          foregroundPackage: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  ];

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

  /**
   * Official Roadmap Phase 13: Capability State Awareness live health probe.
   */
  async checkHealth(
    _context?: CapabilityContext,
    signal?: AbortSignal
  ): Promise<CapabilityHealthStatus> {
    const truthStatus = checkLivePhoneControlAvailability();
    if (!truthStatus.operational && truthStatus.reason?.toLowerCase().includes("mock")) {
      return {
        capabilityId: this.id,
        state: 'DRIVER_OFFLINE',
        lastCheckedMs: Date.now(),
        diagnosticDetails: truthStatus.reason,
        remediationAction: 'restart_driver',
      };
    }

    const nativePort = process.env.PH_DRIVER_PORT;
    const isNativeAvailable = Boolean(nativePort && Number(nativePort) > 0);

    if (isNativeAvailable) {
      try {
        const statusData = await this.callNativeDriver('/status', { signal });
        if (statusData.accessibilityEnabled === false || statusData.reason?.includes('AccessibilityService not enabled')) {
          return {
            capabilityId: this.id,
            state: 'PERMISSION_REQUIRED',
            lastCheckedMs: Date.now(),
            diagnosticDetails: statusData.reason || 'AccessibilityService permission is disabled or not granted.',
            remediationAction: 'prompt_permission',
          };
        }
        if (!statusData.connected) {
          return {
            capabilityId: this.id,
            state: 'DRIVER_OFFLINE',
            lastCheckedMs: Date.now(),
            diagnosticDetails: statusData.reason || 'Native driver not connected',
            remediationAction: 'restart_driver',
          };
        }
        return {
          capabilityId: this.id,
          state: 'AVAILABLE',
          lastCheckedMs: Date.now(),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof Error && (err.name === 'AbortError' || msg.includes('aborted'))) {
          throw err;
        }
        return {
          capabilityId: this.id,
          state: 'DRIVER_OFFLINE',
          lastCheckedMs: Date.now(),
          diagnosticDetails: `Native phone driver offline: ${msg}`,
          remediationAction: 'restart_driver',
        };
      }
    }

    if (process.env.OMB_PHONE_DRIVER_ACTIVE === '1') {
      return {
        capabilityId: this.id,
        state: 'AVAILABLE',
        lastCheckedMs: Date.now(),
        diagnosticDetails: 'Physical USB ADB phone driver is active',
      };
    }

    return {
      capabilityId: this.id,
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'Native phone driver loopback port (PH_DRIVER_PORT) is not set.',
      remediationAction: 'restart_driver',
    };
  }

  async execute(
    operation: string,
    params: Record<string, unknown>,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    const nativePort = process.env.PH_DRIVER_PORT;
    const isNativeAvailable = Boolean(nativePort && Number(nativePort) > 0);

    // 1. Status Check
    if (operation === 'status') {
      if (isNativeAvailable) {
        try {
          const statusData = await this.callNativeDriver('/status');
          const operational = Boolean(statusData.connected);
          const accessibilityEnabled = Boolean(statusData.accessibilityEnabled);
          const state: PhoneControlState = operational && accessibilityEnabled
            ? 'ACCESSIBILITY_READY'
            : !accessibilityEnabled
              ? 'ACCESSIBILITY_DISABLED'
              : 'DRIVER_NOT_READY';
          return {
            success: true,
            data: {
              state,
              operational,
              accessibilityEnabled,
              connected: operational,
              foregroundPackage: statusData.foregroundPackage || 'unknown',
              mode: 'native_loopback',
              reason: statusData.reason,
              timestampMs: Date.now(),
            },
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: true,
            data: {
              state: 'UNAVAILABLE' as PhoneControlState,
              operational: false,
              accessibilityEnabled: false,
              connected: false,
              foregroundPackage: 'unknown',
              mode: 'native_loopback',
              reason: `Native phone driver offline: ${msg}`,
              timestampMs: Date.now(),
            },
          };
        }
      }

      const adbStatus = checkLivePhoneControlAvailability();
      return {
        success: true,
        data: {
          operational: adbStatus.operational,
          mode: adbStatus.operational ? 'adb_usb' : 'offline',
          reason: adbStatus.reason,
        },
      };
    }

    // 2. Operations with Native Loopback Driver
    if (isNativeAvailable) {
      try {
        if (operation === 'read_screen') {
          const data = await this.callNativeDriver('/screen');
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_READ_SCREEN',
                message: data.error || 'Failed to read screen',
                category: 'execution_failed',
              },
            };
          }
          return { success: true, data };
        }

        if (operation === 'tap') {
          const data = await this.callNativeDriver('/tap', {
            method: 'POST',
            body: {
              text: params.text,
              id: params.id,
              x: params.x,
              y: params.y,
              exact: params.exact,
              gesture: params.gesture,
              swipeVector: params.swipeVector,
            },
          });
          if (!data.ok) {
            const isScreenLocked = data.code === 'ERR_SCREEN_LOCKED';
            const errCategory: CapabilityErrorCategory = data.code === 'ERR_SECURITY_RESTRICTED'
              ? 'permission_denied'
              : isScreenLocked
                ? 'unavailable'
                : 'execution_failed';
            return {
              success: false,
              error: {
                code: data.code || 'ERR_TAP_FAILED',
                message: data.error || 'Tap action failed',
                category: errCategory,
                details: { recoverable: isScreenLocked },
              },
            };
          }
          return { success: true, data: { tapped: true, message: data.message } };
        }

        if (operation === 'type_text') {
          const text = String(params.text || '');
          const data = await this.callNativeDriver('/type', {
            method: 'POST',
            body: { text },
          });
          if (!data.ok) {
            const isScreenLocked = data.code === 'ERR_SCREEN_LOCKED';
            const errCategory: CapabilityErrorCategory = isScreenLocked ? 'unavailable' : 'execution_failed';
            return {
              success: false,
              error: {
                code: data.code || 'ERR_TYPE_FAILED',
                message: data.error || 'Text input failed',
                category: errCategory,
                details: { recoverable: isScreenLocked },
              },
            };
          }
          return { success: true, data: { typed: true, message: data.message } };
        }

        if (operation === 'scroll') {
          const direction = String(params.direction || 'down');
          const data = await this.callNativeDriver('/scroll', {
            method: 'POST',
            body: { direction },
          });
          if (!data.ok) {
            const isScreenLocked = data.code === 'ERR_SCREEN_LOCKED';
            const errCategory: CapabilityErrorCategory = isScreenLocked ? 'unavailable' : 'execution_failed';
            return {
              success: false,
              error: {
                code: data.code || 'ERR_SCROLL_FAILED',
                message: data.error || 'Scroll action failed',
                category: errCategory,
                details: { recoverable: isScreenLocked },
              },
            };
          }
          return { success: true, data: { scrolled: true, message: data.message } };
        }

        if (operation === 'press_key') {
          const key = String(params.key || 'back');
          const data = await this.callNativeDriver('/key', {
            method: 'POST',
            body: { key },
          });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_KEY_FAILED',
                message: data.error || 'Key action failed',
                category: 'execution_failed',
              },
            };
          }
          return { success: true, data: { pressed: true, message: data.message } };
        }

        if (operation === 'open_app') {
          const packageName = String(params.packageName || '').trim();
          const name = String(params.name || '').trim();
          const data = await this.callNativeDriver('/open_app', {
            method: 'POST',
            body: { packageName, name },
          });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_OPEN_APP_FAILED',
                message: data.error || `Could not open application ${packageName || name}`,
                category: 'execution_failed',
              },
            };
          }
          if (data.settled === false && data.foregroundPackage && data.foregroundPackage !== 'unknown') {
            return {
              success: false,
              error: {
                code: 'ERR_APP_LAUNCH_NOT_VERIFIED',
                message: data.error || `Application ${packageName || name} did not become foreground (current foreground package: ${data.foregroundPackage})`,
                category: 'execution_failed',
              },
            };
          }
          return {
            success: true,
            data: {
              launched: true,
              packageName: data.packageName || packageName,
              settled: data.settled ?? true,
              foregroundPackage: data.foregroundPackage,
              message: data.message,
            },
          };
        }

        if (operation === 'setup_permission') {
          const type = String(params.type || 'accessibility');
          const data = await this.callNativeDriver('/setup_permission', {
            method: 'POST',
            body: { type },
          });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_SETUP_PERMISSION_FAILED',
                message: data.error || `Could not open permission setup for ${type}`,
                category: 'execution_failed',
              },
            };
          }
          return { success: true, data };
        }

        if (operation === 'list_apps') {
          const data = await this.callNativeDriver('/apps');
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_LIST_APPS_FAILED',
                message: data.error || 'Failed to list applications',
                category: 'execution_failed',
              },
            };
          }
          return { success: true, data };
        }

        if (operation === 'restore_host') {
          const data = await this.callNativeDriver('/restore_host', { method: 'POST' });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_RESTORE_FAILED',
                message: data.error || 'Failed to restore companion host application to foreground',
                category: 'execution_failed',
              },
            };
          }
          return {
            success: true,
            data: {
              restored: data.restored ?? true,
              foregroundPackage: data.foregroundPackage,
              message: data.message,
            },
          };
        }

        if (operation === 'take_screenshot') {
          const data = await this.callNativeDriver('/screenshot', {
            method: 'POST',
            body: { includeBase64: true },
          });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_SCREENSHOT_FAILED',
                message: data.error || 'Screenshot capture failed',
                category: 'execution_failed',
              },
            };
          }

          let urlPath = '';
          let savedFilename = '';
          if (data.base64) {
            try {
              const buf = Buffer.from(data.base64, 'base64');
              validateScreenFrameBytes(buf);
              const saved = saveImage(buf, 'image/png');
              savedFilename = basename(saved.path);
              urlPath = `/api/attachments/${savedFilename}`;
            } catch (saveErr) {
              console.warn('[PhoneControlCapability] Failed to save screenshot attachment:', saveErr);
            }
          }

          return {
            success: true,
            data: {
              ...data,
              ...(urlPath ? {
                urlPath,
                path: urlPath,
                attachment: {
                  kind: 'image' as const,
                  path: urlPath,
                  mime: 'image/png',
                  name: savedFilename,
                },
              } : {}),
            },
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: {
            code: 'DRIVER_ERROR',
            message: `Native phone control execution failed: ${msg}`,
            category: 'execution_failed',
          },
        };
      }
    }

    // 3. Fallback when native loopback is not active (e.g. desktop dev or ADB tether)
    return {
      success: false,
      error: {
        code: 'ERR_DRIVER_OFFLINE',
        message: 'Native Android Phone Driver is offline in this session',
        category: 'unavailable',
      },
    };
  }
}

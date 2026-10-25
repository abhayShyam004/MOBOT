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

import {
  DeviceCapability,
  CapabilityResult,
  CapabilityContext,
  OperationSchema,
} from './types.ts';
import { checkLivePhoneControlAvailability } from './action-truthfulness.ts';

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
  ];

  private async callNativeDriver(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<any> {
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
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    const nativePort = process.env.PH_DRIVER_PORT;
    const isNativeAvailable = Boolean(nativePort && Number(nativePort) > 0);

    // 1. Status Check
    if (operation === 'status') {
      if (isNativeAvailable) {
        try {
          const statusData = await this.callNativeDriver('/status');
          return {
            success: true,
            data: {
              operational: Boolean(statusData.connected),
              accessibilityEnabled: Boolean(statusData.accessibilityEnabled),
              foregroundPackage: statusData.foregroundPackage || 'unknown',
              mode: 'native_loopback',
              reason: statusData.reason,
            },
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: true,
            data: {
              operational: false,
              accessibilityEnabled: false,
              mode: 'native_loopback',
              reason: `Native phone driver offline: ${msg}`,
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
            },
          });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_TAP_FAILED',
                message: data.error || 'Tap action failed',
                category: 'execution_failed',
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
            return {
              success: false,
              error: {
                code: data.code || 'ERR_TYPE_FAILED',
                message: data.error || 'Text input failed',
                category: 'execution_failed',
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
            return {
              success: false,
              error: {
                code: data.code || 'ERR_SCROLL_FAILED',
                message: data.error || 'Scroll action failed',
                category: 'execution_failed',
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
          const data = await this.callNativeDriver('/open_app', {
            method: 'POST',
            body: { packageName },
          });
          if (!data.ok) {
            return {
              success: false,
              error: {
                code: data.code || 'ERR_OPEN_APP_FAILED',
                message: data.error || `Could not open application ${packageName}`,
                category: 'execution_failed',
              },
            };
          }
          return {
            success: true,
            data: {
              launched: true,
              packageName,
              foregroundPackage: data.foregroundPackage,
            },
          };
        }

        if (operation === 'take_screenshot') {
          const data = await this.callNativeDriver('/screenshot', {
            method: 'POST',
            body: { includeBase64: Boolean(params.includeBase64) },
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
          return { success: true, data };
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

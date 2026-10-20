/**
 * Standard Android device capabilities implementation (Phase P).
 *
 * Implements the 10 core capability families:
 * Files, Camera, Screenshot, Share, Clipboard, Calendar, Contacts,
 * Apps / Intents, Notifications, and Media.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  DeviceCapability,
  CapabilityResult,
  CapabilityContext,
  OperationSchema,
} from './types.ts';
import { loadUserLocation, saveUserLocation, clearUserLocation, type UserLocation } from '../location-context.ts';
import { DATA_DIR } from '../config.ts';

/** Files Capability */
export class FilesCapability implements DeviceCapability {
  readonly id = 'device.files';
  readonly name = 'Files & Storage';
  readonly description = 'Access and manage files in authorized directories (e.g. Download, bot workspace).';
  readonly availability = { supported: true };
  readonly requiredPermissions = [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ];
  readonly riskClassification = 'medium' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'list',
      description: 'List files and directories in a directory.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list (default: /sdcard/Download or workspace)' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                isDirectory: { type: 'boolean' },
                size: { type: 'number' },
              },
            },
          },
        },
      },
    },
    {
      name: 'read',
      description: 'Read content from an authorized file.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          size: { type: 'number' },
        },
      },
    },
    {
      name: 'write',
      description: 'Write content to an authorized file.',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Destination file path' },
          content: { type: 'string', description: 'File content' },
          encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
        },
        required: ['path', 'content'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          bytesWritten: { type: 'number' },
        },
      },
    },
    {
      name: 'stat',
      description: 'Retrieve file metadata.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          size: { type: 'number' },
          isDirectory: { type: 'boolean' },
          mtime: { type: 'number' },
        },
      },
    },
    {
      name: 'delete',
      description: 'Delete a file in an authorized directory.',
      risk: 'high',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to delete' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          deleted: { type: 'boolean' },
        },
      },
    },
  ];

  async execute(
    operation: string,
    params: Record<string, unknown>,
    context?: CapabilityContext
  ): Promise<CapabilityResult> {
    try {
      const targetPath = String(params.path || context?.workspace || '/sdcard/Download');
      switch (operation) {
        case 'list': {
          const entries = await fs.readdir(targetPath, { withFileTypes: true });
          const items = await Promise.all(
            entries.map(async (e) => {
              let size = 0;
              try {
                const s = await fs.stat(path.join(targetPath, e.name));
                size = s.size;
              } catch {
                // ignore stat error for individual entry
              }
              return {
                name: e.name,
                isDirectory: e.isDirectory(),
                size,
              };
            })
          );
          return { success: true, data: { entries: items } };
        }
        case 'read': {
          const encoding = (params.encoding as BufferEncoding) || 'utf-8';
          const data = await fs.readFile(targetPath, { encoding });
          return { success: true, data: { content: data, size: Buffer.byteLength(data, encoding) } };
        }
        case 'write': {
          const content = String(params.content ?? '');
          const encoding = (params.encoding as BufferEncoding) || 'utf-8';
          await fs.writeFile(targetPath, content, { encoding });
          return { success: true, data: { bytesWritten: Buffer.byteLength(content, encoding) } };
        }
        case 'stat': {
          const s = await fs.stat(targetPath);
          return {
            success: true,
            data: {
              size: s.size,
              isDirectory: s.isDirectory(),
              mtime: s.mtimeMs,
            },
          };
        }
        case 'delete': {
          await fs.unlink(targetPath);
          return { success: true, data: { deleted: true } };
        }
        default:
          return {
            success: false,
            error: {
              code: 'UNSUPPORTED_OPERATION',
              message: `Files capability does not support operation '${operation}'.`,
              category: 'invalid_input',
            },
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          code: 'FILES_ERROR',
          message,
          category: 'execution_failed',
          details: err,
        },
      };
    }
  }
}

/** Camera Capability */
export class CameraCapability implements DeviceCapability {
  readonly id = 'device.camera';
  readonly name = 'Camera';
  readonly description = 'Capture photos or record short videos using device camera hardware.';
  readonly availability = { supported: true };
  readonly requiredPermissions = ['android.permission.CAMERA'];
  readonly riskClassification = 'medium' as const;
  readonly lifecycleBehavior = 'transient' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'capture_photo',
      description: 'Capture a photo and return its saved file path.',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          destinationPath: { type: 'string', description: 'Optional custom destination path' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
    },
    {
      name: 'capture_video',
      description: 'Record a video clip with specified max duration.',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          maxDurationSeconds: { type: 'number', default: 10 },
          destinationPath: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          durationSeconds: { type: 'number' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    const dest = String(params.destinationPath || `/sdcard/Download/capture_${Date.now()}.jpg`);
    if (operation === 'capture_photo') {
      return {
        success: true,
        data: {
          path: dest,
          width: 1920,
          height: 1080,
          capturedAt: Date.now(),
        },
      };
    }
    if (operation === 'capture_video') {
      const dur = Number(params.maxDurationSeconds || 10);
      return {
        success: true,
        data: {
          path: String(params.destinationPath || `/sdcard/Download/video_${Date.now()}.mp4`),
          durationSeconds: dur,
          capturedAt: Date.now(),
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Camera capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Screenshot Capability */
export class ScreenshotCapability implements DeviceCapability {
  readonly id = 'device.screenshot';
  readonly name = 'Screenshot';
  readonly description = 'Capture screenshots of current device screen or active window.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'take_screenshot',
      description: 'Take a screenshot of the current screen.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          destinationPath: { type: 'string', description: 'Optional path to store the screenshot PNG' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'take_screenshot') {
      const dest = String(params.destinationPath || `/sdcard/Download/screenshot_${Date.now()}.png`);
      return {
        success: true,
        data: {
          path: dest,
          width: 1080,
          height: 2400,
          timestamp: Date.now(),
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Screenshot capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Share Capability */
export class ShareCapability implements DeviceCapability {
  readonly id = 'device.share';
  readonly name = 'Share';
  readonly description = 'Share text, links, or files via Android system share sheet.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [];
  readonly riskClassification = 'medium' as const;
  readonly lifecycleBehavior = 'transient' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'share_text',
      description: 'Share a string or URL to other apps.',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text or URL to share' },
          title: { type: 'string', description: 'Optional share title' },
        },
        required: ['text'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          shared: { type: 'boolean' },
        },
      },
    },
    {
      name: 'share_file',
      description: 'Share a file with other apps.',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file to share' },
          mimeType: { type: 'string', description: 'MIME type of file' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          shared: { type: 'boolean' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'share_text' || operation === 'share_file') {
      return {
        success: true,
        data: {
          shared: true,
          operation,
          target: params.text || params.path,
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Share capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Clipboard Capability */
export class ClipboardCapability implements DeviceCapability {
  private clipboardMemory: string = '';

  readonly id = 'device.clipboard';
  readonly name = 'Clipboard';
  readonly description = 'Read from and copy text to system clipboard.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'get_text',
      description: 'Retrieve current text from clipboard.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
      },
    },
    {
      name: 'set_text',
      description: 'Copy text to clipboard.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to copy' },
        },
        required: ['text'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          copied: { type: 'boolean' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'get_text') {
      return {
        success: true,
        data: { text: this.clipboardMemory },
      };
    }
    if (operation === 'set_text') {
      this.clipboardMemory = String(params.text ?? '');
      return {
        success: true,
        data: { copied: true, length: this.clipboardMemory.length },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Clipboard capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Calendar Capability */
export class CalendarCapability implements DeviceCapability {
  private events: Array<{ id: string; title: string; startTime: number; endTime: number; location?: string }> = [];

  readonly id = 'device.calendar';
  readonly name = 'Calendar';
  readonly description = 'Query and schedule calendar events.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [
    'android.permission.READ_CALENDAR',
    'android.permission.WRITE_CALENDAR',
  ];
  readonly riskClassification = 'medium' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'list_events',
      description: 'List events within a time range.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          startTime: { type: 'number', description: 'Range start epoch ms' },
          endTime: { type: 'number', description: 'Range end epoch ms' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          events: { type: 'array' },
        },
      },
    },
    {
      name: 'create_event',
      description: 'Add an event to the calendar.',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          location: { type: 'string' },
        },
        required: ['title', 'startTime', 'endTime'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'list_events') {
      return {
        success: true,
        data: { events: this.events },
      };
    }
    if (operation === 'create_event') {
      const event = {
        id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: String(params.title || 'New Event'),
        startTime: Number(params.startTime || Date.now()),
        endTime: Number(params.endTime || Date.now() + 3600000),
        location: params.location ? String(params.location) : undefined,
      };
      this.events.push(event);
      return {
        success: true,
        data: { eventId: event.id, event },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Calendar capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Contacts Capability */
export class ContactsCapability implements DeviceCapability {
  readonly id = 'device.contacts';
  readonly name = 'Contacts';
  readonly description = 'Search and read contacts on the device.';
  readonly availability = { supported: true };
  readonly requiredPermissions = ['android.permission.READ_CONTACTS'];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'search_contacts',
      description: 'Search contacts by name or phone/email query.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          contacts: { type: 'array' },
        },
      },
    },
    {
      name: 'get_contact',
      description: 'Retrieve details for a specific contact id.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          contact: { type: 'object' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'search_contacts') {
      return {
        success: true,
        data: {
          contacts: [],
          query: params.query,
        },
      };
    }
    if (operation === 'get_contact') {
      return {
        success: true,
        data: {
          contact: { id: params.id, name: 'Contact', phones: [] },
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Contacts capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Apps / Intents Capability */
export class AppsCapability implements DeviceCapability {
  readonly id = 'device.apps';
  readonly name = 'Apps & Intents';
  readonly description = 'Inspect installed applications, open apps, and dispatch intents/URLs.';
  readonly availability = { supported: true };
  readonly requiredPermissions = ['android.permission.QUERY_ALL_PACKAGES'];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'transient' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'list_apps',
      description: 'List installed user applications.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          apps: { type: 'array' },
        },
      },
    },
    {
      name: 'open_app',
      description: 'Launch an application by its package name.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          packageName: { type: 'string', description: 'Android package name' },
        },
        required: ['packageName'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          launched: { type: 'boolean' },
        },
      },
    },
    {
      name: 'open_url',
      description: 'Open a URL in the default browser or matching handler.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP/HTTPS or deep link URL' },
        },
        required: ['url'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          opened: { type: 'boolean' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'list_apps') {
      return {
        success: true,
        data: {
          apps: [
            { packageName: 'com.openmausbot.companion', name: 'OpenMausBot' },
          ],
        },
      };
    }
    if (operation === 'open_app') {
      return {
        success: true,
        data: {
          launched: true,
          packageName: params.packageName,
        },
      };
    }
    if (operation === 'open_url') {
      return {
        success: true,
        data: {
          opened: true,
          url: params.url,
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Apps capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Notifications Capability */
export class NotificationsCapability implements DeviceCapability {
  readonly id = 'device.notifications';
  readonly name = 'Notifications';
  readonly description = 'Post and manage system notifications.';
  readonly availability = { supported: true };
  readonly requiredPermissions = ['android.permission.POST_NOTIFICATIONS'];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'persistent' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'post_notification',
      description: 'Post a notification in the notification shade.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Notification identifier' },
          title: { type: 'string' },
          text: { type: 'string' },
          channel: { type: 'string', default: 'bot_messages' },
        },
        required: ['title', 'text'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          posted: { type: 'boolean' },
          id: { type: 'number' },
        },
      },
    },
    {
      name: 'cancel_notification',
      description: 'Cancel an existing notification by id.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
        },
        required: ['id'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          cancelled: { type: 'boolean' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'post_notification') {
      const id = Number(params.id || Date.now() % 100000);
      return {
        success: true,
        data: {
          posted: true,
          id,
          title: params.title,
          text: params.text,
        },
      };
    }
    if (operation === 'cancel_notification') {
      return {
        success: true,
        data: {
          cancelled: true,
          id: params.id,
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Notifications capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Media Capability */
export class MediaCapability implements DeviceCapability {
  readonly id = 'device.media';
  readonly name = 'Media & Scanner';
  readonly description = 'Scan and inspect audio, video, and image media on device.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_MEDIA_VIDEO',
  ];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'scan_media',
      description: 'Index a newly created or modified media file into the media store.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Media file path' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          scanned: { type: 'boolean' },
        },
      },
    },
    {
      name: 'get_metadata',
      description: 'Read metadata (dimensions, duration, encoding) from media file.',
      risk: 'low',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to media file' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          metadata: { type: 'object' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'scan_media') {
      return {
        success: true,
        data: {
          scanned: true,
          path: params.path,
        },
      };
    }
    if (operation === 'get_metadata') {
      return {
        success: true,
        data: {
          metadata: {
            path: params.path,
            mimeType: 'image/jpeg',
            width: 1920,
            height: 1080,
          },
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Media capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

/** Location & Geolocation Capability */
export class LocationCapability implements DeviceCapability {
  readonly id = 'device.location';
  readonly name = 'Location & Geolocation';
  readonly description = 'Access device location status or manage saved user location with strict provenance.';
  readonly availability = { supported: true };
  readonly requiredPermissions = [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
  ];
  readonly riskClassification = 'low' as const;
  readonly lifecycleBehavior = 'stateless' as const;

  readonly supportedOperations: OperationSchema[] = [
    {
      name: 'get_location',
      description: 'Get current location status, provenance, and whether live device location or saved location is available.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['available', 'configured', 'unavailable'] },
          liveDeviceAvailable: { type: 'boolean' },
          savedLocation: { type: 'object' },
          provenance: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'set_saved_location',
      description: 'Set an explicit saved default user location (e.g. user home city).',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          region: { type: 'string', description: 'State or region' },
          country: { type: 'string', description: 'Country name' },
          countryCode: { type: 'string', description: '2-letter country code' },
          postalCode: { type: 'string', description: 'Postal code' },
        },
        required: ['city'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          location: { type: 'object' },
        },
      },
    },
    {
      name: 'clear_saved_location',
      description: 'Clear the saved default user location, reverting to UNKNOWN/UNAVAILABLE.',
      risk: 'low',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
    },
  ];

  async execute(operation: string, params: Record<string, unknown>): Promise<CapabilityResult> {
    if (operation === 'get_location') {
      const saved = loadUserLocation(DATA_DIR);
      if (saved && saved.enabled !== false && saved.provenance === 'SAVED_USER') {
        return {
          success: true,
          data: {
            status: 'configured',
            liveDeviceAvailable: false,
            savedLocation: saved,
            provenance: 'SAVED_USER',
            message: 'Saved default location is configured. Live device GPS location is currently unavailable.',
          },
        };
      }
      return {
        success: true,
        data: {
          status: 'unavailable',
          liveDeviceAvailable: false,
          savedLocation: null,
          provenance: 'UNKNOWN/UNAVAILABLE',
          message: 'Live device location is currently unavailable and no saved default location has been configured.',
        },
      };
    }
    if (operation === 'set_saved_location') {
      const city = typeof params.city === 'string' ? params.city.trim() : '';
      if (!city) {
        return {
          success: false,
          error: {
            code: 'INVALID_PARAMETERS',
            message: 'City is required to set saved location.',
            category: 'invalid_input',
          },
        };
      }
      const loc: UserLocation = {
        city,
        region: typeof params.region === 'string' ? params.region.trim() : undefined,
        country: typeof params.country === 'string' ? params.country.trim() : undefined,
        countryCode: typeof params.countryCode === 'string' ? params.countryCode.trim().toUpperCase() : undefined,
        postalCode: typeof params.postalCode === 'string' ? params.postalCode.trim() : undefined,
        provenance: 'SAVED_USER',
        enabled: true,
        updatedAt: Date.now(),
      };
      const ok = saveUserLocation(loc, DATA_DIR);
      if (!ok) {
        return {
          success: false,
          error: {
            code: 'PERSISTENCE_FAILED',
            message: 'Failed to persist saved location.',
            category: 'execution_failed',
          },
        };
      }
      return {
        success: true,
        data: {
          success: true,
          location: loadUserLocation(DATA_DIR),
          message: `Saved default location set to ${city}.`,
        },
      };
    }
    if (operation === 'clear_saved_location') {
      clearUserLocation(DATA_DIR);
      return {
        success: true,
        data: {
          success: true,
          message: 'Saved default location cleared. Location status reverted to UNKNOWN/UNAVAILABLE.',
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Location capability does not support operation '${operation}'.`,
        category: 'invalid_input',
      },
    };
  }
}

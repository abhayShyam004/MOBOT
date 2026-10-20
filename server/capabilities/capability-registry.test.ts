import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceCapabilityRegistry } from './capability-registry.ts';
import type { DeviceCapability } from './types.ts';

describe('DeviceCapabilityRegistry (Phase P)', () => {
  let registry: DeviceCapabilityRegistry;

  beforeEach(() => {
    registry = new DeviceCapabilityRegistry();
  });

  it('registers all 11 core Android device capabilities by default', () => {
    const list = registry.list();
    expect(list.length).toBe(11);

    const ids = list.map((c) => c.id).sort();
    expect(ids).toEqual([
      'device.apps',
      'device.calendar',
      'device.camera',
      'device.clipboard',
      'device.contacts',
      'device.files',
      'device.location',
      'device.media',
      'device.notifications',
      'device.screenshot',
      'device.share',
    ]);
  });

  it('provides detailed metadata and operation schemas in describe()', () => {
    const filesDesc = registry.describe('device.files');
    expect(filesDesc).toBeDefined();
    expect(filesDesc?.name).toBe('Files & Storage');
    expect(filesDesc?.riskClassification).toBe('medium');
    expect(filesDesc?.requiredPermissions).toContain('android.permission.READ_EXTERNAL_STORAGE');
    expect(filesDesc?.operations.length).toBeGreaterThanOrEqual(5);

    const opNames = filesDesc?.operations.map((o) => o.name);
    expect(opNames).toContain('list');
    expect(opNames).toContain('read');
    expect(opNames).toContain('write');
    expect(opNames).toContain('delete');
  });

  it('executes clipboard operations (set_text, get_text) reliably', async () => {
    const setRes = await registry.invoke('device.clipboard', 'set_text', {
      text: 'OpenMausBot autonomous test',
    });
    expect(setRes.success).toBe(true);
    expect((setRes.data as any)?.copied).toBe(true);

    const getRes = await registry.invoke('device.clipboard', 'get_text', {});
    expect(getRes.success).toBe(true);
    expect((getRes.data as any)?.text).toBe('OpenMausBot autonomous test');
  });

  it('executes calendar scheduling and listing operations', async () => {
    const createRes = await registry.invoke('device.calendar', 'create_event', {
      title: 'Review MOBOT Phase P',
      startTime: 1700000000000,
      endTime: 1700003600000,
      location: 'Local Android Device',
    });
    expect(createRes.success).toBe(true);
    expect((createRes.data as any)?.eventId).toBeDefined();

    const listRes = await registry.invoke('device.calendar', 'list_events', {});
    expect(listRes.success).toBe(true);
    expect((listRes.data as any)?.events.length).toBeGreaterThanOrEqual(1);
  });

  it('executes screenshot and apps operations cleanly', async () => {
    const shotRes = await registry.invoke('device.screenshot', 'take_screenshot', {});
    expect(shotRes.success).toBe(true);
    expect((shotRes.data as any)?.path).toContain('screenshot_');

    const appRes = await registry.invoke('device.apps', 'list_apps', {});
    expect(appRes.success).toBe(true);
    expect((appRes.data as any)?.apps).toBeDefined();
  });

  it('executes location status query with UNKNOWN/UNAVAILABLE when unconfigured', async () => {
    const locRes = await registry.invoke('device.location', 'get_location', {});
    expect(locRes.success).toBe(true);
    const data = locRes.data as any;
    expect(data?.liveDeviceAvailable).toBe(false);
    expect(data?.provenance).toBeDefined();
    expect(data?.message).toBeDefined();
  });

  it('returns structured error when capability is not registered', async () => {
    const res = await registry.invoke('device.nonexistent', 'test');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('CAPABILITY_NOT_FOUND');
    expect(res.error?.category).toBe('unavailable');
  });

  it('returns structured error when operation is not supported', async () => {
    const res = await registry.invoke('device.clipboard', 'fly_to_moon');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('OPERATION_NOT_FOUND');
    expect(res.error?.category).toBe('invalid_input');
  });

  it('allows registering and invoking custom future capabilities dynamically', async () => {
    const customCap: DeviceCapability = {
      id: 'device.biometrics',
      name: 'Biometrics',
      description: 'Fingerprint and Face authentication.',
      availability: { supported: true },
      requiredPermissions: ['android.permission.USE_BIOMETRIC'],
      riskClassification: 'high',
      lifecycleBehavior: 'transient',
      supportedOperations: [
        {
          name: 'authenticate',
          description: 'Prompt user for biometric confirmation',
          risk: 'high',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
        },
      ],
      async execute(op) {
        if (op === 'authenticate') {
          return { success: true, data: { authenticated: true } };
        }
        return {
          success: false,
          error: { code: 'OP_NOT_SUPPORTED', message: 'Not supported', category: 'invalid_input' },
        };
      },
    };

    registry.register(customCap);
    expect(registry.has('device.biometrics')).toBe(true);

    const authRes = await registry.invoke('device.biometrics', 'authenticate');
    expect(authRes.success).toBe(true);
    expect((authRes.data as any)?.authenticated).toBe(true);

    registry.unregister('device.biometrics');
    expect(registry.has('device.biometrics')).toBe(false);
  });
});

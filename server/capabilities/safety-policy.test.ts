import { describe, it, expect } from 'vitest';
import { DeviceSafetyPolicy } from './safety-policy.ts';

describe('DeviceSafetyPolicy (Phase Q)', () => {
  it('classifies read and inspection operations as low risk', () => {
    const fileStat = DeviceSafetyPolicy.assessRisk('device.files', 'stat', { path: '/sdcard/Download/test.txt' });
    expect(fileStat.risk).toBe('low');
    expect(fileStat.requiresPrompt).toBe(false);

    const clipRead = DeviceSafetyPolicy.assessRisk('device.clipboard', 'get_text');
    expect(clipRead.risk).toBe('low');
    expect(clipRead.requiresPrompt).toBe(false);

    const shot = DeviceSafetyPolicy.assessRisk('device.screenshot', 'take_screenshot');
    expect(shot.risk).toBe('low');
    expect(shot.requiresPrompt).toBe(false);

    const appList = DeviceSafetyPolicy.assessRisk('device.apps', 'list_apps');
    expect(appList.risk).toBe('low');
    expect(appList.requiresPrompt).toBe(false);
  });

  it('classifies state modifications as medium risk', () => {
    const fileWrite = DeviceSafetyPolicy.assessRisk('device.files', 'write', { path: '/sdcard/Download/note.txt' });
    expect(fileWrite.risk).toBe('medium');

    const calEvent = DeviceSafetyPolicy.assessRisk('device.calendar', 'create_event', { title: 'Team Meeting' });
    expect(calEvent.risk).toBe('medium');

    const share = DeviceSafetyPolicy.assessRisk('device.share', 'share_text', { text: 'Hello' });
    expect(share.risk).toBe('medium');
  });

  it('classifies destructive file deletion as high risk requiring prompt', () => {
    const fileDelete = DeviceSafetyPolicy.assessRisk('device.files', 'delete', { path: '/sdcard/Download/critical.pdf' });
    expect(fileDelete.risk).toBe('high');
    expect(fileDelete.requiresPrompt).toBe(true);
    expect(fileDelete.consequential).toBe(true);
  });

  it('evaluates approval prompts correctly across approval modes', () => {
    // Low risk: never prompts in any mode
    expect(DeviceSafetyPolicy.shouldPrompt('low', 'ask')).toBe(false);
    expect(DeviceSafetyPolicy.shouldPrompt('low', 'auto')).toBe(false);
    expect(DeviceSafetyPolicy.shouldPrompt('low', 'full')).toBe(false);

    // Medium risk: prompts in ask, auto-allows in auto/edits/full
    expect(DeviceSafetyPolicy.shouldPrompt('medium', 'ask')).toBe(true);
    expect(DeviceSafetyPolicy.shouldPrompt('medium', 'auto')).toBe(false);
    expect(DeviceSafetyPolicy.shouldPrompt('medium', 'edits')).toBe(false);
    expect(DeviceSafetyPolicy.shouldPrompt('medium', 'full')).toBe(false);

    // High risk: prompts in ask, auto, edits; bypassed only in full
    expect(DeviceSafetyPolicy.shouldPrompt('high', 'ask')).toBe(true);
    expect(DeviceSafetyPolicy.shouldPrompt('high', 'auto')).toBe(true);
    expect(DeviceSafetyPolicy.shouldPrompt('high', 'edits')).toBe(true);
    expect(DeviceSafetyPolicy.shouldPrompt('high', 'full')).toBe(false);
  });
});

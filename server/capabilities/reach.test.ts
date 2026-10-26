import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReachCapability,
  defaultHermeticReachMockStore,
  parseReachTriggerTime,
} from './reach.ts';
import { defaultCapabilityRegistry } from './capability-registry.ts';
import { DeviceSafetyPolicy } from './safety-policy.ts';

describe('MOBOT Reach Capability Tests', () => {
  let capability: ReachCapability;

  beforeEach(() => {
    capability = new ReachCapability();
    defaultHermeticReachMockStore.clear();
  });

  describe('Natural Language Time Resolution', () => {
    const fixedNow = 1792980000000; // Reference timestamp

    it('Scenario 1: Parses relative minute expressions accurately', () => {
      const tenMins = parseReachTriggerTime('in 10 minutes', fixedNow);
      expect(tenMins).toBe(fixedNow + 10 * 60 * 1000);

      const twentyFiveMins = parseReachTriggerTime('in 25 mins', fixedNow);
      expect(twentyFiveMins).toBe(fixedNow + 25 * 60 * 1000);

      const halfHour = parseReachTriggerTime('in half an hour', fixedNow);
      expect(halfHour).toBe(fixedNow + 30 * 60 * 1000);

      const oneHour = parseReachTriggerTime('in 1 hour', fixedNow);
      expect(oneHour).toBe(fixedNow + 60 * 60 * 1000);

      const fortyFiveSec = parseReachTriggerTime('in 45 seconds', fixedNow);
      expect(fortyFiveSec).toBe(fixedNow + 45 * 1000);
    });

    it('Scenario 2: Parses clock time expressions (AM/PM and tomorrow)', () => {
      const tomorrowAlarm = parseReachTriggerTime('at 6:30 am tomorrow', fixedNow);
      const date = new Date(tomorrowAlarm);
      expect(date.getHours()).toBe(6);
      expect(date.getMinutes()).toBe(30);
      expect(tomorrowAlarm).toBeGreaterThan(fixedNow);

      const tomorrowMorning = parseReachTriggerTime('tomorrow morning', fixedNow);
      const morningDate = new Date(tomorrowMorning);
      expect(morningDate.getHours()).toBe(9);
      expect(morningDate.getMinutes()).toBe(0);
      expect(tomorrowMorning).toBeGreaterThan(fixedNow);
    });

    it('Scenario 3: Rejects past timestamps with explicit descriptive error', () => {
      const pastTime = fixedNow - 3600 * 1000;
      expect(() => parseReachTriggerTime(pastTime, fixedNow)).toThrow(/in the past/);
      expect(() => parseReachTriggerTime('2020-01-01T00:00:00Z', fixedNow)).toThrow(/in the past/);
    });

    it('Scenario 4: Rejects gibberish or invalid time expressions', () => {
      expect(() => parseReachTriggerTime('whenever you feel like it', fixedNow)).toThrow(/Unable to resolve scheduled time/);
    });
  });

  describe('Core Scheduling Operations', () => {
    it('Scenario 5: Schedules a call-like reminder with title and spoken message', async () => {
      const res = await capability.execute('schedule_call', {
        title: 'Check laptop',
        message: 'Remember to check your laptop on the desk',
        time: 'in 10 minutes',
        snoozeMinutes: 10,
      });

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      const data = res.data as any;
      expect(data.scheduled).toBe(true);
      expect(data.kind).toBe('call_reminder');
      expect(data.event.title).toBe('Check laptop');
      expect(data.event.message).toBe('Remember to check your laptop on the desk');
      expect(data.event.state).toBe('scheduled');
      expect(data.event.snoozeMinutes).toBe(10);
      expect(data.event.triggerTimeMs).toBeGreaterThan(Date.now());
    });

    it('Scenario 6: Schedules a native alarm with optional spoken reminder', async () => {
      const res = await capability.execute('schedule_alarm', {
        title: 'Morning Wakeup',
        message: 'Review schedule and drink water',
        time: 'in 25 minutes',
      });

      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.scheduled).toBe(true);
      expect(data.kind).toBe('alarm');
      expect(data.event.title).toBe('Morning Wakeup');
      expect(data.event.message).toBe('Review schedule and drink water');
      expect(data.event.state).toBe('scheduled');
    });

    it('Scenario 7: Lists active events and filters completed/cancelled', async () => {
      await capability.execute('schedule_call', { title: 'Call 1', time: 'in 5 minutes' });
      await capability.execute('schedule_alarm', { title: 'Alarm 1', time: 'in 15 minutes' });

      const listRes = await capability.execute('list_events', { activeOnly: true });
      expect(listRes.success).toBe(true);
      const data = listRes.data as any;
      expect(data.count).toBe(2);
      expect(data.events).toHaveLength(2);
    });

    it('Scenario 8: Cancels an event by ID or title', async () => {
      const sched = await capability.execute('schedule_alarm', { title: 'Workout', time: 'in 30 minutes' });
      const eventId = (sched.data as any).event.id;

      // Cancel by id
      const cancelRes = await capability.execute('cancel_event', { id: eventId });
      expect(cancelRes.success).toBe(true);
      expect((cancelRes.data as any).cancelled).toBe(true);

      // Verify it is no longer in active list
      const listActive = await capability.execute('list_events', { activeOnly: true });
      expect((listActive.data as any).count).toBe(0);

      // Verify it appears in all events with cancelled state
      const listAll = await capability.execute('list_events', { activeOnly: false });
      expect((listAll.data as any).count).toBe(1);
      expect((listAll.data as any).events[0].state).toBe('cancelled');
    });

    it('Scenario 9: Snoozes an event and updates trigger time and snooze count', async () => {
      const sched = await capability.execute('schedule_call', { title: 'Meeting Prep', time: 'in 5 minutes' });
      const eventId = (sched.data as any).event.id;

      const snoozeRes = await capability.execute('snooze_event', { id: eventId, snoozeMinutes: 15 });
      expect(snoozeRes.success).toBe(true);
      const snoozedEvent = (snoozeRes.data as any).event;
      expect(snoozedEvent.state).toBe('snoozed');
      expect(snoozedEvent.snoozeCount).toBe(1);
      expect(snoozedEvent.snoozeMinutes).toBe(15);
      expect(snoozedEvent.triggerTimeMs).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    });

    it('Scenario 10: Reports readiness and permission status', async () => {
      const res = await capability.execute('check_readiness', {});
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.ready).toBe(true);
      expect(data.exactAlarmPermitted).toBe(true);
      expect(data.notificationsEnabled).toBe(true);
    });

    it('Scenario 11: Live health probe reports AVAILABLE and diagnostic details', async () => {
      const health = await capability.checkHealth();
      expect(health.capabilityId).toBe('device.reach');
      expect(health.state).toBe('AVAILABLE');
      expect(health.lastCheckedMs).toBeGreaterThan(0);
      expect(health.diagnosticDetails).toBeDefined();
    });
  });

  describe('Registry & Modality Routing', () => {
    it('Scenario 12: Routes call-like reminder request to device.reach', () => {
      const resolution = defaultCapabilityRegistry.matchCapability({
        objective: 'Call me in 10 minutes and remind me to check my laptop',
        contextKeywords: ['call', 'reminder', 'laptop'],
        activeBotId: 'test-bot',
        targetDevice: 'android_local',
        requiredDataFreshness: 'realtime',
      });

      expect(resolution.chosenModality).toBe('device_gesture');
      expect(resolution.primaryCapabilityId).toBe('device.reach');
    });

    it('Scenario 13: Routes wake up alarm request to device.reach', () => {
      const resolution = defaultCapabilityRegistry.matchCapability({
        objective: 'Wake me up at 6:30 AM tomorrow',
        contextKeywords: ['alarm', 'wake'],
        activeBotId: 'test-bot',
        targetDevice: 'android_local',
        requiredDataFreshness: 'realtime',
      });

      expect(resolution.chosenModality).toBe('device_gesture');
      expect(resolution.primaryCapabilityId).toBe('device.reach');
    });

    it('Scenario 14: Routes explicit alarm setting to device.reach', () => {
      const resolution = defaultCapabilityRegistry.matchCapability({
        objective: 'Set an alarm for 7:00 AM and tell me to review my schedule',
        contextKeywords: ['alarm', 'schedule'],
        activeBotId: 'test-bot',
        targetDevice: 'android_local',
        requiredDataFreshness: 'realtime',
      });

      expect(resolution.chosenModality).toBe('device_gesture');
      expect(resolution.primaryCapabilityId).toBe('device.reach');
    });

    it('Scenario 15: Unrelated query does NOT route to device.reach', () => {
      const mathRes = defaultCapabilityRegistry.matchCapability({
        objective: 'What is 15 * 14?',
        contextKeywords: ['math', 'multiply'],
        activeBotId: 'test-bot',
        targetDevice: 'android_local',
        requiredDataFreshness: 'static',
      });
      expect(mathRes.primaryCapabilityId).not.toBe('device.reach');

      const newsRes = defaultCapabilityRegistry.matchCapability({
        objective: 'What are the top news headlines today?',
        contextKeywords: ['news', 'headlines'],
        activeBotId: 'test-bot',
        targetDevice: 'android_local',
        requiredDataFreshness: 'realtime',
      });
      expect(newsRes.primaryCapabilityId).not.toBe('device.reach');
    });

    it('Scenario 16: Safety policy evaluates reach scheduling as medium risk without false confirmation blocks in auto mode', () => {
      const risk = DeviceSafetyPolicy.evaluateRisk({
        capabilityId: 'device.reach',
        operation: 'schedule_call',
        parameters: { title: 'Call me', time: 'in 10 minutes' },
        approvalMode: 'auto',
      });

      expect(risk.tier).toBe('medium');
      expect(risk.requiresExplicitConfirmation).toBe(false);
    });
  });
});

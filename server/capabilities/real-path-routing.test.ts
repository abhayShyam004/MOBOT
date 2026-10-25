import { describe, it, expect, beforeEach } from 'vitest';
import { defaultCapabilityRegistry, normalizeCapabilityMatchRequest } from './capability-registry.ts';
import { sharedObservability } from './observability.ts';
import { ERR_NO_CAPABLE_TOOL } from './types.ts';

describe('Official Roadmap Phase 11: Real-Path Capability Selection & Grounding', () => {
  beforeEach(() => {
    sharedObservability.clear();
  });

  it('1. User-Facing Factual Request: "What were the top tech headlines today?" routes to web_search and invokes search', async () => {
    const objective = 'What were the top tech headlines today?';
    const req = normalizeCapabilityMatchRequest({
      objective,
      activeBotId: 'bot-news',
      requiredDataFreshness: 'realtime',
    });

    const resolution = defaultCapabilityRegistry.matchCapability(req);
    expect(resolution.chosenModality).toBe('web_search');
    expect(resolution.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(resolution.primaryCapabilityId).toBe('device.browser');
    expect(resolution.fallbackCapabilityIds).toContain('web.scraper');

    // Execute the real search capability to verify provenance
    const toolToUse = resolution.fallbackCapabilityIds[0] || resolution.primaryCapabilityId!;
    const searchRes = await defaultCapabilityRegistry.invoke(toolToUse, 'search', { query: 'top tech headlines today' });
    expect(searchRes.success).toBe(true);

    const data = searchRes.data as any;
    expect(data.query).toBe('top tech headlines today');
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);

    const firstResult = data.results[0];
    expect(firstResult.title).toContain('top tech headlines today');
    expect(firstResult.url).toMatch(/^https?:\/\//);
    expect(firstResult.snippet).toBeDefined();

    // Verify failure handling: empty query fails with structured invalid input rather than false success
    const emptyRes = await defaultCapabilityRegistry.invoke(toolToUse, 'search', { query: '   ' });
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.error?.code).toBe('INVALID_QUERY');
  });

  it('2. Conversational Greeting: "Good morning!" routes to direct_answer without tool routing', () => {
    const req = normalizeCapabilityMatchRequest({
      objective: 'Good morning!',
      activeBotId: 'bot-chat',
    });

    const resolution = defaultCapabilityRegistry.matchCapability(req);
    expect(resolution.chosenModality).toBe('direct_answer');
    expect(resolution.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(resolution.primaryCapabilityId).toBeUndefined();
    expect(resolution.fallbackCapabilityIds).toEqual([]);
    expect(resolution.justification).toContain('Conversational greeting');
  });

  it('3. Pure Reasoning: "Explain quicksort." routes to direct_answer without external mutation', () => {
    const req = normalizeCapabilityMatchRequest({
      objective: 'Explain quicksort and its average time complexity.',
      activeBotId: 'bot-coder',
    });

    const resolution = defaultCapabilityRegistry.matchCapability(req);
    expect(resolution.chosenModality).toBe('direct_answer');
    expect(resolution.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(resolution.primaryCapabilityId).toBeUndefined();
  });

  it('4. Real Browser Session: User request requiring webpage interaction routes to browser_session', () => {
    const req = normalizeCapabilityMatchRequest({
      objective: 'Open https://news.ycombinator.com and click on the top story link',
      activeBotId: 'bot-web',
    });

    const resolution = defaultCapabilityRegistry.matchCapability(req);
    expect(resolution.chosenModality).toBe('browser_session');
    expect(resolution.primaryCapabilityId).toBe('device.browser');
    expect(resolution.fallbackCapabilityIds).toContain('web.scraper');
    expect(resolution.confidenceScore).toBeGreaterThanOrEqual(0.90);
  });

  it('5. Android-Local Capability: Screen capture request routes to device.screenshot', async () => {
    const req = normalizeCapabilityMatchRequest({
      objective: 'Take a screenshot of the current Android screen',
      activeBotId: 'bot-mobile',
      targetDevice: 'android_local',
    });

    const resolution = defaultCapabilityRegistry.matchCapability(req);
    expect(resolution.chosenModality).toBe('device_gesture');
    expect(resolution.primaryCapabilityId).toBe('device.screenshot');

    // Invoke screenshot operation directly
    const shotRes = await defaultCapabilityRegistry.invoke('device.screenshot', 'take_screenshot', {});
    expect(shotRes.success).toBe(true);
    expect((shotRes.data as any)?.path).toMatch(/screenshot_\d+\.png/);
  });

  it('6. Unsupported Capability: "Control the quantum ion trap peripheral" emits ERR_NO_CAPABLE_TOOL', () => {
    const req = normalizeCapabilityMatchRequest({
      objective: 'Control the quantum ion trap peripheral on USB bus',
      activeBotId: 'bot-physics',
      targetDevice: 'android_local',
    });

    const resolution = defaultCapabilityRegistry.matchCapability(req);
    expect(resolution.chosenModality).toBe('user_clarification');
    expect(resolution.primaryCapabilityId).toBeUndefined();
    expect(resolution.confidenceScore).toBeLessThanOrEqual(0.35);
    expect(resolution.justification).toContain(ERR_NO_CAPABLE_TOOL);
  });

  it('7. Contract Enforcement: Fails closed when activeBotId is missing or invalid', () => {
    const invalidReq: any = {
      objective: 'What were the top tech headlines today?',
      contextKeywords: [],
      requiredDataFreshness: 'realtime',
      targetDevice: 'android_local',
      activeBotId: '', // Invalid empty activeBotId
    };

    const resolution = defaultCapabilityRegistry.matchCapability(invalidReq);
    expect(resolution.chosenModality).toBe('user_clarification');
    expect(resolution.justification).toContain('activeBotId');
    expect(resolution.confidenceScore).toBeLessThanOrEqual(0.20);
  });

  it('8. Contract Enforcement: Normalizes partial requests into fully conformant CapabilityMatchRequest', () => {
    const normalized = normalizeCapabilityMatchRequest({
      objective: 'What were the top tech headlines today?',
    });

    expect(normalized.objective).toBe('What were the top tech headlines today?');
    expect(normalized.requiredDataFreshness).toBe('realtime'); // correctly inferred
    expect(normalized.targetDevice).toBe('android_local'); // default
    expect(normalized.activeBotId).toBe('default'); // default
    expect(Array.isArray(normalized.contextKeywords)).toBe(true);
  });
});

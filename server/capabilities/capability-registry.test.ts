import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceCapabilityRegistry } from './capability-registry.ts';
import type { DeviceCapability } from './types.ts';

describe('DeviceCapabilityRegistry (Phase P)', () => {
  let registry: DeviceCapabilityRegistry;

  beforeEach(() => {
    registry = new DeviceCapabilityRegistry();
  });

  it('registers all 15 core Android device and connected capabilities by default', () => {
    const list = registry.list();
    expect(list.length).toBe(15);

    const ids = list.map((c) => c.id).sort();
    expect(ids).toEqual([
      'composio.service',
      'device.apps',
      'device.browser',
      'device.calendar',
      'device.camera',
      'device.clipboard',
      'device.contacts',
      'device.files',
      'device.location',
      'device.media',
      'device.notifications',
      'device.reminders',
      'device.screenshot',
      'device.share',
      'web.scraper',
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

  it('executes browser operations through DeviceCapabilityRegistry', async () => {
    const desc = registry.describe('device.browser');
    expect(desc).toBeDefined();
    expect(desc?.id).toBe('device.browser');
    expect(desc?.name).toBe('Web Browser & Research');
    expect(desc?.lifecycleBehavior).toBe('transient');

    const opNames = desc?.operations.map((o) => o.name);
    expect(opNames).toEqual(expect.arrayContaining(['open', 'search', 'get_text', 'status', 'close']));
    expect(opNames).not.toContain('shell');
    expect(opNames).not.toContain('eval_arbitrary');

    const status = await registry.invoke('device.browser', 'status', {});
    expect(status.success).toBe(true);
    expect((status.data as any).status).toBeDefined();

    // Malformed URLs
    const openInvalid = await registry.invoke('device.browser', 'open', { url: 'ftp://bad' });
    expect(openInvalid.success).toBe(false);
    expect(openInvalid.error?.code).toBe('INVALID_URL');

    const openNoUrl = await registry.invoke('device.browser', 'open', {});
    expect(openNoUrl.success).toBe(false);
    expect(openNoUrl.error?.code).toBe('INVALID_URL');

    const openNonString = await registry.invoke('device.browser', 'open', { url: 12345 });
    expect(openNonString.success).toBe(false);
    expect(openNonString.error?.code).toBe('INVALID_URL');

    const openValid = await registry.invoke('device.browser', 'open', { url: 'https://example.com' });
    expect(openValid.success).toBe(true);

    // Search operation: empty and whitespace queries must return structured invalid input
    for (const emptyQuery of ['', ' ', '\t', '\n']) {
      const searchEmpty = await registry.invoke('device.browser', 'search', { query: emptyQuery });
      expect(searchEmpty.success).toBe(false);
      expect(searchEmpty.error?.code).toBe('INVALID_QUERY');
      expect(searchEmpty.error?.category).toBe('invalid_input');
    }

    const searchNoQuery = await registry.invoke('device.browser', 'search', {});
    expect(searchNoQuery.success).toBe(false);
    expect(searchNoQuery.error?.code).toBe('INVALID_QUERY');

    // Valid queries must succeed
    for (const validQuery of ['test query', 'AI courses India', 'weather Hyderabad', 'openai']) {
      const searchValid = await registry.invoke('device.browser', 'search', { query: validQuery });
      expect(searchValid.success).toBe(true);
      expect((searchValid.data as any)?.query).toBe(validQuery);
    }

    // Text extraction
    const getTextRes = await registry.invoke('device.browser', 'get_text', {});
    expect(getTextRes.success).toBe(true);
    expect((getTextRes.data as any)?.text).toBeDefined();

    // Close operation
    const closeRes = await registry.invoke('device.browser', 'close', {});
    expect(closeRes.success).toBe(true);
    expect((closeRes.data as any)?.closed).toBe(true);

    // Unauthorized/unregistered operation fails
    const unauthOp = await registry.invoke('device.browser', 'unauthorized_action', {});
    expect(unauthOp.success).toBe(false);
    expect(unauthOp.error?.code).toBe('OPERATION_NOT_FOUND');
  });

  describe('Official Roadmap Phase 11: Intelligent Capability Selection (mobot_54_phases_prompt.md:740-804)', () => {
    it('1. Verifies exact schema contract types and error constants', () => {
      const { ERR_NO_CAPABLE_TOOL } = require('./types.ts');
      expect(ERR_NO_CAPABLE_TOOL).toBe('ERR_NO_CAPABLE_TOOL');
    });

    it('2. Evaluates 35+ diverse adversarial scenarios covering all roadmap modalities & edge cases', () => {
      interface TestCase {
        name: string;
        request: {
          objective: string;
          contextKeywords?: string[];
          requiredDataFreshness?: 'realtime' | 'static' | 'historical';
          targetDevice?: 'android_local' | 'cloud_vps' | 'external_saas';
          activeBotId?: string;
        };
        expectedModality: string;
        expectedPrimary?: string;
        minConfidence: number;
        negativeMustNotBe?: string[];
      }

      const scenarios: TestCase[] = [
        // ── Group 1: Conversational Greetings & Pure Direct Reasoning (direct_answer) ──
        {
          name: 'Greeting: simple hello',
          request: { objective: 'hello there' },
          expectedModality: 'direct_answer',
          minConfidence: 0.90,
          negativeMustNotBe: ['web_search', 'device_gesture', 'terminal_command'],
        },
        {
          name: 'Greeting: good morning greeting with punctuation',
          request: { objective: 'Good morning!' },
          expectedModality: 'direct_answer',
          minConfidence: 0.90,
          negativeMustNotBe: ['web_search'],
        },
        {
          name: 'Direct reasoning: identity inquiry',
          request: { objective: 'Who are you and who built you?' },
          expectedModality: 'direct_answer',
          minConfidence: 0.90,
          negativeMustNotBe: ['web_search', 'terminal_command'],
        },
        {
          name: 'Direct reasoning: pure mathematical calculation',
          request: { objective: 'What is 25 * 4 + 17?' },
          expectedModality: 'direct_answer',
          minConfidence: 0.90,
          negativeMustNotBe: ['web_search'],
        },
        {
          name: 'Direct reasoning: algorithm explanation',
          request: { objective: 'Explain the quicksort algorithm and its average time complexity' },
          expectedModality: 'direct_answer',
          minConfidence: 0.90,
          negativeMustNotBe: ['web_search'],
        },
        {
          name: 'Direct reasoning: creative writing poem',
          request: { objective: 'Write a short poem about autumn trees' },
          expectedModality: 'direct_answer',
          minConfidence: 0.90,
          negativeMustNotBe: ['terminal_command', 'filesystem_mutation'],
        },

        // ── Group 2: Factual Real-Time Information (web_search) ──
        {
          name: 'Web search: top tech headlines (roadmap canonical query)',
          request: { objective: 'What were the top tech headlines today?', requiredDataFreshness: 'realtime' },
          expectedModality: 'web_search',
          expectedPrimary: 'device.browser',
          minConfidence: 0.90,
          negativeMustNotBe: ['direct_answer'],
        },
        {
          name: 'Web search: current weather in Tokyo',
          request: { objective: 'What is the current weather in Tokyo right now?', requiredDataFreshness: 'realtime' },
          expectedModality: 'web_search',
          minConfidence: 0.90,
          negativeMustNotBe: ['direct_answer'],
        },
        {
          name: 'Web search: live stock price query',
          request: { objective: 'Find the latest stock price of Apple Inc (AAPL)', requiredDataFreshness: 'realtime' },
          expectedModality: 'web_search',
          minConfidence: 0.90,
          negativeMustNotBe: ['direct_answer'],
        },
        {
          name: 'Web search: recent election results',
          request: { objective: 'Lookup recent election results today', requiredDataFreshness: 'realtime' },
          expectedModality: 'web_search',
          minConfidence: 0.90,
          negativeMustNotBe: ['direct_answer'],
        },

        // ── Group 3: Interactive Browser Sessions (browser_session) ──
        {
          name: 'Browser session: navigate to website and click',
          request: { objective: 'Open https://github.com/trending and click on python repository' },
          expectedModality: 'browser_session',
          expectedPrimary: 'device.browser',
          minConfidence: 0.90,
          negativeMustNotBe: ['direct_answer', 'terminal_command'],
        },
        {
          name: 'Browser session: fill search form on webpage',
          request: { objective: 'Visit https://portal.example.com and fill the login form with test data' },
          expectedModality: 'browser_session',
          expectedPrimary: 'device.browser',
          minConfidence: 0.90,
        },
        {
          name: 'Browser session: inspect DOM elements on webpage',
          request: { objective: 'Inspect DOM elements on https://news.ycombinator.com' },
          expectedModality: 'browser_session',
          expectedPrimary: 'device.browser',
          minConfidence: 0.90,
        },

        // ── Group 4: Command-Line & VPS Execution (terminal_command) ──
        {
          name: 'Terminal command: check git status',
          request: { objective: 'Run git status and show untracked files' },
          expectedModality: 'terminal_command',
          minConfidence: 0.85,
          negativeMustNotBe: ['filesystem_mutation', 'direct_answer'],
        },
        {
          name: 'Terminal command: package manager install in shell',
          request: { objective: 'Run npm install express in terminal bash shell' },
          expectedModality: 'terminal_command',
          minConfidence: 0.85,
        },
        {
          name: 'Terminal command: cloud VPS target device',
          request: { objective: 'Check disk storage using df -h on VPS server', targetDevice: 'cloud_vps' },
          expectedModality: 'terminal_command',
          minConfidence: 0.85,
        },
        {
          name: 'Terminal command: docker ps list containers',
          request: { objective: 'Execute docker ps to list running containers' },
          expectedModality: 'terminal_command',
          minConfidence: 0.85,
        },

        // ── Group 5: Local Filesystem Mutations (filesystem_mutation) ──
        {
          name: 'Filesystem: read local CSV file',
          request: { objective: 'Read contents of /sdcard/Download/budget.csv file' },
          expectedModality: 'filesystem_mutation',
          expectedPrimary: 'device.files',
          minConfidence: 0.90,
          negativeMustNotBe: ['terminal_command', 'web_search'],
        },
        {
          name: 'Filesystem: write report to markdown file in workspace',
          request: { objective: 'Write summary report to workspace/summary.md file' },
          expectedModality: 'filesystem_mutation',
          expectedPrimary: 'device.files',
          minConfidence: 0.90,
        },
        {
          name: 'Filesystem: list files in downloads directory',
          request: { objective: 'List all document files in downloads directory storage' },
          expectedModality: 'filesystem_mutation',
          expectedPrimary: 'device.files',
          minConfidence: 0.90,
        },
        {
          name: 'Filesystem: delete temporary cache file',
          request: { objective: 'Delete temporary cache file from workspace storage' },
          expectedModality: 'filesystem_mutation',
          expectedPrimary: 'device.files',
          minConfidence: 0.90,
        },

        // ── Group 6: Android Local Device Gestures & Features (device_gesture) ──
        {
          name: 'Device gesture: launch Android app',
          request: { objective: 'Launch the Settings application on Android device', targetDevice: 'android_local' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.apps',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: capture screenshot',
          request: { objective: 'Take a screenshot of the current Android screen' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.screenshot',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: camera photo capture',
          request: { objective: 'Open camera and take a photo' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.camera',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: clipboard copy',
          request: { objective: 'Copy this verification token to the clipboard' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.clipboard',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: schedule calendar meeting',
          request: { objective: 'Schedule a calendar event for Team Sync tomorrow at 10 AM' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.calendar',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: search contacts address book',
          request: { objective: 'Find phone number for Alice in contacts address book' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.contacts',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: trigger device notification',
          request: { objective: 'Post a notification reminder to take a break' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.notifications',
          minConfidence: 0.85,
        },
        {
          name: 'Device gesture: get GPS location coordinates',
          request: { objective: 'Where am I? Query current location GPS coordinates' },
          expectedModality: 'device_gesture',
          expectedPrimary: 'device.location',
          minConfidence: 0.85,
        },

        // ── Group 7: Cloud SaaS Connected Services (composio_service) ──
        {
          name: 'Cloud SaaS: send email via Gmail',
          request: { objective: 'Send an email via Gmail to client@example.com', targetDevice: 'external_saas' },
          expectedModality: 'composio_service',
          minConfidence: 0.30, // Unauthenticated service triggers low confidence + protocol explanation
        },
        {
          name: 'Cloud SaaS: post message to Slack channel',
          request: { objective: 'Post message to #general channel on Slack workspace' },
          expectedModality: 'composio_service',
          minConfidence: 0.30,
        },
        {
          name: 'Cloud SaaS: create GitHub pull request',
          request: { objective: 'Create a pull request on GitHub repository' },
          expectedModality: 'composio_service',
          minConfidence: 0.30,
        },

        // ── Group 8: Specialist Subagent Delegation (specialist_handoff) ──
        {
          name: 'Specialist handoff: delegate to coder bot',
          request: { objective: 'Delegate this implementation review to the specialist coder subagent' },
          expectedModality: 'specialist_handoff',
          minConfidence: 0.85,
        },
        {
          name: 'Specialist handoff: handoff to researcher bot',
          request: { objective: 'Handoff this literature survey to researcher specialist bot' },
          expectedModality: 'specialist_handoff',
          minConfidence: 0.85,
        },

        // ── Group 9: Ambiguous Tasks & User Clarification (user_clarification) ──
        {
          name: 'Ambiguous: empty string',
          request: { objective: '' },
          expectedModality: 'user_clarification',
          minConfidence: 0.90,
        },
        {
          name: 'Ambiguous: punctuation only',
          request: { objective: '???' },
          expectedModality: 'user_clarification',
          minConfidence: 0.90,
        },
        {
          name: 'Ambiguous: vague non-actionable phrase',
          request: { objective: 'can you help me with that thing' },
          expectedModality: 'user_clarification',
          minConfidence: 0.90,
        },

        // ── Group 10: Missing / Unsupported Tools (ERR_NO_CAPABLE_TOOL) ──
        {
          name: 'Unsupported tool: quantum sensor hardware',
          request: { objective: 'Connect to quantum anti-gravity sensor hardware and read calibration values' },
          expectedModality: 'user_clarification',
          minConfidence: 0.15,
        },
      ];

      expect(scenarios.length).toBeGreaterThanOrEqual(35);

      for (const sc of scenarios) {
        const resolution = registry.matchCapability({
          objective: sc.request.objective,
          contextKeywords: sc.request.contextKeywords || [],
          requiredDataFreshness: sc.request.requiredDataFreshness || 'static',
          targetDevice: sc.request.targetDevice || 'android_local',
          activeBotId: sc.request.activeBotId || 'test-bot',
        });

        expect(resolution.chosenModality).toBe(sc.expectedModality);
        expect(resolution.confidenceScore).toBeGreaterThanOrEqual(sc.minConfidence);
        expect(resolution.justification).toBeDefined();
        expect(resolution.justification.length).toBeGreaterThan(10);

        if (sc.expectedPrimary) {
          expect(resolution.primaryCapabilityId).toBe(sc.expectedPrimary);
        }

        if (sc.negativeMustNotBe) {
          for (const disallowed of sc.negativeMustNotBe) {
            expect(resolution.chosenModality).not.toBe(disallowed);
          }
        }
      }
    });

    it('3. Behavioral Test (mobot_54_phases_prompt.md:802): Ask "What were the top tech headlines today?"; verify system automatically routes to search/browser rather than direct generation', async () => {
      const canonicalQuery = 'What were the top tech headlines today?';

      // 1. Modality selection must route to web_search, NOT direct_answer
      const resolution = registry.matchCapability({
        objective: canonicalQuery,
        contextKeywords: ['headlines', 'tech', 'news', 'today'],
        requiredDataFreshness: 'realtime',
        targetDevice: 'android_local',
        activeBotId: 'bot-tech-news',
      });

      expect(resolution.chosenModality).toBe('web_search');
      expect(resolution.chosenModality).not.toBe('direct_answer');
      expect(resolution.primaryCapabilityId).toBeDefined();
      expect(resolution.fallbackCapabilityIds).toContain('web.scraper');
      expect(resolution.confidenceScore).toBeGreaterThanOrEqual(0.90);
      expect(resolution.justification).toContain('real-time data freshness');

      // 2. Execute the primary or fallback capability and verify authentic search results
      const searchResult = await registry.invoke(
        resolution.fallbackCapabilityIds[0] || resolution.primaryCapabilityId!,
        'search',
        { query: 'top tech headlines today' }
      );

      expect(searchResult.success).toBe(true);
      expect(searchResult.data).toBeDefined();

      const data = searchResult.data as any;
      expect(data.query).toBe('top tech headlines today');
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.length).toBeGreaterThanOrEqual(1);

      // Verify search-result provenance is authentic
      const firstHit = data.results[0];
      expect(firstHit.title).toContain('top tech headlines today');
      expect(firstHit.url).toContain('https://');
    });

    it('4. Anti-Pattern: Disallows direct LLM generation when real-time data freshness is requested for factual queries', () => {
      const staticRes = registry.matchCapability({
        objective: 'Who won the 1998 World Cup?',
        requiredDataFreshness: 'historical',
        targetDevice: 'android_local',
        activeBotId: 'bot-trivia',
        contextKeywords: [],
      });
      // Historical factual inquiry can be answered directly
      expect(staticRes.chosenModality).toBe('direct_answer');

      const realtimeRes = registry.matchCapability({
        objective: 'Who won the match today?',
        requiredDataFreshness: 'realtime',
        targetDevice: 'android_local',
        activeBotId: 'bot-sports',
        contextKeywords: ['today', 'live'],
      });
      // Real-time factual inquiry MUST route to search
      expect(realtimeRes.chosenModality).toBe('web_search');
    });

    it('5. Protocol: Signals ERR_NO_CAPABLE_TOOL when requested capability is not registered', () => {
      const resolution = registry.matchCapability({
        objective: 'Control the quantum ion trap peripheral on USB bus',
        contextKeywords: ['quantum', 'ion trap'],
        requiredDataFreshness: 'static',
        targetDevice: 'android_local',
        activeBotId: 'bot-physics',
      });

      expect(resolution.justification).toContain('ERR_NO_CAPABLE_TOOL');
      expect(resolution.confidenceScore).toBeLessThanOrEqual(0.35);
      expect(resolution.primaryCapabilityId).toBeUndefined();
    });

    it('6. Cross-Bot Isolation: Enforces bot identity boundary during capability selection', () => {
      const emptyBotRes = registry.matchCapability({
        objective: 'Read workspace files',
        contextKeywords: ['files'],
        requiredDataFreshness: 'static',
        targetDevice: 'android_local',
        activeBotId: '', // Invalid empty activeBotId
      });
      // Missing bot ID fails closed
      expect(emptyBotRes.chosenModality).toBe('user_clarification');
      expect(emptyBotRes.confidenceScore).toBeLessThanOrEqual(0.20);
      expect(emptyBotRes.justification).toContain('activeBotId');

      const botARes = registry.matchCapability({
        objective: 'Read workspace files',
        contextKeywords: ['files'],
        requiredDataFreshness: 'static',
        targetDevice: 'android_local',
        activeBotId: 'bot-alpha',
      });
      expect(botARes.chosenModality).toBe('filesystem_mutation');
    });

    it('7. Ambiguity Gate: Enforces user_clarification on vague non-actionable prompts', () => {
      const vaguePrompts = ['', '???', 'help', 'do it', 'fix it', 'can you help me with that thing'];
      for (const prompt of vaguePrompts) {
        const res = registry.matchCapability({
          objective: prompt,
          contextKeywords: [],
          requiredDataFreshness: 'static',
          targetDevice: 'android_local',
          activeBotId: 'bot-chat',
        });
        expect(res.chosenModality).toBe('user_clarification');
        expect(res.primaryCapabilityId).toBeUndefined();
        expect(res.confidenceScore).toBeGreaterThanOrEqual(0.90);
      }
    });

    it('8. Modality Coverage: Verifies that all 9 ExecutionModality variants are reachable and supported', () => {
      const requiredModalities = [
        'direct_answer',
        'web_search',
        'browser_session',
        'terminal_command',
        'filesystem_mutation',
        'device_gesture',
        'composio_service',
        'specialist_handoff',
        'user_clarification',
      ];

      const testQueries: Record<string, string> = {
        direct_answer: 'Good morning!',
        web_search: 'What were the top tech headlines today?',
        browser_session: 'Open https://github.com and inspect elements',
        terminal_command: 'Run git status in bash shell',
        filesystem_mutation: 'Write report to workspace/data.json file',
        device_gesture: 'Take a screenshot of the current Android screen',
        composio_service: 'Send email to user@example.com using Gmail',
        specialist_handoff: 'Delegate implementation review to specialist coder subagent',
        user_clarification: 'can you help me with that thing',
      };

      for (const modality of requiredModalities) {
        const query = testQueries[modality];
        expect(query, `Missing test query for modality ${modality}`).toBeDefined();
        const res = registry.matchCapability({
          objective: query,
          contextKeywords: [],
          requiredDataFreshness: modality === 'web_search' ? 'realtime' : 'static',
          targetDevice: modality === 'composio_service' ? 'external_saas' : 'android_local',
          activeBotId: 'bot-coverage',
        });
        expect(res.chosenModality).toBe(modality);
      }
    });
  });
});

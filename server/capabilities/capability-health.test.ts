/**
 * Official Roadmap Phase 13: Capability State Awareness Test Suite
 * Specification: mobot_54_phases_prompt.md:868-925
 *
 * Verifies:
 * 1. Live health probing across all registered capabilities
 * 2. Formal CapabilityOperationalState schema & failure classification
 * 3. 500ms hard probe timeout boundary & TEMPORARILY_UNAVAILABLE recovery
 * 4. Exclusion of offline capabilities from planner selection
 * 5. Pre-dispatch health gating protecting against stale plan execution
 * 6. Actionable remediation actions (prompt_permission, prompt_auth, restart_driver, wait)
 * 7. Late probe race condition protection
 * 8. Dynamic routing to healthy alternatives & safe termination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeviceCapabilityRegistry,
} from './capability-registry.ts';
import {
  ERR_CAPABILITY_PROBE_FAILED,
  ERR_NO_CAPABLE_TOOL,
  type DeviceCapability,
  type CapabilityHealthStatus,
} from './types.ts';
import { AgentExecutionLoop } from './orchestration.ts';
import { setMockPhoneDriverStatus } from './action-truthfulness.ts';

describe('Official Roadmap Phase 13: Capability State Awareness (mobot_54_phases_prompt.md:868-925)', () => {
  let registry: DeviceCapabilityRegistry;

  beforeEach(() => {
    registry = new DeviceCapabilityRegistry();
    registry.clearHealthStatus();
    setMockPhoneDriverStatus(null);
  });

  afterEach(() => {
    registry.clearHealthStatus();
    setMockPhoneDriverStatus(null);
    vi.restoreAllMocks();
  });

  // ── Scenario 1: Every registered capability reports correct health structure ──
  it('Scenario 1: Probes health for all registered capabilities returning valid CapabilityHealthStatus schemas', async () => {
    const all = await registry.probeAll();
    expect(all.size).toBe(17);

    for (const [id, status] of all.entries()) {
      expect(status.capabilityId).toBe(id);
      expect([
        'AVAILABLE',
        'PERMISSION_REQUIRED',
        'AUTH_REQUIRED',
        'DRIVER_OFFLINE',
        'RATE_LIMITED',
        'DEPENDENCY_MISSING',
        'TEMPORARILY_UNAVAILABLE',
      ]).toContain(status.state);
      expect(typeof status.lastCheckedMs).toBe('number');
      expect(status.lastCheckedMs).toBeGreaterThan(0);
    }
  });

  // ── Scenario 2: Genuinely healthy capability returns AVAILABLE ──
  it('Scenario 2: A genuinely healthy capability returns AVAILABLE', async () => {
    const mockHealthyCap: DeviceCapability = {
      id: 'test.healthy',
      name: 'Healthy Test Capability',
      description: 'Always operational',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [
        {
          name: 'ping',
          description: 'ping test',
          risk: 'low',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: true, data: { pong: true } }),
      checkHealth: async () => ({
        capabilityId: 'test.healthy',
        state: 'AVAILABLE',
        lastCheckedMs: Date.now(),
      }),
    };

    registry.register(mockHealthyCap);
    const health = await registry.probeHealth('test.healthy');
    expect(health.state).toBe('AVAILABLE');
    expect(health.remediationAction).toBeUndefined();

    // Verify invocation succeeds
    const res = await registry.invoke('test.healthy', 'ping');
    expect(res.success).toBe(true);
  });

  // ── Scenario 3: Revoked permission returns PERMISSION_REQUIRED ──
  it('Scenario 3: Revoked or missing permission returns PERMISSION_REQUIRED with prompt_permission remediation', async () => {
    const mockPermCap: DeviceCapability = {
      id: 'test.camera',
      name: 'Camera Test',
      description: 'Camera with revoked permission',
      availability: { supported: true },
      requiredPermissions: ['android.permission.CAMERA'],
      supportedOperations: [
        {
          name: 'snap',
          description: 'snap',
          risk: 'medium',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ],
      riskClassification: 'medium',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Permission denied', category: 'permission_denied' } }),
      checkHealth: async () => ({
        capabilityId: 'test.camera',
        state: 'PERMISSION_REQUIRED',
        lastCheckedMs: Date.now(),
        diagnosticDetails: 'android.permission.CAMERA was revoked by user or system.',
        remediationAction: 'prompt_permission',
      }),
    };

    registry.register(mockPermCap);
    const health = await registry.probeHealth('test.camera');
    expect(health.state).toBe('PERMISSION_REQUIRED');
    expect(health.remediationAction).toBe('prompt_permission');
    expect(health.diagnosticDetails).toContain('CAMERA');
  });

  // ── Scenario 4: Unauthenticated external service returns AUTH_REQUIRED ──
  it('Scenario 4: An unauthenticated external service returns AUTH_REQUIRED with prompt_auth remediation', async () => {
    const mockAuthCap: DeviceCapability = {
      id: 'test.oauth_service',
      name: 'OAuth Service',
      description: 'Cloud provider requiring OAuth',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [
        {
          name: 'fetch_user',
          description: 'fetch user',
          risk: 'low',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Auth token expired', category: 'unavailable' } }),
      checkHealth: async () => ({
        capabilityId: 'test.oauth_service',
        state: 'AUTH_REQUIRED',
        lastCheckedMs: Date.now(),
        diagnosticDetails: 'OAuth access token missing or expired.',
        remediationAction: 'prompt_auth',
      }),
    };

    registry.register(mockAuthCap);
    const health = await registry.probeHealth('test.oauth_service');
    expect(health.state).toBe('AUTH_REQUIRED');
    expect(health.remediationAction).toBe('prompt_auth');
  });

  // ── Scenario 5: Stopped or unreachable driver returns DRIVER_OFFLINE ──
  it('Scenario 5: A stopped or unreachable driver returns DRIVER_OFFLINE with restart_driver remediation', async () => {
    const mockDriverCap: DeviceCapability = {
      id: 'test.loopback_driver',
      name: 'Driver Test',
      description: 'Loopback service with offline driver',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [
        {
          name: 'exec',
          description: 'exec',
          risk: 'low',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false }),
      checkHealth: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:44083');
      },
    };

    registry.register(mockDriverCap);
    const health = await registry.probeHealth('test.loopback_driver');
    expect(health.state).toBe('DRIVER_OFFLINE');
    expect(health.remediationAction).toBe('restart_driver');
    expect(health.diagnosticDetails).toContain('ECONNREFUSED');
  });

  // ── Scenario 6: Missing dependency returns DEPENDENCY_MISSING ──
  it('Scenario 6: A missing dependency or unregistered capability returns DEPENDENCY_MISSING', async () => {
    const health = await registry.probeHealth('non_existent_capability');
    expect(health.state).toBe('DEPENDENCY_MISSING');
    expect(health.diagnosticDetails).toContain('not registered');

    const mockMissingDepCap: DeviceCapability = {
      id: 'test.missing_binary',
      name: 'Missing Binary',
      description: 'Requires missing native binary',
      availability: { supported: false, reason: 'ffmpeg binary not found in PATH' },
      requiredPermissions: [],
      supportedOperations: [],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false }),
    };

    registry.register(mockMissingDepCap);
    const capHealth = await registry.probeHealth('test.missing_binary');
    expect(capHealth.state).toBe('DEPENDENCY_MISSING');
    expect(capHealth.diagnosticDetails).toContain('ffmpeg binary not found');
  });

  // ── Scenario 7: Rate limiting is classified distinctly ──
  it('Scenario 7: Rate limiting is classified distinctly as RATE_LIMITED with wait remediation', async () => {
    const mockRateLimitedCap: DeviceCapability = {
      id: 'test.rate_limited_api',
      name: 'Rate Limited API',
      description: 'API under active rate limit',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false }),
      checkHealth: async () => ({
        capabilityId: 'test.rate_limited_api',
        state: 'RATE_LIMITED',
        lastCheckedMs: Date.now(),
        diagnosticDetails: 'HTTP 429: Exceeded 60 requests per minute quota.',
        remediationAction: 'wait',
      }),
    };

    registry.register(mockRateLimitedCap);
    const health = await registry.probeHealth('test.rate_limited_api');
    expect(health.state).toBe('RATE_LIMITED');
    expect(health.remediationAction).toBe('wait');
  });

  // ── Scenario 8: Hanging probe times out at 500ms hard boundary ──
  it('Scenario 8: Enforces 500ms hard timeout on hanging probes, marking TEMPORARILY_UNAVAILABLE', async () => {
    const hangingCap: DeviceCapability = {
      id: 'test.hanging_driver',
      name: 'Hanging Driver',
      description: 'Hangs indefinitely on health check',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false }),
      checkHealth: async (_ctx, signal) => {
        return new Promise<CapabilityHealthStatus>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              capabilityId: 'test.hanging_driver',
              state: 'AVAILABLE',
              lastCheckedMs: Date.now(),
            });
          }, 2000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new Error(ERR_CAPABILITY_PROBE_FAILED));
          });
        });
      },
    };

    registry.register(hangingCap);

    const start = Date.now();
    const health = await registry.probeHealth('test.hanging_driver');
    const elapsed = Date.now() - start;

    // Must resolve within ~500ms (tolerance for event loop: 450 - 700ms)
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(750);

    expect(health.state).toBe('TEMPORARILY_UNAVAILABLE');
    expect(health.diagnosticDetails).toContain(ERR_CAPABILITY_PROBE_FAILED);
    expect(health.remediationAction).toBe('wait');
  });

  // ── Scenario 9: Probe rejection & malformed responses fail closed ──
  it('Scenario 9: Probe rejection and malformed responses fail closed (never treated as healthy)', async () => {
    const rejectingCap: DeviceCapability = {
      id: 'test.rejecting_driver',
      name: 'Rejecting Driver',
      description: 'Throws error during check',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false }),
      checkHealth: async () => {
        throw new Error('Fatal socket fault: connection aborted');
      },
    };

    registry.register(rejectingCap);
    const health = await registry.probeHealth('test.rejecting_driver');

    // Fails closed to DRIVER_OFFLINE
    expect(health.state).toBe('DRIVER_OFFLINE');
    expect(health.state).not.toBe('AVAILABLE');
    expect(health.remediationAction).toBe('restart_driver');
  });

  // ── Scenario 10: Late health probe responses cannot overwrite newer state ──
  it('Scenario 10: Late health probe responses cannot overwrite newer authoritative state', async () => {
    let lateResolve: (val: CapabilityHealthStatus) => void;
    const delayedPromise = new Promise<CapabilityHealthStatus>((res) => {
      lateResolve = res;
    });

    const racingCap: DeviceCapability = {
      id: 'test.racing_cap',
      name: 'Racing Capability',
      description: 'Simulates late resolving probe',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: false }),
      checkHealth: async () => delayedPromise,
    };

    registry.register(racingCap);

    // Launch slow probe 1
    const probe1Promise = registry.probeHealth('test.racing_cap', { force: true });

    // Meanwhile, set authoritative status to DRIVER_OFFLINE
    registry.setHealthStatus({
      capabilityId: 'test.racing_cap',
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'Explicit outage injected',
      remediationAction: 'restart_driver',
    });

    // Authoritative status is DRIVER_OFFLINE
    expect(registry.getHealthStatus('test.racing_cap').state).toBe('DRIVER_OFFLINE');

    // Now resolve probe 1 with a stale AVAILABLE
    lateResolve!({
      capabilityId: 'test.racing_cap',
      state: 'AVAILABLE',
      lastCheckedMs: Date.now(),
    });

    await probe1Promise;

    // Authoritative status must NOT be overwritten by the superseded probe 1!
    expect(registry.getHealthStatus('test.racing_cap').state).toBe('DRIVER_OFFLINE');
  });

  // ── Scenario 11: Offline capability cannot be selected by the planner ──
  it('Scenario 11: An offline capability cannot be selected by matchCapability()', () => {
    // Put phone control in DRIVER_OFFLINE state
    registry.setHealthStatus({
      capabilityId: 'device.phone_control',
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'PhoneDriverServer daemon is stopped',
      remediationAction: 'restart_driver',
    });

    const resolution = registry.matchCapability({
      objective: 'Control phone and tap the screen',
      contextKeywords: ['tap screen'],
      requiredDataFreshness: 'static',
      targetDevice: 'android_local',
      activeBotId: 'bot-1',
    });

    // Must NEVER select DRIVER_OFFLINE capability
    expect(resolution.primaryCapabilityId).toBeUndefined();
    expect(resolution.chosenModality).toBe('user_clarification');
    expect(resolution.justification).toContain('[DRIVER_OFFLINE]');
    expect(resolution.justification).toContain('restart_driver');
  });

  // ── Scenario 12: Stale dispatch protection ──
  it('Scenario 12: A capability that becomes offline between planning and dispatch is blocked at execution gate', async () => {
    const mockCap: DeviceCapability = {
      id: 'test.stale_dispatch',
      name: 'Stale Dispatch Test',
      description: 'Goes offline before dispatch',
      availability: { supported: true },
      requiredPermissions: [],
      supportedOperations: [
        {
          name: 'run',
          description: 'run',
          risk: 'low',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ],
      riskClassification: 'low',
      lifecycleBehavior: 'stateless',
      execute: async () => ({ success: true, data: { done: true } }),
    };

    registry.register(mockCap);
    registry.setHealthStatus({
      capabilityId: 'test.stale_dispatch',
      state: 'AVAILABLE',
      lastCheckedMs: Date.now(),
    });

    // 1. Initial plan formulated while healthy
    const loop = new AgentExecutionLoop({
      objective: 'Perform test run',
      capabilityRegistry: registry,
      initialPlan: {
        action: 'run_step',
        capabilityId: 'test.stale_dispatch',
        operation: 'run',
      },
    });

    // 2. State transition immediately before dispatch: capability driver goes offline!
    registry.setHealthStatus({
      capabilityId: 'test.stale_dispatch',
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'Driver connection died before invocation',
      remediationAction: 'restart_driver',
    });

    // 3. Execution attempt must fail closed!
    loop.advanceToPlan();
    const result = await loop.executeAction();
    expect(result.success).toBe(false);
    expect(result.error).toContain('DRIVER_OFFLINE');
    expect(result.resultSummary).toContain('DRIVER_OFFLINE');
  });

  // ── Scenario 13: Unavailable capability yields structured error & remediation ──
  it('Scenario 13: An unavailable capability yields a structured error and remediation details on invoke()', async () => {
    registry.setHealthStatus({
      capabilityId: 'device.calendar',
      state: 'PERMISSION_REQUIRED',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'android.permission.WRITE_CALENDAR is required.',
      remediationAction: 'prompt_permission',
    });

    const res = await registry.invoke('device.calendar', 'create_event', {
      title: 'Test meeting',
    });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_REQUIRED');
    expect(res.error?.category).toBe('permission_denied');
    expect((res.error?.details as any)?.remediationAction).toBe('prompt_permission');
    expect((res.error?.details as any)?.state).toBe('PERMISSION_REQUIRED');
  });

  // ── Scenario 14: Alternative selection works when compatible healthy alternative exists ──
  it('Scenario 14: Dynamically routes to healthy alternative when primary capability is DRIVER_OFFLINE', () => {
    // Primary browser is down
    registry.setHealthStatus({
      capabilityId: 'device.browser',
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'BrowserDriverServer loopback port not responding',
      remediationAction: 'restart_driver',
    });

    // Healthy fallback web.scraper is available
    registry.setHealthStatus({
      capabilityId: 'web.scraper',
      state: 'AVAILABLE',
      lastCheckedMs: Date.now(),
    });

    const resolution = registry.matchCapability({
      objective: 'What were the latest AI headlines today?',
      contextKeywords: ['headlines', 'today'],
      requiredDataFreshness: 'realtime',
      targetDevice: 'android_local',
      activeBotId: 'bot-1',
    });

    // Must route to healthy web.scraper rather than failing completely
    expect(resolution.primaryCapabilityId).toBe('web.scraper');
    expect(resolution.chosenModality).toBe('web_search');
    expect(resolution.justification).toContain('routed to healthy web scraper');
  });

  // ── Scenario 15: Safe termination when no healthy alternative exists ──
  it('Scenario 15: Terminates safely with user_clarification and ERR_NO_CAPABLE_TOOL when all candidates are offline', () => {
    // Both browser and scraper are offline
    registry.setHealthStatus({
      capabilityId: 'device.browser',
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'Browser down',
      remediationAction: 'restart_driver',
    });

    registry.setHealthStatus({
      capabilityId: 'web.scraper',
      state: 'DEPENDENCY_MISSING',
      lastCheckedMs: Date.now(),
      diagnosticDetails: 'Scraper unavailable',
    });

    const resolution = registry.matchCapability({
      objective: 'Search for today weather',
      contextKeywords: ['weather', 'today'],
      requiredDataFreshness: 'realtime',
      targetDevice: 'android_local',
      activeBotId: 'bot-1',
    });

    expect(resolution.primaryCapabilityId).toBeUndefined();
    expect(resolution.chosenModality).toBe('user_clarification');
    expect(resolution.justification).toContain(ERR_NO_CAPABLE_TOOL);
  });

  // ── Scenario 16: Static registration alone does not establish runtime availability ──
  it('Scenario 16: Registration alone does not establish runtime availability when driver is missing', async () => {
    // device.phone_control is registered in registry by default
    expect(registry.has('device.phone_control')).toBe(true);

    // Delete PH_DRIVER_PORT from environment to simulate missing driver
    const origPort = process.env.PH_DRIVER_PORT;
    const origActive = process.env.OMB_PHONE_DRIVER_ACTIVE;
    delete process.env.PH_DRIVER_PORT;
    delete process.env.OMB_PHONE_DRIVER_ACTIVE;

    try {
      const health = await registry.probeHealth('device.phone_control', { force: true });
      expect(health.state).toBe('DRIVER_OFFLINE');
      expect(health.remediationAction).toBe('restart_driver');

      // Attempted execution is immediately refused
      const res = await registry.invoke('device.phone_control', 'tap', { x: 100, y: 200 });
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('DRIVER_OFFLINE');
    } finally {
      if (origPort) process.env.PH_DRIVER_PORT = origPort;
      if (origActive) process.env.OMB_PHONE_DRIVER_ACTIVE = origActive;
    }
  });

  // ── Scenario 17: Backward compatibility for healthy capabilities ──
  it('Scenario 17: Preserves full backward compatibility and seamless execution for healthy capabilities', async () => {
    // Normal clipboard execution succeeds
    const clipRes = await registry.invoke('device.clipboard', 'set_text', { text: 'Phase 13 verified' });
    expect(clipRes.success).toBe(true);

    const getRes = await registry.invoke('device.clipboard', 'get_text', {});
    expect(getRes.success).toBe(true);
    expect((getRes.data as any)?.text).toBe('Phase 13 verified');

    // Standard matching for normal greeting remains direct_answer
    const greetingRes = registry.matchCapability({
      objective: 'Hello there!',
      contextKeywords: [],
      requiredDataFreshness: 'static',
      targetDevice: 'android_local',
      activeBotId: 'bot-default',
    });
    expect(greetingRes.chosenModality).toBe('direct_answer');
  });
});

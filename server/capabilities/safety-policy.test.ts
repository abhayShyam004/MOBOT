import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DeviceSafetyPolicy,
  ActionAuthorizationManager,
  defaultActionAuthorizationManager,
  ERR_CONFIRMATION_REQUIRED,
  ERR_CONFIRMATION_REJECTED,
  ERR_CONFIRMATION_EXPIRED,
  ERR_CONFIRMATION_INVALID,
} from './safety-policy.ts';
import { DeviceCapabilityRegistry } from './capability-registry.ts';
import { AgentExecutionLoop } from './orchestration.ts';
import { ObservabilityBus } from './observability.ts';

describe('DeviceSafetyPolicy (Legacy Phase Q Compatibility)', () => {
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

describe('Official Roadmap Phase 14: Risk-Aware Autonomy (mobot_54_phases_prompt.md:925-995)', () => {
  let registry: DeviceCapabilityRegistry;
  let authManager: ActionAuthorizationManager;

  beforeEach(() => {
    registry = new DeviceCapabilityRegistry();
    authManager = defaultActionAuthorizationManager;
    authManager.clear();
  });

  afterEach(() => {
    authManager.clear();
  });

  // ── 1. Safe read-only operation proceeds without an unnecessary confirmation prompt ──
  it('Scenario 1: A safe read-only operation proceeds without an unnecessary confirmation prompt', async () => {
    const evalResult = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'stat',
      parameters: { path: '/sdcard/Download/readme.txt' },
      approvalMode: 'ask',
    });
    expect(evalResult.tier).toBe('low');
    expect(evalResult.requiresExplicitConfirmation).toBe(false);
    expect(evalResult.reversible).toBe(true);

    // Invocation proceeds without requiring confirmation grant
    const res = await registry.invoke(
      'device.files',
      'stat',
      { path: '/sdcard/Download/readme.txt' },
      { approvalMode: 'ask' }
    );
    expect(res.error?.code).not.toBe(ERR_CONFIRMATION_REQUIRED);
  });

  // ── 2. A high-risk operation requires the appropriate authorization ──
  it('Scenario 2: A high-risk operation requires the appropriate authorization', async () => {
    const evalResult = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: '/sdcard/Download/budget.xlsx' },
      approvalMode: 'ask',
    });
    expect(evalResult.tier).toBe('high');
    expect(evalResult.requiresExplicitConfirmation).toBe(true);
    expect(evalResult.reversible).toBe(false);

    // Calling invoke without grant is rejected at the pre-dispatch gate
    const res = await registry.invoke(
      'device.files',
      'delete',
      { path: '/sdcard/Download/budget.xlsx' },
      { approvalMode: 'ask' }
    );
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(ERR_CONFIRMATION_REQUIRED);
    expect(res.error?.category).toBe('permission_denied');
  });

  // ── 3. A destructive operation cannot bypass authorization by calling a capability directly ──
  it('Scenario 3: Destructive operation cannot bypass authorization; mass deletions blocked even under full mode', async () => {
    // Standard delete under 'auto' mode requires prompt
    const autoDelete = await registry.invoke(
      'device.files',
      'delete',
      { path: '/sdcard/Download/important.doc' },
      { approvalMode: 'auto' }
    );
    expect(autoDelete.success).toBe(false);
    expect(autoDelete.error?.code).toBe(ERR_CONFIRMATION_REQUIRED);

    // Mass deletion under 'full' mode: non-bypassable!
    const massDeleteEval = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: '/sdcard', recursive: true },
      approvalMode: 'full',
    });
    expect(massDeleteEval.tier).toBe('high');
    expect(massDeleteEval.isMassDeletion).toBe(true);
    expect(massDeleteEval.requiresExplicitConfirmation).toBe(true);

    const massDeleteRes = await registry.invoke(
      'device.files',
      'delete',
      { path: '/sdcard', recursive: true },
      { approvalMode: 'full' }
    );
    expect(massDeleteRes.success).toBe(false);
    expect(massDeleteRes.error?.code).toBe(ERR_CONFIRMATION_REQUIRED);
  });

  // ── 4. The actual production dispatch path enforces the safety decision ──
  it('Scenario 4: The actual production dispatch path in AgentExecutionLoop enforces safety decision', async () => {
    const bus = new ObservabilityBus();
    let confirmationEventFired = false;
    bus.subscribe((event) => {
      if (event.type === 'AGENT_LOOP_CONFIRMATION_REQUIRED') {
        confirmationEventFired = true;
      }
    });

    const loop = new AgentExecutionLoop({
      goalId: 'sec_test_goal',
      objective: 'Delete confidential file',
      approvalMode: 'ask',
      observabilityBus: bus,
      capabilityRegistry: registry,
      initialPlan: {
        action: 'Delete sensitive document',
        capabilityId: 'device.files',
        operation: 'delete',
        params: { path: '/sdcard/Download/confidential.pdf' },
      },
    });

    loop.advanceToPlan();
    const result = await loop.executeAction();
    expect(result.success).toBe(false);
    expect(result.error).toContain(ERR_CONFIRMATION_REQUIRED);
    expect(confirmationEventFired).toBe(true);
  });

  // ── 5. Changing an approved operation's parameters invalidates or re-evaluates the approval ──
  it('Scenario 5: Changing an approved operation parameters invalidates the confirmation grant', async () => {
    const approvedParams = { path: '/sdcard/Download/temp_cache.log' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: approvedParams,
    });

    // Invoke with tampered parameter
    const tamperedParams = { path: '/sdcard/Download/system_keystore.bks' };
    const res = await registry.invoke(
      'device.files',
      'delete',
      tamperedParams,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(ERR_CONFIRMATION_INVALID);
    expect(res.error?.message).toContain('modified since confirmation');
  });

  // ── 6. Changing the recipient or target after approval cannot reuse stale consent ──
  it('Scenario 6: Changing recipient or target after approval cannot reuse stale consent', async () => {
    const originalParams = { service: 'gmail', action: 'send_email', to: 'colleague@company.com', subject: 'Report' };
    const grant = authManager.createGrant({
      capabilityId: 'composio.service',
      operation: 'execute',
      parameters: originalParams,
    });

    // Attacker modifies recipient
    const modifiedRecipientParams = { service: 'gmail', action: 'send_email', to: 'attacker@evil.com', subject: 'Report' };
    const res = await registry.invoke(
      'composio.service',
      'execute',
      modifiedRecipientParams,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(ERR_CONFIRMATION_INVALID);
  });

  // ── 7. An expired approval is rejected ──
  it('Scenario 7: An expired approval is rejected with ERR_CONFIRMATION_EXPIRED', async () => {
    const params = { path: '/sdcard/Download/old.tmp' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
      ttlMs: 1, // Expires immediately
    });

    // Wait 10ms to ensure expiration
    await new Promise((r) => setTimeout(r, 10));

    const res = await registry.invoke(
      'device.files',
      'delete',
      params,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(ERR_CONFIRMATION_EXPIRED);
  });

  // ── 8. A denied action cannot be executed through an alternate capability as a workaround ──
  it('Scenario 8: A denied action cannot be executed through an alternate capability as a workaround', async () => {
    const targetFile = '/sdcard/Download/protected_database.sqlite';

    // User rejects deleting the database
    authManager.recordDenial('device.files', 'delete', { path: targetFile });

    // Attempting direct retry with device.files
    const retryRes = await registry.invoke(
      'device.files',
      'delete',
      { path: targetFile },
      { approvalMode: 'ask' }
    );
    expect(retryRes.success).toBe(false);
    expect(retryRes.error?.code).toBe(ERR_CONFIRMATION_REJECTED);

    // Attempting workaround via shell execution targeting the same protected file
    expect(authManager.isActionDenied('terminal', 'run_command', { path: targetFile })).toBe(true);
  });

  // ── 9. A cancelled approval never dispatches the protected action ──
  it('Scenario 9: A cancelled approval never dispatches the protected action', async () => {
    const params = { path: '/sdcard/Download/cancelled.pdf' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });

    // User cancels approval before execution
    authManager.revokeGrant(grant.grantId);

    const res = await registry.invoke(
      'device.files',
      'delete',
      params,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(ERR_CONFIRMATION_INVALID);
  });

  // ── 10. Replayed approval requests or tokens cannot authorize repeated consequential execution ──
  it('Scenario 10: One-time grant consumption prevents replay attacks', async () => {
    const params = { path: '/sdcard/Download/single_use.tmp' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });

    // First validation and consumption
    const firstCheck = authManager.validateAndConsumeGrant({
      grant,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });
    expect(firstCheck.valid).toBe(true);
    expect(grant.consumed).toBe(true);

    // Second validation attempt (replay attempt)
    const replayCheck = authManager.validateAndConsumeGrant({
      grant,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });
    expect(replayCheck.valid).toBe(false);
    expect(replayCheck.code).toBe(ERR_CONFIRMATION_INVALID);
    expect(replayCheck.reason).toContain('already been consumed');
  });

  // ── 11. Different operations exposed by the same capability receive different risk classifications ──
  it('Scenario 11: Different operations exposed by the same capability receive different risk classifications', () => {
    // device.files
    const readRisk = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'read',
      parameters: { path: '/a' },
      approvalMode: 'ask',
    });
    const writeRisk = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'write',
      parameters: { path: '/a', content: 'b' },
      approvalMode: 'ask',
    });
    const deleteRisk = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: '/a' },
      approvalMode: 'ask',
    });
    expect(readRisk.tier).toBe('low');
    expect(writeRisk.tier).toBe('medium');
    expect(deleteRisk.tier).toBe('high');

    // device.calendar
    const calList = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.calendar',
      operation: 'list_events',
      parameters: {},
      approvalMode: 'ask',
    });
    const calCreate = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.calendar',
      operation: 'create_event',
      parameters: { title: 'Meet' },
      approvalMode: 'ask',
    });
    const calDelete = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.calendar',
      operation: 'delete_event',
      parameters: { eventId: '123' },
      approvalMode: 'ask',
    });
    expect(calList.tier).toBe('low');
    expect(calCreate.tier).toBe('medium');
    expect(calDelete.tier).toBe('high');
  });

  // ── 12. Missing or malformed risk information fails safely for consequential actions ──
  it('Scenario 12: Missing or malformed risk information fails safely for consequential actions', () => {
    // Malformed mutation action with empty parameters
    const malformed = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'unknown_service',
      operation: 'delete_resource',
      parameters: {},
      approvalMode: 'auto',
    });
    expect(malformed.tier).toBe('high');
    expect(malformed.requiresExplicitConfirmation).toBe(true);
    expect(malformed.reversible).toBe(false);
  });

  // ── 13. Existing safe, read-only flows remain usable without new friction ──
  it('Scenario 13: Existing safe, read-only flows remain usable without new friction', async () => {
    const appsRes = await registry.invoke('device.apps', 'list_apps', {}, { approvalMode: 'ask' });
    expect(appsRes.error?.code).not.toBe(ERR_CONFIRMATION_REQUIRED);

    const clipRes = await registry.invoke('device.clipboard', 'get_text', {}, { approvalMode: 'ask' });
    expect(clipRes.error?.code).not.toBe(ERR_CONFIRMATION_REQUIRED);

    const shotRes = await registry.invoke('device.screenshot', 'take_screenshot', {}, { approvalMode: 'ask' });
    expect(shotRes.error?.code).not.toBe(ERR_CONFIRMATION_REQUIRED);
  });

  // ── 14. Existing capability-health enforcement from Phase 13 remains effective ──
  it('Scenario 14: Phase 13 capability-health enforcement remains authoritative before risk gate', async () => {
    registry.setHealthStatus({
      capabilityId: 'device.files',
      state: 'DRIVER_OFFLINE',
      lastCheckedMs: Date.now(),
      remediationAction: 'restart_driver',
      diagnosticDetails: 'Storage subsystem unmounted',
    });

    const res = await registry.invoke('device.files', 'read', { path: '/sdcard/test.txt' });
    // Must be blocked by Phase 13 health gate with DRIVER_OFFLINE
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DRIVER_OFFLINE');
    expect(res.error?.details).toBeDefined();
  });

  // ── 15. An execution failure after authorization is reported accurately ──
  it('Scenario 15: An execution failure after authorization is reported accurately without claiming false success', async () => {
    const params = { path: '/nonexistent/directory/unwritable_file.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });

    const res = await registry.invoke(
      'device.files',
      'delete',
      params,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    // After grant was consumed, driver failure must report failure honestly
    expect(res.success).toBe(false);
    expect(res.error?.code).not.toBe(ERR_CONFIRMATION_REQUIRED);
  });

  // ── 16. Approval behavior is consistent across relevant tools and connected-service paths ──
  it('Scenario 16: Approval behavior is consistent across tools and connected-service paths', () => {
    // Connected app read -> low risk
    const saasRead = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'composio.service',
      operation: 'list_messages',
      parameters: { channel: 'general' },
      approvalMode: 'ask',
    });
    expect(saasRead.tier).toBe('low');
    expect(saasRead.requiresExplicitConfirmation).toBe(false);

    // Connected app external send -> high risk
    const saasSend = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'composio.service',
      operation: 'post_message',
      parameters: { channel: 'general', text: 'Important announcement' },
      approvalMode: 'ask',
    });
    expect(saasSend.tier).toBe('high');
    expect(saasSend.requiresExplicitConfirmation).toBe(true);

    // Connected app delete repo -> high risk
    const saasDelete = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'composio.service',
      operation: 'delete_repo',
      parameters: { repo: 'org/repo' },
      approvalMode: 'auto',
    });
    expect(saasDelete.tier).toBe('high');
    expect(saasDelete.requiresExplicitConfirmation).toBe(true);
  });
});

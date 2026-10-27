// Physical-Device Verification Script for Samsung Galaxy A07 (Phase 14: Risk-Aware Autonomy)
//
// Verifies:
// 1. Safe read-only inspection proceeds frictionlessly without confirmation prompt
// 2. State creation (file write/draft) executes autonomously in task scope
// 3. Destructive/consequential actions (file delete) halt at pre-dispatch gate with ERR_CONFIRMATION_REQUIRED
// 4. Valid confirmation grant permits authorized execution
// 5. Parameter tampering invalidates confirmation token (SHA-256 parameter hash check)
// 6. Replay attack prevention: consumed grants cannot be reused
// 7. Rejection handling & alternate-path workaround prevention (recordDenial)
// 8. Mass deletion non-bypassability even under "full" approval mode
//
// Target: Samsung Galaxy A07 (SM-A075F, Android 16, ARM64)
// Fixture: com.openmausbot.companion.preview (PID 30688 / Node PID 30939)

import fs from 'node:fs';
import path from 'node:path';
import { DeviceCapabilityRegistry } from './capabilities/capability-registry.ts';
import {
  DeviceSafetyPolicy,
  defaultActionAuthorizationManager,
  ERR_CONFIRMATION_REQUIRED,
  ERR_CONFIRMATION_REJECTED,
  ERR_CONFIRMATION_INVALID,
} from './capabilities/safety-policy.ts';

const PREVIEW_PORT = 28889; // Forwarded to 18789 on device
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

export interface DeviceRiskScenarioReport {
  scenarioNumber: number;
  name: string;
  verdict: 'PASS' | 'FAIL';
  details: string;
  evidence: Record<string, unknown>;
}

export async function runDeviceRiskAutonomyVerification(): Promise<DeviceRiskScenarioReport[]> {
  const reports: DeviceRiskScenarioReport[] = [];
  const registry = new DeviceCapabilityRegistry();
  const authManager = defaultActionAuthorizationManager;
  authManager.clear();

  console.log('=== PHASE 14 PHYSICAL-DEVICE VERIFICATION: SAMSUNG GALAXY A07 ===');
  console.log(`Target: SM-A075F, Preview host port ${PREVIEW_PORT}`);

  // ── Scenario 1: Physical Host Identity & Preview Package Isolation ──
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = (await healthRes.json()) as Record<string, unknown>;
    console.log(`Live host health:`, healthData);

    const passed =
      healthRes.ok &&
      healthData.app === 'openmausbot' &&
      typeof healthData.pid === 'number' &&
      healthData.port === 18789;

    reports.push({
      scenarioNumber: 1,
      name: 'Physical Host Identity & Isolation: Preview host running on port 18789',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `App: ${healthData.app}, Host PID: ${healthData.pid}, Port: ${healthData.port}`,
      evidence: { healthData },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 1,
      name: 'Physical Host Identity & Isolation',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 2: Frictionless Safe Read Operations ──
  try {
    const evalResult = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.clipboard',
      operation: 'get_text',
      parameters: {},
      approvalMode: 'ask',
    });

    const invokeRes = await registry.invoke(
      'device.clipboard',
      'get_text',
      {},
      { approvalMode: 'ask' }
    );

    const passed =
      evalResult.tier === 'low' &&
      evalResult.requiresExplicitConfirmation === false &&
      invokeRes.success === true &&
      invokeRes.error === undefined;

    reports.push({
      scenarioNumber: 2,
      name: 'Frictionless Safe Read Operations: Read-only clipboard access executes immediately without confirmation',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Risk Tier: ${evalResult.tier}, requiresConfirmation: ${evalResult.requiresExplicitConfirmation}, invokeSuccess: ${invokeRes.success}`,
      evidence: { evalResult, invokeRes },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 2,
      name: 'Frictionless Safe Read Operations',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 3: Autonomous State Creation in Task Scope ──
  const testDir = path.resolve(process.cwd(), 'temp_risk_test');
  const testFile = path.join(testDir, 'scratchpad.txt');
  try {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const evalResult = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'write',
      parameters: { path: testFile, content: 'Phase 14 autonomous state creation' },
      approvalMode: 'ask',
    });

    // Write file through registry without confirmation grant
    const writeRes = await registry.invoke(
      'device.files',
      'write',
      { path: testFile, content: 'Phase 14 autonomous state creation', inTaskScope: true },
      { approvalMode: 'ask' }
    );

    const fileCreated = fs.existsSync(testFile);

    const passed =
      evalResult.tier === 'medium' &&
      evalResult.requiresExplicitConfirmation === false &&
      writeRes.success === true &&
      fileCreated === true;

    reports.push({
      scenarioNumber: 3,
      name: 'Autonomous State Creation: Scratchpad file write in task scope completes silently without prompt',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Tier: ${evalResult.tier}, requiresPrompt: ${evalResult.requiresExplicitConfirmation}, File exists on disk: ${fileCreated}`,
      evidence: { evalResult, writeRes, fileCreated, testFile },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 3,
      name: 'Autonomous State Creation in Task Scope',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 4: Consequential Action Gating (Destructive Deletion Blocked) ──
  try {
    const evalResult = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: testFile },
      approvalMode: 'ask',
    });

    // Attempt delete without confirmation grant
    const deleteAttemptRes = await registry.invoke(
      'device.files',
      'delete',
      { path: testFile },
      { approvalMode: 'ask' }
    );

    const fileStillPresent = fs.existsSync(testFile);

    const passed =
      evalResult.tier === 'high' &&
      evalResult.requiresExplicitConfirmation === true &&
      deleteAttemptRes.success === false &&
      deleteAttemptRes.error?.code === ERR_CONFIRMATION_REQUIRED &&
      fileStillPresent === true;

    reports.push({
      scenarioNumber: 4,
      name: 'Consequential Action Gating: File deletion halts with ERR_CONFIRMATION_REQUIRED; file remains intact',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Tier: ${evalResult.tier}, Error: ${deleteAttemptRes.error?.code}, File preserved: ${fileStillPresent}`,
      evidence: { evalResult, deleteAttemptRes, fileStillPresent },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 4,
      name: 'Consequential Action Gating',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 5: Authorized Execution with Valid Confirmation Grant ──
  try {
    const deleteParams = { path: testFile };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: deleteParams,
      ttlMs: 30000,
    });

    const authorizedDeleteRes = await registry.invoke(
      'device.files',
      'delete',
      deleteParams,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    const fileDeleted = !fs.existsSync(testFile);

    const passed =
      authorizedDeleteRes.success === true &&
      fileDeleted === true &&
      grant.consumed === true;

    reports.push({
      scenarioNumber: 5,
      name: 'Authorized Execution: Valid confirmation grant permits file deletion to proceed and consumes token',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Success: ${authorizedDeleteRes.success}, File deleted: ${fileDeleted}, Grant consumed: ${grant.consumed}`,
      evidence: { authorizedDeleteRes, fileDeleted, grantId: grant.grantId },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 5,
      name: 'Authorized Execution with Valid Confirmation Grant',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 6: Parameter Tampering Detection (SHA-256 Hash Guard) ──
  try {
    const originalParams = { path: '/tmp/benign_temp.txt' };
    const tamperedParams = { path: '/etc/hosts' };

    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: originalParams,
    });

    const tamperedRes = await registry.invoke(
      'device.files',
      'delete',
      tamperedParams,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    const passed =
      tamperedRes.success === false &&
      tamperedRes.error?.code === ERR_CONFIRMATION_INVALID &&
      tamperedRes.error?.message.includes('modified since confirmation');

    reports.push({
      scenarioNumber: 6,
      name: 'Parameter Tampering Detection: Modified parameters invalidate confirmation token via SHA-256 digest',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Error code: ${tamperedRes.error?.code}, Reason: ${tamperedRes.error?.message}`,
      evidence: { tamperedRes, originalParams, tamperedParams },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 6,
      name: 'Parameter Tampering Detection',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 7: Replay Attack Prevention ──
  try {
    const singleUseParams = { path: '/tmp/single_use.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: singleUseParams,
    });

    // First consumption
    const firstCheck = authManager.validateAndConsumeGrant({
      grant,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: singleUseParams,
    });

    // Replay attempt
    const replayRes = await registry.invoke(
      'device.files',
      'delete',
      singleUseParams,
      { approvalMode: 'ask', confirmationGrant: grant }
    );

    const passed =
      firstCheck.valid === true &&
      replayRes.success === false &&
      replayRes.error?.code === ERR_CONFIRMATION_INVALID &&
      replayRes.error?.message.includes('already been consumed');

    reports.push({
      scenarioNumber: 7,
      name: 'Replay Attack Prevention: One-time consumption blocks repeated execution of consequential action',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `First valid: ${firstCheck.valid}, Replay error: ${replayRes.error?.code}`,
      evidence: { firstCheck, replayRes },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 7,
      name: 'Replay Attack Prevention',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 8: Explicit Denial Handling & Workaround Prevention ──
  try {
    const protectedResource = '/data/system/users/0/settings.xml';
    authManager.recordDenial('device.files', 'delete', { path: protectedResource });

    // Attempt direct call on device.files
    const deniedRes = await registry.invoke(
      'device.files',
      'delete',
      { path: protectedResource },
      { approvalMode: 'ask' }
    );

    // Attempt workaround via terminal command
    const isShellWorkaroundBlocked = authManager.isActionDenied('terminal', 'run_command', {
      command: `rm -f ${protectedResource}`,
      path: protectedResource,
    });

    const passed =
      deniedRes.success === false &&
      deniedRes.error?.code === ERR_CONFIRMATION_REJECTED &&
      isShellWorkaroundBlocked === true;

    reports.push({
      scenarioNumber: 8,
      name: 'Explicit Denial & Workaround Prevention: Rejection halts execution and prevents alternate-path bypass',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Denied error: ${deniedRes.error?.code}, Alternate shell workaround blocked: ${isShellWorkaroundBlocked}`,
      evidence: { deniedRes, isShellWorkaroundBlocked },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 8,
      name: 'Explicit Denial Handling & Workaround Prevention',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 9: Mass Deletion Non-Bypassability under Full Auto Mode ──
  try {
    const massEval = DeviceSafetyPolicy.evaluateRisk({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: '/sdcard', recursive: true },
      approvalMode: 'full',
    });

    const massRes = await registry.invoke(
      'device.files',
      'delete',
      { path: '/sdcard', recursive: true },
      { approvalMode: 'full' }
    );

    const passed =
      massEval.tier === 'high' &&
      massEval.isMassDeletion === true &&
      massEval.requiresExplicitConfirmation === true &&
      massRes.success === false &&
      massRes.error?.code === ERR_CONFIRMATION_REQUIRED;

    reports.push({
      scenarioNumber: 9,
      name: 'Mass Deletion Non-Bypassability: Irreversible mass deletion strictly requires confirmation even under "full" mode',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `isMassDeletion: ${massEval.isMassDeletion}, requiresConfirmation: ${massEval.requiresExplicitConfirmation}, Error: ${massRes.error?.code}`,
      evidence: { massEval, massRes },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 9,
      name: 'Mass Deletion Non-Bypassability',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 10: Fabricated / Manufactured Grant Rejection (Authenticity) ──
  try {
    const fakeParams = { path: '/tmp/unauthorized_delete.txt' };
    const fabricatedGrant = {
      grantId: 'fake_grant_unissued_999',
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: fakeParams,
      parameterHash: 'fake_hash',
      approvedAtMs: Date.now(),
      expiresAtMs: Date.now() + 60000,
      consumed: false,
    };

    const fakeRes = authManager.validateAndConsumeGrant({
      grant: fabricatedGrant as any,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: fakeParams,
    });

    const passed =
      fakeRes.valid === false &&
      fakeRes.code === ERR_CONFIRMATION_INVALID;

    reports.push({
      scenarioNumber: 10,
      name: 'Grant Authenticity: Unissued / fabricated confirmation grants are strictly rejected',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Valid: ${fakeRes.valid}, Error code: ${fakeRes.code}`,
      evidence: { fakeRes },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 10,
      name: 'Grant Authenticity',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 11: Cross-Capability / Shell Denial Bypass Prevention ──
  try {
    const targetFile = '/sdcard/sensitive_backup.tar';
    authManager.recordDenial('device.files', 'delete', { path: targetFile });

    const isDirectDenied = authManager.isActionDenied('device.files', 'delete', { path: targetFile });
    const isShellDenied = authManager.isActionDenied('bash', 'exec', { command: `rm ${targetFile}` });

    const passed = isDirectDenied === true && isShellDenied === true;

    reports.push({
      scenarioNumber: 11,
      name: 'Denial Bypass Prevention: Denied action cannot be executed via alternate shell command',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Direct denied: ${isDirectDenied}, Shell denied: ${isShellDenied}`,
      evidence: { isDirectDenied, isShellDenied },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 11,
      name: 'Denial Bypass Prevention',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 12: Subsequent User Confirmation Overrides Prior Denial ──
  try {
    const unblockTarget = '/tmp/cache_to_clear.tmp';
    authManager.recordDenial('device.files', 'delete', { path: unblockTarget });

    const freshGrant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: unblockTarget },
    });

    const unblockRes = authManager.validateAndConsumeGrant({
      grantId: freshGrant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: unblockTarget },
    });

    const passed =
      unblockRes.valid === true &&
      authManager.isActionDenied('device.files', 'delete', { path: unblockTarget }) === false;

    reports.push({
      scenarioNumber: 12,
      name: 'Denial Resolution: Subsequent explicit user confirmation overrides prior denial without lockout',
      verdict: passed ? 'PASS' : 'FAIL',
      details: `Valid: ${unblockRes.valid}, Prior denial cleared: ${!authManager.isActionDenied('device.files', 'delete', { path: unblockTarget })}`,
      evidence: { unblockRes },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 12,
      name: 'Denial Resolution',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 13: Full Auto Mass Deletion Flag Evasion Matrix ──
  try {
    const evasionCommands = [
      'rm -r -f /sdcard',
      'rm -f -r /data',
      'rm -R /system',
      'rm --recursive --force /',
      'sh -c "rm -rf /"',
      'find . -delete',
      'mkfs.ext4 /dev/block/bootdevice',
    ];

    let allEvasionsBlocked = true;
    for (const cmd of evasionCommands) {
      const evalRes = DeviceSafetyPolicy.evaluateRisk({
        capabilityId: 'bash',
        operation: 'exec',
        parameters: { command: cmd },
        approvalMode: 'full',
      });
      if (!evalRes.isMassDeletion || !evalRes.requiresExplicitConfirmation) {
        allEvasionsBlocked = false;
        break;
      }
    }

    reports.push({
      scenarioNumber: 13,
      name: 'Mass Deletion Evasion Matrix: All flag permutations and command wrappers blocked under "full" mode',
      verdict: allEvasionsBlocked ? 'PASS' : 'FAIL',
      details: `All ${evasionCommands.length} evasions safely blocked: ${allEvasionsBlocked}`,
      evidence: { evasionCommands, allEvasionsBlocked },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 13,
      name: 'Mass Deletion Evasion Matrix',
      verdict: 'FAIL',
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // Clean up temp test directory
  try {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup error
  }

  return reports;
}

// Direct CLI execution
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('verify-device-risk-autonomy')) {
  runDeviceRiskAutonomyVerification()
    .then((reports) => {
      console.log('\n=== DEVICE VERIFICATION SUMMARY ===');
      let allPassed = true;
      for (const r of reports) {
        console.log(`Scenario ${r.scenarioNumber}: [${r.verdict}] ${r.name}`);
        console.log(`   Details: ${r.details}`);
        if (r.verdict !== 'PASS') allPassed = false;
      }
      console.log(`\nOverall: ${allPassed ? 'ALL SCENARIOS PASSED' : 'FAILURES DETECTED'}`);
      if (!allPassed) process.exit(1);
    })
    .catch((err) => {
      console.error('Fatal execution error:', err);
      process.exit(1);
    });
}

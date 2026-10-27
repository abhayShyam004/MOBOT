import { describe, it, expect, beforeEach } from 'vitest';
import {
  DeviceSafetyPolicy,
  ActionAuthorizationManager,
  canonicalParameterHash,
  ERR_CONFIRMATION_INVALID,
  ERR_CONFIRMATION_EXPIRED,
} from './safety-policy.ts';
import { autoVerdict } from '../auto-approve.ts';

describe('Adversarial Security Audit: Phase 14 Risk-Aware Autonomy', () => {
  let authManager: ActionAuthorizationManager;

  beforeEach(() => {
    authManager = new ActionAuthorizationManager();
  });

  // ── AUDIT SECTION 3: GRANT INTEGRITY & BINDING ──────────────────────────

  it('Section 3.1: Fabricated / Manufactured Grant must NOT be accepted without authoritative issuance', () => {
    const targetParams = { path: '/tmp/crucial_data.db' };
    const hash = canonicalParameterHash(targetParams);

    // Attacker crafts their own ActionConfirmationGrant without calling authManager.createGrant()
    const fabricatedGrant = {
      grantId: 'fabricated_grant_666',
      capabilityId: 'device.files',
      operation: 'delete',
      parameterHash: hash,
      approvedAtMs: Date.now(),
      expiresAtMs: Date.now() + 300_000,
      consumed: false,
    };

    const res = authManager.validateAndConsumeGrant({
      grant: fabricatedGrant as any,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: targetParams,
    });

    expect(res.valid).toBe(false);
    expect(res.code).toBe(ERR_CONFIRMATION_INVALID);
  });

  it('Section 3.2: Tampering with parameters invalidates grant via SHA-256 parameterHash mismatch', () => {
    const approvedParams = { path: '/tmp/safe_to_delete.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: approvedParams,
    });

    // Attacker attempts to substitute target path to a system file
    const tamperedParams = { path: '/etc/shadow' };
    const res = authManager.validateAndConsumeGrant({
      grantId: grant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: tamperedParams,
    });

    expect(res.valid).toBe(false);
    expect(res.code).toBe(ERR_CONFIRMATION_INVALID);
  });

  it('Section 3.3: Canonical parameter hashing handles deep nesting, key ordering, and unusual numeric values safely', () => {
    const p1 = { z: 1, a: [{ b: 2, c: 3 }], k: null };
    const p2 = { k: null, a: [{ c: 3, b: 2 }], z: 1 };
    expect(canonicalParameterHash(p1)).toBe(canonicalParameterHash(p2));

    // Differentiate NaN and null so they do not silently collapse
    const pNull = { a: null };
    const pNaN = { a: NaN };
    const pInf = { a: Infinity };
    const pNegInf = { a: -Infinity };

    const hashNull = canonicalParameterHash(pNull);
    const hashNaN = canonicalParameterHash(pNaN);
    const hashInf = canonicalParameterHash(pInf);
    const hashNegInf = canonicalParameterHash(pNegInf);

    expect(hashNull).not.toBe(hashNaN);
    expect(hashInf).not.toBe(hashNegInf);
    expect(hashInf).not.toBe(hashNull);
  });

  it('Section 3.4: Grant expiration is strictly enforced at the authoritative boundary', () => {
    const params = { path: '/tmp/temp.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
      ttlMs: 50, // 50ms TTL
    });

    // Artificially advance expiration
    grant.expiresAtMs = Date.now() - 100;

    const res = authManager.validateAndConsumeGrant({
      grantId: grant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });

    expect(res.valid).toBe(false);
    expect(res.code).toBe(ERR_CONFIRMATION_EXPIRED);
  });

  // ── AUDIT SECTION 4: CONCURRENCY & REPLAY ───────────────────────────────

  it('Section 4.1: Concurrent race conditions cannot double-spend a single-use grant', async () => {
    const params = { path: '/tmp/target.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });

    // Launch 15 simultaneous validations of the same grant
    const attempts = await Promise.all(
      Array.from({ length: 15 }).map(async () =>
        authManager.validateAndConsumeGrant({
          grantId: grant.grantId,
          capabilityId: 'device.files',
          operation: 'delete',
          parameters: params,
        })
      )
    );

    const successfulConsumptions = attempts.filter((a) => a.valid);
    const rejectedConsumptions = attempts.filter((a) => !a.valid && a.code === ERR_CONFIRMATION_INVALID);

    expect(successfulConsumptions.length).toBe(1);
    expect(rejectedConsumptions.length).toBe(14);
  });

  it('Section 4.2: Reuse of consumed grant after successful execution is rejected', () => {
    const params = { path: '/tmp/target.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });

    // 1st consumption
    const first = authManager.validateAndConsumeGrant({
      grantId: grant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });
    expect(first.valid).toBe(true);

    // 2nd consumption attempt (replay attack)
    const second = authManager.validateAndConsumeGrant({
      grantId: grant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
    });
    expect(second.valid).toBe(false);
    expect(second.code).toBe(ERR_CONFIRMATION_INVALID);
  });

  it('Section 4.3: Grant issued to Bot A cannot be consumed by Bot B', () => {
    const params = { path: '/tmp/target.txt' };
    const grant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
      botId: 'bot-alpha',
    });

    const res = authManager.validateAndConsumeGrant({
      grantId: grant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: params,
      botId: 'bot-bravo', // Different bot
    });

    expect(res.valid).toBe(false);
    expect(res.code).toBe(ERR_CONFIRMATION_INVALID);
  });

  // ── AUDIT SECTION 5: DENIAL TRACKING & BYPASSES ──────────────────────────

  it('Section 5.1: User denial cannot be bypassed via shell equivalent command', () => {
    const targetFile = '/sdcard/private_photos.zip';
    authManager.recordDenial('device.files', 'delete', { path: targetFile });

    // Direct retry is blocked
    expect(authManager.isActionDenied('device.files', 'delete', { path: targetFile })).toBe(true);

    // Alternate shell path attempting to delete the same target is blocked
    const isShellBypassDenied = authManager.isActionDenied('bash', 'exec', {
      command: `rm ${targetFile}`,
    });
    expect(isShellBypassDenied).toBe(true);
  });

  it('Section 5.2: Subsequent explicit user confirmation is not permanently locked out by past denial', () => {
    const targetFile = '/tmp/cache.log';
    authManager.recordDenial('device.files', 'delete', { path: targetFile });
    expect(authManager.isActionDenied('device.files', 'delete', { path: targetFile })).toBe(true);

    // User explicitly confirms deletion subsequently
    const freshGrant = authManager.createGrant({
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: targetFile },
    });

    const res = authManager.validateAndConsumeGrant({
      grantId: freshGrant.grantId,
      capabilityId: 'device.files',
      operation: 'delete',
      parameters: { path: targetFile },
    });

    expect(res.valid).toBe(true);
    // Prior denial was cleared for this target
    expect(authManager.isActionDenied('device.files', 'delete', { path: targetFile })).toBe(false);
  });

  it('Section 5.3: Denial of target A does not block unrelated legitimate actions on target B', () => {
    authManager.recordDenial('device.files', 'delete', { path: '/tmp/denied.txt' });

    expect(authManager.isActionDenied('device.files', 'delete', { path: '/tmp/denied.txt' })).toBe(true);
    expect(authManager.isActionDenied('device.files', 'delete', { path: '/tmp/allowed.txt' })).toBe(false);
    expect(authManager.isActionDenied('device.files', 'read', { path: '/tmp/allowed.txt' })).toBe(false);
  });

  // ── AUDIT SECTION 6: MASS DELETION & FULL AUTO INVARIANT ─────────────────

  it('Section 6.1: Mass deletions must NEVER be authorized under full auto mode', () => {
    const massDeletionCommands = [
      'rm -rf /',
      'rm -r -f /',
      'rm -f -r /sdcard',
      'rm -R /system',
      'rm --recursive --force /',
      'rm -rf *',
      'sh -c "rm -rf /"',
      'bash -c "rm -rf /sdcard"',
      'find . -delete',
      'find / -exec rm -rf {} +',
      'mkfs.ext4 /dev/block/bootdevice/by-name/userdata',
      'dd if=/dev/zero of=/dev/block/bootdevice',
      'rmdir /s /q C:\\',
    ];

    for (const cmd of massDeletionCommands) {
      const evalResult = DeviceSafetyPolicy.evaluateRisk({
        capabilityId: 'bash',
        operation: 'exec',
        parameters: { command: cmd },
        approvalMode: 'full', // Explicitly test full auto mode!
      });

      expect(
        evalResult.requiresExplicitConfirmation,
        `Command '${cmd}' must require confirmation even in full auto mode`
      ).toBe(true);
      expect(evalResult.tier).toBe('high');
      expect(evalResult.isMassDeletion).toBe(true);
    }
  });

  it('Section 6.2: Filesystem recursive wipes targeting root or system must be classified as mass deletion', () => {
    const fsWipes = [
      { path: '/', recursive: true },
      { path: '/sdcard', recursive: true },
      { path: '/system', recursive: true },
      { path: '*', recursive: true },
      { path: '.', recursive: true },
    ];

    for (const params of fsWipes) {
      const res = DeviceSafetyPolicy.evaluateRisk({
        capabilityId: 'device.files',
        operation: 'delete',
        parameters: params,
        approvalMode: 'full',
      });

      expect(res.requiresExplicitConfirmation).toBe(true);
      expect(res.isMassDeletion).toBe(true);
    }
  });

  it('Section 6.3: autoVerdict refuses to auto-approve mass deletion commands even under full mode', () => {
    const verdict = autoVerdict('full', 'Bash', {
      command: 'rm -rf /sdcard',
    });

    expect(verdict.approve).toBeNull();
    expect(verdict.source).toBe('explicit-approval-block');
  });

  // ── AUDIT SECTION 7 & 8: PRE-DISPATCH GATES & TRUTHFUL OUTCOMES ──────────

  it('Section 7.1: Low-risk read-only operations remain frictionless across approval modes', () => {
    const readOperations = [
      { cap: 'device.files', op: 'read', params: { path: '/workspace/README.md' } },
      { cap: 'device.browser', op: 'search', params: { query: 'weather tomorrow' } },
      { cap: 'device.clipboard', op: 'get', params: {} },
      { cap: 'device.apps', op: 'list_apps', params: {} },
      { cap: 'device.calendar', op: 'list_events', params: {} },
    ];

    for (const item of readOperations) {
      const res = DeviceSafetyPolicy.evaluateRisk({
        capabilityId: item.cap,
        operation: item.op,
        parameters: item.params,
        approvalMode: 'ask',
      });

      expect(res.tier).toBe('low');
      expect(res.requiresExplicitConfirmation).toBe(false);
    }
  });
});

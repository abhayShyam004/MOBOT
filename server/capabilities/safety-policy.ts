/**
 * Safety and Consent Model for Device Actions (Official Roadmap Phase 14: Risk-Aware Autonomy).
 *
 * Implements risk tiers and approval logic aligned with MOBOT principles:
 * - SAFE OPERATIONS SHOULD FEEL EASY (low risk read-only, clipboard, search, preview)
 * - CONTEXTUAL STATE CREATION PROCEEDS AUTONOMOUSLY (medium risk creation/writes within task scope)
 * - CONSEQUENTIAL ACTIONS ARE RIGOROUSLY PROTECTED (destructive deletes, external visible mutations)
 * - CRITICAL INVARIANT: Mass deletions (e.g. rm -rf) can never be silently executed even under full auto
 * - AUTHORITATIVE PRE-DISPATCH EXECUTION GATE: Confirmation tokens bound to exact operation and parameters
 */

import { createHash } from 'node:crypto';
import type {
  RiskTier,
  RiskEvaluationRequest,
  RiskEvaluationResult,
  ActionConfirmationGrant,
} from './types.ts';
import {
  ERR_CONFIRMATION_REQUIRED,
  ERR_CONFIRMATION_REJECTED,
  ERR_CONFIRMATION_EXPIRED,
  ERR_CONFIRMATION_INVALID,
} from './types.ts';
import type { ApprovalMode } from '../../shared/approval-mode.ts';

export {
  ERR_CONFIRMATION_REQUIRED,
  ERR_CONFIRMATION_REJECTED,
  ERR_CONFIRMATION_EXPIRED,
  ERR_CONFIRMATION_INVALID,
};

// ── Official Roadmap Phase 15: Natural Uncertainty Authority Exports ──
export type {
  AmbiguityResolution,
  AmbiguityType,
  ConsequenceLevel,
  AmbiguityStrategy,
  ClarificationQuestion,
  AmbiguityValidationResult,
  AmbiguityResolutionContext,
  AmbiguityResolutionRequest,
  PendingAmbiguityTask,
  ClarificationAnswer,
  ResumedTaskResult,
} from './ambiguity-resolver.ts';

export {
  ERR_PARALYSIS_BY_UNCERTAINTY,
  validateAmbiguityResolution,
  resolveAmbiguity,
  resumeTaskWithClarification,
} from './ambiguity-resolver.ts';

export interface RiskAssessment {
  risk: RiskTier;
  reason: string;
  requiresPrompt: boolean;
  consequential: boolean;
}

/**
 * Deterministic canonical parameter hashing.
 * Sorts keys recursively so parameter order does not alter the hash,
 * while any parameter value change completely invalidates the hash.
 */
export function canonicalParameterHash(parameters: Record<string, unknown> = {}): string {
  const sanitize = (val: unknown): unknown => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'number') {
      if (Number.isNaN(val)) return '__NaN__';
      if (!Number.isFinite(val)) return val > 0 ? '__Infinity__' : '__-Infinity__';
      return val;
    }
    if (Array.isArray(val)) return val.map(sanitize);
    if (typeof val === 'object') {
      const sortedObj: Record<string, unknown> = {};
      const keys = Object.keys(val as Record<string, unknown>).sort();
      for (const k of keys) {
        sortedObj[k] = sanitize((val as Record<string, unknown>)[k]);
      }
      return sortedObj;
    }
    return val;
  };

  const canonicalObj = sanitize(parameters);
  return createHash('sha256').update(JSON.stringify(canonicalObj)).digest('hex');
}

/**
 * Robust classifier for destructive mass-deletion commands.
 * Detects recursive wipes, root/system targets, format/mkfs, block device overwrites,
 * and command wrappers across POSIX flag combinations.
 */
export function isMassDeletionCommand(rawCmd: string): boolean {
  if (!rawCmd || typeof rawCmd !== 'string') return false;
  const cmd = rawCmd.trim();
  if (!cmd) return false;

  // 1. Unwrap common shell wrappers: sh -c "...", bash -c "...", sudo ..., eval "..."
  const unwrapPattern = /^(?:sh|bash|zsh|sudo|eval|exec|nohup)\s+(?:-c\s+)?["']?(.*?)["']?$/i;
  let innerCmd = cmd;
  const match = cmd.match(unwrapPattern);
  if (match && match[1]) {
    innerCmd = match[1].trim();
  }

  // 2. Check for disk formatting, block device overwrites, system wipe utilities
  if (/\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted|wipefs|format)\b/i.test(innerCmd)) {
    return true;
  }
  if (/\bdd\s+.*?\bof=\/(?:dev\/(?:block\/|sd|vd|nvme|zero|null)|system|data|boot)/i.test(innerCmd)) {
    return true;
  }

  // 3. Check for recursive rm commands in all flag variations:
  // e.g. rm -rf, rm -r -f, rm -f -r, rm -R, rm --recursive, rm -fr, rm -r /...
  const isRm = /\brm\b/i.test(innerCmd);
  if (isRm) {
    const hasRecursiveFlag =
      /(?:^|\s)(?:-[a-zA-Z0-9_-]*[rR][a-zA-Z0-9_-]*|--recursive)(?:\s|$)/i.test(innerCmd);
    if (hasRecursiveFlag) {
      return true;
    }
  }

  // 4. Check find with -delete or -exec rm
  if (/\bfind\b/i.test(innerCmd) && /(?:^|\s)(?:-delete|-exec\s+rm|-execdir\s+rm)\b/i.test(innerCmd)) {
    return true;
  }

  // 5. Check git destructive wipes
  if (/\bgit\s+(?:clean\s+-(?:[a-z]*f[a-z]*d|[a-z]*d[a-z]*f)|reset\s+--hard)\b/i.test(innerCmd)) {
    return true;
  }

  // 6. Check Windows / cross-platform rmdir /s
  if (/\brmdir\s+\/s\b/i.test(innerCmd)) {
    return true;
  }

  return false;
}

export function normalizeCapabilityId(id: string): string {
  const lower = id.toLowerCase().trim();
  if (lower === 'phone-control' || lower === 'phone_control' || lower === 'device.phone-control' || lower === 'android_computer' || lower === 'device.phone_control') {
    return 'device.phone_control';
  }
  if (lower === 'apps' || lower === 'device.apps') {
    return 'device.apps';
  }
  return id;
}

export class DeviceSafetyPolicy {
  /**
   * Official Roadmap Phase 14: Risk Evaluation Data Contract
   * Determines risk tier, confirmation requirement, impact description, and reversibility.
   */
  static evaluateRisk(request: RiskEvaluationRequest): RiskEvaluationResult {
    const { capabilityId, operation, parameters = {}, approvalMode = 'ask' } = request;
    const lowerCap = normalizeCapabilityId(capabilityId).toLowerCase();
    const lowerOp = operation.toLowerCase();
    const paramStr = JSON.stringify(parameters).toLowerCase();

    // ── 1. Mass Deletions & Catastrophic Operations (CRITICAL ANTI-PATTERN) ──
    // Invariant: Never allow a "full auto" setting to silently execute irreversible mass deletions.
    const isFilesystemOrTerminal =
      lowerCap === 'device.files' ||
      lowerCap === 'workspace' ||
      lowerCap === 'filesystem' ||
      /^(bash|sh|terminal|shell|exec|run_command)/i.test(lowerCap) ||
      /^(bash|sh|terminal|shell|exec|run_command)/i.test(lowerOp);

    const isRecursive = Boolean(
      parameters.recursive === true ||
      parameters.all === true ||
      parameters.force === true
    );
    const targetPath = String(parameters.path || parameters.target || parameters.command || parameters.cmd || parameters.script || '');
    const cmdStr = String(parameters.command || parameters.cmd || parameters.script || targetPath);

    const isRootOrSystemTarget =
      isFilesystemOrTerminal &&
      (/^(\/|\/sdcard\/?|\/data\/?|\/system\/?|\/workspace\/?|\*|\.\*|\.{1,2}\/?)$/i.test(targetPath.trim()) ||
        isMassDeletionCommand(cmdStr) ||
        /\b(?:mkfs|format)\b/i.test(cmdStr));

    const isMassDeletion =
      isFilesystemOrTerminal &&
      ((lowerOp.includes('delete') && (isRecursive || isRootOrSystemTarget)) ||
        lowerOp.includes('purge') ||
        lowerOp.includes('wipe') ||
        lowerOp.includes('format') ||
        isMassDeletionCommand(cmdStr));

    if (isMassDeletion) {
      return {
        tier: 'high',
        requiresExplicitConfirmation: true, // NEVER bypassed, even under "full" mode
        consequentialImpactDescription: `Irreversible mass deletion of resources ('${targetPath || cmdStr || 'multiple targets'}').`,
        reversible: false,
        isMassDeletion: true,
      };
    }

    // ── 2. Filesystem Capability (device.files) ──
    if (lowerCap === 'device.files' || lowerCap === 'workspace' || lowerCap === 'filesystem') {
      if (['read', 'list', 'stat', 'exists', 'glob', 'grep'].includes(lowerOp)) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Read-only inspection of file '${targetPath || 'workspace'}'.`,
          reversible: true,
        };
      }
      if (['write', 'append', 'mkdir', 'copy', 'move'].includes(lowerOp)) {
        const outOfScope = parameters.inTaskScope === false;
        return {
          tier: 'medium',
          requiresExplicitConfirmation: outOfScope && approvalMode === 'ask',
          consequentialImpactDescription: `Modifying file or directory '${targetPath || 'target'}'.`,
          reversible: false,
        };
      }
      if (['delete', 'remove', 'unlink'].includes(lowerOp)) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: approvalMode !== 'full',
          consequentialImpactDescription: `Deleting file '${targetPath || 'target'}' is irreversible.`,
          reversible: false,
        };
      }
    }

    // ── 3. Browser Capability (device.browser / web.scraper) ──
    if (lowerCap === 'device.browser' || lowerCap === 'web.scraper') {
      if (['open', 'navigate', 'search', 'get_text', 'dom', 'screenshot', 'status', 'cookies', 'scrape'].includes(lowerOp)) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Inspecting web content at '${parameters.url || parameters.query || 'target'}'.`,
          reversible: true,
        };
      }
      // Interactive form submissions, purchasing, financial transactions or account mutations
      const isConsequentialBrowserAction =
        /\b(?:submit|checkout|buy|purchase|pay|transfer|delete|unsubscribe|confirm)\b/i.test(
          `${lowerOp} ${paramStr}`
        );
      if (isConsequentialBrowserAction) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: approvalMode !== 'full',
          consequentialImpactDescription: `Submitting consequential action or form in browser.`,
          reversible: false,
        };
      }
      if (['click', 'type', 'fill', 'eval', 'evaluate'].includes(lowerOp)) {
        return {
          tier: 'medium',
          requiresExplicitConfirmation: approvalMode === 'ask',
          consequentialImpactDescription: `Interacting with web page elements.`,
          reversible: true,
        };
      }
    }

    // ── 4. Calendar Capability (device.calendar) ──
    if (lowerCap === 'device.calendar') {
      if (['list_events', 'get_event', 'list', 'read'].includes(lowerOp)) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Inspecting calendar events.`,
          reversible: true,
        };
      }
      if (['create_event', 'update_event', 'create', 'update'].includes(lowerOp)) {
        const outOfScope = parameters.inTaskScope === false;
        return {
          tier: 'medium',
          requiresExplicitConfirmation: outOfScope && approvalMode === 'ask',
          consequentialImpactDescription: `Scheduling or modifying calendar event '${parameters.title || 'Event'}'.`,
          reversible: true,
        };
      }
      if (['delete_event', 'delete'].includes(lowerOp)) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: approvalMode !== 'full',
          consequentialImpactDescription: `Deleting calendar event is irreversible.`,
          reversible: false,
        };
      }
    }

    // ── 5. Connected Apps & External SaaS (composio.service) ──
    if (lowerCap.startsWith('composio') || lowerCap.startsWith('mcp__composio')) {
      const isReadSaas = /(?:read|list|get|search|fetch|query|inspect|find)/i.test(lowerOp);
      const isDestructiveSaas = /(?:delete|destroy|purge|remove|close|cancel|terminate)/i.test(lowerOp) || /(?:delete|destroy|purge|remove)/i.test(paramStr);
      const isExternalPublish = /(?:send|post|publish|commit|push|tweet|transfer|pay|invite)/i.test(lowerOp) || /(?:send_message|send_email|post_message)/i.test(lowerOp) || /(?:send_message|send_email|post_message)/i.test(paramStr);

      if (isReadSaas && !isDestructiveSaas && !isExternalPublish) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Reading information from external connected service.`,
          reversible: true,
        };
      }
      if (isDestructiveSaas || isExternalPublish) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: approvalMode !== 'full',
          consequentialImpactDescription: `Executing externally visible or destructive SaaS action (${operation}).`,
          reversible: false,
        };
      }
      return {
        tier: 'medium',
        requiresExplicitConfirmation: approvalMode === 'ask',
        consequentialImpactDescription: `Modifying state in connected service (${operation}).`,
        reversible: true,
      };
    }

    // ── 6. Phone Control & Native Gestures (device.phone_control) ──
    if (lowerCap === 'device.phone_control' || lowerCap === 'android_computer') {
      if (['status', 'read_screen', 'screenshot', 'list_apps', 'get_location'].includes(lowerOp)) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Reading on-screen device state.`,
          reversible: true,
        };
      }
      // Check if gesture targets a high-consequence button
      const targetText = String(parameters.text || parameters.label || parameters.query || '');
      const isDestructiveGesture = /\b(?:delete|uninstall|clear data|factory reset|format|send money|pay|checkout)\b/i.test(targetText);
      if (isDestructiveGesture) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: true, // Destructive UI gesture
          consequentialImpactDescription: `Interacting with high-consequence UI control '${targetText}'.`,
          reversible: false,
        };
      }
      return {
        tier: 'medium',
        requiresExplicitConfirmation: approvalMode === 'ask',
        consequentialImpactDescription: `Performing phone control gesture (${operation}).`,
        reversible: true,
      };
    }

    // ── 7. Native Apps (device.apps) ──
    if (lowerCap === 'device.apps') {
      if (['list_apps', 'get_app_info', 'list', 'open_app', 'launch'].includes(lowerOp)) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: lowerOp.includes('open') || lowerOp.includes('launch')
            ? `Opening application '${parameters.packageName || parameters.name || 'target'}'.`
            : `Listing installed applications.`,
          reversible: true,
        };
      }
      if (['uninstall_app', 'uninstall', 'clear_data'].includes(lowerOp)) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: true,
          consequentialImpactDescription: `Uninstalling application '${parameters.packageName || 'target'}' is irreversible.`,
          reversible: false,
        };
      }
    }

    // ── 8. Clipboard (device.clipboard) ──
    if (lowerCap === 'device.clipboard') {
      return {
        tier: 'low',
        requiresExplicitConfirmation: false,
        consequentialImpactDescription: `${lowerOp.includes('set') ? 'Updating' : 'Reading'} clipboard content.`,
        reversible: true,
      };
    }

    // ── 9. Notifications, Reminders & Reach (device.notifications / device.reminders / device.reach) ──
    if (lowerCap === 'device.notifications' || lowerCap === 'device.reminders' || lowerCap === 'device.reach') {
      if (['list', 'get', 'status', 'list_events', 'check_readiness'].includes(lowerOp)) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Reading notifications, alarms, or reach events.`,
          reversible: true,
        };
      }
      if (['cancel_all', 'delete_all', 'clear_all', 'delete'].includes(lowerOp)) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: approvalMode !== 'full',
          consequentialImpactDescription: `Clearing notifications or deleting reminders.`,
          reversible: false,
        };
      }
      return {
        tier: 'medium',
        requiresExplicitConfirmation: approvalMode === 'ask',
        consequentialImpactDescription: `Posting notification or scheduling reminder.`,
        reversible: true,
      };
    }

    // ── 10. Sensor Read-Only Capabilities (device.location, device.camera) ──
    if (lowerCap === 'device.location') {
      return {
        tier: 'low',
        requiresExplicitConfirmation: false,
        consequentialImpactDescription: `Retrieving device geolocation.`,
        reversible: true,
      };
    }

    if (lowerCap === 'device.camera') {
      return {
        tier: 'medium',
        requiresExplicitConfirmation: approvalMode === 'ask',
        consequentialImpactDescription: `Capturing photo or video with device camera.`,
        reversible: false,
      };
    }

    if (lowerCap === 'device.share') {
      return {
        tier: 'medium',
        requiresExplicitConfirmation: approvalMode === 'ask',
        consequentialImpactDescription: `Presenting Android system share dialog.`,
        reversible: true,
      };
    }

    // ── 11. Terminal & Shell Commands ──
    if (/^(bash|sh|terminal|shell|exec|run_command)/i.test(lowerCap) || /^(bash|sh|terminal|shell|exec|run_command)/i.test(lowerOp)) {
      const cmd = String(parameters.command || parameters.script || parameters.cmd || '').trim();
      const isReadOnlyCmd = /^(?:ls|cat|grep|find|head|tail|wc|pwd|echo|which|stat|df|du)\b/i.test(cmd);
      const isDestructiveCmd = isMassDeletionCommand(cmd) || /\b(?:rm\s+-rf|rm\s+-r|mkfs|dd|git\s+reset\s+--hard|git\s+clean\s+-fd|drop\s+database|format)\b/i.test(cmd);

      if (isDestructiveCmd) {
        return {
          tier: 'high',
          requiresExplicitConfirmation: true, // Non-bypassable destructive command
          consequentialImpactDescription: `Executing destructive shell command: ${cmd}`,
          reversible: false,
          isMassDeletion: true,
        };
      }
      if (isReadOnlyCmd) {
        return {
          tier: 'low',
          requiresExplicitConfirmation: false,
          consequentialImpactDescription: `Read-only command execution: ${cmd}`,
          reversible: true,
        };
      }
      return {
        tier: 'medium',
        requiresExplicitConfirmation: approvalMode === 'ask',
        consequentialImpactDescription: `Shell command execution: ${cmd}`,
        reversible: false,
      };
    }

    // ── Default Fallback: Fail-safe classification ──
    const isMutationOp = /(?:delete|destroy|remove|send|write|create|post|update|set|drop|purge|wipe)/i.test(lowerOp);
    if (isMutationOp) {
      const isDestructive = /(?:delete|destroy|remove|drop|purge|wipe)/i.test(lowerOp);
      return {
        tier: isDestructive ? 'high' : 'medium',
        requiresExplicitConfirmation: isDestructive ? approvalMode !== 'full' : approvalMode === 'ask',
        consequentialImpactDescription: `State modification on ${capabilityId}:${operation}.`,
        reversible: !isDestructive,
      };
    }

    return {
      tier: 'low',
      requiresExplicitConfirmation: false,
      consequentialImpactDescription: `Harmless read or inspection on ${capabilityId}:${operation}.`,
      reversible: true,
    };
  }

  /**
   * Determine the risk tier of a specific device capability operation.
   * Preserved for backward compatibility; delegates to evaluateRisk.
   */
  static assessRisk(
    capabilityId: string,
    operation: string,
    params: Record<string, unknown> = {}
  ): RiskAssessment {
    const res = DeviceSafetyPolicy.evaluateRisk({
      capabilityId,
      operation,
      parameters: params,
      approvalMode: 'ask',
    });
    return {
      risk: res.tier,
      reason: res.consequentialImpactDescription,
      requiresPrompt: res.tier === 'high',
      consequential: res.tier === 'high' || res.tier === 'medium',
    };
  }

  /**
   * Evaluate whether an operation requires an explicit user approval prompt
   * given the bot's current approval mode.
   */
  static shouldPrompt(
    risk: RiskTier,
    approvalMode: ApprovalMode = 'auto'
  ): boolean {
    if (approvalMode === 'full') {
      return false;
    }
    if (risk === 'high') {
      return true;
    }
    if (risk === 'medium') {
      return approvalMode === 'ask';
    }
    return false;
  }

  /**
   * Determine whether an action represents a consequential state mutation
   * that requires strict post-action verification.
   */
  static isConsequential(
    capabilityId: string,
    operation: string,
    params: Record<string, unknown> = {}
  ): boolean {
    const res = DeviceSafetyPolicy.evaluateRisk({
      capabilityId,
      operation,
      parameters: params,
      approvalMode: 'ask',
    });
    return res.tier === 'high' || !res.reversible;
  }
}

/**
 * Authoritative Action Authorization Manager.
 * Binds explicit approvals to the exact operation and canonical parameters.
 * Enforces one-time grant consumption, expiration, and prevents replay or bypass.
 */
export interface CreateGrantOptions {
  capabilityId: string;
  operation: string;
  parameters: Record<string, unknown>;
  ttlMs?: number; // default: 5 minutes (300,000 ms)
  botId?: string;
  threadId?: string;
}

export class ActionAuthorizationManager {
  private readonly grants = new Map<string, ActionConfirmationGrant>();
  private readonly deniedActionTargets = new Set<string>();

  /**
   * Issue a cryptographic confirmation grant bound to the exact action and parameters.
   */
  createGrant(options: CreateGrantOptions): ActionConfirmationGrant {
    const grantId = `grant_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const parameterHash = canonicalParameterHash(options.parameters);
    const ttl = options.ttlMs && options.ttlMs > 0 ? options.ttlMs : 300_000;

    const grant: ActionConfirmationGrant = {
      grantId,
      capabilityId: options.capabilityId,
      operation: options.operation,
      parameterHash,
      approvedAtMs: Date.now(),
      expiresAtMs: Date.now() + ttl,
      consumed: false,
      botId: options.botId,
      threadId: options.threadId,
    };

    this.grants.set(grantId, grant);
    this.clearDenial(options.capabilityId, options.operation, options.parameters, options.botId);
    return grant;
  }

  /**
   * Clear any prior denial for an action or target when subsequent explicit confirmation is given.
   */
  clearDenial(
    capabilityId: string,
    operation: string,
    parameters: Record<string, unknown> = {},
    botId?: string
  ): void {
    const hash = canonicalParameterHash(parameters);
    const specificKey = `${botId || '*'}:${capabilityId}:${operation}:${hash}`;
    const wildcardKey = `*:${capabilityId}:${operation}:${hash}`;
    this.deniedActionTargets.delete(specificKey);
    this.deniedActionTargets.delete(wildcardKey);

    const normCap = normalizeCapabilityId(capabilityId);
    this.deniedActionTargets.delete(`${botId || '*'}:${normCap}:${operation}:${hash}`);
    this.deniedActionTargets.delete(`*:${normCap}:${operation}:${hash}`);

    const target = parameters.path || parameters.target || parameters.recipient || parameters.email || parameters.url;
    if (target) {
      this.deniedActionTargets.delete(`${botId || '*'}:target:${String(target).toLowerCase()}`);
      this.deniedActionTargets.delete(`*:target:${String(target).toLowerCase()}`);
    }
  }

  /**
   * Record a user denial to prevent silent retries or alternate-capability workarounds.
   */
  recordDenial(
    capabilityId: string,
    operation: string,
    parameters: Record<string, unknown> = {},
    botId?: string
  ): void {
    const hash = canonicalParameterHash(parameters);
    const key = `${botId || '*'}:${capabilityId}:${operation}:${hash}`;
    this.deniedActionTargets.add(key);

    // Also register target-level denial (e.g. specific file or recipient) to block alternate capability workarounds
    const target = parameters.path || parameters.target || parameters.recipient || parameters.email || parameters.url;
    if (target) {
      const semanticKey = `${botId || '*'}:target:${String(target).toLowerCase()}`;
      this.deniedActionTargets.add(semanticKey);
    }

    // Extract file targets from shell command parameters
    const cmd = String(parameters.command || parameters.cmd || parameters.script || '');
    if (cmd) {
      const tokens = cmd.split(/\s+/);
      for (const token of tokens) {
        if (token.startsWith('/') || token.startsWith('./') || token.startsWith('../')) {
          this.deniedActionTargets.add(`${botId || '*'}:target:${token.toLowerCase()}`);
        }
      }
    }
  }

  /**
   * Check whether an action or target has been explicitly denied by the user.
   */
  isActionDenied(
    capabilityId: string,
    operation: string,
    parameters: Record<string, unknown> = {},
    botId?: string
  ): boolean {
    const hash = canonicalParameterHash(parameters);
    const specificKey = `${botId || '*'}:${capabilityId}:${operation}:${hash}`;
    const wildcardKey = `*:${capabilityId}:${operation}:${hash}`;
    if (this.deniedActionTargets.has(specificKey) || this.deniedActionTargets.has(wildcardKey)) {
      return true;
    }

    const target = parameters.path || parameters.target || parameters.recipient || parameters.email || parameters.url;
    if (target) {
      const targetKey = `${botId || '*'}:target:${String(target).toLowerCase()}`;
      const targetWildcard = `*:target:${String(target).toLowerCase()}`;
      if (this.deniedActionTargets.has(targetKey) || this.deniedActionTargets.has(targetWildcard)) {
        return true;
      }
    }

    // Check if shell command targets a previously denied target
    const cmd = String(parameters.command || parameters.cmd || parameters.script || '');
    if (cmd) {
      const lowerCmd = cmd.toLowerCase();
      for (const entry of this.deniedActionTargets) {
        if (entry.includes(':target:')) {
          const deniedTarget = entry.split(':target:')[1];
          if (deniedTarget && lowerCmd.includes(deniedTarget)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Validate and consume a confirmation grant at the authoritative execution boundary.
   */
  validateAndConsumeGrant(input: {
    grant?: ActionConfirmationGrant;
    grantId?: string;
    capabilityId: string;
    operation: string;
    parameters: Record<string, unknown>;
    botId?: string;
    threadId?: string;
  }): { valid: boolean; code?: string; reason?: string } {
    let targetGrantId = input.grantId || input.grant?.grantId;
    const normInputCap = normalizeCapabilityId(input.capabilityId);

    // 1. If user previously denied the action, reject immediately
    if (this.isActionDenied(input.capabilityId, input.operation, input.parameters, input.botId) ||
        this.isActionDenied(normInputCap, input.operation, input.parameters, input.botId)) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_REJECTED,
        reason: 'User declined this operation. Action cannot be retried or bypassed via an alternate capability.',
      };
    }

    // 2. If no grant identifier was directly passed, look for an active, unconsumed grant matching (capability, operation)
    if (!targetGrantId) {
      for (const [id, g] of this.grants.entries()) {
        if (!g.consumed && Date.now() <= g.expiresAtMs) {
          const normGrantCap = normalizeCapabilityId(g.capabilityId);
          if (normGrantCap === normInputCap && g.operation === input.operation) {
            if ((!g.botId || !input.botId || g.botId === input.botId) &&
                (!g.threadId || !input.threadId || g.threadId === input.threadId)) {
              targetGrantId = id;
              break;
            }
          }
        }
      }
    }

    if (!targetGrantId) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_REQUIRED,
        reason: 'Explicit user confirmation required for this consequential action.',
      };
    }

    // 3. Authoritative Grant Lookup: Grant MUST exist in the authoritative store!
    // External callers cannot manufacture unissued in-memory grants to bypass authorization.
    const grant = this.grants.get(targetGrantId);
    if (!grant) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_INVALID,
        reason: 'Confirmation grant is unrecognized or was not issued by the authorization authority.',
      };
    }

    // 4. Authenticity & Tamper Verification: If an in-memory grant object was supplied,
    // it must strictly match the authoritative store record.
    if (input.grant && (input.grant.parameterHash !== grant.parameterHash || input.grant.grantId !== grant.grantId)) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_INVALID,
        reason: 'Confirmation grant payload has been tampered with.',
      };
    }

    // 5. Verify Capability and Operation match (with canonical alias normalization)
    const normGrantCap = normalizeCapabilityId(grant.capabilityId);
    if (normGrantCap !== normInputCap || grant.operation !== input.operation) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_INVALID,
        reason: `Confirmation grant was issued for '${grant.capabilityId}:${grant.operation}', but invoked with '${input.capabilityId}:${input.operation}'.`,
      };
    }

    // 6. Verify Parameter Hash (Protects against changed parameters, targets, or recipients)
    const currentHash = canonicalParameterHash(input.parameters);
    const emptyHash = canonicalParameterHash({});
    if (grant.parameterHash !== emptyHash && currentHash !== emptyHash && grant.parameterHash !== currentHash) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_INVALID,
        reason: 'Parameters have been modified since confirmation was granted. Approval is invalid.',
      };
    }

    // 7. Verify Not Already Consumed (Single-use / Replay Prevention)
    if (grant.consumed) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_INVALID,
        reason: 'Confirmation grant has already been consumed. Replay is rejected.',
      };
    }

    // 8. Verify Not Expired
    if (Date.now() > grant.expiresAtMs) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_EXPIRED,
        reason: 'Confirmation grant has expired.',
      };
    }

    // 8. Verify Bot Ownership if bound
    if (grant.botId && input.botId && grant.botId !== input.botId) {
      return {
        valid: false,
        code: ERR_CONFIRMATION_INVALID,
        reason: 'Confirmation grant belongs to a different bot partition.',
      };
    }

    // Authoritative execution consumption: One-time use enforced!
    grant.consumed = true;

    // A fresh explicit user confirmation supersedes any prior denial for this specific action
    const specificKey = `${input.botId || '*'}:${input.capabilityId}:${input.operation}:${currentHash}`;
    this.deniedActionTargets.delete(specificKey);
    this.deniedActionTargets.delete(`*:${input.capabilityId}:${input.operation}:${currentHash}`);

    const target = input.parameters.path || input.parameters.target || input.parameters.recipient;
    if (target) {
      this.deniedActionTargets.delete(`${input.botId || '*'}:target:${String(target).toLowerCase()}`);
      this.deniedActionTargets.delete(`*:target:${String(target).toLowerCase()}`);
    }

    return { valid: true };
  }

  /**
   * Cancel or revoke an active grant.
   */
  revokeGrant(grantId: string): boolean {
    const grant = this.grants.get(grantId);
    if (!grant) return false;
    grant.consumed = true;
    this.grants.delete(grantId);
    return true;
  }

  /**
   * Clear grants and denial records (e.g. for testing).
   */
  clear(): void {
    this.grants.clear();
    this.deniedActionTargets.clear();
  }
}

export const defaultActionAuthorizationManager = new ActionAuthorizationManager();

export function checkAgentExecutionPermission(
  toolOrCapability: string,
  permissions?: { terminal?: string; filesystem?: string; browser?: string; composio?: string } | null,
): { allowed: boolean; reason?: string } {
  if (!permissions) return { allowed: true };

  const terminalTools = new Set([
    "Bash", "run_command", "run_shell", "open_interactive",
    "terminal_start", "terminal_write", "terminal_read",
    "terminal_resize", "terminal_close", "terminal_list",
  ]);
  const filesystemTools = new Set([
    "ReadFile", "WriteFile", "EditFile",
    "workspace_list", "workspace_read", "workspace_write",
    "workspace_append", "workspace_mkdir", "workspace_move",
    "workspace_copy", "workspace_delete", "workspace_stat",
    "workspace_exists", "device.files",
  ]);
  const browserTools = new Set([
    "http_fetch", "web_search", "resource_inspect",
    "resource_fetch", "resource_download", "resource_extract_pdf",
    "resource_extract_html", "resource_artifacts", "browser_open",
    "browser_click", "browser_screenshot", "browser_navigate",
  ]);

  if (terminalTools.has(toolOrCapability) || /^(bash|sh|terminal|shell|exec)/i.test(toolOrCapability)) {
    if (permissions.terminal === "denied") {
      return { allowed: false, reason: "Permission Denied: Terminal & Shell Execution is disabled in Settings -> Permissions." };
    }
  }
  if (filesystemTools.has(toolOrCapability) || /^(fs_|file_|workspace_)/i.test(toolOrCapability)) {
    if (permissions.filesystem === "denied") {
      return { allowed: false, reason: "Permission Denied: Filesystem Read & Write is disabled in Settings -> Permissions." };
    }
  }
  if (browserTools.has(toolOrCapability) || /^(browser_|web_|http_)/i.test(toolOrCapability)) {
    if (permissions.browser === "denied") {
      return { allowed: false, reason: "Permission Denied: Browser & Network is disabled in Settings -> Permissions." };
    }
  }
  if (/^composio/i.test(toolOrCapability) || toolOrCapability.startsWith("mcp__composio")) {
    if (permissions.composio === "denied") {
      return { allowed: false, reason: "Permission Denied: Connected Apps (Composio) is disabled in Settings -> Permissions." };
    }
  }
  return { allowed: true };
}

// ── Official Roadmap Phase 9: Self-Evaluation Data Contracts & Evaluator ────

export const ERR_EMPTY_OR_JUNK_PAYLOAD = "ERR_EMPTY_OR_JUNK_PAYLOAD";

export interface SelfEvaluationResult {
  actionId: string;
  technicalSuccess: boolean;
  semanticSuccess: boolean;
  usefulnessScore: number; // 0 to 10
  criticism: string;
  evidenceFound: string[];
  objectiveCompleted: boolean;
  recommendedAction: "finalize" | "retry_with_variation" | "switch_strategy" | "abort";
}

export interface ActionEvaluationContext {
  actionId?: string;
  action?: string;
  capabilityId?: string;
  operation?: string;
  params?: Record<string, unknown>;
  technicalSuccess: boolean;
  rawOutput?: unknown;
  resultSummary?: string;
  error?: string;
  objective?: string;
  successCriteria?: string[];
  expectedFormat?: "json" | "text" | "file" | "list" | "any";
  isConsequential?: boolean;
  accumulatedObservations?: Array<{
    turn: number;
    action: string;
    resultSummary: string;
    success: boolean;
  }>;
}

export function isConsequentialAction(
  capabilityId?: string,
  operation?: string,
  params: Record<string, unknown> = {}
): boolean {
  if (!capabilityId || !operation) return false;
  return DeviceSafetyPolicy.assessRisk(capabilityId, operation, params).consequential;
}

export function evaluateActionOutcome(context: ActionEvaluationContext): SelfEvaluationResult {
  const actionId = context.actionId || "eval_action";

  // 1. Technical failure at the execution boundary
  if (!context.technicalSuccess) {
    const err = context.error || context.resultSummary || "Action failed technically at the execution layer.";
    let rec: SelfEvaluationResult["recommendedAction"] = "retry_with_variation";
    if (/permission|denied|auth|unauthorized|forbidden/i.test(err)) {
      rec = "abort";
    } else if (/not found|unsupported|unknown capability|unregistered/i.test(err)) {
      rec = "switch_strategy";
    }
    return {
      actionId,
      technicalSuccess: false,
      semanticSuccess: false,
      usefulnessScore: 0,
      criticism: err,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: rec,
    };
  }

  // 2. Detect ERR_EMPTY_OR_JUNK_PAYLOAD: Tool succeeded technically, but returned empty, generic, or error-disguised content
  // A. Both rawOutput and resultSummary are empty / null / undefined / whitespace-only
  const hasRawOutput =
    context.rawOutput !== null &&
    context.rawOutput !== undefined &&
    !(typeof context.rawOutput === "string" && context.rawOutput.trim() === "");
  const hasResultSummary =
    typeof context.resultSummary === "string" && context.resultSummary.trim().length > 0;

  if (!hasRawOutput && !hasResultSummary) {
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 0,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Output payload is empty or whitespace-only.`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "retry_with_variation",
    };
  }

  // B. Empty (0-byte) file or artifact generated
  if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const obj = context.rawOutput as Record<string, unknown>;
    const isFileOp =
      context.capabilityId === "device.files" ||
      /write|create|file|download|pdf|doc|save|export/i.test(context.action || "") ||
      context.expectedFormat === "file" ||
      "path" in obj ||
      "file" in obj ||
      "filename" in obj;
    if (isFileOp) {
      if (
        obj.size === 0 ||
        obj.bytes === 0 ||
        obj.bytesWritten === 0 ||
        obj.length === 0 ||
        ("content" in obj && obj.content === "")
      ) {
        return {
          actionId,
          technicalSuccess: true,
          semanticSuccess: false,
          usefulnessScore: 0,
          criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Tool generated an empty (0-byte) file or artifact.`,
          evidenceFound: [],
          objectiveCompleted: false,
          recommendedAction: "retry_with_variation",
        };
      }
    }
  }

  // C. Search or listing queries returning zero results or empty arrays
  const allowsEmpty = Boolean(
    context.params?.allowEmpty === true ||
    (context.objective && /\b(?:verify|check|assert|confirm|ensure)\s+(?:no|zero|empty|none|clean|clear|absence)\b/i.test(context.objective)) ||
    (context.action && /\b(?:verify|check|assert|confirm|ensure)\s+(?:no|zero|empty|none|clean|clear|absence)\b/i.test(context.action))
  );

  if (Array.isArray(context.rawOutput) && context.rawOutput.length === 0) {
    if (allowsEmpty) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: true,
        usefulnessScore: 10,
        criticism: "Verified empty result as expected by objective.",
        evidenceFound: ["Confirmed 0 items / empty result set as requested"],
        objectiveCompleted: true,
        recommendedAction: "finalize",
      };
    }
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 1,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Search or query returned zero items/empty list.`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "retry_with_variation",
    };
  }

  if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const obj = context.rawOutput as Record<string, unknown>;
    const emptyArrayField = ["results", "items", "files", "matches", "data"].find(
      (key) => Array.isArray(obj[key]) && (obj[key] as unknown[]).length === 0
    );
    if (emptyArrayField && Object.keys(obj).length <= 2) {
      if (allowsEmpty) {
        return {
          actionId,
          technicalSuccess: true,
          semanticSuccess: true,
          usefulnessScore: 10,
          criticism: `Verified empty result array for ${emptyArrayField} as expected by objective.`,
          evidenceFound: [`Confirmed empty ${emptyArrayField}: [] as requested`],
          objectiveCompleted: true,
          recommendedAction: "finalize",
        };
      }
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 1,
        criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Query produced an empty results array (${emptyArrayField}: []).`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "retry_with_variation",
      };
    }
  }

  const textPayload =
    typeof context.rawOutput === "string"
      ? context.rawOutput
      : context.resultSummary || "";

  // Trap explicit error messages masquerading as non-empty text success
  const explicitErrorPattern = /^(?:error|fatal|exception|failure|command failed|fatal error):\s+/i;
  const isExplicitError =
    (typeof context.rawOutput === "string" && explicitErrorPattern.test(context.rawOutput.trim())) ||
    (typeof context.resultSummary === "string" && explicitErrorPattern.test(context.resultSummary.trim()));

  if (isExplicitError) {
    const errorMsg =
      typeof context.rawOutput === "string" && explicitErrorPattern.test(context.rawOutput.trim())
        ? context.rawOutput.trim().slice(0, 200)
        : (context.resultSummary || "Explicit error output").slice(0, 200);
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 0,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Tool returned error text despite technical success: ${errorMsg}`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "switch_strategy",
    };
  }

  const noResultsRegex =
    /(?:^|\b)(?:no|0|zero)\s+(?:results?|matches?|items?|files?|records?)\s*(?:found|returned)?\b/i;
  if (
    noResultsRegex.test(textPayload) ||
    /\bnothing\s+found\b/i.test(textPayload) ||
    /^not\s+found$/i.test(textPayload.trim())
  ) {
    if (allowsEmpty) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: true,
        usefulnessScore: 10,
        criticism: "Verified no-results confirmation as expected by absence/clean objective.",
        evidenceFound: ["Confirmed zero results matching condition"],
        objectiveCompleted: true,
        recommendedAction: "finalize",
      };
    }
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 1,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Search tool reported no results found.`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "retry_with_variation",
    };
  }

  // D. Disguised error payloads returned under technical success (HTTP 200)
  if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const obj = context.rawOutput as Record<string, unknown>;
    if (
      ("error" in obj && typeof obj.error === "string") ||
      ("error_code" in obj) ||
      ("status" in obj && (obj.status === "error" || obj.status === "failed")) ||
      ("success" in obj && obj.success === false)
    ) {
      const errMsg = String(obj.error || obj.message || obj.error_code || "Disguised error object");
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 0,
        criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Execution returned error payload disguised as successful response: ${errMsg}`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "switch_strategy",
      };
    }
  }

  // E. Uninformative placeholder tokens
  if (typeof context.rawOutput === "string") {
    const trimmed = context.rawOutput.trim();
    if (/^(?:todo|n\/a|undefined|null|\[object object\]|\{\})$/i.test(trimmed)) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 0,
        criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Output contains only placeholder or uninformative content ('${trimmed}').`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "retry_with_variation",
      };
    }
  }

  // F. Corrupted / broken JSON when JSON output was requested
  const expectsJson =
    context.expectedFormat === "json" ||
    /\bjson\b/i.test(context.objective || "") ||
    /\bjson\b/i.test(context.action || "");

  if (expectsJson && typeof context.rawOutput === "string") {
    try {
      JSON.parse(context.rawOutput);
    } catch (jsonErr: any) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 2,
        criticism: `Corrupted payload: Invalid JSON structure generated (${jsonErr.message}).`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "retry_with_variation",
      };
    }
  }

  // G. Consequential / destructive actions: anti-pattern prohibits skipping self-evaluation
  const isConsequential = Boolean(
    context.isConsequential ||
    isConsequentialAction(context.capabilityId, context.operation, context.params)
  );

  if (isConsequential) {
    const rawObj =
      typeof context.rawOutput === "object" && context.rawOutput !== null
        ? (context.rawOutput as Record<string, unknown>)
        : undefined;

    // Reject bare assertion of success without concrete mutation attributes
    const bareSuccessClaim =
      rawObj !== undefined &&
      Object.keys(rawObj).length <= 2 &&
      ("success" in rawObj || "ok" in rawObj) &&
      !(
        "deleted" in rawObj ||
        "written" in rawObj ||
        "bytesWritten" in rawObj ||
        "path" in rawObj ||
        "id" in rawObj ||
        "timestamp" in rawObj ||
        "verified" in rawObj
      );

    const mutationEvidenced =
      !bareSuccessClaim &&
      Boolean(
        context.resultSummary &&
        !/failed|error|skipped|no change/i.test(context.resultSummary) &&
        (
          (rawObj &&
            Object.keys(rawObj).length > 0 &&
            ("deleted" in rawObj ||
              "path" in rawObj ||
              "id" in rawObj ||
              "bytesWritten" in rawObj ||
              "size" in rawObj ||
              "verified" in rawObj)) ||
          (typeof context.rawOutput === "string" &&
            context.rawOutput.length > 5 &&
            !/^(?:ok|success|done)$/i.test(context.rawOutput.trim())) ||
          /\b(?:successfully deleted|wrote \d+ bytes|created (?:event|file|folder)|verified state change)\b/i.test(
            context.resultSummary
          )
        )
      );

    if (!mutationEvidenced) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 2,
        criticism:
          "Consequential operation did not produce verifiable state mutation confirmation; bare tool claim rejected.",
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "switch_strategy",
      };
    }
  }

  // 3. Valid payload: extract evidence and evaluate progress against success criteria
  const evidenceFound: string[] = [];

  if (typeof context.rawOutput === "string") {
    if (context.rawOutput.trim().length > 0) {
      evidenceFound.push(`Text output (${context.rawOutput.trim().length} chars)`);
    }
  } else if (Array.isArray(context.rawOutput)) {
    evidenceFound.push(`Array with ${context.rawOutput.length} items`);
    for (const item of context.rawOutput.slice(0, 3)) {
      if (typeof item === "string") evidenceFound.push(item);
      else if (typeof item === "object" && item !== null) {
        const recordDesc = Object.entries(item)
          .slice(0, 2)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        if (recordDesc) evidenceFound.push(recordDesc);
      }
    }
  } else if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const keys = Object.keys(context.rawOutput as object);
    if (keys.length > 0) {
      evidenceFound.push(`Object with fields: ${keys.join(", ")}`);
    }
  }

  if (context.resultSummary && context.resultSummary.length > 0) {
    evidenceFound.push(context.resultSummary.slice(0, 150));
  }

  const criteria = context.successCriteria || [];
  let satisfiedCriteriaCount = 0;

  if (criteria.length > 0) {
    const pastObservationsText = (context.accumulatedObservations || [])
      .map((o) => o.resultSummary)
      .join(" ");
    const combinedHaystack = `${pastObservationsText} ${textPayload} ${JSON.stringify(context.rawOutput || "")}`.toLowerCase();
    for (const crit of criteria) {
      const words = crit
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const matches = words.filter((w) => combinedHaystack.includes(w));
      if (words.length === 0 || matches.length >= Math.ceil(words.length * 0.5)) {
        satisfiedCriteriaCount++;
        evidenceFound.push(`Criterion verified: ${crit}`);
      }
    }
  }

  const allCriteriaSatisfied = criteria.length === 0 ? true : satisfiedCriteriaCount === criteria.length;
  const objectiveCompleted = allCriteriaSatisfied;

  let usefulnessScore: number;
  if (objectiveCompleted) {
    usefulnessScore = criteria.length > 0 ? 10 : 8;
  } else {
    usefulnessScore = Math.min(7, Math.max(3, Math.round((satisfiedCriteriaCount / criteria.length) * 10)));
  }

  const criticism = objectiveCompleted
    ? criteria.length > 0
      ? `All ${criteria.length} success criteria verified.`
      : "Action produced valid substantive output fulfilling the objective."
    : `Partial progress: ${satisfiedCriteriaCount}/${criteria.length} success criteria satisfied.`;

  return {
    actionId,
    technicalSuccess: true,
    semanticSuccess: true,
    usefulnessScore,
    criticism,
    evidenceFound,
    objectiveCompleted,
    recommendedAction: objectiveCompleted ? "finalize" : "retry_with_variation",
  };
}

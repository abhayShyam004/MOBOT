/**
 * Safety and Consent Model for Device Actions (Phase Q).
 *
 * Implements risk tiers and approval logic aligned with MOBOT principles:
 * - SAFE OPERATIONS SHOULD FEEL EASY (low risk read-only, clipboard, search, preview)
 * - MEANINGFUL CONSEQUENCES SHOULD BE VISIBLE (destructive deletes, external changes)
 * - Do not interrupt harmless operations with unnecessary permission dialogs.
 */

import type { RiskTier } from './types.ts';
import type { ApprovalMode } from '../../shared/approval-mode.ts';

export interface RiskAssessment {
  risk: RiskTier;
  reason: string;
  requiresPrompt: boolean;
  consequential: boolean;
}

export class DeviceSafetyPolicy {
  /**
   * Determine the risk tier of a specific device capability operation.
   */
  static assessRisk(
    capabilityId: string,
    operation: string,
    params: Record<string, unknown> = {}
  ): RiskAssessment {
    // 1. High Risk Operations (destructive, external messages, deletions)
    if (capabilityId === 'device.files' && operation === 'delete') {
      return {
        risk: 'high',
        reason: `Deleting file '${params.path ?? 'target'}' is irreversible.`,
        requiresPrompt: true,
        consequential: true,
      };
    }

    // 2. Medium Risk Operations (creating/modifying state, calendar events, external sharing)
    if (capabilityId === 'device.files' && operation === 'write') {
      return {
        risk: 'medium',
        reason: `Writing to file '${params.path ?? 'target'}'.`,
        requiresPrompt: false, // auto in edits/auto mode
        consequential: false,
      };
    }

    if (capabilityId === 'device.calendar' && operation === 'create_event') {
      return {
        risk: 'medium',
        reason: `Scheduling new calendar event '${params.title ?? 'Event'}'.`,
        requiresPrompt: false,
        consequential: false,
      };
    }

    if (capabilityId === 'device.share') {
      return {
        risk: 'medium',
        reason: 'Opening system share dialog.',
        requiresPrompt: false,
        consequential: false,
      };
    }

    if (capabilityId === 'device.camera') {
      return {
        risk: 'medium',
        reason: 'Accessing device camera.',
        requiresPrompt: false,
        consequential: false,
      };
    }

    // 3. Low Risk Operations (reading metadata, viewing screenshots, clipboard, apps, notifications)
    // Low risk operations execute seamlessly without prompting.
    return {
      risk: 'low',
      reason: 'Harmless read or non-consequential inspection.',
      requiresPrompt: false,
      consequential: false,
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
      // High risk actions always require prompt in ask, edits, and auto modes
      return true;
    }

    if (risk === 'medium') {
      // In 'ask' mode, medium actions prompt. In 'auto' or 'edits', safe medium actions pass.
      return approvalMode === 'ask';
    }

    // Low risk operations never interrupt the user
    return false;
  }
}

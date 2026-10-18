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

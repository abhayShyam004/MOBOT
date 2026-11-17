import type { Message } from "@/state/store";
import { t } from "./i18n";
import type { LocaleKey } from "@/locales";

// keys, not labels: t() reads the active pack when it is called, and this
// array is built once at import time
const FALLBACK_LABELS: Array<[RegExp, LocaleKey]> = [
  [/\b(?:bash|shell|terminal|exec|command|run_command)\b/i, "chat.activity.runCommand"],
  [/\b(?:web_fetch|fetch_url|read_page)\b/i, "chat.activity.readPage"],
  [/\b(?:read|read_file|view|open_file)\b/i, "chat.activity.readFile"],
  [/\b(?:write|write_file|create_file)\b/i, "chat.activity.writeFile"],
  [/\b(?:edit|apply_patch|replace|str_replace)\b/i, "chat.activity.editFile"],
  [/\b(?:web_search|search_web)\b/i, "chat.activity.searchWeb"],
  [/\b(?:grep|glob|find|search)\b/i, "chat.activity.searching"],
  [/\b(?:screenshot|screen_capture)\b/i, "chat.activity.screen"],
  [/\b(?:click|type|keypress|press|scroll|computer)\b/i, "chat.activity.computer"],
  [/\b(?:open_url|navigate)\b/i, "chat.activity.openPage"],
  [/\b(?:list_bots|list_agents)\b/i, "chat.activity.whosAround"],
  [/\blist_rooms\b/i, "chat.activity.rooms"],
  [/\bpost_to_room\b/i, "chat.activity.postRoom"],
  [/\bdelegate_bot\b/i, "chat.activity.handoff"],
  [/\b(?:ask_bot|send_message)\b/i, "chat.activity.askTeammate"],
];

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/[.\s]+$/, "");
  if (!trimmed) return t("chat.activity.thinking");
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

/**
 * The one quiet line shown while an agent is working. This follows t3code's
 * live-activity model: thinking before a tool starts, then the current verb.
 * The server-provided narration is authoritative; fallbacks cover older
 * messages and third-party drivers that only report a tool name.
 */
export function liveActivityLabel(message?: Message): string {
  if (
    message?.kind !== "activity" ||
    !message.tool ||
    message.tool.ok !== undefined ||
    message.comm
  ) {
    return t("chat.activity.thinking");
  }

  if (message.tool.label?.trim()) return sentenceCase(message.tool.label);
  if (message.tool.spoken?.trim()) return sentenceCase(message.tool.spoken);

  const toolName = message.tool.name.replace(/^mcp__[^_]+__/, "").split(":", 1)[0] ?? "";
  for (const [pattern, key] of FALLBACK_LABELS) {
    if (pattern.test(toolName)) return t(key);
  }
  return t("chat.activity.working");
}

/**
 * Human-friendly fallback when both label and spoken narration are missing.
 * Strips raw internal identifiers (such as mcp prefixes or driver names)
 * and returns a friendly verb phrase or a neutral action label.
 */
export function humanizeToolFallback(toolName: string): string {
  const cleanName = toolName
    .replace(/^mcp__[A-Za-z0-9_-]+__/, "")
    .replace(/^mcp__/, "")
    .replace(/^android_computer_/, "")
    .replace(/^android_browser_/, "")
    .replace(/^phone_/, "")
    .split(":", 1)[0] ?? "";
  const normalized = cleanName.replace(/_/g, " ");
  for (const [pattern, key] of FALLBACK_LABELS) {
    if (pattern.test(cleanName) || pattern.test(normalized)) return t(key);
  }
  return t("toolDetail.workingOnStep");
}

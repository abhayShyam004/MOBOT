/**
 * Which integration tools a turn should advertise.
 *
 * A bot can have a browser, a phone, a filesystem and connected apps — but a
 * question ("what is the difference between HTTP and HTTPS?") needs none of
 * them, and every schema it does not need is context the model pays for on
 * every round of every turn.
 *
 * Two rules keep this safe:
 *
 * 1. Narrowing only happens when the capability registry already classified
 *    the request as a non-text task, or as a text-only one. An unclassified or
 *    ambiguous request advertises everything.
 * 2. Narrowing is reversible inside the turn: `mountChatTools` still mounts and
 *    verifies every configured server, and the model can load a deferred
 *    server's tools with `capability_enable`. Nothing is ever advertised that
 *    was not verified ready.
 *
 * This is deliberately not a keyword filter: a text-only request mentioning
 * "browser" or "terminal" is still text-only, because the modality decides and
 * the word lists only ever widen.
 */
import type { SendTurnInput } from "./contracts.ts";
import type { ExecutionModality } from "./capabilities/types.ts";

export type ToolExposureMode = "all" | "selected";

export type TaskStage =
  | "planning"
  | "exploration"
  | "implementation"
  | "verification"
  | "deployment"
  | "validation";

export const STAGE_SURFACES: Record<TaskStage, string[]> = {
  planning: [],
  exploration: ["android_computer", "project_tools", "computer"],
  implementation: ["android_computer", "project_tools", "computer"],
  verification: ["browser", "android_browser", "android_computer", "project_tools", "computer"],
  deployment: ["composio", "agents", "android_computer", "project_tools", "computer"],
  validation: ["browser", "android_browser", "android_computer", "project_tools", "computer"],
};

export interface ToolExposureDecision {
  mode: ToolExposureMode;
  /** Integration names to advertise now (only meaningful in `selected`). */
  servers: string[];
  /** Mounted and verified, but left out of the first request. */
  deferred: string[];
  reason: string;
}

/** Modalities that are answered in prose. */
const TEXT_ONLY = new Set<string>(["direct_answer", "user_clarification"]);

/** The integration surfaces each modality can plausibly need. */
const BY_MODALITY: Record<string, string[]> = {
  web_search: ["browser", "android_browser", "android_computer"],
  browser_session: ["browser", "android_browser", "android_computer"],
  terminal_command: ["android_computer", "project_tools", "computer"],
  filesystem_mutation: ["android_computer", "project_tools", "computer"],
  device_gesture: ["phone"],
  composio_service: ["composio", "agents"],
  specialist_handoff: ["agents"],
};

/** The platform surfaces this module reasons about. A server it does not
 * recognize — the person's own MCP server — is always advertised: deferring
 * something whose purpose the harness cannot classify would hide a capability
 * the person configured on purpose. */
export const KNOWN_SURFACES = new Set([
  "agents", "composio", "browser", "android_browser", "android_computer",
  "phone", "project_tools", "computer", "dweb",
]);

/** Words that name a capability the request itself asks for. They only ever
 * ADD a server to the resolved set; they never remove one. */
const EXPLICIT_SIGNALS: Array<[RegExp, string[]]> = [
  [/\b(?:browser|webpage|web page|website|navigate|click|fill (?:in|out)|form|url)\b/i, ["browser", "android_browser"]],
  [/\b(?:terminal|shell|bash|command|command line|npm|pnpm|npx|node|python|pip|git|repository|repo|script)\b/i, ["android_computer", "project_tools"]],
  [/\b(?:file|files|folder|directory|workspace|path|readme|pdf|notebook|ipynb)\b/i, ["android_computer", "project_tools"]],
  [/\b(?:phone|device|screenshot|tap|swipe|unlock|android app|open app|open|launch|whatsapp)\b/i, ["phone"]],
  [/\b(?:email|gmail|calendar|slack|github issue|notion|linear|jira|google drive|drive|spreadsheet|colab|google colab)\b/i, ["composio"]],
  [/\b(?:teammate|another bot|delegate|room|coordinate)\b/i, ["agents"]],
];

/** A request that is doing real multi-step work keeps the full catalog: the
 * plan is not knowable from the first sentence, and a long build must not be
 * narrowed on the strength of one verb. */
const AMBITIOUS_TASK =
  /\b(?:build|implement|create|scaffold|refactor|debug|fix|deploy|test|verify|benchmark|migrate|optimi[sz]e|research|analy[sz]e|investigate|automat\w*|project|application|app)\b/i;
const LONG_OBJECTIVE_CHARS = 240;

/** Every integration `mountChatTools` will mount, in configuration order. */
export function integrationServerNames(integrations: SendTurnInput["integrations"]): string[] {
  const names: string[] = [];
  if (integrations?.agents) names.push("agents");
  if (integrations?.composio) names.push("composio");
  if (integrations?.phone) names.push("phone");
  for (const name of Object.keys(integrations?.custom ?? {})) names.push(name);
  return names;
}

export function decideToolExposure(input: {
  text: string;
  modality?: ExecutionModality | string;
  available: readonly string[];
  policy?: "all_on_ambitious" | "staged";
  stage?: TaskStage;
}): ToolExposureDecision {
  const available = [...new Set(input.available)].filter(Boolean);
  const text = input.text ?? "";
  if (!available.length) {
    return { mode: "all", servers: [], deferred: [], reason: "no integrations are configured" };
  }
  const modality = input.modality;
  const stage = input.stage;

  // When task stage is explicitly provided, capability selection responds directly to stage requirements
  if (stage && STAGE_SURFACES[stage] !== undefined) {
    const stageSurfaces = STAGE_SURFACES[stage];
    const wants = new Set(stageSurfaces);
    for (const server of available) {
      if (!KNOWN_SURFACES.has(server)) wants.add(server); // Custom MCP servers are never withheld
    }
    for (const [pattern, servers] of EXPLICIT_SIGNALS) {
      if (pattern.test(text)) for (const server of servers) wants.add(server);
    }
    const servers = available.filter((server) => wants.has(server));
    const deferred = available.filter((server) => !wants.has(server));
    return {
      mode: "selected",
      servers,
      deferred,
      reason: `stage "${stage}" selects ${servers.join(", ") || "no integration"} (deferred: ${deferred.join(", ") || "none"})`,
    };
  }

  // An engine or caller that did not classify the request gets the whole
  // catalog: guessing "this looks textual" is exactly what previously routed
  // real tasks away from the tools they needed.
  if (!modality) {
    return { mode: "all", servers: available, deferred: [], reason: "request was not classified" };
  }
  if (TEXT_ONLY.has(modality)) {
    return {
      mode: "selected", servers: [], deferred: available,
      reason: `classified as ${modality}: prose answer, no integration tools`,
    };
  }
  const base = BY_MODALITY[modality];
  if (!base) {
    return { mode: "all", servers: available, deferred: [], reason: `no exposure profile for ${modality}` };
  }
  const wants = new Set(base);
  for (const server of available) {
    if (!KNOWN_SURFACES.has(server)) wants.add(server);
  }
  for (const [pattern, servers] of EXPLICIT_SIGNALS) {
    if (pattern.test(text)) for (const server of servers) wants.add(server);
  }
  const ambitious = text.trim().length > LONG_OBJECTIVE_CHARS || AMBITIOUS_TASK.test(text);
  const policy = input.policy ?? "all_on_ambitious";
  if (ambitious && policy === "all_on_ambitious") {
    return {
      mode: "all", servers: available, deferred: [],
      reason: `${modality} with a multi-step objective keeps every configured capability`,
    };
  }
  const servers = available.filter((server) => wants.has(server));
  const deferred = available.filter((server) => !wants.has(server));
  if (!servers.length) {
    // A narrow modality whose profile matched nothing configured (for example
    // `device_gesture` on a host with no phone tools) still gets the full
    // catalog: an empty tool list here would be narrower than the task.
    return { mode: "all", servers: available, deferred: [], reason: `${modality} matched no configured surface` };
  }
  return {
    mode: "selected", servers, deferred,
    reason: `${modality} needs ${servers.join(", ") || "no integration"}${ambitious ? " (staged exposure: deferred capabilities loadable via capability_enable)" : ""}`,
  };
}

// A project API key (ak_…) creates/reuses one Composio Session. That
// Session owns connection state, auth links and the MCP endpoint.
import { saveConfig, type AppConfig } from "./config.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";
import { managedConnectorUnavailableReason } from "../shared/connector-availability.ts";
import { COMPOSIO_CATALOG } from "./composio-catalog.js";

const DEFAULT_BACKEND_ORIGIN = "https://backend.composio.dev";
const DEFAULT_CONNECT_MCP_ENDPOINT = "https://connect.composio.dev/mcp";

export type ComposioSurface = "platform" | "connect";

function apiBase() {
  return (process.env.OMB_COMPOSIO_API ?? `${DEFAULT_BACKEND_ORIGIN}/api/v3.1`).replace(/\/$/, "");
}

function toolkitBase() {
  return (process.env.OMB_COMPOSIO_TOOLKITS_API ?? `${DEFAULT_BACKEND_ORIGIN}/api/v3.1`).replace(/\/$/, "");
}

export function connectMcpEndpoint(cfg?: AppConfig): string {
  return cfg?.composio?.mcpUrl ?? process.env.OMB_COMPOSIO_CONNECT_MCP ?? DEFAULT_CONNECT_MCP_ENDPOINT;
}

export function detectComposioKeyType(key: string): ComposioSurface | "unknown" {
  const trimmed = key.trim();
  if (trimmed.startsWith("ak_")) return "platform";
  if (trimmed.startsWith("ck_")) return "connect";
  return "unknown";
}

export function composioSurface(cfg: AppConfig): ComposioSurface {
  if (cfg.composio?.surface) return cfg.composio.surface;
  const key = projectApiKey(cfg);
  if (key?.startsWith("ck_")) return "connect";
  return "platform";
}

export function validatePlatformKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Enter a Composio project API key");
  if (trimmed.startsWith("ck_")) {
    throw new Error(
      "This Composio connection expects a Platform Project API key (ak_...). You provided a Connect consumer key (ck_...). Choose the appropriate Composio connection type.",
    );
  }
  if (!trimmed.startsWith("ak_")) {
    throw new Error("Invalid Composio key format. Platform Project API keys must start with ak_.");
  }
  return trimmed;
}

export function validateConnectKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Enter a Composio Connect consumer key");
  if (trimmed.startsWith("ak_")) {
    throw new Error(
      "This Composio connection expects a Connect consumer key (ck_...). You provided a Platform Project API key (ak_...). Choose the appropriate Composio connection type.",
    );
  }
  if (!trimmed.startsWith("ck_")) {
    throw new Error("Invalid Composio key format. Connect consumer keys must start with ck_.");
  }
  return trimmed;
}

export async function verifyConnectConsumerKey(
  consumerKey: string,
  endpoint?: string,
): Promise<{ ok: boolean }> {
  const validKey = validateConnectKey(consumerKey);
  const mcpUrl = endpoint ?? connectMcpEndpoint();
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-consumer-api-key": validKey,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("Composio rejected this consumer key (invalid or unauthorized)");
  }
  if (!res.ok) {
    throw new Error(await responseError(res, `Composio Connect error: HTTP ${res.status}`));
  }
  return { ok: true };
}

const sessionResponseSchema = z.object({
  session_id: z.string().min(1),
  mcp: z.object({ type: z.enum(["http", "sse"]), url: z.string().min(1) }),
  config: z.object({
    user_id: z.string().optional(),
    multi_account: z.object({
      enable: z.boolean().optional(),
      max_accounts_per_toolkit: z.number().optional(),
      require_explicit_selection: z.boolean().optional(),
    }).optional(),
    /** toolkit slug → the project's own auth config the Session uses for it */
    auth_configs: z.record(z.string(), z.string()).optional(),
  }).optional(),
});
type SessionResponse = z.infer<typeof sessionResponseSchema>;

// A project's own auth configs (bring-your-own OAuth app, API-key toolkits
// such as twitter that Composio does not manage). A Session only uses one
// when it was created with the config's id under `auth_configs`.
const authConfigItemSchema = z.object({
  id: z.string().optional(),
  status: z.string().nullable().optional(),
  is_composio_managed: z.boolean().optional(),
  is_enabled_for_tool_router: z.boolean().nullable().optional(),
  last_updated_at: z.string().nullable().optional(),
  toolkit: z.object({ slug: z.string().optional() }).optional(),
});
const authConfigsPageSchema = z.object({
  items: z.array(authConfigItemSchema).optional(),
  next_cursor: z.string().nullable().optional(),
});
/** toolkit slug (lowercase) → auth config id */
type AuthConfigMap = Record<string, string>;
const MAX_AUTH_CONFIG_PAGES = 20;

export interface ConnectedAccountSummary {
  id: string;
  alias?: string;
  status: string;
}

export interface ConnectorServiceState {
  connected: boolean;
  pending: boolean;
  status: string;
  accounts: ConnectedAccountSummary[];
}

interface AccountLinkRequest {
  toolkit: string;
  alias?: string;
}

const connectedAccountResponseSchema = z.object({
  id: z.string().optional(),
  alias: z.string().nullable().optional(),
  status: z.string().optional(),
  updated_at: z.string().optional(),
  toolkit: z.object({ slug: z.string().optional() }).optional(),
});
type ConnectedAccountResponse = z.infer<typeof connectedAccountResponseSchema>;

const connectedAccountsPageSchema = z.object({
  items: z.array(connectedAccountResponseSchema),
  next_cursor: z.string().nullable().optional(),
});

const toolkitItemSchema = z.object({
  slug: z.string().optional(),
  is_no_auth: z.boolean().optional(),
  connected_account: z.object({ id: z.string().optional(), status: z.string().optional() }).nullable().optional(),
});
type ToolkitItem = z.infer<typeof toolkitItemSchema>;
const toolkitPageSchema = z.object({
  items: z.array(toolkitItemSchema).optional(),
  next_cursor: z.string().nullable().optional(),
});

const connectorServiceSchema = z.object({
  connected: z.boolean(),
  pending: z.boolean().optional(),
  status: z.string().optional(),
  accounts: z.array(z.object({ id: z.string(), alias: z.string().optional(), status: z.string() })).optional(),
});
const connectorServicesResponseSchema = z.object({ services: z.record(z.string(), connectorServiceSchema).optional() });
const removalResponseSchema = z.object({ removed: z.number() });
const authUrlResponseSchema = z.object({ url: z.string().optional() });
const linkResponseSchema = z.object({ redirect_url: z.string().optional() });

const MULTI_ACCOUNT_CONFIG = {
  enable: true,
  max_accounts_per_toolkit: 5,
  require_explicit_selection: true,
} as const;

interface SessionCreateRequest {
  user_id: string;
  manage_connections: { enable: boolean; enable_wait_for_connections: boolean; enable_connection_removal: boolean };
  multi_account: typeof MULTI_ACCOUNT_CONFIG;
  /** toolkit slug → the project's own auth config id; named only when the
   * project has its own configs, since a Session cannot be edited afterwards
   * and an empty map would pin "no custom auth" for the Session's lifetime */
  auth_configs?: AuthConfigMap;
}
const MAX_CONNECTED_ACCOUNT_PAGES = 100;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const printableAliasSchema = z.string().min(1).max(64).refine((value) => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 32 || codePoint === 127) return false;
  }
  return true;
});

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ComposioMcpIntegration {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface IntegrationContext {
  harnessUrl: string;
  commsToken: string;
  botId: string;
  threadId: string;
}

let managedBrokerAccess: { url: string; token: string } | null | undefined;

const managedBrokerMessageSchema = z.record(z.string(), z.unknown());
const managedBrokerToken = /^[0-9a-f]{64}$/;

function normalizeManagedBrokerUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The connected-apps service URL must not include credentials, a query, or a fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The connected-apps service must use HTTPS");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function applyManagedBrokerMessage(message: unknown): boolean {
  const parsed = managedBrokerMessageSchema.safeParse(message);
  if (
    !parsed.success ||
    parsed.data.type !== "openmausbot:managed-composio" ||
    !Object.hasOwn(parsed.data, "access")
  ) {
    return false;
  }
  setManagedBrokerAccess(parsed.data.access);
  return true;
}

export function setManagedBrokerAccess(access: unknown): void {
  if (access === null) {
    managedBrokerAccess = null;
    return;
  }
  const parsed = z.object({ url: z.string().url(), token: z.string().regex(managedBrokerToken) }).strict().parse(access);
  managedBrokerAccess = { url: normalizeManagedBrokerUrl(parsed.url), token: parsed.token };
}

function brokerAccess(): { url: string; token: string } | null {
  if (managedBrokerAccess !== undefined) return managedBrokerAccess;
  const url = process.env.OMB_COMPOSIO_BROKER_URL?.trim();
  const token = process.env.OMB_COMPOSIO_BROKER_TOKEN?.trim();
  if (!url || !token) return null;
  if (!managedBrokerToken.test(token)) throw new Error("The connected-apps service token is invalid");
  return { url: normalizeManagedBrokerUrl(url), token };
}

/** A user-owned project is an explicit choice and must win over the packaged
 * app's managed broker. An empty key means that choice was cleared, so the
 * managed service may take over again without a restart. */
function projectApiKey(cfg: AppConfig): string | null {
  const apiKey = cfg.composio?.apiKey?.trim();
  return apiKey || null;
}

/** Composio's toolkit slug is `twitter`. Keep accepting the old `x` alias at
 * every local boundary so saved connector cards and model calls keep working. */
function canonicalToolkitSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  return normalized === "x" ? "twitter" : normalized;
}

/** Keep credential-backed caches and transport sessions separated without
 * retaining another plaintext copy of the credential as their identity. */
function backendFingerprint(kind: string, endpoint: string, credential: string): string {
  return createHash("sha256")
    .update(kind)
    .update("\0")
    .update(endpoint)
    .update("\0")
    .update(credential)
    .digest("hex");
}

const MAX_TRACKED_TRANSPORT_SESSIONS = 512;
const transportSessionBackends = new Map<string, string>();

function rememberTransportSession(sessionId: string, identity: string): void {
  transportSessionBackends.delete(sessionId);
  transportSessionBackends.set(sessionId, identity);
  while (transportSessionBackends.size > MAX_TRACKED_TRANSPORT_SESSIONS) {
    const oldest = transportSessionBackends.keys().next().value;
    if (oldest === undefined) break;
    transportSessionBackends.delete(oldest);
  }
}

function canonicalServiceRecord<T>(services: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(services).map(([slug, state]) => [canonicalToolkitSlug(slug), state]),
  );
}

/** Preserve the caller's key (`x` included) while speaking canonical toolkit
 * slugs upstream. Old connector cards index status with their saved slug. */
function requestedServiceRecord<T>(services: Record<string, T>, requested: string[]): Record<string, T> {
  const canonical = canonicalServiceRecord(services);
  return Object.fromEntries(
    requested.flatMap((slug) => {
      const state = canonical[canonicalToolkitSlug(slug)];
      return state === undefined ? [] : [[slug, state]];
    }),
  );
}

export function connectionMode(cfg: AppConfig): "managed" | "self-hosted" | "unavailable" {
  if (projectApiKey(cfg)) return "self-hosted";
  if (brokerAccess()) return "managed";
  return "unavailable";
}

export function configured(cfg: AppConfig): boolean {
  return connectionMode(cfg) !== "unavailable";
}

/** Three answers, not two. The desktop shell sets OMB_CREDENTIAL_STORE to
 * "unavailable" when it could not read credentials.bin this launch; without
 * that signal an unreadable store is indistinguishable from a user who never
 * connected anything, and the UI wipes a list it should have kept. */
export type ConnectorAvailability = "configured" | "unconfigured" | "unreadable";

export function connectorAvailability(
  cfg: AppConfig,
  storeState: string | undefined = process.env.OMB_CREDENTIAL_STORE,
): ConnectorAvailability {
  if (configured(cfg)) return "configured";
  return storeState === "unavailable" ? "unreadable" : "unconfigured";
}

async function brokerRequest(path: string, init?: RequestInit): Promise<Response> {
  const broker = brokerAccess();
  if (!broker) throw new Error("The connected-apps service is unavailable");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${broker.token}`);
  if (init?.body) headers.set("content-type", "application/json");
  return fetch(`${broker.url}${path}`, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
}

function projectHeaders(apiKey: string, json = false) {
  const headers = new Headers({ "x-api-key": apiKey });
  if (json) headers.set("content-type", "application/json");
  return headers;
}

async function responseError(res: Response, fallback: string) {
  const raw = await res.text().catch(() => "");
  try {
    const body = JSON.parse(raw);
    return String(body?.message ?? body?.error?.message ?? body?.error ?? fallback);
  } catch {
    return raw.trim().slice(0, 300) || fallback;
  }
}

async function throwBrokerError(res: Response, fallback: string): Promise<never> {
  const status = res.status >= 400 && res.status < 500 ? res.status : 502;
  throw Object.assign(new Error(await responseError(res, fallback)), { status });
}

function trustedAuthUrl(value: string | undefined, slug: string): string {
  if (!value) throw new Error(`Connected-apps service returned no authorization link for ${slug}`);
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.hostname !== "composio.dev" && !url.hostname.endsWith(".composio.dev"))) {
    throw new Error("Connected-apps service returned an untrusted authorization link");
  }
  return url.toString();
}

function parseSessionResponse(session: SessionResponse): SessionResponse {
  const mcp = new URL(session.mcp.url);
  if (mcp.protocol !== "https:" || (mcp.hostname !== "composio.dev" && !mcp.hostname.endsWith(".composio.dev"))) {
    throw new Error("Composio returned an untrusted Session MCP URL");
  }
  return { ...session, mcp: { ...session.mcp, url: mcp.toString() } };
}

function supportsMultiAccount(session: SessionResponse): boolean {
  // Only `enable` gates reuse. The cap and selection flags are what we ASK
  // for at creation; if Composio clamps or omits them in the echo, recreating
  // the Session would post the same config and get the same echo back — a
  // strict equality check here can only manufacture a recreate-per-request
  // loop, never fix anything.
  return session.config?.multi_account?.enable === true;
}

/** Session ids this boot already tried to upgrade once. If the fresh Session
 *  STILL doesn't echo multi-account, Composio isn't granting it — run with
 *  what we have (single-account behavior) instead of recreating a Session and
 *  rewriting config.json on every request. */
const multiAccountUpgradeAttempted = new Set<string>();
/** Session id + auth-config map pairs this boot already created a Session
 *  for. Same idea: if Composio does not echo `auth_configs`, recreating the
 *  Session on every check would loop without changing anything. */
const authConfigUpgradeAttempted = new Set<string>();

function inputError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function normalizeAccountAlias(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = z.string().safeParse(value);
  if (!parsed.success) throw inputError("Account alias must be text");
  const alias = parsed.data.trim();
  if (!printableAliasSchema.safeParse(alias).success) {
    throw inputError("Account alias must be 1-64 printable characters");
  }
  return alias;
}

function validAccountId(value: string | undefined): value is string {
  return Boolean(value && ACCOUNT_ID.test(value));
}

async function getProjectSession(apiKey: string, sessionId: string): Promise<SessionResponse | null> {
  const res = await fetch(`${apiBase()}/tool_router/session/${encodeURIComponent(sessionId)}`, {
    headers: projectHeaders(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await responseError(res, `Composio session: HTTP ${res.status}`));
  return parseSessionResponse(sessionResponseSchema.parse(await res.json()));
}

/** The project's own (non-Composio-managed) auth configs, one per toolkit.
 *  Disabled configs and ones switched off for Sessions are skipped; when a
 *  toolkit has several, the most recently updated wins. Ordinary Session
 *  preparation treats a denied list as "none"; an explicit auth retry surfaces
 *  the denial so it cannot replace a usable Session with an incomplete one. */
export async function listCustomAuthConfigs(apiKey: string): Promise<AuthConfigMap> {
  const chosen = new Map<string, { id: string; updated: string }>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_AUTH_CONFIG_PAGES; page++) {
    const params = new URLSearchParams({ is_composio_managed: "false", limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${apiBase()}/auth_configs?${params}`, {
      headers: projectHeaders(apiKey),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(await responseError(res, `Composio auth configs: HTTP ${res.status}`));
    const body = authConfigsPageSchema.parse(await res.json());
    for (const item of body.items ?? []) {
      const slug = item.toolkit?.slug ? canonicalToolkitSlug(item.toolkit.slug) : "";
      if (!slug || !item.id || item.is_composio_managed === true) continue;
      if (item.is_enabled_for_tool_router === false) continue;
      if (item.status && /^(disabled|inactive|expired|deleted)$/i.test(item.status)) continue;
      const updated = item.last_updated_at ?? "";
      const current = chosen.get(slug);
      if (!current || updated > current.updated) chosen.set(slug, { id: item.id, updated });
    }
    const next = body.next_cursor ?? undefined;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return Object.fromEntries([...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([slug, { id }]) => [slug, id]));
}

/** True when the Session already routes every wanted toolkit through the
 *  project's own auth config. Extra configs on the Session are fine; a
 *  missing or different one means the Session predates the config. */
function sessionCoversAuthConfigs(session: SessionResponse, wanted: AuthConfigMap): boolean {
  const have = session.config?.auth_configs ?? {};
  const haveLower = Object.fromEntries(Object.entries(have).map(([slug, id]) => [canonicalToolkitSlug(slug), id]));
  return Object.entries(wanted).every(([slug, id]) => haveLower[slug] === id);
}

function authConfigsKey(sessionId: string, wanted: AuthConfigMap): string {
  return `${sessionId}:${JSON.stringify(wanted)}`;
}

/** Validate a project key and return one reusable Session for this install.
 *
 *  Identity model (multi-device compatibility — do not casually change):
 *  each install mints its own Composio user (`openmausbot_<uuid>`) and
 *  connections belong to that Composio user, NOT to the project key. A
 *  second device sharing the same project key therefore starts with zero
 *  connections until it adopts the first device's user via
 *  `PUT /api/config {"composio":{"userId":"openmausbot_…","sessionId":""}}`
 *  — clearing sessionId forces a Session rebuild under the adopted user and
 *  every existing connection becomes visible. Replacing the random-user
 *  minting here with, say, a shared constant would silently change which
 *  accounts every existing install sees. */
export async function prepareProjectSession(
  apiKey: string,
  current?: { apiKey?: string; userId?: string; sessionId?: string },
  knownAuthConfigs?: AuthConfigMap,
): Promise<{ apiKey: string; userId: string; sessionId: string }> {
  const trimmed = validatePlatformKey(apiKey);

  // The project's own auth configs must be named at creation — a Session
  // cannot be edited later — so they are read before deciding whether the
  // current Session is still the right one (issue #509: a twitter auth
  // config created after the Session existed was never used).
  const authConfigs = knownAuthConfigs
    ?? await listCustomAuthConfigs(trimmed).catch((): AuthConfigMap => ({}));
  let priorUserId = current?.userId;
  if (trimmed === current?.apiKey && current.sessionId) {
    const existing = await getProjectSession(trimmed, current.sessionId);
    if (
      existing
      && supportsMultiAccount(existing)
      && (sessionCoversAuthConfigs(existing, authConfigs)
        || authConfigUpgradeAttempted.has(authConfigsKey(existing.session_id, authConfigs)))
    ) {
      return {
        apiKey: trimmed,
        userId: existing.config?.user_id ?? current.userId ?? `openmausbot_${randomUUID()}`,
        sessionId: existing.session_id,
      };
    }
    // Connections belong to the Composio user, not the Session. Recreate old
    // single-account Sessions with the same user ID so every existing grant is
    // retained while the new Session opts into explicit multi-account routing.
    priorUserId = existing?.config?.user_id ?? priorUserId;
  }

  const userId = priorUserId ?? `openmausbot_${randomUUID()}`;
  const sessionRequest: SessionCreateRequest = {
    user_id: userId,
    manage_connections: {
      enable: true,
      enable_wait_for_connections: true,
      enable_connection_removal: true,
    },
    multi_account: MULTI_ACCOUNT_CONFIG,
  };
  if (Object.keys(authConfigs).length) sessionRequest.auth_configs = authConfigs;
  const res = await fetch(`${apiBase()}/tool_router/session`, {
    method: "POST",
    headers: projectHeaders(trimmed, true),
    body: JSON.stringify(sessionRequest),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await responseError(res, `Composio rejected this key (HTTP ${res.status})`));
  const session = parseSessionResponse(sessionResponseSchema.parse(await res.json()));
  // If Composio does not echo the configs back, a later check would ask for
  // the same creation again — remember this attempt so it happens once.
  authConfigUpgradeAttempted.add(authConfigsKey(session.session_id, authConfigs));
  return { apiKey: trimmed, userId, sessionId: session.session_id };
}

export interface PreparedComposioCredential {
  apiKey: string;
  surface: ComposioSurface;
  userId?: string;
  sessionId?: string;
  mcpUrl?: string;
}

export async function prepareComposioCredential(
  apiKey: string,
  options?: {
    requestedSurface?: ComposioSurface;
    current?: { apiKey?: string; userId?: string; sessionId?: string; surface?: ComposioSurface };
    knownAuthConfigs?: AuthConfigMap;
    endpoint?: string;
  },
): Promise<PreparedComposioCredential> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("Enter a Composio key");

  const surface =
    options?.requestedSurface ??
    (trimmed.startsWith("ck_") ? "connect" : trimmed.startsWith("ak_") ? "platform" : undefined);

  if (!surface) {
    throw new Error(
      "Invalid Composio key format. Keys must start with ak_ (Platform Project API key) or ck_ (Connect / For You consumer key).",
    );
  }

  if (surface === "platform") {
    const validKey = validatePlatformKey(trimmed);
    const session = await prepareProjectSession(validKey, options?.current, options?.knownAuthConfigs);
    return {
      apiKey: session.apiKey,
      surface: "platform",
      userId: session.userId,
      sessionId: session.sessionId,
    };
  }

  if (surface === "connect") {
    const validKey = validateConnectKey(trimmed);
    await verifyConnectConsumerKey(validKey, options?.endpoint);
    return {
      apiKey: validKey,
      surface: "connect",
      mcpUrl: options?.endpoint ?? connectMcpEndpoint(),
    };
  }

  throw new Error(`Unknown Composio surface: ${surface}`);
}

async function ensureProjectSession(cfg: AppConfig): Promise<SessionResponse> {
  const composio = cfg.composio;
  const apiKey = projectApiKey(cfg);
  if (!composio || !apiKey) throw new Error("No Composio project key configured");
  if (composio.sessionId) {
    const existing = await getProjectSession(apiKey, composio.sessionId);
    if (existing && (supportsMultiAccount(existing) || multiAccountUpgradeAttempted.has(existing.session_id))) {
      return existing;
    }
  }
  // A missing/deleted session is recreated and its non-secret identifiers are
  // persisted so an edited config/env setup does not recreate it every launch.
  const prepared = await prepareProjectSession(apiKey, composio);
  multiAccountUpgradeAttempted.add(prepared.sessionId);
  composio.userId = prepared.userId;
  composio.sessionId = prepared.sessionId;
  saveConfig({ composio: { userId: prepared.userId, sessionId: prepared.sessionId } });
  const created = await getProjectSession(apiKey, prepared.sessionId);
  if (!created) throw new Error("Composio Session disappeared after creation");
  return created;
}

/** Replace the current Session with a freshly created one — the only way to
 *  pick up an auth config the user added after the Session was made. The
 *  Composio user id is kept, so every existing connection survives. */
async function recreateProjectSession(
  cfg: AppConfig,
  userId: string,
  authConfigs: AuthConfigMap,
): Promise<SessionResponse> {
  const composio = cfg.composio;
  const apiKey = projectApiKey(cfg);
  if (!composio || !apiKey) throw new Error("No Composio project key configured");
  const prepared = await prepareProjectSession(
    apiKey,
    { apiKey, userId },
    authConfigs,
  );
  multiAccountUpgradeAttempted.add(prepared.sessionId);
  composio.userId = prepared.userId;
  composio.sessionId = prepared.sessionId;
  saveConfig({ composio: { userId: prepared.userId, sessionId: prepared.sessionId } });
  const created = await getProjectSession(apiKey, prepared.sessionId);
  if (!created) throw new Error("Composio Session disappeared after creation");
  return created;
}

/** Composio's wording when a toolkit has no managed auth and the Session was
 *  not told which of the project's own auth configs to use. */
const NEEDS_AUTH_CONFIG = /does not manage auth|auth[_ ]?config/i;

export async function mcpIntegration(
  cfg: AppConfig,
  context: IntegrationContext,
): Promise<ComposioMcpIntegration | null> {
  if (!configured(cfg)) return null;
  return {
    command: process.execPath,
    args: [SPAWNED_PROXIES.connectors],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      // The provider-facing bridge receives only this boot's loopback token.
      // Project/broker credentials stay in the harness process, so a coding
      // agent that prints its environment cannot export a durable secret.
      OMB_CONNECTOR_UPSTREAM_URL: `${context.harnessUrl}/api/internal/connectors/mcp`,
      OMB_CONNECTOR_UPSTREAM_HEADERS: JSON.stringify({ authorization: `Bearer ${context.commsToken}` }),
      OMB_HARNESS_URL: context.harnessUrl,
      // Distinct from the agents proxy token: Codex flattens mounted MCP env
      // variables into one process environment, so a shared name would let
      // the later agents mount overwrite this connector-scoped capability.
      OMB_CONNECTOR_TOKEN: context.commsToken,
      OMB_BOT_ID: context.botId,
      OMB_THREAD_ID: context.threadId,
    },
  };
}

export async function relayMcp(
  cfg: AppConfig,
  payload: JsonValue,
  transportSessionId?: string,
): Promise<{ status: number; bytes: Uint8Array; contentType: string; transportSessionId?: string }> {
  const apiKey = projectApiKey(cfg);
  let url: string;
  let identity: string;
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  const surface = composioSurface(cfg);
  if (apiKey) {
    if (surface === "connect") {
      url = connectMcpEndpoint(cfg);
      headers.set("x-consumer-api-key", apiKey);
      identity = backendFingerprint("connect-mcp", url, apiKey);
    } else {
      const session = await ensureProjectSession(cfg);
      url = session.mcp.url;
      headers.set("x-api-key", apiKey);
      identity = backendFingerprint("project-mcp", url, apiKey);
    }
  } else {
    const broker = brokerAccess();
    if (!broker) throw new Error("Connected apps are unavailable");
    url = `${broker.url}/v1/mcp`;
    headers.set("authorization", `Bearer ${broker.token}`);
    identity = backendFingerprint("managed-mcp", url, broker.token);
  }
  const knownIdentity = transportSessionId
    ? transportSessionBackends.get(transportSessionId)
    : undefined;
  const forwardedTransportSessionId = transportSessionId
    && knownIdentity === identity
    ? transportSessionId
    : undefined;
  if (forwardedTransportSessionId) {
    headers.set("mcp-session-id", forwardedTransportSessionId);
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > 20 * 1024 * 1024) throw new Error("Connected-app response exceeded 20 MB");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Connected-app response exceeded 20 MB");
  if (forwardedTransportSessionId) rememberTransportSession(forwardedTransportSessionId, identity);
  const nextTransportSessionId = response.headers.get("mcp-session-id") ?? undefined;
  if (nextTransportSessionId) rememberTransportSession(nextTransportSessionId, identity);
  return {
    status: response.status,
    bytes,
    contentType: response.headers.get("content-type") ?? "application/json",
    transportSessionId: nextTransportSessionId,
  };
}

async function listConnectedAccounts(
  apiKey: string,
  userId: string,
  slugs: string[],
): Promise<ConnectedAccountResponse[]> {
  const accounts: ConnectedAccountResponse[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  // Five accounts per toolkit can exceed one provider page when a user has
  // many apps. Follow Composio's cursor instead of silently dropping entries.
  for (let page = 0; page < MAX_CONNECTED_ACCOUNT_PAGES; page += 1) {
    const params = new URLSearchParams({
      limit: "50",
      user_ids: userId,
      order_by: "updated_at",
      order_direction: "desc",
    });
    if (slugs.length) params.set("toolkit_slugs", slugs.join(","));
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${apiBase()}/connected_accounts?${params}`, {
      headers: projectHeaders(apiKey),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(await responseError(response, `Composio accounts: HTTP ${response.status}`));
    const body = connectedAccountsPageSchema.parse(await response.json());
    accounts.push(...body.items);
    const next = body.next_cursor || undefined;
    if (!next || seenCursors.has(next)) return accounts;
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("Composio account inventory exceeded the pagination safety limit");
}

async function listSessionToolkits(
  apiKey: string,
  sessionId: string,
): Promise<ToolkitItem[]> {
  const toolkits: ToolkitItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CONNECTED_ACCOUNT_PAGES; page += 1) {
    // The unfiltered endpoint contains the entire Composio marketplace and is
    // cursor-paginated in 50-item pages. The Connected tab only needs the
    // user's connected toolkits, so avoid scanning hundreds of unrelated apps.
    const params = new URLSearchParams({ limit: "50", is_connected: "true" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(
      `${apiBase()}/tool_router/session/${encodeURIComponent(sessionId)}/toolkits?${params}`,
      { headers: projectHeaders(apiKey), signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(await responseError(response, `Composio toolkits: HTTP ${response.status}`));
    const body = toolkitPageSchema.parse(await response.json());
    toolkits.push(...(body.items ?? []));
    const next = body.next_cursor || undefined;
    if (!next || seenCursors.has(next)) return toolkits;
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("Composio toolkit inventory exceeded the pagination safety limit");
}

function summarizeAccounts(accounts: ConnectedAccountResponse[], slugs: string[]) {
  const requested = new Set(slugs.map(canonicalToolkitSlug));
  const bySlug = new Map<string, Array<ConnectedAccountSummary & { updatedAt: string }>>();
  for (const account of accounts) {
    const slug = account.toolkit?.slug ? canonicalToolkitSlug(account.toolkit.slug) : "";
    if (!slug || (requested.size && !requested.has(slug)) || !validAccountId(account.id)) continue;
    const alias = account.alias?.trim() ?? "";
    const summary: ConnectedAccountSummary & { updatedAt: string } = {
      id: account.id,
      status: account.status || "UNKNOWN",
      updatedAt: account.updated_at ?? "",
    };
    if (printableAliasSchema.safeParse(alias).success) summary.alias = alias;
    const list = bySlug.get(slug) ?? [];
    list.push(summary);
    bySlug.set(slug, list);
  }
  for (const list of bySlug.values()) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return bySlug;
}

function publicAccount({ id, alias, status }: ConnectedAccountSummary): ConnectedAccountSummary {
  const account: ConnectedAccountSummary = { id, status };
  if (alias) account.alias = alias;
  return account;
}

function serviceStateFromAccounts(
  accounts: ConnectedAccountSummary[],
): ConnectorServiceState {
  const active = accounts.find((account) => /^active$/i.test(account.status));
  const pending = accounts.find((account) => /^(initiated|initializing|pending)$/i.test(account.status));
  const expired = accounts.find((account) => /^expired/i.test(account.status));
  const failed = accounts.find((account) => /^(failed|error)/i.test(account.status));
  const cancelled = accounts.find((account) => /^cancel/i.test(account.status));
  const disconnected = accounts.find((account) => /^disconnect/i.test(account.status));

  if (active) {
    return {
      connected: true,
      pending: false,
      status: active.status || "ACTIVE",
      accounts: accounts.map(publicAccount),
    };
  }
  if (pending) {
    return {
      connected: false,
      pending: true,
      status: pending.status || "PENDING",
      accounts: accounts.map(publicAccount),
    };
  }
  if (expired) {
    return {
      connected: false,
      pending: false,
      status: expired.status || "EXPIRED",
      accounts: accounts.map(publicAccount),
    };
  }
  if (failed) {
    return {
      connected: false,
      pending: false,
      status: failed.status || "FAILED",
      accounts: accounts.map(publicAccount),
    };
  }
  if (cancelled) {
    return {
      connected: false,
      pending: false,
      status: cancelled.status || "CANCELLED",
      accounts: accounts.map(publicAccount),
    };
  }
  if (disconnected) {
    return {
      connected: false,
      pending: false,
      status: disconnected.status || "DISCONNECTED",
      accounts: accounts.map(publicAccount),
    };
  }
  const selected = accounts[0];
  return {
    connected: false,
    pending: false,
    status: selected?.status ?? "not_connected",
    accounts: accounts.map(publicAccount),
  };
}

function allServiceStates(
  accountsBySlug: ReadonlyMap<string, ConnectedAccountSummary[]>,
  toolkits: ToolkitItem[],
): Record<string, ConnectorServiceState> {
  const services = new Map(
    [...accountsBySlug].map(([slug, accounts]) => [slug, serviceStateFromAccounts(accounts)]),
  );
  for (const toolkit of toolkits) {
    const slug = toolkit.slug ? canonicalToolkitSlug(toolkit.slug) : "";
    const selected = toolkit.connected_account;
    const selectedId = validAccountId(selected?.id) ? selected.id : undefined;
    if (!slug || (!toolkit.is_no_auth && !selectedId)) continue;
    const existingAccounts = accountsBySlug.get(slug) ?? [];
    const accounts = [...existingAccounts];
    if (selectedId && !accounts.some((account) => account.id === selectedId)) {
      accounts.push({ id: selectedId, status: selected?.status ?? "ACTIVE" });
    }
    const accountState = serviceStateFromAccounts(accounts);
    const isNoAuth = toolkit.is_no_auth === true;
    const rawStatus = isNoAuth ? "ACTIVE" : (selected?.status ?? accountState.status);
    const isConnected = isNoAuth || accountState.connected || /^active$/i.test(rawStatus);
    const isPending = !isConnected && (accountState.pending || /^(initiated|initializing|pending)$/i.test(rawStatus));
    const finalStatus = isConnected
      ? (isNoAuth ? "ACTIVE" : (accountState.connected ? accountState.status : rawStatus))
      : (isPending ? (accountState.pending ? accountState.status : rawStatus) : rawStatus);
    services.set(slug, {
      connected: isConnected,
      pending: isPending,
      status: finalStatus,
      accounts: accountState.accounts,
    });
  }
  return Object.fromEntries(services);
}

export async function parseConnectMcpJsonRpc(res: Response): Promise<any> {
  const raw = await res.text().catch(() => "");
  if (!raw) return {};

  if (raw.includes("data:")) {
    const dataLines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        dataLines.push(trimmed.slice(5).trim());
      }
    }
    if (dataLines.length > 0) {
      for (let i = dataLines.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(dataLines[i]);
        } catch {
          // continue
        }
      }
      try {
        return JSON.parse(dataLines.join("\n"));
      } catch {
        // continue
      }
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function queryConnectMcpTools(apiKey: string, endpoint: string): Promise<string[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-consumer-api-key": apiKey,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json: any = await parseConnectMcpJsonRpc(res);
  const tools = json?.result?.tools ?? json?.tools ?? [];
  if (!Array.isArray(tools)) return [];
  return tools.map((t: any) => String(t.name ?? "")).filter(Boolean);
}

function toolkitSlugsFromTools(toolNames: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const name of toolNames) {
    const parts = name.split(/[-_]/);
    if (parts[0]) slugs.add(canonicalToolkitSlug(parts[0]));
  }
  return slugs;
}

const knownConnectSlugs = new Set<string>([
  "github", "slack", "googlecalendar", "gmail", "googledrive", "googlesheets",
  "notion", "linear", "jira", "discord", "zoom", "twitter", "spotify", "hubspot",
  "salesforce", "clickup", "airtable", "asana", "trello", "intercom", "zendesk",
  ...COMPOSIO_CATALOG.slice(0, 100).map((c) => c.slug),
]);

export async function queryConnectMcpStatuses(
  apiKey: string,
  endpoint: string,
  slugs: string[],
): Promise<Record<string, ConnectorServiceState>> {
  const canonicalSlugs = [...new Set(slugs.map(canonicalToolkitSlug))].filter(Boolean);
  if (canonicalSlugs.length === 0) return {};
  for (const s of canonicalSlugs) knownConnectSlugs.add(s);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-consumer-api-key": apiKey,
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "COMPOSIO_MANAGE_CONNECTIONS",
          arguments: {
            toolkits: canonicalSlugs.map((name) => ({ name, action: "list" })),
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const json: any = await parseConnectMcpJsonRpc(res);
      const contentText = json?.result?.content?.[0]?.text;
      if (contentText && typeof contentText === "string") {
        try {
          const inner = JSON.parse(contentText);
          const results = inner?.data?.results ?? {};
          const out: Record<string, ConnectorServiceState> = {};
          for (const slug of canonicalSlugs) {
            const tkResult = results[slug];
            const accounts = Array.isArray(tkResult?.accounts) ? tkResult.accounts : [];
            const hasActiveAccount = accounts.some((a: any) => /^active$/i.test(a.status));
            const isToolkitActive = /^active$/i.test(tkResult?.status);
            const isConnected = hasActiveAccount || isToolkitActive;
            const isPending = !isConnected && (/^initiat/i.test(tkResult?.status) || accounts.some((a: any) => /^(initiated|initializing|pending)$/i.test(a.status)));
            const publicAccounts = accounts.map((a: any) => ({
              id: String(a.id || `connect_${slug}`),
              status: String(a.status || "ACTIVE").toUpperCase(),
              alias: a.user_info?.login || a.user_info?.name || a.alias || undefined,
            }));

            if (isConnected) {
              out[slug] = {
                connected: true,
                pending: false,
                status: "ACTIVE",
                accounts: publicAccounts.length > 0 ? publicAccounts : [{ id: `connect_${slug}`, status: "ACTIVE" }],
              };
            } else if (isPending) {
              out[slug] = {
                connected: false,
                pending: true,
                status: "INITIATED",
                accounts: publicAccounts,
              };
            } else {
              out[slug] = {
                connected: false,
                pending: false,
                status: "not_connected",
                accounts: [],
              };
            }
          }
          return out;
        } catch {
          // fallback
        }
      }
    }
  } catch {
    // fallback
  }

  // Fallback: If COMPOSIO_MANAGE_CONNECTIONS fails or is not mocked in tests, fall back to queryConnectMcpTools
  try {
    const tools = await queryConnectMcpTools(apiKey, endpoint);
    const connected = toolkitSlugsFromTools(tools);
    return Object.fromEntries(
      canonicalSlugs.map((slug) => {
        const isConnected = connected.has(slug);
        return [
          slug,
          {
            connected: isConnected,
            pending: false,
            status: isConnected ? "ACTIVE" : "not_connected",
            accounts: isConnected ? [{ id: `connect_${slug}`, status: "ACTIVE" }] : [],
          },
        ];
      }),
    );
  } catch {
    return Object.fromEntries(
      canonicalSlugs.map((slug) => [slug, { connected: false, pending: false, status: "not_connected", accounts: [] }]),
    );
  }
}

async function connectServicesFromMcp(apiKey: string, endpoint: string): Promise<Record<string, ConnectorServiceState>> {
  const allStatuses = await queryConnectMcpStatuses(apiKey, endpoint, [...knownConnectSlugs]);
  const connected = Object.fromEntries(
    Object.entries(allStatuses).filter(([, state]) => state.connected || state.pending),
  );
  return connected;
}

async function connectStatusFromMcp(apiKey: string, slugs: string[], endpoint: string): Promise<Record<string, ConnectorServiceState>> {
  return queryConnectMcpStatuses(apiKey, endpoint, slugs);
}

/**
 * Enumerate the user's complete connected-account inventory without depending
 * on marketplace ordering or catalog pagination.
 */
export async function connectedServices(cfg: AppConfig): Promise<Record<string, ConnectorServiceState>> {
  const apiKey = projectApiKey(cfg);
  if (!apiKey) {
    const response = await brokerRequest("/v1/connectors/connected");
    if (!response.ok) await throwBrokerError(response, `Connected apps: HTTP ${response.status}`);
    const body = connectorServicesResponseSchema.parse(await response.json());
    const services = canonicalServiceRecord(body.services ?? {});
    return Object.fromEntries(
      Object.entries(services).map(([slug, state]) => [slug, {
        connected: state.connected,
        pending: state.pending ?? false,
        status: state.status ?? (state.connected ? "ACTIVE" : "not_connected"),
        accounts: state.accounts ?? [],
      }]),
    );
  }
  const surface = composioSurface(cfg);
  if (surface === "connect") {
    return connectServicesFromMcp(apiKey, connectMcpEndpoint(cfg)).catch(() => ({}));
  }
  const session = await ensureProjectSession(cfg);
  const userId = session.config?.user_id ?? cfg.composio?.userId;
  if (!userId) throw new Error("Composio Session returned no user ID");
  const [toolkits, accounts] = await Promise.all([
    listSessionToolkits(apiKey, session.session_id),
    // Scoped project keys can grant Session reads without granting the raw
    // connected-account list. The Session still proves which selected/no-auth
    // toolkits belong to this installation, so retain that safe fallback.
    listConnectedAccounts(apiKey, userId, []).catch(() => []),
  ]);
  return allServiceStates(summarizeAccounts(accounts, []), toolkits);
}

export async function connectionStatus(cfg: AppConfig, slugs: string[]) {
  const canonicalSlugs = [...new Set(slugs.map(canonicalToolkitSlug))];
  const apiKey = projectApiKey(cfg);
  if (!apiKey) {
    const response = await brokerRequest(`/v1/connectors?${new URLSearchParams({ services: canonicalSlugs.join(",") })}`);
    if (!response.ok) await throwBrokerError(response, `Connected apps: HTTP ${response.status}`);
    const body = connectorServicesResponseSchema.parse(await response.json());
    return requestedServiceRecord(body.services ?? {}, slugs);
  }
  const surface = composioSurface(cfg);
  if (surface === "connect") {
    return connectStatusFromMcp(apiKey, slugs, connectMcpEndpoint(cfg)).catch(() => {
      return Object.fromEntries(
        slugs.map((slug) => [slug, { connected: false, pending: false, status: "not_connected", accounts: [] }]),
      );
    });
  }
  const session = await ensureProjectSession(cfg);
  const params = new URLSearchParams({ limit: "50" });
  if (canonicalSlugs.length) params.set("toolkits", canonicalSlugs.join(","));
  const userId = session.config?.user_id ?? cfg.composio?.userId;
  const [res, accounts] = await Promise.all([
    fetch(`${apiBase()}/tool_router/session/${encodeURIComponent(session.session_id)}/toolkits?${params}`, {
      headers: projectHeaders(apiKey),
      signal: AbortSignal.timeout(15_000),
    }),
    // Session toolkits only include an account once it is usable. Read the
    // account lifecycle too so the UI can distinguish an OAuth flow that is
    // still waiting in the browser from one that expired or failed. Scoped
    // keys may omit connected-account read permission, so this is additive:
    // the normal session result remains the fallback.
    userId
      ? listConnectedAccounts(apiKey, userId, canonicalSlugs).catch(() => [])
      : Promise.resolve([]),
  ]);
  if (!res.ok) throw new Error(await responseError(res, `Composio toolkits: HTTP ${res.status}`));
  const body = toolkitPageSchema.parse(await res.json());
  const bySlug = new Map(
    (body.items ?? []).flatMap((item) => item.slug ? [[canonicalToolkitSlug(item.slug), item] as const] : []),
  );
  const accountsBySlug = summarizeAccounts(accounts, canonicalSlugs);
  return Object.fromEntries(
    slugs.map((slug) => {
      const canonicalSlug = canonicalToolkitSlug(slug);
      const item = bySlug.get(canonicalSlug);
      const serviceAccounts = accountsBySlug.get(canonicalSlug) ?? [];
      // Mirror allServiceStates: a scoped key can be denied the raw account
      // list while the Session still names its selected account. Synthesize
      // that account here too, so a status poll never wipes the row the
      // inventory paths render (merge replaces a slug's state wholesale).
      const selected = item?.connected_account;
      const selectedId = validAccountId(selected?.id) ? selected.id : undefined;
      const withSelected = selectedId && !serviceAccounts.some((account) => account.id === selectedId)
        ? [...serviceAccounts, { id: selectedId, status: selected?.status ?? "ACTIVE" }]
        : serviceAccounts;
      const accountState = serviceStateFromAccounts(withSelected);
      const isNoAuth = item?.is_no_auth === true;
      const rawState = item?.connected_account?.status
        ?? (isNoAuth ? "ACTIVE" : accountState.status);
      const isConnected = isNoAuth || accountState.connected || /^active$/i.test(rawState);
      const isPending = !isConnected && (accountState.pending || /^(initiated|initializing|pending)$/i.test(rawState));
      const finalStatus = isConnected
        ? (isNoAuth ? "ACTIVE" : (accountState.connected ? accountState.status : rawState))
        : (isPending ? (accountState.pending ? accountState.status : rawState) : rawState);
      return [slug, {
        connected: isConnected,
        pending: isPending,
        status: finalStatus,
        accounts: accountState.accounts,
      }];
    }),
  );
}

/** Backward-compatible service disconnect: removes all accounts associated with the toolkit. */
export async function removeService(cfg: AppConfig, slug: string) {
  const toolkit = canonicalToolkitSlug(slug);
  const apiKey = projectApiKey(cfg);
  if (!apiKey) {
    const response = await brokerRequest(`/v1/connectors/${encodeURIComponent(toolkit)}`, { method: "DELETE" });
    if (!response.ok) await throwBrokerError(response, `Connected apps: HTTP ${response.status}`);
    transportSessionBackends.clear();
    return removalResponseSchema.parse(await response.json());
  }
  const surface = composioSurface(cfg);
  if (surface === "connect") {
    transportSessionBackends.clear();
    return { removed: 1 };
  }
  const session = await ensureProjectSession(cfg).catch(() => null);
  const userId = session?.config?.user_id ?? cfg.composio?.userId;
  const targetIds = new Set<string>();

  if (session) {
    const params = new URLSearchParams({ limit: "50", toolkits: toolkit });
    const list = await fetch(
      `${apiBase()}/tool_router/session/${encodeURIComponent(session.session_id)}/toolkits?${params}`,
      { headers: projectHeaders(apiKey), signal: AbortSignal.timeout(15_000) },
    ).catch(() => null);
    if (list?.ok) {
      const body = toolkitPageSchema.safeParse(await list.json().catch(() => null));
      if (body.success) {
        const item = body.data.items?.find((i) => i.slug && canonicalToolkitSlug(i.slug) === toolkit);
        if (validAccountId(item?.connected_account?.id)) {
          targetIds.add(item.connected_account.id);
        }
      }
    }
  }

  if (userId) {
    const accounts = await listConnectedAccounts(apiKey, userId, [toolkit]).catch(() => []);
    for (const a of accounts) {
      if (a.toolkit?.slug && canonicalToolkitSlug(a.toolkit.slug) === toolkit && validAccountId(a.id)) {
        targetIds.add(a.id);
      }
    }
  }

  if (targetIds.size === 0) return { removed: 0 };

  for (const id of targetIds) {
    const removed = await fetch(
      `${apiBase()}/connected_accounts/${encodeURIComponent(id)}?revoke_on_delete=true`,
      { method: "DELETE", headers: projectHeaders(apiKey), signal: AbortSignal.timeout(30_000) },
    );
    if (!removed.ok && removed.status !== 404) {
      throw new Error(await responseError(removed, `Composio disconnect: HTTP ${removed.status}`));
    }
  }
  transportSessionBackends.clear();
  return { removed: 1 };
}

export async function authorizeConnectService(
  apiKey: string,
  endpoint: string,
  toolkit: string,
  alias?: string | null,
): Promise<{ url: string }> {
  const norm = canonicalToolkitSlug(toolkit);
  knownConnectSlugs.add(norm);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-consumer-api-key": apiKey,
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "COMPOSIO_MANAGE_CONNECTIONS",
          arguments: {
            toolkits: [{ name: norm, action: "add", ...(alias ? { alias } : {}) }],
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const json: any = await parseConnectMcpJsonRpc(res);
      const contentText = json?.result?.content?.[0]?.text;
      if (contentText && typeof contentText === "string") {
        try {
          const inner = JSON.parse(contentText);
          const results = inner?.data?.results;
          const appResult = results?.[norm] ?? results?.[toolkit] ?? (results ? Object.values(results)[0] as any : undefined);
          if (appResult?.redirect_url && typeof appResult.redirect_url === "string") {
            return { url: trustedAuthUrl(appResult.redirect_url, norm) };
          }
          const textToScan = appResult?.error_message ?? appResult?.instruction ?? contentText;
          if (typeof textToScan === "string") {
            const match = textToScan.match(/https:\/\/(?:connect|dashboard)\.composio\.dev\/[^\s)\]]+/);
            if (match) {
              return { url: trustedAuthUrl(match[0], norm) };
            }
          }
        } catch {
          // continue to fallback
        }
      }
    }
  } catch {
    // continue to fallback
  }

  return { url: `https://dashboard.composio.dev/~/org/connect/apps/${encodeURIComponent(norm)}?open=true` };
}

/** Disconnect exactly one account after proving it belongs to this user/toolkit. */
export async function removeAccount(cfg: AppConfig, slug: string, accountId: string) {
  if (!validAccountId(accountId)) throw inputError("Invalid connected-account ID");
  const toolkit = canonicalToolkitSlug(slug);
  const apiKey = projectApiKey(cfg);
  if (!apiKey) {
    const response = await brokerRequest(
      `/v1/connectors/${encodeURIComponent(toolkit)}/accounts/${encodeURIComponent(accountId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) await throwBrokerError(response, `Connected apps: HTTP ${response.status}`);
    transportSessionBackends.clear();
    return removalResponseSchema.parse(await response.json());
  }
  const surface = composioSurface(cfg);
  if (surface === "connect") {
    try {
      await fetch(connectMcpEndpoint(cfg), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-consumer-api-key": apiKey,
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "COMPOSIO_MANAGE_CONNECTIONS",
            arguments: {
              toolkits: [{ name: toolkit, action: "remove", account_id: accountId }],
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // safe fallback
    }
    transportSessionBackends.clear();
    return { removed: 1 };
  }
  const session = await ensureProjectSession(cfg).catch(() => null);
  const userId = session?.config?.user_id ?? cfg.composio?.userId;
  if (userId) {
    const accounts = await listConnectedAccounts(apiKey, userId, [toolkit]).catch(() => []);
    const owned = accounts.some((account) =>
      account.id === accountId
        && account.toolkit?.slug !== undefined
        && canonicalToolkitSlug(account.toolkit.slug) === toolkit
    );
    if (!owned && accounts.length > 0) return { removed: 0 };
  }
  const removed = await fetch(
    `${apiBase()}/connected_accounts/${encodeURIComponent(accountId)}?revoke_on_delete=true`,
    { method: "DELETE", headers: projectHeaders(apiKey), signal: AbortSignal.timeout(30_000) },
  );
  if (!removed.ok && removed.status !== 404) {
    throw new Error(await responseError(removed, `Composio disconnect: HTTP ${removed.status}`));
  }
  transportSessionBackends.clear();
  return { removed: 1 };
}

/** Mint a browser auth link for one service. Returns { url } or throws. */
export async function authorizeService(cfg: AppConfig, slug: string, requestedAlias?: string | null) {
  const alias = normalizeAccountAlias(requestedAlias);
  const toolkit = canonicalToolkitSlug(slug);
  const mode = connectionMode(cfg);
  const unavailable = managedConnectorUnavailableReason(mode, toolkit);
  if (unavailable) throw inputError(unavailable, 409);
  const apiKey = projectApiKey(cfg);
  if (!apiKey) {
    const request: RequestInit = { method: "POST" };
    if (alias) request.body = JSON.stringify({ alias });
    const response = await brokerRequest(`/v1/connectors/${encodeURIComponent(toolkit)}/authorize`, request);
    if (!response.ok) await throwBrokerError(response, `Connected apps: HTTP ${response.status}`);
    const body = authUrlResponseSchema.parse(await response.json());
    return { url: trustedAuthUrl(body.url, toolkit) };
  }
  const surface = composioSurface(cfg);
  if (surface === "connect") {
    return authorizeConnectService(apiKey, connectMcpEndpoint(cfg), toolkit, alias);
  }
  const session = await ensureProjectSession(cfg);
  const userId = session.config?.user_id ?? cfg.composio?.userId;
  if (!userId) throw new Error("Composio Session has no user ID");
  // A scoped key may be denied account listing — authorization must still
  // work (it always did pre-multi-account), so the alias guardrails degrade
  // to first-account behavior, the same fallback every inventory path takes.
  const accounts = await listConnectedAccounts(apiKey, userId, [toolkit]).catch(() => []);
  const serviceAccounts = accounts.filter((account) =>
    account.toolkit?.slug !== undefined && canonicalToolkitSlug(account.toolkit.slug) === toolkit
  );
  const usableAccounts = serviceAccounts.filter((account) => /^(active|initiated|initializing|pending)$/i.test(account.status ?? ""));
  if (usableAccounts.length >= MULTI_ACCOUNT_CONFIG.max_accounts_per_toolkit) {
    throw inputError(`${toolkit} already has the maximum of ${MULTI_ACCOUNT_CONFIG.max_accounts_per_toolkit} accounts`, 409);
  }
  if (usableAccounts.length > 0 && !alias) {
    throw inputError("Add an account alias so the existing connection is not replaced");
  }
  if (alias && serviceAccounts.some((account) => account.alias?.trim().toLowerCase() === alias.toLowerCase())) {
    throw inputError(`Account alias "${alias}" is already in use for ${toolkit}`, 409);
  }
  const linkRequest: AccountLinkRequest = { toolkit };
  if (alias) linkRequest.alias = alias;
  const link = (sessionId: string) =>
    fetch(`${apiBase()}/tool_router/session/${encodeURIComponent(sessionId)}/link`, {
      method: "POST",
      headers: projectHeaders(apiKey, true),
      body: JSON.stringify(linkRequest),
      signal: AbortSignal.timeout(30_000),
    });
  let res = await link(session.session_id);
  if (!res.ok) {
    const message = await responseError(res, `Composio authorization: HTTP ${res.status}`);
    if (!NEEDS_AUTH_CONFIG.test(message)) throw new Error(message);
    // The toolkit needs one of the project's own auth configs. The Session
    // names those only at creation, so an auth config the user created after
    // the Session existed is invisible to it: rebuild the Session once and
    // retry. If the project has no config for this toolkit, say what to do
    // instead of echoing Composio's "auth_config_override" hint.
    const authConfigs = await listCustomAuthConfigs(apiKey);
    const covered = Object.keys(authConfigs).some((key) => canonicalToolkitSlug(key) === toolkit);
    if (!covered) {
      throw inputError(
        `${toolkit} has no Composio-managed sign-in. In your Composio project, create an auth config for "${toolkit}" `
          + "(Auth Configs → Create) with your own app credentials, then click Connect again.",
      );
    }
    const fresh = await recreateProjectSession(cfg, userId, authConfigs);
    res = await link(fresh.session_id);
    if (!res.ok) throw new Error(await responseError(res, `Composio authorization: HTTP ${res.status}`));
  }
  const body = linkResponseSchema.parse(await res.json());
  return { url: trustedAuthUrl(body.redirect_url, toolkit) };
}

// ── marketplace catalog ────────────────────────────────────────────────
export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  /** Toolkits such as public search need no user authorization. */
  noAuth?: boolean;
  /** used for the client-side favicon fallback when logo is null/broken */
  domain: string | null;
}

// Curated fallback — the services agentcal's connectors page ships plus the
// long marketplace tail. Logos resolve client-side:
// logo → favicon(domain) → monogram.
const CURATED: ToolkitCard[] = [
  { slug: "slack", label: "Slack", blurb: "Post updates and read channels", domain: "slack.com", logo: null },
  { slug: "github", label: "GitHub", blurb: "Issues, pull requests, and code", domain: "github.com", logo: null },
  { slug: "gmail", label: "Gmail", blurb: "Read and send email", domain: "gmail.com", logo: null },
  { slug: "googlecalendar", label: "Google Calendar", blurb: "Read and create events", domain: "calendar.google.com", logo: null },
  { slug: "googlesheets", label: "Google Sheets", blurb: "Read and update spreadsheets", domain: "sheets.google.com", logo: null },
  { slug: "googledocs", label: "Google Docs", blurb: "Read and write documents", domain: "docs.google.com", logo: null },
  { slug: "googledrive", label: "Google Drive", blurb: "Browse and manage files", domain: "drive.google.com", logo: null },
  { slug: "notion", label: "Notion", blurb: "Pages and databases", domain: "notion.so", logo: null },
  { slug: "linear", label: "Linear", blurb: "Issues and project tracking", domain: "linear.app", logo: null },
  { slug: "sentry", label: "Sentry", blurb: "Errors and alerts", domain: "sentry.io", logo: null },
  { slug: "posthog", label: "PostHog", blurb: "Analytics, feature flags, experiments", domain: "posthog.com", logo: null },
  { slug: "discord", label: "Discord", blurb: "Messages and channels", domain: "discord.com", logo: null },
  { slug: "twitter", label: "X (Twitter)", blurb: "Post and read on X", domain: "x.com", logo: null },
  { slug: "reddit", label: "Reddit", blurb: "Browse and post", domain: "reddit.com", logo: null },
  { slug: "zapier", label: "Zapier", blurb: "Connect 9,000+ apps", domain: "zapier.com", logo: null },
  { slug: "hubspot", label: "HubSpot", blurb: "CRM search & updates", domain: "hubspot.com", logo: null },
  { slug: "salesforce", label: "Salesforce", blurb: "CRM records and reports", domain: "salesforce.com", logo: null },
  { slug: "jira", label: "Jira", blurb: "Issues and sprints", domain: "atlassian.com", logo: null },
  { slug: "asana", label: "Asana", blurb: "Tasks and projects", domain: "asana.com", logo: null },
  { slug: "trello", label: "Trello", blurb: "Boards and cards", domain: "trello.com", logo: null },
  { slug: "dropbox", label: "Dropbox", blurb: "Files and folders", domain: "dropbox.com", logo: null },
  { slug: "airtable", label: "Airtable", blurb: "Bases and records", domain: "airtable.com", logo: null },
  { slug: "figma", label: "Figma", blurb: "Files and comments", domain: "figma.com", logo: null },
  { slug: "stripe", label: "Stripe", blurb: "Payments and customers", domain: "stripe.com", logo: null },
];

let toolkitCache: { at: number; cards: ToolkitCard[]; identity: string } | null = null;

export interface DiscoveredToolkit {
  slug: string;
  label: string;
  blurb: string;
}

export async function searchConnectMcpToolkits(
  apiKey: string,
  endpoint: string,
  query: string,
): Promise<DiscoveredToolkit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-consumer-api-key": apiKey,
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "COMPOSIO_SEARCH_TOOLS",
          arguments: {
            queries: [{ use_case: `find tools and integrations for ${trimmed}` }],
            search_strategy: "auto",
            session: { generate_id: true },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Composio rejected this consumer key (invalid or unauthorized)");
    }
    if (!res.ok) return [];
    const json = await parseConnectMcpJsonRpc(res);
    const contentText = json?.result?.content?.[0]?.text;
    if (!contentText || typeof contentText !== "string") return [];

    let inner: any;
    try {
      inner = JSON.parse(contentText);
    } catch {
      return [];
    }
    const data = inner?.data;
    if (!data) return [];

    const discovered: DiscoveredToolkit[] = [];
    const seen = new Set<string>();

    const statuses = Array.isArray(data.toolkit_connection_statuses) ? data.toolkit_connection_statuses : [];
    for (const item of statuses) {
      if (!item?.toolkit) continue;
      const slug = canonicalToolkitSlug(String(item.toolkit));
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const desc = typeof item.description === "string" ? item.description.trim() : "";
      discovered.push({
        slug,
        label: String(item.toolkit).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        blurb: desc.slice(0, 90) || "Connect this app so your bot can continue",
      });
    }

    const results = Array.isArray(data.results) ? data.results : [];
    for (const r of results) {
      const toolkits = Array.isArray(r?.toolkits) ? r.toolkits : [];
      for (const tk of toolkits) {
        const slug = canonicalToolkitSlug(String(tk));
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        discovered.push({
          slug,
          label: String(tk).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          blurb: "Connect this app so your bot can continue",
        });
      }
    }

    return discovered;
  } catch (err: any) {
    if (err?.message?.includes("invalid or unauthorized")) {
      throw err;
    }
    return [];
  }
}

export function clearToolkitCache(): void {
  toolkitCache = null;
}

/**
 * Marketplace catalog. Tries the v3 toolkits API (official names,
 * descriptions, logos — cached 10 min); falls back to the curated list.
 */
export async function listToolkits(
  cfg: AppConfig,
  options?: { query?: string; cursor?: string; limit?: number; refresh?: boolean },
): Promise<{ cards: ToolkitCard[]; source: "api" | "curated"; totalCount?: number; hasMore?: boolean; nextCursor?: string | null; error?: string }> {
  if (options?.refresh) {
    toolkitCache = null;
  }
  const backendKey = projectApiKey(cfg);
  const broker = backendKey ? null : brokerAccess();
  const surface = composioSurface(cfg);
  const isConnect = surface === "connect";

  // In Connect mode, use Connect MCP and curated base
  if (isConnect && backendKey) {
    const mcpUrl = connectMcpEndpoint(cfg);
    const identity = backendFingerprint("connect-catalog", mcpUrl, backendKey);
    let allCards: ToolkitCard[] = [];

    if (toolkitCache?.identity === identity && Date.now() - toolkitCache.at < 10 * 60_000) {
      allCards = toolkitCache.cards;
    } else {
      allCards = [...COMPOSIO_CATALOG];
      toolkitCache = { at: Date.now(), cards: allCards, identity };
    }

    let filteredCards = allCards;
    let upstreamError: string | undefined;

    if (options?.query && options.query.trim()) {
      const q = options.query.trim().toLowerCase();
      filteredCards = allCards.filter(
        (c) =>
          c.slug.toLowerCase().includes(q) ||
          c.label.toLowerCase().includes(q) ||
          (c.blurb && c.blurb.toLowerCase().includes(q)),
      );

      // Dynamically discover matching toolkits via Connect MCP across 500+ apps
      try {
        const discovered = await searchConnectMcpToolkits(backendKey, mcpUrl, options.query);
        for (const disc of discovered) {
          const existingInFiltered = filteredCards.find((c) => c.slug === disc.slug);
          if (!existingInFiltered) {
            const newCard: ToolkitCard = {
              slug: disc.slug,
              label: disc.label,
              blurb: disc.blurb,
              logo: null,
              domain: null,
            };
            filteredCards.push(newCard);
            if (!allCards.find((c) => c.slug === disc.slug)) {
              allCards.push(newCard);
            }
          }
        }
        toolkitCache = { at: Date.now(), cards: allCards, identity };
      } catch (err: any) {
        if (err?.message?.includes("invalid or unauthorized")) {
          upstreamError = err.message;
        }
        // Fall back gracefully to filteredCards from curated if network glitch
      }
    }

    if (upstreamError) {
      return {
        cards: [],
        source: "api",
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
        error: upstreamError,
      };
    }

    return {
      cards: filteredCards,
      source: "api",
      totalCount: options?.query ? filteredCards.length : allCards.length,
      hasMore: false,
      nextCursor: null,
    };
  }

  const identity = backendKey
    ? backendFingerprint("project-catalog", toolkitBase(), backendKey)
    : broker
      ? backendFingerprint("managed-catalog", broker.url, broker.token)
      : null;

  let allCards: ToolkitCard[] = [];
  let source: "api" | "curated" = "curated";
  let upstreamCatalogError: string | undefined;
  let reportedTotalItems: number | undefined;

  if (identity && toolkitCache?.identity === identity && Date.now() - toolkitCache.at < 10 * 60_000 && !options?.query) {
    allCards = toolkitCache.cards;
    source = "api";
    reportedTotalItems = (toolkitCache as any)?.totalItems;
  } else if (backendKey || broker) {
    try {
      // The marketplace runs to well over a thousand toolkits and the endpoint
      // is cursor-paginated, so one page stops partway through the alphabet.
      // Follow next_cursor, and keep the pages already collected if a later
      // one fails — a partial catalog still beats the curated two dozen.
      const items: any[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined = options?.cursor;
      let lastReportedPage: number | undefined;

      const headers: Record<string, string> = backendKey
        ? (backendKey.startsWith("ck_") ? { "x-consumer-api-key": backendKey } : { "x-api-key": backendKey })
        : {};

      for (let page = 0; page < MAX_CONNECTED_ACCOUNT_PAGES; page += 1) {
        const params = new URLSearchParams({ limit: String(options?.limit || 100), sort_by: "usage" });
        if (cursor) params.set("cursor", cursor);
        if (options?.query && options.query.trim()) params.set("search", options.query.trim());
        const res = backendKey
          ? await fetch(`${toolkitBase()}/toolkits?${params}`, {
              headers,
              signal: AbortSignal.timeout(15_000),
            })
          : await brokerRequest(cursor ? `/v1/catalog?cursor=${encodeURIComponent(cursor)}` : "/v1/catalog", {
              signal: AbortSignal.timeout(15_000),
            });
        if (!res.ok) {
          if (page === 0) {
            upstreamCatalogError = await responseError(res, `Upstream catalog error (HTTP ${res.status})`);
          }
          break;
        }
        const json: any = await res.json();
        const pageItems = json.items ?? json.data ?? json.toolkits ?? [];
        if (!Array.isArray(pageItems)) break;
        items.push(...pageItems);
        if (typeof json.total_items === "number" && Number.isFinite(json.total_items)) {
          reportedTotalItems = json.total_items;
        }
        // Composio reports current_page and total_pages beside next_cursor.
        // A broker that drops the cursor (or an upstream regression) can replay
        // a page while minting fresh cursors, so trust page movement: once it
        // stops advancing, the catalog is stuck and paging stops cleanly.
        const reportedPage = Number(json.current_page);
        if (Number.isFinite(reportedPage)) {
          if (lastReportedPage !== undefined && reportedPage <= lastReportedPage) break;
          lastReportedPage = reportedPage;
        }
        const reportedTotalPages = Number(json.total_pages);
        if (
          lastReportedPage !== undefined &&
          Number.isFinite(reportedTotalPages) &&
          reportedTotalPages > 0 &&
          lastReportedPage >= reportedTotalPages
        ) {
          break;
        }
        const next = typeof json.next_cursor === "string" ? json.next_cursor.trim() : "";
        if (!next || seenCursors.has(next)) break;
        seenCursors.add(next);
        cursor = next;
      }
      if (items.length) {
        const cards: ToolkitCard[] = items.map((t: any) => ({
          slug: canonicalToolkitSlug(String(t.slug ?? t.key ?? t.name ?? "")),
          label: t.name ?? t.slug ?? "",
          blurb: (t.meta?.description ?? t.description ?? "").slice(0, 90),
          logo: t.meta?.logo ?? t.logo ?? null,
          noAuth: t.no_auth === true,
          domain: null,
        }));
        const uniqueCards = cards.filter(
          (card, index) => card.slug && cards.findIndex((candidate) => candidate.slug === card.slug) === index,
        );
        if (!options?.query) {
          toolkitCache = { at: Date.now(), cards: uniqueCards, identity: identity!, totalItems: reportedTotalItems } as any;
        }
        allCards = uniqueCards;
        source = "api";
      }
    } catch (err: any) {
      upstreamCatalogError = err instanceof Error ? err.message : String(err);
      /* fall through to error / curated */
    }
  }

  if (upstreamCatalogError && !allCards.length && (backendKey || broker)) {
    return {
      cards: [],
      source: "api",
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      error: upstreamCatalogError,
    };
  }

  if (!allCards.length) {
    allCards = COMPOSIO_CATALOG;
    source = "curated";
  }

  // Handle client-side search filtering across the complete discovered catalog
  let filteredCards = allCards;
  if (options?.query && options.query.trim()) {
    const q = options.query.trim().toLowerCase();
    filteredCards = allCards.filter(
      (c) =>
        c.slug.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        (c.blurb && c.blurb.toLowerCase().includes(q)),
    );
  }

  return {
    cards: filteredCards,
    source,
    totalCount: reportedTotalItems ?? (options?.query ? filteredCards.length : allCards.length),
    hasMore: Boolean(reportedTotalItems && allCards.length < reportedTotalItems),
    nextCursor: null,
    error: upstreamCatalogError,
  };
}


export async function toolkitCard(cfg: AppConfig, slug: string): Promise<ToolkitCard> {
  const normalized = canonicalToolkitSlug(slug);
  const { cards } = await listToolkits(cfg);
  return cards.find((card) => card.slug.toLowerCase() === normalized)
    ?? COMPOSIO_CATALOG.find((card) => card.slug === normalized)
    ?? CURATED.find((card) => card.slug === normalized)
    ?? {
      slug: normalized,
      label: normalized.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      blurb: "Connect this app so your bot can continue",
      logo: null,
      domain: null,
    };
}

export const CURATED_SLUGS = CURATED.map((c) => c.slug);

// ── Phase 12 Connected Service Intelligence ─────────────────────────────

export interface ServiceRequirement {
  serviceName: "gmail" | "github" | "googlecalendar" | "slack" | "linear";
  actionDescription: string;
  requiredScopes: string[];
  connectionStatus: "connected" | "disconnected" | "expired" | "rate_limited";
  authUrl?: string;
}

export interface ServiceConnectionSuspension {
  suspensionId: string;
  turnId: string;
  botId: string;
  requiredService: string;
  pendingExecutionPayload: Record<string, unknown>;
  createdAt: number;
}

export const ERR_OAUTH_TIMEOUT = "ERR_OAUTH_TIMEOUT";

export function getRequiredScopesForService(
  service: "gmail" | "github" | "googlecalendar" | "slack" | "linear" | string,
  actionDescription?: string,
): string[] {
  const norm = canonicalToolkitSlug(service);
  const action = (actionDescription ?? "").toLowerCase();
  switch (norm) {
    case "gmail":
      if (action.includes("send") || action.includes("draft") || action.includes("write")) {
        return ["https://www.googleapis.com/auth/gmail.send"];
      }
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    case "googlecalendar":
      if (action.includes("create") || action.includes("update") || action.includes("schedule") || action.includes("write")) {
        return ["https://www.googleapis.com/auth/calendar.events"];
      }
      return ["https://www.googleapis.com/auth/calendar.events.readonly"];
    case "github":
      if (/\b(?:repo(?:sitory)?|commit|pull(?:\s+request)?|push|branch)\b/i.test(action) || /\bpr\b/i.test(action)) {
        return ["repo"];
      }
      return ["read:user"];
    case "slack":
      if (action.includes("post") || action.includes("send") || action.includes("write") || action.includes("chat")) {
        return ["chat:write"];
      }
      return ["channels:read"];
    case "linear":
      if (action.includes("create") || action.includes("update") || action.includes("write")) {
        return ["write"];
      }
      return ["read"];
    default:
      return [];
  }
}

export function sanitizeServicePayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/ya29\.[a-zA-Z0-9_-]+/g, "[REDACTED_GOOGLE_TOKEN]")
      .replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/gho_[a-zA-Z0-9]+/g, "[REDACTED_GITHUB_OAUTH]")
      .replace(/xox[baprs]-[a-zA-Z0-9_-]+/g, "[REDACTED_SLACK_TOKEN]")
      .replace(/lin_api_[a-zA-Z0-9]+/g, "[REDACTED_LINEAR_TOKEN]")
      .replace(/Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/\b(ak|ck)_[a-zA-Z0-9]+/g, "[REDACTED_KEY]") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeServicePayload(item)) as unknown as T;
  }
  if (typeof value === "object") {
    const sensitiveKeys = new Set([
      "token",
      "secret",
      "password",
      "accesstoken",
      "access_token",
      "refreshtoken",
      "refresh_token",
      "clientsecret",
      "client_secret",
      "apikey",
      "api_key",
      "authorization",
      "auth",
    ]);
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (sensitiveKeys.has(k.toLowerCase().replace(/[-_]/g, ""))) {
        cleaned[k] = "[REDACTED]";
      } else {
        cleaned[k] = sanitizeServicePayload(v);
      }
    }
    return cleaned as T;
  }
  return value;
}

export interface CreateSuspensionParams {
  turnId: string;
  botId: string;
  requiredService: "gmail" | "github" | "googlecalendar" | "slack" | "linear" | string;
  pendingExecutionPayload: Record<string, unknown>;
  ttlMs?: number;
}

export interface ResumeSuspensionParams {
  suspensionId: string;
  callerBotId: string;
  authOutcome?: "success" | "cancelled" | "failed";
}

export interface ResumeSuspensionResult {
  ok: boolean;
  suspension?: ServiceConnectionSuspension;
  error?: string;
  code?: string;
  resumed?: boolean;
}

export class ServiceSuspensionManager {
  private suspensions = new Map<string, ServiceConnectionSuspension>();
  private completed = new Set<string>();
  private expired = new Set<string>();
  private defaultTtlMs = 10 * 60_000; // 10 minutes

  constructor(defaultTtlMs = 10 * 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  createSuspension(params: CreateSuspensionParams): ServiceConnectionSuspension {
    if (!params.turnId || typeof params.turnId !== "string") {
      throw new TypeError("turnId is required for ServiceConnectionSuspension");
    }
    if (!params.botId || typeof params.botId !== "string") {
      throw new TypeError("botId is required for ServiceConnectionSuspension");
    }
    if (!params.requiredService || typeof params.requiredService !== "string") {
      throw new TypeError("requiredService is required for ServiceConnectionSuspension");
    }

    const suspensionId = `susp_${randomUUID()}`;
    const sanitizedPayload = sanitizeServicePayload(params.pendingExecutionPayload ?? {});
    const suspension: ServiceConnectionSuspension = {
      suspensionId,
      turnId: params.turnId,
      botId: params.botId,
      requiredService: canonicalToolkitSlug(params.requiredService),
      pendingExecutionPayload: JSON.parse(JSON.stringify(sanitizedPayload)),
      createdAt: Date.now(),
    };

    this.suspensions.set(suspensionId, suspension);
    return suspension;
  }

  getSuspension(suspensionId: string, ttlMs?: number): ServiceConnectionSuspension | null {
    const suspension = this.suspensions.get(suspensionId);
    if (!suspension) return null;

    const timeout = ttlMs ?? this.defaultTtlMs;
    if (Date.now() - suspension.createdAt > timeout) {
      this.expireSuspension(suspensionId);
      return null;
    }
    return suspension;
  }

  expireSuspension(suspensionId: string): boolean {
    const suspension = this.suspensions.get(suspensionId);
    if (!suspension) return false;
    this.expired.add(suspensionId);
    // Sanitize and clear payload upon expiration
    suspension.pendingExecutionPayload = {};
    return true;
  }

  resumeSuspension(params: ResumeSuspensionParams, ttlMs?: number): ResumeSuspensionResult {
    const { suspensionId, callerBotId, authOutcome = "success" } = params;
    const suspension = this.suspensions.get(suspensionId);

    if (!suspension) {
      return {
        ok: false,
        error: `Suspension ${suspensionId} not found`,
        code: "ERR_SUSPENSION_NOT_FOUND",
      };
    }

    // Cross-bot replay protection
    if (suspension.botId !== callerBotId) {
      return {
        ok: false,
        error: `Cross-bot suspension access rejected: suspension belongs to ${suspension.botId}, not ${callerBotId}`,
        code: "ERR_CROSS_BOT_DENIED",
      };
    }

    // Check expiration
    const timeout = ttlMs ?? this.defaultTtlMs;
    if (this.expired.has(suspensionId) || Date.now() - suspension.createdAt > timeout) {
      this.expireSuspension(suspensionId);
      return {
        ok: false,
        error: `OAuth connection timed out after 10 minutes for ${suspension.requiredService}`,
        code: ERR_OAUTH_TIMEOUT,
      };
    }

    // Idempotency: duplicate callback check
    if (this.completed.has(suspensionId)) {
      return {
        ok: true,
        resumed: false,
        suspension,
        error: "Suspension has already been resumed",
      };
    }

    if (authOutcome !== "success") {
      this.expireSuspension(suspensionId);
      return {
        ok: false,
        error: `Authentication failed or cancelled for ${suspension.requiredService}`,
        code: "ERR_AUTH_FAILED",
      };
    }

    this.completed.add(suspensionId);
    return {
      ok: true,
      resumed: true,
      suspension,
    };
  }

  listActiveSuspensions(botId?: string): ServiceConnectionSuspension[] {
    const now = Date.now();
    const active: ServiceConnectionSuspension[] = [];
    for (const [id, s] of this.suspensions) {
      if (now - s.createdAt <= this.defaultTtlMs && !this.completed.has(id) && !this.expired.has(id)) {
        if (!botId || s.botId === botId) {
          active.push(s);
        }
      }
    }
    return active;
  }

  clear(): void {
    this.suspensions.clear();
    this.completed.clear();
    this.expired.clear();
  }
}

export const defaultServiceSuspensionManager = new ServiceSuspensionManager();

export async function evaluateServiceRequirement(
  cfg: AppConfig,
  serviceName: "gmail" | "github" | "googlecalendar" | "slack" | "linear",
  actionDescription: string,
): Promise<ServiceRequirement> {
  const norm = canonicalToolkitSlug(serviceName);
  const requiredScopes = getRequiredScopesForService(norm, actionDescription);

  let connectionStatusResult: "connected" | "disconnected" | "expired" | "rate_limited" = "disconnected";
  let authUrl: string | undefined;

  try {
    const statusMap = await connectionStatus(cfg, [norm]);
    const serviceState = statusMap[norm] ?? { connected: false, status: "not_connected" };

    if (serviceState.connected || serviceState.status === "ACTIVE") {
      connectionStatusResult = "connected";
    } else if (serviceState.status === "EXPIRED") {
      connectionStatusResult = "expired";
    } else if (serviceState.status === "RATE_LIMITED" || serviceState.status === "rate_limited") {
      connectionStatusResult = "rate_limited";
    } else {
      connectionStatusResult = "disconnected";
    }

    if (connectionStatusResult !== "connected") {
      try {
        const auth = await authorizeService(cfg, norm);
        authUrl = auth.url;
      } catch {
        authUrl = `https://connect.composio.dev/link/${encodeURIComponent(norm)}`;
      }
    }
  } catch {
    connectionStatusResult = "disconnected";
    authUrl = `https://connect.composio.dev/link/${encodeURIComponent(norm)}`;
  }

  return {
    serviceName,
    actionDescription,
    requiredScopes,
    connectionStatus: connectionStatusResult,
    ...(authUrl ? { authUrl } : {}),
  };
}

export function createServiceConnectionCardPayload(
  requirement: ServiceRequirement,
  suspension: ServiceConnectionSuspension,
): Record<string, unknown> {
  const payload = {
    kind: "service_connection_card",
    serviceName: requirement.serviceName,
    actionDescription: requirement.actionDescription,
    requiredScopes: requirement.requiredScopes,
    connectionStatus: requirement.connectionStatus,
    authUrl: requirement.authUrl,
    suspensionId: suspension.suspensionId,
    turnId: suspension.turnId,
    botId: suspension.botId,
    guidance: `${requirement.serviceName.toUpperCase()} isn't connected yet. ${requirement.actionDescription}`,
    actionLabel: `Connect ${requirement.serviceName.charAt(0).toUpperCase() + requirement.serviceName.slice(1)}`,
  };
  return sanitizeServicePayload(payload);
}

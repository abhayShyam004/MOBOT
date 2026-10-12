// Native ChatGPT sign-in for the Codex provider.
//
// This is the same device-code login the unmodified Codex CLI runs for
// headless machines, executed directly against OpenAI's own endpoints:
// request a user code, point the person at OpenAI's verification page, poll
// until the browser side approves, exchange the returned authorization code
// for tokens, and write them into the CLI's own auth.json. A host without the
// Codex runtime — the Android host — can therefore still sign an account in,
// and a host with the runtime uses exactly the credential the CLI reads.
//
// Endpoint paths, the public client id, and the stored file shape are the
// Codex CLI's own (verified against its device flow as implemented by several
// open clients). No terminal is involved, and no credential is invented.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderAuthenticationStart, ProviderAuthenticationStatus } from "../contracts.ts";

/** The public client id the open-source Codex CLI ships with. */
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** Where the person approves the code; OpenAI's own page. */
export const CODEX_DEVICE_PAGE = "https://auth.openai.com/codex/device";
const DEVICE_USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
/** OAuth authorization endpoint of the same issuer the CLI uses. */
const OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
/** Scopes of the CLI's own ChatGPT sign-in (server.rs: build_authorize_url). */
const OAUTH_SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const UA = "openmausbot-codex-auth";

/** Ports of the CLI's own loopback login server (server.rs: DEFAULT_PORT and
 * FALLBACK_PORT). We only bind when OpenAI's redirect will actually reach
 * this host — i.e. when the host runs on the same machine as the browser. */
const LOOPBACK_PORTS = [1455, 1457];

/** One sign-in per credential home at a time; turns are never blocked by this. */
const authenticatingHomes = new Set<string>();

type TokenSet = { id_token: string; access_token: string; refresh_token: string };

/** A one-shot loopback listener for OpenAI's redirect. `once` answers the
 * first request that the handler accepts: the handler returns the code, null
 * for a redirect the provider sent in error, or undefined for a request that
 * is not the redirect (keep listening). The listener closes itself after a
 * terminal answer; `close` stops it at any time. */
type Loopback = {
  port: number;
  once: (handler: (url: URL) => string | null | undefined) => Promise<string | null>;
  close: () => void;
};

export type CodexSignIn = {
  authenticated: boolean;
  email?: string;
  accountId?: string;
  /** "login" for a ChatGPT account, "api-key" for the key fallback. */
  method?: "login" | "api-key";
};

/** PKCE pair for the loopback authorization-code flow (RFC 7636, S256 like
 * the CLI's own login). The verifier never leaves this process except in
 * the token exchange itself. */
function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** The host name the auth server will see for loopback redirects. OpenAI's
 * clients use 127.0.0.1 — the literal loopback, never "localhost", so the
 * redirect cannot silently resolve to another family. */
function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/auth/callback`;
}

type StoredAuthFile = {
  OPENAI_API_KEY?: string | null;
  tokens?: { id_token?: string; access_token?: string; refresh_token?: string; account_id?: string };
  last_refresh?: string;
  email?: string;
  [key: string]: unknown;
};

/** The directory the Codex CLI calls home — CODEX_HOME, else ~/.codex. */
export function codexAuthDir(environment: Record<string, string | undefined>): string {
  const home = environment.HOME || environment.USERPROFILE || homedir();
  return resolve(environment.CODEX_HOME || join(home, ".codex"));
}

export function codexAuthPath(environment: Record<string, string | undefined>): string {
  return join(codexAuthDir(environment), "auth.json");
}

function readAuthFile(environment: Record<string, string | undefined>): StoredAuthFile | null {
  try {
    return JSON.parse(readFileSync(codexAuthPath(environment), "utf8")) as StoredAuthFile;
  } catch {
    return null;
  }
}

/** The sign-in state the CLI's own file carries, readable without the CLI. */
export function readCodexSignIn(environment: Record<string, string | undefined>): CodexSignIn {
  const file = readAuthFile(environment);
  if (!file) return { authenticated: false };
  const tokens = file.tokens;
  if (tokens?.access_token && tokens.id_token) {
    const email = jwtEmail(tokens.id_token) ?? (typeof file.email === "string" ? file.email : undefined);
    const accountId = typeof tokens.account_id === "string" && tokens.account_id ? tokens.account_id : codexAccountId(tokens.id_token, tokens.access_token);
    return { authenticated: true, method: "login", ...(email ? { email } : {}), ...(accountId ? { accountId } : {}) };
  }
  if (typeof file.OPENAI_API_KEY === "string" && file.OPENAI_API_KEY) {
    return { authenticated: true, method: "api-key" };
  }
  return { authenticated: false };
}

/** True when the file already carries a different sign-in method (an API key
 * without ChatGPT tokens): the device flow must not silently displace it. */
export function hasForeignSignIn(environment: Record<string, string | undefined>): boolean {
  const file = readAuthFile(environment);
  if (!file) return false;
  const hasTokens = Boolean(file.tokens?.access_token && file.tokens.id_token);
  return !hasTokens && typeof file.OPENAI_API_KEY === "string" && file.OPENAI_API_KEY.length > 0;
}

function writeAuthFile(environment: Record<string, string | undefined>, file: Record<string, unknown>): void {
  const dir = codexAuthDir(environment);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = codexAuthPath(environment);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* best-effort on platforms without modes */ }
  renameSync(tmp, target);
}

/** Persist a completed ChatGPT sign-in into the CLI's own file, preserving a
 * co-resident API key if one exists. */
export function writeCodexSignIn(
  environment: Record<string, string | undefined>,
  tokens: TokenSet,
  email: string | null,
  accountId: string | null,
): void {
  const existing = readAuthFile(environment) ?? {};
  const merged: StoredAuthFile = {
    ...existing,
    OPENAI_API_KEY: existing.OPENAI_API_KEY ?? null,
    tokens: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      ...(accountId ? { account_id: accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
    ...(email ? { email } : {}),
  };
  writeAuthFile(environment, merged);
}

/** Remove the ChatGPT tokens this flow stored. An API-key sign-in, if present,
 * is left alone; an auth file with nothing else legitimately left is deleted. */
export function clearCodexSignIn(environment: Record<string, string | undefined>): boolean {
  const path = codexAuthPath(environment);
  const file = readAuthFile(environment);
  if (!file) return false;
  const hadTokens = Boolean(file.tokens && (file.tokens.access_token || file.tokens.id_token || file.tokens.refresh_token));
  if (!hadTokens) return false;
  const { tokens: _tokens, last_refresh: _lastRefresh, email: _email, ...rest } = file;
  const remainsKey = typeof rest.OPENAI_API_KEY === "string" && rest.OPENAI_API_KEY.length > 0;
  if (remainsKey) writeAuthFile(environment, rest);
  else if (existsSync(path)) rmSync(path, { force: true });
  return true;
}

// ── JWT helpers: read the account identity OpenAI puts in its own tokens ──
function jwtClaims(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function nestedAuthClaim(claims: Record<string, unknown> | null): Record<string, unknown> | null {
  const auth = claims?.["https://api.openai.com/auth"];
  return auth && typeof auth === "object" && !Array.isArray(auth) ? auth as Record<string, unknown> : null;
}

/** Claim precedence matches the open clients: top-level chatgpt_account_id,
 * then the api.openai.com/auth block, then the first organization id. */
export function codexAccountId(idToken: string | undefined, accessToken?: string): string | null {
  for (const token of [idToken, accessToken]) {
    const claims = jwtClaims(token);
    const direct = claims?.chatgpt_account_id;
    if (typeof direct === "string" && direct) return direct;
    const nested = nestedAuthClaim(claims)?.chatgpt_account_id;
    if (typeof nested === "string" && nested) return nested;
    const organizations = claims?.organizations;
    if (Array.isArray(organizations)) {
      const first = organizations[0] as { id?: unknown } | undefined;
      if (first && typeof first.id === "string" && first.id) return first.id;
    }
  }
  return null;
}

export function jwtEmail(token: string | undefined): string | null {
  const claims = jwtClaims(token);
  const direct = claims?.email;
  if (typeof direct === "string" && direct) return direct;
  const profile = claims?.["https://api.openai.com/profile"];
  const profileEmail = profile && typeof profile === "object" ? (profile as { email?: unknown }).email : undefined;
  return typeof profileEmail === "string" && profileEmail ? profileEmail : null;
}

/** The access token's own expiry as epoch milliseconds, when it carries one. */
function jwtExpiryMs(token: string | undefined): number | null {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

/** The complete ChatGPT credential a runtime needs — the same tokens the CLI
 * reads from its own auth.json. Never logged or returned to a client. */
export type CodexCredential = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
  email: string | null;
  /** Epoch ms from the access token's `exp` claim; null when it has none. */
  expiresAtMs: number | null;
};

export function readCodexCredential(environment: Record<string, string | undefined>): CodexCredential | null {
  const file = readAuthFile(environment);
  const tokens = file?.tokens;
  if (!tokens?.access_token) return null;
  const fileEmail = file && typeof file.email === "string" && file.email ? file.email : null;
  const email = (tokens.id_token ? jwtEmail(tokens.id_token) : null) ?? fileEmail;
  const accountId = (typeof tokens.account_id === "string" && tokens.account_id
    ? tokens.account_id
    : codexAccountId(tokens.id_token, tokens.access_token)) ?? null;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
    accountId,
    email,
    expiresAtMs: jwtExpiryMs(tokens.access_token),
  };
}

/** True when the stored access token is expired, or expires within the skew —
 * the window where a refresh should run before the request is sent. */
export function codexCredentialExpired(credential: CodexCredential, skewMs = 120_000): boolean {
  return credential.expiresAtMs !== null && credential.expiresAtMs - skewMs <= Date.now();
}

/** One refresh per credential home at a time: two concurrent turns must not
 * rotate the same refresh token against each other. */
const refreshingHomes = new Map<string, Promise<CodexCredential | null>>();

/** Exchange the stored refresh token for a fresh access token, exactly as the
 * CLI's auth manager does (JSON token grant at the same endpoint and client
 * id), and persist the rotated tokens into auth.json. Resolves null when no
 * refresh token exists or OpenAI rejected the grant; the caller then reports
 * the runtime failure the credential's own state implies. */
export function refreshCodexCredential(
  environment: Record<string, string | undefined>,
  options: { transport?: typeof fetch; endpoint?: string; timeoutMs?: number } = {},
): Promise<CodexCredential | null> {
  const homeKey = codexAuthDir(environment);
  const inflight = refreshingHomes.get(homeKey);
  if (inflight) return inflight;
  const refresh = (async (): Promise<CodexCredential | null> => {
    const current = readCodexCredential(environment);
    if (!current?.refreshToken) return null;
    const body = JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    });
    let response: Response;
    try {
      response = await (options.transport ?? fetch)(options.endpoint ?? OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": UA },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    let payload: { id_token?: unknown; access_token?: unknown; refresh_token?: unknown } | null;
    try {
      payload = await response.json() as typeof payload;
    } catch {
      return null;
    }
    const accessToken = typeof payload?.access_token === "string" && payload.access_token ? payload.access_token : null;
    if (!accessToken) return null;
    const idToken = typeof payload?.id_token === "string" && payload.id_token ? payload.id_token : current.idToken;
    const refreshToken = typeof payload?.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : current.refreshToken;
    if (!idToken || !refreshToken) return null;
    const email = jwtEmail(idToken) ?? current.email;
    const accountId = codexAccountId(idToken, accessToken) ?? current.accountId;
    try {
      writeCodexSignIn(environment, { id_token: idToken, access_token: accessToken, refresh_token: refreshToken }, email, accountId);
    } catch {
      // A read-only home must not lose the fresh token in memory: the turn can
      // still proceed on it, and the next boot re-reads whatever is on disk.
    }
    return {
      accessToken,
      refreshToken,
      idToken,
      accountId,
      email,
      expiresAtMs: jwtExpiryMs(accessToken),
    };
  })().finally(() => { refreshingHomes.delete(homeKey); });
  refreshingHomes.set(homeKey, refresh);
  return refresh;
}

type Flow = {
  status: ProviderAuthenticationStatus;
  abort: AbortController;
  expiresAtMs: number;
  stopping: Promise<void> | null;
  homeKey: string;
  /** The loopback listener to close when the flow leaves the waiting phase. */
  loopback: Loopback | null;
};

export interface CodexNativeAuthOptions {
  environment: () => Record<string, string | undefined>;
  /** Injectable for tests; defaults to the global fetch. */
  transport?: typeof fetch;
  /** Endpoint overrides for tests, never for production behavior. */
  endpoints?: { userCode?: string; tokenPoll?: string; oauthToken?: string; devicePage?: string; authorize?: string };
  onAuthenticated?: () => Promise<void> | void;
  /** Total time the code stays valid. */
  lifetimeMs?: number;
  /** Fallback poll interval when OpenAI's response omits one. */
  pollIntervalMs?: number;
  /** Per-request HTTP timeout. */
  requestTimeoutMs?: number;
  /** Time allowed to obtain the first code. */
  readyTimeoutMs?: number;
  /** Injectable loopback listener factory for tests. Defaults to a real
   * TCP listener on the CLI's own ports. */
  listenLoopback?: (ports: number[]) => Promise<Loopback>;
  /** Force the loopback redirect flow regardless of the host marker; tests
   * use this, and a deployment that knows its browser is local can too. */
  preferLoopback?: boolean;
}

export class CodexNativeAuthController {
  private flow: Flow | null = null;
  private disposed = false;
  private readonly options: CodexNativeAuthOptions;

  constructor(options: CodexNativeAuthOptions) {
    this.options = options;
  }

  private get transport(): typeof fetch {
    return this.options.transport ?? fetch;
  }

  /** The sign-in shape this host offers: a browser redirect when the host
   * and the person's browser share a machine (the Android harness sets
   * OPENMAUSBOT_LOOPBACK_AUTH; a desktop may opt in), the device-code flow
   * otherwise — a server the browser cannot reach needs a code, not a
   * redirect to a loopback the browser will never hit. */
  declaredMethod(): "browser" | "device-code" {
    const local = this.options.preferLoopback === true ||
      this.options.environment().OPENMAUSBOT_LOOPBACK_AUTH === "1";
    return local ? "browser" : "device-code";
  }

  private endpoint(name: "userCode" | "tokenPoll" | "oauthToken" | "devicePage" | "authorize"): string {
    const defaults = {
      userCode: DEVICE_USERCODE_URL,
      tokenPoll: DEVICE_TOKEN_URL,
      oauthToken: OAUTH_TOKEN_URL,
      devicePage: CODEX_DEVICE_PAGE,
      authorize: OAUTH_AUTHORIZE_URL,
    } as const;
    return this.options.endpoints?.[name] ?? defaults[name];
  }

  async start(): Promise<ProviderAuthenticationStart> {
    if (this.disposed) throw new Error("This provider was removed. Refresh Settings before signing in.");
    if (this.flow) {
      if (this.flow.status.phase === "waiting") return { ...this.flow.status, phase: "waiting" };
      await this.flow.stopping;
    }
    if (this.disposed) throw new Error("This provider was removed. Refresh Settings before signing in.");
    const environment = this.options.environment();
    // The sign-in lives in the Codex home; refuse a home that is not usable
    // before asking OpenAI for a code the person would type for nothing.
    if (hasForeignSignIn(environment)) {
      throw new Error("Codex already has an API-key sign-in on this host. Remove that key first to use the ChatGPT account instead.");
    }
    const existing = readCodexSignIn(environment);
    if (existing.authenticated && existing.method === "login") {
      return {
        phase: "succeeded",
        flowId: null,
        authorizationUrl: null,
        expiresAt: null,
        userCode: undefined,
      };
    }
    const homeKey = codexAuthDir(environment);
    if (authenticatingHomes.has(homeKey)) {
      throw new Error("A ChatGPT sign-in is already running for this host account. Finish or cancel it before starting another.");
    }
    authenticatingHomes.add(homeKey);

    const lifetimeMs = this.options.lifetimeMs ?? 15 * 60_000;
    if (this.declaredMethod() === "browser") {
      const started = await this.startLoopbackFlow(environment, homeKey, lifetimeMs);
      if (started) return started;
      // The redirect cannot land on this host — no loopback port was
      // bindable — so fall back to the code the person can type anywhere.
    }
    return this.startDeviceFlow(environment, homeKey, lifetimeMs);
  }

  /** The browser-redirect sign-in: bind a loopback port, send the person to
   * OpenAI's own authorize page with PKCE, and let their browser come back
   * to this host — the same redirect the Codex CLI receives on a desktop.
   * Returns null only when no loopback port could be bound at all. */
  private async startLoopbackFlow(
    environment: Record<string, string | undefined>,
    homeKey: string,
    lifetimeMs: number,
  ): Promise<ProviderAuthenticationStart | null> {
    const loopback = await (this.options.listenLoopback ?? listenLoopbackOnce)(LOOPBACK_PORTS).catch(() => null);
    if (!loopback) return null;
    const abort = new AbortController();
    const flow: Flow = {
      status: {
        phase: "waiting",
        flowId: randomUUID(),
        authorizationUrl: null,
        expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
      },
      abort,
      expiresAtMs: Date.now() + lifetimeMs,
      stopping: null,
      homeKey,
      loopback,
    };
    this.flow = flow;
    try {
      const { verifier, challenge } = createPkcePair();
      // State ties the redirect to this exact flow; the browser only ever
      // sees it echoed back, and the exchange never starts without a match.
      const state = randomBytes(16).toString("base64url");
      const authorizeUrl = new URL(this.endpoint("authorize"));
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", CODEX_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", loopbackRedirectUri(loopback.port));
      authorizeUrl.searchParams.set("scope", OAUTH_SCOPES);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("state", state);
      // The extra parameters of the CLI's own simplified sign-in page.
      authorizeUrl.searchParams.set("id_token_add_organizations", "true");
      authorizeUrl.searchParams.set("codex_cli_simplified_flow", "true");
      authorizeUrl.searchParams.set("originator", "codex_cli_rs");
      flow.status = { ...flow.status, authorizationUrl: authorizeUrl.toString() };
      // The listener owns the rest of the flow's life; start() resolves now
      // with the URL the app opens in the browser.
      flow.stopping = this.awaitLoopbackCode(environment, flow, loopback, verifier, state).catch(() => {});
      return { ...flow.status, phase: "waiting" };
    } catch (error) {
      this.flow = null;
      authenticatingHomes.delete(homeKey);
      try { loopback.close(); } catch { /* already closed */ }
      throw error;
    }
  }

  /** Wait for OpenAI's redirect on the bound loopback port, then exchange
   * the authorization code. A redirect that does not match this flow's state
   * never reaches the exchange. */
  private async awaitLoopbackCode(
    environment: Record<string, string | undefined>,
    flow: Flow,
    loopback: Loopback,
    verifier: string,
    state: string,
  ): Promise<void> {
    let redirectProblem: string | null = null;
    const pending = loopback.once((url) => {
      if (url.pathname !== "/auth/callback") return undefined;
      const providerError = url.searchParams.get("error");
      if (providerError) {
        const description = url.searchParams.get("error_description");
        redirectProblem = /access_denied/i.test(providerError)
          ? "The sign-in was denied in the browser. Start sign-in again and approve access to continue."
          : description
            ? `The sign-in page reported: ${description}`
            : "The sign-in page reported an error. Start sign-in again.";
        return null;
      }
      if (url.searchParams.get("state") !== state) {
        redirectProblem = "The browser returned a response that does not belong to this sign-in. Start sign-in again.";
        return null;
      }
      const authorizationCode = url.searchParams.get("code");
      if (!authorizationCode) {
        redirectProblem = "The sign-in page returned without an authorization code. Start sign-in again.";
        return null;
      }
      return authorizationCode;
    }).catch(() => null);
    // The flow expires like the device code does; the abort signal ends the
    // wait the moment the person cancels.
    const code = await Promise.race([
      pending,
      this.sleep(Math.max(flow.expiresAtMs - Date.now(), 0), flow.abort.signal).then(() => null),
    ]);
    try { loopback.close(); } catch { /* already closed */ }
    if (flow.status.phase !== "waiting") return; // the handler or cancel() already finished it
    if (!code) {
      if (redirectProblem) this.finish(flow, "failed", redirectProblem);
      else this.finish(flow, "expired", "The ChatGPT sign-in timed out before the browser returned. Start sign-in again.");
      return;
    }
    await this.exchange(environment, flow, code, verifier, loopbackRedirectUri(loopback.port));
  }

  /** The headless fallback: OpenAI's own device-code login, for hosts whose
   * browser cannot reach them (a desktop controlling a phone over the wire). */
  private async startDeviceFlow(
    environment: Record<string, string | undefined>,
    homeKey: string,
    lifetimeMs: number,
  ): Promise<ProviderAuthenticationStart> {
    const abort = new AbortController();
    const flow: Flow = {
      status: {
        phase: "waiting",
        flowId: randomUUID(),
        authorizationUrl: this.endpoint("devicePage"),
        expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
      },
      abort,
      expiresAtMs: Date.now() + lifetimeMs,
      stopping: null,
      homeKey,
      loopback: null,
    };
    this.flow = flow;
    try {
      const code = await this.requestCode(abort.signal);
      if (this.flow !== flow || flow.status.phase !== "waiting") {
        throw new Error("ChatGPT sign-in cancelled.");
      }
      flow.status = { ...flow.status, userCode: code.userCode };
      // The poll loop owns the rest of the flow's life; start() resolves now
      // with the code the person needs.
      flow.stopping = this.poll(environment, flow, code).catch(() => {});
      return { ...flow.status, phase: "waiting" };
    } catch (error) {
      authenticatingHomes.delete(homeKey);
      this.flow = null;
      throw error;
    }
  }

  async get(flowId: string): Promise<ProviderAuthenticationStatus> {
    if (!flowId || this.flow?.status.flowId !== flowId) throw new Error("This sign-in is no longer available. Start sign-in again.");
    return { ...this.flow.status };
  }

  async cancel(): Promise<void> {
    const flow = this.flow;
    if (!flow) return;
    if (flow.status.phase === "waiting") {
      flow.status = { ...flow.status, phase: "cancelled", message: "ChatGPT sign-in cancelled." };
      flow.abort.abort();
      // Cancellation is a terminal state here; release the home and the
      // redirect listener now rather than waiting for a loop that was just
      // aborted to notice.
      authenticatingHomes.delete(flow.homeKey);
      try { flow.loopback?.close(); } catch { /* already closed */ }
    }
    await flow.stopping;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.cancel();
    this.flow = null;
  }

  /** Remove the ChatGPT sign-in stored for this host so a different account
   * can connect. A sign-in in progress is never pulled away underneath the
   * browser completing it. */
  async signOut(): Promise<void> {
    if (this.disposed) throw new Error("This provider was removed. Refresh Settings before signing out.");
    if (this.flow?.status.phase === "waiting") throw new Error("Finish or cancel the ChatGPT sign-in in progress before signing out.");
    await this.flow?.stopping;
    if (this.disposed) throw new Error("This provider was removed. Refresh Settings before signing out.");
    const environment = this.options.environment();
    const homeKey = codexAuthDir(environment);
    if (authenticatingHomes.has(homeKey)) {
      throw new Error("A ChatGPT sign-in is running for this host account. Finish or cancel it before signing out.");
    }
    if (!clearCodexSignIn(environment)) return;
  }

  private async requestCode(
    signal: AbortSignal,
  ): Promise<{ deviceAuthId: string; userCode: string; intervalMs: number }> {
    const response = await this.fetchJson(this.endpoint("userCode"), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
      signal,
    });
    if (response.status !== 200) {
      throw new Error(`OpenAI refused to start the device sign-in (HTTP ${response.status}). Check this host's connection and try again.`);
    }
    const body = response.json as { device_auth_id?: unknown; user_code?: unknown; interval?: unknown };
    const deviceAuthId = typeof body.device_auth_id === "string" ? body.device_auth_id : "";
    const userCode = typeof body.user_code === "string" ? body.user_code : "";
    if (!deviceAuthId || !userCode) {
      throw new Error("OpenAI's device sign-in answered without a code. Update OpenMausBot and try again.");
    }
    const seconds = typeof body.interval === "number" ? body.interval : Number.parseInt(String(body.interval ?? ""), 10);
    const intervalMs = Number.isFinite(seconds) && seconds > 0
      ? Math.min(Math.max(seconds, 2), 15) * 1000
      : this.options.pollIntervalMs ?? 5_000;
    return { deviceAuthId, userCode, intervalMs };
  }

  private async poll(
    environment: Record<string, string | undefined>,
    flow: Flow,
    code: { deviceAuthId: string; userCode: string; intervalMs: number },
  ): Promise<void> {
    let transientFailures = 0;
    while (flow.status.phase === "waiting") {
      if (Date.now() >= flow.expiresAtMs || flow.abort.signal.aborted) break;
      await this.sleep(code.intervalMs, flow.abort.signal);
      if (flow.status.phase !== "waiting") break;
      let poll: Awaited<ReturnType<typeof this.fetchJson>>;
      try {
        poll = await this.fetchJson(this.endpoint("tokenPoll"), {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": UA },
          body: JSON.stringify({ device_auth_id: code.deviceAuthId, user_code: code.userCode }),
          signal: flow.abort.signal,
        });
      } catch {
        if (flow.abort.signal.aborted) break;
        // A blip must not end a sign-in the person may still be approving.
        if (++transientFailures >= 3) {
          this.finish(flow, "failed", "OpenAI's sign-in poll could not be reached. Check this host's connection and start sign-in again.");
          return;
        }
        continue;
      }
      transientFailures = 0;
      if (poll.status === 200) {
        const body = poll.json as { authorization_code?: unknown; code_verifier?: unknown };
        const authorizationCode = typeof body.authorization_code === "string" ? body.authorization_code : "";
        if (!authorizationCode) {
          this.finish(flow, "failed", "OpenAI's sign-in answered without an authorization code. Start sign-in again.");
          return;
        }
        await this.exchange(environment, flow, authorizationCode, typeof body.code_verifier === "string" ? body.code_verifier : undefined);
        return;
      }
      // The pending spellings OpenAI uses while the browser side is open.
      if (poll.status === 403 || poll.status === 404) continue;
      const detail = typeof (poll.json as { error?: unknown })?.error === "string" ? String((poll.json as { error?: string }).error) : "";
      if (/device.{0,40}(disabled|not enabled|not allowed)|enable.{0,40}device/i.test(detail)) {
        this.finish(flow, "failed", "Enable device-code login in your ChatGPT security settings or ask your workspace admin to allow it, then try again.");
        return;
      }
      if (/expired|expiration|timed out/i.test(detail)) {
        this.finish(flow, "expired", "The ChatGPT sign-in code expired. Start sign-in again for a new code.");
        return;
      }
      this.finish(flow, "failed", `OpenAI answered the sign-in poll with HTTP ${poll.status}. Start sign-in again.`);
      return;
    }
    if (flow.status.phase === "waiting") {
      this.finish(flow, "expired", "The ChatGPT sign-in code expired. Start sign-in again for a new code.");
    }
  }

  private async exchange(
    environment: Record<string, string | undefined>,
    flow: Flow,
    authorizationCode: string,
    codeVerifier: string | undefined,
    redirectUri: string = DEVICE_REDIRECT_URI,
  ): Promise<void> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: redirectUri,
      client_id: CODEX_CLIENT_ID,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });
    const response = await this.fetchJson(this.endpoint("oauthToken"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: form.toString(),
      signal: flow.abort.signal,
    });
    if (response.status !== 200) {
      this.finish(flow, "failed", `OpenAI rejected the sign-in exchange (HTTP ${response.status}). Start sign-in again.`);
      return;
    }
    const body = response.json as { id_token?: unknown; access_token?: unknown; refresh_token?: unknown };
    const idToken = typeof body.id_token === "string" ? body.id_token : "";
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (!idToken || !accessToken || !refreshToken) {
      this.finish(flow, "failed", "OpenAI's sign-in exchange answered without a complete token set. Start sign-in again.");
      return;
    }
    const email = jwtEmail(idToken);
    const accountId = codexAccountId(idToken, accessToken);
    try {
      writeCodexSignIn(environment, { id_token: idToken, access_token: accessToken, refresh_token: refreshToken }, email, accountId);
    } catch (error) {
      this.finish(
        flow,
        "failed",
        `The ChatGPT sign-in succeeded but could not be saved on this host: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    flow.status = { ...flow.status, phase: "succeeded", authorizationUrl: null, expiresAt: null, userCode: undefined };
    authenticatingHomes.delete(flow.homeKey);
    await Promise.resolve(this.options.onAuthenticated?.()).catch(() => {});
  }

  private finish(flow: Flow, phase: "failed" | "expired" | "cancelled", message: string): void {
    if (flow.status.phase !== "waiting") return;
    flow.status = { ...flow.status, phase, message, authorizationUrl: null, expiresAt: null, userCode: undefined };
    authenticatingHomes.delete(flow.homeKey);
    try { flow.loopback?.close(); } catch { /* already closed */ }
  }

  /** One GET/POST with our own timeout on top of the flow's abort signal. */
  private async fetchJson(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
  ): Promise<{ status: number; json: unknown }> {
    const timeoutMs = this.options.requestTimeoutMs ?? 15_000;
    const signal = AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await this.transport(url, { ...init, signal });
    let json: unknown = null;
    try { json = await response.json(); } catch { /* an empty or non-JSON error body is fine */ }
    return { status: response.status, json };
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}

/** Bind the CLI's own loopback login port, falling back the way the CLI
 * does. Only loopback is bound: the redirect must never be answerable from
 * another machine. Resolves with a one-shot listener; every candidate port
 * is tried before giving up (rejecting is the caller's cue to use the
 * device-code flow). */
export async function listenLoopbackOnce(ports: readonly number[]): Promise<Loopback> {
  const server: Server = await new Promise((resolveServer, rejectServer) => {
    let lastError: unknown = null;
    const attempt = (index: number): void => {
      if (index >= ports.length) {
        rejectServer(lastError ?? new Error("No loopback port could be bound"));
        return;
      }
      const candidate = createServer();
      const onError = (error: Error): void => {
        candidate.close();
        lastError = error;
        attempt(index + 1);
      };
      candidate.once("error", onError);
      candidate.listen(ports[index], "127.0.0.1", () => {
        candidate.off("error", onError);
        // A late listen error (the port dying under us) must not crash the host.
        candidate.on("error", () => {});
        // The host's own lifetime governs the process; the listener must not
        // hold the event loop open by itself.
        candidate.unref();
        resolveServer(candidate);
      });
    };
    attempt(0);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    once(handler) {
      return new Promise<string | null>((resolveOnce) => {
        let settled = false;
        const settle = (result: string | null): void => {
          if (settled) return;
          settled = true;
          server.off("request", onRequest);
          resolveOnce(result);
          try { server.close(); } catch { /* closing twice is fine */ }
          try { server.closeAllConnections(); } catch { /* older Node: close() is enough */ }
        };
        const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
          let verdict: string | null | undefined;
          try {
            verdict = handler(url);
          } catch {
            verdict = null;
          }
          if (verdict === undefined) {
            // Not the redirect (a stray request to the root, say): keep listening.
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Not the sign-in redirect.\n");
            return;
          }
          const approved = verdict !== null;
          res.writeHead(approved ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
          res.end(landingPage(
            approved ? "Sign-in approved" : "Sign-in not completed",
            approved
              ? "You can close this page and return to the app."
              : "You can close this page and start sign-in again from the app.",
          ));
          settle(verdict);
        };
        server.on("request", onRequest);
      });
    },
    close() {
      try { server.close(); } catch { /* already closed */ }
      try { server.closeAllConnections(); } catch { /* older Node: close() is enough */ }
    },
  };
}

/** The page the person's browser lands on after the redirect. Plain, calm,
 * and free of anything the provider sent — especially query parameters. */
function landingPage(title: string, body: string): string {
  const esc = (text: string): string => text
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="max-width:28rem;text-align:center;padding:2rem">
<h1 style="font-size:1.25rem">${esc(title)}</h1>
<p style="color:#555">${esc(body)}</p>
</div></body></html>`;
}

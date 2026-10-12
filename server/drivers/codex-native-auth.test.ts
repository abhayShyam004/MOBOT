import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import {
  CODEX_DEVICE_PAGE,
  CodexNativeAuthController,
  clearCodexSignIn,
  codexAccountId,
  jwtEmail,
  readCodexSignIn,
} from "./codex-native-auth.ts";

// No process is ever spawned here: authentication is the provider's own
// device flow over HTTP. The transport is a scripted fake; a disposable
// CODEX_HOME holds the auth file. No network call, no CLI, no real account.

const FAKE_JWT = (payload: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

type Call = { url: string; body: string; headers: Record<string, string> };
type Reply = { status: number; body?: unknown };

/** A scripted transport: each endpoint pops the next reply, recording calls. */
function scriptedTransport(replies: { userCode?: Reply[]; poll?: Reply[]; token?: Reply[] }) {
  const calls: Call[] = [];
  const transport = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init.body ?? ""),
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const script = String(url).includes("deviceauth/usercode")
      ? replies.userCode
      : String(url).includes("deviceauth/token")
        ? replies.poll
        : replies.token;
    const reply = script?.shift() ?? { status: 599, body: { error: "no scripted reply" } };
    return {
      status: reply.status,
      json: async () => reply.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { transport, calls };
}

describe("CodexNativeAuthController", () => {
  let home: string;
  let environment: () => Record<string, string | undefined>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "omb-codex-native-"));
    environment = () => ({ HOME: home, CODEX_HOME: join(home, ".codex") });
  });

  afterEach(() => {
    removeTempDir(home);
  });

  // Fresh per test: the transport consumes (shift) its scripted replies.
  const happyReplies = () => ({
    userCode: [{ status: 200, body: { device_auth_id: "dev-1", user_code: "ABCD-1234" } }],
    poll: [{ status: 200, body: { authorization_code: "auth-code-1", code_verifier: "verifier-1" } }],
    token: [{
      status: 200,
      body: {
        id_token: FAKE_JWT({ email: "person@example.com", chatgpt_account_id: "acct-1" }),
        access_token: FAKE_JWT({ chatgpt_account_id: "acct-1" }),
        refresh_token: "refresh-1",
      },
    }],
  });

  it("runs the real device flow: code, poll, exchange, and the CLI's own auth file", async () => {
    const { transport, calls } = scriptedTransport(happyReplies());
    const onAuthenticated: number[] = [];
    const controller = new CodexNativeAuthController({
      environment,
      transport,
      pollIntervalMs: 5,
      onAuthenticated: () => { onAuthenticated.push(1); },
    });

    const start = await controller.start();
    expect(start.phase).toBe("waiting");
    expect(start.authorizationUrl).toBe(CODEX_DEVICE_PAGE);
    expect(start.userCode).toBe("ABCD-1234");

    // The poll loop settles asynchronously; wait briefly for the file.
    await expect.poll(() => existsSync(join(home, ".codex", "auth.json")), { timeout: 2_000 }).toBe(true);

    const status = await controller.get(start.flowId!);
    expect(status.phase).toBe("succeeded");
    expect(onAuthenticated.length).toBe(1);

    // The device request carries the public Codex client id as JSON.
    expect(JSON.parse(calls[0].body)).toEqual({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" });
    // The exchange is a form grant at OpenAI's token endpoint.
    const exchange = calls.find((call) => call.url.includes("/oauth/token"))!;
    const form = new URLSearchParams(exchange.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code-1");
    expect(form.get("code_verifier")).toBe("verifier-1");
    expect(form.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");

    // The stored file is the shape the unmodified Codex CLI reads.
    const stored = JSON.parse(readFileSync(join(home, ".codex", "auth.json"), "utf8"));
    expect(stored.tokens.access_token).toBeTruthy();
    expect(stored.tokens.refresh_token).toBe("refresh-1");
    expect(stored.tokens.account_id).toBe("acct-1");
    expect(typeof stored.last_refresh).toBe("string");
    expect(readCodexSignIn(environment())).toMatchObject({
      authenticated: true,
      method: "login",
      email: "person@example.com",
    });
    if (process.platform !== "win32") {
      expect(statSync(join(home, ".codex", "auth.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("treats 403 and 404 polls as pending, exactly as the provider spells them", async () => {
    const { transport } = scriptedTransport({
      ...happyReplies(),
      poll: [
        { status: 403, body: { error: "authorization_pending" } },
        { status: 404, body: { error: "authorization_pending" } },
        { status: 200, body: { authorization_code: "auth-code-1", code_verifier: "verifier-1" } },
      ],
    });
    const controller = new CodexNativeAuthController({ environment, transport, pollIntervalMs: 5 });
    const start = await controller.start();
    await expect.poll(async () => (await controller.get(start.flowId!)).phase, { timeout: 2_000 }).toBe("succeeded");
  });

  it("refuses to displace an existing API-key sign-in", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-existing" }));
    const { transport } = scriptedTransport(happyReplies());
    const controller = new CodexNativeAuthController({ environment, transport, pollIntervalMs: 5 });
    await expect(controller.start()).rejects.toThrow(/API-key sign-in/);
  });

  it("answers an already-signed-in host without asking for a new code", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({
      tokens: { id_token: FAKE_JWT({}), access_token: FAKE_JWT({}), refresh_token: "r" },
    }));
    const { transport, calls } = scriptedTransport({});
    const controller = new CodexNativeAuthController({ environment, transport, pollIntervalMs: 5 });
    const start = await controller.start();
    expect(start.phase).toBe("succeeded");
    expect(calls.length).toBe(0);
  });

  it("expires a code the person never approves", async () => {
    const { transport } = scriptedTransport({
      userCode: [{ status: 200, body: { device_auth_id: "dev-1", user_code: "ABCD-1234" } }],
      poll: Array.from({ length: 50 }, () => ({ status: 403, body: {} })),
    });
    const controller = new CodexNativeAuthController({
      environment,
      transport,
      pollIntervalMs: 5,
      lifetimeMs: 60,
    });
    const start = await controller.start();
    await expect.poll(async () => (await controller.get(start.flowId!)).phase, { timeout: 2_000 }).toBe("expired");
  });

  it("reports a refused start honestly instead of inventing a code", async () => {
    const { transport } = scriptedTransport({ userCode: [{ status: 429, body: {} }] });
    const controller = new CodexNativeAuthController({ environment, transport, pollIntervalMs: 5 });
    await expect(controller.start()).rejects.toThrow(/HTTP 429/);
  });

  it("signOut removes ChatGPT tokens, keeps an API key, and no-ops when signed out", () => {
    const path = join(home, ".codex", "auth.json");
    expect(clearCodexSignIn(environment())).toBe(false);

    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(path, JSON.stringify({
      tokens: { id_token: "i", access_token: "a", refresh_token: "r" },
      last_refresh: "then",
    }));
    expect(clearCodexSignIn(environment())).toBe(true);
    expect(existsSync(path)).toBe(false);

    writeFileSync(path, JSON.stringify({
      OPENAI_API_KEY: "sk-keep",
      tokens: { id_token: "i", access_token: "a", refresh_token: "r" },
    }));
    expect(clearCodexSignIn(environment())).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ OPENAI_API_KEY: "sk-keep" });
  });

  it("reads the account id with the open clients' claim precedence", () => {
    expect(codexAccountId(FAKE_JWT({ chatgpt_account_id: "top" }))).toBe("top");
    expect(codexAccountId(FAKE_JWT({ "https://api.openai.com/auth": { chatgpt_account_id: "nested" } }))).toBe("nested");
    expect(codexAccountId(FAKE_JWT({ organizations: [{ id: "org-1" }] }))).toBe("org-1");
    expect(codexAccountId("", FAKE_JWT({ chatgpt_account_id: "from-access" }))).toBe("from-access");
    expect(codexAccountId(FAKE_JWT({}))).toBeNull();
    expect(jwtEmail(FAKE_JWT({ email: "a@b.c" }))).toBe("a@b.c");
  });

  it("contains no process spawn at all — authentication cannot depend on the runtime", () => {
    // The pinned property of this module: the device flow is HTTP to the
    // provider's own endpoints. If a future edit reaches for a CLI to log in,
    // this fails before the phone ever shows a dead button again.
    const source = readFileSync(fileURLToPath(new URL("./codex-native-auth.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/child_process|spawnCli|execCli/);
  });

  // ── the loopback redirect flow: the browser lands back on this host ──

  /** A fake loopback listener: hands the test the authorize URL, then the
   * redirect when the test drives it. No TCP port is bound. */
  function fakeLoopback() {
    let deliver: ((url: URL) => Promise<string | null | undefined>) | null = null;
    let closed = false;
    const listener = {
      port: 1455,
      once: (handler: (url: URL) => string | null | undefined) => {
        deliver = async (url: URL) => handler(url);
        return new Promise<string | null>((resolve) => {
          // Delivered through drive(); resolves when the handler accepts.
          listener.resolve = resolve;
        });
      },
      close: () => { closed = true; },
      resolve: null as ((code: string | null) => void) | null,
      drive: async (search: string) => {
        if (!deliver) throw new Error("loopback not started");
        const verdict = await deliver(new URL(`http://127.0.0.1:1455${search}`));
        listener.resolve?.(verdict ?? null);
      },
      get closed() { return closed; },
    };
    return listener;
  }

  it("signs in through the browser redirect when the host and browser share a machine", async () => {
    const { transport, calls } = scriptedTransport(happyReplies());
    const loopback = fakeLoopback();
    const controller = new CodexNativeAuthController({
      environment,
      transport,
      preferLoopback: true,
      listenLoopback: async () => loopback,
    });

    const start = await controller.start();
    expect(start.phase).toBe("waiting");
    expect(start.userCode).toBeUndefined();
    expect(start.authorizationUrl).toBeTruthy();
    // The authorize URL is OpenAI's own, with the CLI's client id, PKCE, and
    // the loopback redirect this host bound.
    const authorize = new URL(start.authorizationUrl!);
    expect(authorize.origin + authorize.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorize.searchParams.get("scope")).toContain("offline_access");
    expect(authorize.searchParams.get("state")).toBeTruthy();

    // The browser comes back with the code; the exchange uses the loopback
    // redirect URI and the verifier that matches the challenge above.
    await loopback.drive("/auth/callback?code=auth-code-9&state=" + authorize.searchParams.get("state"));
    await expect.poll(async () => (await controller.get(start.flowId!)).phase, { timeout: 2_000 }).toBe("succeeded");
    expect(existsSync(join(home, ".codex", "auth.json"))).toBe(true);
    const exchange = calls.find((call) => call.url.includes("/oauth/token"))!;
    const form = new URLSearchParams(exchange.body);
    expect(form.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(form.get("code")).toBe("auth-code-9");
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(readCodexSignIn(environment())).toMatchObject({ authenticated: true, method: "login" });
    expect(loopback.closed).toBe(true);
  });

  it("rejects a redirect whose state does not match this flow", async () => {
    const { transport, calls } = scriptedTransport(happyReplies());
    const loopback = fakeLoopback();
    const controller = new CodexNativeAuthController({
      environment,
      transport,
      preferLoopback: true,
      listenLoopback: async () => loopback,
    });
    const start = await controller.start();
    await loopback.drive("/auth/callback?code=evil-1&state=tampered");
    await expect.poll(async () => (await controller.get(start.flowId!)).phase, { timeout: 2_000 }).toBe("failed");
    // A mismatched state never reaches the token endpoint.
    expect(calls.some((call) => call.url.includes("/oauth/token"))).toBe(false);
    expect(existsSync(join(home, ".codex", "auth.json"))).toBe(false);
  });

  it("falls back to the device flow when no loopback port can be bound", async () => {
    const { transport } = scriptedTransport(happyReplies());
    const controller = new CodexNativeAuthController({
      environment,
      transport,
      pollIntervalMs: 5,
      preferLoopback: true,
      listenLoopback: async () => { throw new Error("EADDRINUSE"); },
    });
    const start = await controller.start();
    expect(start.phase).toBe("waiting");
    expect(start.authorizationUrl).toBe(CODEX_DEVICE_PAGE);
    expect(start.userCode).toBe("ABCD-1234");
  });

  it("reports the browser flow only for a loopback host", () => {
    const { transport } = scriptedTransport({});
    const local = new CodexNativeAuthController({
      environment: () => ({ HOME: home, OPENMAUSBOT_LOOPBACK_AUTH: "1" }),
      transport,
    });
    const remote = new CodexNativeAuthController({ environment, transport });
    expect(local.declaredMethod()).toBe("browser");
    expect(remote.declaredMethod()).toBe("device-code");
  });
});

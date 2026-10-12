// The env boundary one MCP child may see (server/mcp-env.ts).
//
// The threat: a custom MCP server is third-party code the user pointed the
// harness at. Every credential the harness holds in process.env — provider
// keys, workspace tokens — must NOT ride along into that child, while a
// value the user explicitly configured in the server's own env block MUST
// arrive (that is the documented way to hand one server its credential).
// The same rule must hold on Android, where the harness process itself is
// started with a minimal controlled environment (HarnessHost.kt forwards
// only paths/ports), so a child inherits at most that controlled set.
import { afterEach, describe, expect, it } from "vitest";
import { PROVIDER_CREDENTIAL_ENV, WORKSPACE_CREDENTIAL_ENV } from "./config.ts";
import { mcpChildEnvironment } from "./mcp-env.ts";

const canary = "mcp-env-canary-9f3a2b";
const setKeys: string[] = [];

afterEach(() => {
  for (const key of setKeys.splice(0)) delete process.env[key];
});

function withEnv(key: string, value: string): void {
  process.env[key] = value;
  setKeys.push(key);
}

describe("mcpChildEnvironment", () => {
  it("strips every harness credential name from the inherited environment", () => {
    for (const key of [...WORKSPACE_CREDENTIAL_ENV, ...PROVIDER_CREDENTIAL_ENV]) {
      withEnv(key, `${canary}-${key}`);
    }
    const env = mcpChildEnvironment();
    for (const key of [...WORKSPACE_CREDENTIAL_ENV, ...PROVIDER_CREDENTIAL_ENV]) {
      expect(env[key]).toBeUndefined();
    }
    expect(Object.values(env)).not.toContain(canary);
  });

  it("keeps ordinary (non-credential) environment values", () => {
    withEnv("OMB_MCP_ENV_TEST_PLAIN", "harmless");
    const env = mcpChildEnvironment();
    expect(env.OMB_MCP_ENV_TEST_PLAIN).toBe("harmless");
  });

  it("lets the server's own configured env block win, including a deliberate credential name", () => {
    withEnv("OPENAI_API_KEY", canary);
    const env = mcpChildEnvironment({ OPENAI_API_KEY: "server-own-key" });
    expect(env.OPENAI_API_KEY).toBe("server-own-key");
    expect(env.OPENAI_API_KEY).not.toBe(canary);
  });

  it("never lets the inherited environment leak through an absent extra block", () => {
    withEnv("OPENAI_API_KEY", canary);
    withEnv("BOX_TOKEN", canary);
    const env = mcpChildEnvironment({});
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.BOX_TOKEN).toBeUndefined();
  });

  it("never copies an inherited value that is not a real string (undefined coercion guard)", () => {
    // Node keeps `process.env.X = undefined` as the literal string
    // "undefined" — a value that must not masquerade as a real setting.
    const key = "OMB_MCP_ENV_TEST_UNDEF";
    withEnv(key, undefined as unknown as string);
    const env = mcpChildEnvironment();
    expect(env[key]).not.toBe("undefined");
    expect(typeof env[key] === "string" ? env[key] : undefined).toBeUndefined();
  });

  // Android: the harness process env is the WHOLE inheritance chain a child
  // can see (there is no shell profile in between). These assertions pin the
  // controlled set HarnessHost.kt builds — if a future edit adds a
  // credential to that map, the child boundary would silently widen.
  describe("android controlled set", () => {
    const CONTROLLED = ["HOME", "TMPDIR", "LANG", "OPENSSL_CONF", "PATH", "LD_LIBRARY_PATH", "OMB_PORT", "OMB_WEBHOOK_PORT", "OMB_DATA_DIR", "AC_WORKSPACE", "OMB_STATIC_DIR"];

    it("contains no credential-shaped name", () => {
      for (const key of CONTROLLED) {
        expect([...WORKSPACE_CREDENTIAL_ENV, ...PROVIDER_CREDENTIAL_ENV]).not.toContain(key);
      }
    });

    it("is exactly what mcpChildEnvironment passes through when the harness env is the only source", () => {
      // Simulate the Android host env: clear everything, set only the
      // controlled keys, then verify the child sees precisely those.
      const saved = { ...process.env };
      try {
        for (const key of Object.keys(process.env)) delete process.env[key];
        for (const key of CONTROLLED) process.env[key] = `/controlled/${key.toLowerCase()}`;
        const env = mcpChildEnvironment();
        expect(Object.keys(env).sort()).toEqual([...CONTROLLED].sort());
      } finally {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    });
  });
});

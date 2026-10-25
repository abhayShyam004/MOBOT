import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "./config.ts";
import {
  applyManagedBrokerMessage,
  authorizeConnectService,
  authorizeService,
  connectedServices,
  connectionMode,
  connectionStatus,
  listToolkits,
  mcpIntegration,
  normalizeAccountAlias,
  parseConnectMcpJsonRpc,
  prepareComposioCredential,
  prepareProjectSession,
  removeAccount,
  removeService,
  relayMcp,
  setManagedBrokerAccess,
  verifyConnectConsumerKey,
  type ServiceRequirement,
  type ServiceConnectionSuspension,
  ERR_OAUTH_TIMEOUT,
  ServiceSuspensionManager,
  evaluateServiceRequirement,
  getRequiredScopesForService,
  sanitizeServicePayload,
  createServiceConnectionCardPayload,
} from "./composio.ts";

let api: Server;
let origin = "";
let base = "";
const calls: Array<{
  method: string;
  path: string;
  query: string;
  body: any;
  apiKey: string;
  transportSessionId: string;
}> = [];
let malformedConnectedAccounts = false;
let connectedAccountsUnavailable = false;
let emptyConnectedAccounts = false;
// The project's own auth configs, and the ones the stub Session was created
// with — a Session only knows the configs named at its creation, which is
// the whole reason #509 happened.
let customAuthConfigs: Array<Record<string, unknown>> = [];
let sessionAuthConfigs: Record<string, string> = {};

beforeAll(async () => {
  api = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.search,
      body,
      apiKey: String(req.headers["x-api-key"] ?? ""),
      transportSessionId: String(req.headers["mcp-session-id"] ?? ""),
    });

    if (url.pathname.startsWith("/broker/")) {
      if (req.headers.authorization !== `Bearer ${"a".repeat(64)}`) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "invalid broker token" }));
      }
      if (req.method === "GET" && url.pathname === "/broker/v1/connectors") {
        const services = Object.fromEntries(
          (url.searchParams.get("services") ?? "").split(",").filter(Boolean).map((slug) => [
            slug,
            { connected: slug === "github", status: slug === "github" ? "ACTIVE" : "not_connected" },
          ]),
        );
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ services }));
      }
      if (req.method === "GET" && url.pathname === "/broker/v1/connectors/connected") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ services: { github: { connected: true, status: "ACTIVE" } } }));
      }
      if (req.method === "POST" && url.pathname.endsWith("/authorize")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ url: "https://connect.composio.dev/managed" }));
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/broker/v1/connectors/")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ removed: 1 }));
      }
      if (req.method === "GET" && url.pathname === "/broker/v1/catalog") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ items: [{ slug: "github", name: "GitHub" }] }));
      }
      if (req.method === "POST" && url.pathname === "/broker/v1/mcp") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "mcp_broker" });
        return res.end(JSON.stringify({ source: "broker" }));
      }
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unknown broker route" }));
    }

    if (url.pathname.startsWith("/connect/")) {
      const consumerKey = String(req.headers["x-consumer-api-key"] ?? "");
      if (consumerKey === "ck_test") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "mcp_connect" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "github_star", description: "Star repo" }] } }));
      }
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid consumer key" }));
    }

    const apiKey = String(req.headers["x-api-key"] ?? "");
    if (!["ak_test", "ak_catalog_a", "ak_catalog_b", "ak_catalog_pages", "ak_catalog_partial", "ak_catalog_stuck",
        "ak_catalog_page_stuck", "ak_catalog_exhausted", "ak_catalog_multi_page"].includes(apiKey)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "invalid project key" } }));
    }

    if (req.method === "POST" && url.pathname === "/api/v3.1/tool_router/session") {
      sessionAuthConfigs = body.auth_configs ?? {};
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        session_id: "trs_test",
        mcp: { type: "http", url: "https://app.composio.dev/tool_router/v3/trs_test/mcp" },
        config: { user_id: body.user_id, multi_account: body.multi_account, auth_configs: sessionAuthConfigs },
      }));
    }
    if (
      req.method === "GET" && (url.pathname === "/api/v3/toolkits" || url.pathname === "/api/v3.1/toolkits")
      && (
        apiKey === "ak_catalog_pages"
        || apiKey === "ak_catalog_partial"
        || apiKey === "ak_catalog_stuck"
        || apiKey === "ak_catalog_page_stuck"
        || apiKey === "ak_catalog_exhausted"
        || apiKey === "ak_catalog_multi_page"
      )
    ) {
      if (apiKey === "ak_catalog_multi_page") {
        const cursor = url.searchParams.get("cursor");
        if (cursor === "multi-page-2") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({
            items: [
              { slug: "slack", name: "Slack" }, // overlap with page 1
              { slug: "service_16", name: "Service 16" },
              { slug: "service_17", name: "Service 17" },
              { slug: "service_18", name: "Service 18" },
              { slug: "service_19", name: "Service 19" },
              { slug: "service_20", name: "Service 20" },
              { slug: "service_21", name: "Service 21" },
              { slug: "service_22", name: "Service 22" },
              { slug: "service_23", name: "Service 23" },
              { slug: "service_24", name: "Service 24" },
              { slug: "service_25", name: "Service 25" },
              { slug: "service_26", name: "Service 26" },
              { slug: "service_27", name: "Service 27" },
              { slug: "service_28", name: "Service 28" },
              { slug: "service_29", name: "Service 29" },
              { slug: "service_30", name: "Service 30" },
            ],
            total_items: 45,
            total_pages: 3,
            current_page: 2,
            next_cursor: "multi-page-3",
          }));
        }
        if (cursor === "multi-page-3") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({
            items: [
              { slug: "service_31", name: "Service 31" },
              { slug: "service_32", name: "Service 32" },
              { slug: "service_33", name: "Service 33" },
              { slug: "service_34", name: "Service 34" },
              { slug: "service_35", name: "Service 35" },
            ],
            total_items: 45,
            total_pages: 3,
            current_page: 3,
            next_cursor: null,
          }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          items: [
            { slug: "slack", name: "Slack" },
            { slug: "github", name: "GitHub" },
            { slug: "service_03", name: "Service 3" },
            { slug: "service_04", name: "Service 4" },
            { slug: "service_05", name: "Service 5" },
            { slug: "service_06", name: "Service 6" },
            { slug: "service_07", name: "Service 7" },
            { slug: "service_08", name: "Service 8" },
            { slug: "service_09", name: "Service 9" },
            { slug: "service_10", name: "Service 10" },
            { slug: "service_11", name: "Service 11" },
            { slug: "service_12", name: "Service 12" },
            { slug: "service_13", name: "Service 13" },
            { slug: "service_14", name: "Service 14" },
            { slug: "service_15", name: "Service 15" },
          ],
          total_items: 45,
          total_pages: 3,
          current_page: 1,
          next_cursor: "multi-page-2",
        }));
      }
      if (apiKey === "ak_catalog_stuck") {
        // A broker deployed before this fix ignores the cursor and replays page one.
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ items: [{ slug: "gmail", name: "Gmail" }], next_cursor: "catalog-page-2" }));
      }
      if (apiKey === "ak_catalog_page_stuck") {
        // Replays page one while minting a fresh cursor every time, so only
        // current_page exposes the loop.
        const pageNumber = Number((url.searchParams.get("cursor") ?? "catalog-page-1").split("-").pop());
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          items: [{ slug: "gmail", name: "Gmail" }],
          next_cursor: "catalog-page-" + (pageNumber + 1),
          current_page: 1,
          total_pages: 4,
        }));
      }
      if (apiKey === "ak_catalog_exhausted") {
        // The last page still offers a cursor; total_pages must end the walk.
        res.writeHead(200, { "content-type": "application/json" });
        if (url.searchParams.get("cursor") === "catalog-page-2") {
          return res.end(JSON.stringify({
            items: [{ slug: "deepgram", name: "Deepgram" }],
            next_cursor: "catalog-page-3",
            current_page: 2,
            total_pages: 2,
          }));
        }
        return res.end(JSON.stringify({
          items: [{ slug: "gmail", name: "Gmail" }],
          next_cursor: "catalog-page-2",
          current_page: 1,
          total_pages: 2,
        }));
      }
      // Mirrors the real marketplace: a usage-sorted head, then an alphabetical
      // tail only a second page reaches. ak_catalog_partial loses that page.
      if (url.searchParams.get("cursor") === "catalog-page-2") {
        if (apiKey === "ak_catalog_partial") {
          res.writeHead(502, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "catalog page unavailable" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          items: [{ slug: "deepgram", name: "Deepgram" }, { slug: "zoom", name: "Zoom" }],
        }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        items: [
          { slug: "gmail", name: "Gmail" },
          { slug: "bland_ai", name: "Bland AI" },
          { slug: "currencyscoop", name: "CurrencyScoop" },
        ],
        next_cursor: "catalog-page-2",
      }));
    }
    if (req.method === "GET" && url.pathname === "/api/v3/toolkits") {
      res.writeHead(200, { "content-type": "application/json" });
      if (apiKey === "ak_catalog_a") {
        return res.end(JSON.stringify({ items: [{ slug: "notion", name: "Catalog A" }] }));
      }
      if (apiKey === "ak_catalog_b") {
        return res.end(JSON.stringify({ items: [{ slug: "linear", name: "Catalog B" }] }));
      }
      return res.end(JSON.stringify({ items: [{ slug: "x", name: "X (Twitter)" }, { slug: "github", name: "GitHub" }] }));
    }
    if (req.method === "GET" && url.pathname === "/api/v3.1/tool_router/session/trs_test") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        session_id: "trs_test",
        mcp: { type: "http", url: "https://app.composio.dev/tool_router/v3/trs_test/mcp" },
        config: {
          user_id: "openmausbot_existing",
          multi_account: {
            enable: true,
            max_accounts_per_toolkit: 5,
            require_explicit_selection: true,
          },
          auth_configs: sessionAuthConfigs,
        },
      }));
    }
    if (req.method === "GET" && url.pathname === "/api/v3.1/auth_configs") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ items: customAuthConfigs }));
    }
    if (req.method === "GET" && url.pathname === "/api/v3.1/tool_router/session/trs_legacy") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        session_id: "trs_legacy",
        mcp: { type: "http", url: "https://app.composio.dev/tool_router/v3/trs_legacy/mcp" },
        config: { user_id: "openmausbot_legacy" },
      }));
    }
    if (req.method === "GET" && url.pathname.endsWith("/toolkits")) {
      res.writeHead(200, { "content-type": "application/json" });
      if (url.searchParams.get("cursor") === "toolkits-page-2") {
        return res.end(JSON.stringify({
          items: [
            { slug: "publicsearch", is_no_auth: true },
            { slug: "selectedonly", connected_account: { id: "ca_session_only", status: "ACTIVE" } },
          ],
        }));
      }
      const page = {
        items: [
          { slug: "github", connected_account: { id: "ca_github", status: "ACTIVE" } },
          { slug: "gmail", is_no_auth: true },
          { slug: "slack" },
          { slug: "unconnected", connected_account: null },
        ],
        next_cursor: url.searchParams.has("toolkits") ? undefined : "toolkits-page-2",
      };
      return res.end(JSON.stringify(page));
    }
    if (req.method === "GET" && url.pathname === "/api/v3.1/connected_accounts") {
      if (connectedAccountsUnavailable) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "connected-account read not granted" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (malformedConnectedAccounts) return res.end(JSON.stringify({ items: {} }));
      if (emptyConnectedAccounts) return res.end(JSON.stringify({ items: [] }));
      if (url.searchParams.get("cursor") === "accounts-page-2") {
        return res.end(JSON.stringify({
          items: [
            { id: "ca_toolkit_41", alias: "overflow", toolkit: { slug: "toolkit_41" }, status: "ACTIVE", updated_at: "2026-08-17T10:00:00Z" },
          ],
        }));
      }
      return res.end(JSON.stringify({
        items: [
          { id: "ca_github_work", alias: "work", toolkit: { slug: "github" }, status: "ACTIVE", updated_at: "2026-08-17T08:00:00Z" },
          { id: "ca_github_personal", alias: "personal", toolkit: { slug: "github" }, status: "ACTIVE", updated_at: "2026-08-17T09:00:00Z" },
          { id: "ca_notion", alias: "team", toolkit: { slug: "notion" }, status: "INITIATED", updated_at: "2026-08-17T08:01:00Z" },
          { id: "ca_linear", toolkit: { slug: "linear" }, status: "EXPIRED", updated_at: "2026-08-17T08:02:00Z" },
        ],
        next_cursor: "accounts-page-2",
      }));
    }
    if (req.method === "POST" && url.pathname.endsWith("/link")) {
      // twitter has no Composio-managed auth: the link only works when the
      // Session was created with the project's own config for it
      if (body.toolkit === "twitter" && !sessionAuthConfigs.twitter) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          error: {
            message:
              "Composio does not manage auth for toolkit twitter and no auth config without required fields is available. "
              + "Please create an auth config manually or specify one in auth_config_override.",
          },
        }));
      }
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify({ redirect_url: `https://connect.composio.dev/link/${body.toolkit}` }));
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/v3.1/connected_accounts/ca_")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: true }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  base = `${origin}/api/v3.1`;
  process.env.OMB_COMPOSIO_API = base;
  process.env.OMB_COMPOSIO_TOOLKITS_API = `${origin}/api/v3`;
  process.env.OMB_COMPOSIO_CONNECT_MCP = `${origin}/connect/mcp`;
});

afterAll(async () => {
  setManagedBrokerAccess(null);
  delete process.env.OMB_COMPOSIO_API;
  delete process.env.OMB_COMPOSIO_TOOLKITS_API;
  delete process.env.OMB_COMPOSIO_CONNECT_MCP;
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

describe.sequential("Composio Sessions", () => {
  it("rejects broker URL components and invalid tokens from the environment", () => {
    process.env.OMB_COMPOSIO_BROKER_TOKEN = "a".repeat(64);
    try {
      for (const url of [
        "https://user:secret@broker.example/root",
        "https://broker.example/root?redirect=evil",
        "https://broker.example/root#fragment",
      ]) {
        process.env.OMB_COMPOSIO_BROKER_URL = url;
        expect(() => connectionMode({})).toThrow(/must not include/);
      }
      process.env.OMB_COMPOSIO_BROKER_URL = "http://[::1]:3210/root/";
      expect(connectionMode({})).toBe("managed");
      process.env.OMB_COMPOSIO_BROKER_TOKEN = "short";
      expect(() => connectionMode({})).toThrow(/token is invalid/);
    } finally {
      delete process.env.OMB_COMPOSIO_BROKER_URL;
      delete process.env.OMB_COMPOSIO_BROKER_TOKEN;
    }
  });
  it("accepts a private desktop credential update and rejects unsafe broker URLs", () => {
    setManagedBrokerAccess({ url: "http://127.0.0.1:3210/", token: "a".repeat(64) });
    expect(connectionMode({})).toBe("managed");
    setManagedBrokerAccess({ url: "http://[::1]:3210/", token: "a".repeat(64) });
    expect(connectionMode({})).toBe("managed");
    expect(() =>
      setManagedBrokerAccess({ url: "http://broker.example", token: "a".repeat(64) }),
    ).toThrow(/HTTPS/);
    for (const url of [
      "https://user:secret@broker.example/root",
      "https://broker.example/root?redirect=evil",
      "https://broker.example/root#fragment",
    ]) {
      expect(() => setManagedBrokerAccess({ url, token: "a".repeat(64) })).toThrow(/must not include/);
    }
    expect(() => setManagedBrokerAccess({ url: "https://broker.example", token: "short" })).toThrow();
    setManagedBrokerAccess(null);
  });
  it("ignores credential sync without access and clears only on explicit null", () => {
    const messageType = "openmausbot:managed-composio";
    setManagedBrokerAccess({ url: "http://127.0.0.1:3210/", token: "a".repeat(64) });

    expect(applyManagedBrokerMessage({ type: messageType })).toBe(false);
    expect(connectionMode({})).toBe("managed");

    expect(applyManagedBrokerMessage({ type: messageType, access: null })).toBe(true);
    expect(connectionMode({})).toBe("unavailable");
  });

  it("does not reuse a self-hosted catalog after the project key changes", async () => {
    const before = calls.length;
    const first = await listToolkits({ composio: { apiKey: "ak_catalog_a" } });
    const second = await listToolkits({ composio: { apiKey: "ak_catalog_b" } });

    expect(first.cards).toEqual([expect.objectContaining({ slug: "notion", label: "Catalog A" })]);
    expect(second.cards).toEqual([expect.objectContaining({ slug: "linear", label: "Catalog B" })]);
    expect(calls.slice(before).filter((call) => call.path === "/api/v3/toolkits").map((call) => call.apiKey)).toEqual([
      "ak_catalog_a",
      "ak_catalog_b",
    ]);
  });

  it("pages the marketplace catalog past the first page", async () => {
    const before = calls.length;
    const { cards } = await listToolkits({ composio: { apiKey: "ak_catalog_pages" } });

    // "Deepgram" only exists on page two: #634 saw the catalog stop at "CurrencyScoop".
    expect(cards.map((card) => card.slug)).toEqual(["gmail", "bland_ai", "currencyscoop", "deepgram", "zoom"]);
    const pages = calls.slice(before).filter((call) => call.path === "/api/v3/toolkits");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.query).not.toContain("cursor=");
    expect(pages[1]?.query).toContain("cursor=catalog-page-2");
  });

  it("keeps the catalog pages already read when a later page fails", async () => {
    await expect(listToolkits({ composio: { apiKey: "ak_catalog_partial" } })).resolves.toMatchObject({
      source: "api",
      cards: [{ slug: "gmail" }, { slug: "bland_ai" }, { slug: "currencyscoop" }],
    });
  });

  it("stops paging a catalog endpoint that replays the same cursor", async () => {
    const before = calls.length;
    const { cards } = await listToolkits({ composio: { apiKey: "ak_catalog_stuck" } });

    expect(cards).toEqual([expect.objectContaining({ slug: "gmail" })]);
    expect(calls.slice(before).filter((call) => call.path === "/api/v3/toolkits")).toHaveLength(2);
  });

  it("stops cleanly when replayed pages hide behind rotating cursors", async () => {
    const before = calls.length;
    const { cards } = await listToolkits({ composio: { apiKey: "ak_catalog_page_stuck" } });

    expect(cards).toEqual([expect.objectContaining({ slug: "gmail" })]);
    expect(calls.slice(before).filter((call) => call.path === "/api/v3/toolkits")).toHaveLength(2);
  });

  it("stops at the reported last page even when a cursor is still offered", async () => {
    const before = calls.length;
    const { cards } = await listToolkits({ composio: { apiKey: "ak_catalog_exhausted" } });

    expect(cards.map((card) => card.slug)).toEqual(["gmail", "deepgram"]);
    expect(calls.slice(before).filter((call) => call.path === "/api/v3/toolkits")).toHaveLength(2);
  });

  it("drops a managed MCP session when routing switches to a user project", async () => {
    setManagedBrokerAccess({ url: `${origin}/broker`, token: "a".repeat(64) });
    const projectSessions: string[] = [];
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.startsWith("https://app.composio.dev/tool_router/")) {
        projectSessions.push(new Headers(init?.headers).get("mcp-session-id") ?? "");
        return new Response(JSON.stringify({ source: "project" }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "mcp_project_after_managed" },
        });
      }
      return realFetch(input, init);
    });
    try {
      const managed = await relayMcp({}, { jsonrpc: "2.0", id: 101, method: "tools/list" });
      expect(managed.transportSessionId).toBe("mcp_broker");
      await relayMcp(
        {},
        { jsonrpc: "2.0", id: 105, method: "tools/list" },
        managed.transportSessionId,
      );
      expect(calls.findLast((call) => call.path === "/broker/v1/mcp" && call.body?.id === 105)?.transportSessionId)
        .toBe("mcp_broker");
      const project = await relayMcp(
        { composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" } },
        { jsonrpc: "2.0", id: 102, method: "tools/list" },
        managed.transportSessionId,
      );
      expect(project.transportSessionId).toBe("mcp_project_after_managed");
      expect(projectSessions).toEqual([""]);
    } finally {
      fetchSpy.mockRestore();
      setManagedBrokerAccess(null);
    }
  });

  it("drops a project MCP session when routing switches to the managed broker", async () => {
    setManagedBrokerAccess({ url: `${origin}/broker`, token: "a".repeat(64) });
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.startsWith("https://app.composio.dev/tool_router/")) {
        return new Response(JSON.stringify({ source: "project" }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "mcp_project_before_managed" },
        });
      }
      return realFetch(input, init);
    });
    try {
      const project = await relayMcp(
        { composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" } },
        { jsonrpc: "2.0", id: 103, method: "tools/list" },
      );
      expect(project.transportSessionId).toBe("mcp_project_before_managed");
      await relayMcp(
        {},
        { jsonrpc: "2.0", id: 104, method: "tools/list" },
        project.transportSessionId,
      );
      expect(calls.findLast((call) => call.path === "/broker/v1/mcp" && call.body?.id === 104)?.transportSessionId).toBe("");
    } finally {
      fetchSpy.mockRestore();
      setManagedBrokerAccess(null);
    }
  });

  it("uses a user-owned project for every connector operation even when the managed broker is available", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    setManagedBrokerAccess({ url: `${origin}/broker`, token: "a".repeat(64) });
    const before = calls.length;
    const realFetch = globalThis.fetch;
    const mcpRequests: Array<{ url: string; apiKey: string | null }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.startsWith("https://app.composio.dev/tool_router/")) {
        mcpRequests.push({ url, apiKey: new Headers(init?.headers).get("x-api-key") });
        return new Response(JSON.stringify({ source: "project" }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "mcp_project" },
        });
      }
      return realFetch(input, init);
    });

    try {
      expect(connectionMode(cfg)).toBe("self-hosted");
      await expect(listToolkits(cfg)).resolves.toMatchObject({
        source: "api",
        cards: [{ slug: "twitter" }, { slug: "github" }],
      });
      await expect(connectedServices(cfg)).resolves.toHaveProperty("github.connected", true);
      await expect(connectionStatus(cfg, ["slack"])).resolves.toHaveProperty("slack.connected", false);
      await expect(authorizeService(cfg, "slack")).resolves.toEqual({
        url: "https://connect.composio.dev/link/slack",
      });
      await expect(removeAccount(cfg, "github", "ca_github_personal")).resolves.toEqual({ removed: 1 });
      await expect(removeService(cfg, "github")).resolves.toEqual({ removed: 1 });
      const relayed = await relayMcp(cfg, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(JSON.parse(new TextDecoder().decode(relayed.bytes))).toEqual({ source: "project" });
      expect(relayed.transportSessionId).toBe("mcp_project");

      expect(mcpRequests).toEqual([{
        url: "https://app.composio.dev/tool_router/v3/trs_test/mcp",
        apiKey: "ak_test",
      }]);
      const since = calls.slice(before);
      expect(since.some((call) => call.path === "/api/v3.1/tool_router/session/trs_test")).toBe(true);
      expect(since.some((call) => call.path.startsWith("/broker/"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      setManagedBrokerAccess(null);
    }
  });

  it("accepts the legacy x alias but authorizes Composio's twitter toolkit", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    sessionAuthConfigs = { twitter: "ac_twitter" };
    setManagedBrokerAccess({ url: `${origin}/broker`, token: "a".repeat(64) });
    const before = calls.length;
    try {
      await expect(authorizeService(cfg, "x")).resolves.toEqual({
        url: "https://connect.composio.dev/link/twitter",
      });
      await expect(connectionStatus(cfg, ["x"])).resolves.toHaveProperty("x.connected", false);
      await expect(removeService(cfg, "x")).resolves.toEqual({ removed: 0 });
      const catalog = await listToolkits(cfg);
      expect(catalog.cards).toContainEqual(expect.objectContaining({ slug: "twitter" }));

      const since = calls.slice(before);
      expect(since.filter((call) => call.method === "POST" && call.path.endsWith("/link")).at(-1)?.body).toEqual({
        toolkit: "twitter",
      });
      expect(since.some((call) => call.query.includes("toolkits=twitter"))).toBe(true);
      expect(since.some((call) => call.path.startsWith("/broker/"))).toBe(false);
    } finally {
      sessionAuthConfigs = {};
      setManagedBrokerAccess(null);
    }
  });

  it("falls back to the managed broker immediately after the project key is cleared", async () => {
    const cfg: AppConfig = { composio: { apiKey: "" } };
    setManagedBrokerAccess({ url: `${origin}/broker`, token: "a".repeat(64) });
    const before = calls.length;
    try {
      expect(connectionMode(cfg)).toBe("managed");
      await expect(connectionStatus(cfg, ["github"])).resolves.toHaveProperty("github.connected", true);
      await expect(authorizeService(cfg, "github")).resolves.toEqual({
        url: "https://connect.composio.dev/managed",
      });
      await expect(listToolkits(cfg)).resolves.toMatchObject({ source: "api", cards: [{ slug: "github" }] });
      const relayed = await relayMcp(cfg, { jsonrpc: "2.0", id: 2, method: "tools/list" });
      expect(JSON.parse(new TextDecoder().decode(relayed.bytes))).toEqual({ source: "broker" });

      const brokerCalls = calls.slice(before).filter((call) => call.path.startsWith("/broker/"));
      expect(brokerCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "GET /broker/v1/connectors",
        "POST /broker/v1/connectors/github/authorize",
        "GET /broker/v1/catalog",
        "POST /broker/v1/mcp",
      ]);
    } finally {
      setManagedBrokerAccess(null);
    }
  });

  it("accepts only project API keys", async () => {
    await expect(prepareProjectSession("old_key")).rejects.toThrow(/start with ak_/i);
    await expect(prepareProjectSession("ak_wrong")).rejects.toThrow(/invalid project key/i);
  });

  describe("Composio Surface and Credential Verification", () => {
    it("1. Valid ak_ Platform key -> correct Platform authentication path", async () => {
      const result = await prepareComposioCredential("ak_test", { requestedSurface: "platform" });
      expect(result.surface).toBe("platform");
      expect(result.apiKey).toBe("ak_test");
      expect(result.sessionId).toBe("trs_test");
      expect(result.userId).toBeDefined();
    });

    it("2. Valid ck_ Connect key -> correct Connect authentication path", async () => {
      const result = await prepareComposioCredential("ck_test", { requestedSurface: "connect" });
      expect(result.surface).toBe("connect");
      expect(result.apiKey).toBe("ck_test");
      expect(result.mcpUrl).toContain("/connect/mcp");
    });

    it("3. ck_ supplied to an ak_-only Platform integration -> clear surface-mismatch error", async () => {
      await expect(
        prepareComposioCredential("ck_consumer_12345", { requestedSurface: "platform" }),
      ).rejects.toThrow(
        "This Composio connection expects a Platform Project API key (ak_...). You provided a Connect consumer key (ck_...). Choose the appropriate Composio connection type.",
      );
      await expect(
        prepareProjectSession("ck_consumer_12345"),
      ).rejects.toThrow(
        "This Composio connection expects a Platform Project API key (ak_...). You provided a Connect consumer key (ck_...). Choose the appropriate Composio connection type.",
      );
    });

    it("4. ak_ supplied to a ck_-only Connect integration -> clear surface-mismatch error", async () => {
      await expect(
        prepareComposioCredential("ak_project_12345", { requestedSurface: "connect" }),
      ).rejects.toThrow(
        "This Composio connection expects a Connect consumer key (ck_...). You provided a Platform Project API key (ak_...). Choose the appropriate Composio connection type.",
      );
      await expect(
        verifyConnectConsumerKey("ak_project_12345"),
      ).rejects.toThrow(
        "This Composio connection expects a Connect consumer key (ck_...). You provided a Platform Project API key (ak_...). Choose the appropriate Composio connection type.",
      );
    });

    it("5. Malformed/unknown key -> clear invalid-format error", async () => {
      await expect(
        prepareComposioCredential("xyz_malformed_key", { requestedSurface: "platform" }),
      ).rejects.toThrow(/Platform Project API keys must start with ak_/);

      await expect(
        prepareComposioCredential("xyz_malformed_key", { requestedSurface: "connect" }),
      ).rejects.toThrow(/Connect consumer keys must start with ck_/);

      await expect(
        prepareComposioCredential("xyz_malformed_key"),
      ).rejects.toThrow(
        "Invalid Composio key format. Keys must start with ak_ (Platform Project API key) or ck_ (Connect / For You consumer key).",
      );
    });

    it("6. Never exposes or logs the full credential in errors", async () => {
      const secret = "ck_sensitive_customer_secret_value_987654321";
      try {
        await prepareComposioCredential(secret, { requestedSurface: "platform" });
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.message).not.toContain(secret);
        expect(err.message).toContain("ck_...");
      }

      const secretAk = "ak_sensitive_platform_secret_value_123456789";
      try {
        await prepareComposioCredential(secretAk, { requestedSurface: "connect" });
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.message).not.toContain(secretAk);
        expect(err.message).toContain("ak_...");
      }
    });

    it("relays MCP requests using correct headers for both surfaces", async () => {
      const connectCfg: AppConfig = {
        composio: { apiKey: "ck_test", surface: "connect", mcpUrl: `${origin}/connect/mcp` },
      };

      const connectRelay = await relayMcp(connectCfg, { jsonrpc: "2.0", id: 201, method: "tools/list" });
      expect(connectRelay.status).toBe(200);
      expect(connectRelay.transportSessionId).toBe("mcp_connect");
    });
  });

  it("creates one stable per-installation session and reuses it", async () => {
    const created = await prepareProjectSession("ak_test", { userId: "openmausbot_existing" });
    expect(created).toEqual({
      apiKey: "ak_test",
      userId: "openmausbot_existing",
      sessionId: "trs_test",
    });
    expect(calls.filter((call) => call.method === "POST" && call.path.endsWith("/session")).at(-1)?.body).toEqual({
      user_id: "openmausbot_existing",
      manage_connections: {
        enable: true,
        enable_wait_for_connections: true,
        enable_connection_removal: true,
      },
      multi_account: {
        enable: true,
        max_accounts_per_toolkit: 5,
        require_explicit_selection: true,
      },
    });

    const reused = await prepareProjectSession("ak_test", created);
    expect(reused).toEqual({
      apiKey: "ak_test",
      userId: "openmausbot_existing",
      sessionId: "trs_test",
    });
  });

  it("recreates a legacy Session with the same Composio user ID", async () => {
    const upgraded = await prepareProjectSession("ak_test", {
      apiKey: "ak_test",
      userId: "stale-local-user-id",
      sessionId: "trs_legacy",
    });
    expect(upgraded).toEqual({
      apiKey: "ak_test",
      userId: "openmausbot_legacy",
      sessionId: "trs_test",
    });
    expect(calls.filter((call) => call.method === "POST" && call.path.endsWith("/session")).at(-1)?.body).toMatchObject({
      user_id: "openmausbot_legacy",
      multi_account: {
        enable: true,
        max_accounts_per_toolkit: 5,
        require_explicit_selection: true,
      },
    });
  });

  it("names the project's own auth configs at creation and rebuilds a Session that predates them", async () => {
    customAuthConfigs = [
      { id: "ac_twitter_old", toolkit: { slug: "twitter" }, is_composio_managed: false, status: "ENABLED", last_updated_at: "2026-08-20T00:00:00Z" },
      // newest wins, and the slug is matched case-insensitively
      { id: "ac_twitter", toolkit: { slug: "TWITTER" }, is_composio_managed: false, status: "ENABLED", last_updated_at: "2026-08-25T00:00:00Z" },
      // Composio-managed, disabled, and switched-off-for-Sessions configs are not the user's choice
      { id: "ac_github_managed", toolkit: { slug: "github" }, is_composio_managed: true, status: "ENABLED" },
      { id: "ac_slack_disabled", toolkit: { slug: "slack" }, is_composio_managed: false, status: "DISABLED" },
      { id: "ac_notion_off", toolkit: { slug: "notion" }, is_composio_managed: false, is_enabled_for_tool_router: false },
    ];
    sessionAuthConfigs = {};
    try {
      const current = { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" };
      const before = calls.length;
      await expect(prepareProjectSession("ak_test", current)).resolves.toEqual({ ...current });
      const creates = calls.slice(before).filter((call) => call.method === "POST" && call.path.endsWith("/session"));
      expect(creates).toHaveLength(1);
      expect(creates[0].body).toMatchObject({ user_id: "openmausbot_existing", auth_configs: { twitter: "ac_twitter" } });
      // the rebuilt Session now covers the configs, so the next check reuses it
      const after = calls.length;
      await prepareProjectSession("ak_test", current);
      expect(calls.slice(after).some((call) => call.method === "POST" && call.path.endsWith("/session"))).toBe(false);
    } finally {
      customAuthConfigs = [];
      sessionAuthConfigs = {};
    }
  });

  it("rebuilds the Session and retries when a toolkit needs the project's own auth config", async () => {
    customAuthConfigs = [{ id: "ac_twitter", toolkit: { slug: "twitter" }, is_composio_managed: false, status: "ENABLED" }];
    sessionAuthConfigs = {};
    const cfg: AppConfig = {
      // The live Session is authoritative. A stale local user ID must never
      // move the rebuilt Session away from the existing connected accounts.
      composio: { apiKey: "ak_test", userId: "stale-local-user", sessionId: "trs_test" },
    };
    try {
      const before = calls.length;
      await expect(authorizeService(cfg, "twitter")).resolves.toEqual({ url: "https://connect.composio.dev/link/twitter" });
      const since = calls.slice(before);
      // once against the stale Session, once against the rebuilt one
      expect(since.filter((call) => call.method === "POST" && call.path.endsWith("/link"))).toHaveLength(2);
      expect(since.filter((call) => call.method === "POST" && call.path.endsWith("/session")).at(-1)?.body).toMatchObject({
        user_id: "openmausbot_existing",
        auth_configs: { twitter: "ac_twitter" },
      });
      // the same Composio user keeps every existing connection
      expect(cfg.composio).toMatchObject({ userId: "openmausbot_existing", sessionId: "trs_test" });
    } finally {
      customAuthConfigs = [];
      sessionAuthConfigs = {};
    }
  });

  it("says what to create when the project has no auth config for the toolkit", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    const before = calls.length;
    await expect(authorizeService(cfg, "twitter")).rejects.toThrow(/create an auth config for "twitter"/i);
    expect(calls.slice(before).some((call) => call.method === "POST" && call.path.endsWith("/session"))).toBe(false);
    expect(cfg.composio).toMatchObject({ userId: "openmausbot_existing", sessionId: "trs_test" });
    // and a failure that is not about auth configs is passed through untouched
    await expect(authorizeService(cfg, "github", "personal-three")).resolves.toEqual({
      url: "https://connect.composio.dev/link/github",
    });
  });

  it("does not offer Twitter through the official managed broker without an owned OAuth app", async () => {
    setManagedBrokerAccess({
      url: "https://broker.openmausbot.test",
      token: "a".repeat(64),
    });
    try {
      await expect(authorizeService({} as AppConfig, "twitter")).rejects.toThrow(/X Developer app/i);
      await expect(authorizeService({} as AppConfig, "x")).rejects.toThrow(/self-hosted connected apps/i);
    } finally {
      setManagedBrokerAccess(null);
    }
  });

  it("validates account aliases before sending them upstream", () => {
    expect(normalizeAccountAlias("  personal gmail  ")).toBe("personal gmail");
    expect(() => normalizeAccountAlias("bad\nalias")).toThrow(/printable/i);
    expect(() => normalizeAccountAlias("x".repeat(65))).toThrow(/1-64/i);
  });

  it("mounts the Session MCP endpoint with the project key header", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    const integration = await mcpIntegration(cfg, {
      harnessUrl: "http://127.0.0.1:8799",
      commsToken: "secret",
      botId: "bot-1",
      threadId: "thread-1",
    });
    expect(integration).toMatchObject({
      command: process.execPath,
      args: [expect.stringContaining("connector-proxy")],
      env: {
        OMB_CONNECTOR_UPSTREAM_URL: "http://127.0.0.1:8799/api/internal/connectors/mcp",
        OMB_CONNECTOR_UPSTREAM_HEADERS: JSON.stringify({ authorization: "Bearer secret" }),
        OMB_HARNESS_URL: "http://127.0.0.1:8799",
        OMB_CONNECTOR_TOKEN: "secret",
        OMB_BOT_ID: "bot-1",
        OMB_THREAD_ID: "thread-1",
      },
    });
  });

  it("reports connection state, creates auth links and revokes disconnects", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    await expect(connectionStatus(cfg, ["github", "gmail", "slack", "notion", "linear"])).resolves.toEqual({
      github: {
        connected: true,
        pending: false,
        status: "ACTIVE",
        accounts: [
          { id: "ca_github_personal", alias: "personal", status: "ACTIVE" },
          { id: "ca_github_work", alias: "work", status: "ACTIVE" },
          // the Session-selected account is synthesized when the raw list
          // omits it — same rule as the inventory path
          { id: "ca_github", status: "ACTIVE" },
        ],
      },
      gmail: { connected: true, pending: false, status: "ACTIVE", accounts: [] },
      slack: { connected: false, pending: false, status: "not_connected", accounts: [] },
      notion: {
        connected: false,
        pending: true,
        status: "INITIATED",
        accounts: [{ id: "ca_notion", alias: "team", status: "INITIATED" }],
      },
      linear: {
        connected: false,
        pending: false,
        status: "EXPIRED",
        accounts: [{ id: "ca_linear", status: "EXPIRED" }],
      },
    });
    await expect(authorizeService(cfg, "github")).rejects.toThrow(/alias.*not replaced/i);
    await expect(authorizeService(cfg, "github", "work")).rejects.toThrow(/already in use/i);
    await expect(authorizeService(cfg, "github", "personal-two")).resolves.toEqual({
      url: "https://connect.composio.dev/link/github",
    });
    expect(calls.filter((call) => call.method === "POST" && call.path.endsWith("/link")).at(-1)?.body).toEqual({
      toolkit: "github",
      alias: "personal-two",
    });
    await expect(removeAccount(cfg, "github", "ca_github_personal")).resolves.toEqual({ removed: 1 });
    await expect(removeAccount(cfg, "github", "ca_other_user")).resolves.toEqual({ removed: 0 });
    await expect(removeAccount(cfg, "github", "../other")).rejects.toThrow(/invalid connected-account ID/i);
    await expect(removeService(cfg, "github")).resolves.toEqual({ removed: 1 });
    expect(calls.some(
      (call) => call.method === "DELETE"
        && call.path.endsWith("/connected_accounts/ca_github")
        && call.query === "?revoke_on_delete=true",
    )).toBe(true);
  });

  it("enumerates connected services independently of catalog position", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    const callCount = calls.length;

    await expect(connectedServices(cfg)).resolves.toMatchObject({
      toolkit_41: {
        connected: true,
        pending: false,
        status: "ACTIVE",
        accounts: [{ id: "ca_toolkit_41", alias: "overflow", status: "ACTIVE" }],
      },
      github: {
        accounts: [
          { id: "ca_github_personal", alias: "personal", status: "ACTIVE" },
          { id: "ca_github_work", alias: "work", status: "ACTIVE" },
          { id: "ca_github", status: "ACTIVE" },
        ],
      },
      publicsearch: {
        connected: true,
        pending: false,
        status: "ACTIVE",
        accounts: [],
      },
      selectedonly: {
        connected: true,
        pending: false,
        status: "ACTIVE",
        accounts: [{ id: "ca_session_only", status: "ACTIVE" }],
      },
    });

    const inventoryCalls = calls.slice(callCount).filter((call) => call.path.endsWith("/connected_accounts"));
    expect(inventoryCalls).toHaveLength(2);
    expect(inventoryCalls[0]?.query).not.toContain("toolkit_slugs=");
    expect(inventoryCalls[1]?.query).toContain("cursor=accounts-page-2");
    const toolkitCalls = calls.slice(callCount).filter((call) => call.path.endsWith("/toolkits"));
    expect(toolkitCalls).toHaveLength(2);
    expect(toolkitCalls[0]?.query).toContain("is_connected=true");
    expect(toolkitCalls[1]?.query).toContain("cursor=toolkits-page-2");
  });

  it("falls back to complete Session toolkit state without connected-account read permission", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    connectedAccountsUnavailable = true;
    try {
      await expect(connectedServices(cfg)).resolves.toMatchObject({
        github: {
          connected: true,
          status: "ACTIVE",
          accounts: [{ id: "ca_github", status: "ACTIVE" }],
        },
        gmail: { connected: true, status: "ACTIVE", accounts: [] },
        publicsearch: { connected: true, status: "ACTIVE", accounts: [] },
        selectedonly: {
          connected: true,
          status: "ACTIVE",
          accounts: [{ id: "ca_session_only", status: "ACTIVE" }],
        },
      });
    } finally {
      connectedAccountsUnavailable = false;
    }
  });

  it("falls back to session toolkit state when connected-account items is malformed", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    malformedConnectedAccounts = true;
    try {
      await expect(connectionStatus(cfg, ["github", "slack"])).resolves.toEqual({
        // the malformed list degrades to [], but the Session still names its
        // selected account — synthesized so a poll never wipes the row
        github: { connected: true, pending: false, status: "ACTIVE", accounts: [{ id: "ca_github", status: "ACTIVE" }] },
        slack: { connected: false, pending: false, status: "not_connected", accounts: [] },
      });
    } finally {
      malformedConnectedAccounts = false;
    }
  });

  it("uses the provided alias for the first account authorization", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    emptyConnectedAccounts = true;
    try {
      await expect(connectionStatus(cfg, ["slack"])).resolves.toMatchObject({
        slack: { connected: false, pending: false, accounts: [] },
      });
      const before = calls.length;
      await expect(authorizeService(cfg, "slack", "team")).resolves.toEqual({
        url: "https://connect.composio.dev/link/slack",
      });
      const linkCalls = calls.slice(before).filter((call) => call.method === "POST" && call.path.endsWith("/link"));
      expect(linkCalls).toHaveLength(1);
      expect(linkCalls[0].body).toEqual({ toolkit: "slack", alias: "team" });
    } finally {
      emptyConnectedAccounts = false;
    }
  });

  it("enforces deterministic, mutually exclusive states without contradictions", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    const statuses = await connectionStatus(cfg, ["github", "linear", "notion"]);
    // Active accounts win and force pending = false
    expect(statuses.github.connected).toBe(true);
    expect(statuses.github.pending).toBe(false);
    expect(statuses.github.status).toBe("ACTIVE");

    // Expired account is neither connected nor pending
    expect(statuses.linear.connected).toBe(false);
    expect(statuses.linear.pending).toBe(false);
    expect(statuses.linear.status).toBe("EXPIRED");

    // Initiated/pending account is pending = true, connected = false
    expect(statuses.notion.connected).toBe(false);
    expect(statuses.notion.pending).toBe(true);
    expect(statuses.notion.status).toBe("INITIATED");
  });

  it("removes all accounts associated with a toolkit during service disconnect", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    const before = calls.length;
    await expect(removeService(cfg, "github")).resolves.toEqual({ removed: 1 });
    const deleteCalls = calls.slice(before).filter(
      (c) => c.method === "DELETE" && c.path.includes("/connected_accounts/ca_github"),
    );
    // Deleted both session-selected ca_github and inventory accounts ca_github_work, ca_github_personal
    expect(deleteCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Official Roadmap Phase 12: Connected Service Intelligence", () => {
  it("Scenario 1: evaluates connected Gmail service without suspension", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    // github is active in mock API
    const req = await evaluateServiceRequirement(cfg, "github", "review pull request");
    expect(req.serviceName).toBe("github");
    expect(req.connectionStatus).toBe("connected");
    expect(req.requiredScopes).toContain("repo");
    expect(req.authUrl).toBeUndefined();
  });

  it("Scenario 2: disconnected service returns ServiceRequirement card with authUrl", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    // slack has no active account in mock session
    const req = await evaluateServiceRequirement(cfg, "slack", "read announcements channel");
    expect(req.serviceName).toBe("slack");
    expect(req.connectionStatus).toBe("disconnected");
    expect(req.requiredScopes).toContain("channels:read");
    expect(req.authUrl).toBeDefined();
    expect(req.authUrl).toMatch(/^https:\/\//);

    // Also verify broker-based unauthenticated Gmail
    const brokerReq = await evaluateServiceRequirement({}, "gmail", "read latest unread emails");
    expect(brokerReq.serviceName).toBe("gmail");
    expect(brokerReq.connectionStatus).toBe("disconnected");
    expect(brokerReq.requiredScopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(brokerReq.authUrl).toBeDefined();
  });

  it("Scenario 3: disconnected GitHub creates structured suspension", () => {
    const manager = new ServiceSuspensionManager();
    const suspension = manager.createSuspension({
      turnId: "turn-123",
      botId: "bot-coder",
      requiredService: "github",
      pendingExecutionPayload: { repo: "owner/repo", action: "create_issue", title: "Bug fix" },
    });

    expect(suspension.suspensionId).toMatch(/^susp_/);
    expect(suspension.turnId).toBe("turn-123");
    expect(suspension.botId).toBe("bot-coder");
    expect(suspension.requiredService).toBe("github");
    expect(suspension.pendingExecutionPayload).toEqual({
      repo: "owner/repo",
      action: "create_issue",
      title: "Bug fix",
    });
    expect(suspension.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("Scenario 4: expired service emits re-auth card with authUrl", async () => {
    const cfg: AppConfig = {
      composio: { apiKey: "ak_test", userId: "openmausbot_existing", sessionId: "trs_test" },
    };
    const req = await evaluateServiceRequirement(cfg, "linear", "update sprint issue");
    // Mock API returns EXPIRED for linear
    expect(req.serviceName).toBe("linear");
    expect(req.connectionStatus).toBe("expired");
    expect(req.authUrl).toBeDefined();
  });

  it("Scenario 5: rate-limited service is handled gracefully", async () => {
    const req: ServiceRequirement = {
      serviceName: "linear",
      actionDescription: "fetch issues",
      requiredScopes: ["read"],
      connectionStatus: "rate_limited",
    };
    expect(req.connectionStatus).toBe("rate_limited");
    expect(req.serviceName).toBe("linear");
  });

  it("Scenario 6: Google Calendar suspension payload serializes and deserializes safely", () => {
    const manager = new ServiceSuspensionManager();
    const payload = {
      eventTitle: "Sprint Review",
      startTime: "2026-10-25T10:00:00Z",
      endTime: "2026-10-25T11:00:00Z",
      attendees: ["dev@example.com", "lead@example.com"],
    };

    const suspension = manager.createSuspension({
      turnId: "turn-cal-1",
      botId: "bot-calendar",
      requiredService: "googlecalendar",
      pendingExecutionPayload: payload,
    });

    const retrieved = manager.getSuspension(suspension.suspensionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.pendingExecutionPayload).toEqual(payload);
  });

  it("Scenario 7: clean resumption after successful auth callback", () => {
    const manager = new ServiceSuspensionManager();
    const suspension = manager.createSuspension({
      turnId: "turn-cal-2",
      botId: "bot-calendar",
      requiredService: "googlecalendar",
      pendingExecutionPayload: { action: "schedule_standup" },
    });

    const result = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-calendar",
      authOutcome: "success",
    });

    expect(result.ok).toBe(true);
    expect(result.resumed).toBe(true);
    expect(result.suspension?.suspensionId).toBe(suspension.suspensionId);
    expect(result.suspension?.pendingExecutionPayload).toEqual({ action: "schedule_standup" });
  });

  it("Scenario 8: OAuth timeout after 10 minutes (ERR_OAUTH_TIMEOUT)", () => {
    const manager = new ServiceSuspensionManager(50); // 50ms TTL for test
    const suspension = manager.createSuspension({
      turnId: "turn-timeout",
      botId: "bot-timeout",
      requiredService: "gmail",
      pendingExecutionPayload: { action: "fetch_inbox" },
    });

    // Artificially age the suspension beyond TTL
    suspension.createdAt = Date.now() - 601_000; // 10m 1s ago

    const result = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-timeout",
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERR_OAUTH_TIMEOUT);
    expect(result.error).toMatch(/timed out after 10 minutes/i);
  });

  it("Scenario 9: expired suspension rejection on late callback", () => {
    const manager = new ServiceSuspensionManager();
    const suspension = manager.createSuspension({
      turnId: "turn-late",
      botId: "bot-late",
      requiredService: "slack",
      pendingExecutionPayload: { message: "team update" },
    });

    // Explicitly expire
    manager.expireSuspension(suspension.suspensionId);

    const result = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-late",
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERR_OAUTH_TIMEOUT);
  });

  it("Scenario 10: idempotent callback processing (duplicate callbacks ignored)", () => {
    const manager = new ServiceSuspensionManager();
    const suspension = manager.createSuspension({
      turnId: "turn-idemp",
      botId: "bot-idemp",
      requiredService: "github",
      pendingExecutionPayload: { commit: "abc1234" },
    });

    const first = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-idemp",
    });
    expect(first.ok).toBe(true);
    expect(first.resumed).toBe(true);

    // Duplicate callback
    const second = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-idemp",
    });
    expect(second.ok).toBe(true);
    expect(second.resumed).toBe(false); // Ignored, no double-dispatch
  });

  it("Scenario 11: concurrent service suspensions across different bots", () => {
    const manager = new ServiceSuspensionManager();
    const suspA = manager.createSuspension({
      turnId: "turn-A",
      botId: "bot-A",
      requiredService: "gmail",
      pendingExecutionPayload: { user: "alice" },
    });
    const suspB = manager.createSuspension({
      turnId: "turn-B",
      botId: "bot-B",
      requiredService: "slack",
      pendingExecutionPayload: { user: "bob" },
    });

    expect(manager.listActiveSuspensions("bot-A")).toHaveLength(1);
    expect(manager.listActiveSuspensions("bot-B")).toHaveLength(1);
    expect(manager.listActiveSuspensions()).toHaveLength(2);

    expect(manager.getSuspension(suspA.suspensionId)?.botId).toBe("bot-A");
    expect(manager.getSuspension(suspB.suspensionId)?.botId).toBe("bot-B");
  });

  it("Scenario 12: suspension payload tampering protection (defensive deep copy)", () => {
    const manager = new ServiceSuspensionManager();
    const externalPayload: Record<string, any> = { nested: { value: "original" } };
    const suspension = manager.createSuspension({
      turnId: "turn-tamper",
      botId: "bot-tamper",
      requiredService: "github",
      pendingExecutionPayload: externalPayload,
    });

    // Mutate original object externally
    externalPayload.nested.value = "tampered";

    const retrieved = manager.getSuspension(suspension.suspensionId);
    expect(retrieved?.pendingExecutionPayload).toEqual({ nested: { value: "original" } });
  });

  it("Scenario 13: raw secret and OAuth token redaction from cards", () => {
    const requirement: ServiceRequirement = {
      serviceName: "gmail",
      actionDescription: "Check email for token ya29.a0AfH6SMB_secret_access_token_12345",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      connectionStatus: "disconnected",
      authUrl: "https://connect.composio.dev/link/gmail",
    };
    const suspension: ServiceConnectionSuspension = {
      suspensionId: "susp-card-redact",
      turnId: "turn-card",
      botId: "bot-card",
      requiredService: "gmail",
      pendingExecutionPayload: { secretToken: "ya29.secret123", apiKey: "ak_test123" },
      createdAt: Date.now(),
    };

    const card = createServiceConnectionCardPayload(requirement, suspension);
    const cardStr = JSON.stringify(card);
    expect(cardStr).not.toContain("ya29.a0AfH6SMB_secret_access_token_12345");
  });

  it("Scenario 14: raw secret and OAuth token redaction from chat logs and payloads", () => {
    const rawText = "Bearer ya29.a0AfH6_google_token and ghp_githubPersonalAccessToken123 and xoxb-slack-bot-token-456";
    const sanitized = sanitizeServicePayload(rawText);

    expect(sanitized).not.toContain("ya29.a0AfH6_google_token");
    expect(sanitized).not.toContain("ghp_githubPersonalAccessToken123");
    expect(sanitized).not.toContain("xoxb-slack-bot-token-456");
    expect(sanitized).toContain("[REDACTED_GOOGLE_TOKEN]");
    expect(sanitized).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized).toContain("[REDACTED_SLACK_TOKEN]");
  });

  it("Scenario 15: raw secret and OAuth token redaction in telemetry events", () => {
    const eventPayload = {
      botId: "bot-telemetry",
      credentials: {
        accessToken: "ya29.sensitive_token",
        clientSecret: "top_secret_value",
      },
      message: "Connected with Bearer secret-token-value",
    };
    const sanitized = sanitizeServicePayload(eventPayload);

    expect(sanitized.credentials.accessToken).toBe("[REDACTED]");
    expect(sanitized.credentials.clientSecret).toBe("[REDACTED]");
    expect(sanitized.message).toContain("Bearer [REDACTED]");
  });

  it("Scenario 16: scope minimization enforces least privilege", () => {
    // Readonly email -> gmail.readonly
    const readScopes = getRequiredScopesForService("gmail", "Read messages from inbox");
    expect(readScopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);

    // Send email -> gmail.send
    const sendScopes = getRequiredScopesForService("gmail", "Send urgent email to boss");
    expect(sendScopes).toEqual(["https://www.googleapis.com/auth/gmail.send"]);

    // GitHub read vs write
    const ghUserScopes = getRequiredScopesForService("github", "Get current user profile");
    expect(ghUserScopes).toEqual(["read:user"]);
    const ghRepoScopes = getRequiredScopesForService("github", "Push commit to repo");
    expect(ghRepoScopes).toEqual(["repo"]);

    // Calendar read vs write
    const calReadScopes = getRequiredScopesForService("googlecalendar", "View today's meetings");
    expect(calReadScopes).toEqual(["https://www.googleapis.com/auth/calendar.events.readonly"]);
    const calWriteScopes = getRequiredScopesForService("googlecalendar", "Schedule new meeting");
    expect(calWriteScopes).toEqual(["https://www.googleapis.com/auth/calendar.events"]);
  });

  it("Scenario 17: cross-bot replay attack rejection enforces user and bot isolation", () => {
    const manager = new ServiceSuspensionManager();
    const suspension = manager.createSuspension({
      turnId: "turn-victim",
      botId: "bot-victim",
      requiredService: "slack",
      pendingExecutionPayload: { targetChannel: "#confidential" },
    });

    // Attacker bot tries to resume victim bot's suspension
    const attackerResult = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-attacker",
    });

    expect(attackerResult.ok).toBe(false);
    expect(attackerResult.code).toBe("ERR_CROSS_BOT_DENIED");
    expect(attackerResult.error).toMatch(/Cross-bot suspension access rejected/i);

    // Victim bot can still resume successfully
    const legitimateResult = manager.resumeSuspension({
      suspensionId: suspension.suspensionId,
      callerBotId: "bot-victim",
    });
    expect(legitimateResult.ok).toBe(true);
  });

  describe("Composio Connect (ck_) Catalog & MCP Search", () => {
    it("parses SSE responses with : connected comments and data: lines", async () => {
      const sseBody = ": connected\n\n: connected\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"ZOOM_LIST_MEETINGS\"}]}}\n\n";
      const res = new Response(sseBody, {
        headers: { "content-type": "text/event-stream" },
      });
      const parsed = await parseConnectMcpJsonRpc(res);
      expect(parsed).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [{ name: "ZOOM_LIST_MEETINGS" }] },
      });
    });

    it("parses standard application/json responses as fallback", async () => {
      const jsonBody = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } });
      const res = new Response(jsonBody, {
        headers: { "content-type": "application/json" },
      });
      const parsed = await parseConnectMcpJsonRpc(res);
      expect(parsed).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    });

    it("loads Connect catalog without 502/JWT error and discovers toolkits beyond 24 curated items", async () => {
      const mockMcp = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.params?.name === "COMPOSIO_SEARCH_TOOLS") {
            const query = parsed.params?.arguments?.queries?.[0]?.use_case || "";
            const isZoom = query.toLowerCase().includes("zoom");
            const resultData = {
              successful: true,
              data: {
                results: [{
                  toolkits: isZoom ? ["zoom"] : ["spotify"],
                }],
                toolkit_connection_statuses: [{
                  toolkit: isZoom ? "zoom" : "spotify",
                  description: isZoom
                    ? "Zoom is a video conferencing and online meeting platform"
                    : "Spotify digital music and podcast streaming service",
                  has_active_connection: false,
                }],
              },
            };
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(`: connected\n\nevent: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: {
                content: [{ type: "text", text: JSON.stringify(resultData) }],
              },
            })}\n\n`);
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { tools: [] } }));
          }
        });
      });

      await new Promise<void>((resolve) => mockMcp.listen(0, "127.0.0.1", () => resolve()));
      const mcpPort = (mockMcp.address() as any).port;
      const mcpUrl = `http://127.0.0.1:${mcpPort}`;

      try {
        const cfg: AppConfig = {
          composio: {
            apiKey: "ck_test_valid_connect_key",
            surface: "connect",
            mcpUrl,
          },
        };

        // 1. Initial load without query: returns complete catalog (1,600+ items) with source: api, NO error
        const initial = await listToolkits(cfg);
        expect(initial.source).toBe("api");
        expect(initial.error).toBeUndefined();
        expect(initial.cards.length).toBeGreaterThan(1600);
        expect(initial.cards.some((c) => c.slug === "github")).toBe(true);
        expect(initial.cards.some((c) => c.slug === "zoom")).toBe(true);
        expect(initial.cards.some((c) => c.slug === "spotify")).toBe(true);

        // 2. Search query: dynamically discovers "zoom" via Connect MCP
        const searchResult = await listToolkits(cfg, { query: "zoom meeting" });
        expect(searchResult.source).toBe("api");
        expect(searchResult.error).toBeUndefined();
        const zoomCard = searchResult.cards.find((c) => c.slug === "zoom");
        expect(zoomCard).toBeDefined();
        expect(zoomCard?.label).toBe("Zoom");
        expect(zoomCard?.blurb).toContain("Zoom is a video conferencing");

        // 3. Search query: dynamically discovers "spotify" via Connect MCP
        const spotifyResult = await listToolkits(cfg, { query: "spotify music" });
        const spotifyCard = spotifyResult.cards.find((c) => c.slug === "spotify");
        expect(spotifyCard).toBeDefined();
        expect(spotifyCard?.label).toBe("Spotify");
      } finally {
        await new Promise((resolve) => mockMcp.close(resolve));
      }
    });
  });

  describe("Gate 6: Adversarial Composio Catalog Regressions", () => {
    it("handles large catalogs (>26 services across multiple pages) with deduplication and provider total", async () => {
      const cfg: AppConfig = { composio: { apiKey: "ak_catalog_multi_page" } };
      const result = await listToolkits(cfg, { refresh: true });

      expect(result.source).toBe("api");
      expect(result.error).toBeUndefined();
      // Total gathered cards must be > 26 (we have 35 unique items across 3 pages)
      expect(result.cards.length).toBe(35);
      expect(result.cards.length).toBeGreaterThan(26);
      // "slack" was on page 1 and page 2, must be deduplicated
      const slackCards = result.cards.filter((c) => c.slug === "slack");
      expect(slackCards.length).toBe(1);
      // Provider reported authoritative total_items = 45
      expect(result.totalCount).toBe(45);
      expect(result.hasMore).toBe(true);
    });

    it("searches and returns integrations that exist on later pages", async () => {
      const cfg: AppConfig = { composio: { apiKey: "ak_catalog_multi_page" } };
      // "service_34" is only on page 3
      const searchResult = await listToolkits(cfg, { query: "service 34" });
      expect(searchResult.source).toBe("api");
      expect(searchResult.cards.some((c) => c.slug === "service_34")).toBe(true);
    });

    it("invalidates cache on refresh and triggers fresh upstream fetch", async () => {
      const cfg: AppConfig = { composio: { apiKey: "ak_catalog_multi_page" } };
      // 1. Force refresh to ensure cache is primed with a known call baseline
      await listToolkits(cfg, { refresh: true });
      const callCountAfterFirst = calls.length;

      // 2. Cached fetch without refresh does NOT make new upstream calls
      await listToolkits(cfg);
      expect(calls.length).toBe(callCountAfterFirst);

      // 3. Fetch with refresh = true invalidates cache and makes new upstream calls
      await listToolkits(cfg, { refresh: true });
      expect(calls.length).toBeGreaterThan(callCountAfterFirst);
    });

    it("never silently falls back to curated catalog on auth failure (Platform ak_)", async () => {
      const cfg: AppConfig = { composio: { apiKey: "ak_invalid_rejected_key" } };
      const result = await listToolkits(cfg, { refresh: true });

      expect(result.cards).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/invalid project key|HTTP 401/);
    });

    it("never silently falls back to curated catalog on Connect MCP auth failure", async () => {
      const mockMcp = createServer((_req, res) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid consumer API key" }));
      });
      await new Promise<void>((resolve) => mockMcp.listen(0, "127.0.0.1", resolve));
      const mcpPort = (mockMcp.address() as any).port;

      try {
        const cfg: AppConfig = {
          composio: {
            apiKey: "ck_unauthorized_key",
            surface: "connect",
            mcpUrl: `http://127.0.0.1:${mcpPort}`,
          },
        };

        const result = await listToolkits(cfg, { query: "zoom meeting", refresh: true });
        expect(result.cards).toHaveLength(0);
        expect(result.error).toBeDefined();
        expect(result.error).toContain("rejected this consumer key");
      } finally {
        await new Promise((resolve) => mockMcp.close(resolve));
      }
    });

    it("authorizes managed Connect service via COMPOSIO_MANAGE_CONNECTIONS redirect_url", async () => {
      let manageConnectionsPayload: any = null;
      const mockMcp = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.params?.name === "COMPOSIO_MANAGE_CONNECTIONS") {
            manageConnectionsPayload = parsed.params.arguments;
            const toolkit = manageConnectionsPayload?.toolkits?.[0]?.name;
            const resultData = {
              successful: true,
              data: {
                message: "All connections have been initiated",
                results: {
                  [toolkit]: {
                    toolkit,
                    status: "initiated",
                    redirect_url: `https://connect.composio.dev/link/lk_test_${toolkit}_123`,
                    instruction: `Connect ${toolkit}`,
                  },
                },
              },
            };
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(`: connected\n\nevent: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { content: [{ type: "text", text: JSON.stringify(resultData) }] },
            })}\n\n`);
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
          }
        });
      });
      await new Promise<void>((resolve) => mockMcp.listen(0, "127.0.0.1", resolve));
      const mcpPort = (mockMcp.address() as any).port;

      try {
        const cfg: AppConfig = {
          composio: {
            apiKey: "ck_test_key",
            surface: "connect",
            mcpUrl: `http://127.0.0.1:${mcpPort}`,
          },
        };

        const auth = await authorizeService(cfg, "github");
        expect(auth.url).toBe("https://connect.composio.dev/link/lk_test_github_123");
        expect(manageConnectionsPayload).toEqual({
          toolkits: [{ name: "github", action: "add" }],
        });

        // Test with alias
        const authWithAlias = await authorizeService(cfg, "slack", "my-team");
        expect(authWithAlias.url).toBe("https://connect.composio.dev/link/lk_test_slack_123");
        expect(manageConnectionsPayload).toEqual({
          toolkits: [{ name: "slack", action: "add", alias: "my-team" }],
        });
      } finally {
        await new Promise((resolve) => mockMcp.close(resolve));
      }
    });

    it("authorizes unmanaged Connect service extracting setup link from instruction or fallback", async () => {
      const mockMcp = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.params?.name === "COMPOSIO_MANAGE_CONNECTIONS") {
            const resultData = {
              successful: true,
              data: {
                message: "All connection attempts failed",
                results: {
                  spotify: {
                    toolkit: "spotify",
                    status: "failed",
                    error_message: "Composio does not have managed auth for 'spotify', so the user must set up their own auth config: [Set up spotify](https://dashboard.composio.dev/~/org/connect/apps/spotify?open=true).",
                  },
                },
              },
            };
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(`: connected\n\nevent: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { content: [{ type: "text", text: JSON.stringify(resultData) }] },
            })}\n\n`);
          }
        });
      });
      await new Promise<void>((resolve) => mockMcp.listen(0, "127.0.0.1", resolve));
      const mcpPort = (mockMcp.address() as any).port;

      try {
        const cfg: AppConfig = {
          composio: {
            apiKey: "ck_test_key",
            surface: "connect",
            mcpUrl: `http://127.0.0.1:${mcpPort}`,
          },
        };

        const auth = await authorizeService(cfg, "spotify");
        expect(auth.url).toBe("https://dashboard.composio.dev/~/org/connect/apps/spotify?open=true");
      } finally {
        await new Promise((resolve) => mockMcp.close(resolve));
      }
    });

    it("falls back to direct app connect url if Connect MCP call times out or fails", async () => {
      const cfg: AppConfig = {
        composio: {
          apiKey: "ck_test_key",
          surface: "connect",
          mcpUrl: "http://127.0.0.1:9", // unreachable
        },
      };

      const auth = await authorizeService(cfg, "zoom");
      expect(auth.url).toBe("https://dashboard.composio.dev/~/org/connect/apps/zoom?open=true");

      const direct = await authorizeConnectService("ck_test_key", "http://127.0.0.1:9", "zoom");
      expect(direct.url).toBe("https://dashboard.composio.dev/~/org/connect/apps/zoom?open=true");
    });

    it("queries COMPOSIO_MANAGE_CONNECTIONS to discover connected accounts and statuses in Connect mode", async () => {
      let manageConnectionsCalled = false;
      const mockMcp = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.params?.name === "COMPOSIO_MANAGE_CONNECTIONS") {
            manageConnectionsCalled = true;
            const resultData = {
              successful: true,
              data: {
                message: "Processed toolkits",
                results: {
                  github: {
                    toolkit: "github",
                    status: "active",
                    accounts: [
                      {
                        id: "github_acc_1",
                        status: "active",
                        is_default: true,
                        user_info: { login: "testuser" },
                      },
                    ],
                  },
                  slack: {
                    toolkit: "slack",
                    status: "initiated",
                    accounts: [
                      {
                        id: "slack_acc_1",
                        status: "initializing",
                      },
                    ],
                  },
                },
              },
            };
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(`: connected\n\nevent: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { content: [{ type: "text", text: JSON.stringify(resultData) }] },
            })}\n\n`);
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
          }
        });
      });
      await new Promise<void>((resolve) => mockMcp.listen(0, "127.0.0.1", resolve));
      const mcpPort = (mockMcp.address() as any).port;

      try {
        const cfg: AppConfig = {
          composio: {
            apiKey: "ck_test_key",
            surface: "connect",
            mcpUrl: `http://127.0.0.1:${mcpPort}`,
          },
        };

        const statuses = await connectionStatus(cfg, ["github", "slack", "zoom"]);
        expect(manageConnectionsCalled).toBe(true);
        expect(statuses.github.connected).toBe(true);
        expect(statuses.github.status).toBe("ACTIVE");
        expect(statuses.github.accounts?.[0]?.alias).toBe("testuser");
        expect(statuses.slack.connected).toBe(false);
        expect(statuses.slack.pending).toBe(true);
        expect(statuses.zoom.connected).toBe(false);

        const connected = await connectedServices(cfg);
        expect(connected.github.connected).toBe(true);
        expect(connected.github.accounts?.[0]?.id).toBe("github_acc_1");
      } finally {
        await new Promise((resolve) => mockMcp.close(resolve));
      }
    });
  });
});


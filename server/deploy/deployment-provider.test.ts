import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

import {
  DeploymentCredentialStore,
  maskToken,
} from "./credentials.ts";
import { VercelDeploymentProvider } from "./vercel-provider.ts";
import { RenderDeploymentProvider } from "./render-provider.ts";
import { DeploymentManager } from "./deployment-manager.ts";
import { ProjectManager } from "../app-builder/project-manager.ts";

describe("Deployment Providers (Phase F Vercel & Phase G Render)", () => {
  let tempDir: string;
  let mockServer: http.Server;
  let mockPort: number;
  let mockBaseUrl: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "moblot-deploy-test-"));

    // Start a lightweight mock HTTP server for testing Vercel & Render API contracts
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        const url = req.url || "";
        res.setHeader("Content-Type", "application/json");

        // Vercel routes
        if (url.startsWith("/v2/user")) {
          const auth = req.headers["authorization"] || "";
          if (auth.includes("invalid_token")) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: { code: "unauthorized", message: "Invalid token" } }));
            return;
          }
          if (auth.includes("rate_limited")) {
            res.writeHead(429);
            res.end(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ user: { id: "usr_123", username: "maususer", email: "user@example.com" } }));
          return;
        }

        if (url === "/v13/deployments" && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            const parsed = JSON.parse(body);
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id: "dpl_vercel123",
                name: parsed.name,
                url: `${parsed.name}.vercel.app`,
                readyState: "READY",
                createdAt: Date.now(),
              })
            );
          });
          return;
        }

        if (url.startsWith("/v3/deployments/dpl_vercel123/events")) {
          res.writeHead(200);
          res.end(
            JSON.stringify([
              { text: "Building dependencies..." },
              { text: "Bundling assets..." },
              { text: "Build completed successfully." },
            ])
          );
          return;
        }

        if (url.startsWith("/v12/deployments/dpl_vercel123/cancel") && req.method === "PATCH") {
          res.writeHead(200);
          res.end(JSON.stringify({ status: "CANCELED" }));
          return;
        }

        if (url.startsWith("/v13/deployments/dpl_vercel123")) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id: "dpl_vercel123",
              name: "test-app",
              url: "test-app.vercel.app",
              readyState: "READY",
              createdAt: Date.now(),
            })
          );
          return;
        }

        // Render routes
        if (url.startsWith("/owners")) {
          const auth = req.headers["authorization"] || "";
          if (auth.includes("invalid_token")) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          res.writeHead(200);
          res.end(
            JSON.stringify([
              { owner: { id: "own_123", name: "Render Org", email: "render@example.com" } },
            ])
          );
          return;
        }

        if (url.startsWith("/services") && url.includes("deploys") && req.method === "POST") {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id: "dep_render123",
              status: "live",
              createdAt: new Date().toISOString(),
            })
          );
          return;
        }

        if (url.startsWith("/services?name=")) {
          res.writeHead(200);
          res.end(
            JSON.stringify([
              {
                service: {
                  id: "srv_render123",
                  name: "test-app",
                  serviceDetails: { url: "https://test-app.onrender.com" },
                },
              },
            ])
          );
          return;
        }

        if (url.includes("/deploys/dep_render123")) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id: "dep_render123",
              status: "live",
              serviceId: "srv_render123",
              createdAt: new Date().toISOString(),
            })
          );
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: "Route not found" }));
      });

      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as any;
        mockPort = addr.port;
        mockBaseUrl = `http://127.0.0.1:${mockPort}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    try {
      mockServer.close();
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("DeploymentCredentialStore", () => {
    it("masks access tokens securely without revealing plain text", () => {
      expect(maskToken("ver_abcdef123456")).toBe("ver_...3456");
      expect(maskToken("rnd_secret_token_9999")).toBe("rnd_...9999");
      expect(maskToken("short")).toBe("••••••••");
    });

    it("stores credentials in mode 0600 and lists masked accounts", () => {
      const storeFile = join(tempDir, "deploy-cred.json");
      const store = new DeploymentCredentialStore(storeFile);

      store.setCredential("vercel", "ver_secret_token_1234", {
        username: "johndoe",
        email: "john@example.com",
      });

      const mode = statSync(storeFile).mode & 0o777;
      expect(mode).toBe(0o600);

      const accounts = store.listConnectedAccounts();
      const vercel = accounts.find((a) => a.provider === "vercel");
      expect(vercel?.connected).toBe(true);
      expect(vercel?.username).toBe("johndoe");
      expect(vercel?.maskedToken).toBe("ver_...1234");
      // Raw token is strictly protected
      expect(vercel?.maskedToken).not.toBe("ver_secret_token_1234");
      expect(store.getRawToken("vercel")).toBe("ver_secret_token_1234");
    });
  });

  describe("VercelDeploymentProvider", () => {
    it("tests account connection via pure HTTPS API", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const res = await provider.testConnection("test_token");

      expect(res.ok).toBe(true);
      expect(res.account?.username).toBe("maususer");
      expect(res.account?.email).toBe("user@example.com");
    });

    it("creates deployment with bundled files and returns live URL", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const record = await provider.createDeployment("test_token", {
        projectId: "test-app",
        projectName: "Test App",
        target: "production",
        files: [
          { file: "index.html", data: "<h1>Hello</h1>", encoding: "utf-8" },
        ],
      });

      expect(record.provider).toBe("vercel");
      expect(record.status).toBe("ready");
      expect(record.url).toBe("https://test-app.vercel.app");
      expect(record.id).toBe("dpl_vercel123");
    });

    it("provides actionable error guidance on 401 invalid token", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const res = await provider.testConnection("invalid_token");

      expect(res.ok).toBe(false);
      expect(res.error).toContain("vercel.com/account/tokens");
    });

    it("handles 429 rate limit cleanly", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const res = await provider.testConnection("rate_limited");

      expect(res.ok).toBe(false);
      expect(res.error).toContain("rate limit");
    });

    it("rejects empty access token immediately without network call", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const res = await provider.testConnection("   ");

      expect(res.ok).toBe(false);
      expect(res.error).toContain("cannot be empty");
    });

    it("rejects deployment creation when project files are empty", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const record = await provider.createDeployment("test_token", {
        projectId: "test-app",
        projectName: "Test App",
        files: [],
      });

      expect(record.status).toBe("error");
      expect(record.error).toContain("No project files available to deploy");
    });

    it("fetches deployment logs and trims lines to maxLines", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const logs = await provider.getDeploymentLogs("test_token", "dpl_vercel123", 2);

      expect(logs).toContain("Build completed successfully.");
      const lines = logs.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
    });

    it("cancels an in-flight deployment via API", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const ok = await provider.cancelDeployment("test_token", "dpl_vercel123");

      expect(ok).toBe(true);
    });

    it("redeploys existing deployment by cloning config", async () => {
      const provider = new VercelDeploymentProvider(mockBaseUrl);
      const record = await provider.redeploy("test_token", "dpl_vercel123");

      expect(record.provider).toBe("vercel");
    });
  });

  describe("RenderDeploymentProvider", () => {
    it("tests account connection and retrieves owner metadata", async () => {
      const provider = new RenderDeploymentProvider(mockBaseUrl);
      const res = await provider.testConnection("test_token");

      expect(res.ok).toBe(true);
      expect(res.account?.username).toBe("Render Org");
      expect(res.account?.email).toBe("render@example.com");
    });

    it("triggers deployment on existing or new service and polls status", async () => {
      const provider = new RenderDeploymentProvider(mockBaseUrl);
      const record = await provider.createDeployment("test_token", {
        projectId: "srv_render123",
        projectName: "Test App",
        target: "production",
      });

      expect(record.provider).toBe("render");
      expect(record.status).toBe("ready");
      expect(record.id).toBe("dep_render123");
      expect(record.url).toBe("https://test-app.onrender.com");
    });

    it("handles 401 unauthorized gracefully for Render", async () => {
      const provider = new RenderDeploymentProvider(mockBaseUrl);
      const res = await provider.testConnection("invalid_token");

      expect(res.ok).toBe(false);
      expect(res.error).toContain("401");
    });

    it("indicates cancel is unsupported for Render v1 API without crashing", async () => {
      const provider = new RenderDeploymentProvider(mockBaseUrl);
      const ok = await provider.cancelDeployment("test_token", "dep_render123");

      expect(ok).toBe(false);
    });

    it("retrieves informational deployment logs for Render", async () => {
      const provider = new RenderDeploymentProvider(mockBaseUrl);
      const logs = await provider.getDeploymentLogs("test_token", "dep_render123");

      expect(logs).toContain("dep_render123");
    });
  });

  describe("DeploymentManager & ask_user integration", () => {
    it("prompts user with ask_user choices matching connected providers", () => {
      const credFile = join(tempDir, "deploy-cred.json");
      const credStore = new DeploymentCredentialStore(credFile);
      const mgr = new DeploymentManager(credStore);

      // Initially no accounts connected
      const initialPrompt = mgr.promptWhereToDeploy();
      expect(initialPrompt.options).toContain("Connect Vercel account");
      expect(initialPrompt.connectedProviders.length).toBe(0);

      // Connect Vercel account
      credStore.setCredential("vercel", "ver_token_12345678", { username: "vuser" });
      const withVercel = mgr.promptWhereToDeploy();
      expect(withVercel.connectedProviders).toContain("vercel");
      expect(withVercel.options.some((o) => o.includes("VERCEL (vuser)"))).toBe(true);
    });

    it("deploys project files and updates project deployment state", async () => {
      const credFile = join(tempDir, "deploy-cred.json");
      const credStore = new DeploymentCredentialStore(credFile);
      credStore.setCredential("vercel", "valid_token");

      const projDir = join(tempDir, "projects");
      const projMgr = new ProjectManager(projDir);
      const project = projMgr.createProject({ name: "Web App", framework: "html" });

      const vercelProvider = new VercelDeploymentProvider(mockBaseUrl);
      const deployMgr = new DeploymentManager(credStore, [vercelProvider], projMgr);

      const record = await deployMgr.deploy("vercel", {
        projectId: project.id,
        projectName: project.name,
      });

      expect(record.status).toBe("ready");
      expect(record.url).toBe("https://web-app.vercel.app");

      // Verify project state in ProjectManager was updated
      const updated = projMgr.getProject(project.id);
      expect(updated?.deployment.provider).toBe("vercel");
      expect(updated?.deployment.status).toBe("ready");
      expect(updated?.deployment.url).toBe("https://web-app.vercel.app");
      expect(updated?.state).toBe("live");
    });

    it("retrieves logs and cancels deployment via DeploymentManager", async () => {
      const credFile = join(tempDir, "deploy-cred.json");
      const credStore = new DeploymentCredentialStore(credFile);
      credStore.setCredential("vercel", "valid_token");

      const vercelProvider = new VercelDeploymentProvider(mockBaseUrl);
      const deployMgr = new DeploymentManager(credStore, [vercelProvider]);

      const logs = await deployMgr.getLogs("vercel", "dpl_vercel123", 50);
      expect(logs).toContain("Build completed successfully.");

      const cancelled = await deployMgr.cancel("vercel", "dpl_vercel123");
      expect(cancelled).toBe(true);

      const disconnected = deployMgr.disconnectAccount("vercel");
      expect(disconnected).toBe(true);
      expect(credStore.getRawToken("vercel")).toBeNull();
    });
  });
});

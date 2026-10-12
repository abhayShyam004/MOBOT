import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

import { DeploymentCredentialStore } from "./credentials.ts";
import { VercelDeploymentProvider } from "./vercel-provider.ts";
import { RenderDeploymentProvider } from "./render-provider.ts";
import { DeploymentManager } from "./deployment-manager.ts";
import { ProjectManager } from "../app-builder/project-manager.ts";
import { setDeploymentManager, setProjectManager } from "../app-builder/app-builder-tools.ts";

describe("Deployment REST API & Coordination (Phase F & G)", () => {
  let tempDir: string;
  let mockServer: http.Server;
  let mockPort: number;
  let mockBaseUrl: string;
  let projMgr: ProjectManager;
  let credStore: DeploymentCredentialStore;
  let deployMgr: DeploymentManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "moblot-deploy-api-test-"));

    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        const url = req.url || "";
        res.setHeader("Content-Type", "application/json");

        if (url.startsWith("/v2/user")) {
          const auth = req.headers["authorization"] || "";
          if (auth.includes("invalid")) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: { message: "Invalid API token" } }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ user: { id: "usr_mock", username: "clouddev", email: "dev@cloud.com" } }));
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
                id: "dpl_live123",
                name: parsed.name,
                url: `${parsed.name}.vercel.app`,
                readyState: "READY",
                createdAt: Date.now(),
              })
            );
          });
          return;
        }

        if (url.startsWith("/v3/deployments/dpl_live123/events")) {
          res.writeHead(200);
          res.end(
            JSON.stringify([
              { text: "Optimizing static assets..." },
              { text: "Deployment finalized at https://test.vercel.app" },
            ])
          );
          return;
        }

        if (url.startsWith("/v12/deployments/dpl_live123/cancel") && req.method === "PATCH") {
          res.writeHead(200);
          res.end(JSON.stringify({ status: "CANCELED" }));
          return;
        }

        if (url.startsWith("/v13/deployments/dpl_live123")) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id: "dpl_live123",
              name: "portfolio-app",
              url: "portfolio-app.vercel.app",
              readyState: "READY",
              createdAt: Date.now(),
            })
          );
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not found" }));
      });

      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as any;
        mockPort = addr.port;
        mockBaseUrl = `http://127.0.0.1:${mockPort}`;
        resolve();
      });
    });

    const credFile = join(tempDir, "deploy-cred.json");
    credStore = new DeploymentCredentialStore(credFile);
    const projDir = join(tempDir, "projects");
    projMgr = new ProjectManager(projDir);

    const vercelProvider = new VercelDeploymentProvider(mockBaseUrl);
    const renderProvider = new RenderDeploymentProvider(mockBaseUrl);
    deployMgr = new DeploymentManager(credStore, [vercelProvider, renderProvider], projMgr);

    setProjectManager(projMgr);
    setDeploymentManager(deployMgr);
  });

  afterEach(() => {
    try {
      mockServer.close();
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("lists accounts with masked tokens and tracks connection status", () => {
    const accounts = deployMgr.listAccounts();
    expect(accounts.length).toBe(2);
    expect(accounts.every((a) => a.connected === false)).toBe(true);

    credStore.setCredential("vercel", "ver_secret_token_12345678", { username: "clouddev" });
    const updated = deployMgr.listAccounts();
    const vercel = updated.find((a) => a.provider === "vercel");
    expect(vercel?.connected).toBe(true);
    expect(vercel?.maskedToken).toBe("ver_...5678");
    expect(vercel?.username).toBe("clouddev");
  });

  it("authenticates and connects account only when provider test passes", async () => {
    // Attempt invalid token
    const failRes = await deployMgr.connectAccount("vercel", "invalid_token");
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain("vercel.com/account/tokens");
    expect(credStore.getRawToken("vercel")).toBeNull();

    // Connect valid token
    const passRes = await deployMgr.connectAccount("vercel", "valid_token_12345678");
    expect(passRes.ok).toBe(true);
    expect(passRes.account?.username).toBe("clouddev");
    expect(credStore.getRawToken("vercel")).toBe("valid_token_12345678");
  });

  it("prompts user with ask_user choices based on genuinely connected providers", () => {
    // 0 connected
    const p0 = deployMgr.promptWhereToDeploy();
    expect(p0.connectedProviders.length).toBe(0);
    expect(p0.options).toContain("Connect Vercel account");

    // 1 connected
    credStore.setCredential("vercel", "valid_token", { username: "clouddev" });
    const p1 = deployMgr.promptWhereToDeploy();
    expect(p1.connectedProviders).toContain("vercel");
    expect(p1.options.some((o) => o.includes("Deploy to VERCEL (clouddev)"))).toBe(true);
  });

  it("deploys project, streams logs, and updates project status to live", async () => {
    credStore.setCredential("vercel", "valid_token");
    const project = projMgr.createProject({ name: "Portfolio App", framework: "html" });
    expect(project.state).toBe("draft");

    const record = await deployMgr.deploy("vercel", {
      projectId: project.id,
      projectName: project.name,
      target: "production",
    });

    expect(record.status).toBe("ready");
    expect(record.url).toBe("https://portfolio-app.vercel.app");

    // Project state transitioned to live
    const updated = projMgr.getProject(project.id);
    expect(updated?.state).toBe("live");
    expect(updated?.deployment.provider).toBe("vercel");
    expect(updated?.deployment.url).toBe("https://portfolio-app.vercel.app");

    // Retrieve logs
    const logs = await deployMgr.getLogs("vercel", record.id);
    expect(logs).toContain("Deployment finalized");

    // Cancel deployment
    const cancelled = await deployMgr.cancel("vercel", record.id);
    expect(cancelled).toBe(true);
  });
});

// Render Deployment Provider (Phase G)
//
// Pure HTTPS API-based implementation for Render.
// Zero Render CLI dependency.
// Supports web services, static sites, and backend services.

import type {
  DeploymentOptions,
  DeploymentRecord,
  DeploymentProvider,
  ProviderAccountInfo,
  DeploymentLifecycleStatus,
} from "./types.ts";

export class RenderDeploymentProvider implements DeploymentProvider {
  readonly id = "render" as const;
  readonly name = "Render";
  private readonly apiBase: string;

  constructor(apiBase = "https://api.render.com/v1") {
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "OpenMausBot-MOBOT/1.0 (Android)",
    };
  }

  async testConnection(token: string): Promise<{ ok: boolean; account?: ProviderAccountInfo; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/owners?limit=1`, {
        headers: this.headers(token),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `Render authentication failed (HTTP ${res.status}): ${text.slice(0, 200)}` };
      }

      const list = (await res.json()) as any[];
      const first = Array.isArray(list) && list.length > 0 ? list[0]?.owner : null;

      return {
        ok: true,
        account: {
          provider: "render",
          connected: true,
          username: first?.name || "Render Owner",
          email: first?.email,
          teamId: first?.id,
          lastTestedAt: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      return { ok: false, error: err.message || "Failed to reach Render API." };
    }
  }

  async createDeployment(token: string, options: DeploymentOptions): Promise<DeploymentRecord> {
    const now = new Date().toISOString();
    const cleanName = options.projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    const target = options.target || "production";

    // 1. First lookup existing services with matching name or create a service
    try {
      // Find or create service
      let serviceId = options.projectId;
      let serviceUrl: string | undefined;

      const servicesRes = await fetch(`${this.apiBase}/services?name=${encodeURIComponent(cleanName)}&limit=1`, {
        headers: this.headers(token),
        signal: AbortSignal.timeout(15_000),
      });

      let found = false;
      if (servicesRes.ok) {
        const servicesList = (await servicesRes.json()) as any[];
        if (Array.isArray(servicesList) && servicesList.length > 0) {
          const svc = servicesList[0]?.service;
          if (svc) {
            serviceId = svc.id;
            serviceUrl = svc.serviceDetails?.url;
            found = true;
          }
        }
      }

      // If service does not exist, create a static site or web service
      if (!found && options.repoUrl) {
        // Need ownerId
        const ownersRes = await fetch(`${this.apiBase}/owners?limit=1`, {
          headers: this.headers(token),
          signal: AbortSignal.timeout(10_000),
        });
        const owners = (await ownersRes.json()) as any[];
        const ownerId = owners[0]?.owner?.id;

        const createSvcRes = await fetch(`${this.apiBase}/services`, {
          method: "POST",
          headers: this.headers(token),
          body: JSON.stringify({
            type: "static_site",
            name: cleanName,
            ownerId,
            repo: options.repoUrl,
            branch: options.branch || "main",
            serviceDetails: {
              buildCommand: "npm run build",
              publishPath: "dist",
            },
          }),
          signal: AbortSignal.timeout(20_000),
        });

        if (createSvcRes.ok) {
          const newSvc = (await createSvcRes.json()) as any;
          serviceId = newSvc.id;
          serviceUrl = newSvc.serviceDetails?.url;
        }
      }

      // 2. Trigger deployment
      const deployRes = await fetch(`${this.apiBase}/services/${serviceId}/deploys`, {
        method: "POST",
        headers: this.headers(token),
        body: JSON.stringify({
          clearCache: "clear",
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!deployRes.ok) {
        const text = await deployRes.text();
        return {
          id: `rnd_failed_${Date.now()}`,
          provider: "render",
          projectId: options.projectId,
          projectName: options.projectName,
          target,
          status: "error",
          error: `Render deploy trigger failed (HTTP ${deployRes.status}): ${text.slice(0, 200)}`,
          createdAt: now,
          updatedAt: now,
        };
      }

      const deployData = (await deployRes.json()) as any;
      const status = this.mapStatus(deployData.status);

      return {
        id: deployData.id || `rnd_dep_${Date.now()}`,
        provider: "render",
        projectId: serviceId,
        projectName: options.projectName,
        target,
        status,
        url: serviceUrl,
        createdAt: new Date(deployData.createdAt || Date.now()).toISOString(),
        updatedAt: now,
      };
    } catch (err: any) {
      return {
        id: `rnd_err_${Date.now()}`,
        provider: "render",
        projectId: options.projectId,
        projectName: options.projectName,
        target,
        status: "error",
        error: `Network error connecting to Render: ${err.message}`,
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  async getDeploymentStatus(token: string, deploymentId: string): Promise<DeploymentRecord> {
    // If deploymentId has format serviceId:deployId or standalone deployId
    const parts = deploymentId.split(":");
    const serviceId = parts[0];
    const deployId = parts[1] || parts[0];

    const res = await fetch(`${this.apiBase}/services/${serviceId}/deploys/${deployId}`, {
      headers: this.headers(token),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Failed to query Render deploy status (HTTP ${res.status})`);
    }

    const data = (await res.json()) as any;
    const status = this.mapStatus(data.status);

    // Also get service URL if not available in deploy record
    let url: string | undefined;
    try {
      const svcRes = await fetch(`${this.apiBase}/services/${serviceId}`, {
        headers: this.headers(token),
        signal: AbortSignal.timeout(10_000),
      });
      if (svcRes.ok) {
        const svc = (await svcRes.json()) as any;
        url = svc.serviceDetails?.url;
      }
    } catch {}

    return {
      id: deploymentId,
      provider: "render",
      projectId: serviceId,
      projectName: data.serviceId || "render-service",
      target: "production",
      status,
      url,
      createdAt: new Date(data.createdAt || Date.now()).toISOString(),
      updatedAt: new Date(data.updatedAt || Date.now()).toISOString(),
    };
  }

  async getDeploymentLogs(_token: string, deploymentId: string, _maxLines = 100): Promise<string> {
    return `Render deployment ${deploymentId}: build in progress or completed. Review real-time events via dashboard.`;
  }

  async redeploy(token: string, deploymentId: string): Promise<DeploymentRecord> {
    const parts = deploymentId.split(":");
    const serviceId = parts[0];
    return this.createDeployment(token, {
      projectId: serviceId,
      projectName: serviceId,
    });
  }

  async cancelDeployment(_token: string, _deploymentId: string): Promise<boolean> {
    return false; // Render API v1 doesn't offer a direct cancel deploy endpoint
  }

  private mapStatus(raw: string | undefined): DeploymentLifecycleStatus {
    const s = String(raw || "").toLowerCase();
    if (s === "live") return "ready";
    if (s.includes("in_progress") || s === "created" || s === "queued") return "building";
    if (s.includes("failed") || s === "deactivated") return "error";
    if (s === "canceled" || s === "cancelled") return "cancelled";
    return "queued";
  }
}

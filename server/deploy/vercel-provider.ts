// Vercel Deployment Provider (Phase F)
//
// Pure HTTPS API-based implementation. Zero Vercel CLI dependency.
// Runs natively within the embedded Android host environment.

import type {
  DeploymentOptions,
  DeploymentRecord,
  DeploymentProvider,
  ProviderAccountInfo,
  DeploymentLifecycleStatus,
} from "./types.ts";

export class VercelDeploymentProvider implements DeploymentProvider {
  readonly id = "vercel" as const;
  readonly name = "Vercel";
  private readonly apiBase: string;

  constructor(apiBase = "https://api.vercel.com") {
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token.trim()}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenMausBot-MOBOT/1.0 (Android)",
    };
  }

  async testConnection(token: string): Promise<{ ok: boolean; account?: ProviderAccountInfo; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      return { ok: false, error: "Vercel access token cannot be empty." };
    }

    try {
      const res = await fetch(`${this.apiBase}/v2/user`, {
        headers: this.headers(cleanToken),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            error: "Authentication failed: Invalid or expired Vercel API token. Please generate a new token at vercel.com/account/tokens.",
          };
        }
        if (res.status === 429) {
          return { ok: false, error: "Vercel rate limit exceeded. Please wait a moment before testing again." };
        }
        const text = await res.text();
        return { ok: false, error: `Authentication failed (HTTP ${res.status}): ${text.slice(0, 200)}` };
      }

      const data = (await res.json()) as any;
      const user = data.user || data;
      return {
        ok: true,
        account: {
          provider: "vercel",
          connected: true,
          username: user.username || user.name || "Vercel User",
          email: user.email,
          lastTestedAt: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.message?.includes("timeout")) {
        return { ok: false, error: "Connection to Vercel timed out after 15 seconds. Please check your network connection." };
      }
      return { ok: false, error: err.message || "Failed to reach Vercel API." };
    }
  }

  async createDeployment(token: string, options: DeploymentOptions): Promise<DeploymentRecord> {
    const now = new Date().toISOString();
    const cleanName = options.projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    const target = options.target || "production";

    if (!options.files || options.files.length === 0) {
      return {
        id: `ver_failed_${Date.now()}`,
        provider: "vercel",
        projectId: options.projectId,
        projectName: options.projectName,
        target,
        status: "error",
        error: "No project files available to deploy. Please build or scaffold the project first.",
        createdAt: now,
        updatedAt: now,
      };
    }

    // Format files payload for Vercel v13 API
    const filesPayload = options.files.map((f) => {
      const encoding = f.encoding || "utf-8";
      return {
        file: f.file.startsWith("/") ? f.file.slice(1) : f.file,
        data: f.data,
        encoding,
      };
    });

    const body: Record<string, unknown> = {
      name: cleanName,
      target,
      project: cleanName,
      files: filesPayload,
    };

    if (options.env && Object.keys(options.env).length > 0) {
      body.env = options.env;
    }

    try {
      const res = await fetch(`${this.apiBase}/v13/deployments`, {
        method: "POST",
        headers: this.headers(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        let errDetail = data?.error?.message || (await res.text()).slice(0, 300);
        if (res.status === 401 || res.status === 403) {
          errDetail = "Invalid or expired Vercel API token. Please re-authenticate.";
        } else if (res.status === 429) {
          errDetail = "Vercel rate limit reached. Please wait before retrying.";
        }
        return {
          id: `ver_failed_${Date.now()}`,
          provider: "vercel",
          projectId: options.projectId,
          projectName: options.projectName,
          target,
          status: "error",
          error: `Vercel deployment failed: ${errDetail}`,
          createdAt: now,
          updatedAt: now,
        };
      }

      const status = this.mapStatus(data.readyState || data.status);
      const url = data.url ? (data.url.startsWith("http") ? data.url : `https://${data.url}`) : undefined;

      return {
        id: data.id || data.uid,
        provider: "vercel",
        projectId: options.projectId,
        projectName: options.projectName,
        target,
        status,
        url,
        createdAt: new Date(data.createdAt || data.created || Date.now()).toISOString(),
        updatedAt: now,
      };
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
      return {
        id: `ver_err_${Date.now()}`,
        provider: "vercel",
        projectId: options.projectId,
        projectName: options.projectName,
        target,
        status: "error",
        error: isTimeout
          ? "Vercel deployment timed out after 30 seconds. Please check your network connection."
          : `Network error connecting to Vercel: ${err.message}`,
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  async getDeploymentStatus(token: string, deploymentId: string): Promise<DeploymentRecord> {
    const res = await fetch(`${this.apiBase}/v13/deployments/${deploymentId}`, {
      headers: this.headers(token),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Failed to query Vercel deployment status (HTTP ${res.status})`);
    }

    const data = (await res.json()) as any;
    const status = this.mapStatus(data.readyState || data.status);
    const url = data.url ? (data.url.startsWith("http") ? data.url : `https://${data.url}`) : undefined;

    return {
      id: data.id || deploymentId,
      provider: "vercel",
      projectId: data.projectId || data.name || "unknown",
      projectName: data.name || "unknown",
      target: (data.target as any) || "production",
      status,
      url,
      error: data.errorMessage || undefined,
      createdAt: new Date(data.createdAt || data.created || Date.now()).toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getDeploymentLogs(token: string, deploymentId: string, maxLines = 100): Promise<string> {
    try {
      const res = await fetch(`${this.apiBase}/v3/deployments/${deploymentId}/events`, {
        headers: this.headers(token),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return `Build logs unavailable (HTTP ${res.status})`;
      }

      const events = (await res.json()) as any[];
      if (!Array.isArray(events)) return "No build logs recorded.";

      const lines = events
        .map((e) => (typeof e === "string" ? e : e.text || e.payload?.text || ""))
        .filter(Boolean);

      return lines.slice(-maxLines).join("\n") || "Build completed with no logs recorded.";
    } catch (err: any) {
      return `Failed to fetch build logs: ${err.message}`;
    }
  }

  async redeploy(token: string, deploymentId: string): Promise<DeploymentRecord> {
    const current = await this.getDeploymentStatus(token, deploymentId);
    return this.createDeployment(token, {
      projectId: current.projectId,
      projectName: current.projectName,
      target: current.target,
    });
  }

  async cancelDeployment(token: string, deploymentId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/v12/deployments/${deploymentId}/cancel`, {
        method: "PATCH",
        headers: this.headers(token),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private mapStatus(raw: string | undefined): DeploymentLifecycleStatus {
    const s = String(raw || "").toUpperCase();
    if (s === "READY") return "ready";
    if (s === "BUILDING" || s === "INITIALIZING") return "building";
    if (s === "QUEUED") return "queued";
    if (s === "CANCELED" || s === "CANCELLED") return "cancelled";
    if (s === "ERROR") return "error";
    return "queued";
  }
}

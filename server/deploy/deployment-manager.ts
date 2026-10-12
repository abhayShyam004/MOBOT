// DeploymentManager: Common deployment coordinator for Phase F (Vercel) & Phase G (Render)
//
// Answers "Where should I deploy this?" by enumerating genuinely connected providers,
// abstracts provider-specific details from App Builder, and records deployment outcomes.

import { DeploymentCredentialStore } from "./credentials.ts";
import { VercelDeploymentProvider } from "./vercel-provider.ts";
import { RenderDeploymentProvider } from "./render-provider.ts";
import type { ProjectManager } from "../app-builder/project-manager.ts";
import type {
  DeploymentFile,
  DeploymentOptions,
  DeploymentProvider,
  DeploymentProviderId,
  DeploymentRecord,
  ProviderAccountInfo,
} from "./types.ts";

export class DeploymentManager {
  readonly credentialStore: DeploymentCredentialStore;
  readonly providers = new Map<DeploymentProviderId, DeploymentProvider>();
  private readonly projectManager?: ProjectManager;

  constructor(
    credentialStore?: DeploymentCredentialStore,
    customProviders?: DeploymentProvider[],
    projectManager?: ProjectManager
  ) {
    this.credentialStore = credentialStore || new DeploymentCredentialStore();
    this.projectManager = projectManager;

    if (customProviders && customProviders.length > 0) {
      for (const p of customProviders) {
        this.providers.set(p.id, p);
      }
    } else {
      this.providers.set("vercel", new VercelDeploymentProvider());
      this.providers.set("render", new RenderDeploymentProvider());
    }
  }

  getProvider(providerId: DeploymentProviderId): DeploymentProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Deployment provider "${providerId}" is not supported.`);
    }
    return provider;
  }

  listAccounts(): ProviderAccountInfo[] {
    return this.credentialStore.listConnectedAccounts();
  }

  getConnectedProviders(): DeploymentProviderId[] {
    return this.credentialStore
      .listConnectedAccounts()
      .filter((a) => a.connected)
      .map((a) => a.provider);
  }

  /**
   * Generates prompt question and selectable choices for `ask_user`
   * based on genuinely connected providers.
   */
  promptWhereToDeploy(): { question: string; options: string[]; connectedProviders: DeploymentProviderId[] } {
    const connected = this.getConnectedProviders();
    if (connected.length === 0) {
      return {
        question: "No deployment accounts are currently connected. How would you like to deploy this application?",
        options: [
          "Connect Vercel account",
          "Connect Render account",
          "Continue with local preview only",
        ],
        connectedProviders: [],
      };
    }

    const options = connected.map((p) => {
      const info = this.credentialStore.getAccountInfo(p);
      const username = info.username ? ` (${info.username})` : "";
      return `Deploy to ${p.toUpperCase()}${username}`;
    });
    options.push("Connect another provider");
    options.push("Cancel deployment");

    return {
      question: "Where should I deploy this application?",
      options,
      connectedProviders: connected,
    };
  }

  async connectAccount(
    providerId: DeploymentProviderId,
    token: string
  ): Promise<{ ok: boolean; account?: ProviderAccountInfo; error?: string }> {
    const provider = this.getProvider(providerId);
    const testResult = await provider.testConnection(token);
    if (!testResult.ok || !testResult.account) {
      return { ok: false, error: testResult.error || "Failed to verify credentials with provider." };
    }

    const saved = this.credentialStore.setCredential(providerId, token, {
      username: testResult.account.username,
      email: testResult.account.email,
      teamId: testResult.account.teamId,
      teamName: testResult.account.teamName,
    });

    return { ok: true, account: saved };
  }

  disconnectAccount(providerId: DeploymentProviderId): boolean {
    return this.credentialStore.removeCredential(providerId);
  }

  async deploy(
    providerId: DeploymentProviderId,
    options: DeploymentOptions
  ): Promise<DeploymentRecord> {
    const token = this.credentialStore.getRawToken(providerId);
    if (!token) {
      throw new Error(
        `No credentials found for ${providerId}. Connect your account with a personal access token first.`
      );
    }

    const provider = this.getProvider(providerId);

    // If project files are not supplied and projectManager is available, collect files
    let deploymentFiles = options.files;
    if ((!deploymentFiles || deploymentFiles.length === 0) && this.projectManager) {
      const fileList = this.projectManager.listProjectFiles(options.projectId);
      deploymentFiles = fileList
        .filter((f) => !f.isDir && !f.path.startsWith(".omb") && !f.path.startsWith(".git") && !f.path.startsWith(".env.local"))
        .map((f): DeploymentFile => {
          const res = this.projectManager!.readFile(options.projectId, f.path);
          return {
            file: f.path,
            data: res.content,
            encoding: "utf-8",
            size: f.size,
          };
        });
    }

    const record = await provider.createDeployment(token, {
      ...options,
      files: deploymentFiles,
    });

    // Update project state if projectManager is available
    if (this.projectManager) {
      const project = this.projectManager.getProject(options.projectId);
      if (project) {
        project.deployment = {
          provider: providerId,
          status: record.status,
          url: record.url,
          deploymentId: record.id,
          lastDeployed: new Date().toISOString(),
          error: record.error,
        };
        if (record.status === "ready") {
          project.state = "live";
        }
        this.projectManager.saveProjectRecord(project);
      }
    }

    return record;
  }

  async getStatus(providerId: DeploymentProviderId, deploymentId: string): Promise<DeploymentRecord> {
    const token = this.credentialStore.getRawToken(providerId);
    if (!token) {
      throw new Error(`No credentials found for ${providerId}.`);
    }
    const provider = this.getProvider(providerId);
    return provider.getDeploymentStatus(token, deploymentId);
  }

  async getLogs(providerId: DeploymentProviderId, deploymentId: string, maxLines?: number): Promise<string> {
    const token = this.credentialStore.getRawToken(providerId);
    if (!token) {
      throw new Error(`No credentials found for ${providerId}.`);
    }
    const provider = this.getProvider(providerId);
    return provider.getDeploymentLogs(token, deploymentId, maxLines);
  }

  async redeploy(providerId: DeploymentProviderId, deploymentId: string): Promise<DeploymentRecord> {
    const token = this.credentialStore.getRawToken(providerId);
    if (!token) {
      throw new Error(`No credentials found for ${providerId}.`);
    }
    const provider = this.getProvider(providerId);
    return provider.redeploy(token, deploymentId);
  }

  async cancel(providerId: DeploymentProviderId, deploymentId: string): Promise<boolean> {
    const token = this.credentialStore.getRawToken(providerId);
    if (!token) {
      throw new Error(`No credentials found for ${providerId}.`);
    }
    const provider = this.getProvider(providerId);
    return provider.cancelDeployment(token, deploymentId);
  }
}


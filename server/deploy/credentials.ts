// Secure Credential Management for Deployment Providers (Phase F & Phase G)
//
// Invariants:
// 1. Files written with mode 0o600 (owner-only).
// 2. Access tokens are NEVER exposed in plain text in logs, UI, or API responses.
// 3. Masked everywhere: e.g. "ver_...3456".

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import type { DeploymentProviderId, ProviderAccountInfo } from "./types.ts";

export interface StoredProviderCredential {
  provider: DeploymentProviderId;
  token: string;
  username?: string;
  email?: string;
  teamId?: string;
  teamName?: string;
  connectedAt: string;
  lastTestedAt?: string;
}

export function maskToken(token: string): string {
  const clean = token.trim();
  if (clean.length <= 8) return "••••••••";
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}...${suffix}`;
}

export class DeploymentCredentialStore {
  readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || join(DATA_DIR, "deploy-credentials.json");
  }

  private readAll(): Record<string, StoredProviderCredential> {
    if (!existsSync(this.filePath)) return {};
    try {
      const content = readFileSync(this.filePath, "utf8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private saveAll(data: Record<string, StoredProviderCredential>): void {
    writeFileAtomic(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  getRawToken(provider: DeploymentProviderId): string | null {
    const all = this.readAll();
    const cred = all[provider];
    return cred ? cred.token : null;
  }

  getAccountInfo(provider: DeploymentProviderId): ProviderAccountInfo {
    const all = this.readAll();
    const cred = all[provider];
    if (!cred) {
      return { provider, connected: false };
    }
    return {
      provider,
      connected: true,
      username: cred.username,
      email: cred.email,
      teamId: cred.teamId,
      teamName: cred.teamName,
      maskedToken: maskToken(cred.token),
      lastTestedAt: cred.lastTestedAt,
    };
  }

  listConnectedAccounts(): ProviderAccountInfo[] {
    const all = this.readAll();
    const providers: DeploymentProviderId[] = ["vercel", "render"];
    return providers.map((p) => {
      const cred = all[p];
      if (!cred) return { provider: p, connected: false };
      return {
        provider: p,
        connected: true,
        username: cred.username,
        email: cred.email,
        teamId: cred.teamId,
        teamName: cred.teamName,
        maskedToken: maskToken(cred.token),
        lastTestedAt: cred.lastTestedAt,
      };
    });
  }

  setCredential(
    provider: DeploymentProviderId,
    token: string,
    metadata?: { username?: string; email?: string; teamId?: string; teamName?: string }
  ): ProviderAccountInfo {
    const cleanToken = token.trim();
    if (!cleanToken) throw new Error("Access token cannot be empty.");

    const all = this.readAll();
    const now = new Date().toISOString();

    all[provider] = {
      provider,
      token: cleanToken,
      username: metadata?.username,
      email: metadata?.email,
      teamId: metadata?.teamId,
      teamName: metadata?.teamName,
      connectedAt: now,
      lastTestedAt: now,
    };

    this.saveAll(all);
    return this.getAccountInfo(provider);
  }

  removeCredential(provider: DeploymentProviderId): boolean {
    const all = this.readAll();
    if (!all[provider]) return false;
    delete all[provider];
    this.saveAll(all);
    return true;
  }
}

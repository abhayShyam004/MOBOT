// CapabilitiesManager: Coordinates Phase K Specialized AI Capabilities
//
// Invariants:
// 1. Never fake AI generation (image, video, audio, etc.).
// 2. Capabilities are global and shared across bots.
// 3. Credentials stored securely, masked on read.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type CapabilityConfig,
  type CapabilityExecutionRequest,
  type CapabilityExecutionResult,
  maskApiKey,
  SPECIALIZED_CAPABILITIES_CATALOG,
  type SpecializedCapabilityId,
} from "../../shared/capabilities.ts";

export class CapabilitiesManager {
  private readonly storagePath: string;
  private configs = new Map<SpecializedCapabilityId, CapabilityConfig>();

  constructor(storageDir?: string) {
    const baseDir = storageDir || process.env.DATA_DIR || join(process.cwd(), "data");
    this.storagePath = join(baseDir, "capabilities.json");
    this.initDefaults();
    this.load();
  }

  private initDefaults(): void {
    for (const item of SPECIALIZED_CAPABILITIES_CATALOG) {
      this.configs.set(item.id, {
        id: item.id,
        enabled: false,
        provider: item.supportedProviders[0] || "openai",
        model: item.defaultModel,
      });
    }
  }

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        const raw = JSON.parse(readFileSync(this.storagePath, "utf-8"));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item && item.id) {
              const existing = this.configs.get(item.id);
              if (existing) {
                this.configs.set(item.id, {
                  ...existing,
                  ...item,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[capabilities] Failed to load capabilities.json:", err);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      const array = Array.from(this.configs.values());
      writeFileSync(this.storagePath, JSON.stringify(array, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error("[capabilities] Failed to save capabilities.json:", err);
    }
  }

  /**
   * List all capabilities with masked API keys.
   */
  listCapabilities(): CapabilityConfig[] {
    return Array.from(this.configs.values()).map((cfg) => ({
      ...cfg,
      hasApiKey: Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0),
      apiKey: cfg.apiKey ? maskApiKey(cfg.apiKey) : undefined,
    }));
  }

  getCapability(id: SpecializedCapabilityId): CapabilityConfig | undefined {
    const cfg = this.configs.get(id);
    if (!cfg) return undefined;
    return {
      ...cfg,
      hasApiKey: Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0),
      apiKey: cfg.apiKey ? maskApiKey(cfg.apiKey) : undefined,
    };
  }

  /**
   * Updates configuration for a capability.
   */
  updateCapability(id: SpecializedCapabilityId, patch: Partial<CapabilityConfig>): CapabilityConfig {
    const existing = this.configs.get(id);
    if (!existing) {
      throw new Error(`Capability "${id}" is not recognized.`);
    }

    const updated: CapabilityConfig = {
      ...existing,
      ...patch,
      id,
    };

    // If new apiKey provided, update it; if null/empty string, remove it; if undefined/masked, preserve existing
    if (patch.apiKey !== undefined) {
      if (patch.apiKey.includes("...") && existing.apiKey) {
        // Preserving masked key
        updated.apiKey = existing.apiKey;
      } else if (!patch.apiKey.trim()) {
        delete updated.apiKey;
      } else {
        updated.apiKey = patch.apiKey.trim();
      }
    }

    this.configs.set(id, updated);
    this.save();
    return this.getCapability(id)!;
  }

  /**
   * Executes a capability request truthfully.
   */
  async executeCapability(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const start = Date.now();
    const config = this.configs.get(request.capabilityId);

    if (!config || !config.enabled) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        durationMs: Date.now() - start,
        error: `Capability "${request.capabilityId}" is disabled. Enable it in Settings → Models / Capabilities.`,
        actionableResolution: "Open Settings → Models / Capabilities and toggle this capability ON.",
      };
    }

    if (!config.apiKey && config.provider !== "android_local") {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        durationMs: Date.now() - start,
        error: `No API key configured for ${config.provider} (${request.capabilityId}).`,
        actionableResolution: "Add an API key in Settings → Models / Capabilities.",
      };
    }

    // Real Provider Execution
    try {
      if (request.capabilityId === "image_generation" && config.provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model || "dall-e-3",
            prompt: request.prompt,
            n: 1,
            size: "1024x1024",
          }),
        });

        if (!res.ok) {
          const errData: any = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `OpenAI returned status ${res.status}`);
        }

        const data: any = await res.json();
        const imageUrl = data.data?.[0]?.url;

        return {
          ok: true,
          capabilityId: request.capabilityId,
          outputUrl: imageUrl,
          mimeType: "image/png",
          durationMs: Date.now() - start,
        };
      }

      // If other providers are not yet configured or called without real network
      return {
        ok: false,
        capabilityId: request.capabilityId,
        durationMs: Date.now() - start,
        error: `Execution for provider "${config.provider}" under "${request.capabilityId}" requires upstream network credentials.`,
        actionableResolution: "Verify provider network access and credentials in Settings.",
      };
    } catch (err: any) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        durationMs: Date.now() - start,
        error: err.message,
        actionableResolution: "Check API quota, key permissions, or prompt content filters.",
      };
    }
  }
}

// MOBOT Global Specialized AI Capabilities (Phase K)
//
// Shared types and validation for specialized models:
// - Image Generation
// - Video Generation
// - Audio Generation
// - Speech / TTS
// - Music Generation
// - Image Understanding / Vision
// - Video Understanding
// - Audio Understanding
//
// These capabilities are GLOBAL and SHARED across bots.

export type SpecializedCapabilityId =
  | "image_generation"
  | "video_generation"
  | "audio_generation"
  | "speech_tts"
  | "music_generation"
  | "vision_understanding"
  | "video_understanding"
  | "audio_understanding";

export interface CapabilityMetadata {
  id: SpecializedCapabilityId;
  title: string;
  category: "generation" | "understanding" | "speech";
  description: string;
  defaultModel: string;
  supportedProviders: string[];
}

export const SPECIALIZED_CAPABILITIES_CATALOG: CapabilityMetadata[] = [
  {
    id: "image_generation",
    title: "Image Generation",
    category: "generation",
    description: "Generates photorealistic images, UI assets, illustrations, and art from text briefs.",
    defaultModel: "dall-e-3",
    supportedProviders: ["openai", "google", "replicate", "fal", "custom"],
  },
  {
    id: "video_generation",
    title: "Video Generation",
    category: "generation",
    description: "Generates short video clips, motion graphics, and scene sequences.",
    defaultModel: "veo-2",
    supportedProviders: ["google", "luma", "runway", "custom"],
  },
  {
    id: "audio_generation",
    title: "Audio Generation",
    category: "generation",
    description: "Generates sound effects, ambient audio, and foley.",
    defaultModel: "audiocraft",
    supportedProviders: ["replicate", "elevenlabs", "custom"],
  },
  {
    id: "speech_tts",
    title: "Speech & TTS",
    category: "speech",
    description: "High-fidelity text-to-speech synthesis with natural tone and pacing.",
    defaultModel: "tts-1-hd",
    supportedProviders: ["openai", "elevenlabs", "google", "custom"],
  },
  {
    id: "music_generation",
    title: "Music Generation",
    category: "generation",
    description: "Synthesizes musical tracks and instrumental themes.",
    defaultModel: "musicgen",
    supportedProviders: ["replicate", "suno", "custom"],
  },
  {
    id: "vision_understanding",
    title: "Vision & Image Intelligence",
    category: "understanding",
    description: "Deep visual document, layout, UI screenshot, and scene comprehension.",
    defaultModel: "gpt-4o",
    supportedProviders: ["openai", "anthropic", "google", "custom"],
  },
  {
    id: "video_understanding",
    title: "Video Intelligence",
    category: "understanding",
    description: "Temporal video scene analysis and event timestamping.",
    defaultModel: "gemini-1.5-pro",
    supportedProviders: ["google", "custom"],
  },
  {
    id: "audio_understanding",
    title: "Audio & Speech Recognition",
    category: "understanding",
    description: "Transcription, diarization, and acoustic context understanding.",
    defaultModel: "whisper-1",
    supportedProviders: ["openai", "groq", "custom"],
  },
];

export interface CapabilityConfig {
  id: SpecializedCapabilityId;
  enabled: boolean;
  provider: string;
  model: string;
  apiKey?: string; // Stored securely; masked on wire reads
  baseUrl?: string;
  hasApiKey?: boolean; // Set on read to indicate credentials presence without leaking key
  limits?: {
    maxPerDay?: number;
    timeoutSeconds?: number;
  };
  costMetadata?: {
    estimatePerCall?: string;
    currency?: string;
  };
}

export interface CapabilityExecutionRequest {
  capabilityId: SpecializedCapabilityId;
  prompt: string;
  options?: Record<string, unknown>;
}

export interface CapabilityExecutionResult {
  ok: boolean;
  capabilityId: SpecializedCapabilityId;
  outputUrl?: string;
  outputText?: string;
  mimeType?: string;
  durationMs: number;
  error?: string;
  actionableResolution?: string;
}

export function maskApiKey(key?: string): string {
  if (!key || key.length < 8) return "";
  return key.slice(0, 3) + "..." + key.slice(-4);
}

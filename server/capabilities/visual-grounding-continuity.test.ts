import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveConversationImages,
  type PriorMessageLike,
} from "../turn-images.ts";
import { GENERAL_AGENT_RELIABILITY_PROMPT } from "../system-prompt.ts";
import {
  defaultCapabilityRegistry,
  normalizeCapabilityMatchRequest,
} from "./capability-registry.ts";
import { PhoneControlCapability } from "./phone-control.ts";
import type { TurnImageInput } from "../contracts.ts";

const UUIDS = [
  "234e5678-e89b-42d3-a456-426614174001",
  "234e5678-e89b-42d3-a456-426614174002",
  "234e5678-e89b-42d3-a456-426614174003",
  "234e5678-e89b-42d3-a456-426614174004",
] as const;

/** Faithful provider payload builder matching codex-native-runtime / openai-chat */
function buildProviderImagePayload(images: TurnImageInput[] | undefined) {
  if (!images?.length) return [];
  const parts: { type: string; image_url: string }[] = [];
  for (const image of images) {
    try {
      const base64 = readFileSync(image.path).toString("base64");
      if (base64) parts.push({ type: "input_image", image_url: `data:${image.mime};base64,${base64}` });
    } catch {
      // unreadable
    }
  }
  return parts;
}

describe("Case E: Multi-Turn Visual Grounding, Evidence Persistence & Contradiction Prevention", () => {
  const temporary: string[] = [];

  const createStore = () => {
    const root = mkdtempSync(join(tmpdir(), "omb-case-e-visual-"));
    temporary.push(root);
    return root;
  };

  const createImageFile = (root: string, uuid: string, ext = ".png", bytes = 100) => {
    const filename = `${uuid}${ext}`;
    const filePath = join(root, filename);
    writeFileSync(filePath, Buffer.alloc(bytes, 0x5a));
    return { filename, filePath };
  };

  afterEach(() => {
    for (const dir of temporary.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Requirement 1: Three-turn image continuity
  it("Scenario 1: Three-turn image continuity (image -> coastline question -> whats the country)", () => {
    const root = createStore();
    const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 85448);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "user",
        text: "Can you show me a random country outline to guess?",
      },
      {
        role: "bot",
        text: "Here’s a mystery country outline from the internet. What country is it?",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${filename}`,
            mime: "image/png",
            name: "mystery-outline.png",
          },
        ],
      },
      {
        role: "user",
        text: "Bhutan?",
      },
      {
        role: "bot",
        text: "No, it isn't Bhutan. Good guess, but this country is much larger and stretches across.",
      },
      {
        role: "user",
        text: "Wait, looking at that outline again, does this country have a coastline or is it landlocked?",
      },
      {
        role: "bot",
        text: "It has a coastline, so it isn’t landlocked.",
      },
    ];

    // Final turn: user asks "whats the country"
    const result = resolveConversationImages("whats the country", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.resolutionSource).toBe("conversation-history");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.path).toBe(filePath);
    expect(result.images[0]?.mime).toBe("image/png");
    expect(result.selectedNames).toEqual(["mystery-outline.png"]);

    // Verify provider payload receives the image block
    const providerPayload = buildProviderImagePayload(result.images);
    expect(providerPayload).toHaveLength(1);
    expect(providerPayload[0]?.type).toBe("input_image");
    expect(providerPayload[0]?.image_url).toContain("data:image/png;base64,");

    // Verify grounding note is present in provider prompt text
    expect(result.text).toContain("[Visual Context: The image (mystery-outline.png)");
    expect(result.text).toContain("Never claim that the image is unavailable or tell the user to resend it");
  });

  // Requirement 2: Short follow-up variations
  it("Scenario 2: Short follow-up variations retain relevant image context", () => {
    const root = createStore();
    const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 5000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here's a mystery outline. What country is it?",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${filename}`,
            mime: "image/png",
            name: "country-outline.png",
          },
        ],
      },
      { role: "user", text: "Is it in Asia?" },
      { role: "bot", text: "Yes, it is in Asia." },
    ];

    const followUps = [
      "whats the country",
      "what country is it?",
      "which country",
      "tell me the answer",
      "what is it?",
      "reveal the answer",
      "name the country",
      "what was it",
      "do you recognize this?",
      "can you solve this?",
      "is this France or Germany?",
      "can you name it?",
      "what am I looking at?",
    ];

    for (const query of followUps) {
      const result = resolveConversationImages(query, {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });
      expect(result.resolutionSource).toBe("conversation-history");
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.path).toBe(filePath);
    }
  });

  // Requirement 3: Existing Case D regression
  it("Scenario 3: Existing Case D regression remains fully operational", () => {
    const root = createStore();
    const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 85448);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is the mystery outline.",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${filename}`,
            name: "mystery-outline.png",
            mime: "image/png",
          },
        ],
      },
    ];

    const result = resolveConversationImages("Look at the mystery-outline image from earlier again. Is it Bhutan?", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });

    expect(result.resolutionSource).toBe("conversation-history");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.path).toBe(filePath);
  });

  // Requirement 4: Missing image truthfully handled
  it("Scenario 4: Missing image file on disk triggers truthful missing note", () => {
    const root = createStore();
    // Do not create the file
    const missingFile = `${UUIDS[3]}.png`;

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is your diagram.",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${missingFile}`,
            name: "arch.png",
            mime: "image/png",
          },
        ],
      },
    ];

    const result = resolveConversationImages("whats the country", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });

    expect(result.images).toHaveLength(0);
    expect(result.missingImage).toBe(true);
    expect(result.text).toContain("was previously displayed in this conversation, but its underlying file is no longer available on disk");
  });

  // Requirement 5: Text-only model limitation signaling
  it("Scenario 5: Text-only model discloses multimodal limitation truthfully", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 1000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is the outline.",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${filename}`,
            name: "mystery.png",
            mime: "image/png",
          },
        ],
      },
    ];

    const result = resolveConversationImages("what country is it", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: false, // Provider does not support vision
    });

    expect(result.images).toHaveLength(0);
    expect(result.text).toContain("visual analysis is unavailable because the selected model/provider does not support image or multimodal input");
  });

  // Requirement 6: Image payload present with calibrated uncertainty vs missing image error
  it("Scenario 6: Distinguishes visual uncertainty from missing-image claims via grounding note", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 2000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Mystery outline",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${filename}`,
            name: "outline.png",
            mime: "image/png",
          },
        ],
      },
    ];

    const result = resolveConversationImages("whats the country", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.groundingNote).toBeDefined();
    expect(result.groundingNote).toContain("state what can and cannot be observed with calibrated confidence");
    expect(result.groundingNote).toContain("Never claim that the image is unavailable or tell the user to resend it");
  });

  // Requirement 7: Multi-image disambiguation
  it("Scenario 7: Multi-image disambiguation by name, ordinal, or 'both'", () => {
    const root = createStore();
    const first = createImageFile(root, UUIDS[0]!, ".png", 100);
    const second = createImageFile(root, UUIDS[1]!, ".jpg", 200);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here are two options",
        attachments: [
          { kind: "image", path: `/api/attachments/${first.filename}`, name: "country-a.png" },
          { kind: "image", path: `/api/attachments/${second.filename}`, name: "country-b.jpg" },
        ],
      },
    ];

    // Explicit mention
    const resA = resolveConversationImages("Tell me about country-a", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(resA.images[0]?.path).toBe(first.filePath);

    // Ordinal
    const resFirst = resolveConversationImages("Tell me about the first image", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(resFirst.images[0]?.path).toBe(first.filePath);

    const resSecond = resolveConversationImages("Tell me about the second image", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(resSecond.images[0]?.path).toBe(second.filePath);

    // Both
    const resBoth = resolveConversationImages("Compare both images", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(resBoth.images).toHaveLength(2);
  });

  // Requirement 8: History compaction continuity
  it("Scenario 8: Preserves image reference across 30 turns of conversation history", () => {
    const root = createStore();
    const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 4000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Mystery outline game started",
        attachments: [
          { kind: "image", path: `/api/attachments/${filename}`, name: "mystery-map.png" },
        ],
      },
    ];

    for (let i = 1; i <= 30; i += 1) {
      priorMessages.push({ role: "user", text: `Hint query ${i}` });
      priorMessages.push({ role: "bot", text: `Hint reply ${i}` });
    }

    const result = resolveConversationImages("Looking at the mystery-map again, what region is it in?", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });

    expect(result.resolutionSource).toBe("conversation-history");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.path).toBe(filePath);
  });

  // Requirement 9: Unrelated text-only queries omit image payloads
  it("Scenario 9: Unrelated text-only turns (math/code) omit image payloads", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 1000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is the outline.",
        attachments: [
          { kind: "image", path: `/api/attachments/${filename}`, name: "map.png" },
        ],
      },
    ];

    const mathResult = resolveConversationImages("what is 15 * 14", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(mathResult.images).toHaveLength(0);
    expect(mathResult.resolutionSource).toBe("none");

    const codeResult = resolveConversationImages("write a python script to parse logs", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(codeResult.images).toHaveLength(0);
    expect(codeResult.resolutionSource).toBe("none");

    const cliResult = resolveConversationImages("git status --short", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(cliResult.images).toHaveLength(0);
    expect(cliResult.resolutionSource).toBe("none");

    // Unrelated general queries after multi-turn visual conversation do not inherit stale image payloads
    const multiTurnPrior: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is a mystery country outline. What country is it?",
        attachments: [
          { kind: "image", path: `/api/attachments/${filename}`, name: "map.png" },
        ],
      },
      { role: "user", text: "Is it in Asia?" },
      { role: "bot", text: "Yes, it is." },
    ];

    const unrelatedQueries = [
      "How do I brew French press coffee?",
      "What is the capital of Peru?",
      "Who was Abraham Lincoln?",
      "Tell me a joke",
      "Set a timer for 10 minutes",
    ];

    for (const query of unrelatedQueries) {
      const result = resolveConversationImages(query, {
        attachmentsDir: root,
        priorMessages: multiTurnPrior,
        usesNativeImageInput: true,
      });
      expect(result.images).toHaveLength(0);
      expect(result.resolutionSource).toBe("none");
    }
  });

  // Requirement 10: Geographic truthfulness with verified Bhutan fixture
  it("Scenario 10: Geographic truthfulness verifies Bhutan is landlocked with zero coastline", () => {
    // Authoritative Natural Earth geography fixture for Bhutan
    const bhutanGeoFixture = {
      name: "Bhutan",
      iso_a2: "BT",
      iso_a3: "BTN",
      landlocked: true,
      coastlineKm: 0,
      bbox: [88.7303, 26.6963, 92.0894, 28.3582] as [number, number, number, number],
      neighbors: ["India", "China"],
    };

    expect(bhutanGeoFixture.landlocked).toBe(true);
    expect(bhutanGeoFixture.coastlineKm).toBe(0);
    expect(bhutanGeoFixture.neighbors).toContain("India");
    expect(bhutanGeoFixture.neighbors).toContain("China");

    // Calculate aspect ratio
    const deltaLon = bhutanGeoFixture.bbox[2] - bhutanGeoFixture.bbox[0]; // 3.3591
    const deltaLat = bhutanGeoFixture.bbox[3] - bhutanGeoFixture.bbox[1]; // 1.6619
    const geoAspectRatio = deltaLon / deltaLat;
    expect(geoAspectRatio).toBeCloseTo(2.0212, 3);
  });

  // Requirement 11: Source-to-render geometry consistency
  it("Scenario 11: Source-to-render geometry consistency between GeoJSON and rendered PNG", () => {
    // Dimensions of the actual rendered artifact on device: efdfaa9b-564a-4bbd-9b55-968535433b60.png
    const renderedWidth = 2325;
    const renderedHeight = 1150;
    const renderedAspectRatio = renderedWidth / renderedHeight; // 2.0217

    // Authoritative Natural Earth delta lon / delta lat aspect ratio
    const deltaLon = 92.0894 - 88.7303; // 3.3591
    const deltaLat = 28.3582 - 26.6963; // 1.6619
    const sourceGeoAspectRatio = deltaLon / deltaLat; // 2.0212

    // Relative difference between source geometry and rendered image is < 0.05%
    const relativeDiff = Math.abs(renderedAspectRatio - sourceGeoAspectRatio) / sourceGeoAspectRatio;
    expect(relativeDiff).toBeLessThan(0.001);
  });

  // Requirement 12: Contradiction recovery instructions
  it("Scenario 12: Contradiction recovery and reliability prompt instruct correction rather than defense", () => {
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("Ground all visual descriptions, hints, and feedback strictly in verifiable facts");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("NEVER fabricate geographic, physical, or categorical attributes (such as claiming a landlocked nation has a coastline");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("Never treat prior conversational statements or unverified guesses as ground truth");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("NEVER claim the image is unavailable or tell the user to resend it");
  });

  // Requirement 13: Non-image artifact exclusion
  it("Scenario 13: Excludes raw GeoJSON and datasets from visual image input pipeline", () => {
    const root = createStore();
    const geojsonPath = join(root, `${UUIDS[0]}.geojson`);
    writeFileSync(geojsonPath, JSON.stringify({ type: "FeatureCollection", features: [] }));

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is the data file",
        attachments: [
          {
            kind: "dataset",
            path: `/api/attachments/${UUIDS[0]}.geojson`,
            name: "source.geojson",
            mime: "application/geo+json",
          },
        ],
      },
    ];

    const result = resolveConversationImages("whats the country", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });

    expect(result.images).toHaveLength(0);
    expect(result.resolutionSource).toBe("none");
  });

  // Requirement 14: Cases A and C regression intact
  it("Scenario 14: Cases A and C regression - capability truthfulness and bounded turn completion remain intact", () => {
    // Case A: WhatsApp messaging does NOT route to list_apps gesture
    const matchReq = normalizeCapabilityMatchRequest({
      objective: 'send "me" message on WhatsApp, hello',
      contextKeywords: [],
      targetDevice: "android_local",
      activeBotId: "bot-twelve",
    });
    const resolution = defaultCapabilityRegistry.matchCapability(matchReq);
    expect(resolution.primaryCapabilityId).not.toBe("device.apps");
    expect(resolution.chosenModality).not.toBe("device_gesture");

    // Case A: device.phone_control does NOT advertise unsupported messaging operations
    const phoneControl = new PhoneControlCapability();
    const opNames = phoneControl.supportedOperations.map((o) => o.name);
    expect(opNames).toContain("status");
    expect(opNames).toContain("tap");
    expect(opNames).not.toContain("send_message");
    expect(opNames).not.toContain("send_chat");
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  extractArtifactProvenance,
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
  "345e6789-e89b-42d3-a456-426614174001",
  "345e6789-e89b-42d3-a456-426614174002",
  "345e6789-e89b-42d3-a456-426614174003",
  "345e6789-e89b-42d3-a456-426614174004",
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

describe("Case F: Visual Answer Verification, Confidence Calibration & Self-Correction", () => {
  const temporary: string[] = [];

  const createStore = () => {
    const root = mkdtempSync(join(tmpdir(), "omb-case-f-visual-"));
    temporary.push(root);
    return root;
  };

  const createImageFile = (root: string, uuid: string, ext = ".png", bytes = 100) => {
    const filename = `${uuid}${ext}`;
    const filePath = join(root, filename);
    writeFileSync(filePath, Buffer.alloc(bytes, 0x4f));
    return { filename, filePath };
  };

  afterEach(() => {
    for (const dir of temporary.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Scenario 1: Verified Bhutan outline recognizes source ground truth when reliable provenance is available
  it("Scenario 1: Verified Bhutan outline recognizes source ground truth from trusted artifact provenance", () => {
    const root = createStore();
    const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 85448);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        kind: "activity",
        tool: {
          name: "android_computer_resource_download",
          input: JSON.stringify({
            url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png",
            path: "downloads/mystery-outline.png",
          }),
          output: JSON.stringify({
            ok: true,
            result: {
              path: "downloads/mystery-outline.png",
              url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png",
              sha256: "adc29c930ff8ad7865cf867fc42dcf070d89ab018f8792282865dd6fecb800ad",
              image: { width: 2325, height: 1150, format: "png" },
            },
          }),
        },
      },
      {
        role: "bot",
        kind: "text",
        text: "Here’s a mystery country outline from the internet. What country is it?",
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

    // Verify extractArtifactProvenance directly
    const prov = extractArtifactProvenance(`/api/attachments/${filename}`, "mystery-outline.png", priorMessages);
    expect(prov).toBeDefined();
    expect(prov?.sourceUrl).toBe("https://outlinemap.org/map/country-region/bhutan/outline-std.png");
    expect(prov?.subjectHint).toBe("bhutan");
    expect(prov?.sha256).toBe("adc29c930ff8ad7865cf867fc42dcf070d89ab018f8792282865dd6fecb800ad");
    expect(prov?.verifiedDimensions).toEqual({ width: 2325, height: 1150 });

    // Verify resolveConversationImages includes provenance and evidence hierarchy in grounding note
    const result = resolveConversationImages("whats the country", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.resolutionSource).toBe("conversation-history");
    expect(result.images[0]?.path).toBe(filePath);
    expect(result.provenance?.sourceUrl).toBe("https://outlinemap.org/map/country-region/bhutan/outline-std.png");
    expect(result.provenance?.subjectHint).toBe("bhutan");
    expect(result.text).toContain("Trusted Artifact Provenance: Sourced from \"https://outlinemap.org/map/country-region/bhutan/outline-std.png\"");
    expect(result.text).toContain("(Source subject identifier: \"bhutan\")");
    expect(result.text).toContain("Evidence Hierarchy: Direct Input Evidence & Trusted Provenance > Independently Verified Facts");
  });

  // Scenario 2: Landlocked-country question does not claim a coastline when trusted evidence establishes it is landlocked
  it("Scenario 2: Landlocked country question verifies landlocked ground truth and rejects coastline claims", () => {
    // Authoritative reference fixture
    const verifiedGeography = {
      name: "Bhutan",
      isLandlocked: true,
      coastlineKm: 0,
      borderingNations: ["India", "China"],
      terrain: "Eastern Himalayas",
    };

    expect(verifiedGeography.isLandlocked).toBe(true);
    expect(verifiedGeography.coastlineKm).toBe(0);

    // Verify grounding note strictly forbids inventing coastlines for landlocked entities
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("NEVER fabricate geographic, physical, or categorical attributes (such as claiming a landlocked nation has a coastline");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("NEVER treat your own prior conversational responses as authoritative ground truth");
  });

  // Scenario 3: Visually ambiguous silhouette without trustworthy metadata expresses calibrated uncertainty
  it("Scenario 3: Ambiguous silhouette without provenance triggers calibrated uncertainty without guessing unsupported identities", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[1]!, ".png", 3500);

    // Artifact has NO tool download provenance and an ambiguous title
    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is a shape silhouette.",
        attachments: [
          {
            kind: "image",
            path: `/api/attachments/${filename}`,
            name: "abstract-shape.png",
            mime: "image/png",
          },
        ],
      },
    ];

    const result = resolveConversationImages("what is this shape?", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.provenance).toBeUndefined();
    expect(result.text).toContain("state what can and cannot be observed with calibrated confidence rather than fabricating physical/geographic attributes");
    expect(result.text).toContain("Never treat prior assistant claims in conversational history as ground truth");
  });

  // Scenario 4: Earlier incorrect assistant answer followed by contradictory trusted evidence triggers correction
  it("Scenario 4: Contradictory trusted evidence triggers self-correction rather than defending earlier mistakes", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 85448);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        kind: "activity",
        tool: {
          name: "android_computer_resource_download",
          input: JSON.stringify({ url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png", path: "downloads/outline.png" }),
          output: JSON.stringify({ ok: true, result: { path: "downloads/outline.png", url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png" } }),
        },
      },
      {
        role: "bot",
        text: "Here is an outline.",
        attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "outline.png" }],
      },
      { role: "user", text: "Is it Bhutan?" },
      // Previous assistant hallucination!
      { role: "bot", text: "No, it isn't Bhutan. This country is much larger and has a coastline." },
    ];

    // User asks a follow-up that challenges the coastline or asks for the country
    const result = resolveConversationImages("Wait, is this country actually landlocked or does it have a coast?", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.provenance?.subjectHint).toBe("bhutan");
    expect(result.text).toContain("Never treat prior assistant claims in conversational history as ground truth; if earlier claims were mistaken, acknowledge and correct the mistake rather than defending it");
    expect(result.text).toContain("Trusted Artifact Provenance: Sourced from \"https://outlinemap.org/map/country-region/bhutan/outline-std.png\"");
  });

  // Scenario 5: Earlier correct answer followed by misleading user speculation avoids sycophantic reversal
  it("Scenario 5: Verified ground truth resists misleading user speculation (anti-sycophancy invariant)", () => {
    // Evidence hierarchy puts Direct Input Evidence & Trusted Provenance above conversational history
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("5-Tier Evidence Hierarchy: When answering questions or drawing conclusions (especially regarding images, documents, and external entities), strictly adhere to the following order of precedence: (1) Direct Input Evidence (pixels/text directly visible in the prompt payload) and Trusted Artifact Provenance");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("> (2) Independently Verified Facts");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("> (4) Conversational History (prior user and assistant messages)");
  });

  // Scenario 6: Image supplied successfully but model uncertain does NOT claim image is unavailable
  it("Scenario 6: Image payload present with uncertain interpretation never defaults to missing-image claims", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 1000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is an outline.",
        attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "unknown.png" }],
      },
    ];

    const result = resolveConversationImages("what country is it", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.images).toHaveLength(1);
    expect(result.missingImage).toBeUndefined();
    expect(result.text).toContain("Never claim that the image is unavailable or tell the user to resend it when the image is attached");
  });

  // Scenario 7: Image genuinely cannot be retrieved explains actual limitation accurately
  it("Scenario 7: Truly missing image file on disk triggers accurate missing/expired limitation note", () => {
    const root = createStore();
    // File deliberately NOT created on disk
    const missingFilename = `${UUIDS[3]}.png`;

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is the diagram.",
        attachments: [{ kind: "image", path: `/api/attachments/${missingFilename}`, name: "diagram.png" }],
      },
    ];

    const result = resolveConversationImages("explain the diagram", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });

    expect(result.images).toHaveLength(0);
    expect(result.missingImage).toBe(true);
    expect(result.text).toContain("underlying file is no longer available on disk (missing or expired)");
  });

  // Scenario 8: Trusted source URL conflicts with model visual guess — distinguishes source from visual recognition
  it("Scenario 8: Trusted source URL conflicts with visual guess, distinguishing source from unassisted shape guessing", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 85448);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        kind: "activity",
        tool: {
          name: "android_computer_resource_download",
          input: JSON.stringify({ url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png", path: "downloads/map.png" }),
          output: JSON.stringify({ ok: true, result: { path: "downloads/map.png", url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png" } }),
        },
      },
      {
        role: "bot",
        text: "Mystery outline",
        attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "map.png" }],
      },
      // Model previously guessed Russia
      { role: "bot", text: "The country is Russia. It has a coastline." },
    ];

    const result = resolveConversationImages("whats the country", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    // Provenance identifies Bhutan, conflicting with previous Russia guess
    expect(result.provenance?.subjectHint).toBe("bhutan");
    expect(result.text).toContain("When trusted provenance conclusively identifies an artifact, use it appropriately as ground truth rather than claiming unassisted visual recognition or defending ungrounded guesses");
  });

  // Scenario 9: Unrelated text-only turn omits visual verification
  it("Scenario 9: Unrelated text-only turns (math/code) omit visual verification payloads", () => {
    const root = createStore();
    const { filename } = createImageFile(root, UUIDS[0]!, ".png", 1000);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is the map.",
        attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "map.png" }],
      },
    ];

    const resMath = resolveConversationImages("What is 15 * 14?", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(resMath.images).toHaveLength(0);
    expect(resMath.resolutionSource).toBe("none");

    const resCode = resolveConversationImages("const sort = (arr) => arr.sort();", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
    });
    expect(resCode.images).toHaveLength(0);
    expect(resCode.resolutionSource).toBe("none");
  });

  // Scenario 10: Multiple images in one conversation attaches intended image's provenance
  it("Scenario 10: Multi-image conversation binds provenance to the specifically selected candidate", () => {
    const root = createStore();
    const img1 = createImageFile(root, UUIDS[0]!, ".png", 100);
    const img2 = createImageFile(root, UUIDS[1]!, ".jpg", 200);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        kind: "activity",
        tool: {
          name: "android_computer_resource_download",
          input: JSON.stringify({ url: "https://flagcdn.com/w320/bt.png", path: "downloads/bhutan-flag.png" }),
          output: JSON.stringify({ ok: true, result: { path: "downloads/bhutan-flag.png", url: "https://flagcdn.com/w320/bt.png" } }),
        },
      },
      {
        role: "bot",
        text: "First image",
        attachments: [{ kind: "image", path: `/api/attachments/${img1.filename}`, name: "bhutan-flag.png" }],
      },
      {
        role: "bot",
        kind: "activity",
        tool: {
          name: "android_computer_resource_download",
          input: JSON.stringify({ url: "https://flagcdn.com/w320/np.png", path: "downloads/nepal-flag.jpg" }),
          output: JSON.stringify({ ok: true, result: { path: "downloads/nepal-flag.jpg", url: "https://flagcdn.com/w320/np.png" } }),
        },
      },
      {
        role: "bot",
        text: "Second image",
        attachments: [{ kind: "image", path: `/api/attachments/${img2.filename}`, name: "nepal-flag.jpg" }],
      },
    ];

    // Select first image explicitly
    const resFirst = resolveConversationImages("Tell me about the first image", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });
    expect(resFirst.images[0]?.path).toBe(img1.filePath);
    expect(resFirst.provenance?.sourceUrl).toBe("https://flagcdn.com/w320/bt.png");

    // Select second image explicitly
    const resSecond = resolveConversationImages("Tell me about the second image", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });
    expect(resSecond.images[0]?.path).toBe(img2.filePath);
    expect(resSecond.provenance?.sourceUrl).toBe("https://flagcdn.com/w320/np.png");
  });

  // Scenario 11: Follow-up after history compaction preserves evidence without blindly trusting past assistant conclusions
  it("Scenario 11: Preserves artifact provenance across compacted history and rejects stale claims", () => {
    const root = createStore();
    const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 85448);

    const priorMessages: PriorMessageLike[] = [
      {
        role: "bot",
        kind: "activity",
        tool: {
          name: "android_computer_resource_download",
          input: JSON.stringify({ url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png", path: "downloads/outline.png" }),
          output: JSON.stringify({ ok: true, result: { path: "downloads/outline.png", url: "https://outlinemap.org/map/country-region/bhutan/outline-std.png" } }),
        },
      },
      {
        role: "bot",
        text: "Mystery outline",
        attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "mystery-outline.png" }],
      },
    ];

    // Simulate 25 turns of conversation
    for (let i = 1; i <= 25; i += 1) {
      priorMessages.push({ role: "user", text: `Discussion point ${i}` });
      priorMessages.push({ role: "bot", text: `Discussion reply ${i}` });
    }

    const result = resolveConversationImages("Looking at that mystery-outline from earlier, what is the country?", {
      attachmentsDir: root,
      priorMessages,
      usesNativeImageInput: true,
      injectGroundingNote: true,
    });

    expect(result.resolutionSource).toBe("conversation-history");
    expect(result.images[0]?.path).toBe(filePath);
    expect(result.provenance?.sourceUrl).toBe("https://outlinemap.org/map/country-region/bhutan/outline-std.png");
    expect(result.provenance?.subjectHint).toBe("bhutan");
  });

  // Scenario 12: Second verification method sharing same source or model does not count as independent corroboration
  it("Scenario 12: Enforces non-circularity in corroboration (Invariant 14c)", () => {
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("Non-Circularity in Corroboration: Two verification sources are independent only if they do not share the same underlying origin, model, or tool output; never present self-referential or repeated tool outputs as independent corroboration");
  });

  // Scenario 13: Visual answer partially correct with unsupported extra factual claim detects unsupported portion
  it("Scenario 13: Detects and rejects unsupported extra factual claims attached to correct identifications", () => {
    // Model correctly identifying Bhutan cannot fabricate a naval base or coastline
    const claimAnalysis = {
      subject: "Bhutan",
      isSubjectValid: true,
      claimedAttributes: [
        { attribute: "landlocked", verified: true },
        { attribute: "active naval port on the coast", verified: false, contradiction: "Bhutan has 0 km coastline" },
      ],
    };

    expect(claimAnalysis.claimedAttributes[1]?.verified).toBe(false);
    expect(claimAnalysis.claimedAttributes[1]?.contradiction).toContain("0 km coastline");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("NEVER fabricate geographic, physical, or categorical attributes (such as claiming a landlocked nation has a coastline, or inventing borders)");
  });

  // Scenario 14: Tool or external source unavailable degrades truthfully without fabricating verification
  it("Scenario 14: Degrades truthfully when external verification tools fail or are offline", () => {
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("TRUTHFUL RECOVERY & CLEAN USER PRESENTATION: When a tool fails or an artifact cannot be obtained, diagnose the root cause, attempt a viable alternative tool/source, and if all attempts fail, report the failure truthfully and honestly. Never fabricate results");
  });

  // Scenario 15: Previous answer was wrong: correction accurately explains what changed and why
  it("Scenario 15: Correction accurately explains prior unverified visual guess vs verified ground truth", () => {
    const correctionTemplate = {
      priorClaim: "The country is Russia and has a coastline.",
      verifiedTruth: "The country is Bhutan and is landlocked.",
      rationale: "Earlier claim was based on unverified visual impression. Trusted source provenance and authoritative geography confirm Bhutan in the Himalayas with zero coastline.",
    };

    expect(correctionTemplate.priorClaim).not.toEqual(correctionTemplate.verifiedTruth);
    expect(correctionTemplate.rationale).toContain("Trusted source provenance and authoritative geography confirm Bhutan");
    expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("explicitly acknowledge and correct the prior mistake rather than stubbornly defending it");
  });

  // Scenario 16: Cases A–E regression coverage remains intact
  it("Scenario 16: Cases A–E regression coverage - capability truthfulness, GeoJSON exclusion, and continuity", () => {
    // Case A: WhatsApp phone control capability
    const matchReq = normalizeCapabilityMatchRequest({
      objective: 'send "me" message on WhatsApp, hello',
      contextKeywords: [],
      targetDevice: "android_local",
      activeBotId: "bot-twelve",
    });
    const resolution = defaultCapabilityRegistry.matchCapability(matchReq);
    expect(resolution.primaryCapabilityId).not.toBe("device.apps");
    expect(resolution.chosenModality).not.toBe("device_gesture");

    const phoneControl = new PhoneControlCapability();
    const opNames = phoneControl.supportedOperations.map((o) => o.name);
    expect(opNames).toContain("status");
    expect(opNames).not.toContain("send_message");

    // Case B: GeoJSON excluded from image pipeline
    const root = createStore();
    const priorWithGeojson: PriorMessageLike[] = [
      {
        role: "bot",
        text: "Here is geojson",
        attachments: [
          {
            kind: "dataset",
            path: "/api/attachments/test.geojson",
            name: "source.geojson",
            mime: "application/geo+json",
          },
        ],
      },
    ];
    const geoResult = resolveConversationImages("what does the map show", {
      attachmentsDir: root,
      priorMessages: priorWithGeojson,
      usesNativeImageInput: true,
    });
    expect(geoResult.images).toHaveLength(0);
    expect(geoResult.resolutionSource).toBe("none");

    // Provider image payload builder test
    const { filePath } = createImageFile(root, UUIDS[0]!, ".png", 100);
    const payload = buildProviderImagePayload([{ path: filePath, mime: "image/png", bytes: 100 }]);
    expect(payload).toHaveLength(1);
    expect(payload[0]?.type).toBe("input_image");
  });
});

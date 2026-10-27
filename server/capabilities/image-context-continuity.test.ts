import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkImageFileStatus,
  ownedImage,
  resolveConversationImages,
  type PriorMessageLike,
} from "../turn-images.ts";

const UUIDS = [
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004",
] as const;

describe("Case D: Conversation Image-Context Continuity", () => {
  const temporary: string[] = [];

  const createStore = () => {
    const root = mkdtempSync(join(tmpdir(), "omb-image-continuity-"));
    temporary.push(root);
    return root;
  };

  const createImageFile = (root: string, uuid: string, ext = ".png", bytes = 100) => {
    const filename = `${uuid}${ext}`;
    const filePath = join(root, filename);
    writeFileSync(filePath, Buffer.alloc(bytes, 0x42));
    return { filename, filePath };
  };

  afterEach(() => {
    for (const dir of temporary.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("ownedImage and path representations", () => {
    it("accepts absolute paths inside attachments directory", () => {
      const root = createStore();
      const { filePath } = createImageFile(root, UUIDS[0]!);
      const result = ownedImage(filePath, root);
      expect(result).not.toBeNull();
      expect(result?.path).toBe(filePath);
      expect(result?.mime).toBe("image/png");
      expect(result?.bytes).toBe(100);

      const status = checkImageFileStatus(filePath, root);
      expect(status.status).toBe("valid");
    });

    it("accepts /api/attachments/<uuid>.<ext> representation", () => {
      const root = createStore();
      const { filename, filePath } = createImageFile(root, UUIDS[0]!);
      const apiPath = `/api/attachments/${filename}`;
      const result = ownedImage(apiPath, root);
      expect(result).not.toBeNull();
      expect(result?.path).toBe(filePath);
      expect(result?.mime).toBe("image/png");
    });

    it("accepts attachment:<uuid>.<ext> URI scheme representation", () => {
      const root = createStore();
      const { filename, filePath } = createImageFile(root, UUIDS[1]!, ".jpg", 50);
      const uriPath = `attachment:${filename}`;
      const result = ownedImage(uriPath, root);
      expect(result).not.toBeNull();
      expect(result?.path).toBe(filePath);
      expect(result?.mime).toBe("image/jpeg");
    });

    it("rejects path traversal or unowned filenames", () => {
      const root = createStore();
      expect(ownedImage("/api/attachments/../../etc/passwd", root)).toBeNull();
      expect(ownedImage("/api/attachments/non-uuid.png", root)).toBeNull();
      expect(ownedImage("attachment:evil.exe", root)).toBeNull();
    });
  });

  describe("Requirement 1 & 2: Follow-up questions on assistant and user images", () => {
    it("resolves assistant-generated image on short follow-up guess (Bhutan scenario)", () => {
      const root = createStore();
      const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 85448);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "user",
          text: "Can you show me a random country outline to guess?",
        },
        {
          role: "bot",
          text: "Here's a mystery country outline from the internet. What country is it?",
          attachments: [
            {
              kind: "image",
              path: `/api/attachments/${filename}`,
              mime: "image/png",
              name: "mystery-outline.png",
            },
          ],
        },
      ];

      const result = resolveConversationImages("Bhutan ?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.resolutionSource).toBe("conversation-history");
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.path).toBe(filePath);
      expect(result.images[0]?.mime).toBe("image/png");
      expect(result.images[0]?.bytes).toBe(85448);
      expect(result.text).toBe("Bhutan ?");
    });

    it("resolves user-attached image on subsequent follow-up questions across multiple turns", () => {
      const root = createStore();
      const { filename, filePath } = createImageFile(root, UUIDS[1]!, ".jpg", 45000);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "user",
          text: "Look at this screenshot of my error",
          attachments: [
            {
              kind: "image",
              path: `/api/attachments/${filename}`,
              mime: "image/jpeg",
              name: "error-screen.jpg",
            },
          ],
        },
        {
          role: "bot",
          text: "I see a NullPointerException on line 42 of DatabasePool.java.",
        },
        {
          role: "user",
          text: "What was the line number again?",
        },
        {
          role: "bot",
          text: "Line 42.",
        },
      ];

      // Turn 5: User asks about the visual details of the image
      const result = resolveConversationImages("Can you check the color of the highlight in the screenshot?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.resolutionSource).toBe("conversation-history");
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.path).toBe(filePath);
      expect(result.images[0]?.mime).toBe("image/jpeg");
    });
  });

  describe("Requirement 3: Multi-image disambiguation", () => {
    it("resolves the most recent image by default when no specific image is named", () => {
      const root = createStore();
      const first = createImageFile(root, UUIDS[0]!, ".png", 100);
      const second = createImageFile(root, UUIDS[1]!, ".jpg", 200);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "First graphic",
          attachments: [{ kind: "image", path: `/api/attachments/${first.filename}`, name: "first.png" }],
        },
        {
          role: "user",
          text: "Cool, show another",
        },
        {
          role: "bot",
          text: "Second graphic",
          attachments: [{ kind: "image", path: `/api/attachments/${second.filename}`, name: "second.jpg" }],
        },
      ];

      const result = resolveConversationImages("What do you think of this image?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.resolutionSource).toBe("conversation-history");
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.path).toBe(second.filePath);
    });

    it("resolves specific image when user mentions candidate filename", () => {
      const root = createStore();
      const chart = createImageFile(root, UUIDS[0]!, ".png", 100);
      const map = createImageFile(root, UUIDS[1]!, ".png", 200);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Here is chart-revenue.png and world-map.png",
          attachments: [
            { kind: "image", path: `/api/attachments/${chart.filename}`, name: "chart-revenue.png" },
            { kind: "image", path: `/api/attachments/${map.filename}`, name: "world-map.png" },
          ],
        },
      ];

      const result = resolveConversationImages("Explain the chart-revenue in detail please", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.path).toBe(chart.filePath);
    });

    it("resolves by ordinal position (first image vs second image)", () => {
      const root = createStore();
      const first = createImageFile(root, UUIDS[0]!, ".png", 100);
      const second = createImageFile(root, UUIDS[1]!, ".jpg", 200);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Here are two options",
          attachments: [
            { kind: "image", path: `/api/attachments/${first.filename}`, name: "opt1.png" },
            { kind: "image", path: `/api/attachments/${second.filename}`, name: "opt2.jpg" },
          ],
        },
      ];

      const resultFirst = resolveConversationImages("Tell me about the first image", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });
      expect(resultFirst.images[0]?.path).toBe(first.filePath);

      const resultSecond = resolveConversationImages("Tell me about the second image", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });
      expect(resultSecond.images[0]?.path).toBe(second.filePath);
    });

    it("resolves multiple images when user explicitly asks for both/all", () => {
      const root = createStore();
      const first = createImageFile(root, UUIDS[0]!, ".png", 100);
      const second = createImageFile(root, UUIDS[1]!, ".jpg", 200);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Two options",
          attachments: [
            { kind: "image", path: `/api/attachments/${first.filename}`, name: "opt1.png" },
            { kind: "image", path: `/api/attachments/${second.filename}`, name: "opt2.jpg" },
          ],
        },
      ];

      const result = resolveConversationImages("Compare both images for me", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.images).toHaveLength(2);
    });
  });

  describe("Requirement 4: Missing or expired image file", () => {
    it("injects truthful explanation note when image file is missing from disk", () => {
      const root = createStore();
      // Notice: do NOT create file on disk
      const missingUuid = UUIDS[3]!;
      const filename = `${missingUuid}.png`;

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Here is your diagram",
          attachments: [
            { kind: "image", path: `/api/attachments/${filename}`, name: "system-diagram.png" },
          ],
        },
      ];

      const result = resolveConversationImages("What components are shown in that diagram?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.images).toHaveLength(0);
      expect(result.missingImage).toBe(true);
      expect(result.text).toContain("[Context note: The image (\"system-diagram.png\") was previously displayed in this conversation, but its underlying file is no longer available on disk (missing or expired).");
    });
  });

  describe("Requirement 5: Text-only model limitation", () => {
    it("clearly indicates limitation when model does not support native image input", () => {
      const root = createStore();
      const { filename } = createImageFile(root, UUIDS[0]!, ".png", 500);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Generated preview",
          attachments: [
            { kind: "image", path: `/api/attachments/${filename}`, name: "preview.png" },
          ],
        },
      ];

      const result = resolveConversationImages("Does the image look centered?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: false, // Text-only model!
      });

      expect(result.images).toHaveLength(0);
      expect(result.text).toContain("[Note: The user is asking about an image (\"preview.png\"), but visual analysis is unavailable because the selected model/provider does not support image or multimodal input.");
    });
  });

  describe("Requirement 6: Multi-turn continuity across compacted/extended history", () => {
    it("resolves image across 20 turns of conversation history", () => {
      const root = createStore();
      const { filename, filePath } = createImageFile(root, UUIDS[0]!, ".png", 1000);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Here is the architectural outline",
          attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "architecture.png" }],
        },
      ];

      // Add 20 turns of back-and-forth discussion
      for (let i = 1; i <= 20; i += 1) {
        priorMessages.push({ role: "user", text: `Clarification question ${i}` });
        priorMessages.push({ role: "bot", text: `Answer to question ${i}` });
      }

      const result = resolveConversationImages("Referring back to that architecture outline, what was in tier 1?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      expect(result.resolutionSource).toBe("conversation-history");
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.path).toBe(filePath);
    });
  });

  describe("Requirement 7: Avoid unnecessary token overhead on unrelated turns", () => {
    it("does not attach images when conversation topic has moved to math or code", () => {
      const root = createStore();
      const { filename } = createImageFile(root, UUIDS[0]!, ".png", 1000);

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Here is the mystery outline. What country is it?",
          attachments: [{ kind: "image", path: `/api/attachments/${filename}`, name: "mystery.png" }],
        },
        {
          role: "user",
          text: "Bhutan",
        },
        {
          role: "bot",
          text: "Correct, that is Bhutan!",
        },
      ];

      // Unrelated turns
      const resultMath = resolveConversationImages("what is 2 + 2", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });
      expect(resultMath.images).toHaveLength(0);
      expect(resultMath.resolutionSource).toBe("none");

      const resultCode = resolveConversationImages("write a python function to compute fibonacci numbers", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });
      expect(resultCode.images).toHaveLength(0);
      expect(resultCode.resolutionSource).toBe("none");
    });
  });

  describe("Requirement 8: Non-image artifacts excluded", () => {
    it("never treats GeoJSON, documents, or data files as images", () => {
      const root = createStore();
      const geojsonPath = join(root, `${UUIDS[0]}.geojson`);
      writeFileSync(geojsonPath, JSON.stringify({ type: "FeatureCollection", features: [] }));

      const priorMessages: PriorMessageLike[] = [
        {
          role: "bot",
          text: "Here is source.geojson",
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

      const result = resolveConversationImages("What does the map show?", {
        attachmentsDir: root,
        priorMessages,
        usesNativeImageInput: true,
      });

      // source.geojson is NOT an image, must not be admitted to image input pipeline
      expect(result.images).toHaveLength(0);
      expect(result.resolutionSource).toBe("none");
    });
  });
});

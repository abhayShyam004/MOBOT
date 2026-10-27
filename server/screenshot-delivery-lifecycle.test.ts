import { describe, it, expect, afterEach } from "vitest";
import { basename } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import {
  saveImage,
  readAttachment,
  attachmentExists,
} from "./attachments.ts";
import {
  validateScreenFrameBytes,
} from "./screen-frame-gate.ts";
import { artifactsFromToolOutput } from "./computer-agent/artifact-manager.ts";
import { Store } from "./store.ts";

describe("Screenshot Delivery Lifecycle and Attachment Integrity", () => {
  const createdPaths: string[] = [];
  const store = new Store(() => ({ instanceId: "codex", model: "gpt-5.6-luna" }));

  afterEach(() => {
    for (const p of createdPaths) {
      if (existsSync(p)) {
        try { unlinkSync(p); } catch {}
      }
    }
    createdPaths.length = 0;
  });

  // 1. Valid captured screenshot associated with a message
  it("persists and associates valid captured screenshot with assistant message", () => {
    // Generate valid non-blank image bytes (100x100 PNG header + data)
    const validPng = Buffer.alloc(500);
    validPng[0] = 0x89; validPng[1] = 0x50; validPng[2] = 0x4e; validPng[3] = 0x47; // PNG magic
    for (let i = 8; i < 500; i++) validPng[i] = (i * 37) % 256; // non-zero entropy

    validateScreenFrameBytes(validPng);
    const saved = saveImage(validPng, "image/png");
    createdPaths.push(saved.path);

    expect(attachmentExists(basename(saved.path))).toBe(true);

    const threadId = `test_thread_shot_${Date.now()}`;
    const msg = store.appendMessage(threadId, {
      role: "bot",
      kind: "text",
      text: "Captured screenshot of Calculator with 1234.",
      attachments: [{
        kind: "image",
        path: `/api/attachments/${basename(saved.path)}`,
        mime: "image/png",
        name: basename(saved.path),
      }],
      turnId: "turn_123",
    });

    expect(msg.attachments).toBeDefined();
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0]!.path).toBe(`/api/attachments/${basename(saved.path)}`);

    // Verify retrieval after thread reload
    const reloaded = store.messagesFor(threadId);
    const reloadedMsg = reloaded.find((m) => m.id === msg.id);
    expect(reloadedMsg).toBeDefined();
    expect(reloadedMsg!.attachments![0]!.path).toBe(`/api/attachments/${basename(saved.path)}`);

    // Verify attachment file read
    const back = readAttachment(basename(saved.path));
    expect(back).not.toBeNull();
    expect(back!.mime).toBe("image/png");
    expect(back!.bytes.length).toBe(500);
  });

  // 2. Missing attachment reference
  it("gracefully handles messages with missing or empty attachment lists", () => {
    const threadId = `test_thread_no_shot_${Date.now()}`;
    const msg = store.appendMessage(threadId, {
      role: "bot",
      kind: "text",
      text: "No screenshot attached here.",
      attachments: [],
      turnId: "turn_no_shot",
    });

    const reloaded = store.messagesFor(threadId);
    const found = reloaded.find((m) => m.id === msg.id);
    expect(found).toBeDefined();
    expect(found!.attachments ?? []).toHaveLength(0);
  });

  // 3. Unknown or expired attachment ID
  it("returns null for unknown or non-existent attachment IDs", () => {
    const nonExistent = "00000000-0000-0000-0000-000000000000.png";
    expect(attachmentExists(nonExistent)).toBe(false);
    expect(readAttachment(nonExistent)).toBeNull();
  });

  // 4. Invalid MIME type
  it("rejects unsupported MIME types on image registration", () => {
    const buf = Buffer.from("not an image");
    expect(() => saveImage(buf, "application/x-executable")).toThrow(/unsupported image type/);
    expect(() => saveImage(buf, "text/html")).toThrow(/unsupported image type/);
  });

  // 5. Correct MIME type with invalid / empty image bytes
  it("rejects empty image buffers and blank frames", () => {
    const emptyBuf = Buffer.alloc(0);
    expect(() => saveImage(emptyBuf, "image/png")).toThrow(/empty image/);

    const allBlackPng = Buffer.alloc(500, 0);
    expect(validateScreenFrameBytes(allBlackPng).valid).toBe(false);
  });

  // 6. Attachment path confinement and retrieval failure
  it("refuses path traversal or malicious attachment names", () => {
    expect(readAttachment("../../etc/passwd")).toBeNull();
    expect(readAttachment("../config.json")).toBeNull();
    expect(readAttachment(".hidden.png")).toBeNull();
    expect(readAttachment("nested/path.png")).toBeNull();
  });

  // 7. Correct handling of image extensions and MIME types
  it("recognizes standard image formats (.png, .jpg, .webp, .gif)", () => {
    const testData = Buffer.alloc(100, 0x55);
    const pngSaved = saveImage(testData, "image/png");
    const jpgSaved = saveImage(testData, "image/jpeg");
    const webpSaved = saveImage(testData, "image/webp");
    const gifSaved = saveImage(testData, "image/gif");

    createdPaths.push(pngSaved.path, jpgSaved.path, webpSaved.path, gifSaved.path);

    expect(pngSaved.path.endsWith(".png")).toBe(true);
    expect(jpgSaved.path.endsWith(".jpg")).toBe(true);
    expect(webpSaved.path.endsWith(".webp")).toBe(true);
    expect(gifSaved.path.endsWith(".gif")).toBe(true);

    expect(readAttachment(basename(pngSaved.path))?.mime).toBe("image/png");
    expect(readAttachment(basename(jpgSaved.path))?.mime).toBe("image/jpeg");
    expect(readAttachment(basename(webpSaved.path))?.mime).toBe("image/webp");
    expect(readAttachment(basename(gifSaved.path))?.mime).toBe("image/gif");
  });

  // 8. Extraction of artifacts from tool output
  it("correctly extracts user-visible image artifacts from tool output", () => {
    const toolOutput = {
      ok: true,
      data: {
        path: "/api/attachments/calc_screen_1234.png",
        urlPath: "/api/attachments/calc_screen_1234.png",
        mime: "image/png",
        visibility: "user_visible",
      },
    };

    const artifacts = artifactsFromToolOutput(toolOutput);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.path).toBe("/api/attachments/calc_screen_1234.png");
    expect(artifacts[0]!.mime).toBe("image/png");
    expect(artifacts[0]!.kind).toBe("file");
  });

  // 9. Filters internal non-user-facing files from artifacts
  it("filters out internal scripts, lockfiles, and hidden files", () => {
    const internalOutput = {
      ok: true,
      data: {
        urlPath: "/api/attachments/package.json",
        path: "/api/attachments/package.json",
        visibility: "user_visible",
      },
    };
    expect(artifactsFromToolOutput(internalOutput)).toHaveLength(0);

    const scriptOutput = {
      ok: true,
      data: {
        urlPath: "/api/attachments/temp_exploit.sh",
        path: "/api/attachments/temp_exploit.sh",
        visibility: "user_visible",
      },
    };
    expect(artifactsFromToolOutput(scriptOutput)).toHaveLength(0);
  });

  // 10. Multi-task and multi-thread attachment isolation
  it("strictly isolates attachments across different threads and turns", () => {
    const threadA = `thread_isolation_A_${Date.now()}`;
    const threadB = `thread_isolation_B_${Date.now()}`;

    const bufA = Buffer.alloc(200, 0xaa);
    const bufB = Buffer.alloc(200, 0xbb);

    const savedA = saveImage(bufA, "image/png");
    const savedB = saveImage(bufB, "image/png");
    createdPaths.push(savedA.path, savedB.path);

    store.appendMessage(threadA, {
      role: "bot",
      kind: "text",
      text: "Task A result",
      attachments: [{ kind: "image", path: `/api/attachments/${basename(savedA.path)}`, mime: "image/png" }],
      turnId: "turn_A",
    });

    store.appendMessage(threadB, {
      role: "bot",
      kind: "text",
      text: "Task B result",
      attachments: [{ kind: "image", path: `/api/attachments/${basename(savedB.path)}`, mime: "image/png" }],
      turnId: "turn_B",
    });

    const msgsA = store.messagesFor(threadA);
    const msgsB = store.messagesFor(threadB);

    expect(msgsA[0]!.attachments![0]!.path).toBe(`/api/attachments/${basename(savedA.path)}`);
    expect(msgsB[0]!.attachments![0]!.path).toBe(`/api/attachments/${basename(savedB.path)}`);
    expect(msgsA[0]!.attachments![0]!.path).not.toBe(msgsB[0]!.attachments![0]!.path);
  });
});

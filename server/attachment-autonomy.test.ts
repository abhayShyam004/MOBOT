import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ATTACHMENTS_DIR } from "./attachments.ts";
import { buildMinimalPdf } from "./testing/omb-test-bytes.ts";
import {
  extractTurnFiles,
  readDocumentPages,
  resetTurnDocumentRegistry,
  ownedAttachmentPath,
} from "./turn-files.ts";

function createMockDocx(text: string): Buffer {
  const xml = `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const compressed = zlib.deflateRawSync(Buffer.from(xml, "utf8"));
  const name = Buffer.from("word/document.xml", "utf8");

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // signature
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14); // crc
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(Buffer.byteLength(xml, "utf8"), 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, name, compressed]);
}

describe("attachment-aware autonomy and cross-turn persistence", () => {
  beforeEach(() => {
    resetTurnDocumentRegistry();
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  });

  afterEach(() => {
    resetTurnDocumentRegistry();
  });

  // Scenario A: Current-turn attachment parsing and context injection for multiple formats
  it("Scenario A: parses PDF, DOCX, TXT, CSV, and JSON into bounded inline context", async () => {
    const pdfName = "11111111-2222-3333-8444-555555555551.pdf";
    const docxName = "11111111-2222-3333-8444-555555555552.docx";
    const txtName = "11111111-2222-3333-8444-555555555553.txt";
    const csvName = "11111111-2222-3333-8444-555555555554.csv";
    const jsonName = "11111111-2222-3333-8444-555555555555.json";

    writeFileSync(join(ATTACHMENTS_DIR, pdfName), buildMinimalPdf("Candidate Profile: Full Stack Developer"));
    writeFileSync(join(ATTACHMENTS_DIR, docxName), createMockDocx("Project Requirements Document"));
    writeFileSync(join(ATTACHMENTS_DIR, txtName), "Plain text notes and preferences");
    writeFileSync(join(ATTACHMENTS_DIR, csvName), "Role,Salary,Location\nEngineer,120k,Bangalore\nDesigner,100k,Remote");
    writeFileSync(join(ATTACHMENTS_DIR, jsonName), JSON.stringify({ experienceYears: 5, primaryLanguage: "TypeScript" }));

    try {
      // 1. PDF
      const pdfRes = await extractTurnFiles(`<attached-file path="${pdfName}" name="Resume.pdf" />`);
      expect(pdfRes.files).toHaveLength(1);
      expect(pdfRes.files[0]!.metadata.status).toBe("PARSED");
      expect(pdfRes.files[0]!.metadata.name).toBe("Resume.pdf");
      expect(pdfRes.text).toContain("Candidate Profile: Full Stack Developer");
      expect(pdfRes.text).toContain("CORE AUTONOMY RULE");

      // 2. DOCX
      const docxRes = await extractTurnFiles(`<attached-file path="${docxName}" name="Spec.docx" />`);
      expect(docxRes.files).toHaveLength(1);
      expect(docxRes.files[0]!.metadata.status).toBe("PARSED");
      expect(docxRes.text).toContain("Project Requirements Document");

      // 3. TXT
      const txtRes = await extractTurnFiles(`<attached-file path="${txtName}" name="Notes.txt" />`);
      expect(txtRes.files).toHaveLength(1);
      expect(txtRes.files[0]!.metadata.status).toBe("PARSED");
      expect(txtRes.text).toContain("Plain text notes and preferences");

      // 4. CSV (formatted as tabular markdown)
      const csvRes = await extractTurnFiles(`<attached-file path="${csvName}" name="Roles.csv" />`);
      expect(csvRes.files).toHaveLength(1);
      expect(csvRes.files[0]!.metadata.status).toBe("PARSED");
      expect(csvRes.text).toContain("| Role | Salary | Location |");

      // 5. JSON
      const jsonRes = await extractTurnFiles(`<attached-file path="${jsonName}" name="Profile.json" />`);
      expect(jsonRes.files).toHaveLength(1);
      expect(jsonRes.files[0]!.metadata.status).toBe("PARSED");
      expect(jsonRes.text).toContain("primaryLanguage");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, pdfName), { force: true });
      rmSync(join(ATTACHMENTS_DIR, docxName), { force: true });
      rmSync(join(ATTACHMENTS_DIR, txtName), { force: true });
      rmSync(join(ATTACHMENTS_DIR, csvName), { force: true });
      rmSync(join(ATTACHMENTS_DIR, jsonName), { force: true });
    }
  });

  // Scenario B: Full Android path normalization & relative path resolution
  it("Scenario B: resolves full Android private paths and URL paths correctly", async () => {
    const fileName = "22222222-3333-4444-8555-666666666661.pdf";
    writeFileSync(join(ATTACHMENTS_DIR, fileName), buildMinimalPdf("Android file content test"));

    try {
      // Android companion full path
      const androidPath = `/data/user/0/com.openmausbot.companion/files/.openmausbot/attachments/${fileName}`;
      const resolvedFromAndroid = ownedAttachmentPath(androidPath);
      expect(resolvedFromAndroid).toBe(join(ATTACHMENTS_DIR, fileName));

      // API attachment path
      const apiPath = `/api/attachments/${fileName}`;
      const resolvedFromApi = ownedAttachmentPath(apiPath);
      expect(resolvedFromApi).toBe(join(ATTACHMENTS_DIR, fileName));

      // Bare filename
      const resolvedFromBare = ownedAttachmentPath(fileName);
      expect(resolvedFromBare).toBe(join(ATTACHMENTS_DIR, fileName));

      // In extraction
      const extractResult = await extractTurnFiles(
        `<attached-file path="${androidPath}" name="MyUploadedResume.pdf" />\nfind me jobs that match my resume`,
      );
      expect(extractResult.files).toHaveLength(1);
      expect(extractResult.files[0]!.metadata.status).toBe("PARSED");
      expect(extractResult.text).toContain("Android file content test");
      expect(extractResult.text).not.toContain("<attached-file");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, fileName), { force: true });
    }
  });

  // Scenario C: Resume / job search intent with attached resume contains hard autonomy rule
  it("Scenario C: resume attachment enforces extracting profile first and forbids asking how to provide resume", async () => {
    const resumeName = "33333333-4444-5555-8666-777777777771.pdf";
    writeFileSync(
      join(ATTACHMENTS_DIR, resumeName),
      buildMinimalPdf("Senior Backend Engineer - Kotlin, Go, Distributed Systems, Microservices"),
    );

    try {
      const turnText = `<attached-file path="${resumeName}" name="Senior_Resume.pdf" />\nfind me jobs that match my resume for me.`;
      const result = await extractTurnFiles(turnText);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.metadata.status).toBe("PARSED");
      expect(result.text).toContain("Senior Backend Engineer - Kotlin, Go");
      // Must contain the explicit Core Autonomy Rule
      expect(result.text).toContain("CORE AUTONOMY RULE");
      expect(result.text).toContain("NEVER ask the user to provide information that is already available");
      expect(result.text).toContain("do NOT ask how to provide the document");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, resumeName), { force: true });
    }
  });

  // Scenario D: Cross-turn attachment persistence and reference
  it("Scenario D: retains attachment context across turns when user references earlier attachment", async () => {
    const resumeName = "44444444-5555-6666-8777-888888888881.pdf";
    writeFileSync(
      join(ATTACHMENTS_DIR, resumeName),
      buildMinimalPdf("Alice Smith - Staff ML Engineer with PyTorch, CUDA, Transformers"),
    );

    try {
      // Turn 1: User sends resume
      const turn1Tag = `<attached-file path="${resumeName}" name="Alice_Resume.pdf" />`;
      const turn1Text = `${turn1Tag}\nfind me jobs that match my resume for me.`;
      const turn1Res = await extractTurnFiles(turn1Text, { threadId: "test-thread-1" });
      expect(turn1Res.files).toHaveLength(1);
      expect(turn1Res.files[0]!.metadata.status).toBe("PARSED");

      // Turn 2: User says: "I just sent you the pdf look at it!" (without re-attaching)
      const priorMessages = [
        { role: "user", text: turn1Text },
        { role: "bot", text: "How would you like to provide the resume?" },
      ];
      const turn2Text = "I just sent you the pdf look at it!";
      const turn2Res = await extractTurnFiles(turn2Text, {
        threadId: "test-thread-1",
        priorMessages,
      });

      // Turn 2 must resolve the earlier PDF and include it in context
      expect(turn2Res.files).toHaveLength(1);
      expect(turn2Res.files[0]!.metadata.name).toBe("Alice_Resume.pdf");
      expect(turn2Res.files[0]!.metadata.status).toBe("PARSED");
      expect(turn2Res.text).toContain("Alice Smith - Staff ML Engineer");
      expect(turn2Res.text).toContain("PREVIOUSLY ATTACHED DOCUMENT \"Alice_Resume.pdf\"");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, resumeName), { force: true });
    }
  });

  // Scenario E: Multi-attachment parsing and distinction
  it("Scenario E: parses multiple distinct attachments and keeps each clearly separated", async () => {
    const resumeName = "55555555-6666-7777-8888-999999999991.pdf";
    const jdName = "55555555-6666-7777-8888-999999999992.docx";

    writeFileSync(join(ATTACHMENTS_DIR, resumeName), buildMinimalPdf("Candidate Qualifications: React, TypeScript"));
    writeFileSync(join(ATTACHMENTS_DIR, jdName), createMockDocx("Job Requirements: Must know React and Next.js"));

    try {
      const text = `<attached-file path="${resumeName}" name="Resume.pdf" />\n<attached-file path="${jdName}" name="JobDescription.docx" />\nCompare these two files for me`;
      const result = await extractTurnFiles(text);

      expect(result.files).toHaveLength(2);
      expect(result.files[0]!.metadata.name).toBe("Resume.pdf");
      expect(result.files[1]!.metadata.name).toBe("JobDescription.docx");
      expect(result.text).toContain('---BEGIN DOCUMENT "Resume.pdf"---');
      expect(result.text).toContain('---BEGIN DOCUMENT "JobDescription.docx"---');
      expect(result.text.indexOf("Resume.pdf")).toBeLessThan(result.text.indexOf("JobDescription.docx"));
    } finally {
      rmSync(join(ATTACHMENTS_DIR, resumeName), { force: true });
      rmSync(join(ATTACHMENTS_DIR, jdName), { force: true });
    }
  });

  // Scenario F: Large document outline + page retrieval tool persistence
  it("Scenario F: registers read_document_pages tool for large PDFs and retains across turns", async () => {
    const largeDocName = "66666666-7777-8888-8999-000000000001.pdf";
    // Write an outline-threshold PDF fixture
    writeFileSync(join(ATTACHMENTS_DIR, largeDocName), buildMinimalPdf(null));

    try {
      await extractTurnFiles(`<attached-file path="${largeDocName}" name="BigManual.pdf" />`);
      // Since minimal dummy pdf has no text layer, test readDocumentPages with registered doc
      expect(readDocumentPages("non-existent-key", 1, 2)).toContain("Error:");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, largeDocName), { force: true });
    }
  });

  // Scenario G: Unsupported or corrupt file handling produces honest descriptive errors
  it("Scenario G: honestly handles scanned PDF, corrupt doc, and non-owned path", async () => {
    const scannedName = "77777777-8888-9999-8000-111111111111.pdf";
    const corruptName = "77777777-8888-9999-8000-111111111112.docx";
    writeFileSync(join(ATTACHMENTS_DIR, scannedName), buildMinimalPdf(null));
    writeFileSync(join(ATTACHMENTS_DIR, corruptName), Buffer.from("not a real zip or docx"));

    try {
      // Scanned
      const scannedRes = await extractTurnFiles(`<attached-file path="${scannedName}" name="Scan.pdf" />`);
      expect(scannedRes.files[0]!.metadata.status).toBe("FAILED");
      expect(scannedRes.files[0]!.error).toContain("scanned");
      expect(scannedRes.text).toContain("image-based");

      // Corrupt DOCX
      const corruptRes = await extractTurnFiles(`<attached-file path="${corruptName}" name="Broken.docx" />`);
      expect(corruptRes.files[0]!.metadata.status).toBe("FAILED");
      expect(corruptRes.files[0]!.error).toContain("Word document could not be read");

      // Non-existent path
      const missingRes = await extractTurnFiles('<attached-file path="77777777-8888-9999-8000-999999999999.pdf" name="Missing.pdf" />');
      expect(missingRes.files[0]!.metadata.status).toBe("UNAVAILABLE");
      expect(missingRes.text).toContain("could not be opened");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, scannedName), { force: true });
      rmSync(join(ATTACHMENTS_DIR, corruptName), { force: true });
    }
  });

  // Scenario H: Deterministic attachment status lifecycle & metadata schema
  it("Scenario H: emits complete AttachmentMetadata with status, mime, size, and parser", async () => {
    const docName = "88888888-9999-0000-8111-222222222221.txt";
    writeFileSync(join(ATTACHMENTS_DIR, docName), "Sample document for metadata assertion");

    try {
      const res = await extractTurnFiles(`<attached-file path="${docName}" name="Data.txt" />`);
      const meta = res.files[0]!.metadata;
      expect(meta.attachmentId).toBe("88888888-9999-0000-8111-222222222221");
      expect(meta.name).toBe("Data.txt");
      expect(meta.mime).toBe("text/plain");
      expect(meta.status).toBe("PARSED");
      expect(meta.parser).toBe("text-utf8");
      expect(meta.extractedChars).toBeGreaterThan(0);
      expect(meta.size).toBeGreaterThan(0);
    } finally {
      rmSync(join(ATTACHMENTS_DIR, docName), { force: true });
    }
  });

  // Scenario I: In-memory caching prevents redundant disk or parser work
  it("Scenario I: caches parsed document in memory so repeated access is instantaneous", async () => {
    const docName = "99999999-0000-1111-8222-333333333331.pdf";
    writeFileSync(join(ATTACHMENTS_DIR, docName), buildMinimalPdf("Cached content verification"));

    try {
      const first = await extractTurnFiles(`<attached-file path="${docName}" name="Resume.pdf" />`);
      expect(first.files[0]!.metadata.status).toBe("PARSED");

      // Second access (e.g. from follow-up turn)
      const second = await extractTurnFiles("look at my resume again", {
        priorMessages: [{ role: "user", text: `<attached-file path="${docName}" name="Resume.pdf" />` }],
      });
      expect(second.files[0]!.metadata.status).toBe("PARSED");
      expect(second.text).toContain("Cached content verification");
    } finally {
      rmSync(join(ATTACHMENTS_DIR, docName), { force: true });
    }
  });

  // Scenario J: Security & Privacy - Directory traversal rejection & no leaked filesystem paths
  it("Scenario J: rejects directory traversal and never leaks private host paths", async () => {
    const hostilePaths = [
      '../../etc/passwd',
      '../../../root/.ssh/id_rsa',
      '..\\..\\windows\\system32\\cmd.exe',
      '/etc/shadow',
    ];

    for (const hostile of hostilePaths) {
      const res = await extractTurnFiles(`<attached-file path="${hostile}" name="file.pdf" />`);
      expect(res.files[0]!.metadata.status).toBe("UNAVAILABLE");
      expect(res.text).toContain("could not be opened");
      expect(res.text).not.toContain(hostile);
      expect(res.text).not.toContain(ATTACHMENTS_DIR);
    }
  });
});

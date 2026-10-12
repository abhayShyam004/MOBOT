// Shared byte fixtures for the Android resource tool tests: a minimal
// single-page PDF builder (text or scanned/image-only) and a 1x1 PNG.
// Building PDFs programmatically keeps the suite free of binary blobs while
// exercising the real pdf.js parse path.

/** Build a minimal one-page PDF with (or without) extractable text.
 *  Objects are written sequentially while tracking byte offsets for xref. */
export function buildMinimalPdf(text: string | null): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  const push = (s: string) => {
    const b = Buffer.from(s, "latin1");
    parts.push(b);
    offset += b.length;
  };
  push("%PDF-1.4\n");
  const offsets: number[] = [];
  const addObj = (body: string) => {
    offsets.push(offset);
    push(body);
  };
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const stream = text === null
    ? ""
    : `BT /F1 18 Tf 72 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
  addObj(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  addObj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  const xrefStart = offset;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/** 1x1 blue PNG (standard minimal fixture). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

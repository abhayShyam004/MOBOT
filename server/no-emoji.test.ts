import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EMOJI_REGEX =
  /[\u{10000}-\u{10FFFF}]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2B50]|[\u3030]|[\u203C\u2049]|[\u2122\u2139]|[\u2194-\u2199]|[\u21A9-\u21AA]/u;

function walkDir(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    if (file.startsWith(".") || file === "node_modules" || file === "dist" || file === "dist-server") {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (
      (file.endsWith(".ts") || file.endsWith(".js")) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".spec.ts")
    ) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe("Zero-Emoji UI and Production Invariant", () => {
  it("verifies no emojis exist in server production code", () => {
    const targetDirs = [join(process.cwd(), "server"), join(process.cwd(), "shared")];
    const violations: string[] = [];

    for (const dir of targetDirs) {
      const files = walkDir(dir);
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          const match = EMOJI_REGEX.exec(line);
          if (match) {
            violations.push(
              `${file}:${index + 1}: found '${match[0]}' in line: ${line.trim().slice(0, 80)}`,
            );
          }
        });
      }
    }

    expect(
      violations,
      `Detected emojis in server/shared production code violating the zero-emoji invariant:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("sanitizes emojis and flag sequences from model and assistant responses", async () => {
    const { stripEmojis, cleanUserFacingText } = await import("./index.ts");

    expect(stripEmojis("Correct! 🇯🇵 Want another flag?")).toBe("Correct! Want another flag?");
    expect(stripEmojis("Great job! 👍 Let's keep going 🔥")).toBe("Great job! Let's keep going");
    expect(stripEmojis("Hello world 🌍 ✨")).toBe("Hello world");
    expect(cleanUserFacingText("Correct! 🇯🇵 Want another flag?")).toBe("Correct! Want another flag?");
  });
});

import { describe, expect, it } from "vitest";
import {
  countWords,
  splitIntoSentences,
  enforceResponseLength,
} from "./response-length.ts";

describe("Global Response Length Invariant (Under 100 Words)", () => {
  it("counts conversational words accurately", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("  This is a   test with   multiple spaces.  ")).toBe(7);
  });

  it("splits sentences cleanly without breaking on numbers or abbreviations", () => {
    const sentences = splitIntoSentences("Python 3.12 is great. It runs fast!");
    expect(sentences.length).toBe(2);
    expect(sentences[0]?.trim()).toBe("Python 3.12 is great.");
    expect(sentences[1]?.trim()).toBe("It runs fast!");
  });

  it("ignores structured code blocks when counting words", () => {
    const textWithStructured = `Here are the top candidates.
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "res-1",
      "type": "result",
      "data": { "title": "Senior Engineer", "company": "Acme", "salary": "150k" }
    }
  ]
}
\`\`\`
Let me know which one you prefer.`;

    // Only conversational words should count:
    // "Here are the top candidates. Let me know which one you prefer." = 12 words
    expect(countWords(textWithStructured)).toBe(12);
  });

  it("leaves responses under 100 words untouched", () => {
    const shortResponse = "Python is a high-level programming language known for readability and clean syntax.";
    expect(enforceResponseLength(shortResponse)).toBe(shortResponse);
    expect(countWords(shortResponse)).toBe(12);
  });

  it("leaves responses of exactly 99 words untouched", () => {
    const words99 = Array.from({ length: 99 }, (_, i) => `word${i + 1}`).join(" ") + ".";
    expect(countWords(words99)).toBe(99);
    expect(enforceResponseLength(words99)).toBe(words99);
  });

  it("condenses responses exceeding 100 words to the nearest sentence boundary", () => {
    const s1 = "Python is a versatile programming language widely used in web development, data science, and automation.";
    const s2 = "It emphasizes code readability with notable use of significant indentation and dynamic typing.";
    const s3 = "Its comprehensive standard library and vast third-party ecosystem make it suitable for rapid prototyping as well as building enterprise-scale systems across diverse operational domains.";
    const s4 = "Many popular frameworks such as Django, FastAPI, and Flask power modern web backends, while libraries like NumPy, pandas, and PyTorch lead machine learning research and practical deployments.";
    const s5 = "Furthermore, Python supports multiple programming paradigms including object-oriented, imperative, functional, and procedural styles, giving software engineers enormous flexibility in solving intricate computational problems across platforms.";

    const fullText = `${s1} ${s2} ${s3} ${s4} ${s5}`;
    expect(countWords(fullText)).toBeGreaterThan(100);

    const condensed = enforceResponseLength(fullText);
    expect(countWords(condensed)).toBeLessThan(100);
    // Should end cleanly at s4 boundary
    expect(condensed.endsWith("deployments.")).toBe(true);
    expect(condensed).not.toContain("Furthermore, Python supports");
  });

  it("handles a single long run-on sentence cleanly at clause boundaries", () => {
    // Generate a single sentence with 120 words and commas
    const parts = Array.from({ length: 30 }, (_, i) => `phrase section number ${i + 1}`).join(", ") + ".";
    expect(countWords(parts)).toBeGreaterThan(100);

    const condensed = enforceResponseLength(parts);
    expect(countWords(condensed)).toBeLessThan(100);
    expect(condensed.endsWith("...")).toBe(true);
  });

  it("allows long responses when user explicitly asks for detailed explanation", () => {
    const detailedPrompt = "Please explain in detail how garbage collection works in V8.";
    const longReply = Array.from({ length: 150 }, (_, i) => `item${i + 1}`).join(" ") + ".";
    expect(countWords(longReply)).toBe(150);

    const result = enforceResponseLength(longReply, { userPrompt: detailedPrompt });
    expect(result).toBe(longReply);
  });

  it("allows long responses when user asks to be comprehensive or give everything", () => {
    const prompt1 = "Be comprehensive in your answer.";
    const prompt2 = "Don't keep it short, give me everything.";
    const longReply = Array.from({ length: 120 }, (_, i) => `point${i + 1}`).join(" ") + ".";

    expect(enforceResponseLength(longReply, { userPrompt: prompt1 })).toBe(longReply);
    expect(enforceResponseLength(longReply, { userPrompt: prompt2 })).toBe(longReply);
  });

  it("allows long responses when task genuinely requires code blocks or tables", () => {
    const codeResponse = `Here is the implementation:
\`\`\`typescript
${Array.from({ length: 120 }, (_, i) => `const x${i} = ${i};`).join("\n")}
\`\`\`
Let me know if you want modifications.`;

    expect(countWords(codeResponse)).toBeGreaterThan(100);
    expect(enforceResponseLength(codeResponse)).toBe(codeResponse);

    const tableResponse = `Here is the comparison table:
| Framework | Language | Performance |
|---|---|---|
${Array.from({ length: 40 }, (_, i) => `| Tool ${i} | TS | High ${i} |`).join("\n")}
Summary completed.`;

    expect(countWords(tableResponse)).toBeGreaterThan(100);
    expect(enforceResponseLength(tableResponse)).toBe(tableResponse);
  });
});

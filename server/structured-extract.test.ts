import { describe, expect, it } from "vitest";
import { extractStructuredContent } from "./structured-extract.ts";

describe("extractStructuredContent", () => {
  it("leaves plain text untouched when no structured block exists", () => {
    const raw = "Here is my advice on creatine and sleep supplements.\n- Item 1\n- Item 2";
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe(raw);
    expect(res.structured).toBeUndefined();
  });

  it("extracts valid structured block and strips raw JSON code fence", () => {
    const raw = `Here are the top recommendations:

\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "card-1",
      "type": "card",
      "data": {
        "variant": "recommendation",
        "headline": "Optimum Nutrition Micronized Creatine",
        "badge": "$24.99 · Best Overall",
        "body": "Pure Creapure creatine monohydrate with 5g per serving.",
        "metadata": {
          "Brand": "Optimum Nutrition",
          "Price": "$24.99",
          "Certifications": "Informed-Choice"
        }
      }
    }
  ]
}
\`\`\`

Let me know if you would like dosage advice!`;

    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("Here are the top recommendations:\n\nLet me know if you would like dosage advice!");
    expect(res.structured).toBeDefined();
    expect(res.structured?.components).toHaveLength(1);
    expect(res.structured?.components[0]?.id).toBe("card-1");
    expect(res.structured?.components[0]?.type).toBe("card");
  });

  it("extracts json:structured language tag as well", () => {
    const raw = `Product breakdown:
\`\`\`json:structured
{
  "version": 1,
  "components": [
    {
      "id": "comp-1",
      "type": "comparison",
      "data": {
        "items": ["Product A", "Product B"],
        "criteria": [
          { "name": "Price", "values": ["$20", "$30"] }
        ]
      }
    }
  ]
}
\`\`\``;

    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("Product breakdown:");
    expect(res.structured).toBeDefined();
    expect(res.structured?.components).toHaveLength(1);
    expect(res.structured?.components[0]?.type).toBe("comparison");
  });

  it("leaves invalid JSON block in text unchanged", () => {
    const raw = `\`\`\`structured\n{ invalid json here }\n\`\`\``;
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe(raw);
    expect(res.structured).toBeUndefined();
  });
});

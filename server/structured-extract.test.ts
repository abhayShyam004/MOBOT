import { describe, expect, it } from "vitest";
import { extractStructuredContent } from "./structured-extract.ts";

describe("extractStructuredContent", () => {
  it("leaves plain text untouched when no structured block exists", () => {
    const raw = "Here is my advice on creatine and sleep supplements.\n- Item 1\n- Item 2";
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe(raw);
    expect(res.structured).toBeUndefined();
  });

  it("extracts valid structured block and interleaves prose as text components", () => {
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
    // In interleaved mode, cleanText is empty so StructuredResponseView owns single-pass rendering
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();
    expect(res.structured?.components).toHaveLength(3);

    // Component 1: Intro prose
    expect(res.structured?.components[0]?.type).toBe("text");
    expect((res.structured?.components[0]?.data as any)?.text).toBe("Here are the top recommendations:");

    // Component 2: Recommendation card
    expect(res.structured?.components[1]?.id).toBe("card-1");
    expect(res.structured?.components[1]?.type).toBe("card");

    // Component 3: Outro prose
    expect(res.structured?.components[2]?.type).toBe("text");
    expect((res.structured?.components[2]?.data as any)?.text).toBe("Let me know if you would like dosage advice!");
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
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();
    expect(res.structured?.components).toHaveLength(2);
    expect(res.structured?.components[0]?.type).toBe("text");
    expect(res.structured?.components[1]?.type).toBe("comparison");
  });

  it("leaves invalid JSON block in text unchanged", () => {
    const raw = `\`\`\`structured\n{ invalid json here }\n\`\`\``;
    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe(raw);
    expect(res.structured).toBeUndefined();
  });

  it("handles explicit research result components with full metadata and sanitization", () => {
    const raw = `\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "result-1",
      "type": "result",
      "data": {
        "resultType": "job",
        "title": "Senior Staff Engineer",
        "company": "Anthropic",
        "location": "San Francisco, CA / Hybrid",
        "salary": "$280k–$360k",
        "actionLabel": "Apply on Anthropic Careers",
        "actionUrl": "https://anthropic.com/careers/123",
        "badge": "Strong Match",
        "reason": "Direct alignment with 7+ years of distributed systems and TypeScript experience.",
        "tags": ["TypeScript", "Distributed Systems", "AI Infrastructure"],
        "provenance": {
          "sourceUrl": "https://anthropic.com/careers/123",
          "sourceType": "web_search",
          "verified": true
        }
      }
    }
  ]
}
\`\`\``;

    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();
    expect(res.structured?.components).toHaveLength(1);

    const comp = res.structured?.components[0];
    expect(comp?.type).toBe("result");
    const data = comp?.data as any;
    expect(data.resultType).toBe("job");
    expect(data.title).toBe("Senior Staff Engineer");
    expect(data.company).toBe("Anthropic");
    expect(data.salary).toBe("$280k–$360k");
    expect(data.sourceDomain).toBe("anthropic.com");
    expect(data.provenance?.verified).toBe(true);
  });

  it("autonomously synthesizes rich result cards from markdown research listings with links", () => {
    const raw = `Here are the best positions matching your profile:

1. **Senior Backend Engineer — Razorpay (Bangalore)**
Salary: ₹35,000–₹50,000 per month
Skills: **Node.js, TypeScript, PostgreSQL**
Strong match because of your backend architecture experience and Bangalore location preference.
[Apply on Razorpay](https://razorpay.com/jobs/backend-dev)

2. **Full Stack Engineer — Postman (Bangalore / Remote)**
Salary: ₹30,000–₹45,000 per month
Skills: **TypeScript, React, API Design**
Direct match for your full stack resume projects.
[View Job on Postman](https://postman.com/careers/fs-eng)

Let me know if you would like me to draft customized application notes for any of these!`;

    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();

    const components = res.structured?.components ?? [];
    expect(components.length).toBe(4);

    // 1. Intro text
    expect(components[0]?.type).toBe("text");
    expect((components[0]?.data as any)?.text).toContain("Here are the best positions");

    // 2. First Job card
    expect(components[1]?.type).toBe("result");
    const job1 = components[1]?.data as any;
    expect(job1.resultType).toBe("job");
    expect(job1.title).toBe("Senior Backend Engineer");
    expect(job1.company).toBe("Razorpay");
    expect(job1.location).toBe("Bangalore");
    expect(job1.salary).toBe("₹35,000–₹50,000 per month");
    expect(job1.actionLabel).toBe("Apply on Razorpay");
    expect(job1.actionUrl).toBe("https://razorpay.com/jobs/backend-dev");
    expect(job1.sourceDomain).toBe("razorpay.com");
    expect(job1.badge).toBe("Matched Role");

    // 3. Second Job card
    expect(components[2]?.type).toBe("result");
    const job2 = components[2]?.data as any;
    expect(job2.resultType).toBe("job");
    expect(job2.title).toBe("Full Stack Engineer");
    expect(job2.company).toBe("Postman");
    expect(job2.actionUrl).toBe("https://postman.com/careers/fs-eng");

    // 4. Outro text
    expect(components[3]?.type).toBe("text");
    expect((components[3]?.data as any)?.text).toContain("Let me know if you would like me to draft");
  });

  it("autonomously synthesizes product recommendations and deduplicates identical URLs", () => {
    const raw = `Top recommended developer laptops:

- **Apple MacBook Pro 14 M3 — Apple**
Price: $1,999
Specs: **16GB Unified Memory, 512GB SSD**
Industry standard for mobile and web development with exceptional battery life.
[View on Apple Store](https://apple.com/shop/buy-mac/macbook-pro)

- **Apple MacBook Pro 14 M3 — Apple**
Duplicate listing with same URL:
[View on Apple Store](https://apple.com/shop/buy-mac/macbook-pro)

- **ThinkPad T14s Gen 5 — Lenovo**
Price: $1,299
Specs: **AMD Ryzen 7, 32GB RAM**
Best-in-class Linux compatibility and lightweight durable build.
[View on Lenovo](https://lenovo.com/thinkpad-t14s)
`;

    const res = extractStructuredContent(raw);
    expect(res.cleanText).toBe("");
    expect(res.structured).toBeDefined();

    const resultCards = (res.structured?.components ?? []).filter((c) => c.type === "result");
    // Duplicate URL should be deduplicated
    expect(resultCards.length).toBe(2);

    const prod1 = resultCards[0]?.data as any;
    expect(prod1.resultType).toBe("product");
    expect(prod1.title).toBe("Apple MacBook Pro 14 M3");
    expect(prod1.company).toBe("Apple");
    expect(prod1.price).toBe("$1,999");
    expect(prod1.actionLabel).toBe("View on Apple Store");

    const prod2 = resultCards[1]?.data as any;
    expect(prod2.resultType).toBe("product");
    expect(prod2.title).toBe("ThinkPad T14s Gen 5");
    expect(prod2.company).toBe("Lenovo");
    expect(prod2.price).toBe("$1,299");
  });
});

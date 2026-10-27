// The spoken register is the half of voice that decides whether it is
// pleasant, and it is the piece most likely to be tuned against real
// transcripts — so its behaviour is pinned here rather than discovered in
// the kitchen at 8am.
import { describe, expect, it } from "vitest";

import { narrateTool, speakable, toUtterances } from "./speech-text.ts";
import { determineConversationalCadencePolicy } from "../conversational-cadence.ts";

describe("speakable", () => {
  it("names a code block instead of reading it", () => {
    const out = speakable("Here's the fix:\n\n```ts\nconst x: number = 1;\nif (x) throw new Error('no');\n```\n\nThat's it.");
    expect(out).toContain("TypeScript code block");
    expect(out).not.toContain("const x");
    expect(out).not.toContain("throw");
    expect(out).toContain("That's it.");
  });

  it("closes an unterminated fence rather than swallowing the rest", () => {
    // a streamed reply can be mid-fence when we're asked to speak it
    const out = speakable("Working on it:\n\n```sh\nnpm test");
    expect(out).toContain("Working on it");
    expect(out).toContain("code block");
    expect(out).not.toContain("npm test");
  });

  it("keeps a link's words and drops its URL", () => {
    expect(speakable("See [the README](https://example.com/a/b?c=d) for more")).toBe(
      "See the README for more",
    );
  });

  it("turns a bare URL into a noun", () => {
    expect(speakable("Deployed to https://openmausbot.example.com/status now")).toBe(
      "Deployed to a link now",
    );
  });

  it("says the file, not the path to it", () => {
    expect(speakable("I changed server/drivers/acp/core.ts today")).toBe("I changed core.ts today");
  });

  it("keeps short inline code but not long snippets", () => {
    expect(speakable("Run `pnpm test` first")).toBe("Run pnpm test first");
    const long = speakable(`Use \`${"x".repeat(60)}\` here`);
    expect(long).toBe("Use that snippet here");
  });

  it("strips list scaffolding but keeps the pause between items", () => {
    const out = speakable("- first thing\n- second thing\n- third thing");
    expect(out).toBe("first thing. second thing. third thing");
  });

  it("reads a table as rows, not pipes", () => {
    const out = speakable("| Name | State |\n| --- | --- |\n| Scout | idle |");
    expect(out).not.toContain("|");
    expect(out).not.toContain("---");
    expect(out).toContain("Scout, idle");
  });

  it("drops emphasis markers, emoji and checkboxes", () => {
    expect(speakable("**Done** ✅ — [x] shipped the _thing_")).toBe("Done — shipped the thing");
  });

  it("gives a heading a full stop so the voice breathes", () => {
    expect(speakable("## Results\nAll green")).toBe("Results. All green");
  });

  it("collapses the punctuation its own substitutions create", () => {
    expect(speakable("Done.\n\n\n- one\n\n- two")).toBe("Done. one. two");
  });

  it("is empty for empty input", () => {
    expect(speakable("")).toBe("");
    expect(speakable("   \n\n  ")).toBe("");
  });
});

describe("toUtterances", () => {
  it("splits on sentences", () => {
    const out = toUtterances("The tests pass now. I changed two files. Want me to push it?");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("The tests pass now.");
    expect(out[2]).toBe("Want me to push it?");
  });

  it("does not split inside a decimal or an abbreviation", () => {
    const out = toUtterances("It dropped to 11.7 seconds per step, i.e. about half of what it was before.");
    expect(out).toHaveLength(1);
  });

  it("glues a fragment onto its neighbour", () => {
    // two words handed to a synthesizer produce two words of flat prosody
    const out = toUtterances("Yes. The whole suite is green and nothing else changed.");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Yes.");
  });

  it("breaks a runaway sentence at a clause, never mid-word", () => {
    const long = `I looked at ${Array.from({ length: 40 }, (_, i) => `item ${i}`).join(", ")} and finished.`;
    const out = toUtterances(long, { maxChars: 120 });
    expect(out.length).toBeGreaterThan(1);
    for (const piece of out) expect(piece.length).toBeLessThanOrEqual(140);
    // nothing lost, nothing cut in half
    expect(out.join(" ")).toContain("item 39");
  });

  it("runs its input through the spoken register first", () => {
    const out = toUtterances("Fixed it.\n\n```js\nconsole.log(1)\n```\n\nShipped.");
    expect(out.join(" ")).not.toContain("console.log");
  });

  it("is empty for text that speaks to nothing", () => {
    expect(toUtterances("```\ncode only\n```")).not.toContain("code only");
    expect(toUtterances("")).toEqual([]);
  });
});

describe("narrateTool", () => {
  it("turns tool names into something worth hearing", () => {
    expect(narrateTool("Bash")).toBe("running a command");
    expect(narrateTool("Read")).toBe("reading a file");
    expect(narrateTool("Edit")).toBe("editing a file");
    expect(narrateTool("WebSearch")).toBe("searching the web");
    expect(narrateTool("screenshot")).toBe("looking at the screen");
  });

  it("sees through an MCP tool prefix", () => {
    expect(narrateTool("mcp__computer__click")).toBe("using the computer");
    expect(narrateTool("mcp__agents__ask_bot")).toBe("asking a teammate");
  });

  it("stays quiet for chips the user is already told about another way", () => {
    expect(narrateTool("auto-approved Bash:git (always allowed)")).toBeNull();
    expect(narrateTool("error: claude exited 1")).toBeNull();
    expect(narrateTool("")).toBeNull();
  });

  it("falls back to naming an unknown tool, without reading its argv", () => {
    expect(narrateTool("deploy_thing")).toBe("running deploy_thing");
    expect(narrateTool('curl -X POST "https://x/y" --data @{}')).toBeNull();
  });
});

describe("Official Roadmap Phase 18: Conversational Speech & Cadence Integration", () => {
  it("converts warm 1-sentence greeting replies into natural single utterances without awkward fragmentation", () => {
    const greetingReply = "Hey! What are you working on today?";
    const spoken = speakable(greetingReply);
    expect(spoken).toBe("Hey! What are you working on today?");
    const utterances = toUtterances(greetingReply);
    // Short fragments like "Hey!" are glued to their neighbour for smooth synthesizer prosody
    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toBe("Hey! What are you working on today?");
  });

  it("converts morning greetings into fluent speech without symbol artifacts", () => {
    const morningReply = "Good morning! How can I help you today?";
    const spoken = speakable(morningReply);
    expect(spoken).toBe("Good morning! How can I help you today?");
    const utterances = toUtterances(morningReply);
    expect(utterances).toHaveLength(2);
    expect(utterances[0]).toBe("Good morning!");
    expect(utterances[1]).toBe("How can I help you today?");
  });

  it("converts canonical acknowledgement into a brief, spoken sentence", () => {
    const ackReply = "Glad to hear that. Let me know when you're ready for the next step.";
    const spoken = speakable(ackReply);
    expect(spoken).toBe("Glad to hear that. Let me know when you're ready for the next step.");
    const utterances = toUtterances(ackReply);
    expect(utterances.length).toBeGreaterThanOrEqual(1);
    expect(utterances.join(" ")).toContain("Glad to hear that");
    expect(utterances.join(" ")).toContain("ready for the next step");
  });

  it("strips bullet points and markdown markers from conversational answers for clean speech delivery", () => {
    const responseWithBullets = "- Checked the build status.\n- Fixed the trailing slash.\n- Deployed to staging.";
    const spoken = speakable(responseWithBullets);
    expect(spoken).not.toContain("-");
    expect(spoken).toContain("Checked the build status. Fixed the trailing slash. Deployed to staging");
  });

  it("replaces large code blocks with spoken descriptions so voice does not recite code syntax", () => {
    const codeAnswer = "Here is the implementation:\n\n```typescript\nexport function calculate(a: number, b: number): number {\n  return a + b;\n}\n```\n\nRun the tests to verify.";
    const spoken = speakable(codeAnswer);
    expect(spoken).toContain("TypeScript code block");
    expect(spoken).not.toContain("export function");
    expect(spoken).not.toContain("return a + b");
    expect(spoken).toContain("Run the tests to verify");
  });

  it("converts markdown tables into spoken comma-separated rows without raw pipes or dashes", () => {
    const tableAnswer = "Here are the metrics:\n\n| Engine | Latency | Status |\n| --- | --- | --- |\n| SQLite | 2ms | Healthy |\n| Postgres | 18ms | Online |\n";
    const spoken = speakable(tableAnswer);
    expect(spoken).not.toContain("|");
    expect(spoken).not.toContain("---");
    expect(spoken).toContain("SQLite, 2ms, Healthy");
    expect(spoken).toContain("Postgres, 18ms, Online");
  });

  it("shortens file paths in spoken dialogue so directory structures are not recited", () => {
    const pathAnswer = "I updated server/tts/speech-text.ts and android/app/src/main/AndroidManifest.xml.";
    const spoken = speakable(pathAnswer);
    expect(spoken).toContain("speech-text.ts");
    expect(spoken).toContain("AndroidManifest.xml");
    expect(spoken).not.toContain("server/tts/");
    expect(spoken).not.toContain("android/app/src/main/");
  });

  it("integrates with ConversationalCadencePolicy to match speech target cadence", () => {
    const casualPolicy = determineConversationalCadencePolicy("Hey MOBOT");
    expect(casualPolicy.conversationalMode).toBe("casual");
    expect(casualPolicy.targetSentenceCount).toBe(1);
    expect(casualPolicy.suppressBulletPoints).toBe(true);

    const workPolicy = determineConversationalCadencePolicy("Refactor the database migrations for SQLite");
    expect(workPolicy.conversationalMode).toBe("work");
    expect(workPolicy.targetSentenceCount).toBe(4);
    expect(workPolicy.suppressBulletPoints).toBe(false);

    const crisisPolicy = determineConversationalCadencePolicy("Production is down! Database crashed!");
    expect(crisisPolicy.conversationalMode).toBe("crisis");
    expect(crisisPolicy.targetSentenceCount).toBe(2);
    expect(crisisPolicy.suppressBulletPoints).toBe(false);
  });
});

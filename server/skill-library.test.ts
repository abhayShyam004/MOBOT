import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadBundledSkills,
  loadUserSkills,
  mergeSkills,
  parseSkillManifest,
  selectBundledSkills,
  skillInstructionsFor,
  type BundledSkill,
  SkillRegistry,
  SkillLoader,
  SkillResolver,
  SkillActivation,
} from "./skill-library.ts";

const phone: BundledSkill = {
  directory: "/skills/phone-harness",
  instructions: "---\nname: phone-harness\ndescription: test\n---\nUse phone tools.",
  manifest: {
    id: "phone-harness",
    name: "Phone Harness",
    version: "0.1.0",
    description: "Control a phone",
    defaultEnabled: true,
    triggerTerms: ["android", "phone"],
    requiredCapabilities: ["phoneMcp"],
  },
};

describe("bundled skill library", () => {
  it("selects a skill only when both its trigger and capability are present", () => {
    const rendered = skillInstructionsFor("Open Uber on my Android", ["phoneMcp"], [phone]);
    expect(rendered).toContain("Use phone tools");
    expect(rendered).not.toContain('root="/skills/phone-harness"');
    expect(skillInstructionsFor("Open Uber on my Android", ["phoneMcp"], [phone], { includeRoot: true }))
      .toContain('root="/skills/phone-harness"');
    expect(skillInstructionsFor("Open Uber on my Android", [], [phone])).toBe("");
    expect(skillInstructionsFor("Write a poem", ["phoneMcp"], [phone])).toBe("");
  });

  it("requires the manifest id to match its isolated folder", () => {
    expect(() => parseSkillManifest({
      ...phone.manifest,
      id: "other-skill",
    }, "/skills/phone-harness")).toThrow(/invalid id/);
  });

  it("loads a user skill without letting a broken sibling disable it", () => {
    const root = mkdtempSync(join(tmpdir(), "openmausbot-skills-"));
    const valid = join(root, "file-expense");
    mkdirSync(valid);
    writeFileSync(join(valid, "manifest.json"), JSON.stringify({
      id: "file-expense", name: "File expense", version: "1.0.0", description: "File expenses",
      defaultEnabled: true, triggerTerms: ["expense"], requiredCapabilities: [],
    }));
    writeFileSync(join(valid, "SKILL.md"), "---\nname: file-expense\ndescription: File expenses\n---\nDo it safely.\n");
    const broken = join(root, "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "manifest.json"), "not json");
    writeFileSync(join(broken, "SKILL.md"), "broken");

    expect(loadUserSkills(root).map((skill) => skill.manifest.id)).toEqual(["file-expense"]);
  });

  it("does not let a user skill shadow a bundled skill id", () => {
    expect(mergeSkills([phone], [{ ...phone, instructions: "user replacement" }])).toEqual([phone]);
  });

  it("treats a non-directory user skill root as empty", () => {
    const root = mkdtempSync(join(tmpdir(), "openmausbot-skills-root-"));
    const file = join(root, "not-a-directory");
    writeFileSync(file, "nope");
    expect(loadUserSkills(file)).toEqual([]);
  });
});

describe("bundled verification skill", () => {
  const skills = loadBundledSkills(join(process.cwd(), "skills"));
  const instructions = skills.find((skill) => skill.manifest.id === "create-verification-skill")?.instructions ?? "";

  it("ships one reviewed authoring adapter", () => {
    const ids = skills.map((skill) => skill.manifest.id);
    expect(ids).toContain("create-verification-skill");
    expect(ids).not.toContain("maintain-verification-skill");
    expect(instructions).toContain("skill_manage");
    expect(instructions).not.toContain("~/.openmausbot");
    expect(instructions).not.toContain("propose_routine");
  });

  it("requires skill authoring and an explicit creation request", () => {
    for (const text of [
      "/create-verification-skill for my notes app",
      "can you make a verification skill so you can prove changes work",
    ]) {
      expect(selectBundledSkills(text, [], skills)).toEqual([]);
      expect(selectBundledSkills(text, ["skillAuthoring"], skills).map((skill) => skill.manifest.id))
        .toEqual(["create-verification-skill"]);
    }
  });

  it("does not mount for generic verification or maintenance phrasing", () => {
    for (const text of [
      "please verify the numbers in this invoice",
      "maintain the verification skill for atlas",
      "the verification skill is stale",
      "make a control cli",
      "create a feature map for my app",
    ]) {
      expect(selectBundledSkills(text, ["skillAuthoring"], skills)).toEqual([]);
    }
  });
});

describe("Phase B — extensible skill architecture & built-in skills", () => {
  const loader = new SkillLoader(join(process.cwd(), "skills"));
  const bundled = loader.loadBundled();
  const registry = new SkillRegistry(bundled);
  const resolver = new SkillResolver(registry);

  it("discovers both built-in skills with valid metadata and licenses", () => {
    const ids = registry.list().map((s) => s.manifest.id);
    expect(ids).toContain("ui-ux-pro-max");
    expect(ids).toContain("taste");

    const uipro = registry.get("ui-ux-pro-max");
    expect(uipro?.manifest.name).toBe("UI/UX Pro Max");
    expect(uipro?.manifest.license).toBe("MIT");
    expect(uipro?.manifest.source).toContain("nextlevelbuilder/ui-ux-pro-max-skill");
    expect(uipro?.manifest.revision).toBe("50d8a7de0900119855614541f15a1a616691eb33");
    expect(uipro?.instructions).toContain("Accessibility");
    expect(uipro?.instructions).toContain("Stanley Shen");

    const taste = registry.get("taste");
    expect(taste?.manifest.name).toBe("Taste Skill (v2 Frontend)");
    expect(taste?.manifest.license).toBe("MIT");
    expect(taste?.manifest.source).toContain("Leonxlnx/taste-skill");
    expect(taste?.manifest.revision).toBe("b17742737e796305d829b3ad39eda3add0d79060");
    expect(taste?.instructions).toContain("DESIGN_VARIANCE");
    expect(taste?.instructions).toContain("Anti-Slop");
  });

  it("selects UI/UX Pro Max when UI design or accessibility is requested", () => {
    const resolved = resolver.resolve({
      text: "Design a responsive mobile layout with good typography and accessibility",
    });
    const ids = resolved.map((s) => s.manifest.id);
    expect(ids).toContain("ui-ux-pro-max");
    expect(ids).not.toContain("taste");
  });

  it("selects Taste when aesthetic, landing page, or visual originality is requested", () => {
    const resolved = resolver.resolve({
      text: "Build an anti-generic portfolio with high aesthetic appeal and creative motion design",
    });
    const ids = resolved.map((s) => s.manifest.id);
    expect(ids).toContain("taste");
    expect(ids).not.toContain("ui-ux-pro-max");
  });

  it("selects both skills when a task requires both UI design systems and high aesthetic taste", () => {
    const resolved = resolver.resolve({
      text: "Redesign the frontend UI landing page with unique aesthetic typography and clean responsive components",
    });
    const ids = resolved.map((s) => s.manifest.id);
    expect(ids).toContain("ui-ux-pro-max");
    expect(ids).toContain("taste");
  });

  it("does not inject skills into unrelated tasks (zero token bloat)", () => {
    const resolved = resolver.resolve({
      text: "What is 15 multiplied by 24?",
    });
    expect(resolved).toEqual([]);
  });

  it("honors explicit requestedSkills and excludedSkills in SkillContext", () => {
    const forced = resolver.resolve({
      text: "Unrelated question",
      requestedSkills: ["taste"],
    });
    expect(forced.map((s) => s.manifest.id)).toEqual(["taste"]);

    const excluded = resolver.resolve({
      text: "Design a UI layout with CSS",
      excludedSkills: ["ui-ux-pro-max"],
    });
    expect(excluded.map((s) => s.manifest.id)).not.toContain("ui-ux-pro-max");
  });

  it("renders activated skills via SkillActivation cleanly", () => {
    const activation = SkillActivation.activate(resolver, {
      text: "Design a responsive UI header",
    });
    expect(activation.activeSkills.map((s) => s.manifest.id)).toContain("ui-ux-pro-max");
    expect(activation.instructions).toContain('<openmaus-skill id="ui-ux-pro-max" version="1.0.0">');
    expect(activation.instructions).toContain("UI/UX Pro Max");
  });
});

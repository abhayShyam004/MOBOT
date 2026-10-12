// Bundled and extensible skill subsystem for MOBOT.
//
// Skills remain isolated resources so adding or disabling one does not
// require changing provider drivers. A task activates skills on demand
// based on declared trigger terms, requested capabilities, and explicit
// context. Instructions are injected cleanly per turn without prompt bloat.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  defaultEnabled: boolean;
  triggerTerms: string[];
  requiredCapabilities: string[];
  source?: string;
  license?: string;
  revision?: string;
  dependencies?: string[];
  supportedStacks?: string[];
  triggers?: string[];
  capabilities?: string[];
  enabled?: boolean;
}

export interface BundledSkill {
  manifest: SkillManifest;
  instructions: string;
  directory: string;
}

export interface SkillContext {
  text: string;
  capabilities?: Iterable<string>;
  requestedSkills?: string[];
  excludedSkills?: string[];
  botId?: string;
  threadId?: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())
    ? value.map((item) => item.trim())
    : null;
}

export function parseSkillManifest(value: unknown, directory: string): SkillManifest {
  if (!value || typeof value !== "object") throw new Error(`${directory}/manifest.json is invalid`);
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const triggerTerms = strings(raw.triggerTerms) ?? strings(raw.triggers);
  const requiredCapabilities =
    raw.requiredCapabilities !== undefined
      ? strings(raw.requiredCapabilities)
      : raw.capabilities !== undefined
        ? strings(raw.capabilities)
        : [];
  if (!SAFE_ID.test(id) || id !== basename(directory)) throw new Error(`${directory}/manifest.json has an invalid id`);
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error(`${directory}/manifest.json has no name`);
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.version)) throw new Error(`${directory}/manifest.json has an invalid version`);
  if (typeof raw.description !== "string" || !raw.description.trim()) throw new Error(`${directory}/manifest.json has no description`);
  if (typeof raw.defaultEnabled !== "boolean" && typeof raw.enabled !== "boolean") throw new Error(`${directory}/manifest.json has no defaultEnabled flag`);
  if (!triggerTerms?.length) throw new Error(`${directory}/manifest.json has no trigger terms`);
  if (!requiredCapabilities) throw new Error(`${directory}/manifest.json has invalid capabilities`);

  const defaultEnabled = typeof raw.defaultEnabled === "boolean" ? raw.defaultEnabled : Boolean(raw.enabled);

  return {
    id,
    name: raw.name.trim(),
    version: raw.version,
    description: raw.description.trim(),
    defaultEnabled,
    triggerTerms,
    requiredCapabilities,
    source: typeof raw.source === "string" ? raw.source : undefined,
    license: typeof raw.license === "string" ? raw.license : undefined,
    revision: typeof raw.revision === "string" ? raw.revision : undefined,
    dependencies: strings(raw.dependencies) ?? undefined,
    supportedStacks: strings(raw.supportedStacks) ?? undefined,
  };
}

export function loadSkillDirectory(directory: string): BundledSkill | null {
  const manifestPath = join(directory, "manifest.json");
  const skillPath = join(directory, "SKILL.md");
  if (!existsSync(manifestPath) || !existsSync(skillPath)) return null;
  const manifest = parseSkillManifest(JSON.parse(readFileSync(manifestPath, "utf8")), directory);
  const instructions = readFileSync(skillPath, "utf8").trim();
  if (!instructions.startsWith("---")) throw new Error(`${skillPath} has no skill frontmatter`);
  return { manifest, instructions, directory };
}

export function defaultSkillsRoot(): string {
  if (process.env.OMB_SKILLS_DIR && existsSync(process.env.OMB_SKILLS_DIR)) {
    return process.env.OMB_SKILLS_DIR;
  }
  const moduleDir = typeof import.meta?.url === "string" ? dirname(fileURLToPath(import.meta.url)) : "";
  const candidates = [
    join(process.cwd(), "skills"),
    ...(moduleDir ? [join(moduleDir, "skills"), join(moduleDir, "..", "skills")] : []),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return join(process.cwd(), "skills");
}

export function loadBundledSkills(root = defaultSkillsRoot()): BundledSkill[] {
  if (!existsSync(root)) return [];
  const skills: BundledSkill[] = [];
  for (const name of readdirSync(root).sort()) {
    const directory = join(root, name);
    const skill = loadSkillDirectory(directory);
    if (skill) skills.push(skill);
  }
  return skills;
}

/** User skills are hot-loaded on each turn so a skill that was just enabled
 * or hand-authored works without restarting the desktop app. One broken
 * folder is isolated instead of taking down every bot turn. */
export function loadUserSkills(root: string): BundledSkill[] {
  if (!existsSync(root)) return [];
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const skills: BundledSkill[] = [];
  for (const name of names) {
    try {
      const skill = loadSkillDirectory(join(root, name));
      if (skill) skills.push(skill);
    } catch {
      // Skills the app writes are validated first, but people are free to
      // hand-edit the folders later. A malformed edit disables only itself.
    }
  }
  return skills;
}

export function mergeSkills(bundled: readonly BundledSkill[], user: readonly BundledSkill[]): BundledSkill[] {
  const byId = new Map(bundled.map((skill) => [skill.manifest.id, skill]));
  for (const skill of user) {
    if (!byId.has(skill.manifest.id)) byId.set(skill.manifest.id, skill);
  }
  return [...byId.values()];
}

export function skillInstructionsFor(
  text: string,
  capabilities: Iterable<string>,
  skills: readonly BundledSkill[],
  options?: { includeRoot?: boolean },
): string {
  return renderSkillInstructions(selectBundledSkills(text, capabilities, skills), options);
}

export function matchesTrigger(haystack: string, term: string): boolean {
  const lowerHaystack = haystack.toLowerCase();
  const lowerTerm = term.toLowerCase().trim();
  if (!lowerTerm) return false;
  if (/^[a-z0-9_-]{1,3}$/i.test(lowerTerm)) {
    const regex = new RegExp(`\\b${lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(lowerHaystack);
  }
  return lowerHaystack.includes(lowerTerm);
}

export function selectBundledSkills(
  text: string,
  capabilities: Iterable<string>,
  skills: readonly BundledSkill[],
): BundledSkill[] {
  const available = new Set(capabilities);
  return skills.filter(({ manifest }) =>
    manifest.defaultEnabled &&
    manifest.requiredCapabilities.every((capability) => available.has(capability)) &&
    manifest.triggerTerms.some((term) => matchesTrigger(text, term)),
  );
}

export function renderSkillInstructions(
  selected: readonly BundledSkill[],
  { includeRoot = false }: { includeRoot?: boolean } = {},
): string {
  if (!selected.length) return "";
  return selected.map(({ manifest, instructions, directory }) =>
    `\n\n<openmaus-skill id=${JSON.stringify(manifest.id)} version=${JSON.stringify(manifest.version)}${includeRoot ? ` root=${JSON.stringify(directory)}` : ""}>\n${instructions}\n</openmaus-skill>`,
  ).join("");
}

// --------------------------------------------------
// Generic Extensible Skill Subsystem Architecture
// --------------------------------------------------

export class SkillRegistry {
  private skills = new Map<string, BundledSkill>();

  constructor(initialSkills?: readonly BundledSkill[]) {
    if (initialSkills) {
      for (const skill of initialSkills) {
        this.register(skill);
      }
    }
  }

  register(skill: BundledSkill): void {
    this.skills.set(skill.manifest.id, skill);
  }

  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  get(id: string): BundledSkill | undefined {
    return this.skills.get(id);
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  list(): BundledSkill[] {
    return Array.from(this.skills.values());
  }

  clear(): void {
    this.skills.clear();
  }
}

export class SkillLoader {
  private bundledRoot: string;

  constructor(bundledRoot = defaultSkillsRoot()) {
    this.bundledRoot = bundledRoot;
  }

  loadBundled(): BundledSkill[] {
    return loadBundledSkills(this.bundledRoot);
  }

  loadUser(userRoot: string): BundledSkill[] {
    return loadUserSkills(userRoot);
  }

  loadAll(userRoot?: string): BundledSkill[] {
    const bundled = this.loadBundled();
    if (!userRoot) return bundled;
    return mergeSkills(bundled, this.loadUser(userRoot));
  }
}

export class SkillResolver {
  private registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  resolve(context: SkillContext): BundledSkill[] {
    const skills = this.registry.list();
    const available = new Set(context.capabilities ?? []);
    const requested = new Set(context.requestedSkills ?? []);
    const excluded = new Set(context.excludedSkills ?? []);

    return skills.filter(({ manifest }) => {
      if (excluded.has(manifest.id)) return false;
      if (requested.has(manifest.id)) return true;
      if (!manifest.defaultEnabled) return false;
      if (!manifest.requiredCapabilities.every((cap) => available.has(cap))) return false;
      return manifest.triggerTerms.some((term) => matchesTrigger(context.text, term));
    });
  }
}

export class SkillActivation {
  static render(skills: readonly BundledSkill[], options?: { includeRoot?: boolean }): string {
    return renderSkillInstructions(skills, options);
  }

  static activate(
    resolver: SkillResolver,
    context: SkillContext,
    options?: { includeRoot?: boolean },
  ): { activeSkills: BundledSkill[]; instructions: string } {
    const activeSkills = resolver.resolve(context);
    const instructions = SkillActivation.render(activeSkills, options);
    return { activeSkills, instructions };
  }
}

import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";
import type { ModelSelection } from "./contracts.ts";
import {
  CANONICAL_PRESETS,
  GENERAL_AGENT_PRESET,
  IDEA_GENERATOR_PRESET,
  JOKE_TELLER_PRESET,
  PERSONAL_RESEARCHER_PRESET,
  PROBLEM_SOLVER_PRESET,
  STUDY_BUDDY_PRESET,
  compileAgentContractPrompt,
  getRolePreset,
  isAgentContract,
  rankToolsByAffinity,
  resolveAgentContract,
  validateAgentContract,
  type AgentContract,
} from "../shared/agent-contract.ts";

describe("AgentContract Schema & Validation", () => {
  it("validates all canonical presets successfully", () => {
    for (const [key, preset] of Object.entries(CANONICAL_PRESETS)) {
      const result = validateAgentContract(preset);
      expect(result.valid, `Preset ${key} failed validation: ${result.errors.join(", ")}`).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(isAgentContract(preset)).toBe(true);
    }
  });

  it("rejects non-object or null contracts", () => {
    expect(validateAgentContract(null).valid).toBe(false);
    expect(validateAgentContract(undefined).valid).toBe(false);
    expect(validateAgentContract("string").valid).toBe(false);
    expect(validateAgentContract(123).valid).toBe(false);
    expect(validateAgentContract([]).valid).toBe(false);
    expect(isAgentContract(null)).toBe(false);
    expect(isAgentContract([])).toBe(false);
  });

  it("detects missing mandatory contract fields", () => {
    const incomplete = {
      contractVersion: 1,
      role: "test",
      // missing roleTitle, identity, cognitiveStance, etc.
    };
    const result = validateAgentContract(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });

  it("enforces version >= 1", () => {
    const invalid = { ...GENERAL_AGENT_PRESET, contractVersion: 0 };
    const result = validateAgentContract(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("contractVersion must be an integer >= 1");
  });
});

describe("Role Presets & Cognitive Stances", () => {
  it("Joke Teller has divergent creativity, relaxed verification, and concise output", () => {
    expect(JOKE_TELLER_PRESET.role).toBe("joke_teller");
    expect(JOKE_TELLER_PRESET.cognitiveStance.creativityBias).toBe("divergent");
    expect(JOKE_TELLER_PRESET.cognitiveStance.reasoningDepth).toBe("concise");
    expect(JOKE_TELLER_PRESET.verificationPolicy.rigorLevel).toBe("relaxed");
    expect(JOKE_TELLER_PRESET.verificationPolicy.empiricalVerificationRequired).toBe(false);
    expect(JOKE_TELLER_PRESET.outputDelivery.defaultVerbosity).toBe("concise");
  });

  it("Study Buddy has deep reasoning, pedagogical stance, and high memory sensitivity", () => {
    expect(STUDY_BUDDY_PRESET.role).toBe("study_buddy");
    expect(STUDY_BUDDY_PRESET.cognitiveStance.reasoningDepth).toBe("deep");
    expect(STUDY_BUDDY_PRESET.contextSensitivity.memorySensitivity).toBe("high");
    expect(STUDY_BUDDY_PRESET.contextSensitivity.goalAlignmentSensitivity).toBe("high");
    expect(STUDY_BUDDY_PRESET.verificationPolicy.empiricalVerificationRequired).toBe(true);
  });

  it("Idea Generator has high creativity bias and divergent brainstorming stance", () => {
    expect(IDEA_GENERATOR_PRESET.role).toBe("idea_generator");
    expect(IDEA_GENERATOR_PRESET.cognitiveStance.creativityBias).toBe("high");
    expect(IDEA_GENERATOR_PRESET.autonomyPolicy.initiativeLevel).toBe("proactive");
    expect(IDEA_GENERATOR_PRESET.outputDelivery.preferredFormat).toBe("bulleted");
  });

  it("Personal Researcher has exhaustive reasoning, critical skepticism, and strict verification", () => {
    expect(PERSONAL_RESEARCHER_PRESET.role).toBe("personal_researcher");
    expect(PERSONAL_RESEARCHER_PRESET.cognitiveStance.reasoningDepth).toBe("exhaustive");
    expect(PERSONAL_RESEARCHER_PRESET.cognitiveStance.skepticismLevel).toBe("critical");
    expect(PERSONAL_RESEARCHER_PRESET.verificationPolicy.rigorLevel).toBe("strict");
    expect(PERSONAL_RESEARCHER_PRESET.verificationPolicy.empiricalVerificationRequired).toBe(true);
    expect(PERSONAL_RESEARCHER_PRESET.verificationPolicy.artifactValidation).toBe(true);
  });

  it("Problem Solver has exhaustive reasoning, adversarial skepticism, and shell/diagnostic affinity", () => {
    expect(PROBLEM_SOLVER_PRESET.role).toBe("problem_solver");
    expect(PROBLEM_SOLVER_PRESET.cognitiveStance.reasoningDepth).toBe("exhaustive");
    expect(PROBLEM_SOLVER_PRESET.cognitiveStance.skepticismLevel).toBe("adversarial");
    expect(PROBLEM_SOLVER_PRESET.cognitiveStance.actionOrientation).toBe("direct_action");
    expect(PROBLEM_SOLVER_PRESET.verificationPolicy.rigorLevel).toBe("strict");
    expect(PROBLEM_SOLVER_PRESET.toolAffinity.preferredCategories).toContain("shell");
    expect(PROBLEM_SOLVER_PRESET.toolAffinity.preferredCategories).toContain("diagnostics");
    expect(PROBLEM_SOLVER_PRESET.contextSensitivity.deviceStateSensitivity).toBe("high");
  });

  it("General Agent preset provides a balanced, robust baseline", () => {
    expect(GENERAL_AGENT_PRESET.role).toBe("general_agent");
    expect(GENERAL_AGENT_PRESET.cognitiveStance.reasoningDepth).toBe("balanced");
    expect(GENERAL_AGENT_PRESET.cognitiveStance.skepticismLevel).toBe("balanced");
    expect(GENERAL_AGENT_PRESET.cognitiveStance.actionOrientation).toBe("balanced");
    expect(GENERAL_AGENT_PRESET.verificationPolicy.rigorLevel).toBe("standard");
  });

  it("looks up presets by normalized key or title variations", () => {
    expect(getRolePreset("joke_teller")?.role).toBe("joke_teller");
    expect(getRolePreset("Joke Teller")?.role).toBe("joke_teller");
    expect(getRolePreset("study_buddy")?.role).toBe("study_buddy");
    expect(getRolePreset("Study Buddy")?.role).toBe("study_buddy");
    expect(getRolePreset("problem_solver")?.role).toBe("problem_solver");
    expect(getRolePreset("Problem Solver")?.role).toBe("problem_solver");
    expect(getRolePreset(undefined)).toBeNull();
    expect(getRolePreset("unknown_custom_role")).toBeNull();
  });
});

describe("Deterministic Contract Resolver", () => {
  it("INVARIANT 1: Every bot resolves to exactly one effective AgentContract", () => {
    const bots = [
      { name: "Empty Bot" },
      { name: "Joke Bot", role: "joke_teller" },
      { name: "Researcher", title: "Personal Researcher" },
      { name: "Legacy Scout", description: "General helper" },
      { name: "Corrupted Bot", contract: { bad: "data" } },
    ];

    for (const b of bots) {
      const contract = resolveAgentContract(b);
      expect(isAgentContract(contract)).toBe(true);
      expect(contract.contractVersion).toBe(1);
      expect(contract.roleTitle).toBeTruthy();
    }
  });

  it("preserves explicit valid contract on bot", () => {
    const explicitContract: AgentContract = {
      ...PROBLEM_SOLVER_PRESET,
      roleTitle: "Custom Debug Specialist",
      identity: {
        name: "FixerBot",
        purpose: "Resolve Linux kernel crashes",
        coreMission: "Find the faulting syscall",
        behavioralStance: "Methodical forensic debugger",
      },
    };

    const resolved = resolveAgentContract({
      name: "FixerBot",
      contract: explicitContract,
    });

    expect(resolved.roleTitle).toBe("Custom Debug Specialist");
    expect(resolved.identity.name).toBe("FixerBot");
    expect(resolved.identity.purpose).toBe("Resolve Linux kernel crashes");
    expect(resolved.cognitiveStance.skepticismLevel).toBe("adversarial");
  });

  it("resolves role preset by role string, title, or description", () => {
    const bot1 = resolveAgentContract({ name: "Togepi", role: "joke_teller" });
    expect(bot1.role).toBe("joke_teller");

    const bot2 = resolveAgentContract({ name: "Aristotle", title: "Study Buddy" });
    expect(bot2.role).toBe("study_buddy");

    const bot3 = resolveAgentContract({ name: "Curie", description: "Personal Researcher on biotech" });
    expect(bot3.role).toBe("personal_researcher");

    const bot4 = resolveAgentContract({ name: "Sherlock", title: "Problem Solver" });
    expect(bot4.role).toBe("problem_solver");
  });

  it("INVARIANT 8: Legacy bots remain valid with fallback contract preserving identity", () => {
    const legacy = {
      name: "Old Companion",
      title: "Assistant",
      description: "My personal helper from v1.0",
    };
    const resolved = resolveAgentContract(legacy);

    expect(resolved.contractVersion).toBe(1);
    expect(resolved.identity.name).toBe("Old Companion");
    expect(resolved.roleTitle).toBe("Assistant");
    expect(resolved.identity.purpose).toBe("My personal helper from v1.0");
    expect(resolved.cognitiveStance).toBeDefined();
    expect(resolved.verificationPolicy.empiricalVerificationRequired).toBe(true);
  });

  it("handles malformed contract gracefully by falling back safely", () => {
    const malformed = {
      name: "BrokenBot",
      contract: { contractVersion: "one", role: 123 }, // invalid types
    };
    const resolved = resolveAgentContract(malformed);
    expect(isAgentContract(resolved)).toBe(true);
    expect(resolved.identity.name).toBe("BrokenBot");
    expect(resolved.role).toBe("general_agent");
  });
});

describe("System Prompt Compilation", () => {
  it("compiles contract into deterministic, structured string", () => {
    const prompt = compileAgentContractPrompt(PROBLEM_SOLVER_PRESET);
    expect(prompt).toContain("=== AUTHORITATIVE AGENT CONTRACT ===");
    expect(prompt).toContain("Role: Problem Solver [problem_solver] (Contract v1)");
    expect(prompt).toContain("COGNITIVE STANCE:");
    expect(prompt).toContain("Reasoning Depth: EXHAUSTIVE");
    expect(prompt).toContain("Skepticism Level: ADVERSARIAL");
    expect(prompt).toContain("Action Orientation: DIRECT_ACTION");
    expect(prompt).toContain("VERIFICATION STANDARDS:");
    expect(prompt).toContain("Rigor Level: STRICT");
    expect(prompt).toContain("TOOL AFFINITY & CAPABILITY PREFERENCE:");
    expect(prompt).toContain("Preferred Tool Categories: shell, diagnostics, terminal, filesystem, process, verification");
    expect(prompt).toContain("=== END CONTRACT ===");
  });

  it("INVARIANT 9: The contract compiler is deterministic across multiple calls", () => {
    const prompt1 = compileAgentContractPrompt(STUDY_BUDDY_PRESET);
    const prompt2 = compileAgentContractPrompt(STUDY_BUDDY_PRESET);
    expect(prompt1).toBe(prompt2);
  });

  it("INVARIANT 11: Never includes emojis in compiled contract output", () => {
    const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    for (const preset of Object.values(CANONICAL_PRESETS)) {
      const prompt = compileAgentContractPrompt(preset);
      expect(emojiRegex.test(prompt), `Preset ${preset.role} prompt contains emoji`).toBe(false);
    }
  });

  it("INVARIANT 10: Contract prompt does not leak passwords, tokens or credentials", () => {
    const secretKeywords = ["sk-ant-", "ghp_", "bearer ", "password=", "secret_key"];
    for (const preset of Object.values(CANONICAL_PRESETS)) {
      const prompt = compileAgentContractPrompt(preset).toLowerCase();
      for (const secret of secretKeywords) {
        expect(prompt.includes(secret)).toBe(false);
      }
    }
  });
});

describe("Tool Affinity Interpretation", () => {
  it("prioritizes matching tools according to role preferences", () => {
    const allTools = [
      "run_shell",
      "terminal_write",
      "web_search",
      "browser_open",
      "verify_service",
      "delight_joke",
      "random_casual_talk",
    ];

    const solverRank = rankToolsByAffinity(PROBLEM_SOLVER_PRESET, allTools);
    expect(solverRank.prioritized).toContain("run_shell");
    expect(solverRank.prioritized).toContain("terminal_write");
    expect(solverRank.prioritized).toContain("verify_service");
    expect(solverRank.deprioritized).toContain("random_casual_talk");

    const jokeRank = rankToolsByAffinity(JOKE_TELLER_PRESET, allTools);
    expect(jokeRank.prioritized).toContain("web_search");
    expect(jokeRank.prioritized).toContain("delight_joke");
    expect(jokeRank.deprioritized).toContain("run_shell");
  });

  it("INVARIANT 3 & 4: Tool affinity does not grant or authorize tools", () => {
    // Tool affinity ranking merely separates tools into prioritized, standard, and deprioritized buckets.
    // It does not alter the input list or grant missing capabilities.
    const available = ["web_search", "browser_open"];
    const ranked = rankToolsByAffinity(PROBLEM_SOLVER_PRESET, available);
    // Even though PROBLEM_SOLVER prefers "run_shell", it cannot invent "run_shell" if not in availableTools
    expect(ranked.prioritized).not.toContain("run_shell");
    expect(ranked.standard).not.toContain("run_shell");
    expect(ranked.deprioritized).not.toContain("run_shell");
  });
});

describe("Serialization & Persistence Invariants", () => {
  it("survives round-trip JSON serialization without data loss", () => {
    for (const preset of Object.values(CANONICAL_PRESETS)) {
      const serialized = JSON.stringify(preset);
      const deserialized = JSON.parse(serialized);
      expect(isAgentContract(deserialized)).toBe(true);
      expect(deserialized.role).toBe(preset.role);
      expect(deserialized.cognitiveStance).toEqual(preset.cognitiveStance);
      expect(deserialized.toolAffinity).toEqual(preset.toolAffinity);
      expect(deserialized.verificationPolicy).toEqual(preset.verificationPolicy);
      expect(deserialized.contextSensitivity).toEqual(preset.contextSensitivity);
      expect(deserialized.autonomyPolicy).toEqual(preset.autonomyPolicy);
      expect(deserialized.outputDelivery).toEqual(preset.outputDelivery);
    }
  });

  it("INVARIANT 6: Contract state cannot leak across bots", () => {
    const botA = { name: "Bot A", role: "joke_teller" };
    const botB = { name: "Bot B", role: "problem_solver" };

    const contractA = resolveAgentContract(botA);
    const contractB = resolveAgentContract(botB);

    expect(contractA.role).toBe("joke_teller");
    expect(contractB.role).toBe("problem_solver");
    expect(contractA.identity.name).toBe("Bot A");
    expect(contractB.identity.name).toBe("Bot B");
    expect(contractA.cognitiveStance.creativityBias).not.toBe(contractB.cognitiveStance.creativityBias);
    expect(contractA.cognitiveStance.skepticismLevel).not.toBe(contractB.cognitiveStance.skepticismLevel);
  });

  it("INVARIANT 7: Store persists contract and survives restart", () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    const selection = (): ModelSelection => ({ instanceId: "claude", model: "sonnet" });
    const store = new Store(selection);

    const bot = store.createBot({
      name: "Togepi",
      title: "Joke Teller",
      description: "Tells funny programming jokes",
    });

    expect(bot.contract).toBeDefined();
    expect(bot.contract?.role).toBe("joke_teller");
    expect(bot.contract?.identity.name).toBe("Togepi");

    // Restart store (reload from bots.json)
    const reloaded = new Store(selection);
    const loadedBot = reloaded.bot(bot.id);
    expect(loadedBot).not.toBeNull();
    expect(loadedBot?.contract).toBeDefined();
    expect(loadedBot?.contract?.role).toBe("joke_teller");
    expect(loadedBot?.contract?.cognitiveStance.creativityBias).toBe("divergent");
    expect(loadedBot?.contract?.outputDelivery.defaultVerbosity).toBe("concise");
  });

  it("INVARIANT 5: Deleting a bot deletes its contract and workspace state", () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    const selection = (): ModelSelection => ({ instanceId: "claude", model: "sonnet" });
    const store = new Store(selection);

    const bot = store.createBot({
      name: "Sherlock",
      title: "Problem Solver",
    });

    expect(store.bot(bot.id)).not.toBeNull();
    expect(store.bot(bot.id)?.contract?.role).toBe("problem_solver");

    store.deleteBot(bot.id);
    expect(store.bot(bot.id)).toBeNull();

    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)).toBeNull();
  });
});

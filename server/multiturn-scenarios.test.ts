import { describe, expect, it } from "vitest";
import { resolveLocationIntent, type UserLocation } from "./location-context.ts";
import { buildTurnContext, type TurnContextInput } from "./turn-context.ts";

export interface ScenarioTurn {
  turnIndex: number;
  userMessage: string;
  assistantExpectedClass: string;
  toolExecuted?: string;
  toolResultSuccess?: boolean;
  expectedLocationScope?: string;
  expectedCity?: string;
  notes: string;
}

export interface ScenarioDefinition {
  scenarioId: string;
  title: string;
  turns: ScenarioTurn[];
}

export const SCENARIO_A: ScenarioDefinition = {
  scenarioId: "SCENARIO_A",
  title: "Research to Decision to Tool Action to Verification",
  turns: [
    { turnIndex: 1, userMessage: "Find me a good Mexican restaurant in downtown Portland.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Explicit location Portland" },
    { turnIndex: 2, userMessage: "What are their operating hours today?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Reuses Portland" },
    { turnIndex: 3, userMessage: "Which of them have outdoor patio seating?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Filters patio seating" },
    { turnIndex: 4, userMessage: "Do any offer gluten free options?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Filters dietary" },
    { turnIndex: 5, userMessage: "What is the average entree price at the second one?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Cites menu pricing" },
    { turnIndex: 6, userMessage: "How far is it from Pioneer Square?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Distance check" },
    { turnIndex: 7, userMessage: "I choose the second restaurant.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "User selection" },
    { turnIndex: 8, userMessage: "Give me directions there.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "open_app", toolResultSuccess: true, expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Maps tool invocation" },
    { turnIndex: 9, userMessage: "What is the current traffic on the route?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Traffic conditions" },
    { turnIndex: 10, userMessage: "Confirm their contact phone number.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Empirical contact detail" },
    { turnIndex: 11, userMessage: "Is there street parking or a dedicated lot?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Parking availability" },
    { turnIndex: 12, userMessage: "Summarize my selected itinerary.", assistantExpectedClass: "STRUCTURED_OUTPUT", expectedLocationScope: "explicit_override", expectedCity: "Portland", notes: "Structured final summary" },
  ],
};

export const SCENARIO_B: ScenarioDefinition = {
  scenarioId: "SCENARIO_B",
  title: "Ambiguous Prompt to Clarification to Partial Info to Execution",
  turns: [
    { turnIndex: 1, userMessage: "Help me buy a computer.", assistantExpectedClass: "CLARIFICATION_REQUEST", toolExecuted: "ask_user", notes: "Vague request prompts ask_user" },
    { turnIndex: 2, userMessage: "I want a laptop for software development.", assistantExpectedClass: "CLARIFICATION_REQUEST", toolExecuted: "ask_user", notes: "Scoping OS preferences" },
    { turnIndex: 3, userMessage: "I prefer Linux as the primary operating system.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Narrows to Linux laptops" },
    { turnIndex: 4, userMessage: "My budget is under 1500 dollars.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Applies budget constraint" },
    { turnIndex: 5, userMessage: "Compare Framework 13 vs ThinkPad T14.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Comparison of top candidates" },
    { turnIndex: 6, userMessage: "Which one has better battery life under Ubuntu?", assistantExpectedClass: "DIRECT_ANSWER", notes: "OS specific battery benchmarks" },
    { turnIndex: 7, userMessage: "Can the RAM be upgraded later by the user?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Upgradability analysis" },
    { turnIndex: 8, userMessage: "How many USB-C ports does each have?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Port configuration" },
    { turnIndex: 9, userMessage: "What is the display resolution and aspect ratio?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Display metrics" },
    { turnIndex: 10, userMessage: "Are there any known Linux driver issues with Wi-Fi?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Kernel compatibility" },
    { turnIndex: 11, userMessage: "I will go with the Framework 13.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Decision finalized" },
    { turnIndex: 12, userMessage: "Output the final hardware specification sheet.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Structured spec sheet" },
  ],
};

export const SCENARIO_C: ScenarioDefinition = {
  scenarioId: "SCENARIO_C",
  title: "Fact Correction Mid-Task",
  turns: [
    { turnIndex: 1, userMessage: "How do I install Python on macOS?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Initial macOS context" },
    { turnIndex: 2, userMessage: "Wait, correction: I am using Ubuntu 24.04 Linux.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Fact correction: drops brew, adopts apt" },
    { turnIndex: 3, userMessage: "Which command updates the package index?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Verifies Linux apt context" },
    { turnIndex: 4, userMessage: "Actually Python 3.12 is already installed.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Second correction: skips install" },
    { turnIndex: 5, userMessage: "How do I verify the exact patch version?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Version verification" },
    { turnIndex: 6, userMessage: "Create a virtual environment named dev-env.", assistantExpectedClass: "DIRECT_ANSWER", notes: "venv creation syntax" },
    { turnIndex: 7, userMessage: "How do I activate that environment in bash?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Activation command" },
    { turnIndex: 8, userMessage: "I use fish shell, not bash.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Third correction: shell syntax" },
    { turnIndex: 9, userMessage: "How do I activate it in fish shell?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Fish activation source .venv/bin/activate.fish" },
    { turnIndex: 10, userMessage: "Install requests and pytest.", assistantExpectedClass: "DIRECT_ANSWER", notes: "pip install command" },
    { turnIndex: 11, userMessage: "How do I freeze installed packages to requirements.txt?", assistantExpectedClass: "DIRECT_ANSWER", notes: "pip freeze" },
    { turnIndex: 12, userMessage: "Summarize the complete setup procedure for fish shell on Ubuntu.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Consistent final summary" },
  ],
};

export const SCENARIO_D: ScenarioDefinition = {
  scenarioId: "SCENARIO_D",
  title: "Location Switch Mid-Task",
  turns: [
    { turnIndex: 1, userMessage: "Find specialty coffee roasters in Seattle.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Seattle", notes: "Seattle location" },
    { turnIndex: 2, userMessage: "What about tomorrow morning?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Seattle", notes: "Reuses Seattle" },
    { turnIndex: 3, userMessage: "Are any open before 7 AM there?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Seattle", notes: "Reuses Seattle hours" },
    { turnIndex: 4, userMessage: "Recommend a bakery in that same neighborhood.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Seattle", notes: "Reuses Seattle bakery" },
    { turnIndex: 5, userMessage: "Now check Chicago.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Chicago", notes: "Overrides to Chicago" },
    { turnIndex: 6, userMessage: "Find coffee roasters in Wicker Park.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Wicker Park", notes: "Chicago neighborhood" },
    { turnIndex: 7, userMessage: "What is the forecast there this weekend?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Wicker Park", notes: "Reuses Wicker Park weather" },
    { turnIndex: 8, userMessage: "Will it rain on Saturday?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "explicit_override", expectedCity: "Wicker Park", notes: "Saturday rain check in Wicker Park" },
    { turnIndex: 9, userMessage: "What about back home?", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "default", expectedCity: "Denver", notes: "Reverts to default Denver" },
    { turnIndex: 10, userMessage: "Find local roasters near me.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "default", expectedCity: "Denver", notes: "Default location roasters" },
    { turnIndex: 11, userMessage: "Search globally without my location for rare geisha beans.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "suppressed", notes: "Privacy suppression" },
    { turnIndex: 12, userMessage: "Re-enable location and show closest cafe.", assistantExpectedClass: "DIRECT_ANSWER", expectedLocationScope: "default", expectedCity: "Denver", notes: "Restores default location" },
  ],
};

export const SCENARIO_E: ScenarioDefinition = {
  scenarioId: "SCENARIO_E",
  title: "Rapid Multi-Message Burst and Deduplication",
  turns: [
    { turnIndex: 1, userMessage: "Analyze backend performance.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Burst 1" },
    { turnIndex: 2, userMessage: "Specifically memory consumption.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Burst 2" },
    { turnIndex: 3, userMessage: "And CPU profile.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Burst 3" },
    { turnIndex: 4, userMessage: "And disk I/O.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Burst 4 drained into unified turn" },
    { turnIndex: 5, userMessage: "Check CPU profile again (duplicate sendId).", assistantExpectedClass: "NOOP_ACK", notes: "Deduplicated by steer queue" },
    { turnIndex: 6, userMessage: "Recommend profiling tools for Linux.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Tool survey" },
    { turnIndex: 7, userMessage: "How do I run perf record?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Command flags" },
    { turnIndex: 8, userMessage: "What overhead does it introduce?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Performance impact" },
    { turnIndex: 9, userMessage: "Generate flamegraph from perf script output.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Pipeline instructions" },
    { turnIndex: 10, userMessage: "What does the width of each frame represent?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Visualization interpretation" },
    { turnIndex: 11, userMessage: "How do I interpret kernel vs user space frames?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Frame categorization" },
    { turnIndex: 12, userMessage: "Summarize optimization recommendations.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Final summary" },
  ],
};

export const SCENARIO_F: ScenarioDefinition = {
  scenarioId: "SCENARIO_F",
  title: "Mixed Media and Attachment Conversation",
  turns: [
    { turnIndex: 1, userMessage: "I have uploaded financial_report.pdf.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Attachment registration" },
    { turnIndex: 2, userMessage: "Extract the executive summary from page 1.", assistantExpectedClass: "DIRECT_ANSWER", notes: "PDF page extraction" },
    { turnIndex: 3, userMessage: "What was the operating margin reported in table 2?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Tabular extraction" },
    { turnIndex: 4, userMessage: "Who signed the audit statement?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Audit signatory" },
    { turnIndex: 5, userMessage: "I have uploaded balance_chart.png.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Image registration" },
    { turnIndex: 6, userMessage: "Does the chart trend match the reported figures in the PDF?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Cross-media synthesis" },
    { turnIndex: 7, userMessage: "Identify the lowest revenue quarter on the chart.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Visual data extraction" },
    { turnIndex: 8, userMessage: "Extract the risk factors listed on page 14 of the PDF.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Deep page extraction" },
    { turnIndex: 9, userMessage: "Save a consolidated summary to workspace.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_write", toolResultSuccess: true, notes: "Workspace file write" },
    { turnIndex: 10, userMessage: "Verify that the file exists and check its byte size.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_stat", toolResultSuccess: true, notes: "File verification" },
    { turnIndex: 11, userMessage: "Read the first 3 lines of the written summary.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_read", toolResultSuccess: true, notes: "File read validation" },
    { turnIndex: 12, userMessage: "Confirm audit package completeness.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Complete verification" },
  ],
};

export const SCENARIO_G: ScenarioDefinition = {
  scenarioId: "SCENARIO_G",
  title: "Tool Failure to Self-Correction to Success",
  turns: [
    { turnIndex: 1, userMessage: "Read the file missing_config.json.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_read", toolResultSuccess: false, notes: "Tool fails ENOENT" },
    { turnIndex: 2, userMessage: "Why did that fail?", assistantExpectedClass: "ERROR_REPORT", notes: "Honest error reporting, zero fabrication" },
    { turnIndex: 3, userMessage: "List available files in directory.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Self-correcting inspection" },
    { turnIndex: 4, userMessage: "I see config_v2.json in the listing.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Target identified" },
    { turnIndex: 5, userMessage: "Read config_v2.json instead.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_read", toolResultSuccess: true, notes: "Successful alternative read" },
    { turnIndex: 6, userMessage: "What port is configured in the file?", assistantExpectedClass: "DIRECT_ANSWER", notes: "Extract port number" },
    { turnIndex: 7, userMessage: "Change the port to 9090.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_write", toolResultSuccess: true, notes: "Write updated config" },
    { turnIndex: 8, userMessage: "Read the file again to confirm port 9090 is saved.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_read", toolResultSuccess: true, notes: "Verify write" },
    { turnIndex: 9, userMessage: "Validate the JSON syntax of the modified file.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Syntax check" },
    { turnIndex: 10, userMessage: "Create a backup copy named config_v2.json.bak.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_copy", toolResultSuccess: true, notes: "Backup creation" },
    { turnIndex: 11, userMessage: "Confirm both files exist in workspace.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_exists", toolResultSuccess: true, notes: "Existence verification" },
    { turnIndex: 12, userMessage: "Report final configuration status.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Resolution summary" },
  ],
};

export const SCENARIO_H: ScenarioDefinition = {
  scenarioId: "SCENARIO_H",
  title: "Long Multi-Step Plan with Interruptions",
  turns: [
    { turnIndex: 1, userMessage: "Create a 5-step database migration plan.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Plan creation" },
    { turnIndex: 2, userMessage: "Step 1: Create snapshot backup.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Snapshot tool execution" },
    { turnIndex: 3, userMessage: "Confirm backup checksum.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Checksum validation" },
    { turnIndex: 4, userMessage: "Stop! Alert on monitoring: disk usage spike.", assistantExpectedClass: "CANCELLATION_CONFIRMATION", notes: "User interruption" },
    { turnIndex: 5, userMessage: "Check available disk space.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Diagnostic check" },
    { turnIndex: 6, userMessage: "Clean up dangling temporary log files.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Disk remediation" },
    { turnIndex: 7, userMessage: "Disk usage is normal now. Resume migration plan.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Resumes plan from Step 2" },
    { turnIndex: 8, userMessage: "Step 2: Run schema migration.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Schema tool execution" },
    { turnIndex: 9, userMessage: "Step 3: Run data transformation.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Data tool execution" },
    { turnIndex: 10, userMessage: "Step 4: Verify record count parity.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Verification parity check" },
    { turnIndex: 11, userMessage: "Step 5: Cutover application traffic.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Final cutover" },
    { turnIndex: 12, userMessage: "Provide final migration sign-off report.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Final migration report" },
  ],
};

export const SCENARIO_I: ScenarioDefinition = {
  scenarioId: "SCENARIO_I",
  title: "Cancellation and Rollback",
  turns: [
    { turnIndex: 1, userMessage: "Prepare to delete all cache directories in workspace.", assistantExpectedClass: "CONFIRMATION_REQUEST", notes: "Destructive action confirmation" },
    { turnIndex: 2, userMessage: "List candidate directories that would be affected.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Dry run preview" },
    { turnIndex: 3, userMessage: "Wait, cancel! Do not delete anything!", assistantExpectedClass: "CANCELLATION_CONFIRMATION", notes: "Cancellation acknowledged" },
    { turnIndex: 4, userMessage: "Confirm zero files were modified or deleted.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Integrity check" },
    { turnIndex: 5, userMessage: "Create a compressed archive of cache files instead.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Non-destructive alternative" },
    { turnIndex: 6, userMessage: "Verify the archive archive.tar.gz was created.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_exists", toolResultSuccess: true, notes: "Archive existence verified" },
    { turnIndex: 7, userMessage: "Calculate SHA256 of the archive.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Checksum validation" },
    { turnIndex: 8, userMessage: "Move archive to backups folder.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_move", toolResultSuccess: true, notes: "Safe relocation" },
    { turnIndex: 9, userMessage: "Check target folder content.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Relocation verified" },
    { turnIndex: 10, userMessage: "Now delete only the single file test.tmp.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_delete", toolResultSuccess: true, notes: "Single file deletion" },
    { turnIndex: 11, userMessage: "Confirm test.tmp is gone while others remain.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_exists", toolResultSuccess: true, notes: "Targeted deletion verified" },
    { turnIndex: 12, userMessage: "Report final state of workspace.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Final audit report" },
  ],
};

export const SCENARIO_J: ScenarioDefinition = {
  scenarioId: "SCENARIO_J",
  title: "Specialist Delegation and Re-Integration",
  turns: [
    { turnIndex: 1, userMessage: "Conduct a security audit of our JWT token validation logic.", assistantExpectedClass: "DELEGATION_HANDOFF", toolExecuted: "start_thread", notes: "Delegation to security specialist" },
    { turnIndex: 2, userMessage: "Specialist checks token expiration handling.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Specialist step 1" },
    { turnIndex: 3, userMessage: "Specialist checks signature algorithm restriction.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Specialist step 2" },
    { turnIndex: 4, userMessage: "Specialist checks timing attack vulnerability on secret comparison.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Specialist step 3" },
    { turnIndex: 5, userMessage: "Vulnerability detected: string comparison === is vulnerable to timing attacks.", assistantExpectedClass: "ERROR_REPORT", notes: "Finding identified" },
    { turnIndex: 6, userMessage: "Specialist proposes remediation using crypto.timingSafeEqual.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Remediation proposed" },
    { turnIndex: 7, userMessage: "Specialist completes thread and hands off findings to primary bot.", assistantExpectedClass: "DELEGATION_HANDOFF", notes: "Handoff to primary" },
    { turnIndex: 8, userMessage: "Primary bot receives external update with peer provenance.", assistantExpectedClass: "DIRECT_ANSWER", notes: "Peer provenance update" },
    { turnIndex: 9, userMessage: "Synthesize the specialist report for the user.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Primary synthesis" },
    { turnIndex: 10, userMessage: "Apply the timingSafeEqual patch to auth.ts.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "workspace_write", toolResultSuccess: true, notes: "Patch application" },
    { turnIndex: 11, userMessage: "Run test suite to verify the security patch.", assistantExpectedClass: "TOOL_INVOCATION", toolExecuted: "run_command", toolResultSuccess: true, notes: "Regression verification" },
    { turnIndex: 12, userMessage: "Confirm zero regressions and successful security fix.", assistantExpectedClass: "STRUCTURED_OUTPUT", notes: "Final verification" },
  ],
};

export const ALL_SCENARIOS = [
  SCENARIO_A,
  SCENARIO_B,
  SCENARIO_C,
  SCENARIO_D,
  SCENARIO_E,
  SCENARIO_F,
  SCENARIO_G,
  SCENARIO_H,
  SCENARIO_I,
  SCENARIO_J,
];

describe("multiturn-scenarios", () => {
  const defaultLocation: UserLocation = {
    city: "Denver",
    region: "Colorado",
    country: "United States",
    countryCode: "US",
    provenance: "SAVED_USER",
    enabled: true,
  };

  it("verifies 10 comprehensive multi-turn scenarios defined with 12 turns each", () => {
    expect(ALL_SCENARIOS).toHaveLength(10);
    const totalTurns = ALL_SCENARIOS.reduce((sum, s) => sum + s.turns.length, 0);
    expect(totalTurns).toBe(120);
    for (const scenario of ALL_SCENARIOS) {
      expect(scenario.turns).toHaveLength(12);
    }
  });

  it("verifies zero emojis anywhere across all multi-turn scenarios", () => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const scenario of ALL_SCENARIOS) {
      expect(emojiRegex.test(scenario.title)).toBe(false);
      for (const turn of scenario.turns) {
        expect(emojiRegex.test(turn.userMessage)).toBe(false);
        expect(emojiRegex.test(turn.notes)).toBe(false);
      }
    }
  });

  it("executes Scenario D location switching and continuity across turns", () => {
    let currentCity: string | undefined = undefined;

    for (const turn of SCENARIO_D.turns) {
      const resolved = resolveLocationIntent(turn.userMessage, defaultLocation, currentCity);
      if (turn.expectedLocationScope) {
        expect(resolved.scope).toBe(turn.expectedLocationScope);
      }
      if (turn.expectedCity) {
        expect(resolved.effectiveLocation?.city).toBe(turn.expectedCity);
      }
      if (resolved.scope === "explicit_override" && resolved.effectiveLocation?.city) {
        currentCity = resolved.effectiveLocation.city;
      } else if (resolved.scope === "default") {
        currentCity = undefined;
      }
    }
  });

  it("executes Scenario J peer provenance and turn context replay", () => {
    const input: TurnContextInput = {
      text: "Synthesize the specialist report for the user.",
      transcript: [
        { role: "user", text: "Conduct security audit." },
        { role: "assistant", text: "Delegated to specialist." },
        { role: "assistant", text: "@Specialist replied: found timing attack vulnerability." },
      ],
      rewound: false,
      fresh: false,
      externallyUpdated: true,
      replaysNatively: false,
    };

    const turnContext = buildTurnContext(input);
    expect(turnContext.resume).toBe(false);
    expect(turnContext.turnText).toContain("received an update outside your provider session");
    expect(turnContext.turnText).toContain("@Specialist replied");
    expect(turnContext.turnText).toContain("Synthesize the specialist report for the user.");
  });

  it("verifies action claim discipline across tool execution turns", () => {
    for (const scenario of ALL_SCENARIOS) {
      for (const turn of scenario.turns) {
        if (turn.toolExecuted && turn.toolResultSuccess === false) {
          // If a tool failed, response class must be TOOL_INVOCATION or ERROR_REPORT, never completion
          expect(["TOOL_INVOCATION", "ERROR_REPORT"]).toContain(turn.assistantExpectedClass);
        }
      }
    }
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationalAppBuilder, type StructuredDiscoveryQuestion } from "./conversational-builder.ts";
import { ProjectManager } from "./project-manager.ts";
import { AutonomousRepairLoop } from "./repair-loop.ts";
import {
  inferDiscoveryChoices,
  normalizeAskUserInput,
  questionType,
  allowsOther,
} from "../../shared/ask-question.ts";

describe("ConversationalAppBuilder (Phase I App Builder UX)", () => {
  let tempDir: string;
  let mgr: ProjectManager;
  let repairLoop: AutonomousRepairLoop;
  let builder: ConversationalAppBuilder;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "moblot-convo-test-"));
    mgr = new ProjectManager(tempDir);
    repairLoop = new AutonomousRepairLoop(mgr);
    builder = new ConversationalAppBuilder(mgr, repairLoop);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("plans an application and generates targeted ask_user decisions", () => {
    const plan = builder.planApplication("Build me a personal portfolio site");
    expect(plan.framework).toBe("html");
    expect(plan.projectName).toContain("Personal Portfolio");
    expect(plan.requiredDecisions.length).toBeGreaterThanOrEqual(2);

    const styleDecision = plan.requiredDecisions.find((d) => d.key === "style");
    expect(styleDecision).toBeDefined();
    expect(styleDecision?.type).toBe("single_choice");
    expect(styleDecision?.choices.length).toBeGreaterThan(1);

    const sectionsDecision = plan.requiredDecisions.find((d) => d.key === "sections");
    expect(sectionsDecision).toBeDefined();
    expect(sectionsDecision?.type).toBe("multiple_choice");
  });

  it("builds the project, runs tests, starts preview, and provides concise turn action summary", async () => {
    const plan = builder.planApplication("Build me a dashboard app");
    const summary = await builder.buildAndPreview(plan, {
      style: "Modern Clean",
    });

    expect(summary.status).toBe("preview_ready");
    expect(summary.previewUrl).toBeDefined();
    expect(summary.message).toContain("ready and running locally");
    expect(summary.actions).toContain("Preview");
    expect(summary.actions).toContain("Deploy");
    expect(summary.structured).toBeDefined();
    expect(summary.structured?.components.length).toBe(3);
    expect(summary.structured?.components[0].type).toBe("card");
    expect(summary.structured?.components[1].type).toBe("dashboard");
    expect(summary.structured?.components[2].type).toBe("diagram");
  });

  it("applies conversational revisions ('make the hero less boring') and refreshes preview", async () => {
    const plan = builder.planApplication("Build me a landing site");
    await builder.buildAndPreview(plan);

    const revisionSummary = await builder.applyRevision(
      plan.projectId,
      "Make the hero less boring with vibrant accents"
    );

    expect(revisionSummary.status).toBe("preview_ready");
    expect(revisionSummary.previewUrl).toBeDefined();
    expect(revisionSummary.message).toContain("feedback");

    // Verify style.css was updated with new accent
    const css = mgr.readFile(plan.projectId, "style.css").content;
    expect(css).toContain("--accent: #ec4899;");
  });

  it("plans a job application tracker with essential auth, storage, and stage decisions", () => {
    const plan = builder.planApplication("Build me a job application tracker");
    expect(plan.framework).toBe("fullstack");
    expect(plan.projectName).toContain("Job Application Tracker");

    const authDecision = plan.requiredDecisions.find((d) => d.key === "auth");
    expect(authDecision).toBeDefined();
    expect(authDecision?.choices).toContain(
      "Private Single-User (zero login friction, stored securely on this phone)"
    );

    const storageDecision = plan.requiredDecisions.find((d) => d.key === "storage");
    expect(storageDecision).toBeDefined();
    expect(storageDecision?.choices.some((c) => c.includes("SQLite"))).toBe(true);
  });

  it("applies functional revisions (adding search bar and compensation) with git tracking", async () => {
    const plan = builder.planApplication("Build me a job application tracker");
    await builder.buildAndPreview(plan);

    // Apply search filter revision
    await builder.applyRevision(plan.projectId, "Add a search bar to filter applicants");
    let html = mgr.readFile(plan.projectId, "index.html").content;
    expect(html).toContain('id="search-input"');

    // Apply compensation field revision
    await builder.applyRevision(plan.projectId, "Add a salary compensation field");
    html = mgr.readFile(plan.projectId, "index.html").content;
    expect(html).toContain('id="salary-input"');

    // Verify git history recorded the revisions
    const gitStatus = mgr.gitStatus(plan.projectId);
    expect(gitStatus.initialized).toBe(true);
    expect(gitStatus.lastCommitMessage).toContain("salary compensation");
  });

  describe("Adaptive Requirements Discovery", () => {
    it("distinguishes explicit/minimal tasks from underspecified/vague requests", () => {
      // 1. Explicit/minimal task
      const minimalCheck = builder.assessRequirementSpecificity("Create a simple HTML file and run it");
      expect(minimalCheck.isMinimal).toBe(true);
      expect(minimalCheck.isUnderspecified).toBe(false);
      expect(minimalCheck.detectedArchitecture).toBe("html");

      const minimalPlan = builder.planApplication("Create a simple HTML file and run it");
      expect(minimalPlan.needsAdaptiveDiscovery).toBe(false);
      expect(minimalPlan.framework).toBe("html");

      // 2. Underspecified request where 'full-stack' describes architecture, not product function
      const vagueCheck = builder.assessRequirementSpecificity("I want a full-stack website");
      expect(vagueCheck.isMinimal).toBe(false);
      expect(vagueCheck.isUnderspecified).toBe(true);
      expect(vagueCheck.reason).toContain("architecture, not a product function");

      const vaguePlan = builder.planApplication("I want a full-stack website");
      expect(vaguePlan.needsAdaptiveDiscovery).toBe(true);
      expect(vaguePlan.discoverySession).toBeDefined();
    });

    it("runs adaptive multi-stage interview, clarifies superficial answers, and requires confirmation before building", async () => {
      const session = builder.startDiscoverySession("I want a full-stack website");
      expect(session.currentStage).toBe("purpose_and_users");
      expect(session.status).toBe("interviewing");

      // Attempt 1: Superficial / non-substantive response
      // Attempt 1: Superficial / non-substantive response
      const superficialStep = builder.advanceDiscovery(session, "shoes");
      expect(superficialStep.needsClarification).toBe(true);
      expect(superficialStep.session.status).toBe("clarifying");
      expect(superficialStep.session.currentStage).toBe("purpose_and_users"); // Did NOT skip ahead!
      expect(superficialStep.structuredQuestion).toBeDefined();
      expect(superficialStep.structuredQuestion?.type).toBe("single_choice");
      expect(superficialStep.structuredQuestion?.choices.length).toBeGreaterThanOrEqual(4);
      expect(superficialStep.structuredQuestion?.allowOther).toBe(true);
      expect(superficialStep.message).toContain("shoe");

      // Stage 1: Purpose & Users (substantive answer)
      const stage1 = builder.advanceDiscovery(
        session,
        "An artisan shoe boutique platform where craft shoemakers can showcase custom footwear and clients can request bespoke sizing"
      );
      expect(stage1.needsClarification).toBe(false);
      expect(stage1.session.currentStage).toBe("workflows_and_screens");
      expect(stage1.structuredQuestion).toBeDefined();
      expect(stage1.structuredQuestion?.type).toBe("multiple_choice");
      expect(stage1.nextQuestion).toContain("capabilities");

      // Stage 2: Workflows & Screens
      const stage2 = builder.advanceDiscovery(
        session,
        "Bespoke catalog browser, Custom sizing configuration form, Shoemaker inquiry dashboard, Order tracking timeline"
      );
      expect(stage2.needsClarification).toBe(false);
      expect(stage2.session.currentStage).toBe("data_and_persistence");
      expect(stage2.structuredQuestion).toBeDefined();
      expect(stage2.structuredQuestion?.type).toBe("single_choice");
      expect(stage2.nextQuestion).toContain("persisted");

      // Stage 3: Data & Persistence
      const stage3 = builder.advanceDiscovery(
        session,
        "Footwear models, sizing measurement specs, inquiry requests, order status stored in local SQLite database"
      );
      expect(stage3.needsClarification).toBe(false);
      expect(stage3.session.currentStage).toBe("backend_and_api");
      expect(stage3.structuredQuestion).toBeDefined();
      expect(stage3.structuredQuestion?.type).toBe("single_choice");
      expect(stage3.nextQuestion).toContain("backend");

      // Stage 4: Backend API & Business Logic
      const stage4 = builder.advanceDiscovery(
        session,
        "REST API endpoints for /api/shoes, /api/inquiries, validation rules for custom measurements, SQLite migrations"
      );
      expect(stage4.needsClarification).toBe(false);
      expect(stage4.session.currentStage).toBe("visual_vibe_and_style");
      expect(stage4.structuredQuestion).toBeDefined();
      expect(stage4.structuredQuestion?.type).toBe("single_choice");
      expect(stage4.nextQuestion).toContain("visual style");

      // Stage 5: Visual Vibe & Style
      const stage5 = builder.advanceDiscovery(
        session,
        "Warm Editorial aesthetic with serif typography, rich leather accents, dark card surfaces, and crisp borders"
      );
      expect(stage5.needsClarification).toBe(false);
      // All stages completed: should now await confirmation with implementation summary
      expect(stage5.session.status).toBe("awaiting_confirmation");
      expect(stage5.summary).toBeDefined();
      expect(stage5.summary?.architecture).toBe("fullstack");
      expect(stage5.summary?.confirmationPrompt).toContain("Implementation Summary");
      expect(stage5.summary?.confirmationPrompt).toContain("confirm to proceed");

      // Attempt build prior to confirmation: should require confirmation
      const unconfirmedStep = builder.advanceDiscovery(session, "what else?");
      expect(unconfirmedStep.needsClarification).toBe(true);
      expect(unconfirmedStep.session.status).toBe("awaiting_confirmation");

      // User confirms
      const confirmedStep = builder.advanceDiscovery(session, "Yes, build it now!");
      expect(confirmedStep.needsClarification).toBe(false);
      expect(confirmedStep.session.status).toBe("confirmed");

      // Produce executable plan and build project
      const finalPlan = builder.confirmAndGeneratePlan(session);
      expect(finalPlan.framework).toBe("fullstack");
      expect(finalPlan.style).toContain("Warm Editorial");

      const buildSummary = await builder.buildAndPreview(finalPlan);
      expect(buildSummary.status).toBe("preview_ready");
      expect(buildSummary.previewUrl).toBeDefined();
      expect(buildSummary.message).toContain("ready and running locally");
    });
  });

  describe("99.99% Multiple Choice Requirements Discovery Rule", () => {
    it("renders all 11 standard requirement questions as structured multiple-choice with 4-8 options and allowOther", () => {
      const standardQuestions = ConversationalAppBuilder.getAllStandardQuestions();
      const requiredDomains = [
        "website_type",
        "website_purpose",
        "target_audience",
        "visual_style",
        "pages_and_features",
        "authentication",
        "database",
        "backend_requirements",
        "deployment_preference",
        "responsive_behavior",
        "fullstack_capabilities",
      ] as const;

      for (const domain of requiredDomains) {
        const q = standardQuestions[domain];
        expect(q, `Domain ${domain} question must be defined`).toBeDefined();
        expect(
          q.type === "single_choice" || q.type === "multiple_choice",
          `Domain ${domain} must be single_choice or multiple_choice, but was ${q.type}`
        ).toBe(true);
        expect(q.choices.length, `Domain ${domain} must have 4-8 choices`).toBeGreaterThanOrEqual(4);
        expect(q.choices.length, `Domain ${domain} must have 4-8 choices`).toBeLessThanOrEqual(8);
        expect(q.allowOther, `Domain ${domain} must allow Other`).toBe(true);
        expect(q.question.length, `Domain ${domain} must have question text`).toBeGreaterThan(10);

        for (const choice of q.choices) {
          expect(choice.id, `Choice in ${domain} must have id`).toBeTruthy();
          expect(choice.label, `Choice in ${domain} must have label`).toBeTruthy();
        }
      }
    });

    it("verifies 99.99% multiple choice compliance with verifyNinetyNinePercentMultipleChoice helper", () => {
      const allQuestions = Object.values(ConversationalAppBuilder.getAllStandardQuestions());
      const audit = ConversationalAppBuilder.verifyNinetyNinePercentMultipleChoice(allQuestions);
      expect(audit.compliant).toBe(true);
      expect(audit.ratio).toBe(1.0); // 100% compliant >= 99.99%
      expect(audit.freeTextCount).toBe(0);
      expect(audit.violations).toHaveLength(0);
    });

    it("fails compliance check if any requirement question is implemented as generic free_text", () => {
      const allQuestions = Object.values(ConversationalAppBuilder.getAllStandardQuestions());
      const pollutedQuestions: StructuredDiscoveryQuestion[] = [
        ...allQuestions,
        {
          id: "bad_free_text",
          stage: "purpose_and_users",
          category: "website_purpose",
          question: "What do you want the website to accomplish?",
          type: "free_text",
          choices: [],
        },
      ];

      const audit = ConversationalAppBuilder.verifyNinetyNinePercentMultipleChoice(pollutedQuestions);
      expect(audit.compliant).toBe(false);
      expect(audit.freeTextCount).toBe(1);
      expect(audit.violations.length).toBeGreaterThan(0);
      expect(audit.violations[0]).toContain("free_text or lacks choices");
    });

    it("fails compliance check if any requirement question has fewer than 2 choices", () => {
      const singleChoiceQ: StructuredDiscoveryQuestion = {
        id: "insufficient_choices",
        stage: "workflows_and_screens",
        category: "pages_and_features",
        question: "What features do you want?",
        type: "single_choice",
        choices: [{ id: "only_one", label: "Only one choice" }],
      };

      const audit = ConversationalAppBuilder.verifyNinetyNinePercentMultipleChoice([singleChoiceQ]);
      expect(audit.compliant).toBe(false);
      expect(audit.violations[0]).toContain("lacks choices");
    });

    it("auto-enriches ask_user calls missing choices across all 11 domains to prevent free-text prompts", () => {
      const sampleQueries = [
        { text: "What kind of website are you building?", expectedType: "single_choice" },
        { text: "What is the main goal of this website?", expectedType: "single_choice" },
        { text: "Who is the target audience for this project?", expectedType: "single_choice" },
        { text: "What visual style should it have?", expectedType: "single_choice" },
        { text: "What should users be able to do on the site?", expectedType: "multiple_choice" },
        { text: "What type of authentication do you need?", expectedType: "single_choice" },
        { text: "Which database or persistence layer should we use?", expectedType: "single_choice" },
        { text: "Which backend architecture do you want?", expectedType: "single_choice" },
        { text: "Where would you like to deploy?", expectedType: "single_choice" },
        { text: "What responsive layout and navigation style?", expectedType: "single_choice" },
        { text: "Which full-stack capabilities does the application need?", expectedType: "multiple_choice" },
      ];

      for (const sample of sampleQueries) {
        const enriched = inferDiscoveryChoices(sample.text);
        expect(enriched, `Failed to infer choices for query: "${sample.text}"`).not.toBeNull();
        expect(enriched?.options.length).toBeGreaterThanOrEqual(3);
        expect(enriched?.type).toBe(sample.expectedType);

        // Verify normalization turns it into a valid AskQuestion with selectable options
        const normalized = normalizeAskUserInput({ question: sample.text });
        expect(normalized).not.toBeNull();
        expect(normalized![0].options.length).toBeGreaterThanOrEqual(3);
        expect(questionType(normalized![0])).toBe(sample.expectedType);
        expect(allowsOther(normalized![0])).toBe(true);
      }
    });

    it("ensures multi-select requirements enforce multiple choices with sensible bounds", () => {
      const fullstackQ = ConversationalAppBuilder.getFullstackCapabilitiesQuestion();
      expect(fullstackQ.type).toBe("multiple_choice");
      expect(fullstackQ.minSelections).toBe(1);
      expect(fullstackQ.maxSelections).toBe(8);
      expect(fullstackQ.choices.length).toBe(8);

      const pagesQ = ConversationalAppBuilder.getPagesAndFeaturesQuestion();
      expect(pagesQ.type).toBe("multiple_choice");
      expect(pagesQ.minSelections).toBe(1);
      expect(pagesQ.maxSelections).toBe(8);
      expect(pagesQ.choices.length).toBe(8);
    });

    it("ensures mutually exclusive decisions are single-choice", () => {
      const typeQ = ConversationalAppBuilder.getWebsiteTypeQuestion();
      expect(typeQ.type).toBe("single_choice");

      const authQ = ConversationalAppBuilder.getAuthenticationQuestion();
      expect(authQ.type).toBe("single_choice");

      const dbQ = ConversationalAppBuilder.getDatabaseQuestion();
      expect(dbQ.type).toBe("single_choice");

      const deployQ = ConversationalAppBuilder.getDeploymentPreferenceQuestion();
      expect(deployQ.type).toBe("single_choice");

      const styleQ = ConversationalAppBuilder.getVisualStyleQuestion();
      expect(styleQ.type).toBe("single_choice");
    });
  });
});

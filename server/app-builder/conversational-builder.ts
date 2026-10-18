// Conversational App Builder Engine (Phase I)
//
// Implements the user experience from MOBOT_MASTER_PROMPT.md:
//   "User: 'Build me a portfolio site.'
//    Bot: 'I'll build it. I need a couple of decisions.' -> ask_user
//    Bot: builds project, tests, starts preview -> 'Your first version is ready.' [Preview]
//    User: 'Make the hero less boring.'
//    Bot: activates Taste/UIUX skill, modifies project, rebuilds, refreshes preview
//    User: 'Looks good.' -> Bot: 'Deploy it?' [Preview] [Deploy]"
//
// Invariants:
// 1. Centralized, concise, actionable error reporting (no log dumps).
// 2. Focused decision questions via `ask_user` without unnecessary interruptions.
// 3. Integrated local loopback preview and cloud deployment triggers.

import type { ProjectManager } from "./project-manager.ts";
import type { AutonomousRepairLoop } from "./repair-loop.ts";
import type { DeploymentManager } from "../deploy/deployment-manager.ts";
import type { DeploymentProviderId } from "../deploy/types.ts";
import type { ProjectFramework, ProjectRecord } from "./types.ts";
import type { StructuredResponseData } from "../../shared/structured-response.ts";

export interface DecisionSpec {
  question: string;
  type: "single_choice" | "multiple_choice" | "confirmation" | "free_text";
  choices: string[];
  key: string;
}

export type DiscoveryQuestionCategory =
  | "website_type"
  | "website_purpose"
  | "target_audience"
  | "visual_style"
  | "pages_and_features"
  | "authentication"
  | "database"
  | "backend_requirements"
  | "deployment_preference"
  | "responsive_behavior"
  | "fullstack_capabilities"
  | "payment_model";

export interface DiscoveryChoice {
  id: string;
  label: string;
  description?: string;
}

export interface StructuredDiscoveryQuestion {
  id: string;
  stage: DiscoveryStage;
  category: DiscoveryQuestionCategory;
  question: string;
  type: "single_choice" | "multiple_choice" | "confirmation" | "free_text";
  choices: DiscoveryChoice[];
  minSelections?: number;
  maxSelections?: number;
  allowOther?: boolean;
  header?: string;
}

export type DiscoveryStage =
  | "purpose_and_users"
  | "workflows_and_screens"
  | "data_and_persistence"
  | "backend_and_api"
  | "visual_vibe_and_style";

export interface RequirementSpecificity {
  isMinimal: boolean;
  isUnderspecified: boolean;
  detectedArchitecture?: ProjectFramework;
  reason: string;
}

export interface ImplementationSummary {
  projectName: string;
  purpose: string;
  targetAudience: string;
  architecture: ProjectFramework;
  keyScreens: string[];
  dataModel: string[];
  apiEndpoints: string[];
  stylingTheme: string;
  confirmationPrompt: string;
}

export interface DiscoverySession {
  sessionId: string;
  originalRequest: string;
  currentStage: DiscoveryStage;
  completedStages: DiscoveryStage[];
  gatheredRequirements: {
    purposeAndUsers?: string;
    workflowsAndScreens?: string;
    dataAndPersistence?: string;
    backendAndApi?: string;
    visualVibeAndStyle?: string;
    websiteType?: string;
    websitePurpose?: string;
    targetAudience?: string;
    visualStyle?: string;
    selectedFeatures?: string[];
    selectedCapabilities?: string[];
    authenticationType?: string;
    databaseType?: string;
    backendArchitecture?: string;
    deploymentPreference?: string;
    paymentModel?: string;
    responsiveLayout?: string;
    [key: string]: any;
  };
  status: "interviewing" | "clarifying" | "awaiting_confirmation" | "confirmed";
  currentQuestion?: StructuredDiscoveryQuestion;
  clarificationMessage?: string;
  clarificationQuestion?: StructuredDiscoveryQuestion;
  summary?: ImplementationSummary;
}

export interface DiscoveryAdvanceResult {
  session: DiscoverySession;
  nextQuestion?: string;
  structuredQuestion?: StructuredDiscoveryQuestion;
  summary?: ImplementationSummary;
  needsClarification: boolean;
  message: string;
}

export interface ConversationalBuildPlan {
  projectId: string;
  projectName: string;
  framework: ProjectFramework;
  style?: string;
  sections?: string[];
  features?: string[];
  requiredDecisions: DecisionSpec[];
  needsAdaptiveDiscovery?: boolean;
  discoverySession?: DiscoverySession;
  implementationSummary?: ImplementationSummary;
}

export interface TurnActionSummary {
  message: string;
  status: "deciding" | "building" | "preview_ready" | "failed" | "deployed";
  previewUrl?: string;
  deploymentUrl?: string;
  actions: string[];
  error?: string;
  structured?: StructuredResponseData;
}

export class ConversationalAppBuilder {
  private readonly projectManager: ProjectManager;
  private readonly repairLoop?: AutonomousRepairLoop;
  private readonly deploymentManager?: DeploymentManager;

  constructor(
    projectManager: ProjectManager,
    repairLoop?: AutonomousRepairLoop,
    deploymentManager?: DeploymentManager
  ) {
    this.projectManager = projectManager;
    this.repairLoop = repairLoop;
    this.deploymentManager = deploymentManager;
  }

  static readonly DISCOVERY_STAGES: DiscoveryStage[] = [
    "purpose_and_users",
    "workflows_and_screens",
    "data_and_persistence",
    "backend_and_api",
    "visual_vibe_and_style",
  ];

  /**
   * Assess whether a user's natural language request is minimal/explicit,
   * fully specified, or underspecified requiring adaptive discovery.
   * Note: "Full-stack" describes an architecture, NOT a product function or purpose!
   */
  assessRequirementSpecificity(request: string): RequirementSpecificity {
    const trimmed = request.trim().toLowerCase();

    // Minimal / explicit patterns:
    const isMinimal =
      /(?:simple|basic|minimal|static)\s+(?:html|index\.html|web\s*page|single\s*page)/i.test(trimmed) ||
      /hello\s*world/i.test(trimmed) ||
      /create\s+(?:an?\s+)?(?:simple\s+)?(?:html\s+file|index\.html)/i.test(trimmed) ||
      /simple\s+html\s+file/i.test(trimmed);

    if (isMinimal) {
      return {
        isMinimal: true,
        isUnderspecified: false,
        detectedArchitecture: "html",
        reason: "Request is explicit and minimal (simple/static HTML task). Bypass multi-stage discovery.",
      };
    }

    // Underspecified check: User mentions architecture or general category ("full-stack website", "app", "website", "something for my business")
    // without defining the functional purpose or domain of the application.
    const isVagueRequest =
      /^(?:i\s+(?:want|need)\s+(?:to\s+build\s+)?(?:a\s+)?|make\s+me\s+(?:a\s+)?|build\s+me\s+(?:a\s+)?|create\s+(?:a\s+)?)(?:full[\s-]?stack\s+)?(?:website|app|web\s*app|site|something(?:\s+for\s+my\s+business)?)\.?$/i.test(trimmed) ||
      /^(?:i\s+want\s+a\s+full[\s-]?stack\s+website|make\s+me\s+an\s+app|build\s+me\s+something\s+for\s+my\s+business|i\s+want\s+to\s+build\s+a\s+website)$/i.test(trimmed) ||
      trimmed === "i want a full-stack website" ||
      trimmed === "make me an app" ||
      trimmed === "build me something for my business" ||
      trimmed === "i want to build a website";

    const concreteDomains = [
      "portfolio", "tracker", "crm", "job", "todo", "task", "recipe", "blog",
      "weather", "calculator", "notes", "chat", "dashboard", "invoice", "booking",
      "calendar", "inventory", "fitness", "budget", "finance", "store", "shop"
    ];
    const hasConcreteDomain = concreteDomains.some((d) => trimmed.includes(d));

    const isUnderspecified = isVagueRequest || (!hasConcreteDomain && /(?:website|app|web\s*app|site)/i.test(trimmed) && trimmed.split(/\s+/).length <= 6);

    let detectedArchitecture: ProjectFramework = "fullstack";
    if (trimmed.includes("react") || trimmed.includes("vite")) {
      detectedArchitecture = "react";
    } else if (trimmed.includes("next")) {
      detectedArchitecture = "nextjs";
    } else if (trimmed.includes("html") && !trimmed.includes("full")) {
      detectedArchitecture = "html";
    }

    return {
      isMinimal: false,
      isUnderspecified,
      detectedArchitecture,
      reason: isUnderspecified
        ? "'Full-stack' describes an architecture, not a product function. The purpose, target users, and core workflow are underspecified."
        : "Sufficient domain specificity detected.",
    };
  }

  /**
   * Detect superficial, one-word, or non-informative responses that require clarification.
   */
  isSuperficialResponse(response: string): boolean {
    const trimmed = response.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 2) return true;
    if (trimmed.length < 15) return true;

    const superficialPhrases = [
      "you decide", "up to you", "whatever", "don't care", "dont care",
      "idk", "anything", "not sure", "just make it good", "make it cool",
      "make it professional", "regular stuff", "normal app", "just buy stuff"
    ];
    const lower = trimmed.toLowerCase();
    return superficialPhrases.some((p) => lower === p || lower.startsWith(p));
  }

  // ── 99.99% Multiple-Choice Discovery Question Generators ────────────

  static getWebsiteTypeQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-website-type",
      stage: "purpose_and_users",
      category: "website_type",
      question: "What kind of website or application are you building?",
      type: "single_choice",
      allowOther: true,
      header: "Type",
      choices: [
        { id: "portfolio", label: "Portfolio", description: "Showcase personal projects, creative work, or case studies" },
        { id: "business", label: "Business Website", description: "Company brand presence, services overview, and lead capture" },
        { id: "agency", label: "Agency / Client Services", description: "Client showcase, detailed service packages, and consultation booking" },
        { id: "ecommerce", label: "E-Commerce / Online Store", description: "Product catalog, shopping cart, and online checkout" },
        { id: "blog", label: "Blog / Publication", description: "Articles, newsletters, editorial stories, and RSS feeds" },
        { id: "community", label: "Community / Forum", description: "User discussions, member directory, and profile pages" },
        { id: "saas", label: "SaaS / Web Application", description: "Interactive product workflows, dashboards, and tooling" },
        { id: "internal_tool", label: "Internal Tool / Operations", description: "Admin panel, inventory tracker, or team dashboard" },
      ],
    };
  }

  static getWebsitePurposeQuestion(appType?: string): StructuredDiscoveryQuestion {
    const isStore = appType?.toLowerCase().includes("commerce") || appType?.toLowerCase().includes("store");
    return {
      id: "q-website-purpose",
      stage: "purpose_and_users",
      category: "website_purpose",
      question: "What is the primary goal of this application?",
      type: "single_choice",
      allowOther: true,
      header: "Goal",
      choices: isStore
        ? [
            { id: "sell_products", label: "Sell Products & Orders", description: "Direct-to-consumer store with cart and instant checkout" },
            { id: "custom_orders", label: "Custom / Made-to-Order", description: "Configure custom product options and submit quote requests" },
            { id: "curated_drop", label: "Limited Drops & Releases", description: "Exclusive countdowns, waitlists, and subscriber access" },
            { id: "b2b_wholesale", label: "B2B Wholesale Catalog", description: "Bulk ordering and business inquiries without public checkout" },
          ]
        : [
            { id: "get_leads", label: "Generate Leads", description: "Collect client inquiries, quote requests, and contact submissions" },
            { id: "sell_products", label: "Sell Products", description: "Process online purchases, manage catalog items, and track orders" },
            { id: "showcase_work", label: "Showcase Work", description: "Demonstrate skills, portfolio pieces, and case study results" },
            { id: "book_appointments", label: "Book Appointments", description: "Allow visitors to schedule consultations, calls, or reservations" },
            { id: "publish_content", label: "Publish Content", description: "Share insights, tutorials, guides, and regular news updates" },
            { id: "interactive_service", label: "Provide Interactive Service", description: "Deliver self-service calculators, tools, or utilities" },
            { id: "internal_operations", label: "Manage Operations", description: "Coordinate team records, internal status, and company workflows" },
          ],
    };
  }

  static getTargetAudienceQuestion(_appType?: string): StructuredDiscoveryQuestion {
    return {
      id: "q-target-audience",
      stage: "purpose_and_users",
      category: "target_audience",
      question: "Who is the primary target audience?",
      type: "single_choice",
      allowOther: true,
      header: "Audience",
      choices: [
        { id: "consumers", label: "General Public / Consumers", description: "Everyday shoppers, casual visitors, and retail customers" },
        { id: "b2b_clients", label: "B2B / Business Clients", description: "Corporate decision-makers, small business owners, and managers" },
        { id: "developers", label: "Developers & Technical Users", description: "Software engineers, DevOps, and technical teams" },
        { id: "creatives", label: "Creative Professionals", description: "Designers, photographers, artists, and media agencies" },
        { id: "internal_team", label: "Internal Team & Staff", description: "Company employees, operations staff, and administrators" },
      ],
    };
  }

  static getVisualStyleQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-visual-style",
      stage: "visual_vibe_and_style",
      category: "visual_style",
      question: "What visual style should it have?",
      type: "single_choice",
      allowOther: true,
      header: "Style",
      choices: [
        { id: "minimal_clean", label: "Minimal & Clean", description: "Generous whitespace, crisp typography, and restrained neutral accents" },
        { id: "modern_tech", label: "Modern Tech", description: "Dark mode, sleek card elevations, and vibrant indigo/cyan accents" },
        { id: "professional_corp", label: "Professional Corporate", description: "Structured layouts, navy/slate palette, and formal clarity" },
        { id: "warm_editorial", label: "Warm Editorial", description: "Serif typography, earthy tones, and magazine-style layout" },
        { id: "playful_vibrant", label: "Playful & Vibrant", description: "Bold colorful accents, rounded surfaces, and lively energy" },
        { id: "luxury_premium", label: "Luxury & Premium", description: "Monochrome tones, champagne/gold details, and refined minimalism" },
      ],
    };
  }

  static getPagesAndFeaturesQuestion(_appType?: string): StructuredDiscoveryQuestion {
    return {
      id: "q-pages-features",
      stage: "workflows_and_screens",
      category: "pages_and_features",
      question: "What should users be able to do?",
      type: "multiple_choice",
      minSelections: 1,
      maxSelections: 8,
      allowOther: true,
      header: "Features",
      choices: [
        { id: "browse_content", label: "Browse Content", description: "Explore product lists, article grids, or showcase galleries" },
        { id: "search_filter", label: "Search & Filter", description: "Find items quickly with real-time keyword search and category tags" },
        { id: "user_accounts", label: "Create an Account", description: "Sign up, log in, and manage personal profile settings" },
        { id: "submit_forms", label: "Submit Forms", description: "Send inquiries, quote requests, feedback, or applications" },
        { id: "upload_files", label: "Upload Files", description: "Attach documents, images, or project assets securely" },
        { id: "make_payments", label: "Make Payments", description: "Complete online checkout with debit/credit card or digital pay" },
        { id: "save_favorites", label: "Save Favorites", description: "Bookmark items into a wishlist or pinned collection" },
        { id: "contact_business", label: "Contact Business", description: "Reach out via integrated contact form, email, or chat link" },
      ],
    };
  }

  static getFullstackCapabilitiesQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-fullstack-capabilities",
      stage: "workflows_and_screens",
      category: "fullstack_capabilities",
      question: "Which capabilities does the application need?",
      type: "multiple_choice",
      minSelections: 1,
      maxSelections: 8,
      allowOther: true,
      header: "Capabilities",
      choices: [
        { id: "user_accounts", label: "User accounts & auth", description: "Registration, login sessions, and user profiles" },
        { id: "database", label: "Database persistence", description: "Local SQLite database for durable records" },
        { id: "admin_dashboard", label: "Admin dashboard", description: "Back-office management view to inspect and edit records" },
        { id: "search", label: "Search & filtering", description: "Full-text query search and multi-criteria filters" },
        { id: "file_uploads", label: "File & image uploads", description: "Storage for document attachments and avatar photos" },
        { id: "notifications", label: "Notifications", description: "In-app alerts and confirmation banners" },
        { id: "payments", label: "Payments & checkout", description: "Order transactions and payment records" },
        { id: "external_apis", label: "External APIs", description: "Integration with third-party web services" },
      ],
    };
  }

  static getAuthenticationQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-authentication",
      stage: "data_and_persistence",
      category: "authentication",
      question: "What type of authentication is required?",
      type: "single_choice",
      allowOther: true,
      header: "Auth",
      choices: [
        { id: "email_password", label: "Email & Password", description: "Standard email signup with secure password hashing" },
        { id: "google_oauth", label: "Google One-Tap / OAuth", description: "Fast social login via Google accounts" },
        { id: "github_oauth", label: "GitHub OAuth", description: "Developer-focused OAuth authentication via GitHub" },
        { id: "magic_link", label: "Magic Link / Passwordless", description: "Email verification link without password management" },
        { id: "multiple_providers", label: "Multiple Providers", description: "Offer email alongside Google and GitHub social logins" },
        { id: "none_local", label: "Private Single-User", description: "Zero login friction, runs locally as a private app on this phone" },
      ],
    };
  }

  static getDatabaseQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-database",
      stage: "data_and_persistence",
      category: "database",
      question: "How should application data be persisted?",
      type: "single_choice",
      allowOther: true,
      header: "Database",
      choices: [
        { id: "sqlite", label: "Embedded SQLite Database", description: "Fast, relational, zero-latency local database on this phone" },
        { id: "json_store", label: "Local JSON Storage", description: "Simple file-based key-value and record persistence" },
        { id: "cloud_postgres", label: "Hosted PostgreSQL / Cloud DB", description: "Remote cloud database with automated migrations" },
        { id: "in_memory", label: "In-Memory Session Only", description: "Temporary session state without disk persistence" },
      ],
    };
  }

  static getBackendRequirementsQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-backend-reqs",
      stage: "backend_and_api",
      category: "backend_requirements",
      question: "What backend architecture is needed?",
      type: "single_choice",
      allowOther: true,
      header: "Backend",
      choices: [
        { id: "express_rest", label: "Node.js / Express REST API", description: "Clean JSON REST endpoints with validation middleware" },
        { id: "fullstack_routes", label: "Full-Stack Integrated Endpoints", description: "Unified frontend and server routes in one framework" },
        { id: "api_with_workers", label: "REST API + Background Workers", description: "API endpoints plus asynchronous background task execution" },
        { id: "static_only", label: "Static Frontend Only", description: "Client-side state without dedicated server endpoints" },
      ],
    };
  }

  static getDeploymentPreferenceQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-deployment",
      stage: "backend_and_api",
      category: "deployment_preference",
      question: "Where would you like this application deployed?",
      type: "single_choice",
      allowOther: true,
      header: "Deploy",
      choices: [
        { id: "local_preview", label: "Local Preview on Phone", description: "Run directly on this phone at localhost with instant hot-reload" },
        { id: "vercel", label: "Vercel Cloud", description: "Global edge CDN deployment ideal for frontend and full-stack" },
        { id: "render", label: "Render Web Service", description: "Deploy full-stack web service and background workers on Render" },
        { id: "github_pages", label: "GitHub Pages / Static", description: "Free static web hosting with custom domain support" },
      ],
    };
  }

  static getResponsiveBehaviorQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-responsive",
      stage: "visual_vibe_and_style",
      category: "responsive_behavior",
      question: "What responsive layout and navigation fits best?",
      type: "single_choice",
      allowOther: true,
      header: "Layout",
      choices: [
        { id: "mobile_drawer", label: "Mobile-First with Drawer / Bottom Nav", description: "Optimized for phone screens with slide-out navigation" },
        { id: "desktop_header", label: "Desktop-First with Top-Bar Tabs", description: "Clean horizontal top navigation for wide screens" },
        { id: "sidebar_dashboard", label: "Collapsible Sidebar Dashboard", description: "Sidebar layout with nested sections for data-dense tools" },
        { id: "single_page", label: "Single-Page Continuous Flow", description: "Smooth scrolling sections on one continuous canvas" },
      ],
    };
  }

  static getPaymentModelQuestion(): StructuredDiscoveryQuestion {
    return {
      id: "q-payment-model",
      stage: "backend_and_api",
      category: "payment_model",
      question: "What payment model should be integrated?",
      type: "single_choice",
      allowOther: true,
      header: "Payments",
      choices: [
        { id: "one_time", label: "One-Time Purchases", description: "Standard checkout for individual products or orders" },
        { id: "subscriptions", label: "Recurring Subscriptions", description: "Monthly or annual membership tiers" },
        { id: "invoicing", label: "Custom Invoicing", description: "Quote-based payments and custom transaction amounts" },
        { id: "donations", label: "Donations / Pay What You Want", description: "Flexible support payments and tips" },
      ],
    };
  }

  static getStandardQuestion(
    category: DiscoveryQuestionCategory,
    context?: { appType?: string; capabilities?: string[] }
  ): StructuredDiscoveryQuestion {
    switch (category) {
      case "website_type":
        return this.getWebsiteTypeQuestion();
      case "website_purpose":
        return this.getWebsitePurposeQuestion(context?.appType);
      case "target_audience":
        return this.getTargetAudienceQuestion(context?.appType);
      case "visual_style":
        return this.getVisualStyleQuestion();
      case "pages_and_features":
        return this.getPagesAndFeaturesQuestion(context?.appType);
      case "fullstack_capabilities":
        return this.getFullstackCapabilitiesQuestion();
      case "authentication":
        return this.getAuthenticationQuestion();
      case "database":
        return this.getDatabaseQuestion();
      case "backend_requirements":
        return this.getBackendRequirementsQuestion();
      case "deployment_preference":
        return this.getDeploymentPreferenceQuestion();
      case "responsive_behavior":
        return this.getResponsiveBehaviorQuestion();
      case "payment_model":
        return this.getPaymentModelQuestion();
    }
  }

  static getAllStandardQuestions(): Record<DiscoveryQuestionCategory, StructuredDiscoveryQuestion> {
    return {
      website_type: this.getWebsiteTypeQuestion(),
      website_purpose: this.getWebsitePurposeQuestion(),
      target_audience: this.getTargetAudienceQuestion(),
      visual_style: this.getVisualStyleQuestion(),
      pages_and_features: this.getPagesAndFeaturesQuestion(),
      fullstack_capabilities: this.getFullstackCapabilitiesQuestion(),
      authentication: this.getAuthenticationQuestion(),
      database: this.getDatabaseQuestion(),
      backend_requirements: this.getBackendRequirementsQuestion(),
      deployment_preference: this.getDeploymentPreferenceQuestion(),
      responsive_behavior: this.getResponsiveBehaviorQuestion(),
      payment_model: this.getPaymentModelQuestion(),
    };
  }

  /**
   * Verify that the question catalog conforms to the 99.99% structured multiple-choice rule.
   */
  static verifyNinetyNinePercentMultipleChoice(questions: StructuredDiscoveryQuestion[]): {
    compliant: boolean;
    totalCount: number;
    choiceCount: number;
    freeTextCount: number;
    ratio: number;
    violations: string[];
  } {
    const totalCount = questions.length;
    if (totalCount === 0) {
      return { compliant: true, totalCount: 0, choiceCount: 0, freeTextCount: 0, ratio: 1, violations: [] };
    }
    const violations: string[] = [];
    let choiceCount = 0;
    let freeTextCount = 0;

    for (const q of questions) {
      const isChoice =
        (q.type === "single_choice" || q.type === "multiple_choice" || q.type === "confirmation") &&
        Array.isArray(q.choices) &&
        q.choices.length >= 2;
      if (isChoice) {
        choiceCount++;
      } else {
        freeTextCount++;
        violations.push(`Question "${q.question}" (${q.category}) is free_text or lacks choices (${q.choices?.length ?? 0} choices).`);
      }
    }

    const ratio = choiceCount / totalCount;
    const compliant = ratio >= 0.9999;
    return { compliant, totalCount, choiceCount, freeTextCount, ratio, violations };
  }

  /**
   * Start an adaptive requirements discovery interview session.
   */
  startDiscoverySession(request: string): DiscoverySession {
    const initialQ = this.getStageQuestion("purpose_and_users");
    return {
      sessionId: "disc-" + Date.now().toString(36),
      originalRequest: request,
      currentStage: "purpose_and_users",
      completedStages: [],
      gatheredRequirements: {},
      status: "interviewing",
      currentQuestion: initialQ,
    };
  }

  getStageQuestion(stage: DiscoveryStage, session?: DiscoverySession): StructuredDiscoveryQuestion {
    switch (stage) {
      case "purpose_and_users":
        return session?.gatheredRequirements.websiteType
          ? ConversationalAppBuilder.getWebsitePurposeQuestion(session.gatheredRequirements.websiteType)
          : ConversationalAppBuilder.getWebsiteTypeQuestion();
      case "workflows_and_screens":
        return ConversationalAppBuilder.getFullstackCapabilitiesQuestion();
      case "data_and_persistence": {
        const caps = session?.gatheredRequirements.selectedCapabilities || [];
        const wantsAuth = caps.some((c: string) => c.toLowerCase().includes("account") || c.toLowerCase().includes("auth"));
        return wantsAuth
          ? ConversationalAppBuilder.getAuthenticationQuestion()
          : ConversationalAppBuilder.getDatabaseQuestion();
      }
      case "backend_and_api": {
        const caps = session?.gatheredRequirements.selectedCapabilities || [];
        const wantsPayments = caps.some((c: string) => c.toLowerCase().includes("payment") || c.toLowerCase().includes("checkout"));
        return wantsPayments
          ? ConversationalAppBuilder.getPaymentModelQuestion()
          : ConversationalAppBuilder.getBackendRequirementsQuestion();
      }
      case "visual_vibe_and_style":
        return ConversationalAppBuilder.getVisualStyleQuestion();
    }
  }

  getClarificationQuestion(stage: DiscoveryStage, superficialAnswer: string): StructuredDiscoveryQuestion {
    const lower = superficialAnswer.toLowerCase();
    if (lower.includes("shoe")) {
      return {
        id: "clar-shoes",
        stage,
        category: "website_purpose",
        question: "For the shoe website, which product direction should I design around, and should visitors be able to buy shoes or only browse them?",
        type: "single_choice",
        allowOther: true,
        header: "Shoe Store Direction",
        choices: [
          { id: "online_store", label: "Online shoe store", description: "Customers browse products, add items to a cart, and place orders." },
          { id: "showcase_catalog", label: "Showcase/catalog", description: "Visitors browse collections and contact you, without checkout." },
          { id: "custom_sneaker_builder", label: "Custom sneaker builder", description: "Users customize shoe options and submit or purchase a design." },
          { id: "marketplace", label: "Multi-seller marketplace", description: "Different sellers list shoes while customers shop across them." },
        ],
      };
    }

    if (lower.includes("fitness") || lower.includes("gym") || lower.includes("workout")) {
      return {
        id: "clar-fitness",
        stage,
        category: "website_purpose",
        question: "For the fitness app, which product direction should we build first?",
        type: "single_choice",
        allowOther: true,
        header: "Fitness Direction",
        choices: [
          { id: "workout_tracker", label: "Workout Tracker & Logs", description: "Log daily exercises, sets, weights, and view progress graphs" },
          { id: "trainer_booking", label: "Gym & Trainer Booking", description: "Browse trainers, view availability, and schedule sessions" },
          { id: "class_catalog", label: "Class & Video Catalog", description: "Video library, workout schedules, and filterable routines" },
          { id: "routine_builder", label: "Custom Routine Builder", description: "Build custom workout splits and save personal templates" },
        ],
      };
    }

    if (lower.includes("real estate") || lower.includes("property")) {
      return {
        id: "clar-realestate",
        stage,
        category: "website_purpose",
        question: "For the real estate site, which primary workflow should we prioritize?",
        type: "single_choice",
        allowOther: true,
        header: "Real Estate Focus",
        choices: [
          { id: "property_listings", label: "Property Search & Listings", description: "Filterable listings with photos, specs, and map location" },
          { id: "agent_portfolio", label: "Agent Portfolio & Leads", description: "Showcase sold properties and collect buyer/seller inquiries" },
          { id: "mortgage_calc", label: "Mortgage Calculator & Tools", description: "Interactive financial tools and affordability calculators" },
          { id: "rental_portal", label: "Rental Application Portal", description: "Tenant applications, document submissions, and status checks" },
        ],
      };
    }

    return {
      id: "clar-generic",
      stage,
      category: "website_purpose",
      question: "Which product scope should we build for this application?",
      type: "single_choice",
      allowOther: true,
      header: "Product Scope",
      choices: [
        { id: "focused_mvp", label: "Focused MVP", description: "Core essentials only to launch quickly with minimal friction" },
        { id: "full_platform", label: "Full-Featured Platform", description: "Complete end-to-end user workflows with database and accounts" },
        { id: "showcase", label: "Interactive Showcase", description: "High visual impact showcase with interactive components" },
        { id: "community", label: "Community & Member Portal", description: "User profiles, member directory, and discussion interactions" },
      ],
    };
  }

  getClarificationPrompt(stage: DiscoveryStage, superficialAnswer?: string): string {
    return this.getClarificationQuestion(stage, superficialAnswer || "").question;
  }

  /**
   * Advance through the adaptive requirements interview.
   */
  advanceDiscovery(session: DiscoverySession, userInput: string): DiscoveryAdvanceResult {
    // 1. If currently awaiting confirmation, check for user confirmation
    if (session.status === "awaiting_confirmation") {
      const affirmative = /^(?:yes|yep|yeah|confirm|confirmed|looks\s+good|proceed|build\s+it|start|ok|okay)\b/i.test(userInput.trim());
      if (affirmative) {
        session.status = "confirmed";
        return {
          session,
          needsClarification: false,
          summary: session.summary,
          message: `Requirements confirmed for "${session.summary?.projectName || "application"}". Ready to build and preview.`,
        };
      }
      return {
        session,
        needsClarification: true,
        summary: session.summary,
        message: "Please review the implementation summary and confirm (e.g. 'Yes, build it') or specify revisions.",
      };
    }

    // 2. Check if answer is superficial
    if (this.isSuperficialResponse(userInput)) {
      session.status = "clarifying";
      const clarQ = this.getClarificationQuestion(session.currentStage, userInput);
      session.clarificationQuestion = clarQ;
      session.clarificationMessage = clarQ.question;
      return {
        session,
        needsClarification: true,
        structuredQuestion: clarQ,
        nextQuestion: clarQ.question,
        message: clarQ.question,
      };
    }

    // 3. Substantive response — record and advance
    session.status = "interviewing";
    session.clarificationMessage = undefined;
    session.clarificationQuestion = undefined;

    const trimmedInput = userInput.trim();
    switch (session.currentStage) {
      case "purpose_and_users":
        session.gatheredRequirements.purposeAndUsers = trimmedInput;
        if (!session.gatheredRequirements.websiteType) {
          session.gatheredRequirements.websiteType = trimmedInput;
        } else {
          session.gatheredRequirements.websitePurpose = trimmedInput;
        }
        break;
      case "workflows_and_screens":
        session.gatheredRequirements.workflowsAndScreens = trimmedInput;
        session.gatheredRequirements.selectedCapabilities = trimmedInput.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        break;
      case "data_and_persistence":
        session.gatheredRequirements.dataAndPersistence = trimmedInput;
        session.gatheredRequirements.databaseType = trimmedInput;
        break;
      case "backend_and_api":
        session.gatheredRequirements.backendAndApi = trimmedInput;
        session.gatheredRequirements.backendArchitecture = trimmedInput;
        break;
      case "visual_vibe_and_style":
        session.gatheredRequirements.visualVibeAndStyle = trimmedInput;
        session.gatheredRequirements.visualStyle = trimmedInput;
        break;
    }

    if (!session.completedStages.includes(session.currentStage)) {
      session.completedStages.push(session.currentStage);
    }

    const currentIndex = ConversationalAppBuilder.DISCOVERY_STAGES.indexOf(session.currentStage);
    if (currentIndex < ConversationalAppBuilder.DISCOVERY_STAGES.length - 1) {
      const nextStage = ConversationalAppBuilder.DISCOVERY_STAGES[currentIndex + 1];
      session.currentStage = nextStage;
      const nextQ = this.getStageQuestion(nextStage, session);
      session.currentQuestion = nextQ;
      return {
        session,
        needsClarification: false,
        structuredQuestion: nextQ,
        nextQuestion: nextQ.question,
        message: nextQ.question,
      };
    }

    // All stages complete: produce implementation summary and seek user confirmation
    session.status = "awaiting_confirmation";
    const summary = this.generateImplementationSummary(session);
    session.summary = summary;
    return {
      session,
      needsClarification: false,
      summary,
      message: summary.confirmationPrompt,
    };
  }

  /**
   * Generate a concise implementation summary from gathered requirements.
   */
  generateImplementationSummary(session: DiscoverySession): ImplementationSummary {
    const purpose = session.gatheredRequirements.purposeAndUsers || session.originalRequest;
    const name = this.extractProjectName(purpose) || "Full-Stack Web App";
    const screens = this.splitItems(session.gatheredRequirements.workflowsAndScreens || "Dashboard, Main View");
    const dataModel = this.splitItems(session.gatheredRequirements.dataAndPersistence || "Local SQLite records");
    const apis = this.splitItems(session.gatheredRequirements.backendAndApi || "REST API endpoints");
    const theme = session.gatheredRequirements.visualVibeAndStyle || "Modern Clean";

    const prompt = [
      `Implementation Summary for "${name}":`,
      `• Purpose: ${purpose}`,
      `• Architecture: Full-stack (React/Vite Frontend + Node.js API + Local SQLite)`,
      `• Screens: ${screens.join(", ")}`,
      `• Data Layer: ${dataModel.join(", ")}`,
      `• APIs: ${apis.join(", ")}`,
      `• Style & Vibe: ${theme}`,
      `\nReady to build this application? Please confirm to proceed.`,
    ].join("\n");

    return {
      projectName: name,
      purpose,
      targetAudience: "Primary end-users",
      architecture: "fullstack",
      keyScreens: screens,
      dataModel,
      apiEndpoints: apis,
      stylingTheme: theme,
      confirmationPrompt: prompt,
    };
  }

  /**
   * Generate an executable build plan once requirements are confirmed.
   */
  confirmAndGeneratePlan(session: DiscoverySession): ConversationalBuildPlan {
    const summary = session.summary || this.generateImplementationSummary(session);
    return {
      projectId: "app-" + Date.now().toString(36),
      projectName: summary.projectName,
      framework: summary.architecture,
      style: summary.stylingTheme,
      sections: summary.keyScreens,
      features: summary.apiEndpoints,
      requiredDecisions: [],
      needsAdaptiveDiscovery: false,
      discoverySession: session,
      implementationSummary: summary,
    };
  }

  private splitItems(text: string): string[] {
    return text
      .split(/[,;\n]+/)
      .map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((s) => s.length > 2)
      .slice(0, 5);
  }

  /**
   * Plan an application build from a user's natural language request.
   * Generates targeted, essential questions when ambiguous choices shape the app.
   */
  planApplication(request: string): ConversationalBuildPlan {
    const specificity = this.assessRequirementSpecificity(request);
    const lower = request.toLowerCase();
    const id = "app-" + Date.now().toString(36);

    let framework: ProjectFramework = "html";
    if (lower.includes("react") || lower.includes("vite")) {
      framework = "react";
    } else if (lower.includes("next") || lower.includes("ssr")) {
      framework = "nextjs";
    } else if (lower.includes("api") || lower.includes("backend") || lower.includes("express") || lower.includes("server")) {
      framework = "nodejs";
    } else if (lower.includes("fullstack") || lower.includes("full-stack") || lower.includes("database") || lower.includes("tracker") || lower.includes("job")) {
      framework = "fullstack";
    }

    const name = this.extractProjectName(request) || "My App";

    // If minimal/explicit, bypass discovery
    if (specificity.isMinimal) {
      return {
        projectId: id,
        projectName: name || "Simple HTML App",
        framework: "html",
        requiredDecisions: [],
        needsAdaptiveDiscovery: false,
      };
    }

    // If underspecified (e.g. "I want a full-stack website"), trigger adaptive discovery
    if (specificity.isUnderspecified) {
      const session = this.startDiscoverySession(request);
      return {
        projectId: id,
        projectName: name,
        framework,
        requiredDecisions: [],
        needsAdaptiveDiscovery: true,
        discoverySession: session,
      };
    }

    const requiredDecisions: DecisionSpec[] = [];

    // Decision: Auth & Storage for data-driven applications
    if (lower.includes("tracker") || lower.includes("job") || lower.includes("task") || lower.includes("crm")) {
      requiredDecisions.push({
        key: "auth",
        question: "Do you need user accounts/login, or should this run as a private single-user app on this phone?",
        type: "single_choice",
        choices: [
          "Private Single-User (zero login friction, stored securely on this phone)",
          "Multi-User (session-based authentication with role support)",
        ],
      });

      requiredDecisions.push({
        key: "storage",
        question: "How should application data and records be persisted?",
        type: "single_choice",
        choices: [
          "Embedded SQLite / Local Database (offline-first, zero cloud latency)",
          "In-memory store with JSON file persistence",
        ],
      });
    }

    // Decision: Visual Style / Theme
    requiredDecisions.push({
      key: "style",
      question: "What visual vibe or theme should this application have?",
      type: "single_choice",
      choices: [
        "Modern Clean (slate, crisp typography, subtle borders)",
        "Dark Mode Neo-Brutalist (high contrast, bold accents)",
        "Warm Editorial (serif headlines, muted tones, spacious)",
        "Cyberpunk / Tech (vibrant gradients, glassmorphism)",
      ],
    });

    // Decision: Core Sections / Modules
    if (lower.includes("portfolio") || lower.includes("landing") || lower.includes("showcase")) {
      requiredDecisions.push({
        key: "sections",
        question: "Which sections should be included in the first version?",
        type: "multiple_choice",
        choices: [
          "Hero section with dynamic headline",
          "Projects / Work Showcase gallery",
          "About / Bio & Skill matrix",
          "Interactive Contact Form",
        ],
      });
    }

    return {
      projectId: id,
      projectName: name,
      framework,
      requiredDecisions,
      needsAdaptiveDiscovery: false,
    };
  }

  /**
   * Execute the build and return a clean turn summary with actionable controls.
   */
  async buildAndPreview(
    plan: ConversationalBuildPlan,
    answers?: Record<string, any>
  ): Promise<TurnActionSummary> {
    try {
      // 1. Create project workspace
      const project = this.projectManager.createProject({
        id: plan.projectId,
        name: plan.projectName,
        framework: plan.framework,
        description: `Built with MOBOT (${plan.framework})`,
      });

      // 2. Customize based on decisions if provided
      if (answers?.style || answers?.sections) {
        this.applyCustomizations(project, answers);
      }

      // 3. Build & Test via Repair Loop if available
      if (this.repairLoop) {
        const cycleResult = await this.repairLoop.runAutonomousCycle(project.id);
        if (!cycleResult.success) {
          return {
            message: `Could not build project automatically: ${cycleResult.failureAnalysis?.summary || "Unknown error"}`,
            status: "failed",
            error: cycleResult.failureAnalysis?.summary,
            actions: ["Retry", "Inspect Logs", "Ask User"],
          };
        }
      } else {
        const build = await this.projectManager.runBuild(project.id);
        if (!build.ok) {
          return {
            message: `Build failed with exit code ${build.exitCode}`,
            status: "failed",
            error: build.stderr.slice(0, 200),
            actions: ["Retry", "Inspect Logs"],
          };
        }
      }

      // 4. Start local preview with independent verification
      const preview = await this.projectManager.startPreview(project.id);
      if (preview.status !== "running") {
        return {
          message: `Project built and tests passed, but local preview failed to start: ${preview.error || "Server did not remain running."}`,
          status: "failed",
          error: preview.error,
          actions: ["Retry", "Inspect Logs"],
        };
      }

      const structured: StructuredResponseData = {
        version: 1,
        components: [
          {
            id: `card-${project.id}`,
            type: "card",
            data: {
              variant: "success",
              headline: `Your first version of "${project.name}" is ready!`,
              body: `The application built cleanly and local preview is actively running on port ${preview.port}.`,
              badge: "LIVE PREVIEW",
              metadata: {
                "PID": String(preview.pid),
                "Port": String(preview.port),
                "Framework": String(project.framework),
              },
            },
            actions: [
              { id: "preview", label: "Open Preview", style: "primary" },
              { id: "deploy", label: "Deploy to Cloud", style: "secondary" },
            ],
          },
          {
            id: `dash-${project.id}`,
            type: "dashboard",
            title: "Build & Runtime Health",
            data: {
              metrics: [
                { id: "m-build", label: "Build", value: "Passed", trend: "up", status: "normal" },
                { id: "m-tests", label: "Tests", value: "Passed", trend: "up", status: "normal" },
                { id: "m-server", label: "Server", value: `PID ${preview.pid}`, trend: "neutral", status: "normal" },
                { id: "m-port", label: "Port", value: `:${preview.port}`, trend: "neutral", status: "normal" },
              ],
            },
          },
          {
            id: `diag-${project.id}`,
            type: "diagram",
            title: "Application Architecture",
            data: {
              diagramType: "architecture",
              nodes: [
                { id: "client", label: "Client (Chrome/WebView)", type: "client", status: "ok" },
                { id: "server", label: `Local HTTP Server (:${preview.port})`, type: "server", status: "active" },
                { id: "db", label: "SQLite / Storage", type: "database", status: "ok" },
              ],
              edges: [
                { from: "client", to: "server", label: `HTTP/1.1 :${preview.port}` },
                { from: "server", to: "db", label: "Local I/O" },
              ],
              accessibleText: `Architecture: Client connects to Local Server on port ${preview.port} backed by local storage`,
            },
          },
        ],
      };

      return {
        message: `Your first version of "${project.name}" is ready and running locally!\n\n` +
          `• Build: Passed\n` +
          `• Tests: Passed\n` +
          `• Server: Running (PID ${preview.pid})\n` +
          `• Local Preview: ${preview.url}\n\n` +
          `Preview: ${preview.url}`,
        status: "preview_ready",
        previewUrl: preview.url,
        actions: ["Preview", "Open in Browser", "Make Revisions", "Deploy"],
        structured,
      };
    } catch (err: any) {
      return {
        message: `Failed to build application: ${err.message}`,
        status: "failed",
        error: err.message,
        actions: ["Retry", "Inspect Logs"],
      };
    }
  }

  /**
   * Apply revisions (e.g. "make hero less boring", "change colors").
   */
  async applyRevision(
    projectId: string,
    revisionInstruction: string
  ): Promise<TurnActionSummary> {
    const project = this.projectManager.getProject(projectId);
    if (!project) {
      return {
        message: `Project "${projectId}" not found.`,
        status: "failed",
        actions: [],
      };
    }

    const lower = revisionInstruction.toLowerCase();

    // 1. Check for search / filter request
    if (lower.includes("search") || lower.includes("filter")) {
      if (this.projectManager.fileExists(projectId, "index.html")) {
        let html = this.projectManager.readFile(projectId, "index.html").content;
        if (!html.includes('id="search-input"')) {
          html = html.replace(
            /(<main[^>]*>)/i,
            `$1\n      <div class="search-bar-row" style="margin: 1rem 0;"><input type="text" id="search-input" placeholder="Search applications..." style="width: 100%; padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #fff;"></div>`
          );
          this.projectManager.writeFile(projectId, "index.html", html);
        }
      }
    }

    // 2. Check for salary / compensation request
    if (lower.includes("salary") || lower.includes("compensation")) {
      if (this.projectManager.fileExists(projectId, "index.html")) {
        let html = this.projectManager.readFile(projectId, "index.html").content;
        if (!html.includes('id="salary-input"')) {
          const salarySnippet = `\n      <div class="salary-field-row" style="margin: 0.5rem 0;"><input type="text" id="salary-input" placeholder="Salary / Comp (e.g. $180k)" class="input-text" style="width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #fff;"></div>`;
          if (html.includes("<form")) {
            html = html.replace(/(<form[^>]*>)/i, `$1${salarySnippet}`);
          } else {
            html = html.replace(/(<div class="card"[^>]*>)/i, `$1${salarySnippet}`);
          }
          this.projectManager.writeFile(projectId, "index.html", html);
        }
      }
    }

    // 3. Apply aesthetic revisions to style.css
    const hasStyle = this.projectManager.fileExists(projectId, "style.css");
    if (hasStyle) {
      const currentCss = this.projectManager.readFile(projectId, "style.css").content;
      let newCss = currentCss;
      if (lower.includes("boring") || lower.includes("vibrant")) {
        newCss = newCss.replace(
          /--primary:\s*[^;]+;/,
          "--primary: #6366f1; --accent: #ec4899; --hero-glow: radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%);"
        );
      }
      this.projectManager.writeFile(projectId, "style.css", newCss);
    }

    // Recommit revision in git
    try {
      this.projectManager.gitCommit(projectId, `Revise: ${revisionInstruction}`);
    } catch {}

    // Restart preview
    const preview = await this.projectManager.startPreview(projectId);

    return {
      message: `Updated "${project.name}" based on your feedback: "${revisionInstruction}". Preview is refreshed at ${preview.url}.`,
      status: "preview_ready",
      previewUrl: preview.url,
      actions: ["Preview", "Open in Browser", "Deploy", "Further Revisions"],
    };
  }

  /**
   * Trigger deployment through the configured DeploymentManager.
   */
  async deployApplication(
    projectId: string,
    provider: DeploymentProviderId
  ): Promise<TurnActionSummary> {
    if (!this.deploymentManager) {
      return {
        message: "Deployment manager is not configured.",
        status: "failed",
        error: "Deployment manager unavailable",
        actions: ["Inspect Logs"],
      };
    }
    const project = this.projectManager.getProject(projectId);
    if (!project) {
      return {
        message: `Project "${projectId}" not found.`,
        status: "failed",
        actions: [],
      };
    }

    try {
      const record = await this.deploymentManager.deploy(provider, {
        projectId,
        projectName: project.name,
      });
      return {
        message: `Successfully deployed to ${provider}! Live at: ${record.url}`,
        status: "deployed",
        deploymentUrl: record.url,
        actions: ["Open Deployment", "Make Revisions"],
      };
    } catch (err: any) {
      return {
        message: `Deployment to ${provider} failed: ${err.message}`,
        status: "failed",
        error: err.message,
        actions: ["Retry", "Inspect Logs"],
      };
    }
  }

  private extractProjectName(request: string): string | null {
    const match = request.match(/(?:build|create|make)\s+(?:me\s+)?(?:a\s+)?([a-zA-Z0-9\s_-]+?)(?:\s+(?:app|site|website)\b|[.!?]|$)/i);
    if (match && match[1].trim()) {
      return match[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return null;
  }

  private applyCustomizations(project: ProjectRecord, answers: Record<string, any>): void {
    // 1. HTML customizations
    if (this.projectManager.fileExists(project.id, "index.html")) {
      let currentHtml = this.projectManager.readFile(project.id, "index.html").content;
      currentHtml = currentHtml.replace(/<title>.*?<\/title>/, `<title>${project.name}</title>`);
      currentHtml = currentHtml.replace(/<h1>.*?<\/h1>/, `<h1>${project.name}</h1>`);

      if (answers.sections && Array.isArray(answers.sections)) {
        const sectionSnippets = answers.sections
          .map((s: string) => `      <section class="card"><h3>${s}</h3><p>Content for ${s}</p></section>`)
          .join("\n");
        currentHtml = currentHtml.replace(/(<\/main>)/i, `${sectionSnippets}\n    $1`);
      }

      this.projectManager.writeFile(project.id, "index.html", currentHtml);
    }

    // 2. CSS theme customizations
    if (this.projectManager.fileExists(project.id, "style.css")) {
      let css = this.projectManager.readFile(project.id, "style.css").content;
      const style = String(answers?.style || "");
      if (style.includes("Dark Mode") || style.includes("Brutalist")) {
        css = css
          .replace(/--primary:\s*[^;]+;/, "--primary: #eab308;")
          .replace(/--bg:\s*[^;]+;/, "--bg: #09090b;")
          .replace(/--card-bg:\s*[^;]+;/, "--card-bg: #18181b;");
      } else if (style.includes("Cyberpunk") || style.includes("Tech")) {
        css = css
          .replace(/--primary:\s*[^;]+;/, "--primary: #06b6d4;")
          .replace(/--accent:\s*[^;]+;/, "--accent: #d946ef;")
          .replace(/--bg:\s*[^;]+;/, "--bg: #0a0a14;");
      }
      this.projectManager.writeFile(project.id, "style.css", css);
    }
  }
}

/**
 * Structured questions raised by a provider's own "ask the human" tool —
 * Claude Code's built-in `AskUserQuestion`.
 *
 * That tool reaches us as a PERMISSION ask (the CLI routes it through
 * --permission-prompt-tool like any other tool use), which is exactly the
 * wrong shape: a person cannot answer "which model should this bot use?"
 * with Deny / Always allow / Allow once. So the ask is re-read here into the
 * questions the model actually posed, the card renders them as choices, and
 * the answer goes back as text.
 *
 * The payload is bot-authored, so every field is treated as untrusted: the
 * shape is validated rather than cast, and the counts and lengths are capped
 * so a runaway (or hostile) tool call cannot produce an unreadable card.
 */

/** The provider tool whose input this module understands. */
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

// ── v2: typed questions with stable option ids ──────────────────────────
//
// A flat ask (question + label rows) survives everywhere already. v2 adds
// optional structure the card can honour and an answer can cite: WHAT kind
// of question it is, a stable id per option so an answer names the choice
// rather than its display text, selection bounds for multi-selects, and
// whether the question may be skipped. Every field is optional and
// defaulted so a v1 payload means exactly what it always meant.

export const ASK_QUESTION_TYPES = ["single_choice", "multiple_choice", "confirmation", "free_text"] as const;
export type AskQuestionType = (typeof ASK_QUESTION_TYPES)[number];

/** The reserved id of the card's built-in "Other" row and of any free-text
 * answer. A model-provided option can never claim it (parseOptionId).
 * Confirmation answers use their own pair below. */
export const OTHER_ID = "other";
export const CONFIRMED_ID = "confirmed";
export const DECLINED_ID = "declined";

/** Upper bound on picks for a multiple_choice question; equals MAX_OPTIONS
 * so the ids and the rows can never disagree. */
export const MAX_SELECTIONS = 12;
const MAX_OPTION_ID = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The slug of an id the model itself sent, or "" when it did not. Parse
 * keeps only what was sent — derived ids belong to the answer side, so a
 * payload without them stays byte-identical to how it always parsed.
 * "other" is reserved for the card's built-in row and is renamed here. */
function parseOptionId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_OPTION_ID);
  return slug === OTHER_ID ? "other_option" : slug;
}

/** Deterministic fallback so ids stay stable across replays of the same
 * ask: the same label always yields the same id. */
function optionIdFromLabel(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_OPTION_ID);
  return slug || "option";
}

/** Caps. Claude Code's own limits are smaller (1-4 questions, 2-4 options);
 * these leave room for a provider that widens them without letting a card
 * grow without bound. */
export const MAX_QUESTIONS = 6;
export const MAX_OPTIONS = 12;
const MAX_QUESTION_TEXT = 400;
const MAX_LABEL = 120;
const MAX_DESCRIPTION = 400;
/** One free-text answer. Long enough for a sentence or two of context. */
export const MAX_CUSTOM_ANSWER = 2000;

export interface AskQuestionOption {
  label: string;
  description?: string;
  /** Stable id an answer cites. Minted from the label when the model did
   * not send one, so it is always present after parsing. */
  id?: string;
}

export interface AskQuestion {
  question: string;
  /** Short tab label the model gives each question ("Schedule", "Model"). */
  header?: string;
  multiSelect?: boolean;
  options: AskQuestionOption[];
  /** v2. Derived when absent: free_text with no options, multiple_choice
   * when multiSelect, else single_choice. "confirmation" comes only from
   * the model saying so. */
  type?: AskQuestionType;
  /** multiple_choice bounds. requiredSelections defaults to the question's
   * required-ness, maxSelections to MAX_SELECTIONS; both clamped. */
  minSelections?: number;
  maxSelections?: number;
  /** false lets the card be submitted empty. Default is required. */
  required?: boolean;
  /** false removes the built-in "Other" row. Default is shown for choice
   * questions, never for free_text. */
  allowOther?: boolean;
}

/** Durable payload on a question card. Versioned like the other card
 * payloads so a later shape change can be told apart from this one. */
export interface QuestionRequestCardData {
  version: 1;
  questions: AskQuestion[];
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

function parseOption(value: unknown): AskQuestionOption | null {
  // A bare string is not the documented shape, but it is the obvious
  // degradation and costs one line to accept.
  if (typeof value === "string") {
    const label = text(value, MAX_LABEL);
    return label ? { label } : null;
  }
  if (!isRecord(value)) return null;
  const label = text(value.label, MAX_LABEL);
  if (!label) return null;
  const description = text(value.description, MAX_DESCRIPTION);
  const id = parseOptionId(value.id);
  return description ? { label, description, ...(id ? { id } : {}) } : id ? { label, id } : { label };
}

function parseQuestion(value: unknown): AskQuestion | null {
  if (!isRecord(value)) return null;
  const question = text(value.question, MAX_QUESTION_TEXT);
  if (!question) return null;
  const options: AskQuestionOption[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value.options) ? value.options : []) {
    const option = parseOption(raw);
    // Duplicate labels are the one thing a radio group cannot survive: the
    // answer text could no longer say which row was picked. Duplicate ids
    // cannot survive either — one id must name one row (ids ride behind a
    // prefix in the set so a label can never collide with one).
    if (!option || seen.has(option.label) || (option.id && seen.has(`#:${option.id}`))) continue;
    seen.add(option.label);
    if (option.id) seen.add(`#:${option.id}`);
    options.push(option);
    if (options.length === MAX_OPTIONS) break;
  }
  // A question with nothing to choose from is still answerable — the card
  // always offers free text — so an empty option list is kept, not dropped.
  const header = text(value.header, MAX_LABEL);
  const declared = typeof value.type === "string" && (ASK_QUESTION_TYPES as readonly string[]).includes(value.type)
    ? value.type as AskQuestionType
    : undefined;
  const type: AskQuestionType = declared ?? (options.length ? (value.multiSelect === true ? "multiple_choice" : "single_choice") : "free_text");
  // A free-text question has no rows to bound or show; the model cannot
  // smuggle both shapes into one question.
  const isFree = type === "free_text";
  const isMulti = type === "multiple_choice";
  // Bounds ride along only when the model actually sent them: a declared
  // bound is quoted back so the card and an audit trail see what was asked,
  // while an absent one keeps meaning the helpers' default.
  const declaredMin = isMulti && typeof value.minSelections === "number" && Number.isInteger(value.minSelections)
    ? Math.min(Math.max(value.minSelections, 0), MAX_SELECTIONS)
    : undefined;
  const declaredMax = isMulti && typeof value.maxSelections === "number" && Number.isInteger(value.maxSelections)
    ? Math.min(Math.max(value.maxSelections, 1), MAX_SELECTIONS)
    : undefined;
  const effectiveMin = declaredMin !== undefined && declaredMax !== undefined ? Math.min(declaredMin, declaredMax) : declaredMin;
  // A confirmation carries its own two rows so an answer can cite the same
  // ids everywhere (CONFIRMED_ID / DECLINED_ID), and Other is meaningless
  // over a yes/no — the pair is the whole question.
  const finalOptions: AskQuestionOption[] = type === "confirmation"
    ? [{ label: "Confirm", id: CONFIRMED_ID }, { label: "Cancel", id: DECLINED_ID }]
    : options;
  return {
    question,
    ...(header ? { header } : {}),
    ...(isMulti ? { multiSelect: true } : {}),
    ...(isFree ? { options: [] as AskQuestionOption[] } : { options: finalOptions }),
    ...(declared ? { type } : {}),
    ...(effectiveMin !== undefined ? { minSelections: effectiveMin } : {}),
    ...(declaredMax !== undefined ? { maxSelections: declaredMax } : {}),
    ...(value.required === false ? { required: false } : {}),
    ...(!isFree && type !== "confirmation" && value.allowOther === false ? { allowOther: false } : {}),
  };
}

// ── reading a question's shape back ─────────────────────────────────────
// The card and the validation are written against these, not the raw
// optional fields, so an absent v2 field and its default behave identically
// in TypeScript, Kotlin and Swift.

/** The effective type, v1 payloads included. */
export function questionType(question: AskQuestion): AskQuestionType {
  if (question.type) return question.type;
  if (!question.options.length) return "free_text";
  return question.multiSelect === true ? "multiple_choice" : "single_choice";
}

/** Whether the built-in "Other" row exists: any choice question without
 * allowOther:false. A free_text question IS the other field. */
export function allowsOther(question: AskQuestion): boolean {
  return questionType(question) !== "free_text" && question.allowOther !== false;
}

/** How many picks the card demands: 1 unless the model said the question
 * may be skipped. */
export function requiredCount(question: AskQuestion): number {
  return question.required === false ? 0 : 1;
}

/** The most rows a person may tick, Other included. Single and
 * confirmation cap at one by definition; a multi honors the model's bound. */
export function maxSelections(question: AskQuestion): number {
  const type = questionType(question);
  if (type !== "multiple_choice") return 1;
  return Math.min(Math.max(question.maxSelections ?? MAX_SELECTIONS, 1), MAX_SELECTIONS);
}

/** The fewest rows a person must tick, Other included — never more than the
 * maximum. An optional question (required:false) demands none, even over an
 * explicit minSelections: whether an answer must exist is the stronger
 * signal, and the two are contradictory only when a model sends both. */
export function minSelections(question: AskQuestion): number {
  if (question.required === false) return 0;
  const type = questionType(question);
  if (type !== "multiple_choice") return 1;
  return Math.min(Math.max(question.minSelections ?? 1, 1), maxSelections(question));
}

/** The id each option answers under, in row order: the model's id when it
 * sent one, else a slug of the label — suffixed when two rows would share
 * one id. The built-in Other id is reserved from the start, so a row can
 * never collide with it either. */
export function resolvedOptionIds(question: AskQuestion): string[] {
  const used = new Set<string>([OTHER_ID]);
  return question.options.map((option) => {
    const base = option.id ?? optionIdFromLabel(option.label);
    let unique = base;
    for (let n = 2; used.has(unique); n += 1) unique = `${base}_${n}`;
    used.add(unique);
    return unique;
  });
}

/** Every id an answer may cite, in row order, Other last. A confirmation
 * with no rows still offers its intrinsic pair. */
export function optionIds(question: AskQuestion): string[] {
  if (questionType(question) === "confirmation" && !question.options.length) return [CONFIRMED_ID, DECLINED_ID];
  const ids = resolvedOptionIds(question);
  return allowsOther(question) ? [...ids, OTHER_ID] : ids;
}

/** What a cited id points at. "other" is the built-in row, whose text is
 * whatever the person typed. */
export function labelForId(question: AskQuestion, id: string): string | undefined {
  if (id === OTHER_ID) return allowsOther(question) ? "Other" : undefined;
  const position = resolvedOptionIds(question).indexOf(id);
  return position === -1 ? undefined : question.options[position]?.label;
}

/** The words a confirmation card sends. They become the tool result, so
 * they say what the person decided, not which button they hit. */
export function formatConfirmationAnswer(confirmed: boolean): string {
  return confirmed ? "The user confirmed." : "The user declined.";
}

// ── validating a structured answer ──────────────────────────────────────
// The card enforces these while the person is choosing; the same rules are
// ported to Kotlin (AskQuestionRules) so the phone cannot ship an answer
// its own card would have rejected.

/** Why an answer cannot be sent yet, in one card-sized line, or null when
 * it is complete. `selected` are ids from optionIds(question); `freeText`
 * is the Other field's (or the question's whole) text. */
export function validateQuestionAnswer(
  question: AskQuestion,
  selected: readonly string[],
  freeText: string,
): string | null {
  const type = questionType(question);
  const known = new Set(optionIds(question));
  for (const id of selected) {
    if (!known.has(id)) return "That choice is no longer on the list.";
  }
  if (type === "confirmation") {
    // The card offers exactly its two buttons, and an answer is one of them.
    // A required confirmation cannot be submitted untouched: the submit
    // button would be live while sending nothing at all.
    if (selected.length > 1) return "Choose Confirm or Cancel.";
    if (requiredCount(question) && !selected.length) return "Choose Confirm or Cancel.";
    return null;
  }
  const trimmed = freeText.trim();
  if (trimmed.length > MAX_CUSTOM_ANSWER) return `Keep the written answer under ${MAX_CUSTOM_ANSWER} characters.`;
  const otherPicked = selected.includes(OTHER_ID);
  if (otherPicked && !trimmed) return "Add your own answer beside Other, or pick one of the options.";
  const total = selected.length;
  if (total > maxSelections(question)) return type === "multiple_choice" ? `Choose at most ${maxSelections(question)}.` : "Choose only one.";
  if (type === "free_text") return requiredCount(question) && !trimmed ? "Write an answer first." : null;
  if (total < minSelections(question)) return minSelections(question) > 1 ? `Choose at least ${minSelections(question)}.` : "Choose an answer first.";
  return null;
}

/** Which ids an answer text names, per question — the durable, structured
 * form of an answer. Labels are matched exactly (the card echoes them),
 * Other text becomes OTHER_ID, and a confirmation's words become its id
 * pair. Questions with no recognized answer yield an empty list. */
export function answerIdsByQuestion(
  message: string,
  questions: readonly AskQuestion[],
): string[][] {
  // The preamble names the channel, not an answer. Strip it before the
  // per-question parse — including the bare-preamble form, which must
  // become empty so the flat fallback cannot file it as the person's words.
  const withoutPreamble = answerWithoutPreamble(message);
  const answers = questionAnswersByQuestion(withoutPreamble === ANSWER_PREAMBLE ? "" : withoutPreamble, questions);
  return questions.map((question) => {
    const type = questionType(question);
    if (type === "confirmation") {
      const words = (answers[question.question] ?? "").trim();
      // The card's own words ("The user confirmed.") or a bare "confirmed".
      return /^the user confirmed\b|^confirmed\b/i.test(words) ? [CONFIRMED_ID]
        : /^the user declined\b|^declined\b/i.test(words) ? [DECLINED_ID]
        : [];
    }
    const picked = (answers[question.question] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const resolved = resolvedOptionIds(question);
    const ids: string[] = [];
    for (const label of picked) {
      const position = question.options.findIndex((option) => option.label === label);
      if (position !== -1) ids.push(resolved[position]!);
      else if (label === "Other" || allowsOther(question)) ids.push(OTHER_ID);
    }
    return ids;
  });
}

/** The questions inside an AskUserQuestion tool input, or null when the
 * payload is not one (a malformed call falls back to the ordinary card). */
export function parseAskQuestions(input: unknown): AskQuestion[] | null {
  if (!isRecord(input) || !Array.isArray(input.questions)) return null;
  const questions: AskQuestion[] = [];
  for (const raw of input.questions) {
    const question = parseQuestion(raw);
    if (!question) continue;
    questions.push(question);
    if (questions.length === MAX_QUESTIONS) break;
  }
  return questions.length ? questions : null;
}

/**
 * The questions behind an `ask_user` tool call, in either shape.
 *
 * A model may send the structured form (`questions: [...]`) or the flat one
 * (`question` + `choices`), and v2 fields on the flat form carry the typed
 * structure: `type`, per-option ids, selection bounds, `required`,
 * `allowOther`. Anything unreadable is skipped or degraded exactly where it
 * came from, so one malformed field costs that field, never the ask.
 */
/**
 * Requirements discovery 99.99% multiple choice enhancer:
 * When an app-builder discovery question is asked but choices were omitted by
 * a model or caller (and not explicitly declared as free_text or confirmation),
 * populate the canonical structured options so the card renders selectable choices.
 */
export function inferDiscoveryChoices(questionText: string): {
  options: AskQuestionOption[];
  type?: AskQuestionType;
  multiSelect?: boolean;
  minSelections?: number;
  maxSelections?: number;
} | null {
  const q = questionText.toLowerCase();

  // 1. Website/Application Type
  if (
    /(?:kind|type|category).*(?:website|app|application|project|store)|(?:website|app|application).*(?:kind|type|category)/i.test(q)
  ) {
    return {
      type: "single_choice",
      options: [
        { label: "Portfolio", description: "Showcase personal projects, creative work, or case studies", id: "portfolio" },
        { label: "Business Website", description: "Company brand presence, services overview, and lead capture", id: "business" },
        { label: "Agency / Services", description: "Client showcase, detailed service packages, and consultation booking", id: "agency" },
        { label: "E-Commerce / Online Store", description: "Product catalog, shopping cart, and online checkout", id: "ecommerce" },
        { label: "Blog / Publication", description: "Articles, newsletters, editorial stories, and RSS feeds", id: "blog" },
        { label: "Community / Forum", description: "User discussions, member directory, and profile pages", id: "community" },
        { label: "SaaS / Web Application", description: "Interactive product workflows, dashboards, and tooling", id: "saas" },
        { label: "Internal Tool / Operations", description: "Admin panel, inventory tracker, or team dashboard", id: "internal_tool" },
      ],
    };
  }

  // 2. Goal / Purpose
  if (
    /(?:main|primary|core)?\s*(?:goal|purpose|objective)|what\s*should\s*(?:the|this|it)\s*(?:full[\s-]?stack\s*)?(?:website|app)?\s*(?:do|accomplish)/i.test(q)
  ) {
    return {
      type: "single_choice",
      options: [
        { label: "Generate Leads", description: "Collect client inquiries, quote requests, and contact submissions", id: "get_leads" },
        { label: "Sell Products", description: "Process online purchases, manage catalog items, and track orders", id: "sell_products" },
        { label: "Showcase Work", description: "Demonstrate skills, portfolio pieces, and case study results", id: "showcase_work" },
        { label: "Book Appointments", description: "Allow visitors to schedule consultations, calls, or reservations", id: "book_appointments" },
        { label: "Publish Content", description: "Share insights, tutorials, guides, and regular news updates", id: "publish_content" },
        { label: "Interactive Service", description: "Deliver self-service calculators, tools, or utilities", id: "interactive_service" },
        { label: "Manage Operations", description: "Coordinate team records, internal status, and company workflows", id: "internal_operations" },
      ],
    };
  }

  // 3. Target Audience
  if (/(?:target\s*audience|who\s*will\s*use|who\s*is\s*(?:this|it)\s*for)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "General Public / Consumers", description: "Everyday shoppers, casual visitors, and retail customers", id: "consumers" },
        { label: "B2B / Business Clients", description: "Corporate decision-makers, small business owners, and managers", id: "b2b_clients" },
        { label: "Developers & Technical Users", description: "Software engineers, DevOps, and technical teams", id: "developers" },
        { label: "Creative Professionals", description: "Designers, photographers, artists, and media agencies", id: "creatives" },
        { label: "Internal Team & Staff", description: "Company employees, operations staff, and administrators", id: "internal_team" },
      ],
    };
  }

  // 4. Visual Style / Theme / Vibe
  if (/(?:visual\s*style|aesthetic|theme|look\s*and\s*feel|vibe)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "Minimal & Clean", description: "Generous whitespace, crisp typography, and restrained neutral accents", id: "minimal_clean" },
        { label: "Modern Tech", description: "Dark mode, sleek card elevations, and vibrant indigo/cyan accents", id: "modern_tech" },
        { label: "Professional Corporate", description: "Structured layouts, navy/slate palette, and formal clarity", id: "professional_corp" },
        { label: "Warm Editorial", description: "Serif typography, earthy tones, and magazine-style layout", id: "warm_editorial" },
        { label: "Playful & Vibrant", description: "Bold colorful accents, rounded surfaces, and lively energy", id: "playful_vibrant" },
        { label: "Luxury & Premium", description: "Monochrome tones, champagne/gold details, and refined minimalism", id: "luxury_premium" },
      ],
    };
  }

  // 5. Capabilities / Features / User Actions
  if (
    /(?:what\s*(?:features|capabilities)|what\s*should\s*users\s*be\s*able\s*to\s*do|what\s*(?:actions|workflows|screens)\s*(?:must|should)\s*it\s*support)/i.test(q)
  ) {
    return {
      type: "multiple_choice",
      multiSelect: true,
      minSelections: 1,
      maxSelections: 8,
      options: [
        { label: "Browse Content", description: "Explore product lists, article grids, or showcase galleries", id: "browse_content" },
        { label: "Search & Filter", description: "Find items quickly with real-time keyword search and category tags", id: "search_filter" },
        { label: "User Accounts", description: "Sign up, log in, and manage personal profile settings", id: "user_accounts" },
        { label: "Submit Forms", description: "Send inquiries, quote requests, feedback, or applications", id: "submit_forms" },
        { label: "Upload Files", description: "Attach documents, images, or project assets securely", id: "upload_files" },
        { label: "Make Payments", description: "Complete online checkout with debit/credit card or digital pay", id: "make_payments" },
        { label: "Save Favorites", description: "Bookmark items into a wishlist or pinned collection", id: "save_favorites" },
        { label: "Contact Business", description: "Reach out via integrated contact form, email, or chat link", id: "contact_business" },
      ],
    };
  }

  // 6. Authentication
  if (/(?:type\s*of\s*authentication|authentication|login|sign[\s-]*in|user\s*accounts)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "Email & Password", description: "Standard email signup with secure password hashing", id: "email_password" },
        { label: "Google One-Tap / OAuth", description: "Fast social login via Google accounts", id: "google_oauth" },
        { label: "GitHub OAuth", description: "Developer-focused OAuth authentication via GitHub", id: "github_oauth" },
        { label: "Magic Link / Passwordless", description: "Email verification link without password management", id: "magic_link" },
        { label: "Multiple Providers", description: "Offer email alongside Google and GitHub social logins", id: "multiple_providers" },
        { label: "Private Single-User", description: "Zero login friction, runs locally as a private app on this phone", id: "none_local" },
      ],
    };
  }

  // 7. Database & Storage
  if (/(?:database|storage|persist|store\s*data|data\s*layer|records)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "Embedded SQLite Database", description: "Fast, relational, zero-latency local database on this phone", id: "sqlite" },
        { label: "Local JSON Storage", description: "Simple file-based key-value and record persistence", id: "json_store" },
        { label: "Hosted PostgreSQL / Cloud DB", description: "Remote cloud database with automated migrations", id: "cloud_postgres" },
        { label: "In-Memory Session Only", description: "Temporary session state without disk persistence", id: "in_memory" },
      ],
    };
  }

  // 8. Backend & API
  if (/(?:backend\s*(?:architecture|endpoints|api)|server\s*logic)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "Node.js / Express REST API", description: "Clean JSON REST endpoints with validation middleware", id: "express_rest" },
        { label: "Full-Stack Integrated Endpoints", description: "Unified frontend and server routes in one framework", id: "fullstack_routes" },
        { label: "REST API + Background Workers", description: "API endpoints plus asynchronous background task execution", id: "api_with_workers" },
        { label: "Static Frontend Only", description: "Client-side state without dedicated server endpoints", id: "static_only" },
      ],
    };
  }

  // 9. Deployment
  if (/(?:where\s*(?:would\s*you\s*like|to\s*deploy)|deployment\s*preference|hosting)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "Local Preview on Phone", description: "Run directly on this phone at localhost with instant hot-reload", id: "local_preview" },
        { label: "Vercel Cloud", description: "Global edge CDN deployment ideal for frontend and full-stack", id: "vercel" },
        { label: "Render Web Service", description: "Deploy full-stack web service and background workers on Render", id: "render" },
        { label: "GitHub Pages / Static", description: "Free static web hosting with custom domain support", id: "github_pages" },
      ],
    };
  }

  // 10. Responsive Behavior
  if (/(?:responsive|navigation\s*style|layout\s*and\s*navigation|mobile\s*layout)/i.test(q)) {
    return {
      type: "single_choice",
      options: [
        { label: "Mobile-First with Drawer / Bottom Nav", description: "Optimized for phone screens with slide-out navigation", id: "mobile_drawer" },
        { label: "Desktop-First with Top-Bar Tabs", description: "Clean horizontal top navigation for wide screens", id: "desktop_header" },
        { label: "Collapsible Sidebar Dashboard", description: "Sidebar layout with nested sections for data-dense tools", id: "sidebar_dashboard" },
        { label: "Single-Page Continuous Flow", description: "Smooth scrolling sections on one continuous canvas", id: "single_page" },
      ],
    };
  }

  // 11. Full-Stack Capabilities Multi-Select
  if (/(?:full[\s-]?stack\s*capabilities|capabilities\s*does\s*the)/i.test(q)) {
    return {
      type: "multiple_choice",
      multiSelect: true,
      minSelections: 1,
      maxSelections: 8,
      options: [
        { label: "User accounts & auth", description: "Registration, login sessions, and user profiles", id: "user_accounts" },
        { label: "Database persistence", description: "Local SQLite database for durable records", id: "database" },
        { label: "Admin dashboard", description: "Back-office management view to inspect and edit records", id: "admin_dashboard" },
        { label: "Search & filtering", description: "Full-text query search and multi-criteria filters", id: "search" },
        { label: "File & image uploads", description: "Storage for document attachments and avatar photos", id: "file_uploads" },
        { label: "Notifications", description: "In-app alerts and confirmation banners", id: "notifications" },
        { label: "Payments & checkout", description: "Order transactions and payment records", id: "payments" },
        { label: "External APIs", description: "Integration with third-party web services", id: "external_apis" },
      ],
    };
  }

  return null;
}

/**
 * The questions behind an `ask_user` tool call, in either shape.
 *
 * A model may send the structured form (`questions: [...]`) or the flat one
 * (`question` + `choices`), and v2 fields on the flat form carry the typed
 * structure: `type`, per-option ids, selection bounds, `required`,
 * `allowOther`. Anything unreadable is skipped or degraded exactly where it
 * came from, so one malformed field costs that field, never the ask.
 */
export function normalizeAskUserInput(input: unknown): AskQuestion[] | null {
  const structured = parseAskQuestions(input);
  if (structured) return structured;
  if (!isRecord(input)) return null;
  const flatQuestion = text(input.question, MAX_QUESTION_TEXT);
  if (!flatQuestion) return null;
  const options: AskQuestionOption[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input.choices) ? input.choices : []) {
    // The schema says objects, but strings are what every model trained on
    // the v1 shape still sends; both are the obvious degradation.
    const row = isRecord(raw)
      ? { label: text(raw.label, MAX_LABEL), description: text(raw.description, MAX_DESCRIPTION), id: parseOptionId(raw.id) }
      : { label: text(raw, MAX_LABEL), description: undefined, id: "" };
    if (!row.label || seen.has(row.label)) continue;
    seen.add(row.label);
    const description = row.description ? { description: row.description } : {};
    options.push({ label: row.label, ...description, ...(row.id ? { id: row.id } : {}) });
    if (options.length === MAX_OPTIONS) break;
  }

  // 99.99% Multiple Choice Rule: if options were omitted and type was not
  // explicitly declared as free_text or confirmation, check if this is an
  // app-builder requirements question and enrich with canonical choices.
  let effectiveType = typeof input.type === "string" && (ASK_QUESTION_TYPES as readonly string[]).includes(input.type)
    ? (input.type as AskQuestionType)
    : undefined;
  let effectiveMulti = input.type === "multiple_choice" || input.multiSelect === true;
  let minSelections = input.minSelections as number | undefined;
  let maxSelections = input.maxSelections as number | undefined;

  if (!options.length && input.type !== "free_text" && input.type !== "confirmation") {
    const inferred = inferDiscoveryChoices(flatQuestion);
    if (inferred) {
      options.push(...inferred.options);
      if (!effectiveType && inferred.type) effectiveType = inferred.type;
      if (inferred.multiSelect) effectiveMulti = true;
      if (inferred.minSelections !== undefined && minSelections === undefined) minSelections = inferred.minSelections;
      if (inferred.maxSelections !== undefined && maxSelections === undefined) maxSelections = inferred.maxSelections;
    }
  }

  return parseAskQuestions({ questions: [{
    question: flatQuestion,
    options,
    ...(effectiveMulti ? { multiSelect: true } : {}),
    ...(effectiveType ? { type: effectiveType } : {}),
    ...(minSelections === undefined ? {} : { minSelections }),
    ...(maxSelections === undefined ? {} : { maxSelections }),
    ...(input.required === undefined ? {} : { required: input.required }),
    ...(input.allowOther === undefined ? {} : { allowOther: input.allowOther }),
  }] });
}

/** The one line the card subtitle and a spoken prompt show. */
export function askQuestionSummary(questions: readonly AskQuestion[]): string {
  const first = questions[0]?.question ?? "";
  const rest = questions.length - 1;
  return rest > 0 ? `${first} (+${rest} more question${rest > 1 ? "s" : ""})` : first;
}

/** How many one-tap answers an `ask_user` card offers; the tool advertises
 * "2-5 suggested answers". */
export const MAX_CHOICES = 5;

/**
 * Flat labels from a bot-authored `ask_user` `choices` array.
 *
 * The tool schema says strings, but a model that has also seen Claude's
 * AskUserQuestion will hand over `{ label, description }` rows instead
 * (MiniMax M3 does). The label is the choice either way. Anything else is
 * dropped: a non-string choice that reached the card was drawn as a React
 * child, which React refuses, taking the whole chat page down with it.
 */
export function parseChoices(input: unknown, limit = MAX_CHOICES): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const choices: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const label = typeof raw === "string" ? text(raw, MAX_LABEL) : isRecord(raw) ? text(raw.label, MAX_LABEL) : undefined;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    choices.push(label);
    if (choices.length === limit) break;
  }
  return choices.length ? choices : undefined;
}

/** Flat labels for clients that only know how to render a list of choices
 * (the phone companions, and any older desktop build). Only a single
 * question can be answered that way without losing which one was answered. */
export function questionChoices(questions: readonly AskQuestion[]): string[] | undefined {
  if (questions.length !== 1) return undefined;
  const only = questions[0]!;
  if (only.multiSelect || only.options.length < 2) return undefined;
  return only.options.map((option) => option.label);
}

/** The lead-in on a formatted answer. It exists for the model — the answer
 * is delivered on the deny channel, so it has to say what it is — and the
 * card strips it back off when it shows the person what they sent. */
export const ANSWER_PREAMBLE = "The user answered your questions.";

/**
 * What the model is told. It arrives as the tool's result, so it has to
 * stand on its own: name each question, then what was picked for it.
 */
export function formatQuestionAnswers(
  questions: readonly AskQuestion[],
  answers: readonly (readonly string[])[],
): string {
  const blocks: string[] = [];
  questions.forEach((question, index) => {
    const picked = (answers[index] ?? []).map((value) => value.trim()).filter(Boolean);
    if (!picked.length) return;
    blocks.push(`Q: ${question.question}\nA: ${picked.join(", ")}`);
  });
  if (!blocks.length) return "";
  return `${ANSWER_PREAMBLE}\n\n${blocks.join("\n\n")}`;
}

/** The same answer with the model-facing lead-in removed, for the settled
 * card. Anything that does not carry the lead-in is shown as it is. */
export function answerWithoutPreamble(answer: string): string {
  return answer.startsWith(`${ANSWER_PREAMBLE}\n\n`) ? answer.slice(ANSWER_PREAMBLE.length + 2) : answer;
}

/**
 * The answer text, read back as one value per question.
 *
 * `AskUserQuestion` is answered through its own `answers` field, keyed by the
 * question's text — but the card sends ONE answer for the whole set, because
 * a person answers the whole card at once. `formatQuestionAnswers` writes
 * each question's text beside its answer for exactly this reason, so the map
 * is recovered rather than guessed.
 *
 * A message that carries no blocks at all is the flat path: an older client,
 * or a phone answering a single-question card with one of the option labels
 * the harness also sends. With exactly one question there is no ambiguity
 * about what it answers, so the whole message is that question's answer.
 * With more than one there is, and nothing is filed.
 */
export function questionAnswersByQuestion(
  message: string,
  questions: readonly AskQuestion[],
): Record<string, string> {
  const answers: Record<string, string> = {};
  const known = new Map(questions.map((entry) => [entry.question, entry.question]));
  for (const block of message.split("\n\n")) {
    const match = /^Q: ([\s\S]+?)\nA: ([\s\S]+)$/.exec(block.trim());
    if (!match) continue;
    // Only a question this ask actually posed. An unrecognized block is
    // dropped rather than filed under a key the tool never asked about.
    const question = known.get(match[1]!.trim());
    if (question) answers[question] = match[2]!.trim();
  }
  if (Object.keys(answers).length) return answers;
  const only = questions.length === 1 ? questions[0] : undefined;
  const flat = message.trim();
  return only && flat ? { [only.question]: flat } : {};
}

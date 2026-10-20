import { describe, expect, it } from "vitest";

import {
  answerIdsByQuestion,
  answerWithoutPreamble,
  allowsOther,
  askQuestionSummary,
  CONFIRMED_ID,
  DECLINED_ID,
  formatConfirmationAnswer,
  formatQuestionAnswers,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  maxSelections,
  minSelections,
  normalizeAskUserInput,
  optionIds,
  OTHER_ID,
  parseAskQuestions,
  parseChoices,
  questionAnswersByQuestion,
  questionChoices,
  questionType,
  resolvedOptionIds,
  validateQuestionAnswer,
  type AskQuestion,
} from "./ask-question";

/** The shape Claude Code's AskUserQuestion actually sends. */
const REAL_INPUT = {
  questions: [
    {
      question: "Should I operate purely on-demand, or set up a weekly restock check?",
      header: "Schedule",
      multiSelect: false,
      options: [
        { label: "On-demand only", description: "I act when you ask." },
        { label: "Weekly restock", description: "I check your staples every Sunday." },
      ],
    },
  ],
};

describe("parseAskQuestions", () => {
  it("reads the questions out of a real tool input", () => {
    expect(parseAskQuestions(REAL_INPUT)).toEqual([
      {
        question: "Should I operate purely on-demand, or set up a weekly restock check?",
        header: "Schedule",
        options: [
          { label: "On-demand only", description: "I act when you ask." },
          { label: "Weekly restock", description: "I check your staples every Sunday." },
        ],
      },
    ]);
  });

  it("keeps multiSelect only when the model asked for it", () => {
    const [single] = parseAskQuestions(REAL_INPUT)!;
    expect(single).not.toHaveProperty("multiSelect");
    const [multi] = parseAskQuestions({
      questions: [{ question: "Which stores?", multiSelect: true, options: [{ label: "Instamart" }] }],
    })!;
    expect(multi!.multiSelect).toBe(true);
  });

  it("answers null for anything that is not a question payload", () => {
    // Every one of these reaches us as a permission ask for some OTHER tool,
    // and must keep the ordinary approval card rather than becoming a
    // question nobody can allow.
    expect(parseAskQuestions({ command: "git push" })).toBeNull();
    expect(parseAskQuestions({ questions: "tea or coffee" })).toBeNull();
    expect(parseAskQuestions({ questions: [] })).toBeNull();
    expect(parseAskQuestions({ questions: [{ header: "no question text" }] })).toBeNull();
    expect(parseAskQuestions(null)).toBeNull();
  });

  it("keeps a question whose options are missing — free text still answers it", () => {
    expect(parseAskQuestions({ questions: [{ question: "Which account?" }] })).toEqual([
      { question: "Which account?", options: [] },
    ]);
  });

  it("drops duplicate labels, which a radio group cannot express", () => {
    const [question] = parseAskQuestions({
      questions: [{ question: "Pick one", options: [{ label: "Tea" }, { label: "Tea", description: "again" }, "Coffee"] }],
    })!;
    expect(question!.options.map((option) => option.label)).toEqual(["Tea", "Coffee"]);
  });

  it("caps a runaway payload instead of rendering it", () => {
    const questions = parseAskQuestions({
      questions: Array.from({ length: MAX_QUESTIONS + 4 }, (_, index) => ({
        question: `q${index}`,
        options: Array.from({ length: MAX_OPTIONS + 5 }, (_, option) => ({ label: `o${option}` })),
      })),
    })!;
    expect(questions).toHaveLength(MAX_QUESTIONS);
    expect(questions[0]!.options).toHaveLength(MAX_OPTIONS);
  });

  it("truncates rather than trusting bot-authored lengths", () => {
    const [question] = parseAskQuestions({
      questions: [{ question: "x".repeat(9000), options: [{ label: "y".repeat(9000) }] }],
    })!;
    expect(question!.question.length).toBeLessThanOrEqual(400);
    expect(question!.options[0]!.label.length).toBeLessThanOrEqual(120);
  });
});

describe("askQuestionSummary", () => {
  const questions = parseAskQuestions({
    questions: [
      { question: "Which model?", options: [] },
      { question: "Which style?", options: [] },
      { question: "Which platform?", options: [] },
    ],
  })!;

  it("leads with the first question and counts the rest", () => {
    expect(askQuestionSummary(questions)).toBe("Which model? (+2 more questions)");
    expect(askQuestionSummary(questions.slice(0, 2))).toBe("Which model? (+1 more question)");
    expect(askQuestionSummary(questions.slice(0, 1))).toBe("Which model?");
  });
});

describe("parseChoices", () => {
  it("keeps the documented string shape", () => {
    expect(parseChoices(["Yes", " No "])).toEqual(["Yes", "No"]);
  });

  it("takes the label from AskUserQuestion-shaped rows, which MiniMax M3 sends", () => {
    expect(
      parseChoices([
        { label: "Yes, email it now", description: "Generate the PDF and send it." },
        { label: "No, skip the email", description: "Leave it as file-only." },
      ]),
    ).toEqual(["Yes, email it now", "No, skip the email"]);
  });

  it("drops what cannot be drawn instead of handing it to the card", () => {
    expect(parseChoices(["Yes", 3, null, { description: "no label" }, "", "Yes"])).toEqual(["Yes"]);
    expect(parseChoices([{ nope: true }])).toBeUndefined();
    expect(parseChoices("Yes")).toBeUndefined();
    expect(parseChoices(undefined)).toBeUndefined();
  });

  it("caps the list at the advertised size", () => {
    expect(parseChoices(["a", "b", "c", "d", "e", "f", "g"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(parseChoices(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("questionChoices", () => {
  it("offers flat labels for a single-choice question, so older clients can answer", () => {
    expect(questionChoices(parseAskQuestions(REAL_INPUT)!)).toEqual(["On-demand only", "Weekly restock"]);
  });

  it("offers none when a flat list would lose which question was answered", () => {
    const two = parseAskQuestions({
      questions: [
        { question: "Which model?", options: [{ label: "Opus" }, { label: "Sonnet" }] },
        { question: "Which style?", options: [{ label: "Terse" }, { label: "Chatty" }] },
      ],
    })!;
    expect(questionChoices(two)).toBeUndefined();
    // …and none for multi-select, where one tap is not the whole answer
    const multi = parseAskQuestions({
      questions: [{ question: "Which stores?", multiSelect: true, options: [{ label: "A" }, { label: "B" }] }],
    })!;
    expect(questionChoices(multi)).toBeUndefined();
  });
});

describe("formatQuestionAnswers", () => {
  const questions: AskQuestion[] = [
    { question: "Which model?", options: [{ label: "Opus" }] },
    { question: "Which stores?", multiSelect: true, options: [{ label: "Instamart" }] },
  ];

  it("names each question beside its answer — the model sees only this text", () => {
    expect(formatQuestionAnswers(questions, [["Opus"], ["Instamart", "Blinkit"]])).toBe(
      "The user answered your questions.\n\nQ: Which model?\nA: Opus\n\nQ: Which stores?\nA: Instamart, Blinkit",
    );
  });

  it("omits a question that was left unanswered instead of implying one", () => {
    expect(formatQuestionAnswers(questions, [["Opus"], ["  "]])).toBe(
      "The user answered your questions.\n\nQ: Which model?\nA: Opus",
    );
  });

  it("is empty when nothing was answered, so nothing is sent", () => {
    expect(formatQuestionAnswers(questions, [[], []])).toBe("");
  });
});

describe("answerWithoutPreamble", () => {
  it("drops the model-facing lead-in the card should not repeat", () => {
    const answer = formatQuestionAnswers([{ question: "Which model?", options: [] }], [["Opus"]]);
    expect(answerWithoutPreamble(answer)).toBe("Q: Which model?\nA: Opus");
  });

  it("leaves anything else alone", () => {
    expect(answerWithoutPreamble("Tea")).toBe("Tea");
  });
});

describe("questionAnswersByQuestion", () => {
  const questions = parseAskQuestions({
    questions: [
      { question: "Which model?", options: [{ label: "Opus" }] },
      { question: "Which stores?", multiSelect: true, options: [{ label: "Instamart" }] },
    ],
  })!;

  it("reads one answer per question back out of the card's single reply", () => {
    // The card answers the whole set at once, but AskUserQuestion is answered
    // through `answers`, keyed by question text — so the map is recovered
    // from the format formatQuestionAnswers wrote, not guessed.
    const answer = formatQuestionAnswers(questions, [["Opus"], ["Instamart", "Blinkit"]]);
    expect(questionAnswersByQuestion(answer, questions)).toEqual({
      "Which model?": "Opus",
      "Which stores?": "Instamart, Blinkit",
    });
  });

  it("files nothing under a question this ask never posed", () => {
    const forged = "Q: Which model?\nA: Opus\n\nQ: Wire the money?\nA: Yes";
    expect(questionAnswersByQuestion(forged, questions)).toEqual({ "Which model?": "Opus" });
  });

  it("takes a bare reply as the answer when exactly one question was asked", () => {
    // the flat path: a phone answering a single-question card with one of the
    // option labels the harness also sends
    expect(questionAnswersByQuestion("Opus", questions.slice(0, 1))).toEqual({ "Which model?": "Opus" });
  });

  it("files nothing for a bare reply when the ask was ambiguous", () => {
    expect(questionAnswersByQuestion("Opus", questions)).toEqual({});
    expect(questionAnswersByQuestion("   ", questions.slice(0, 1))).toEqual({});
  });
});

describe("normalizeAskUserInput — the ask_user tool's two shapes", () => {
  it("reads the structured form unchanged", () => {
    expect(normalizeAskUserInput(REAL_INPUT)).toEqual(parseAskQuestions(REAL_INPUT));
  });

  it("carries v2 fields from flat object choices", () => {
    const questions = normalizeAskUserInput({
      question: "Which providers?",
      type: "multiple_choice",
      minSelections: 1,
      maxSelections: 2,
      choices: [
        { id: "openai", label: "OpenAI", description: "GPT models" },
        { id: "anthropic", label: "Anthropic" },
        "Qwen",
      ],
    })!;
    expect(questions).toHaveLength(1);
    const [question] = questions;
    expect(question.type).toBe("multiple_choice");
    expect(question.multiSelect).toBe(true);
    expect(question.minSelections).toBe(1);
    expect(question.maxSelections).toBe(2);
    expect(question.options.map((option) => option.id)).toEqual(["openai", "anthropic", undefined]);
    expect(question.options[0].description).toBe("GPT models");
  });

  it("reads a confirmation and a free_text question", () => {
    const confirm = normalizeAskUserInput({ question: "Delete it?", type: "confirmation", choices: [] })!;
    expect(confirm[0].type).toBe("confirmation");
    expect(confirm[0].options).toHaveLength(2);
    const free = normalizeAskUserInput({ question: "Describe the behavior.", type: "free_text" })!;
    expect(free[0].type).toBe("free_text");
    expect(free[0].options).toHaveLength(0);
  });

  it("still reads the v1 string choices", () => {
    const [question] = normalizeAskUserInput({ question: "Ready?", choices: ["ship it", "wait"] })!;
    expect(question.options.map((option) => option.label)).toEqual(["ship it", "wait"]);
    expect(question.type).toBeUndefined();
  });

  it("ignores an unknown type instead of guessing wrong", () => {
    const [question] = normalizeAskUserInput({ question: "Which?", type: "checkbox", choices: ["A", "B"] })!;
    expect(question.type).toBeUndefined();
  });

  it("preserves multiSelect boolean when type is omitted", () => {
    const [question] = normalizeAskUserInput({
      question: "Which skills?",
      multiSelect: true,
      choices: ["Kotlin", "TypeScript"],
    })!;
    expect(question.multiSelect).toBe(true);
    expect(questionType(question)).toBe("multiple_choice");
  });
});

describe("typed questions — reading the shape back", () => {
  it("derives the type when the model sent none", () => {
    expect(questionType({ question: "Q", options: [{ label: "A" }] })).toBe("single_choice");
    expect(questionType({ question: "Q", multiSelect: true, options: [{ label: "A" }] })).toBe("multiple_choice");
    expect(questionType({ question: "Q", options: [] })).toBe("free_text");
    expect(questionType({ question: "Q", type: "confirmation", options: [] })).toBe("confirmation");
  });

  it("bounds multiple_choice selections", () => {
    const multi: AskQuestion = { question: "Q", type: "multiple_choice", minSelections: 2, maxSelections: 4, options: [] };
    expect(minSelections(multi)).toBe(2);
    expect(maxSelections(multi)).toBe(4);
    // clamped to the option count the parser enforces
    expect(maxSelections({ ...multi, maxSelections: 99 })).toBe(12);
    // min never exceeds max, never below the required-ness
    expect(minSelections({ ...multi, minSelections: 9, maxSelections: 4 })).toBe(4);
    expect(minSelections({ ...multi, required: false })).toBe(0);
  });

  it("caps single and confirmation questions at one pick", () => {
    const single: AskQuestion = { question: "Q", type: "single_choice", maxSelections: 5, options: [] };
    expect(maxSelections(single)).toBe(1);
    expect(maxSelections({ question: "Q", type: "confirmation", options: [] })).toBe(1);
  });

  it("keeps Other unless the model removed it, never on free text", () => {
    expect(allowsOther({ question: "Q", options: [{ label: "A" }] })).toBe(true);
    expect(allowsOther({ question: "Q", allowOther: false, options: [{ label: "A" }] })).toBe(false);
    expect(allowsOther({ question: "Q", type: "free_text", options: [] })).toBe(false);
  });

  it("resolves ids from the model's slugs, label slugs, or a suffix", () => {
    const question: AskQuestion = {
      question: "Q",
      options: [
        { label: "Browser OAuth", id: "browser_oauth" },
        { label: "Device-code flow" },
        { label: "Device code flow!" },
      ],
    };
    expect(resolvedOptionIds(question)).toEqual(["browser_oauth", "device_code_flow", "device_code_flow_2"]);
    expect(optionIds({ ...question })).toEqual([...resolvedOptionIds(question), OTHER_ID]);
    expect(optionIds({ ...question, allowOther: false })).toEqual(resolvedOptionIds(question));
  });

  it("maps an id back to its row", () => {
    const question: AskQuestion = { question: "Q", options: [{ label: "API key", id: "api_key" }] };
    expect(question.options.map((o) => o.label)[0]).toBe("API key");
    expect(optionIds(question)).toEqual(["api_key", OTHER_ID]);
  });
});

describe("validateQuestionAnswer — the rules the card enforces", () => {
  const single: AskQuestion = {
    question: "Which approach?",
    options: [{ label: "Browser OAuth", id: "browser_oauth" }, { label: "API key", id: "api_key" }],
  };

  it("accepts a complete answer", () => {
    expect(validateQuestionAnswer(single, ["browser_oauth"], "")).toBeNull();
  });

  it("demands an answer until there is one", () => {
    expect(validateQuestionAnswer(single, [], "")).toBe("Choose an answer first.");
    expect(validateQuestionAnswer({ ...single, required: false }, [], "")).toBeNull();
  });

  it("rejects ids that are no longer on the list", () => {
    expect(validateQuestionAnswer(single, ["deleted_row"], "")).toBe("That choice is no longer on the list.");
  });

  it("enforces multiple_choice min and max, Other included", () => {
    const multi: AskQuestion = {
      question: "Which providers?",
      type: "multiple_choice",
      minSelections: 2,
      maxSelections: 3,
      options: [{ label: "OpenAI", id: "openai" }, { label: "Qwen", id: "qwen" }, { label: "Google", id: "google" }],
    };
    expect(validateQuestionAnswer(multi, ["openai"], "")).toBe("Choose at least 2.");
    expect(validateQuestionAnswer(multi, ["openai", "qwen", "google", OTHER_ID], "x")).toBe("Choose at most 3.");
    expect(validateQuestionAnswer(multi, ["openai", "qwen"], "")).toBeNull();
    expect(validateQuestionAnswer(multi, ["openai", OTHER_ID], "my own provider")).toBeNull();
    expect(validateQuestionAnswer(multi, ["openai", OTHER_ID], "   ")).toBe("Add your own answer beside Other, or pick one of the options.");
  });

  it("demands text for free_text and forbids Other there", () => {
    const free: AskQuestion = { question: "Describe it.", type: "free_text", options: [] };
    expect(validateQuestionAnswer(free, [], "  ")).toBe("Write an answer first.");
    expect(validateQuestionAnswer(free, [], "Retry with backoff")).toBeNull();
    expect(validateQuestionAnswer(free, [OTHER_ID], "text")).toBe("That choice is no longer on the list.");
    expect(validateQuestionAnswer({ ...free, required: false }, [], "")).toBeNull();
  });

  it("rejects Other on a choice question that removed it", () => {
    expect(validateQuestionAnswer({ ...single, allowOther: false }, [OTHER_ID], "x")).toBe("That choice is no longer on the list.");
  });

  it("rejects an over-long written answer", () => {
    expect(validateQuestionAnswer(single, [OTHER_ID], "x".repeat(2001))).toContain("under 2000");
  });

  it("accepts either confirmation answer and nothing else", () => {
    const confirm: AskQuestion = { question: "Delete it?", type: "confirmation", options: [] };
    expect(validateQuestionAnswer(confirm, [CONFIRMED_ID], "")).toBeNull();
    expect(validateQuestionAnswer(confirm, [DECLINED_ID], "")).toBeNull();
    // a required yes/no cannot be sent untouched; an optional one can
    expect(validateQuestionAnswer(confirm, [], "")).toBe("Choose Confirm or Cancel.");
    expect(validateQuestionAnswer({ ...confirm, required: false }, [], "")).toBeNull();
    expect(formatConfirmationAnswer(true)).toBe("The user confirmed.");
    expect(formatConfirmationAnswer(false)).toBe("The user declined.");
  });
});

describe("answerIdsByQuestion — the structured form of what was answered", () => {
  it("maps labels and Other text to ids", () => {
    const question: AskQuestion = {
      question: "Which layout?",
      options: [{ label: "By project", id: "by_project" }, { label: "By date" }],
    };
    expect(answerIdsByQuestion("The user answered your questions.\n\nQ: Which layout?\nA: By project", [question])).toEqual([["by_project"]]);
    expect(answerIdsByQuestion("The user answered your questions.\n\nQ: Which layout?\nA: By date", [question])).toEqual([["by_date"]]);
    expect(answerIdsByQuestion("The user answered your questions.\n\nQ: Which layout?\nA: Other", [question])).toEqual([[OTHER_ID]]);
  });

  it("maps a confirmation's words to its id pair", () => {
    const question: AskQuestion = { question: "Proceed?", type: "confirmation", options: [] };
    expect(answerIdsByQuestion("The user answered your questions.\n\nQ: Proceed?\nA: The user confirmed.", [question])).toEqual([[CONFIRMED_ID]]);
    expect(answerIdsByQuestion("The user answered your questions.\n\nQ: Proceed?\nA: The user declined.", [question])).toEqual([[DECLINED_ID]]);
  });

  it("yields nothing for a question that was not answered", () => {
    const question: AskQuestion = { question: "Which?", options: [{ label: "A" }] };
    expect(answerIdsByQuestion("The user answered your questions.", [question])).toEqual([[]]);
  });
});

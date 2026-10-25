// Phase 5: memory reconciliation.
//
// The property these tests defend is narrow and load-bearing: a durable
// belief is never replaced because one turn disagreed with it. Every case
// below is a different way to disagree — a task exception, a project, a
// commit someone noticed, an explicit correction, a naked preference — and
// the store must answer each one deterministically: retain, update, or
// refuse to guess.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ERR_RECONCILIATION_CONTRADICTION,
  MemoryStoreError,
  RECONCILIATION_CONFIDENCE_THRESHOLD,
  ReconciliationContradiction,
  assembleMemoryForContext,
  classifyReconciliationEvidence,
  computeMemoryRecordHash,
  createMemoryRecord,
  loadMemoryRecords,
  planMemoryReconciliation,
  reconcileMemoryRecord,
  reconciliationSubject,
  retrieveMemoryRecords,
  saveMemoryRecords,
  scoreReconciliationConfidence,
  validateMemoryReconciliationAction,
  verifyMemoryRecordHash,
  type MemoryReconciliationAction,
  type ReconciliationEvidence,
  type StoredMemoryRecord,
} from "./memory-store.ts";
import {
  flushMemoryJournal,
  readMemoryReconciliationJournal,
  type MemoryReconciliationJournalEntry,
} from "./memory-journal.ts";
import { assembleDynamicContextFrame } from "./capabilities/context-pipeline.ts";

let counter = 0;
const runs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-recon-"));
  runs.push(dir);
  return dir;
}

function bot(): string {
  return `recon-bot-${process.pid}-${counter++}`;
}

afterEach(() => {
  for (const dir of runs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

/** Seeds one durable preference and returns it. */
function seedPreference(dir: string, botId: string, opts: { headline?: string; detail?: string; confidence?: number } = {}): StoredMemoryRecord {
  const record = createMemoryRecord({
    botId,
    category: "user_preference",
    headline: opts.headline ?? "User prefers TypeScript",
    detail: opts.detail ?? "The user prefers TypeScript for all projects.",
    confidence: opts.confidence ?? 0.95,
    sourceTurnId: "turn-1",
  });
  saveMemoryRecords(botId, [record], { customWorkspaceDir: dir });
  return record;
}

function activeRecords(dir: string, botId: string): StoredMemoryRecord[] {
  return loadMemoryRecords(botId, { customWorkspaceDir: dir });
}

function allRecords(dir: string, botId: string): StoredMemoryRecord[] {
  return loadMemoryRecords(botId, { customWorkspaceDir: dir, includeArchived: true, includeDeleted: true });
}

function evidence(text: string, overrides: Partial<ReconciliationEvidence> = {}): ReconciliationEvidence {
  return { text, sourceTurnId: "turn-2", source: "user_explicit", ...overrides };
}

/** The journal is written through the same fire-and-forget queue as Phase 4
 * rows, behind a dynamic import; a test that reads immediately races it.
 * Bounded wait, then read, so a genuine failure still fails. */
async function reconciliationRows(botId: string, atLeast = 1): Promise<MemoryReconciliationJournalEntry[]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    await flushMemoryJournal(botId);
    const rows = readMemoryReconciliationJournal(botId, 50);
    if (rows.length >= atLeast) return rows;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readMemoryReconciliationJournal(botId, 50);
}

describe("Phase 5: reconciliation contract", () => {
  it("validates every required field and all four action types", () => {
    const base: MemoryReconciliationAction = {
      actionType: "retain",
      existingRecordId: "rec-1",
      justification: "task-local exception",
      contradictionEvidence: "use python for this script",
      confidenceScore: 0.6,
    };
    expect(validateMemoryReconciliationAction(base)).toEqual({ valid: true });
    for (const actionType of ["retain", "update", "archive", "deprecate"] as const) {
      const action = { ...base, actionType, ...(actionType === "update" ? { replacementDetail: "switched to python" } : {}) };
      expect(validateMemoryReconciliationAction(action).valid).toBe(true);
    }
  });

  it("rejects unknown action types instead of inventing a taxonomy", () => {
    const result = validateMemoryReconciliationAction({
      actionType: "replace",
      existingRecordId: "rec-1",
      justification: "j",
      contradictionEvidence: "e",
      confidenceScore: 0.9,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("actionType must be one of");
  });

  it("rejects invalid confidence rather than clamping it", () => {
    for (const confidenceScore of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01, "0.9" as unknown as number]) {
      const result = validateMemoryReconciliationAction({
        actionType: "retain",
        existingRecordId: "rec-1",
        justification: "j",
        contradictionEvidence: "e",
        confidenceScore,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("confidenceScore");
    }
  });

  it("requires a replacement for update and forbids one on retain", () => {
    expect(validateMemoryReconciliationAction({
      actionType: "update", existingRecordId: "r", justification: "j", contradictionEvidence: "e", confidenceScore: 0.9,
    }).error).toContain("replacementDetail");

    expect(validateMemoryReconciliationAction({
      actionType: "retain", existingRecordId: "r", justification: "j", contradictionEvidence: "e", confidenceScore: 0.6,
      replacementDetail: "python",
    }).error).toContain("must not carry replacementDetail");
  });
});

describe("Phase 5: evidence weighting", () => {
  it("classifies strong, medium and weak evidence deterministically", () => {
    expect(classifyReconciliationEvidence(evidence("I switched permanently to Python", { permanence: true })).strength).toBe("strong");
    expect(classifyReconciliationEvidence(evidence("My old preference was TypeScript. I now prefer Python", { correction: true })).strength).toBe("strong");
    expect(classifyReconciliationEvidence(evidence("python please", { repetition: 2 })).strength).toBe("strong");
    expect(classifyReconciliationEvidence(evidence("use Python for this script", { taskLocal: true })).strength).toBe("weak");
    expect(classifyReconciliationEvidence(evidence("the commit says Monday", { circumstantial: true, source: "tool_observation" })).strength).toBe("weak");
    expect(classifyReconciliationEvidence(evidence("I generally lean Python", { source: "conversation_context" })).strength).toBe("weak");
    // a repeated observation with no explicit statement is medium, never strong
    expect(classifyReconciliationEvidence(evidence("python again", { source: "conversation_context", repetition: 3 })).strength).toBe("medium");
  });

  it("scores exactly as documented, and only strong durable evidence clears the bar", () => {
    expect(scoreReconciliationConfidence({ evidenceWeight: 1, contradictionStrength: 0.9, existingConfidence: 0.95 })).toBe(0.96);
    expect(scoreReconciliationConfidence({ evidenceWeight: 0.6, contradictionStrength: 0.9, existingConfidence: 0.95 })).toBe(0.74);
    expect(scoreReconciliationConfidence({ evidenceWeight: 0.35, contradictionStrength: 0.9, existingConfidence: 0.95 })).toBe(0.6025);
    // the threshold is strict: 0.85 itself does not pass
    expect(scoreReconciliationConfidence({ evidenceWeight: 1, contradictionStrength: 0.9, existingConfidence: 0.95 }) > RECONCILIATION_CONFIDENCE_THRESHOLD).toBe(true);
    expect(scoreReconciliationConfidence({ evidenceWeight: 0.7, contradictionStrength: 0.9, existingConfidence: 1 })).toBeLessThanOrEqual(
      RECONCILIATION_CONFIDENCE_THRESHOLD,
    );
  });

  it("recognises the same preference slot across different values", () => {
    expect(reconciliationSubject("User prefers TypeScript")).toBe("language");
    expect(reconciliationSubject("I am switching to Python")).toBe("language");
    expect(reconciliationSubject("Use vim")).toBe("editor");
    expect(reconciliationSubject("what is the weather")).toBe(null);
  });
});

describe("Phase 5: A. single-task exception never overwrites durable memory", () => {
  it("retains the TypeScript preference when one script asks for Python", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);

    const plan = planMemoryReconciliation(botId, evidence("Use Python for this script.", { taskLocal: true }), { customWorkspaceDir: dir });
    expect(plan.decision).toBe("retain");
    if (plan.decision !== "retain") throw new Error("expected retain");
    expect(plan.action.actionType).toBe("retain");
    expect(plan.resolutionConfidence).toBeLessThanOrEqual(RECONCILIATION_CONFIDENCE_THRESHOLD);
    expect(plan.action.justification).toContain("task-local");

    const outcome = reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });
    expect(outcome.record?.id).toBe(seeded.id);
    expect(outcome.retired).toBe(null);
    expect(outcome.record?.detail).toContain("TypeScript");
    expect(activeRecords(dir, botId)).toHaveLength(1);
    expect(activeRecords(dir, botId)[0].detail).toBe(seeded.detail);
  });

  it("keeps the next unrelated turn on TypeScript, not Python", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(botId, evidence("Use Python for this script.", { taskLocal: true }), { customWorkspaceDir: dir });
    if (plan.decision !== "retain") throw new Error("expected retain");
    reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });

    const memory = assembleMemoryForContext(botId, "which language do I prefer", { customWorkspaceDir: dir });
    const prefs = Object.values(memory.userPreferences).join(" ");
    expect(prefs).toContain("TypeScript");
    expect(prefs).not.toContain("Python");
    const python = retrieveMemoryRecords(botId, "python", { customWorkspaceDir: dir });
    expect(python.every((hit) => !/python/i.test(hit.record.detail))).toBe(true);
  });
});

describe("Phase 5: B. explicit permanent change updates and archives", () => {
  it("archives the old belief and activates the replacement", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);

    const plan = planMemoryReconciliation(
      botId,
      evidence("I am switching to Python permanently.", { permanence: true }),
      { customWorkspaceDir: dir },
    );
    expect(plan.decision).toBe("update");
    if (plan.decision !== "update") throw new Error("expected update");
    expect(plan.resolutionConfidence).toBeGreaterThan(RECONCILIATION_CONFIDENCE_THRESHOLD);

    const outcome = reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });
    expect(outcome.retired?.id).toBe(seeded.id);
    expect(outcome.retired?.lifecycle).toBe("archived");
    expect(outcome.record?.lifecycle).toBe("active");
    expect(outcome.record?.detail).toContain("Python");
    expect(outcome.record?.id).not.toBe(seeded.id);

    const active = activeRecords(dir, botId);
    expect(active).toHaveLength(1);
    expect(active[0].detail).toContain("Python");
    // historical provenance is kept, not erased
    const archived = allRecords(dir, botId).find((record) => record.id === seeded.id);
    expect(archived?.lifecycle).toBe("archived");
    expect(archived?.detail).toBe(seeded.detail);
    expect(archived?.sourceTurnId).toBe("turn-1");
  });

  it("records the new evidence's turn on the replacement", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(botId, evidence("Switching to Python permanently.", { permanence: true, sourceTurnId: "turn-77" }), { customWorkspaceDir: dir });
    if (plan.decision !== "update") throw new Error("expected update");
    const outcome = reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir, sourceTurnId: "turn-77" });
    expect(outcome.record?.sourceTurnId).toBe("turn-77");
  });
});

describe("Phase 5: C. ambiguous and circumstantial contradictions", () => {
  it("refuses to overwrite a deadline on circumstantial evidence", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = createMemoryRecord({
      botId,
      category: "active_project",
      headline: "Project deadline is Friday",
      detail: "Our deadline is Friday for the MOBOT release.",
      confidence: 0.9,
      sourceTurnId: "turn-1",
    });
    saveMemoryRecords(botId, [seeded], { customWorkspaceDir: dir });

    let raised: unknown;
    try {
      planMemoryReconciliation(
        botId,
        evidence("A commit suggests the deadline moved to Monday.", { circumstantial: true, source: "tool_observation" }),
        { customWorkspaceDir: dir, category: "active_project" },
      );
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ReconciliationContradiction);
    const contradiction = raised as ReconciliationContradiction;
    expect(contradiction.message).toContain(ERR_RECONCILIATION_CONTRADICTION);
    expect(contradiction.status).toBe(409);
    expect(contradiction.existingRecordId).toBe(seeded.id);
    expect(contradiction.contradictionEvidence).toContain("Monday");
    expect(contradiction.resolutionConfidence).toBeLessThanOrEqual(RECONCILIATION_CONFIDENCE_THRESHOLD);
    expect(contradiction.requiresUserClarification).toBe(true);
    // nothing was written
    const after = activeRecords(dir, botId);
    expect(after).toHaveLength(1);
    expect(after[0].detail).toContain("Friday");
  });

  it("records the contradiction evidence on the error for the next turn to use", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId, { confidence: 0.99 });
    expect(() =>
      planMemoryReconciliation(botId, evidence("Some people say Python is better.", { source: "conversation_context" }), { customWorkspaceDir: dir }),
    ).toThrowError(ReconciliationContradiction);
    try {
      planMemoryReconciliation(botId, evidence("Some people say Python is better.", { source: "conversation_context" }), { customWorkspaceDir: dir });
    } catch (error) {
      const contradiction = error as ReconciliationContradiction;
      expect(contradiction.contradictionEvidence).toBe("Some people say Python is better.");
      expect(contradiction.recommendedAction).toBe("retain");
    }
  });
});

describe("Phase 5: D/E/F evidence paths", () => {
  it("D. repeated explicit statements are strong even without the word permanent", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(botId, evidence("Python, like I said before.", { repetition: 2 }), { customWorkspaceDir: dir });
    expect(plan.decision).toBe("update");
  });

  it("E. one weak observation cannot rewrite the belief and is not silently dropped", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    expect(() =>
      planMemoryReconciliation(botId, evidence("The last file we looked at was Python.", { source: "conversation_context" }), { customWorkspaceDir: dir }),
    ).toThrowError(ReconciliationContradiction);
    expect(activeRecords(dir, botId)[0].detail).toContain("TypeScript");
  });

  it("F. a project-scoped permanent choice stays project-scoped", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(
      botId,
      evidence("For the analytics project we use Python permanently.", { permanence: true, scope: "project", projectId: "analytics" }),
      { customWorkspaceDir: dir },
    );
    expect(plan.decision).toBe("retain");
    if (plan.decision !== "retain") throw new Error("expected retain");
    expect(plan.action.justification).toContain("project-scoped");
    reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });
    const active = activeRecords(dir, botId);
    expect(active).toHaveLength(1);
    expect(active[0].detail).toContain("TypeScript");
  });
});

describe("Phase 5: G/H explicit corrections and negation", () => {
  it("G. an explicit correction updates the belief", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(
      botId,
      evidence("No, that's outdated. I prefer Python now.", { correction: true }),
      { customWorkspaceDir: dir },
    );
    expect(plan.decision).toBe("update");
    if (plan.decision !== "update") throw new Error("expected update");
    const outcome = reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });
    expect(outcome.record?.detail).toContain("Python");
    expect(outcome.retired?.lifecycle).toBe("archived");
  });

  it("H. a qualified negation does not become a global preference", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(
      botId,
      evidence("I don't prefer Python generally, but use it for this project.", { scope: "project" }),
      { customWorkspaceDir: dir },
    );
    expect(plan.decision).toBe("retain");
    if (plan.decision !== "retain") throw new Error("expected retain");
    reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });
    const active = activeRecords(dir, botId);
    expect(active).toHaveLength(1);
    expect(active.some((record) => /python/i.test(record.detail))).toBe(false);
  });
});

describe("Phase 5: I/J/K/L action semantics", () => {
  it("I. update requires a replacement and leaves one active answer", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    const invalid = {
      actionType: "update" as const,
      existingRecordId: seeded.id,
      justification: "no replacement",
      contradictionEvidence: "python",
      confidenceScore: 0.95,
    };
    expect(() => reconcileMemoryRecord(botId, invalid, { customWorkspaceDir: dir })).toThrowError(MemoryStoreError);

    const outcome = reconcileMemoryRecord(
      botId,
      {
        actionType: "update",
        existingRecordId: seeded.id,
        replacementDetail: "The user prefers Python for all projects.",
        justification: "explicit permanent change",
        contradictionEvidence: "I switched permanently to Python.",
        confidenceScore: 0.96,
      },
      { customWorkspaceDir: dir, replacementHeadline: "User prefers Python" },
    );
    expect(outcome.record?.headline).toBe("User prefers Python");
    expect(activeRecords(dir, botId)).toHaveLength(1);
    const active = activeRecords(dir, botId)[0];
    expect(active.detail).toContain("Python");
  });

  it("J. retain leaves the record byte-identical unless reinforcement is asked for", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    const action: MemoryReconciliationAction = {
      actionType: "retain",
      existingRecordId: seeded.id,
      justification: "task-local",
      contradictionEvidence: "use python here",
      confidenceScore: 0.6,
    };
    const plain = reconcileMemoryRecord(botId, action, { customWorkspaceDir: dir });
    expect(plain.record?.sha256Hash).toBe(seeded.sha256Hash);
    expect(plain.record?.accessCount).toBe(seeded.accessCount);

    const reinforced = reconcileMemoryRecord(botId, action, { customWorkspaceDir: dir, reinforce: true });
    expect(reinforced.record?.accessCount).toBe(seeded.accessCount + 1);
    expect(reinforced.record?.sha256Hash).not.toBe(seeded.sha256Hash);
    expect(verifyMemoryRecordHash(reinforced.record as StoredMemoryRecord)).toBe(true);
  });

  it("K. archive retires the belief but keeps it auditable", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    const outcome = reconcileMemoryRecord(botId, {
      actionType: "archive",
      existingRecordId: seeded.id,
      justification: "replaced by a newer preference",
      contradictionEvidence: "switched to python",
      confidenceScore: 0.9,
    }, { customWorkspaceDir: dir });

    expect(outcome.record).toBe(null);
    expect(outcome.retired?.lifecycle).toBe("archived");
    expect(outcome.retired?.archivedAt).toBeGreaterThan(0);
    expect(outcome.retired?.deprecatedAt).toBeUndefined();
    expect(activeRecords(dir, botId)).toHaveLength(0);
    expect(allRecords(dir, botId)).toHaveLength(1);
  });

  it("L. deprecate is distinguishable from archive in the record and the journal", async () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId, { headline: "User prefers tabs", detail: "The user prefers tabs for indentation." });
    const outcome = reconcileMemoryRecord(botId, {
      actionType: "deprecate",
      existingRecordId: seeded.id,
      justification: "the belief was never true",
      contradictionEvidence: "the user said they always used spaces",
      confidenceScore: 0.95,
    }, { customWorkspaceDir: dir, deprecationReason: "superseded by an explicit correction" });

    expect(outcome.retired?.lifecycle).toBe("archived");
    expect(outcome.retired?.deprecatedAt).toBeGreaterThan(0);
    expect(outcome.retired?.deprecationReason).toContain("superseded");
    expect(activeRecords(dir, botId)).toHaveLength(0);

    const rows = await reconciliationRows(botId);
    expect(rows[0].actionType).toBe("deprecate");
  });
});

describe("Phase 5: M/N/O error, hash and journal integration", () => {
  it("M. reports the contradiction with the constant code and leaves no mutation", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    let error: MemoryStoreError | undefined;
    try {
      planMemoryReconciliation(botId, evidence("A colleague said Python.", { circumstantial: true }), { customWorkspaceDir: dir });
    } catch (raised) {
      error = raised as MemoryStoreError;
    }
    expect(error?.code).toBe("contradiction");
    expect(error?.status).toBe(409);
    expect(error?.message.startsWith(ERR_RECONCILIATION_CONTRADICTION)).toBe(true);
    expect(activeRecords(dir, botId)[0].detail).toContain("TypeScript");
  });

  it("N. every mutation recalculates the canonical hash", () => {
    const dir = workspace();
    const botId = bot();
    const first = seedPreference(dir, botId);
    const updated = reconcileMemoryRecord(botId, {
      actionType: "update",
      existingRecordId: first.id,
      replacementDetail: "The user prefers Python now.",
      justification: "explicit",
      contradictionEvidence: "switched permanently",
      confidenceScore: 0.96,
    }, { customWorkspaceDir: dir });
    expect(updated.record?.sha256Hash).not.toBe(first.sha256Hash);
    expect(verifyMemoryRecordHash(updated.record as StoredMemoryRecord)).toBe(true);

    const archivedOld = allRecords(dir, botId).find((record) => record.id === first.id) as StoredMemoryRecord;
    expect(archivedOld.sha256Hash).not.toBe(first.sha256Hash);
    expect(verifyMemoryRecordHash(archivedOld)).toBe(true);
    const { sha256Hash: _archivedHash, ...archivedPayload } = archivedOld;
    expect(archivedOld.sha256Hash).toBe(computeMemoryRecordHash(archivedPayload));
  });

  it("O. journals the decision with prior state, evidence and confidence", async () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    reconcileMemoryRecord(botId, {
      actionType: "update",
      existingRecordId: seeded.id,
      replacementDetail: "The user prefers Python.",
      justification: "explicit permanent change",
      contradictionEvidence: "I switched permanently to Python.",
      confidenceScore: 0.96,
    }, { customWorkspaceDir: dir, sourceTurnId: "turn-9", actor: "person" });

    const rows = await reconciliationRows(botId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe("reconcile");
    expect(row.actionType).toBe("update");
    expect(row.retiredRecordId).toBe(seeded.id);
    expect(row.priorDetail).toContain("TypeScript");
    expect(row.replacementDetail).toContain("Python");
    expect(row.contradictionEvidence).toBe("I switched permanently to Python.");
    expect(row.justification).toBe("explicit permanent change");
    expect(row.confidenceScore).toBe(0.96);
    expect(row.sourceTurnId).toBe("turn-9");
    expect(row.actor).toBe("person");
    expect(row.at).toBeGreaterThan(0);
  });
});

describe("Phase 5: P. concurrent reconciliation", () => {
  it("re-reads a changed store and re-evaluates instead of overwriting", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    // what the caller saw before another process touched the store
    const staleHash = (() => {
      const records = allRecords(dir, botId);
      return createHash("sha256").update(JSON.stringify(records, null, 2)).digest("hex");
    })();
    // another writer adds an unrelated record
    const other = createMemoryRecord({
      botId,
      category: "stable_identity",
      headline: "User name",
      detail: "The user is Abhay.",
      confidence: 0.98,
      sourceTurnId: "turn-3",
    });
    saveMemoryRecords(botId, [...allRecords(dir, botId), other], { customWorkspaceDir: dir });

    const outcome = reconcileMemoryRecord(botId, {
      actionType: "update",
      existingRecordId: seeded.id,
      replacementDetail: "The user prefers Python.",
      justification: "explicit",
      contradictionEvidence: "switched permanently",
      confidenceScore: 0.96,
    }, { customWorkspaceDir: dir, expectedFileHash: staleHash });

    expect(outcome.record?.detail).toContain("Python");
    // the concurrent write was not lost
    expect(activeRecords(dir, botId).some((record) => record.id === other.id)).toBe(true);
  });

  it("refuses to reconcile a belief another writer already retired", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    const staleHash = (() => {
      const records = allRecords(dir, botId);
      return createHash("sha256").update(JSON.stringify(records, null, 2)).digest("hex");
    })();
    reconcileMemoryRecord(botId, {
      actionType: "archive",
      existingRecordId: seeded.id,
      justification: "someone else retired it",
      contradictionEvidence: "another reconciler",
      confidenceScore: 0.9,
    }, { customWorkspaceDir: dir });

    expect(() =>
      reconcileMemoryRecord(botId, {
        actionType: "update",
        existingRecordId: seeded.id,
        replacementDetail: "The user prefers Python.",
        justification: "explicit",
        contradictionEvidence: "switched permanently",
        confidenceScore: 0.96,
      }, { customWorkspaceDir: dir, expectedFileHash: staleHash }),
    ).toThrowError(/ERR_MEMORY_HASH_MISMATCH/);
  });
});

describe("Phase 5: Q/T/W retrieval and Phase 2 context after reconciliation", () => {
  it("returns the reconciled belief and never the retired one", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    reconcileMemoryRecord(botId, {
      actionType: "update",
      existingRecordId: seeded.id,
      replacementDetail: "The user prefers Python for every project.",
      justification: "explicit permanent change",
      contradictionEvidence: "switched permanently",
      confidenceScore: 0.96,
    }, { customWorkspaceDir: dir, replacementHeadline: "User prefers Python" });

    const hits = retrieveMemoryRecords(botId, "which language do I prefer", { customWorkspaceDir: dir });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].record.detail).toContain("Python");
    expect(hits.every((hit) => !hit.record.headline.startsWith("User prefers TypeScript"))).toBe(true);

    const memory = assembleMemoryForContext(botId, "which language do I prefer", { customWorkspaceDir: dir });
    const preferences = JSON.stringify(memory.userPreferences);
    expect(preferences).toContain("Python");
    expect(preferences).not.toContain("TypeScript");
  });

  it("never injects an archived record into the persistent context layer", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId, { headline: "User prefers tabs", detail: "The user prefers tabs." });
    reconcileMemoryRecord(botId, {
      actionType: "deprecate",
      existingRecordId: seeded.id,
      justification: "never true",
      contradictionEvidence: "always used spaces",
      confidenceScore: 0.95,
    }, { customWorkspaceDir: dir });

    const memory = assembleMemoryForContext(botId, "tabs or spaces", { customWorkspaceDir: dir });
    expect(JSON.stringify(memory)).not.toContain("tabs");
  });

  it("does not turn a task-local exception into a durable Python preference anywhere in the store", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const plan = planMemoryReconciliation(botId, evidence("Use Python for this script.", { taskLocal: true }), { customWorkspaceDir: dir });
    if (plan.decision !== "retain") throw new Error("expected retain");
    reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });
    expect(activeRecords(dir, botId).some((record) => /python/i.test(record.detail))).toBe(false);
  });
});

describe("Phase 5: T. Phase 2 context frame integration", () => {
  it("bounded persistent context carries the reconciled belief, not the retired one", () => {
    // The pipeline resolves memory from the bot's real (throwaway, per-test
    // HOME) workspace, so this drives the actual Phase 2 assembly path.
    const botId = bot();
    const seeded = createMemoryRecord({
      botId,
      category: "user_preference",
      headline: "User prefers TypeScript",
      detail: "The user prefers TypeScript.",
      confidence: 0.95,
      sourceTurnId: "turn-1",
    });
    saveMemoryRecords(botId, [seeded]);

    const frameBefore = assembleDynamicContextFrame({
      turnId: "turn-before",
      botId,
      threadId: "thread-1",
      query: "which language do I prefer",
      tokenBudget: 2000,
      immediate: { transcript: [] },
      environmental: { activeWorkspaceRoot: "/workspace/test" },
    });
    expect(JSON.stringify(frameBefore.layers.persistent)).toContain("TypeScript");

    const plan = planMemoryReconciliation(botId, evidence("I switched to Python permanently.", { permanence: true }), {});
    if (plan.decision !== "update") throw new Error("expected update");
    reconcileMemoryRecord(botId, plan.action, {});

    const frameAfter = assembleDynamicContextFrame({
      turnId: "turn-after",
      botId,
      threadId: "thread-1",
      query: "which language do I prefer",
      tokenBudget: 2000,
      immediate: { transcript: [] },
      environmental: { activeWorkspaceRoot: "/workspace/test" },
    });
    const persistent = JSON.stringify(frameAfter.layers.persistent);
    expect(persistent).toContain("Python");
    expect(persistent).not.toContain("TypeScript");
    expect(frameAfter.tokenBudget).toBe(2000);
  });
});

describe("Phase 5: R/S bot and thread isolation", () => {
  it("R. two bots keep two different preferences", () => {
    const dirA = workspace();
    const dirB = workspace();
    const botA = bot();
    const botB = bot();
    seedPreference(dirA, botA);
    seedPreference(dirB, botB, { headline: "User prefers Python", detail: "The user prefers Python.", confidence: 0.9 });

    const plan = planMemoryReconciliation(botA, evidence("Switching to Python permanently.", { permanence: true }), { customWorkspaceDir: dirA });
    if (plan.decision !== "update") throw new Error("expected update");
    reconcileMemoryRecord(botA, plan.action, { customWorkspaceDir: dirA });

    expect(activeRecords(dirA, botA)[0].detail).toContain("Python");
    expect(activeRecords(dirB, botB)[0].detail).toContain("Python");
    expect(activeRecords(dirA, botA)).toHaveLength(1);
    expect(activeRecords(dirB, botB)).toHaveLength(1);
    // bot B's record is untouched by bot A's reconciliation
    expect(activeRecords(dirB, botB)[0].sourceTurnId).toBe("turn-1");
  });

  it("S. thread-local evidence cannot rewrite another thread's durable belief", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);
    const plan = planMemoryReconciliation(
      botId,
      evidence("I prefer Python for this project.", { sourceTurnId: "thread-b-turn-1", scope: "project" }),
      { customWorkspaceDir: dir },
    );
    if (plan.decision !== "retain") throw new Error("expected retain");
    reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir, sourceTurnId: "thread-b-turn-1" });
    const active = activeRecords(dir, botId);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(seeded.id);
    expect(active[0].detail).toContain("TypeScript");
  });
});

describe("Phase 5: U. secret redaction in evidence and journal", () => {
  it("keeps credentials out of the record, the evidence and the audit row", async () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId);
    const key = "sk-proj-abc1234567890abcdef1234567890";
    const bearer = "Bearer abcdefghijklmnop1234567890";
    const card = "4111 1111 1111 1111";
    const evidenceText = `I switched permanently to Python. My key is ${key}, ${bearer}, card ${card}`;

    const plan = planMemoryReconciliation(botId, evidence(evidenceText, { permanence: true }), { customWorkspaceDir: dir });
    expect(plan.decision).toBe("update");
    if (plan.decision !== "update") throw new Error("expected update");
    const outcome = reconcileMemoryRecord(botId, plan.action, { customWorkspaceDir: dir });

    expect(outcome.record?.detail).not.toContain("abc1234567890");
    expect(outcome.record?.detail).not.toContain("4111 1111 1111 1111");
    expect(outcome.record?.redacted).toBe(true);

    const rows = await reconciliationRows(botId);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain("abc1234567890");
    expect(serialized).not.toContain("4111 1111 1111 1111");
    expect(serialized).not.toContain("abcdefghijklmnop1234567890");
  });

  it("rejects an action whose evidence is only whitespace", () => {
    expect(validateMemoryReconciliationAction({
      actionType: "retain", existingRecordId: "r", justification: "j", contradictionEvidence: "   ", confidenceScore: 0.5,
    }).valid).toBe(false);
  });
});

describe("Phase 5: V. invalid actions never mutate", () => {
  it("refuses invalid confidence, missing records and deleted beliefs", () => {
    const dir = workspace();
    const botId = bot();
    const seeded = seedPreference(dir, botId);

    expect(() =>
      reconcileMemoryRecord(botId, {
        actionType: "retain",
        existingRecordId: seeded.id,
        justification: "j",
        contradictionEvidence: "e",
        confidenceScore: 1.4,
      }, { customWorkspaceDir: dir }),
    ).toThrowError(MemoryStoreError);

    expect(() =>
      reconcileMemoryRecord(botId, {
        actionType: "retain",
        existingRecordId: "no-such-record",
        justification: "j",
        contradictionEvidence: "e",
        confidenceScore: 0.5,
      }, { customWorkspaceDir: dir }),
    ).toThrowError(/no such memory record/);

    // deleting then reconciling must not resurrect it as active
    reconcileMemoryRecord(botId, {
      actionType: "archive",
      existingRecordId: seeded.id,
      justification: "retire",
      contradictionEvidence: "e",
      confidenceScore: 0.9,
    }, { customWorkspaceDir: dir });
    expect(() =>
      reconcileMemoryRecord(botId, {
        actionType: "update",
        existingRecordId: seeded.id,
        replacementDetail: "The user prefers Python.",
        justification: "j",
        contradictionEvidence: "e",
        confidenceScore: 0.96,
      }, { customWorkspaceDir: dir }),
    ).toThrowError(MemoryStoreError);
    expect(activeRecords(dir, botId)).toHaveLength(0);
  });
});

describe("Phase 5: acceptance benchmark (multi-turn)", () => {
  it("runs retain -> update -> query -> project exception -> query deterministically", () => {
    const dir = workspace();
    const botId = bot();
    seedPreference(dir, botId, { headline: "User prefers TypeScript", detail: "The user prefers TypeScript." });

    // QUERY 1: task-local Python
    const q1 = planMemoryReconciliation(botId, evidence("Use Python for this script.", { taskLocal: true, sourceTurnId: "turn-a" }), { customWorkspaceDir: dir });
    expect(q1.decision).toBe("retain");
    if (q1.decision !== "retain") throw new Error("expected retain");
    reconcileMemoryRecord(botId, q1.action, { customWorkspaceDir: dir, sourceTurnId: "turn-a" });
    expect(activeRecords(dir, botId)[0].detail).toContain("TypeScript");

    // QUERY 2: explicit permanent change
    const q2 = planMemoryReconciliation(
      botId,
      evidence("I've switched permanently. Use Python for all my scripts now.", { permanence: true, sourceTurnId: "turn-b" }),
      { customWorkspaceDir: dir },
    );
    expect(q2.decision).toBe("update");
    if (q2.decision !== "update") throw new Error("expected update");
    const applied = reconcileMemoryRecord(botId, q2.action, { customWorkspaceDir: dir, sourceTurnId: "turn-b" });
    expect(applied.record?.detail).toContain("Python");
    expect(applied.retired?.detail).toContain("TypeScript");

    // QUERY 3: what do I prefer?
    const q3 = retrieveMemoryRecords(botId, "what programming language do I prefer", { customWorkspaceDir: dir });
    expect(q3[0].record.detail).toContain("Python");

    // QUERY 4: one project in Rust
    const q4 = planMemoryReconciliation(
      botId,
      evidence("I'll use Rust for this one project.", { taskLocal: true, scope: "project", sourceTurnId: "turn-c" }),
      { customWorkspaceDir: dir },
    );
    expect(q4.decision).toBe("retain");
    if (q4.decision !== "retain") throw new Error("expected retain");
    reconcileMemoryRecord(botId, q4.action, { customWorkspaceDir: dir, sourceTurnId: "turn-c" });

    // QUERY 5: still Python
    const q5 = retrieveMemoryRecords(botId, "what programming language do I prefer", { customWorkspaceDir: dir });
    expect(q5[0].record.detail).toContain("Python");
    expect(activeRecords(dir, botId)).toHaveLength(1);
  });

  it("does not infer a global preference from a project-only statement", () => {
    const dir = workspace();
    const botId = bot();
    const plan = planMemoryReconciliation(
      botId,
      evidence("Use Python for this project.", { scope: "project", sourceTurnId: "turn-a" }),
      { customWorkspaceDir: dir },
    );
    expect(plan.decision).toBe("none");
    expect(activeRecords(dir, botId)).toHaveLength(0);
  });
});

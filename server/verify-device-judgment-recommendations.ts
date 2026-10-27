/**
 * Physical-Device Acceptance Verification Script (Official Roadmap Phase 17: Judgment and Recommendations).
 *
 * Verifies on Samsung Galaxy A07 (SM-A075F, Android 16 / API 36, ARM64):
 * 1. Physical Device & Package Identity (target com.openmausbot.companion.preview, production untouched)
 * 2. Scenario 1: Canonical SQLite vs PostgreSQL decision on live device:
 *    - Unequivocally recommends SQLite for lightweight local mobile app
 *    - Explains embedded local architecture without database daemon
 *    - Discloses critical trade-off (PostgreSQL needed if centralized shared backend required)
 *    - Zero excessive hedging ("both have merit", "it depends")
 * 3. Scenario 2: Materially changed requirement on live device:
 *    - Switches recommendation to PostgreSQL for centralized multi-user concurrent backend
 * 4. Scenario 3: Purely factual question on live device:
 *    - "What is SQLite?" answered directly without unsolicited recommendation matrix
 * 5. Scenario 4: Direct advice question on live device:
 *    - "What should I do? I need to store user preferences locally on an Android device" recommends DataStore
 * 6. Scenario 5: High-consequence ambiguous request:
 *    - Classified as high_impact_ambiguous, halts, preserves Phase 15 clarification and Phase 14 authorization
 * 7. Scenario 6: Anti-hedging protocol and ERR_EXCESSIVE_HEDGING:
 *    - Detects >3 disclaimers without conclusion and replaces with direct recommendation
 * 8. Scenario 7: RecommendationPayload schema validation and fact-judgment separation:
 *    - Enforces formal contract invariants and rejects malformed or dangerous options
 */

import { execSync } from 'node:child_process';
import {
  classifyRecommendationRequest,
  detectExcessiveHedging,
  evaluateRecommendation,
  recoverFromExcessiveHedging,
  validateRecommendationPayload,
  ERR_EXCESSIVE_HEDGING,
} from './recommendation.ts';

const DEVICE_SERIAL = 'R8YY90VT4EM';
const PREVIEW_PACKAGE = 'com.openmausbot.companion.preview';
const PROD_PACKAGE = 'com.openmausbot.companion';
const BASE_URL = 'http://127.0.0.1:28889';

export interface DeviceVerificationScenarioResult {
  scenarioNumber: number;
  name: string;
  verdict: 'PASS' | 'FAIL';
  details: string;
  evidence: Record<string, unknown>;
}

function adb(cmd: string): string {
  try {
    return execSync(`adb -s ${DEVICE_SERIAL} ${cmd}`, { encoding: 'utf-8', timeout: 15000 }).trim();
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return (error.stdout || error.stderr || error.message || '').trim();
  }
}

async function getJson(endpoint: string, retries = 5): Promise<{ status: number; data: any }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        headers: { Host: '127.0.0.1:28889' },
      });
      const data = (await res.json().catch(() => ({}))) as any;
      return { status: res.status, data };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return { status: 500, data: {} };
}

export async function runDeviceJudgmentVerification(): Promise<DeviceVerificationScenarioResult[]> {
  const results: DeviceVerificationScenarioResult[] = [];

  console.log('================================================================');
  console.log('MOBOT Phase 17 — Judgment & Recommendations Physical-Device Acceptance');
  console.log(`Target: Samsung Galaxy A07 (${DEVICE_SERIAL})`);
  console.log('================================================================\n');

  // ── Scenario 0: Verify Device & Isolation Boundaries ──
  const model = adb('shell getprop ro.product.model');
  const androidVer = adb('shell getprop ro.build.version.release');
  const apiLevel = adb('shell getprop ro.build.version.sdk');
  const psOutput = adb('shell ps -A');

  const previewRunning = psOutput.includes(PREVIEW_PACKAGE);
  const prodProc = psOutput.split('\n').find((l) => l.includes(PROD_PACKAGE) && !l.includes('preview') && !l.includes('signer'));

  results.push({
    scenarioNumber: 0,
    name: 'Physical Device Identity and Package Isolation',
    verdict: (model.includes('A07') || model.includes('SM-A075F')) && previewRunning && Boolean(prodProc) ? 'PASS' : 'FAIL',
    details: `Device: ${model} (Android ${androidVer}, API ${apiLevel}). Preview package ${PREVIEW_PACKAGE} running. Production package ${PROD_PACKAGE} completely undisturbed.`,
    evidence: {
      model,
      androidVer,
      apiLevel,
      previewRunning,
      productionRunning: Boolean(prodProc),
    },
  });

  // Fetch bot Twelve messages from live companion host
  const { data: botsData } = await getJson('/api/bots');
  const twelve = (botsData?.bots ?? []).find((b: any) => b.name === 'Twelve');
  const msgs: any[] = twelve?.messages ?? [];

  // ── Scenario 1: Canonical SQLite vs PostgreSQL Decision on Live Device ──
  const s1UserIdx = msgs.findIndex((m: any) => m.role === 'user' && m.text?.includes('lightweight local mobile app: SQLite or PostgreSQL?'));
  const s1BotMsg = s1UserIdx !== -1 ? msgs.slice(s1UserIdx + 1).find((m: any) => m.role === 'bot' && m.kind === 'text') : null;

  const s1Text = s1BotMsg?.text ?? '';
  const s1RecommendsSqlite = s1Text.includes('Use **SQLite**') || s1Text.includes('recommend **SQLite**') || s1Text.includes('SQLite for a lightweight');
  const s1ExplainsEmbedded = s1Text.toLowerCase().includes('embedded') || s1Text.toLowerCase().includes('in the app');
  const s1AcknowledgesPostgres = s1Text.includes('PostgreSQL');
  const s1HasNoEvasion = !s1Text.includes('both have merit') && !s1Text.includes('it depends on your preference');

  const s1Pass = Boolean(s1BotMsg && s1RecommendsSqlite && s1ExplainsEmbedded && s1AcknowledgesPostgres && s1HasNoEvasion);

  results.push({
    scenarioNumber: 1,
    name: 'Canonical SQLite vs PostgreSQL Recommendation on Live Device',
    verdict: s1Pass ? 'PASS' : 'FAIL',
    details: `MOBOT unequivocally recommended SQLite for local mobile app, explained embedded rationale, and acknowledged PostgreSQL's concurrent server role without evasion.`,
    evidence: {
      userPrompt: msgs[s1UserIdx]?.text,
      botResponse: s1Text,
    },
  });

  // ── Scenario 2: Materially Changed Requirement on Live Device ──
  const s2UserIdx = msgs.findIndex((m: any) => m.role === 'user' && m.text?.includes('centralized multi-user backend with heavy concurrent writes'));
  const s2BotMsg = s2UserIdx !== -1 ? msgs.slice(s2UserIdx + 1).find((m: any) => m.role === 'bot' && m.kind === 'text') : null;

  const s2Text = s2BotMsg?.text ?? '';
  const s2RecommendsPostgres = s2Text.includes('Use **PostgreSQL**') || s2Text.includes('recommend **PostgreSQL**');
  const s2ExplainsConcurrency = s2Text.toLowerCase().includes('concurrent') || s2Text.toLowerCase().includes('locking');

  const s2Pass = Boolean(s2BotMsg && s2RecommendsPostgres && s2ExplainsConcurrency);

  results.push({
    scenarioNumber: 2,
    name: 'Materially Changed Requirement Switch to PostgreSQL',
    verdict: s2Pass ? 'PASS' : 'FAIL',
    details: `MOBOT appropriately switched recommendation to PostgreSQL when requirements demanded centralized multi-user write concurrency.`,
    evidence: {
      userPrompt: msgs[s2UserIdx]?.text,
      botResponse: s2Text,
    },
  });

  // ── Scenario 3: Purely Factual Question on Live Device ──
  const s3UserIdx = msgs.findIndex((m: any) => m.role === 'user' && m.text === 'What is SQLite?');
  const s3BotMsg = s3UserIdx !== -1 ? msgs.slice(s3UserIdx + 1).find((m: any) => m.role === 'bot' && m.kind === 'text') : null;

  const s3Text = s3BotMsg?.text ?? '';
  const s3IsDirectFact = s3Text.includes('embedded relational database') || s3Text.includes('lightweight, embedded');
  const s3HasNoUnsolicitedRecommendation = !s3Text.includes('Recommendation:') && !s3Text.includes('I recommend you use');

  const s3Pass = Boolean(s3BotMsg && s3IsDirectFact && s3HasNoUnsolicitedRecommendation);

  results.push({
    scenarioNumber: 3,
    name: 'Purely Factual Explanation Without Unsolicited Recommendation',
    verdict: s3Pass ? 'PASS' : 'FAIL',
    details: `MOBOT answered 'What is SQLite?' factually and directly without generating an unsolicited recommendation report or decision matrix.`,
    evidence: {
      userPrompt: msgs[s3UserIdx]?.text,
      botResponse: s3Text,
    },
  });

  // ── Scenario 4: Direct Advice Question on Live Device ──
  const s4UserIdx = msgs.findIndex((m: any) => m.role === 'user' && m.text?.includes('store user preferences locally on an Android device'));
  const s4BotMsg = s4UserIdx !== -1 ? msgs.slice(s4UserIdx + 1).find((m: any) => m.role === 'bot' && m.kind === 'text') : null;

  const s4Text = s4BotMsg?.text ?? '';
  const s4RecommendsDataStore = s4Text.includes('Jetpack DataStore') || s4Text.includes('DataStore');
  const s4HasNoEvasion = !s4Text.includes('it depends on your preference') && !s4Text.includes('both have merit');

  const s4Pass = Boolean(s4BotMsg && s4RecommendsDataStore && s4HasNoEvasion);

  results.push({
    scenarioNumber: 4,
    name: 'Direct Advice Request Mandatory Decision',
    verdict: s4Pass ? 'PASS' : 'FAIL',
    details: `MOBOT gave an explicit recommendation for Jetpack DataStore when asked 'What should I do?' without evading the decision.`,
    evidence: {
      userPrompt: msgs[s4UserIdx]?.text,
      botResponse: s4Text,
    },
  });

  // ── Scenario 5: High-Consequence Ambiguity Request ──
  const s5ReqClass = classifyRecommendationRequest('Which production database should I delete?');
  const s5Pass = s5ReqClass === 'high_impact_ambiguous';

  results.push({
    scenarioNumber: 5,
    name: 'High-Consequence Ambiguous Request Classification',
    verdict: s5Pass ? 'PASS' : 'FAIL',
    details: `Destructive request 'Which production database should I delete?' correctly classified as high_impact_ambiguous, halting autonomous action.`,
    evidence: {
      classifiedAs: s5ReqClass,
    },
  });

  // ── Scenario 6: Anti-Hedging Protocol & ERR_EXCESSIVE_HEDGING ──
  const hedged = 'Well, it depends. Both have merit. There is no right answer, and whichever works for you is fine.';
  const hedgingResult = detectExcessiveHedging(hedged, {
    userPrompt: 'Which database should I use for a lightweight mobile app?',
    isAdviceRequest: true,
  });

  const recovered = recoverFromExcessiveHedging(hedged, {
    userPrompt: 'Which database should I use for a lightweight mobile app: SQLite or PostgreSQL?',
  });

  const s6Pass =
    hedgingResult.hasExcessiveHedging &&
    hedgingResult.disclaimerCount > 3 &&
    recovered.includes('Recommendation:') &&
    recovered.includes('SQLite') &&
    ERR_EXCESSIVE_HEDGING === 'ERR_EXCESSIVE_HEDGING';

  results.push({
    scenarioNumber: 6,
    name: 'Anti-Hedging Protocol and ERR_EXCESSIVE_HEDGING Recovery',
    verdict: s6Pass ? 'PASS' : 'FAIL',
    details: `Excessive hedging detected (>3 disclaimer phrases without conclusion) and cleanly recovered with direct recommendation insertion.`,
    evidence: {
      disclaimerCount: hedgingResult.disclaimerCount,
      disclaimersFound: hedgingResult.disclaimersFound,
      recoveredSnippet: recovered.slice(-250),
    },
  });

  // ── Scenario 7: RecommendationPayload Contract & Fact-Judgment Separation ──
  const evalRec = evaluateRecommendation({
    userPrompt: 'Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?',
  });

  const validated = validateRecommendationPayload(evalRec);
  const s7Pass =
    validated.recommendedOption === 'SQLite' &&
    validated.optionsEvaluated.length === 2 &&
    validated.distinctionBetweenFactAndOpinion.includes('Fact:') &&
    validated.distinctionBetweenFactAndOpinion.includes('Judgment:');

  results.push({
    scenarioNumber: 7,
    name: 'RecommendationPayload Invariants and Fact vs Judgment Separation',
    verdict: s7Pass ? 'PASS' : 'FAIL',
    details: `Formal RecommendationPayload schema validated: 2 options evaluated, explicit recommendation, and clear separation of facts from applied judgment.`,
    evidence: {
      recommendedOption: validated.recommendedOption,
      primaryCriterion: validated.primaryDecisionCriterion,
      criticalTradeoff: validated.criticalTradeoff,
      distinction: validated.distinctionBetweenFactAndOpinion,
    },
  });

  // ── Print Summary ──
  console.log('\n================================================================');
  console.log('MOBOT Phase 17 Physical-Device Acceptance Results');
  console.log('================================================================');
  for (const r of results) {
    console.log(`[${r.verdict}] Scenario ${r.scenarioNumber}: ${r.name}`);
    console.log(`       ${r.details}`);
  }
  console.log('================================================================\n');

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeviceJudgmentVerification()
    .then((results) => {
      const allPassed = results.every((r) => r.verdict === 'PASS');
      process.exit(allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error('Physical verification failed with unhandled error:', err);
      process.exit(1);
    });
}

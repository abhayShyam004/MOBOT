import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BackgroundResearchWorker } from './background-research-worker.ts';
import { PersistentJobManager, StaleWorkerFenceError } from './tasks.ts';
import { BackgroundExecutionManager } from './background-execution.ts';

describe('BackgroundResearchWorker Lifecycle & Real Screen-Off Execution Suite', () => {
  let tempDir: string;
  let jobStoreFile: string;
  let journalFile: string;
  let checkpointsDir: string;
  let leasesFile: string;
  let bgExecutionFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bg-worker-test-'));
    jobStoreFile = join(tempDir, 'jobs.json');
    journalFile = join(tempDir, 'jobs.journal.ndjson');
    checkpointsDir = join(tempDir, 'checkpoints');
    leasesFile = join(tempDir, 'leases.json');
    bgExecutionFile = join(tempDir, 'background-execution.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('progresses through all 5 milestones to verified COMPLETED state with durable checkpoints', async () => {
    const jobManager = new PersistentJobManager({
      file: jobStoreFile,
      journalFile,
      checkpointsDir,
      leasesFile,
    });
    const bgManager = new BackgroundExecutionManager(bgExecutionFile);

    const worker = new BackgroundResearchWorker({
      jobManager,
      bgManager,
    });

    const milestonesObserved: number[] = [];
    const outcome = await worker.runCanonicalScreenOffTask({
      jobId: 'job_test_complete_lifecycle',
      botId: 'test_bot',
      threadId: 'test_thread',
      onMilestone: (idx) => {
        milestonesObserved.push(idx);
      },
    });

    // 1. Verify all milestones executed
    expect(milestonesObserved).toEqual([0, 1, 2, 3, 4, 5]);

    // 2. Verify job reached terminal COMPLETED state
    expect(outcome.job.state).toBe('COMPLETED');
    expect(outcome.job.progressPercent).toBe(100);
    expect(outcome.job.currentMilestoneIndex).toBe(4);
    expect(outcome.job.completedAtMs).toBeDefined();

    // 3. Verify real inspected repository details
    expect(outcome.result.repo).toBe('abhayShyam004/mobot-website');
    expect(outcome.result.defaultBranch).toBe('master');
    expect(outcome.result.dependencies.react).toBeDefined();
    expect(outcome.result.dependencies.tailwindcss).toBeDefined();
    expect(outcome.result.scripts.build).toBeDefined();
    expect(outcome.result.liveUrl).toBe('https://mobot-website.vercel.app');
    expect(outcome.result.verifiedTitle).toContain('MOBOT');

    // 4. Verify durable persistence of checkpoints and journal
    expect(existsSync(jobStoreFile)).toBe(true);
    expect(existsSync(journalFile)).toBe(true);

    const persistedJob = jobManager.getJob('job_test_complete_lifecycle');
    expect(persistedJob).toBeDefined();
    expect(persistedJob?.state).toBe('COMPLETED');
    expect(persistedJob?.progressPercent).toBe(100);

    // 5. Verify wake-lock cleanly released at terminal completion
    const bgState = await bgManager.getExecutionState();
    expect(bgState.wakelockHeld).toBe(false);
    expect(bgState.activeTaskId).toBe('');
  });

  it('rejects stale worker claims with StaleWorkerFenceError', async () => {
    const jobManager = new PersistentJobManager({
      file: jobStoreFile,
      journalFile,
      checkpointsDir,
      leasesFile,
    });

    const job = jobManager.createJob({
      jobId: 'job_test_fencing',
      botId: 'test_bot',
      threadId: 'test_thread',
      title: 'Fencing Test',
      objective: 'Verify worker fencing',
    });

    // Worker 1 claims job -> fencing generation becomes 2
    jobManager.claimJob(job.jobId, 'worker_primary');

    // Worker 2 attempts operation with stale generation 1 -> must throw StaleWorkerFenceError
    await expect(async () => {
      await jobManager.advanceMilestone({
        jobId: job.jobId,
        milestoneIndex: 1,
        milestoneTitle: 'Stale Milestone',
        progressPercent: 20,
        workerId: 'worker_stale',
        fencingGeneration: 1,
      });
    }).rejects.toThrow(StaleWorkerFenceError);
  });

  it('ensures synthesized report satisfies content oracle criteria without hallucinations', async () => {
    const jobManager = new PersistentJobManager({
      file: jobStoreFile,
      journalFile,
      checkpointsDir,
      leasesFile,
    });
    const bgManager = new BackgroundExecutionManager(bgExecutionFile);

    const worker = new BackgroundResearchWorker({
      jobManager,
      bgManager,
    });

    const outcome = await worker.runCanonicalScreenOffTask({
      jobId: 'job_test_oracle',
      botId: 'test_bot',
      threadId: 'test_thread',
    });

    const text = outcome.result.synthesizedReport;

    // Check content oracle requirements:
    expect(text).toContain('abhayShyam004/mobot-website');
    expect(text).toContain('React');
    expect(text).toContain('Tailwind CSS');
    expect(text).toContain('Vite');
    expect(text).toContain('https://mobot-website.vercel.app');
    expect(text).toContain('Vercel');
    expect(text).toContain('MOBOT — Autonomous AI Companions for Android');
    expect(text).toContain('Technical Trade-Offs');
    expect(text).toContain('Companion Server Difference');
    expect(text).toContain('Verification Receipt');
  });

  it('guarantees clean resource release when job completes', async () => {
    const jobManager = new PersistentJobManager({
      file: jobStoreFile,
      journalFile,
      checkpointsDir,
      leasesFile,
    });
    const bgManager = new BackgroundExecutionManager(bgExecutionFile);

    const worker = new BackgroundResearchWorker({
      jobManager,
      bgManager,
    });

    await worker.runCanonicalScreenOffTask({
      jobId: 'job_test_cleanup',
      botId: 'test_bot',
      threadId: 'test_thread',
    });

    const finalBgState = await bgManager.getExecutionState();
    expect(finalBgState.wakelockHeld).toBe(false);
    expect(finalBgState.activeTaskId).toBe('');
  }, 35000);

  it('correctly discovers canonical package manifests and provenance for monorepos and single packages', async () => {
    const jobManager = new PersistentJobManager({
      file: jobStoreFile,
      journalFile,
      checkpointsDir,
      leasesFile,
    });
    const bgManager = new BackgroundExecutionManager(bgExecutionFile);
    const worker = new BackgroundResearchWorker({ jobManager, bgManager });

    // 1. Verify React (Monorepo: packages/react/package.json -> 19.3.0 manifest, 19.3.1 registry)
    const reactOutcome = await worker.runCanonicalScreenOffTask({
      jobId: 'job_test_react_discovery',
      botId: 'test_bot',
      threadId: 'test_thread',
      targetRepo: 'facebook/react',
    });
    expect(reactOutcome.result.manifestPath).toBe('packages/react/package.json');
    expect(reactOutcome.result.packageName).toBe('react');
    expect(reactOutcome.result.packageVersion).toBe('19.3.0');
    expect(reactOutcome.result.manifestVersion).toBe('19.3.0');
    expect(reactOutcome.result.latestPublishedVersion).toBe('19.3.1');
    expect(reactOutcome.result.isMonorepo).toBe(true);
    expect(reactOutcome.result.deploymentRole).toContain('Documentation');
    expect(reactOutcome.result.resolvedCommitSha).toBeDefined();
    expect(reactOutcome.result.branchHeadSha).toBeDefined();
    expect(reactOutcome.result.manifestRevisionSha).toBeDefined();
    expect(reactOutcome.result.manifestSourceUrl).toContain('packages/react/package.json');
    expect(reactOutcome.result.synthesizedReport).toContain('19.3.0');
    expect(reactOutcome.result.synthesizedReport).toContain('packages/react/package.json');
    expect(reactOutcome.result.synthesizedReport).toContain('Zero runtime dependencies');

    // 2. Verify Vite (Monorepo: packages/vite/package.json -> 8.3.5 manifest, 8.3.5 registry)
    const viteOutcome = await worker.runCanonicalScreenOffTask({
      jobId: 'job_test_vite_discovery',
      botId: 'test_bot',
      threadId: 'test_thread',
      targetRepo: 'vitejs/vite',
    });
    expect(viteOutcome.result.manifestPath).toBe('packages/vite/package.json');
    expect(viteOutcome.result.packageName).toBe('vite');
    expect(viteOutcome.result.packageVersion).toBe('8.3.5');
    expect(viteOutcome.result.manifestVersion).toBe('8.3.5');
    expect(viteOutcome.result.latestPublishedVersion).toBe('8.3.5');
    expect(viteOutcome.result.isMonorepo).toBe(true);
    expect(viteOutcome.result.deploymentRole).toContain('Documentation');
    expect(viteOutcome.result.resolvedCommitSha).toBeDefined();
    expect(viteOutcome.result.branchHeadSha).toBeDefined();
    expect(viteOutcome.result.manifestRevisionSha).toBeDefined();
    expect(viteOutcome.result.dependencies.rolldown || viteOutcome.result.dependencies.lightningcss).toBeDefined();
    expect(viteOutcome.result.synthesizedReport).toContain('8.3.5');
    expect(viteOutcome.result.synthesizedReport).toContain('packages/vite/package.json');

    // 3. Verify Express (Single-Package: package.json -> 5.3.0 manifest, 5.3.0 registry)
    const expressOutcome = await worker.runCanonicalScreenOffTask({
      jobId: 'job_test_express_discovery',
      botId: 'test_bot',
      threadId: 'test_thread',
      targetRepo: 'expressjs/express',
    });
    expect(expressOutcome.result.manifestPath).toBe('package.json');
    expect(expressOutcome.result.packageName).toBe('express');
    expect(expressOutcome.result.packageVersion).toBe('5.3.0');
    expect(expressOutcome.result.manifestVersion).toBe('5.3.0');
    expect(expressOutcome.result.latestPublishedVersion).toBe('5.3.0');
    expect(expressOutcome.result.isMonorepo).toBe(false);
    expect(expressOutcome.result.deploymentRole).toContain('Documentation');
    expect(expressOutcome.result.resolvedCommitSha).toBeDefined();
    expect(expressOutcome.result.branchHeadSha).toBeDefined();
    expect(expressOutcome.result.manifestRevisionSha).toBeDefined();
    expect(Object.keys(expressOutcome.result.dependencies).length).toBeGreaterThan(15);
    expect(expressOutcome.result.synthesizedReport).toContain('5.3.0');
    expect(expressOutcome.result.synthesizedReport).toContain('Standard Single-Package Repository');
  }, 60000);
});

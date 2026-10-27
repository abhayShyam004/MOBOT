import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PersistentJobManager,
  ERR_STALE_WORKER_FENCE,
} from './tasks.ts';

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Worker Child Process Implementation (IPC Receiver)
// ---------------------------------------------------------------------------
if (process.argv.includes('--worker-child')) {
  const workerId = process.argv[process.argv.indexOf('--worker-id') + 1] || `worker-${process.pid}`;
  const dataDir = process.argv[process.argv.indexOf('--data-dir') + 1];

  const jobsFile = join(dataDir, 'jobs.json');
  const journalFile = join(dataDir, 'job-journal.jsonl');
  const checkpointsDir = join(dataDir, 'checkpoints');
  const leasesFile = join(dataDir, 'worker-leases.json');

  const manager = new PersistentJobManager({
    file: jobsFile,
    journalFile,
    checkpointsDir,
    leasesFile,
  });

  process.on('message', async (msg: any) => {
    try {
      if (msg.type === 'CLAIM') {
        const job = manager.claimJob(msg.jobId, workerId, msg.leaseDurationMs);
        process.send?.({
          type: 'CLAIM_OK',
          pid: process.pid,
          workerId,
          fencingGeneration: job.fencingGeneration,
          job,
        });
      } else if (msg.type === 'ADVANCE_MILESTONE') {
        const job = await manager.advanceMilestone({
          jobId: msg.jobId,
          milestoneIndex: msg.milestoneIndex,
          milestoneTitle: msg.milestoneTitle,
          progressPercent: msg.progressPercent,
          workerId,
          fencingGeneration: msg.fencingGeneration,
        });
        process.send?.({
          type: 'ADVANCE_OK',
          pid: process.pid,
          workerId,
          job,
        });
      } else if (msg.type === 'COMPLETE') {
        const job = manager.completeJob(
          msg.jobId,
          { completedBy: workerId },
          workerId,
          msg.fencingGeneration
        );
        process.send?.({
          type: 'COMPLETE_OK',
          pid: process.pid,
          workerId,
          job,
        });
      }
    } catch (err: any) {
      process.send?.({
        type: 'ERROR',
        pid: process.pid,
        workerId,
        code: err.code || 'UNKNOWN_ERROR',
        message: err.message,
        name: err.name,
      });
    }
  });

  // Keep alive until parent terminates or exits
  setInterval(() => {}, 1000);
}

// ---------------------------------------------------------------------------
// Coordinator Orchestrator Implementation
// ---------------------------------------------------------------------------
export interface CrossProcessFencingReport {
  verdict: 'PASS' | 'FAIL';
  coordinatorPid: number;
  workerAPid: number;
  workerBPid: number;
  jobId: string;
  workerAFencingGeneration: number;
  workerBFencingGeneration: number;
  staleWriteRejectedErrorCode: string;
  staleWriteErrorMessage: string;
  staleCompleteRejectedErrorCode: string;
  journalEntriesCount: number;
  reconstructedState: string;
  reconstructedProgress: number;
  reconstructedMilestone: number;
  reconstructedGeneration: number;
  details: string;
}

export async function runCrossProcessWorkerFencingTest(): Promise<CrossProcessFencingReport> {
  const tempDir = mkdtempSync(join(tmpdir(), 'p21-cross-process-fence-'));
  const jobsFile = join(tempDir, 'jobs.json');
  const journalFile = join(tempDir, 'job-journal.jsonl');
  const checkpointsDir = join(tempDir, 'checkpoints');
  const leasesFile = join(tempDir, 'worker-leases.json');

  console.log('================================================================');
  console.log('MOBOT Phase 21 — Cross-Process Stale-Worker Fencing Verification');
  console.log(`Coordinator Process PID: ${process.pid}`);
  console.log(`Isolated Data Dir: ${tempDir}`);
  console.log('================================================================\n');

  let currentClockMs = 1793040000000;
  const coordinatorClock = () => currentClockMs;

  const coordinatorManager = new PersistentJobManager({
    file: jobsFile,
    journalFile,
    checkpointsDir,
    leasesFile,
    clock: coordinatorClock,
  });

  // 1. Coordinator creates a durable job
  const jobId = 'job-cross-process-fencing-01';
  const initialJob = coordinatorManager.createJob({
    jobId,
    title: 'Cross-process worker fencing verification',
    botId: 'test-bot-p21',
    threadId: 'thread-cross-process',
    objective: 'Demonstrate strict cross-process fencing with distinct worker processes',
    initialData: { task: 'parallel-ingest' },
    milestones: [
      { title: 'Job initialized', data: { index: 0, required: true } },
      { title: 'Worker A batch 1', data: { index: 1, required: true } },
      { title: 'Worker B batch 2 takeover', data: { index: 2, required: true } },
      { title: 'Worker B completion', data: { index: 3, required: true } },
    ],
  });

  console.log(`[Coordinator] Job created: ${initialJob.jobId}, generation: ${initialJob.fencingGeneration} (expected: 1)`);

  // Helper to spawn worker child process
  function spawnWorker(workerId: string): Promise<{ child: any; pid: number }> {
    return new Promise((resolve, reject) => {
      const child = fork(
        __filename,
        ['--worker-child', '--worker-id', workerId, '--data-dir', tempDir],
        {
          execArgv: ['--experimental-strip-types'],
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        }
      );
      child.on('error', reject);
      resolve({ child, pid: child.pid! });
    });
  }

  // Helper to send message and await reply
  function sendWorker(child: any, msg: any): Promise<any> {
    return new Promise((resolve) => {
      const handler = (reply: any) => {
        child.removeListener('message', handler);
        resolve(reply);
      };
      child.on('message', handler);
      child.send(msg);
    });
  }

  // 2. Spawn Worker A in separate OS process
  const { child: childA, pid: pidA } = await spawnWorker('worker-process-A');
  console.log(`[Spawn] Worker A started as distinct OS Process PID: ${pidA} (Coordinator PID: ${process.pid})`);

  // 3. Worker A claims the job with a short 800ms lease
  const claimReplyA = await sendWorker(childA, {
    type: 'CLAIM',
    jobId,
    leaseDurationMs: 800,
  });
  console.log(`[Worker A - PID ${pidA}] Claimed job, fencingGeneration: ${claimReplyA.fencingGeneration} (expected: 2)`);
  const fenceA = claimReplyA.fencingGeneration;

  // 4. Worker A advances milestone 1 using its valid fence
  const advanceReplyA1 = await sendWorker(childA, {
    type: 'ADVANCE_MILESTONE',
    jobId,
    milestoneIndex: 1,
    milestoneTitle: 'Worker A batch 1',
    progressPercent: 25,
    fencingGeneration: fenceA,
  });
  console.log(`[Worker A - PID ${pidA}] Advanced milestone 1: progress ${advanceReplyA1.job.progressPercent}%`);

  // 5. Simulate real wall-clock lease expiration for Worker A
  console.log(`\n[Coordinator] Waiting 1000ms for Worker A lease (800ms) to expire across OS processes...`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(`[Coordinator] Worker A lease has legitimately expired.`);

  // 6. Spawn Worker B in another distinct OS process
  const { child: childB, pid: pidB } = await spawnWorker('worker-process-B');
  console.log(`[Spawn] Worker B started as distinct OS Process PID: ${pidB} (PID_A: ${pidA}, PID_B: ${pidB})`);

  // 7. Worker B claims the job (valid takeover because lease expired)
  const claimReplyB = await sendWorker(childB, {
    type: 'CLAIM',
    jobId,
    leaseDurationMs: 15000,
  });
  console.log(`[Worker B - PID ${pidB}] Claimed job, fencingGeneration: ${claimReplyB.fencingGeneration} (expected: 3)`);
  const fenceB = claimReplyB.fencingGeneration;

  // 8. Worker B advances milestone 2 using its newer fencing generation
  const advanceReplyB2 = await sendWorker(childB, {
    type: 'ADVANCE_MILESTONE',
    jobId,
    milestoneIndex: 2,
    milestoneTitle: 'Worker B batch 2 takeover',
    progressPercent: 50,
    fencingGeneration: fenceB,
  });
  console.log(`[Worker B - PID ${pidB}] Advanced milestone 2: progress ${advanceReplyB2.job.progressPercent}%, fence: ${fenceB}`);

  // 9. Adversarial test: Stale Worker A wakes up and attempts milestone write with its stale generation (fenceA = 2)
  console.log(`\n[Adversarial Step] Stale Worker A (PID ${pidA}, stale fence ${fenceA}) attempts to advance milestone...`);
  const staleAdvanceReply = await sendWorker(childA, {
    type: 'ADVANCE_MILESTONE',
    jobId,
    milestoneIndex: 3,
    milestoneTitle: 'Stale Worker A Rogue Write',
    progressPercent: 75,
    fencingGeneration: fenceA,
  });
  console.log(`[Authoritative Rejection] Worker A write result:`, staleAdvanceReply);

  // 10. Adversarial test: Stale Worker A attempts to complete the job with its stale generation
  console.log(`[Adversarial Step] Stale Worker A (PID ${pidA}, stale fence ${fenceA}) attempts completeJob...`);
  const staleCompleteReply = await sendWorker(childA, {
    type: 'COMPLETE',
    jobId,
    fencingGeneration: fenceA,
  });
  console.log(`[Authoritative Rejection] Worker A complete result:`, staleCompleteReply);

  // 11. Worker B completes the job cleanly
  const completeReplyB = await sendWorker(childB, {
    type: 'COMPLETE',
    jobId,
    fencingGeneration: fenceB,
  });
  console.log(`\n[Worker B - PID ${pidB}] Successfully completed job: state=${completeReplyB.job.state}, progress=${completeReplyB.job.progressPercent}%`);

  // Terminate child worker processes cleanly
  childA.kill();
  childB.kill();

  // 12. Verify disk state and durability
  const journalRaw = readFileSync(journalFile, 'utf8').trim().split('\n');
  const journalEntriesCount = journalRaw.length;
  console.log(`\n[Journal WAL] Total durable entries in journal: ${journalEntriesCount}`);

  // 13. Reconstruct job state from disk using fresh manager
  const recoveryManager = new PersistentJobManager({
    file: join(tempDir, 'nonexistent.json'), // force journal recovery
    journalFile,
    checkpointsDir,
    leasesFile,
  });
  const recoveredJob = recoveryManager.getJob(jobId);

  const staleAdvanceBlocked = staleAdvanceReply.code === ERR_STALE_WORKER_FENCE;
  const staleCompleteBlocked = staleCompleteReply.code === ERR_STALE_WORKER_FENCE;
  const workerBDurable = recoveredJob?.state === 'COMPLETED' && recoveredJob?.progressPercent === 100 && recoveredJob?.fencingGeneration === 3;
  const pidsDistinct = pidA !== process.pid && pidB !== process.pid && pidA !== pidB;

  const passed = staleAdvanceBlocked && staleCompleteBlocked && workerBDurable && pidsDistinct;

  // Cleanup temp files
  rmSync(tempDir, { recursive: true, force: true });

  const report: CrossProcessFencingReport = {
    verdict: passed ? 'PASS' : 'FAIL',
    coordinatorPid: process.pid,
    workerAPid: pidA,
    workerBPid: pidB,
    jobId,
    workerAFencingGeneration: fenceA,
    workerBFencingGeneration: fenceB,
    staleWriteRejectedErrorCode: staleAdvanceReply.code,
    staleWriteErrorMessage: staleAdvanceReply.message,
    staleCompleteRejectedErrorCode: staleCompleteReply.code,
    journalEntriesCount,
    reconstructedState: recoveredJob?.state || 'UNKNOWN',
    reconstructedProgress: recoveredJob?.progressPercent || 0,
    reconstructedMilestone: recoveredJob?.currentMilestoneIndex || 0,
    reconstructedGeneration: recoveredJob?.fencingGeneration || 0,
    details: passed
      ? `Cross-process stale-worker fencing successfully demonstrated across 3 distinct OS processes (Coordinator PID ${process.pid}, Worker A PID ${pidA}, Worker B PID ${pidB}). Stale worker writes and completions strictly rejected with ${ERR_STALE_WORKER_FENCE}. Worker B state and journal remain 100% durable and uncorrupted.`
      : 'Cross-process fencing verification failed.',
  };

  console.log('\n================================================================');
  console.log(`RESULT: [${report.verdict}]`);
  console.log(`Details: ${report.details}`);
  console.log('================================================================\n');

  return report;
}

if (process.argv.includes('--run') || (!process.argv.includes('--worker-child') && process.argv[1] === __filename)) {
  runCrossProcessWorkerFencingTest()
    .then((rep) => {
      process.exit(rep.verdict === 'PASS' ? 0 : 1);
    })
    .catch((err) => {
      console.error('Cross-process test execution error:', err);
      process.exit(1);
    });
}

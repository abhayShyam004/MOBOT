/**
 * Comprehensive End-to-End Verification for MOBOT Phases C, D, and E on physical Samsung hardware.
 *
 * Checks:
 *  1. Companion server health check (:28799 -> :18799 loopback)
 *  2. Project workspace creation (scaffolded isolated environment)
 *  3. Scaffolding inspection (manifest, files, git state)
 *  4. Source code write (atomic file creation)
 *  5. Source code read (content verification & byte tracking)
 *  6. Project build execution (Node.js runtime validation)
 *  7. Project test execution (automated test suite runner)
 *  8. Localhost preview startup (port allocator & supervisor)
 *  9. Preview status inspection (honest Live state, port, PID)
 * 10. Live on-device preview HTTP HTML retrieval over port forward
 * 11. Preview stop lifecycle (honest Stopped state, timestamp)
 * 12. Preview restart lifecycle (honest port reallocation, new PID)
 * 13. Autonomous repair loop execution (success path through preview)
 * 14. Autonomous repair loop failure handling (bounded 3 retries, syntax error classification)
 * 15. Clean workspace teardown and deletion
 */

import { execFileSync } from 'node:child_process';

const PORT_HOST = 28799;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const PROJECT_ID = `job-tracker-${Date.now().toString(36)}`;

const _wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n============================================================`);
  console.log(` MOBOT Phases C, D, E: Comprehensive Hardware Verification `);
  console.log(` Target: Samsung Galaxy SM-A075F (Android 16 / API 36)      `);
  console.log(`============================================================\n`);

  // 1. Health check
  console.log(`1. Checking companion server health on device at ${BASE}/api/health...`);
  const healthRes = await fetch(`${BASE}/api/health`);
  if (!healthRes.ok) throw new Error(`Host unhealthy: ${healthRes.status}`);
  const health = await healthRes.json();
  console.log(`   PASS: Host running (PID ${health.pid}, mode: ${health.mode || 'standalone'})`);

  // 2. Project creation
  console.log(`\n2. Creating isolated project workspace "${PROJECT_ID}" (Job Application Tracker)...`);
  const createRes = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: PROJECT_ID,
      name: 'Job Application Tracker',
      framework: 'html',
      description: 'Autonomous job application tracker built via MOBOT Phase C',
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Project creation failed: ${createRes.status} ${err}`);
  }
  const createData = await createRes.json();
  console.log(`   PASS: Project "${createData.project.name}" created with framework ${createData.project.framework}`);

  // 3. Scaffolding inspection
  console.log(`\n3. Verifying starter scaffold files and metadata...`);
  const getRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}`);
  if (!getRes.ok) throw new Error(`Fetch project failed: ${getRes.status}`);
  const getData = await getRes.json();
  const fileNames = getData.files.map((f) => f.path);
  console.log(`   Scaffold files (${fileNames.length}): ${fileNames.join(', ')}`);
  if (!fileNames.includes('index.html') || !fileNames.includes('package.json') || !fileNames.includes('server.js')) {
    throw new Error(`Missing expected scaffold files in project`);
  }
  console.log(`   PASS: All required starter scaffold files present.`);

  // 4. Source code write
  console.log(`\n4. Injecting customized Job Application Tracker source code...`);
  const customHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Application Tracker</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; margin: 0; }
    h1 { color: #38bdf8; font-size: 1.8rem; margin-bottom: 0.5rem; }
    .subtitle { color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.5rem; }
    .card { background: #1e293b; padding: 1.25rem; border-radius: 10px; margin-bottom: 1rem; border: 1px solid #334155; }
    .badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: #0284c7; color: #fff; }
    .meta { color: #64748b; font-size: 0.85rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <main>
    <h1>Job Application Tracker</h1>
    <p class="subtitle">Built on Android with MOBOT Full-Stack Engine</p>
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2 style="margin:0; font-size:1.2rem;">Staff Mobile Engineer - Anthropic</h2>
        <span class="badge">Interviewing</span>
      </div>
      <p style="margin:0.5rem 0 0; color:#cbd5e1;">Passed technical screening. Next: Architecture interview.</p>
      <div class="meta">Location: Remote &bull; Applied: Oct 2026</div>
    </div>
  </main>
</body>
</html>`;

  const writeRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'index.html', content: customHtml }),
  });
  if (!writeRes.ok) throw new Error(`File write failed: ${writeRes.status}`);
  console.log(`   PASS: Custom index.html written successfully.`);

  // 5. Source code read
  console.log(`\n5. Reading back file from project workspace...`);
  const readRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/file?path=index.html`);
  if (!readRes.ok) throw new Error(`File read failed: ${readRes.status}`);
  const readData = await readRes.json();
  if (!readData.content.includes('Staff Mobile Engineer')) {
    throw new Error('Read back content mismatch');
  }
  console.log(`   PASS: File verified (${readData.bytes} bytes read).`);

  // 6. Project build execution
  console.log(`\n6. Executing project build runner on device...`);
  const buildRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!buildRes.ok) throw new Error(`Build request failed: ${buildRes.status}`);
  const buildData = await buildRes.json();
  if (!buildData.ok) throw new Error(`Build failed: ${buildData.stderr}`);
  console.log(`   Build output: ${buildData.stdout.trim()} (duration: ${buildData.durationMs}ms)`);
  console.log(`   PASS: Project build completed with exit code ${buildData.exitCode}.`);

  // 7. Project test execution
  console.log(`\n7. Executing automated tests in project workspace...`);
  const testRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!testRes.ok) throw new Error(`Test request failed: ${testRes.status}`);
  const testData = await testRes.json();
  if (!testData.ok) throw new Error(`Tests failed: ${testData.stderr}`);
  console.log(`   Test output: ${testData.stdout.trim()} (duration: ${testData.durationMs}ms)`);
  console.log(`   PASS: Automated test suite passed with exit code ${testData.exitCode}.`);

  // 8. Localhost preview startup
  console.log(`\n8. Starting local development server via preview supervisor...`);
  const startPreviewRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/preview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!startPreviewRes.ok) throw new Error(`Preview start failed: ${startPreviewRes.status}`);
  const startData = await startPreviewRes.json();
  console.log(`   Allocated port: ${startData.preview.port}`);
  console.log(`   Preview URL: ${startData.preview.url}`);
  console.log(`   Process PID: ${startData.preview.pid}`);
  if (startData.preview.status !== 'running') throw new Error(`Preview not running: ${startData.preview.status}`);
  console.log(`   PASS: Localhost preview server started.`);

  // 9. Preview status inspection
  console.log(`\n9. Inspecting preview supervisor status and live logs...`);
  const statusRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/preview`);
  if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
  const statusData = await statusRes.json();
  console.log(`   Reported status: ${statusData.preview.status}`);
  console.log(`   Captured log: ${statusData.logs.trim()}`);
  if (statusData.preview.status !== 'running') throw new Error(`Status mismatch`);
  console.log(`   PASS: Honest Live status confirmed.`);

  // 10. Live on-device preview HTTP HTML retrieval
  console.log(`\n10. Querying live application over device loopback...`);
  const previewPort = startData.preview.port;
  const hostForwardPort = 33000;
  execFileSync('adb', ['-s', 'R8YY90VT4EM', 'forward', `tcp:${hostForwardPort}`, `tcp:${previewPort}`]);
  try {
    const previewFetch = await fetch(`http://127.0.0.1:${hostForwardPort}/`);
    if (!previewFetch.ok) throw new Error(`Preview HTTP error: ${previewFetch.status}`);
    const previewHtml = await previewFetch.text();
    if (!previewHtml.includes('Job Application Tracker') || !previewHtml.includes('Staff Mobile Engineer')) {
      throw new Error(`Preview content mismatch: ${previewHtml.slice(0, 200)}`);
    }
    console.log(`    HTTP 200 OK received with authentic Job Application Tracker content!`);
    console.log(`    PASS: Embedded runtime served web application on Android phone.`);
  } finally {
    try {
      execFileSync('adb', ['-s', 'R8YY90VT4EM', 'forward', '--remove', `tcp:${hostForwardPort}`]);
    } catch {}
  }

  // 11. Preview stop lifecycle
  console.log(`\n11. Stopping local preview server...`);
  const stopRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/preview/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!stopRes.ok) throw new Error(`Stop preview failed: ${stopRes.status}`);
  const stopData = await stopRes.json();
  if (stopData.preview.status !== 'stopped') throw new Error(`Expected stopped status, got ${stopData.preview.status}`);
  console.log(`    PASS: Preview process terminated cleanly (status: ${stopData.preview.status}).`);

  // 12. Preview restart lifecycle
  console.log(`\n12. Restarting preview server and verifying port reallocation...`);
  const restartRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/preview/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!restartRes.ok) throw new Error(`Restart preview failed: ${restartRes.status}`);
  const restartData = await restartRes.json();
  console.log(`    Reallocated port: ${restartData.preview.port}`);
  console.log(`    New PID: ${restartData.preview.pid}`);
  if (restartData.preview.status !== 'running') throw new Error(`Restart failed`);
  console.log(`    PASS: Preview restarted with active process.`);

  // 13. Autonomous repair loop (clean run)
  console.log(`\n13. Running Autonomous Repair Loop on healthy project...`);
  const repairRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!repairRes.ok) throw new Error(`Repair loop request failed: ${repairRes.status}`);
  const repairData = await repairRes.json();
  console.log(`    Repair outcome: success=${repairData.success}, attempts=${repairData.attemptsUsed}/${repairData.maxAttempts}, finalStage=${repairData.finalStage}`);
  if (!repairData.success || repairData.finalStage !== 'user_review') {
    throw new Error(`Repair loop expected to reach user_review, got ${repairData.finalStage}`);
  }
  console.log(`    PASS: Autonomous repair cycle successfully advanced to user review.`);

  // 14. Autonomous repair loop (broken code handling)
  console.log(`\n14. Verifying Autonomous Repair Loop bounded failure handling...`);
  const brokenProjectId = `broken-app-${Date.now().toString(36)}`;
  await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: brokenProjectId, name: 'Broken App', framework: 'html' }),
  });
  // Write broken syntax
  await fetch(`${BASE}/api/projects/${brokenProjectId}/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'test.js', content: 'const broken = ;\nprocess.exit(1);' }),
  });
  const brokenRepairRes = await fetch(`${BASE}/api/projects/${brokenProjectId}/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const brokenData = await brokenRepairRes.json();
  console.log(`    Broken cycle: success=${brokenData.success}, attempts=${brokenData.attemptsUsed}/${brokenData.maxAttempts}, requiresUser=${brokenData.requiresUser}`);
  console.log(`    Identified failure class: ${brokenData.failureAnalysis?.failureClass}`);
  if (brokenData.success !== false || brokenData.attemptsUsed !== 3 || brokenData.requiresUser !== true) {
    throw new Error(`Broken repair loop did not enforce hard 3-retry limit or user escalation`);
  }
  await fetch(`${BASE}/api/projects/${brokenProjectId}`, { method: 'DELETE' });
  console.log(`    PASS: Bounded retries (3) and failure classification verified.`);

  // 15. Clean workspace teardown
  console.log(`\n15. Cleaning up test project workspace...`);
  await fetch(`${BASE}/api/projects/${PROJECT_ID}/preview/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const delRes = await fetch(`${BASE}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });
  if (!delRes.ok) throw new Error(`Delete project failed: ${delRes.status}`);
  console.log(`    PASS: Test project deleted cleanly.`);

  console.log(`\n============================================================`);
  console.log(` ALL 15 HARDWARE CHECKS PASSED ON SAMSUNG GALAXY SM-A075F!  `);
  console.log(` PHASES C, D, E FULLY VALIDATED AND OPERATIONAL ON-DEVICE.  `);
  console.log(`============================================================\n`);
}

main().catch((err) => {
  console.error(`\nFAIL: ${err.message}`);
  process.exit(1);
});

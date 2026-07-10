import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const webviewDir = path.join(root, 'out', 'webview');
const html = path.join(webviewDir, 'index.html');
if (!fs.existsSync(html)) {
  throw new Error('out/webview/index.html is missing. Run npm run build first.');
}

const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : (req.url || '/index.html');
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(webviewDir, safePath);
  if (!filePath.startsWith(webviewDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(filePath);
  const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Failed to bind visual smoke HTTP server.');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
const browserErrors = [];
page.on('console', msg => browserErrors.push(`console:${msg.type()}: ${msg.text()}`));
page.on('pageerror', err => browserErrors.push(`pageerror: ${err.message}`));
await page.addInitScript(() => {
  window.acquireVsCodeApi = () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined
  });
});

try {
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForSelector('[data-testid="forge-agent-app"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="run-console"]', { timeout: 5000 });
  await page.evaluate(() => {
    window.postMessage({
      command: 'state-update',
      state: {
        sessionId: 'visual-reflection-smoke',
        goalContract: { goal: 'Validate reflection UI counters.', context: '', constraints: [], doneWhen: [], nonGoals: [], budget: 2, spent: 0 },
        taskGraph: { tasks: [{ id: '4', title: 'Retry after red oracle reflection', status: 'running', dependencies: [], blockers: [], owner: 'Reviewer' }] },
        planMd: '',
        scratchpadMd: '',
        evidenceLedger: [],
        knowledge: { ruleFile: '', commandsFile: '', architectureFile: '' },
        skills: [],
        files: {},
        firewall: { stage: 'NARRATE', timestamp: new Date().toISOString(), details: 'Reflection queued after failed oracle.' },
        logs: [],
        reflections: [{ id: 'r1', trigger: 'red_oracle', taskId: '4', taskTitle: 'Retry after red oracle reflection', details: 'Tests failed.', timestamp: new Date().toISOString() }],
        diffReviews: [{ id: 'd1', reviewer: 'Reviewer', status: 'approved', summary: 'Reviewer inspected current diff.', diffExcerpt: 'diff --git a/src/example.ts b/src/example.ts', timestamp: new Date().toISOString() }],
        reviewerCritiques: [{ id: 'c1', reviewer: 'Reviewer', modelId: 'openrouter/reviewer', source: 'model', status: 'approved', summary: 'Reviewer model found no blocking issues.', concerns: [], diffExcerpt: 'diff --git a/src/example.ts b/src/example.ts', timestamp: new Date().toISOString() }],
        preCommitReviews: [{ id: 'p1', reviewer: 'Reviewer', modelId: 'openrouter/reviewer', source: 'model', status: 'approved', proposalName: 'apply_patch', protectedPaths: ['src/example.ts'], summary: 'Pre-commit reviewer allowed the patch.', concerns: [], timestamp: new Date().toISOString() }],
        escalations: [{ id: 'e1', reason: 'Repeated reflection failures reached escalation threshold.', fromRole: 'Reviewer', toModel: 'openrouter/auto', reflectionAttempts: 2, timestamp: new Date().toISOString() }],
        contextBundle: {
          generatedAt: new Date().toISOString(),
          goal: 'Validate reflection UI counters.',
          activeTask: '4:Reviewer:Retry after red oracle reflection',
          openTasks: ['4:running:Reviewer:Retry after red oracle reflection'],
          recentFiles: ['src/example.ts (ts, 120 chars)'],
          retrievalCandidates: [
            { path: 'src/example.ts', score: 18, reason: 'path token hits; source file', language: 'ts' }
          ],
          recentReflections: ['red_oracle:Retry after red oracle reflection:Tests failed.'],
          recentEscalations: ['Reviewer->openrouter/auto:Repeated reflection failures reached escalation threshold.'],
          recentReviews: ['approved:Reviewer inspected current diff.'],
          scratchpadSummary: 'Tests failed. Reflection and escalation state rehydrated.',
          retrievalPolicy: ['Prefer files already read into state.files before broad search.'],
          tokenEstimate: 128,
          compacted: true
        },
        roleHandoffs: {
          Reviewer: {
            role: 'Reviewer',
            generatedAt: new Date().toISOString(),
            allowedTools: ['run_tests', 'get_diff', 'record_evidence', 'declare_success'],
            responsibilities: ['Inspect the diff before success.', 'Run the selected oracle.', 'Record green evidence.'],
            openTasks: ['4:running:Retry after red oracle reflection'],
            recentContext: ['approved:Reviewer inspected current diff.'],
            handoffSummary: 'Reviewer owns verification and evidence gating.'
          }
        },
        safetyCheckpoints: [
          {
            id: 'step-3-demo',
            strategy: 'targeted-files',
            proposalName: 'apply_patch',
            protectedPaths: ['src/example.ts'],
            manifestPath: '.forge/checkpoints/step-3-demo/manifest.json',
            timestamp: new Date().toISOString()
          }
        ],
        commandEffects: [
          {
            id: 'cmd1',
            command: 'node scripts/write-fixture.js',
            created: ['generated/output.txt'],
            modified: [],
            deleted: [],
            unchangedCount: 12,
            sandbox: {
              cwd: 'F:/DEV_ENV/projects/Agent_Harness_Extension',
              timeoutMs: 120000,
              durationMs: 42,
              exitCode: 0,
              signal: null,
              sanitizedEnv: true,
              inheritedEnvKeyCount: 64,
              allowedEnvKeys: ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP'],
              blockedEnvKeys: ['OPENROUTER_API_KEY', 'FORGE_SANDBOX_SECRET']
            },
            outputExcerpt: 'created generated/output.txt',
            timestamp: new Date().toISOString()
          }
        ],
        runBudget: {
          startedAt: new Date().toISOString(),
          maxWallClockMs: 1800000,
          maxCostUsd: 2,
          lastCheckedAt: new Date().toISOString()
        },
        runStats: {
          providerCalls: 3,
          providerFailures: 0,
          fallbackProposals: 0,
          modelDrivenProposals: 2,
          fallbackActions: 0,
          repairAttempts: 1,
          schemaFailures: 1,
          validationFailures: 0,
          reflectionAttempts: 1,
          firewallReflections: 0,
          toolFailureReflections: 0,
          oracleReflections: 1,
          diffReviewAttempts: 1,
          reviewerApprovals: 1,
          reviewerCritiques: 1,
          reviewerModelCritiques: 1,
          preCommitReviews: 1,
          preCommitModelReviews: 1,
          preCommitBlocks: 0,
          escalationCount: 1,
          contextRefreshes: 2,
          roleHandoffRefreshes: 1,
          retrievalRefreshes: 1,
          safetyCheckpoints: 1,
          safetyReverts: 0,
          commandEffectCaptures: 1,
          commandCreatedFiles: 1,
          commandModifiedFiles: 0,
          commandDeletedFiles: 0,
          budgetHalts: 0,
          noProgressTurns: 0,
          lastProgressSignature: '',
          actuallyModelDriven: true
        },
        currentStepIndex: 4,
        maxSteps: 30,
        status: 'idle',
        activeSubAgent: 'Reviewer',
        activeFilePath: '',
        oracleStatuses: { linter: 'pass', compiler: 'pass', tests: 'fail' },
        lastOraclePass: false
      }
    }, '*');
  });
  const runScreenshot = path.join(artifacts, 'visual-smoke-run.png');
  await page.screenshot({ path: runScreenshot, fullPage: true });
  await page.evaluate(() => {
    window.postMessage({
      command: 'weak-eval-report',
      report: {
        passed: true,
        status: 'uplift_observed',
        generatedAt: new Date().toISOString(),
        modelId: 'qwen/qwen2.5-coder-7b-instruct',
        live: false,
        taskCount: 15,
        bareSolved: 1,
        harnessSolved: 15,
        solveRateDelta: 0.9333,
        meanHarnessSteps: 1,
        providerCalls: 30,
        providerFailures: 0,
        fallbackProposals: 0,
        actuallyModelDriven: 15,
        fallbackSolved: 0,
        cost: 0,
        reportPath: 'F:/DEV_ENV/projects/Agent_Harness_Extension/.forge/evals/latest-weak-model-eval.json',
        tasks: []
      }
    }, '*');
    window.postMessage({
      command: 'verification-matrix-report',
      report: {
        passed: true,
        generatedAt: new Date().toISOString(),
        reportPath: 'F:/DEV_ENV/projects/Agent_Harness_Extension/.forge/verification-fixture-matrix.json',
        cases: [
          { id: 'passing-tests' },
          { id: 'failing-tests' },
          { id: 'missing-test-suite' },
          { id: 'typecheck-failure' },
          { id: 'lint-failure' },
          { id: 'malformed-patch' },
          { id: 'out-of-workspace-path' },
          { id: 'blocked-command' },
          { id: 'unsolvable-step-cap' }
        ]
      }
    }, '*');
    window.postMessage({
      command: 'isolated-run-report',
      report: {
        generatedAt: new Date().toISOString(),
        goal: 'Run Forge Agent in an isolated workspace copy.',
        sourceRoot: 'F:/DEV_ENV/projects/Agent_Harness_Extension',
        isolatedRoot: 'C:/Users/Moshi/AppData/Local/Temp/forge-isolated-run-demo',
        keptIsolated: true,
        sourceMutated: false,
        changedFiles: ['src/math.js'],
        addedFiles: [],
        deletedFiles: [],
        stateStatus: 'success',
        steps: 5,
        statePath: 'C:/Users/Moshi/AppData/Local/Temp/forge-isolated-run-demo/.forge/state.json',
        diffPath: 'F:/DEV_ENV/projects/Agent_Harness_Extension/.forge/isolated-runs/latest-isolated-run.diff',
        reportPath: 'F:/DEV_ENV/projects/Agent_Harness_Extension/.forge/isolated-runs/latest-isolated-run.json'
      }
    }, '*');
  });
  await page.click('[data-testid="view-proof"]');
  await page.waitForSelector('[data-testid="proof-panel"]', { timeout: 5000 });
  await page.waitForSelector('[data-testid="verification-matrix-summary"]', { timeout: 5000 });
  await page.waitForSelector('[data-testid="isolated-run-summary"]', { timeout: 5000 });
  const proofScreenshot = path.join(artifacts, 'visual-smoke-proof.png');
  await page.screenshot({ path: proofScreenshot, fullPage: true });
  await page.click('[data-testid="view-settings"]');
  await page.waitForSelector('[data-testid="settings-panel"]', { timeout: 5000 });
  const screenshot = path.join(artifacts, 'visual-smoke.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`visual smoke: PASS ${runScreenshot} ${proofScreenshot} ${screenshot}`);
} catch (err) {
  console.error(browserErrors.join('\n') || 'No browser errors captured.');
  throw err;
} finally {
  await browser.close();
  server.close();
}

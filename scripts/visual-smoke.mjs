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
        projectAdapter: {
          version: 1, id: 'node-visual', ecosystem: 'node', manifest: 'package.json', packageManager: 'npm', detectedAt: new Date().toISOString(), fingerprint: 'visual', evidence: ['package.json detected.'],
          commands: {
            test: { kind: 'test', command: 'npm run test', required: true, source: 'package.json#scripts.test' },
            lint: { kind: 'lint', command: 'npm run lint', required: true, source: 'package.json#scripts.lint' },
            typecheck: { kind: 'typecheck', command: 'npm run typecheck', required: true, source: 'package.json#scripts.typecheck' },
            build: { kind: 'build', command: 'npm run build', required: true, source: 'package.json#scripts.build' }
          }
        },
        skills: [{ id: 'skill-visual', name: 'Use red-oracle output as repair context', description: 'Verified recovery.', workflow: ['Read oracle output.', 'Apply bounded fix.', 'Rerun tests.'], category: 'oracle_recovery', triggerTokens: ['oracle', 'reflection'], confidence: 0.82, occurrences: 2, successfulRuns: 2, useCount: 1, sourceSessionIds: ['prior-session'], appliedSessionIds: ['visual-reflection-smoke'] }],
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
          recentBlockers: ['oracle: Tests failed. -> Use the failing oracle output to revise the implementation before rerunning tests.'],
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
        workerContexts: {
          Reviewer: {
            role: 'Reviewer',
            sessionId: 'forge-visual:worker:reviewer',
            allowedTools: ['run_tests', 'run_command', 'get_diff', 'record_evidence', 'declare_success'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            providerCalls: 1,
            acceptedProposals: 1,
            rejectedProposals: 1,
            processExecutions: 2,
            processFailures: 0,
            lastWorkerPid: 4242,
            lastWorkerDurationMs: 38,
            lastWorkerBlockedEnvKeys: ['OPENROUTER_API_KEY', 'FORGE_WORKER_SECRET'],
            recentTools: ['apply_patch', 'run_tests'],
            lastTaskId: '4',
            lastTaskTitle: 'Retry after red oracle reflection'
          }
        },
        blockers: [
          {
            id: 'blocker-visual',
            source: 'oracle',
            category: 'oracle',
            status: 'open',
            retryable: true,
            taskId: '4',
            taskTitle: 'Retry after red oracle reflection',
            role: 'Reviewer',
            summary: 'Tests failed.',
            suggestedAction: 'Use the failing oracle output to revise the implementation before rerunning tests.',
            occurrences: 1,
            firstSeenAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
          }
        ],
        semanticRetrieval: {
          generatedAt: new Date().toISOString(),
          status: 'ready',
          provider: 'openrouter',
          modelId: 'openai/text-embedding-3-small',
          query: 'Validate reflection UI counters.',
          cacheHits: 18,
          embeddedDocuments: 2,
          candidates: [{ path: 'src/example.ts', similarity: 0.91 }]
        },
        workerEditTransactions: [
          {
            id: 'edit-visual', role: 'Editor', proposalName: 'apply_patch', targetPath: 'src/example.ts', mode: 'git-worktree', sourceHashBefore: 'before-hash', sourceHashAtMerge: 'before-hash', stagedHash: 'after-hash', baseCommit: 'abc123', committed: true, conflict: false, cleanupSucceeded: true, workerPid: 4242, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 75
          }
        ],
        workerCommandTransactions: [
          {
            id: 'command-visual', role: 'Reviewer', command: 'node scripts/write-fixture.js', mode: 'git-worktree', baseCommit: 'abc123', changedFiles: ['generated/output.txt'], created: ['generated/output.txt'], modified: [], deleted: [], mergedFileCount: 1, mergedBytes: 32, committed: true, conflict: false, rollbackAttempted: false, rollbackSucceeded: false, cleanupSucceeded: true, workerPid: 4243, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 90
          }
        ],
        clarifications: [],
        oracleFailures: [{ id: 'oracle-failure-visual', signature: 'build-signature', kind: 'build', category: 'build_failure', command: 'npm run build', source: 'package.json#scripts.build', required: true, status: 'open', occurrences: 3, taskId: '3', taskTitle: 'Repair build', role: 'Editor', outputExcerpt: 'Module not found: src/runtime.ts', guidance: 'Reproduce the exact build command and repair the first module failure.', firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }],
        workflow: {
          version: 1,
          lane: 'full',
          laneReason: 'Behavioral task uses the full lane.',
          currentStage: 'review',
          stages: ['classify', 'plan', 'baseline', 'reconcile', 'document_plan', 'implement', 'validate', 'review', 'document_close', 'aar', 'complete'].map((id, index) => ({ id, status: index < 7 ? 'completed' : 'pending', evidence: [] })),
          acceptance: { boundedUnit: 'Validate workflow governance.', assumptions: [], inScope: [], outOfScope: [], risks: [], rollbackMethod: 'transaction', acceptanceCriteria: ['tests pass'], requiredValidation: ['tests'], negativePaths: ['bypass rejected'], evidenceArtifacts: [] },
          baseline: { capturedAt: new Date().toISOString(), workspaceRoot: 'F:/fixture', packageVersion: '0.68.0', gitHead: 'abc123', gitStatus: [], fileCount: 12, existingForgeState: false, rollbackMethod: 'transaction' },
          violations: [], capabilityMapDelta: 'no capability-map delta', generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
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
              blockedEnvKeys: ['OPENROUTER_API_KEY', 'FORGE_SANDBOX_SECRET'],
              network: {
                detected: true,
                risk: 'read',
                decision: 'allowed',
                operations: ['curl-request'],
                endpoints: ['https://example.test/status'],
                reason: 'Allowed read-only network intent with audit capture: curl-request.'
              }
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
          networkIntentCaptures: 1,
          networkWriteBlocks: 2,
          roleCapabilityBlocks: 1,
          workerProcessExecutions: 4,
          workerProcessFailures: 0,
          blockerEvents: 3,
          openBlockers: 1,
          resolvedBlockers: 2,
          semanticRefreshes: 1,
          semanticFailures: 0,
          semanticCacheHits: 18,
          semanticEmbeddedDocuments: 2,
          editTransactions: 1,
          editTransactionConflicts: 0,
          worktreeEditTransactions: 1,
          sparseEditTransactions: 0,
          commandTransactions: 1,
          commandTransactionConflicts: 0,
          commandTransactionMergedFiles: 1,
          commandTransactionRollbacks: 0,
          skillRetrievals: 2,
          skillApplications: 1,
          workflowGateBlocks: 0,
          clarificationRequests: 0,
          clarificationAnswers: 0,
          clarificationGateBlocks: 0,
          oracleFailureCaptures: 1,
          repeatedOracleFailures: 2,
          oracleFailureResolutions: 0,
          remediationGuidanceInjections: 1,
          oracleStagnationHalts: 1,
          budgetHalts: 0,
          noProgressTurns: 0,
          lastProgressSignature: '',
          actuallyModelDriven: true
        },
        currentStepIndex: 4,
        maxSteps: 30,
        status: 'gave_up',
        haltReason: 'Oracle stagnation: build/build_failure repeated 3 times without changing signature build-signat.',
        activeSubAgent: 'Reviewer',
        activeFilePath: '',
        oracleStatuses: { linter: 'pass', compiler: 'pass', tests: 'pass', build: 'fail' },
        lastOraclePass: false
      }
    }, '*');
    window.postMessage({ command: 'chat-response', text: 'Forge stopped honestly: the same build failure repeated three times without a changed diagnostic. No success or green evidence was recorded.' }, '*');
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

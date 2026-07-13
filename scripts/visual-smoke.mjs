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
  window.__forgePosted = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (message) => {
      window.__forgePosted.push(message);
      if (message?.command === 'search-context-mentions') {
        setTimeout(() => window.postMessage({
          command: 'context-mention-results', requestId: message.requestId, provenance: 'ready', truncated: false,
          candidates: [
            { kind: 'folder', path: 'src', label: 'src/', detail: 'src/ · folder' },
            { kind: 'file', path: 'src/auth/session.ts', label: 'session.ts', detail: 'src/auth/session.ts · ts' },
            { kind: 'file', path: 'src/auth/token.ts', label: 'token.ts', detail: 'src/auth/token.ts · ts' }
          ]
        }, '*'), 0);
      }
      if (message?.command === 'load-prompt-enhancement-settings') {
        setTimeout(() => window.postMessage({ command: 'prompt-enhancement-settings', modelId: 'google/gemini-2.5-flash-lite' }, '*'), 0);
      }
      if (message?.command === 'enhance-prompt') {
        setTimeout(() => window.postMessage({ command: 'prompt-enhanced', result: {
          modelId: 'google/gemini-2.5-flash-lite',
          enhancedPrompt: 'Objective:\nFix the parser defect.\n\nScope:\nChange only the parser and its focused tests.\n\nDone when:\n- Focused and existing parser tests pass.\n\nRequired evidence:\n- Focused test output and bounded diff.',
          usage: { totalCost: 0.00004 }
        } }, '*'), 0);
      }
    },
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
        sessionId: 'forge-1783900000000-visual',
        humanApprovalPolicy: 'ask',
        pendingHumanApproval: {
          id: 'approval-visual-01', sessionId: 'forge-1783900000000-visual', taskId: '3', taskTitle: 'Apply scoped code changes through the firewall', role: 'Editor',
          proposal: { name: 'apply_patch', arguments: { path: 'src/auth/session.ts', patchContent: 'bounded patch content' } }, proposalDigest: '0a1b2c3d4e5f',
          summary: 'src/auth/session.ts · validated patch', status: 'pending', requestedAt: new Date().toISOString()
        },
        humanApprovals: [],
        modePolicy: { id: 'custom-no-shell', name: 'No Shell Code', intent: 'code', instructions: 'Use file tools and tests.', allowedTools: ['update_plan', 'run_tests', 'get_diff', 'record_evidence', 'ask_user', 'declare_success', 'read_file', 'apply_patch', 'write_file'] },
        goalContract: { goal: 'Validate reflection UI counters.', context: '', constraints: [], doneWhen: [], nonGoals: [], budget: 2, spent: 0 },
        taskGraph: { tasks: [{ id: '3', title: 'Repair the failing build', status: 'running', dependencies: [], blockers: [], owner: 'Editor' }] },
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
            strategy: 'workspace-snapshot',
            proposalName: 'apply_patch',
            protectedPaths: ['.'],
            manifestPath: '.forge/checkpoints/step-3-demo/manifest.json',
            timestamp: new Date().toISOString()
          }
        ],
        checkpointRestores: [],
        browserValidations: [
          {
            id: 'browser-demo',
            status: 'pass',
            requestedUrl: 'http://127.0.0.1:3000/',
            finalUrl: 'http://127.0.0.1:3000/',
            title: 'Forge fixture application',
            expectedText: 'Run task',
            expectedTextFound: true,
            screenshotPath: '.forge/browser-runs/latest-browser-validation.png',
            reportPath: '.forge/browser-runs/latest-browser-validation.json',
            completedAt: new Date().toISOString()
          }
        ],
        progressEvents: [
          { id: 'demo:progress:1', sequence: 1, sessionId: 'demo', stepIndex: 4, kind: 'tool_finished', status: 'pass', summary: 'run_tests completed.', detail: 'Tests passed but the required build remained red.', role: 'Reviewer', taskId: '4', taskTitle: 'Verify the implementation', phase: 'COMMIT', toolName: 'run_tests', timestamp: new Date().toISOString() },
          { id: 'demo:progress:2', sequence: 2, sessionId: 'demo', stepIndex: 4, kind: 'oracle', status: 'fail', summary: 'Required project checks are still red.', detail: 'lint=pass, typecheck=pass, tests=pass, build=fail', role: 'Oracle', taskId: '4', taskTitle: 'Verify the implementation', phase: 'NARRATE', toolName: 'run_tests', timestamp: new Date().toISOString() },
          { id: 'demo:progress:3', sequence: 3, sessionId: 'demo', stepIndex: 4, kind: 'reflection', status: 'warning', summary: 'Build failure queued for bounded repair.', detail: 'Use the typed build remediation capsule.', role: 'Reviewer', taskId: '4', taskTitle: 'Verify the implementation', phase: 'NARRATE', timestamp: new Date().toISOString() },
          { id: 'demo:progress:4', sequence: 4, sessionId: 'demo', stepIndex: 5, kind: 'step_started', status: 'running', summary: 'Step 5: Repair the failing build', role: 'Editor', taskId: '3', taskTitle: 'Repair the failing build', phase: 'IDLE', timestamp: new Date().toISOString() },
          { id: 'demo:progress:5', sequence: 5, sessionId: 'demo', stepIndex: 5, kind: 'provider_wait', status: 'running', summary: 'Editor is preparing the next action.', detail: 'Task: Repair the failing build', role: 'Editor', taskId: '3', taskTitle: 'Repair the failing build', phase: 'IDLE', timestamp: new Date().toISOString() },
          { id: 'demo:progress:6', sequence: 6, sessionId: 'demo', stepIndex: 5, kind: 'proposal', status: 'pending', summary: 'Editor proposed apply_patch.', detail: 'Patch the validated session implementation.', role: 'Editor', taskId: '3', taskTitle: 'Repair the failing build', phase: 'PROPOSE', toolName: 'apply_patch', timestamp: new Date().toISOString() },
          { id: 'demo:progress:7', sequence: 7, sessionId: 'demo', stepIndex: 5, kind: 'validation', status: 'pass', summary: 'Validated apply_patch.', detail: 'Proposal accepted by deterministic validator and pre-commit review.', role: 'Firewall', taskId: '3', taskTitle: 'Repair the failing build', phase: 'VALIDATE', toolName: 'apply_patch', timestamp: new Date().toISOString() },
          { id: 'demo:progress:8', sequence: 8, sessionId: 'demo', stepIndex: 5, kind: 'awaiting_approval', status: 'warning', summary: 'Approve apply_patch before Forge changes the workspace.', detail: 'src/auth/session.ts · validated patch', role: 'Editor', taskId: '3', taskTitle: 'Repair the failing build', phase: 'VALIDATE', toolName: 'apply_patch', timestamp: new Date().toISOString() }
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
          oracleStagnationHalts: 0,
          humanApprovalRequests: 1,
          humanApprovalApprovals: 0,
          humanApprovalRejections: 0,
          checkpointRestores: 0,
          checkpointRestoreFailures: 0,
          browserValidations: 1,
          browserValidationFailures: 0,
          progressEventsEmitted: 8,
          budgetHalts: 0,
          noProgressTurns: 0,
          lastProgressSignature: '',
          actuallyModelDriven: true
        },
        currentStepIndex: 5,
        maxSteps: 30,
        status: 'awaiting_approval',
        haltReason: 'Awaiting approval for apply_patch.',
        activeSubAgent: 'Editor',
        activeFilePath: '',
        oracleStatuses: { linter: 'pass', compiler: 'pass', tests: 'pass', build: 'fail' },
        lastOraclePass: false
      }
    }, '*');
    window.postMessage({ command: 'chat-response', text: 'I found the build failure and prepared a validated patch. Review the pending action below; nothing has changed yet.' }, '*');
    window.postMessage({ command: 'provider-readiness', readiness: {
      provider: 'openrouter', ready: true, workspaceOpen: true,
      credential: { required: true, configured: true, source: 'secret-storage', valid: true },
      authentication: { status: 'pass', latencyMs: 92 }, catalog: { status: 'live', modelCount: 340 },
      blockers: [], checkedAt: new Date().toISOString()
    } }, '*');
    window.postMessage({ command: 'workspace-index-status', status: {
      status: 'ready', fileCount: 1842, symbolCount: 6391, ignoredCount: 217, truncated: false,
      generatedAt: new Date().toISOString(), fingerprint: 'visual-index-fingerprint'
    } }, '*');
    window.postMessage({ command: 'composer-context', sessionId: 'forge-1783900000000-visual', attachments: [
      { id: 'ctx-visual-file', kind: 'file', label: 'session.ts', path: 'src/auth/session.ts', byteCount: 1834, capturedAt: new Date().toISOString() },
      { id: 'ctx-visual-diagnostics', kind: 'diagnostics', label: 'Diagnostics (3)', diagnosticCount: 3, byteCount: 326, capturedAt: new Date().toISOString() }
    ] }, '*');
    window.postMessage({ command: 'modes-list', modes: [
      { id: 'code', name: 'Code', description: 'Default governed coding agent.', instructions: 'Implement through Forge.', intent: 'code', modelRole: 'code', inference: 'Instant', allowedTools: [], builtIn: true },
      { id: 'architect', name: 'Architect', description: 'Architecture guidance without mutation.', instructions: 'Analyze and plan.', intent: 'architect', modelRole: 'plan', inference: 'Thinking', allowedTools: [], builtIn: true },
      { id: 'ask', name: 'Ask', description: 'Answer without changing files.', instructions: 'Explain clearly.', intent: 'ask', modelRole: 'plan', inference: 'Instant', allowedTools: [], builtIn: true },
      { id: 'custom-no-shell', name: 'No Shell Code', description: 'Governed coding without shell commands.', instructions: 'Use file tools and tests.', intent: 'code', modelRole: 'code', inference: 'Thinking', allowedTools: ['update_plan', 'run_tests', 'get_diff', 'record_evidence', 'ask_user', 'declare_success', 'read_file', 'apply_patch', 'write_file'], builtIn: false }
    ] }, '*');
    window.postMessage({ command: 'sessions-list', corruptCount: 1, sessions: [
      { sessionId: 'forge-1783900000001-paused', title: 'Repair authentication race', pinned: true, createdAt: '2026-07-12T17:00:00.000Z', updatedAt: new Date().toISOString(), status: 'paused', steps: 7, costUsd: 0.0432, resumable: true },
      { sessionId: 'forge-1783900000000-visual', title: 'Validate reflection UI counters', pinned: false, createdAt: '2026-07-12T16:00:00.000Z', updatedAt: new Date(Date.now() - 3600000).toISOString(), status: 'gave_up', steps: 4, costUsd: 0, resumable: false },
      { sessionId: 'forge-1783900000002-question', title: 'Choose database migration policy', pinned: false, createdAt: '2026-07-12T15:00:00.000Z', updatedAt: new Date(Date.now() - 7200000).toISOString(), status: 'awaiting_input', steps: 2, costUsd: 0.011, resumable: false },
      { sessionId: 'forge-chat-1783900000003-explain', title: 'Explain repository architecture', pinned: false, createdAt: '2026-07-12T14:00:00.000Z', updatedAt: new Date(Date.now() - 10800000).toISOString(), status: 'chat', steps: 0, costUsd: 0, resumable: false }
    ] }, '*');
  });
  await page.click('[data-testid="checkpoint-history-toggle"]');
  await page.waitForSelector('[data-testid="checkpoint-history"]');
  await page.waitForSelector('[data-testid="run-activity"]');
  const progressRows = await page.locator('[data-testid^="progress-"]').count();
  if (progressRows < 6) throw new Error(`Expected streamed progress rows, found ${progressRows}.`);
  await page.click('[data-testid="restore-checkpoint-step-3-demo"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="restore-checkpoint-step-3-demo"]')?.textContent?.includes('Confirm'));
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
  await page.evaluate(() => {
    window.postMessage({ command: 'difficult-proof-report', report: {
      runId: 'tier4-live-visual', modelId: 'qwen/qwen-2.5-7b-instruct', live: true, tier: 4,
      outcome: 'model_capability_without_uplift', capabilityGatePassed: false,
      taskCount: 4, completedTaskCount: 4, bareSolved: 1, harnessSolved: 1,
      harnessModelDrivenSolved: 1, fallbackSolved: 0, providerCalls: 36, providerFailures: 0, costUsd: 0.0072
    } }, '*');
  });
  await page.click('[data-testid="difficult-live-proof"] summary');
  await page.waitForSelector('[data-testid="difficult-proof-summary"]');
  await page.click('[data-testid="confirm-live-spend"]');
  if (await page.locator('[data-testid="run-difficult-live-proof"]').isDisabled()) throw new Error('Live proof should enable only after explicit spend confirmation.');
  const difficultProofScreenshot = path.join(artifacts, 'visual-smoke-difficult-proof.png');
  await page.screenshot({ path: difficultProofScreenshot, fullPage: true });
  await page.locator('[data-testid="difficult-proof-summary"]').scrollIntoViewIfNeeded();
  const difficultProofResultScreenshot = path.join(artifacts, 'visual-smoke-difficult-proof-result.png');
  await page.screenshot({ path: difficultProofResultScreenshot, fullPage: true });
  await page.evaluate(() => {
    window.postMessage({ command: 'production-benchmark-report', report: {
      runId: 'production-visual', modelId: 'qwen/qwen-2.5-7b-instruct', live: true,
      taskCount: 16, bareSolved: 2, harnessSolved: 9, harnessModelDrivenSolved: 9,
      falseSuccessCount: 0, benchmarkPassed: true, releaseReady: false
    } }, '*');
  });
  await page.click('[data-testid="production-benchmark"] summary');
  await page.waitForSelector('[data-testid="production-benchmark-summary"]');
  if (!(await page.locator('[data-testid="run-production-benchmark"]').isDisabled())) throw new Error('Production benchmark must remain disabled before its own spend confirmation.');
  await page.click('[data-testid="confirm-production-spend"]');
  if (await page.locator('[data-testid="run-production-benchmark"]').isDisabled()) throw new Error('Production benchmark should enable only after explicit spend confirmation.');
  const productionBenchmarkScreenshot = path.join(artifacts, 'visual-smoke-production-benchmark.png');
  await page.locator('[data-testid="production-benchmark"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: productionBenchmarkScreenshot, fullPage: true });
  await page.setViewportSize({ width: 520, height: 920 });
  const productionBenchmarkSidebarScreenshot = path.join(artifacts, 'visual-smoke-production-benchmark-sidebar.png');
  await page.locator('[data-testid="production-benchmark"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: productionBenchmarkSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.click('[data-testid="view-settings"]');
  await page.waitForSelector('[data-testid="settings-panel"]', { timeout: 5000 });
  const screenshot = path.join(artifacts, 'visual-smoke.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.waitForSelector('[data-testid="model-picker-prompt"]');
  await page.click('[data-testid="mcp-settings"] summary');
  await page.waitForSelector('[data-testid="add-mcp-server"]');
  const mcpOnboardingScreenshot = path.join(artifacts, 'visual-smoke-mcp-onboarding.png');
  await page.screenshot({ path: mcpOnboardingScreenshot, fullPage: true });
  await page.setViewportSize({ width: 520, height: 920 });
  await page.locator('[data-testid="mcp-settings"]').scrollIntoViewIfNeeded();
  const mcpOnboardingSidebarScreenshot = path.join(artifacts, 'visual-smoke-mcp-onboarding-sidebar.png');
  await page.screenshot({ path: mcpOnboardingSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.click('[data-testid="custom-modes-settings"] summary');
  await page.waitForSelector('[data-testid="mode-name"]');
  const modesScreenshot = path.join(artifacts, 'visual-smoke-modes.png');
  await page.screenshot({ path: modesScreenshot, fullPage: true });
  await page.click('[data-testid="view-run"]');
  if (await page.locator('[data-testid="checkpoint-history"]').count()) await page.click('[data-testid="checkpoint-history-toggle"]');
  await page.fill('[data-testid="chat-input"]', 'fix parser bug');
  const submitCountBeforeEnhance = await page.evaluate(() => window.__forgePosted.filter(message => message?.command === 'submit-message').length);
  await page.click('[data-testid="enhance-prompt"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="chat-input"]')?.value?.startsWith('Objective:'));
  const submitCountAfterEnhance = await page.evaluate(() => window.__forgePosted.filter(message => message?.command === 'submit-message').length);
  if (submitCountAfterEnhance !== submitCountBeforeEnhance) throw new Error('Prompt enhancement must not auto-submit the draft.');
  const promptEnhancementScreenshot = path.join(artifacts, 'visual-smoke-prompt-enhancement.png');
  await page.screenshot({ path: promptEnhancementScreenshot, fullPage: true });
  await page.setViewportSize({ width: 520, height: 920 });
  const promptEnhancementSidebarScreenshot = path.join(artifacts, 'visual-smoke-prompt-enhancement-sidebar.png');
  await page.screenshot({ path: promptEnhancementSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.fill('[data-testid="chat-input"]', '');
  await page.click('[data-testid="sessions-toggle"]');
  await page.waitForSelector('[data-testid="sessions-menu"]');
  await page.waitForSelector('[data-testid="resume-session-forge-1783900000001-paused"]');
  const sessionsScreenshot = path.join(artifacts, 'visual-smoke-sessions.png');
  await page.screenshot({ path: sessionsScreenshot, fullPage: true });
  await page.setViewportSize({ width: 520, height: 920 });
  const sessionsSidebarScreenshot = path.join(artifacts, 'visual-smoke-sessions-sidebar.png');
  await page.screenshot({ path: sessionsSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.click('[data-testid="sessions-toggle"]');
  await page.waitForSelector('[data-testid="human-approval-card"]');
  await page.waitForSelector('[data-testid="approve-human-approval"]');
  const approvalScreenshot = path.join(artifacts, 'visual-smoke-human-approval.png');
  await page.screenshot({ path: approvalScreenshot, fullPage: true });
  await page.setViewportSize({ width: 520, height: 920 });
  const approvalSidebarScreenshot = path.join(artifacts, 'visual-smoke-human-approval-sidebar.png');
  await page.screenshot({ path: approvalSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.click('[data-testid="workspace-index-toggle"]');
  await page.waitForSelector('[data-testid="workspace-index-popover"]');
  if ((await page.locator('[data-testid="workspace-index-state"]').textContent())?.trim() !== 'ready') throw new Error('Workspace index popover did not render ready status.');
  const indexScreenshot = path.join(artifacts, 'visual-smoke-workspace-index.png');
  await page.screenshot({ path: indexScreenshot, fullPage: true });
  await page.setViewportSize({ width: 520, height: 920 });
  const indexSidebarScreenshot = path.join(artifacts, 'visual-smoke-workspace-index-sidebar.png');
  await page.screenshot({ path: indexSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.click('[data-testid="workspace-index-toggle"]');
  await page.click('[data-testid="composer-context-toggle"]');
  await page.waitForSelector('[data-testid="composer-context-menu"]');
  await page.waitForSelector('[data-testid="composer-context-chips"]');
  const contextScreenshot = path.join(artifacts, 'visual-smoke-composer-context.png');
  await page.screenshot({ path: contextScreenshot, fullPage: true });
  const contextSidebarScreenshot = path.join(artifacts, 'visual-smoke-composer-context-sidebar.png');
  await page.setViewportSize({ width: 520, height: 920 });
  await page.screenshot({ path: contextSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.click('[data-testid="composer-context-toggle"]');
  await page.fill('[data-testid="chat-input"]', '@src');
  await page.waitForSelector('[data-testid="context-mention-menu"]');
  await page.waitForSelector('[data-testid="mention-option-folder-0"]');
  const mentionScreenshot = path.join(artifacts, 'visual-smoke-context-mentions.png');
  await page.screenshot({ path: mentionScreenshot, fullPage: true });
  const mentionSidebarScreenshot = path.join(artifacts, 'visual-smoke-context-mentions-sidebar.png');
  await page.setViewportSize({ width: 520, height: 920 });
  await page.screenshot({ path: mentionSidebarScreenshot, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.press('[data-testid="chat-input"]', 'ArrowDown');
  await page.waitForTimeout(50);
  await page.press('[data-testid="chat-input"]', 'Enter');
  const mentionAttach = await page.evaluate(() => window.__forgePosted.filter(message => message.command === 'attach-context-mention').at(-1));
  if (mentionAttach?.kind !== 'file' || mentionAttach?.path !== 'src/auth/session.ts') throw new Error(`Keyboard @ mention selection did not attach the highlighted file: ${JSON.stringify(mentionAttach)}`);
  if (await page.inputValue('[data-testid="chat-input"]')) throw new Error('Selected @ mention token was not removed from the composer.');
  await page.waitForSelector('[data-testid="report-problem"]');
  await page.hover('[data-testid="report-problem"]');
  const supportScreenshot = path.join(artifacts, 'visual-smoke-support.png');
  await page.screenshot({ path: supportScreenshot, fullPage: true });
  await page.evaluate(() => {
    window.postMessage({ command: 'provider-readiness', readiness: {
      provider: 'openrouter', ready: false, workspaceOpen: true,
      credential: { required: true, configured: false, source: 'none', valid: null },
      authentication: { status: 'skipped', latencyMs: 0 }, catalog: { status: 'live', modelCount: 340 },
      blockers: [{ code: 'credential_missing', message: 'Add an OpenRouter API key to continue.' }], checkedAt: new Date().toISOString()
    } }, '*');
  });
  await page.waitForSelector('[data-testid="first-run-onboarding"]');
  if (await page.locator('[data-testid="onboarding-api-key"]').getAttribute('type') !== 'password') throw new Error('Onboarding key field is not password-protected.');
  if (await page.locator('[data-testid="onboarding-api-key"]').inputValue()) throw new Error('Onboarding rendered a credential value.');
  const onboardingScreenshot = path.join(artifacts, 'visual-smoke-onboarding.png');
  await page.screenshot({ path: onboardingScreenshot, fullPage: true });
  console.log(`visual smoke: PASS ${runScreenshot} ${proofScreenshot} ${difficultProofScreenshot} ${difficultProofResultScreenshot} ${productionBenchmarkScreenshot} ${productionBenchmarkSidebarScreenshot} ${screenshot} ${mcpOnboardingScreenshot} ${mcpOnboardingSidebarScreenshot} ${promptEnhancementScreenshot} ${promptEnhancementSidebarScreenshot} ${modesScreenshot} ${sessionsScreenshot} ${sessionsSidebarScreenshot} ${approvalScreenshot} ${approvalSidebarScreenshot} ${indexScreenshot} ${indexSidebarScreenshot} ${contextScreenshot} ${contextSidebarScreenshot} ${mentionScreenshot} ${mentionSidebarScreenshot} ${supportScreenshot} ${onboardingScreenshot}`);
} catch (err) {
  console.error(browserErrors.join('\n') || 'No browser errors captured.');
  throw err;
} finally {
  await browser.close();
  server.close();
}

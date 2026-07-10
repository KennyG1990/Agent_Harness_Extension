import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('kennyg.forge-agent');
  assert.ok(extension, 'Forge Agent extension should be discoverable.');
  await extension.activate();

  await vscode.commands.executeCommand('forge-agent.openStudio');
  const initialDiagnostics: any = await vscode.commands.executeCommand('forge-agent.diagnostics');
  assert.ok(initialDiagnostics, 'diagnostics command should return an object.');
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspace, 'fixture workspace should be open.');

  const { AgentHarnessLoop } = await import('../../harness/loop');
  const { Firewall } = await import('../../harness/firewall');
  const { WorkspaceTools } = await import('../../harness/tools');
  const { runIsolatedAgentGoal } = await import('../../harness/isolation');
  const loop = new AgentHarnessLoop();
  let state = await loop.initializeHarness('Validate fixture workspace.');
  assert.ok(state.sessionId, 'state should include a session id.');
  assert.equal(state.status, 'idle');

  while (!['success', 'failed', 'gave_up'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
    state = await loop.runStep(state);
  }
  assert.equal(state.status, 'success', 'success requires green evidence.');
  assert.equal(state.oracleStatuses.tests, 'pass', 'fixture test oracle should pass.');
  assert.ok(state.taskGraph.tasks.some((task: any) => task.owner === 'Explorer'), 'real harness run should include an inspection phase.');
  assert.ok(state.taskGraph.tasks.some((task: any) => task.owner === 'Editor'), 'real harness run should include an editor phase.');
  assert.ok(state.evidenceLedger.some((item: any) => item.testResult?.pass === true), 'green evidence should be recorded.');
  assert.ok(state.diffReviews.some((item: any) => item.status === 'approved' || item.status === 'no_changes'), 'success should include a reviewer diff gate.');
  assert.ok(state.runStats.reviewerApprovals >= 1, 'reviewer approval should be counted before success.');
  assert.ok(state.reviewerCritiques.some((item: any) => item.source === 'deterministic' || item.source === 'model'), 'success should include a reviewer critique artifact.');
  assert.ok(state.runStats.reviewerCritiques >= 1, 'reviewer critique should be counted before success.');
  assert.ok(state.preCommitReviews.some((item: any) => item.status === 'approved'), 'mutating proposals should include pre-commit review artifacts.');
  assert.ok(state.runStats.preCommitReviews >= 1, 'pre-commit reviews should be counted.');
  const initialPersistedReviews = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'diff-reviews.json'), 'utf8'));
  assert.ok(Array.isArray(initialPersistedReviews) && initialPersistedReviews.length > 0, 'diff reviews should persist as an artifact.');
  const initialPersistedCritiques = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'reviewer-critiques.json'), 'utf8'));
  assert.ok(Array.isArray(initialPersistedCritiques) && initialPersistedCritiques.length > 0, 'reviewer critiques should persist as an artifact.');
  const initialPersistedPreCommit = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'precommit-reviews.json'), 'utf8'));
  assert.ok(Array.isArray(initialPersistedPreCommit) && initialPersistedPreCommit.length > 0, 'pre-commit reviews should persist as an artifact.');
  assert.ok(typeof state.runStats.providerCalls === 'number', 'normal harness state should persist provider call stats.');
  assert.ok(typeof state.runStats.fallbackProposals === 'number', 'normal harness state should persist fallback proposal stats.');
  assert.ok(typeof state.runStats.modelDrivenProposals === 'number', 'normal harness state should persist model-driven proposal stats.');
  assert.ok(state.contextBundle?.retrievalPolicy?.length > 0, 'context bundle should include retrieval policy.');
  assert.ok(state.contextBundle?.retrievalCandidates?.length > 0, 'context bundle should include ranked retrieval candidates.');
  assert.ok(state.runStats.contextRefreshes > 0, 'context bundle refreshes should be counted.');
  assert.ok(state.runStats.roleHandoffRefreshes > 0, 'role handoff refreshes should be counted.');
  assert.ok(state.runStats.retrievalRefreshes > 0, 'retrieval refreshes should be counted.');
  assert.ok(state.runStats.safetyCheckpoints > 0, 'mutating proposals should create safety checkpoints.');
  assert.ok(Object.keys(state.roleHandoffs || {}).length > 0, 'role handoffs should be captured during a real run.');
  assert.ok(state.safetyCheckpoints.some((checkpoint: any) => checkpoint.manifestPath && checkpoint.protectedPaths?.length), 'safety checkpoints should include manifest paths and protected path scopes.');
  const persistedContext = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'context-bundle.json'), 'utf8'));
  assert.equal(persistedContext.goal, state.goalContract.goal, 'context bundle should rehydrate the goal.');
  assert.ok(Array.isArray(persistedContext.openTasks), 'context bundle should persist open task state.');
  assert.ok(Array.isArray(persistedContext.retrievalCandidates) && persistedContext.retrievalCandidates.length > 0, 'context bundle should persist retrieval candidates.');
  const persistedRetrieval = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'retrieval-index.json'), 'utf8'));
  assert.ok(Array.isArray(persistedRetrieval) && persistedRetrieval.some((candidate: any) => typeof candidate.path === 'string' && typeof candidate.score === 'number'), 'retrieval index should persist scored file candidates.');
  const persistedHandoffs = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'role-handoffs.json'), 'utf8'));
  assert.ok(Object.values(persistedHandoffs).some((handoff: any) => Array.isArray(handoff.allowedTools) && handoff.allowedTools.length > 0), 'role handoffs should persist allowed tool scopes.');
  const persistedSafety = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'safety-checkpoints.json'), 'utf8'));
  assert.ok(Array.isArray(persistedSafety) && persistedSafety.some((checkpoint: any) => checkpoint.manifestPath && checkpoint.strategy), 'safety checkpoints should persist checkpoint manifests.');
  const persistedCommandEffects = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'command-effects.json'), 'utf8'));
  assert.ok(Array.isArray(persistedCommandEffects), 'command effects artifact should persist.');

  const safetyWorkspace = createTempWorkspace('forge-safety-');
  fs.mkdirSync(path.join(safetyWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(safetyWorkspace, 'src', 'safe.txt'), 'before', 'utf8');
  const safetyFirewall = new Firewall(new WorkspaceTools(safetyWorkspace));
  const safetyCheckpoint = await safetyFirewall.createCheckpoint(1, { name: 'write_file', arguments: { path: 'src/safe.txt', content: 'after' } });
  fs.writeFileSync(path.join(safetyWorkspace, 'src', 'safe.txt'), 'after', 'utf8');
  assert.equal(await safetyFirewall.revertToCheckpoint(safetyCheckpoint.id), true, 'targeted safety checkpoint should revert.');
  assert.equal(fs.readFileSync(path.join(safetyWorkspace, 'src', 'safe.txt'), 'utf8'), 'before', 'targeted safety checkpoint should restore original file content.');

  let repairCalls = 0;
  const repairingProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => {
      repairCalls += 1;
      if (repairCalls === 1) {
        return { text: 'not json' };
      }
      return {
        text: JSON.stringify({
          explanation: 'Repaired schema-valid test proposal.',
          proposal: { name: 'run_tests', arguments: {} }
        })
      };
    }
  };
  const repairLoop = new AgentHarnessLoop(repairingProvider as any, createTempWorkspace('forge-repair-'));
  let repairState = await repairLoop.initializeHarness('Validate repaired provider output.');
  repairState.taskGraph.tasks[0].status = 'completed';
  repairState.taskGraph.tasks[1].status = 'completed';
  repairState.taskGraph.tasks[2].status = 'completed';
  repairState = await repairLoop.runStep(repairState, { code: 'fake/weak-model' });
  assert.ok(repairState.runStats.repairAttempts >= 1, 'malformed model output should trigger a schema repair attempt.');
  assert.ok(repairState.runStats.modelDrivenProposals >= 1, 'repaired valid model output should count as model-driven.');
  assert.equal(repairState.runStats.fallbackActions, 0, 'repaired valid model output should not be counted as fallback action.');

  let firewallCalls = 0;
  const firewallReflectionProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => {
      firewallCalls += 1;
      return {
        text: JSON.stringify(firewallCalls === 1
          ? {
              explanation: 'Bad path proposal that should be reflected on.',
              proposal: { name: 'read_file', arguments: { path: '../outside.txt' } }
            }
          : {
              explanation: 'Corrected after firewall reflection.',
              proposal: { name: 'repo_search', arguments: { query: 'fixture' } }
            })
      };
    }
  };
  const firewallLoop = new AgentHarnessLoop(firewallReflectionProvider as any, createTempWorkspace('forge-firewall-'));
  let firewallState = await firewallLoop.initializeHarness('Validate firewall reflection.');
  firewallState = await firewallLoop.runStep(firewallState, { code: 'fake/weak-model' });
  assert.equal(firewallState.status, 'idle', 'firewall rejection should queue reflection instead of terminal failure when cap remains.');
  assert.equal(firewallState.runStats.validationFailures, 1, 'firewall rejection should be counted.');
  assert.equal(firewallState.runStats.firewallReflections, 1, 'firewall rejection should create a reflection entry.');
  assert.ok(firewallState.reflections.some((entry: any) => entry.trigger === 'firewall'), 'firewall reflection should be persisted.');
  firewallState = await firewallLoop.runStep(firewallState, { code: 'fake/weak-model' });
  assert.ok(firewallState.runStats.modelDrivenProposals >= 2, 'corrected proposal should be model-driven after reflection.');

  const escalationModelCalls: string[] = [];
  let escalationCalls = 0;
  const escalationProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (options: any) => {
      escalationCalls += 1;
      escalationModelCalls.push(options.modelId);
      return {
        text: JSON.stringify(escalationCalls < 3
          ? {
              explanation: 'Bad path proposal to trigger escalation.',
              proposal: { name: 'read_file', arguments: { path: '../outside.txt' } }
            }
          : {
              explanation: 'Escalated model corrected the proposal.',
              proposal: { name: 'repo_search', arguments: { query: 'fixture' } }
            })
      };
    }
  };
  const escalationWorkspace = createTempWorkspace('forge-escalation-');
  const escalationLoop = new AgentHarnessLoop(escalationProvider as any, escalationWorkspace);
  let escalationState = await escalationLoop.initializeHarness('Validate escalation routing.');
  const escalationBindings = { code: 'cheap/model', Escalation: 'frontier/model' };
  escalationState = await escalationLoop.runStep(escalationState, escalationBindings);
  escalationState = await escalationLoop.runStep(escalationState, escalationBindings);
  escalationState = await escalationLoop.runStep(escalationState, escalationBindings);
  assert.deepEqual(escalationModelCalls.slice(0, 3), ['cheap/model', 'cheap/model', 'frontier/model'], 'third proposal should route to escalation model after repeated reflections.');
  assert.ok(escalationState.runStats.escalationCount >= 1, 'escalation should be counted.');
  assert.ok(escalationState.escalations.some((entry: any) => entry.toModel === 'frontier/model'), 'escalation model should be persisted.');
  assert.ok(fs.existsSync(path.join(escalationWorkspace, '.forge', 'escalations.json')), 'escalation artifact should persist.');

  const failingWorkspace = createTempWorkspace('forge-red-oracle-');
  fs.writeFileSync(path.join(failingWorkspace, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(1)"' }
  }, null, 2));
  const redOracleProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => ({
      text: JSON.stringify({
        explanation: 'Run failing tests to trigger oracle reflection.',
        proposal: { name: 'run_tests', arguments: {} }
      })
    })
  };
  const redOracleLoop = new AgentHarnessLoop(redOracleProvider as any, failingWorkspace);
  let redOracleState = await redOracleLoop.initializeHarness('Trigger red oracle reflection.');
  redOracleState.taskGraph.tasks[0].status = 'completed';
  redOracleState.taskGraph.tasks[1].status = 'completed';
  redOracleState.taskGraph.tasks[2].status = 'completed';
  redOracleState = await redOracleLoop.runStep(redOracleState, { code: 'fake/weak-model' });
  assert.equal(redOracleState.status, 'idle', 'red oracle should queue reflection instead of immediately ending when cap remains.');
  assert.ok(redOracleState.runStats.toolFailureReflections + redOracleState.runStats.oracleReflections >= 1, 'failing verification should create a reflection entry.');
  assert.ok(redOracleState.reflections.some((entry: any) => entry.trigger === 'tool_failure' || entry.trigger === 'red_oracle'), 'verification reflection should be persisted.');

  const reviewerModelCalls: string[] = [];
  let reviewerProviderCalls = 0;
  const reviewerProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (options: any) => {
      reviewerProviderCalls += 1;
      reviewerModelCalls.push(options.modelId);
      if (reviewerProviderCalls === 1) {
        return {
          text: JSON.stringify({
            explanation: 'Reviewer should inspect diff.',
            proposal: { name: 'get_diff', arguments: {} }
          })
        };
      }
      return {
        text: JSON.stringify({
          status: 'approved',
          summary: 'Reviewer model found no blocking concerns.',
          concerns: []
        })
      };
    }
  };
  const reviewerWorkspace = createTempWorkspace('forge-reviewer-model-');
  const reviewerLoop = new AgentHarnessLoop(reviewerProvider as any, reviewerWorkspace);
  let reviewerState = await reviewerLoop.initializeHarness('Validate reviewer model critique.');
  reviewerState.taskGraph.tasks[0].status = 'completed';
  reviewerState.taskGraph.tasks[1].status = 'completed';
  reviewerState.taskGraph.tasks[2].status = 'completed';
  reviewerState = await reviewerLoop.runStep(reviewerState, { Reviewer: 'fake/reviewer-model' });
  assert.ok(reviewerState.reviewerCritiques.some((entry: any) => entry.source === 'model' && entry.modelId === 'fake/reviewer-model'), 'configured reviewer model should produce a model critique artifact.');
  assert.ok(reviewerState.runStats.reviewerModelCritiques >= 1, 'model reviewer critique should be counted.');
  assert.ok(reviewerModelCalls.includes('fake/reviewer-model'), 'reviewer model binding should be used.');

  let preCommitCalls = 0;
  const preCommitProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => {
      preCommitCalls += 1;
      if (preCommitCalls === 1) {
        return {
          text: JSON.stringify({
            explanation: 'Patch that reviewer should block before commit.',
            proposal: {
              name: 'apply_patch',
              arguments: {
                path: 'src/block.txt',
                patchContent: '<<<<<<< SEARCH\nbefore\n=======\nafter\n>>>>>>> REPLACE'
              }
            }
          })
        };
      }
      return {
        text: JSON.stringify({
          status: 'blocked',
          summary: 'Pre-commit reviewer blocked the patch before filesystem mutation.',
          concerns: ['Intent is not established.']
        })
      };
    }
  };
  const preCommitWorkspace = createTempWorkspace('forge-precommit-');
  fs.mkdirSync(path.join(preCommitWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(preCommitWorkspace, 'src', 'block.txt'), 'before', 'utf8');
  const preCommitLoop = new AgentHarnessLoop(preCommitProvider as any, preCommitWorkspace);
  let preCommitState = await preCommitLoop.initializeHarness('Validate pre-commit review block.');
  preCommitState.taskGraph.tasks[0].status = 'completed';
  preCommitState.taskGraph.tasks[1].status = 'completed';
  preCommitState = await preCommitLoop.runStep(preCommitState, { Reviewer: 'fake/reviewer-model' });
  assert.equal(fs.readFileSync(path.join(preCommitWorkspace, 'src', 'block.txt'), 'utf8'), 'before', 'blocked pre-commit review should prevent patch mutation.');
  assert.ok(preCommitState.preCommitReviews.some((entry: any) => entry.status === 'blocked' && entry.source === 'model'), 'blocked pre-commit model review should persist.');
  assert.equal(preCommitState.runStats.preCommitBlocks, 1, 'blocked pre-commit reviews should be counted.');
  assert.equal(preCommitState.status, 'idle', 'blocked pre-commit review should queue reflection while cap remains.');

  const commandProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => ({
      text: JSON.stringify({
        explanation: 'Create a generated file through a command so side effects can be audited.',
        proposal: {
          name: 'run_command',
          arguments: {
            command: 'node -e "require(\'fs\').mkdirSync(\'generated\',{recursive:true});require(\'fs\').writeFileSync(\'generated/effect.txt\',\'created\')"'
          }
        }
      })
    })
  };
  const commandWorkspace = createTempWorkspace('forge-command-effect-');
  process.env.FORGE_SANDBOX_SECRET = 'must-not-inherit';
  const commandLoop = new AgentHarnessLoop(commandProvider as any, commandWorkspace);
  let commandState = await commandLoop.initializeHarness('Validate command side-effect capture.');
  commandState.taskGraph.tasks[0].status = 'completed';
  commandState.taskGraph.tasks[1].status = 'completed';
  commandState = await commandLoop.runStep(commandState, {});
  delete process.env.FORGE_SANDBOX_SECRET;
  assert.ok(fs.existsSync(path.join(commandWorkspace, 'generated', 'effect.txt')), 'command should create fixture file.');
  assert.ok(commandState.commandEffects.some((entry: any) => entry.created.includes('generated/effect.txt')), 'command side-effect ledger should record created file.');
  assert.ok(commandState.commandEffects.some((entry: any) => entry.sandbox?.sanitizedEnv === true), 'command side-effect ledger should record sanitized sandbox metadata.');
  assert.ok(commandState.commandEffects.some((entry: any) => entry.sandbox?.blockedEnvKeys?.includes('FORGE_SANDBOX_SECRET')), 'command sandbox should block non-allowlisted secret env keys.');
  assert.ok(commandState.commandEffects.every((entry: any) => !(entry.sandbox?.allowedEnvKeys || []).includes('FORGE_SANDBOX_SECRET')), 'command sandbox must not allow the secret env key.');
  assert.equal(commandState.runStats.commandEffectCaptures, 1, 'command side-effect capture should be counted.');
  const commandEffectsArtifact = JSON.parse(fs.readFileSync(path.join(commandWorkspace, '.forge', 'command-effects.json'), 'utf8'));
  assert.ok(commandEffectsArtifact.some((entry: any) => entry.created.includes('generated/effect.txt')), 'command side-effect artifact should persist created file.');
  assert.ok(commandEffectsArtifact.some((entry: any) => entry.sandbox?.blockedEnvKeys?.includes('FORGE_SANDBOX_SECRET')), 'command side-effect artifact should persist sandbox blocked key names.');

  let wallClockProviderCalls = 0;
  const wallClockProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => {
      wallClockProviderCalls += 1;
      return {
        text: JSON.stringify({
          explanation: 'Should not be called after wall-clock budget expires.',
          proposal: { name: 'repo_search', arguments: { query: 'budget' } }
        })
      };
    }
  };
  const wallClockLoop = new AgentHarnessLoop(wallClockProvider as any, createTempWorkspace('forge-wall-budget-'));
  let wallClockState = await wallClockLoop.initializeHarness('Validate wall-clock budget halt.', {}, {
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    maxWallClockMs: 1,
    maxCostUsd: 2
  });
  wallClockState = await wallClockLoop.runStep(wallClockState, {});
  assert.equal(wallClockState.status, 'gave_up', 'expired wall-clock budget should halt as gave_up.');
  assert.equal(wallClockProviderCalls, 0, 'wall-clock budget halt should occur before provider calls.');
  assert.equal(wallClockState.runStats.budgetHalts, 1, 'wall-clock budget halt should be counted.');
  assert.equal(wallClockState.runBudget.haltReason, 'wall_clock_exceeded', 'wall-clock halt reason should persist.');

  let costProviderCalls = 0;
  const costProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => {
      costProviderCalls += 1;
      return {
        text: JSON.stringify({
          explanation: 'Patch should not commit after cost cap is exceeded.',
          proposal: {
            name: 'apply_patch',
            arguments: {
              path: 'src/budget.txt',
              patchContent: '<<<<<<< SEARCH\nbefore\n=======\nafter\n>>>>>>> REPLACE'
            }
          }
        }),
        usage: { promptTokens: 10, completionTokens: 10, totalCost: 0.02 }
      };
    }
  };
  const costWorkspace = createTempWorkspace('forge-cost-budget-');
  fs.mkdirSync(path.join(costWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(costWorkspace, 'src', 'budget.txt'), 'before', 'utf8');
  const costLoop = new AgentHarnessLoop(costProvider as any, costWorkspace);
  let costState = await costLoop.initializeHarness('Validate cost budget halt before mutation.', {}, {
    maxWallClockMs: 60_000,
    maxCostUsd: 0.01
  });
  costState.taskGraph.tasks[0].status = 'completed';
  costState.taskGraph.tasks[1].status = 'completed';
  costState = await costLoop.runStep(costState, { code: 'fake/paid-model' });
  assert.equal(costProviderCalls, 1, 'cost budget test should make one provider call.');
  assert.equal(costState.status, 'gave_up', 'exceeded cost budget should halt as gave_up.');
  assert.equal(costState.runBudget.haltReason, 'cost_exceeded', 'cost halt reason should persist.');
  assert.equal(costState.runStats.budgetHalts, 1, 'cost budget halt should be counted.');
  assert.equal(fs.readFileSync(path.join(costWorkspace, 'src', 'budget.txt'), 'utf8'), 'before', 'cost budget halt should happen before patch mutation.');
  const persistedBudget = JSON.parse(fs.readFileSync(path.join(costWorkspace, '.forge', 'budget.json'), 'utf8'));
  assert.equal(persistedBudget.haltReason, 'cost_exceeded', 'budget artifact should persist cost halt reason.');

  let isolatedProviderCalls = 0;
  const isolatedProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => {
      isolatedProviderCalls += 1;
      const proposals = [
        { name: 'repo_search', arguments: { query: 'add' } },
        { name: 'update_plan', arguments: { planMd: '# PLAN.md\n\nPatch isolated math fixture.' } },
        {
          name: 'apply_patch',
          arguments: {
            path: 'src/math.js',
            patchContent: '<<<<<<< SEARCH\nfunction add(a, b) {\n  return a - b;\n}\n=======\nfunction add(a, b) {\n  return a + b;\n}\n>>>>>>> REPLACE'
          }
        },
        { name: 'run_tests', arguments: {} },
        { name: 'get_diff', arguments: {} }
      ];
      return {
        text: JSON.stringify({
          explanation: `Isolated proposal ${isolatedProviderCalls}.`,
          proposal: proposals[Math.min(isolatedProviderCalls - 1, proposals.length - 1)]
        })
      };
    }
  };
  const isolatedSource = createTempWorkspace('forge-isolated-source-');
  fs.mkdirSync(path.join(isolatedSource, 'src'), { recursive: true });
  fs.writeFileSync(path.join(isolatedSource, 'src', 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n', 'utf8');
  fs.writeFileSync(path.join(isolatedSource, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  fs.writeFileSync(path.join(isolatedSource, 'test.js'), "const assert = require('assert');\nconst { add } = require('./src/math');\nassert.equal(add(2, 3), 5);\nconsole.log('pass isolated');\n", 'utf8');
  const isolatedReport = await runIsolatedAgentGoal({
    sourceRoot: isolatedSource,
    goal: 'Fix math in isolated workspace only.',
    maxSteps: 6,
    keepIsolated: true
  }, isolatedProvider as any);
  assert.equal(fs.readFileSync(path.join(isolatedSource, 'src', 'math.js'), 'utf8').includes('return a - b;'), true, 'isolated run must not mutate source workspace file.');
  assert.equal(isolatedReport.sourceMutated, false, 'isolated report should prove source workspace was unchanged.');
  assert.ok(isolatedReport.changedFiles.includes('src/math.js'), 'isolated report should record changed file in isolated copy.');
  assert.equal(isolatedReport.stateStatus, 'success', 'isolated run should reach success in the isolated copy.');
  assert.ok(fs.existsSync(path.join(isolatedSource, '.forge', 'isolated-runs', 'latest-isolated-run.json')), 'isolated report should persist in source workspace.');
  assert.ok(fs.existsSync(path.join(isolatedSource, '.forge', 'isolated-runs', 'latest-isolated-run.diff')), 'isolated diff summary should persist in source workspace.');
  assert.equal(isolatedReport.isolationMode, 'copy', 'non-git source should fall back to workspace-copy isolation.');
  assert.ok(isolatedReport.isolationFallbackReason, 'copy fallback should record why worktree isolation was unavailable.');
  assert.equal(isolatedReport.baseCommit, null, 'copy-mode isolation should not report a base commit.');

  const runGitTest = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const makeWorktreeProvider = () => {
    let calls = 0;
    return {
      capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
      listModels: async () => [],
      generateChat: async () => {
        calls += 1;
        const proposals = [
          { name: 'repo_search', arguments: { query: 'add' } },
          { name: 'update_plan', arguments: { planMd: '# PLAN.md\n\nPatch worktree math fixture.' } },
          {
            name: 'apply_patch',
            arguments: {
              path: 'src/math.js',
              patchContent: '<<<<<<< SEARCH\nfunction add(a, b) {\n  return a - b;\n}\n=======\nfunction add(a, b) {\n  return a + b;\n}\n>>>>>>> REPLACE'
            }
          },
          { name: 'run_tests', arguments: {} },
          { name: 'get_diff', arguments: {} }
        ];
        return {
          text: JSON.stringify({
            explanation: `Worktree proposal ${calls}.`,
            proposal: proposals[Math.min(calls - 1, proposals.length - 1)]
          })
        };
      }
    };
  };
  const worktreeSource = createTempWorkspace('forge-worktree-source-');
  fs.mkdirSync(path.join(worktreeSource, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktreeSource, 'src', 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n', 'utf8');
  fs.writeFileSync(path.join(worktreeSource, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  fs.writeFileSync(path.join(worktreeSource, 'test.js'), "const assert = require('assert');\nconst { add } = require('./src/math');\nassert.equal(add(2, 3), 5);\nconsole.log('pass worktree');\n", 'utf8');
  fs.writeFileSync(path.join(worktreeSource, 'notes.txt'), 'original committed notes\n', 'utf8');
  runGitTest(worktreeSource, ['init']);
  runGitTest(worktreeSource, ['add', '-A']);
  runGitTest(worktreeSource, ['-c', 'user.email=forge@test.local', '-c', 'user.name=Forge Test', 'commit', '-m', 'fixture baseline']);
  fs.writeFileSync(path.join(worktreeSource, 'notes.txt'), 'dirty uncommitted local edit\n', 'utf8');
  fs.writeFileSync(path.join(worktreeSource, 'scratch.txt'), 'untracked scratch file\n', 'utf8');
  const worktreeReport = await runIsolatedAgentGoal({
    sourceRoot: worktreeSource,
    goal: 'Fix math in a git worktree only.',
    maxSteps: 6,
    keepIsolated: true
  }, makeWorktreeProvider() as any);
  assert.equal(worktreeReport.isolationMode, 'worktree', 'git-backed source should run in a real git worktree.');
  assert.equal(worktreeReport.isolationFallbackReason, null, 'worktree isolation should not record a fallback reason.');
  assert.match(String(worktreeReport.baseCommit), /^[0-9a-f]{40}$/, 'worktree run should record the base commit hash.');
  assert.ok(fs.statSync(path.join(worktreeReport.isolatedRoot, '.git')).isFile(), 'isolated root should be a linked git worktree, not a plain copy.');
  assert.ok(worktreeReport.dirtyFilesOverlaid.includes('notes.txt'), 'dirty tracked edits should be overlaid into the worktree.');
  assert.ok(worktreeReport.dirtyFilesOverlaid.includes('scratch.txt'), 'untracked files should be overlaid into the worktree.');
  assert.equal(fs.readFileSync(path.join(worktreeReport.isolatedRoot, 'notes.txt'), 'utf8'), 'dirty uncommitted local edit\n', 'worktree should carry the dirty file content.');
  assert.equal(worktreeReport.stateStatus, 'success', 'worktree run should reach success inside the worktree.');
  assert.ok(worktreeReport.changedFiles.includes('src/math.js'), 'worktree report should record the patched file.');
  assert.equal(fs.readFileSync(path.join(worktreeSource, 'src', 'math.js'), 'utf8').includes('return a - b;'), true, 'worktree run must not mutate the source workspace file.');
  assert.equal(fs.readFileSync(path.join(worktreeSource, 'notes.txt'), 'utf8'), 'dirty uncommitted local edit\n', 'source dirty edit must survive the isolated run.');
  assert.ok(fs.existsSync(path.join(worktreeSource, 'scratch.txt')), 'source untracked file must survive the isolated run.');
  assert.equal(worktreeReport.sourceMutated, false, 'worktree report should prove the source workspace was unchanged.');
  assert.equal(worktreeReport.sourceDirtyStatusPreserved, true, 'worktree report should prove the source dirty status was preserved.');
  const countRegisteredIsolatedWorktrees = () => runGitTest(worktreeSource, ['worktree', 'list'])
    .split('\n')
    .filter((line) => line.includes('forge-isolated-wt-')).length;
  const registeredBeforeCleanupRun = countRegisteredIsolatedWorktrees();
  assert.equal(registeredBeforeCleanupRun, 1, 'kept isolated worktree should remain registered.');
  const worktreeCleanupReport = await runIsolatedAgentGoal({
    sourceRoot: worktreeSource,
    goal: 'Fix math in a disposable git worktree.',
    maxSteps: 6,
    keepIsolated: false
  }, makeWorktreeProvider() as any);
  assert.equal(worktreeCleanupReport.isolationMode, 'worktree', 'cleanup run should also use worktree isolation.');
  assert.equal(fs.existsSync(worktreeCleanupReport.isolatedRoot), false, 'non-kept worktree should be removed from disk.');
  assert.equal(countRegisteredIsolatedWorktrees(), registeredBeforeCleanupRun, 'non-kept worktree should be pruned from git worktree registration.');
  const worktreeRejection = await runIsolatedAgentGoal({
    sourceRoot: isolatedSource,
    goal: 'Force worktree mode on a non-git source.',
    maxSteps: 2,
    keepIsolated: false,
    isolationMode: 'worktree'
  }, makeWorktreeProvider() as any).then(() => null).catch((err: any) => err);
  assert.ok(worktreeRejection instanceof Error, 'forcing worktree mode on a non-git source should fail honestly.');
  assert.match(String(worktreeRejection.message), /worktree isolation is unavailable/, 'forced worktree failure should explain the reason.');

  const { runReflectionAbEval } = await import('../../harness/reflectionAb');
  const reflectionAbReport = await runReflectionAbEval({ taskLimit: 2, reportRoot: workspace, keepFixtures: false });
  assert.equal(reflectionAbReport.passed, true, 'reflection A/B should observe uplift with reflection on.');
  assert.equal(reflectionAbReport.reflectionOnSolved, 2, 'reflection-on lane should solve all A/B tasks.');
  assert.equal(reflectionAbReport.reflectionOffSolved, 0, 'reflection-off lane should solve none of the A/B tasks.');
  assert.equal(reflectionAbReport.offLaneHonestHalts, 2, 'reflection-off lane should halt honestly, not spin or false-success.');
  assert.ok(reflectionAbReport.tasks.every((task: any) => task.on.reflectionAttempts >= 1), 'reflection-on lanes should record reflection attempts.');
  assert.ok(reflectionAbReport.tasks.every((task: any) => task.off.reflectionSuppressed >= 1), 'reflection-off lanes should record suppressed reflections.');
  assert.ok(reflectionAbReport.tasks.every((task: any) => /red oracle/i.test(String(task.off.haltReason || ''))), 'reflection-off halts should cite the red oracle.');
  assert.ok(fs.existsSync(path.join(workspace, '.forge', 'evals', 'latest-reflection-ab.json')), 'reflection A/B scorecard should persist.');
  const reflectionAbCommand: any = await vscode.commands.executeCommand('forge-agent.runReflectionAbEval', { taskLimit: 1, keepFixtures: false });
  assert.equal(reflectionAbCommand.passed, true, 'reflection A/B extension command should return a passing report.');
  const openedReflectionAb = await vscode.commands.executeCommand('forge-agent.openArtifact', 'reflectionAb');
  assert.equal(openedReflectionAb, path.join(workspace, '.forge', 'evals', 'latest-reflection-ab.json'), 'reflection A/B scorecard should open through native editor command.');

  const aarAbReport = await runReflectionAbEval({ taskLimit: 1, reportRoot: workspace, keepFixtures: true });
  const aarOnFixture = aarAbReport.tasks[0].on.fixtureRoot;
  const aarOffFixture = aarAbReport.tasks[0].off.fixtureRoot;
  const aarOn = JSON.parse(fs.readFileSync(path.join(aarOnFixture, '.forge', 'aar.json'), 'utf8'));
  assert.equal(aarOn.terminalStatus, 'success', 'AAR should record the success terminal state.');
  assert.equal(aarOn.clean, false, 'AAR for a reflected run must not be clean.');
  assert.ok(aarOn.triggers.reflectionAttempts >= 1, 'AAR triggers must count reflections.');
  assert.ok(aarOn.lessonsBanked.length >= 1, 'non-clean AAR must bank at least one lesson.');
  assert.ok(fs.existsSync(path.join(aarOnFixture, '.forge', 'lessons.json')), 'banked lessons must persist to lessons.json.');
  const aarOff = JSON.parse(fs.readFileSync(path.join(aarOffFixture, '.forge', 'aar.json'), 'utf8'));
  assert.equal(aarOff.terminalStatus, 'failed', 'off-lane AAR should record the failed terminal state.');
  assert.ok(aarOff.triggers.reflectionSuppressed >= 1, 'off-lane AAR should count suppressed reflections.');
  assert.ok(aarOff.improveTools.some((note: string) => /suppressed/i.test(note)), 'off-lane AAR should flag reflection suppression in improve-tools.');
  const aarState = JSON.parse(fs.readFileSync(path.join(aarOnFixture, '.forge', 'state.json'), 'utf8'));
  assert.ok(aarState.aar && aarState.aar.generatedAt, 'terminal state.json must embed the AAR.');
  const cleanState = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'state.json'), 'utf8'));
  if (['success', 'failed', 'gave_up'].includes(cleanState.status)) {
    assert.ok(cleanState.aar, 'workspace terminal runs must also record an AAR.');
  }
  const openedAar = await vscode.commands.executeCommand('forge-agent.openArtifact', 'aar');
  assert.equal(openedAar, path.join(workspace, '.forge', 'aar.json'), 'AAR artifact should open through native editor command.');

  const proof: any = await vscode.commands.executeCommand('forge-agent.runBlueprintProofMatrix', {
    models: ['proof/cheap-model', 'proof/frontier-model'],
    goal: 'Run blueprint proof command in fixture mode.',
    keepFixtures: true
  });
  assert.equal(proof.passed, true, 'proof matrix should pass against deterministic fixtures.');
  assert.equal(proof.models.length, 2, 'proof matrix should return one result per requested model.');
  assert.ok(proof.models.every((result: any) => result.firewall.rejectedMalformedPatch), 'proof should reject malformed patches.');
  assert.ok(proof.models.every((result: any) => result.testsPass && result.greenEvidence), 'proof should require green tests and evidence.');
  assert.ok(proof.models.every((result: any) => result.providerCalls > 0), 'proof should attempt provider calls for every model.');

  const latestProof: any = await vscode.commands.executeCommand('forge-agent.getProofReport');
  assert.equal(latestProof?.generatedAt, proof.generatedAt, 'latest proof report should be retrievable.');

  const weakEval: any = await vscode.commands.executeCommand('forge-agent.runWeakModelEval', {
    model: 'qwen/qwen2.5-coder-7b-instruct',
    live: false,
    taskLimit: 2,
    keepFixtures: true
  });
  assert.equal(weakEval.modelId, 'qwen/qwen2.5-coder-7b-instruct', 'weak eval should use the requested weak model.');
  assert.equal(weakEval.taskCount, 2, 'weak eval should honor task limit.');
  assert.ok(weakEval.harnessSolved > weakEval.bareSolved, 'mocked weak eval should demonstrate harness uplift.');
  assert.ok(weakEval.actuallyModelDriven === weakEval.harnessSolved, 'harness solved count should be model-driven in mocked eval.');
  assert.equal(weakEval.fallbackSolved, 0, 'fallback solves should not inflate mocked model-driven count.');

  const latestWeakEval: any = await vscode.commands.executeCommand('forge-agent.getWeakModelEvalReport');
  assert.equal(latestWeakEval?.generatedAt, weakEval.generatedAt, 'latest weak eval report should be retrievable.');

  const verificationMatrix: any = await vscode.commands.executeCommand('forge-agent.runVerificationFixtureMatrix', {
    reportRoot: workspace
  });
  assert.equal(verificationMatrix.passed, true, 'verification fixture matrix should pass.');
  assert.equal(verificationMatrix.cases.length, 9, 'verification matrix should cover all required fixture cases.');
  for (const id of ['passing-tests', 'failing-tests', 'missing-test-suite', 'typecheck-failure', 'lint-failure', 'malformed-patch', 'out-of-workspace-path', 'blocked-command', 'unsolvable-step-cap']) {
    assert.ok(verificationMatrix.cases.some((item: any) => item.id === id && item.expected === item.actual), `verification matrix should prove ${id}`);
  }

  const isolatedCommandReport: any = await vscode.commands.executeCommand('forge-agent.runIsolatedAgentGoal', {
    goal: 'Smoke test isolated command path.',
    maxSteps: 1,
    keepIsolated: false
  });
  assert.equal(isolatedCommandReport.sourceMutated, false, 'isolated command report should prove source workspace stayed unchanged.');
  assert.equal(isolatedCommandReport.reportPath, path.join(workspace, '.forge', 'isolated-runs', 'latest-isolated-run.json'), 'isolated command should persist report in workspace.');

  for (const rel of ['.forge/state.json', '.forge/context-bundle.json', '.forge/retrieval-index.json', '.forge/role-handoffs.json', '.forge/safety-checkpoints.json', '.forge/command-effects.json', '.forge/budget.json', '.forge/isolated-runs/latest-isolated-run.json', '.forge/isolated-runs/latest-isolated-run.diff', '.forge/goal-contract.json', '.forge/task-graph.json', '.forge/evidence-ledger.json', '.forge/diff-reviews.json', '.forge/reviewer-critiques.json', '.forge/precommit-reviews.json', '.forge/escalations.json', '.forge/latest-proof-report.json', '.forge/evals/latest-weak-model-eval.json', '.forge/verification-fixture-matrix.json', 'PLAN.md', 'todos.json', 'SCRATCHPAD.md', 'evidence_ledger.json']) {
    assert.ok(fs.existsSync(path.join(workspace, rel)), `${rel} should exist`);
  }

  const openedPlan = await vscode.commands.executeCommand('forge-agent.openArtifact', 'plan');
  assert.equal(openedPlan, path.join(workspace, 'PLAN.md'), 'plan should open through native editor command.');
  assert.equal(vscode.window.activeTextEditor?.document.fileName, path.join(workspace, 'PLAN.md'));

  const openedProof = await vscode.commands.executeCommand('forge-agent.openArtifact', 'proof');
  assert.equal(openedProof, path.join(workspace, '.forge', 'latest-proof-report.json'), 'proof report should open through native editor command.');

  const openedWeakEval = await vscode.commands.executeCommand('forge-agent.openArtifact', 'weakEval');
  assert.equal(openedWeakEval, path.join(workspace, '.forge', 'evals', 'latest-weak-model-eval.json'), 'weak eval report should open through native editor command.');

  const openedContext = await vscode.commands.executeCommand('forge-agent.openArtifact', 'context');
  assert.equal(openedContext, path.join(workspace, '.forge', 'context-bundle.json'), 'context bundle should open through native editor command.');

  const openedRetrieval = await vscode.commands.executeCommand('forge-agent.openArtifact', 'retrieval');
  assert.equal(openedRetrieval, path.join(workspace, '.forge', 'retrieval-index.json'), 'retrieval index should open through native editor command.');

  const openedHandoffs = await vscode.commands.executeCommand('forge-agent.openArtifact', 'handoffs');
  assert.equal(openedHandoffs, path.join(workspace, '.forge', 'role-handoffs.json'), 'role handoffs should open through native editor command.');

  const openedSafety = await vscode.commands.executeCommand('forge-agent.openArtifact', 'safety');
  assert.equal(openedSafety, path.join(workspace, '.forge', 'safety-checkpoints.json'), 'safety checkpoints should open through native editor command.');

  const openedCommandEffects = await vscode.commands.executeCommand('forge-agent.openArtifact', 'commandEffects');
  assert.equal(openedCommandEffects, path.join(workspace, '.forge', 'command-effects.json'), 'command effects should open through native editor command.');

  const openedBudget = await vscode.commands.executeCommand('forge-agent.openArtifact', 'budget');
  assert.equal(openedBudget, path.join(workspace, '.forge', 'budget.json'), 'budget artifact should open through native editor command.');

  const openedIsolatedRun = await vscode.commands.executeCommand('forge-agent.openArtifact', 'isolatedRun');
  assert.equal(openedIsolatedRun, path.join(workspace, '.forge', 'isolated-runs', 'latest-isolated-run.json'), 'isolated run report should open through native editor command.');

  const openedCritiques = await vscode.commands.executeCommand('forge-agent.openArtifact', 'critiques');
  assert.equal(openedCritiques, path.join(workspace, '.forge', 'reviewer-critiques.json'), 'reviewer critiques should open through native editor command.');

  const openedPreCommit = await vscode.commands.executeCommand('forge-agent.openArtifact', 'precommit');
  assert.equal(openedPreCommit, path.join(workspace, '.forge', 'precommit-reviews.json'), 'pre-commit reviews should open through native editor command.');

  const terminalName = await vscode.commands.executeCommand('forge-agent.openTerminal');
  assert.equal(terminalName, 'Forge Agent', 'terminal command should create a native IDE terminal.');

  const diffArtifact = await vscode.commands.executeCommand('forge-agent.openDiff');
  assert.ok(typeof diffArtifact === 'string' && diffArtifact.length > 0, 'diff command should return a native diff target or diff artifact.');

  const autonomousState: any = await vscode.commands.executeCommand('forge-agent.runAgentGoal', {
    goal: 'Inspect the workspace and validate it with Forge Agent.',
    modelBindings: {}
  });
  assert.ok(['success', 'failed', 'gave_up'].includes(autonomousState.status), 'autonomous run should reach a terminal state.');
  assert.ok(autonomousState.currentStepIndex > 1, 'autonomous run should execute multiple harness steps.');
  assert.ok(autonomousState.scratchpadMd.includes('repo_search') || autonomousState.scratchpadMd.includes('run_tests'), 'autonomous run should record tool activity.');
  assert.ok(typeof autonomousState.runStats.providerCalls === 'number', 'autonomous run should expose provider call stats.');
  assert.ok(typeof autonomousState.runStats.fallbackActions === 'number', 'autonomous run should expose fallback action stats.');
  assert.ok(typeof autonomousState.runStats.reviewerApprovals === 'number', 'autonomous run should expose reviewer gate stats.');
  assert.ok(typeof autonomousState.runStats.reviewerCritiques === 'number', 'autonomous run should expose reviewer critique stats.');
  assert.ok(typeof autonomousState.runStats.preCommitReviews === 'number', 'autonomous run should expose pre-commit review stats.');
  assert.ok(typeof autonomousState.runStats.escalationCount === 'number', 'autonomous run should expose escalation stats.');
  assert.ok(typeof autonomousState.runStats.contextRefreshes === 'number', 'autonomous run should expose context refresh stats.');
  assert.ok(typeof autonomousState.runStats.roleHandoffRefreshes === 'number', 'autonomous run should expose role handoff stats.');
  assert.ok(typeof autonomousState.runStats.retrievalRefreshes === 'number', 'autonomous run should expose retrieval stats.');
  assert.ok(typeof autonomousState.runStats.safetyCheckpoints === 'number', 'autonomous run should expose safety checkpoint stats.');
  assert.ok(typeof autonomousState.runStats.commandEffectCaptures === 'number', 'autonomous run should expose command side-effect stats.');
}

function workspaceRootForTemp(): string {
  return fs.realpathSync(process.env.TEMP || process.env.TMP || process.cwd());
}

function createTempWorkspace(prefix: string): string {
  const root = fs.mkdtempSync(path.join(workspaceRootForTemp(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' }
  }, null, 2));
  return root;
}

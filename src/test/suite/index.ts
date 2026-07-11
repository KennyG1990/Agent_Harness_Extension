import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

async function runSuite(): Promise<void> {
  const extension = vscode.extensions.getExtension('kennyg.forge-agent');
  assert.ok(extension, 'Forge Agent extension should be discoverable.');
  await extension.activate();

  await vscode.commands.executeCommand('forge-agent.openStudio');
  const initialDiagnostics: any = await vscode.commands.executeCommand('forge-agent.diagnostics');
  assert.ok(initialDiagnostics, 'diagnostics command should return an object.');
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspace, 'fixture workspace should be open.');

  const { AgentHarnessLoop, extractPlanFocusFiles } = await import('../../harness/loop');
  const { Firewall } = await import('../../harness/firewall');
  const { WorkspaceTools } = await import('../../harness/tools');
  const { ProcessWorkerExecutor } = await import('../../harness/workerExecutor');
  const { classifyBlocker } = await import('../../harness/blockers');
  const { rankSemantically } = await import('../../harness/semanticRetrieval');
  const { TransactionalEditExecutor } = await import('../../harness/transactionalEdits');
  const { TransactionalCommandExecutor } = await import('../../harness/transactionalCommands');
  const { classifyCommandNetworkIntent } = await import('../../harness/commandNetwork');
  const { runIsolatedAgentGoal } = await import('../../harness/isolation');
  const { assemblePromptWithinBudget } = await import('../../harness/contextBudget');
  const { bankProceduralSkills, selectProceduralSkills } = await import('../../harness/proceduralSkills');
  assert.equal(classifyBlocker('firewall', '[role_capability_blocked] Editor cannot use declare_success.').category, 'role_capability', 'role denials need a distinct blocker category.');
  assert.equal(classifyBlocker('firewall', '[network_intent_blocked] outbound upload denied.').category, 'network_policy', 'network policy needs a distinct blocker category.');
  assert.equal(classifyBlocker('firewall', 'Edit applicability failed: search block not found.').category, 'patch_applicability', 'patch drift needs an applicability category.');
  assert.equal(classifyBlocker('budget', 'cost cap reached').retryable, false, 'budget blockers must not spin within the same run.');
  const failedSkillBank = bankProceduralSkills([], {
    terminalStatus: 'failed', goal: 'repair malformed patch', sessionId: 'failed-session', languageExtensions: ['.ts'], reflectionAttempts: 2, validationFailures: 2, repairAttempts: 1, preCommitBlocks: 0, escalationCount: 0, resolvedBlockerCategories: ['patch_format']
  });
  assert.equal(failedSkillBank.bankedIds.length, 0, 'failed runs must never teach procedural skills.');
  const cleanSkillBank = bankProceduralSkills([], {
    terminalStatus: 'success', goal: 'clean first pass', sessionId: 'clean-session', languageExtensions: ['.ts'], reflectionAttempts: 0, validationFailures: 0, repairAttempts: 0, preCommitBlocks: 0, escalationCount: 0, resolvedBlockerCategories: []
  });
  assert.equal(cleanSkillBank.bankedIds.length, 0, 'clean runs should not invent recovery procedures without causal evidence.');
  const recoveredSkillBank = bankProceduralSkills([], {
    terminalStatus: 'success', goal: 'repair malformed TypeScript patch', sessionId: 'recovered-session', languageExtensions: ['.ts'], reflectionAttempts: 1, validationFailures: 1, repairAttempts: 1, preCommitBlocks: 0, escalationCount: 0, resolvedBlockerCategories: ['patch_format']
  });
  assert.ok(recoveredSkillBank.bankedIds.length >= 1, 'verified successful recovery must bank at least one deterministic procedure.');
  assert.ok(recoveredSkillBank.skills.every(skill => skill.successfulRuns === 1 && skill.sourceSessionIds?.includes('recovered-session')), 'banked skills must retain verified-run provenance.');
  const repeatedSkillBank = bankProceduralSkills(recoveredSkillBank.skills, {
    terminalStatus: 'success', goal: 'repair malformed TypeScript patch again', sessionId: 'recovered-session-2', languageExtensions: ['.ts'], reflectionAttempts: 1, validationFailures: 1, repairAttempts: 1, preCommitBlocks: 0, escalationCount: 0, resolvedBlockerCategories: ['patch_format']
  });
  const proposalSkill = repeatedSkillBank.skills.find(skill => skill.category === 'proposal_repair');
  assert.equal(proposalSkill?.successfulRuns, 2, 'repeated verified recovery should strengthen the same skill instead of duplicating it.');
  const relevantSkillSelection = selectProceduralSkills(repeatedSkillBank.skills, 'repair malformed TypeScript patch', ['patch_format'], 'next-session');
  assert.ok(relevantSkillSelection.selected.some(skill => skill.category === 'proposal_repair'), 'matching goal/blocker signals should retrieve the recovery procedure.');
  const repeatedSelection = selectProceduralSkills(relevantSkillSelection.skills, 'repair malformed TypeScript patch', ['patch_format'], 'next-session');
  assert.equal(repeatedSelection.selected.find(skill => skill.category === 'proposal_repair')?.useCount, 1, 'repeated prompt assembly in one session must not inflate skill use count.');
  assert.equal(selectProceduralSkills(repeatedSkillBank.skills, 'explain CSS colors', [], 'irrelevant-session').selected.length, 0, 'irrelevant procedures must not contaminate unrelated prompts.');

  const skillPromptWorkspace = createTempWorkspace('forge-skill-prompt-');
  fs.mkdirSync(path.join(skillPromptWorkspace, '.forge'), { recursive: true });
  fs.writeFileSync(path.join(skillPromptWorkspace, '.forge', 'skill-registry.json'), JSON.stringify(repeatedSkillBank.skills, null, 2), 'utf8');
  let proceduralSkillPrompt = '';
  const skillPromptProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (request: any) => {
      proceduralSkillPrompt = request.messages.find((message: any) => message.role === 'system')?.content || '';
      return { text: JSON.stringify({ explanation: 'Inspect before repairing.', proposal: { name: 'repo_search', arguments: { query: 'patch' } } }) };
    }
  };
  const skillPromptLoop = new AgentHarnessLoop(skillPromptProvider as any, skillPromptWorkspace);
  let skillPromptState = await skillPromptLoop.initializeHarness('Repair malformed TypeScript patch.');
  skillPromptState = await skillPromptLoop.runStep(skillPromptState, {});
  assert.match(proceduralSkillPrompt, /Verified procedural skills from prior successful recoveries/);
  assert.match(proceduralSkillPrompt, /Copy the SEARCH block verbatim/);
  assert.ok(skillPromptState.runStats.skillApplications >= 1, 'product loop should count uniquely applied skills in the session.');
  assert.ok(skillPromptState.skills.some(skill => skill.lastUsedAt), 'skill use provenance should persist back into harness state.');
  const semanticCacheWorkspace = createTempWorkspace('forge-semantic-cache-');
  let semanticEmbedCalls = 0;
  const causalEmbeddingProvider = {
    id: 'mock-semantic',
    modelId: 'mock/causal-embedding',
    embed: async (inputs: string[]) => {
      semanticEmbedCalls += 1;
      return inputs.map(input => /repair login flow|credential token verification|verifycredential/i.test(input) ? [1, 0] : [0, 1]);
    }
  };
  const semanticDocuments = [
    { path: 'src/auth.ts', text: 'credential token verification and session identity checks' },
    { path: 'src/math.ts', text: 'numeric addition and subtraction helpers' }
  ];
  const firstSemanticRank = await rankSemantically(semanticCacheWorkspace, 'repair login flow', semanticDocuments, causalEmbeddingProvider, 2);
  assert.equal(firstSemanticRank.candidates[0].path, 'src/auth.ts', 'semantic retrieval must surface conceptually related content without lexical overlap.');
  assert.equal(firstSemanticRank.status, 'ready');
  const callsAfterFirstSemanticRank = semanticEmbedCalls;
  const secondSemanticRank = await rankSemantically(semanticCacheWorkspace, 'repair login flow', semanticDocuments, causalEmbeddingProvider, 2);
  assert.equal(semanticEmbedCalls, callsAfterFirstSemanticRank, 'identical semantic retrieval must reuse cached query and document vectors.');
  assert.equal(secondSemanticRank.cacheHits, 3, 'cache report should count query plus both document vectors.');

  const semanticLoopWorkspace = createTempWorkspace('forge-semantic-loop-');
  fs.mkdirSync(path.join(semanticLoopWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(semanticLoopWorkspace, 'src', 'auth.ts'), 'export function verifyCredential(token) { return Boolean(token); }\n', 'utf8');
  fs.writeFileSync(path.join(semanticLoopWorkspace, 'src', 'math.ts'), 'export const add = (a, b) => a + b;\n', 'utf8');
  fs.writeFileSync(path.join(semanticLoopWorkspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2), 'utf8');
  let semanticPrompt = '';
  const semanticProposalProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (request: any) => {
      semanticPrompt = request.messages.find((message: any) => message.role === 'system')?.content || '';
      return { text: JSON.stringify({ explanation: 'Read the semantically selected authentication file.', proposal: { name: 'read_file', arguments: { path: 'src/auth.ts' } } }) };
    }
  };
  const semanticLoop = new AgentHarnessLoop(semanticProposalProvider as any, semanticLoopWorkspace, causalEmbeddingProvider as any);
  let semanticState = await semanticLoop.initializeHarness('Repair login flow.');
  semanticState = await semanticLoop.runStep(semanticState, {});
  assert.equal(semanticState.semanticRetrieval.status, 'ready', 'product loop should persist ready semantic provenance.');
  assert.equal(semanticState.contextBundle.retrievalCandidates[0].path, 'src/auth.ts', `hybrid product ranking should place the semantic match first: ${JSON.stringify(semanticState.contextBundle.retrievalCandidates.slice(0, 5))}`);
  assert.equal(semanticState.contextBundle.retrievalCandidates[0].source, 'hybrid', 'semantic contribution must be explicit on the candidate.');
  assert.match(semanticPrompt, /semantic cosine/, 'model prompt should expose why semantic retrieval ranked the file.');

  const failingEmbeddingProvider = { id: 'mock-failure', modelId: 'mock/failure', embed: async () => { throw new Error('mock embedding outage'); } };
  const semanticFallbackLoop = new AgentHarnessLoop(semanticProposalProvider as any, semanticLoopWorkspace, failingEmbeddingProvider as any);
  let semanticFallbackState = await semanticFallbackLoop.initializeHarness('Find authentication implementation.');
  semanticFallbackState = await semanticFallbackLoop.runStep(semanticFallbackState, {});
  assert.equal(semanticFallbackState.semanticRetrieval.status, 'failed', 'embedding outage must remain explicit.');
  assert.ok(semanticFallbackState.contextBundle.retrievalCandidates.length > 0, 'deterministic retrieval must remain available after embedding failure.');
  assert.equal(semanticFallbackState.runStats.semanticFailures, 1, 'semantic failure should be counted without failing the agent run.');
  const processWorkerWorkspace = createTempWorkspace('forge-process-worker-');
  fs.mkdirSync(path.join(processWorkerWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(processWorkerWorkspace, 'src', 'worker.txt'), 'before', 'utf8');
  process.env.FORGE_WORKER_SECRET = 'must-not-cross-worker-boundary';
  const processWorker = new ProcessWorkerExecutor();
  const workerWrite = await processWorker.dispatch(processWorkerWorkspace, 'Editor', {
    name: 'write_file',
    arguments: { path: 'src/worker.txt', content: 'after' }
  });
  assert.equal(workerWrite.success, true, 'role-tagged process worker should execute a validated file write.');
  assert.notEqual(workerWrite.worker.pid, process.pid, 'workspace tool execution must occur outside the extension-host process.');
  assert.equal(workerWrite.worker.role, 'Editor', 'worker evidence should preserve the active role.');
  assert.equal(workerWrite.worker.sanitizedEnv, true, 'worker process should report sanitized environment inheritance.');
  assert.ok(workerWrite.worker.blockedEnvKeys.includes('FORGE_WORKER_SECRET'), 'worker process must strip deliberate secret environment keys.');
  assert.ok(!workerWrite.worker.allowedEnvKeys.includes('FORGE_WORKER_SECRET'), 'worker process must never list stripped secrets as allowed.');
  assert.equal(fs.readFileSync(path.join(processWorkerWorkspace, 'src', 'worker.txt'), 'utf8'), 'after', 'worker mutation should be visible in the isolated fixture workspace.');
  const workerSecretProbe = await processWorker.dispatch(processWorkerWorkspace, 'Reviewer', {
    name: 'run_command',
    arguments: { command: 'node -e "console.log(Boolean(process.env.FORGE_WORKER_SECRET))"' }
  });
  delete process.env.FORGE_WORKER_SECRET;
  assert.equal(workerSecretProbe.success, true, 'worker secret probe command should execute.');
  assert.match(workerSecretProbe.output, /false/, 'worker child and its command descendants must not receive the stripped secret.');
  const workerFailure = await processWorker.dispatch(processWorkerWorkspace, 'Explorer', {
    name: 'not_a_tool' as any,
    arguments: {}
  });
  assert.equal(workerFailure.success, false, 'worker tool failure must return honestly instead of being promoted to success.');
  assert.match(workerFailure.output, /Unknown tool/, 'worker failure should retain the concrete tool error.');

  const sparseTransactionWorkspace = createTempWorkspace('forge-sparse-transaction-');
  fs.mkdirSync(path.join(sparseTransactionWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sparseTransactionWorkspace, 'src', 'edit.txt'), 'before', 'utf8');
  const sparseTransaction = await new TransactionalEditExecutor().dispatch(sparseTransactionWorkspace, 'Editor', {
    name: 'write_file',
    arguments: { path: 'src/edit.txt', content: 'after' }
  });
  assert.equal(sparseTransaction.success, true, 'non-git edit transaction should commit through sparse staging.');
  assert.equal(sparseTransaction.transaction.mode, 'sparse-copy');
  assert.equal(sparseTransaction.transaction.committed, true);
  assert.equal(sparseTransaction.transaction.conflict, false);
  assert.equal(sparseTransaction.transaction.cleanupSucceeded, true);
  assert.equal(fs.readFileSync(path.join(sparseTransactionWorkspace, 'src', 'edit.txt'), 'utf8'), 'after');

  const conflictWorkspace = createTempWorkspace('forge-edit-conflict-');
  fs.mkdirSync(path.join(conflictWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(conflictWorkspace, 'src', 'edit.txt'), 'before', 'utf8');
  const conflictWorker = {
    dispatch: async (stagingRoot: string, role: string) => {
      fs.mkdirSync(path.join(stagingRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(stagingRoot, 'src', 'edit.txt'), 'worker-result', 'utf8');
      fs.writeFileSync(path.join(conflictWorkspace, 'src', 'edit.txt'), 'concurrent-user-change', 'utf8');
      return {
        success: true,
        output: 'staged write',
        worker: { role, pid: process.pid + 1, durationMs: 1, sanitizedEnv: true, inheritedEnvKeyCount: 0, allowedEnvKeys: [], blockedEnvKeys: [] }
      };
    }
  };
  const conflictedTransaction = await new TransactionalEditExecutor(conflictWorker as any).dispatch(conflictWorkspace, 'Editor', {
    name: 'write_file',
    arguments: { path: 'src/edit.txt', content: 'worker-result' }
  });
  assert.equal(conflictedTransaction.success, false, 'concurrent source change must refuse transaction merge.');
  assert.equal(conflictedTransaction.transaction.conflict, true);
  assert.equal(conflictedTransaction.transaction.committed, false);
  assert.equal(fs.readFileSync(path.join(conflictWorkspace, 'src', 'edit.txt'), 'utf8'), 'concurrent-user-change', 'transaction conflict must preserve concurrent source bytes.');

  const commandTransactionWorkspace = createTempWorkspace('forge-command-transaction-');
  fs.mkdirSync(path.join(commandTransactionWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(commandTransactionWorkspace, 'src', 'modify.txt'), 'before', 'utf8');
  fs.writeFileSync(path.join(commandTransactionWorkspace, 'src', 'delete.txt'), 'remove me', 'utf8');
  const commandTransaction = await new TransactionalCommandExecutor().dispatch(commandTransactionWorkspace, 'Reviewer', {
    name: 'run_command',
    arguments: { command: 'node -e "const fs=require(\'fs\'); fs.writeFileSync(\'src/modify.txt\',\'after\'); fs.writeFileSync(\'src/create.txt\',\'created\'); fs.rmSync(\'src/delete.txt\')"' }
  });
  assert.equal(commandTransaction.success, true, 'non-git command transaction should commit all staged paths together.');
  assert.equal(commandTransaction.commandTransaction.mode, 'workspace-copy');
  assert.equal(commandTransaction.commandTransaction.committed, true);
  assert.equal(commandTransaction.commandTransaction.mergedFileCount, 3);
  assert.deepEqual(commandTransaction.commandTransaction.created, ['src/create.txt']);
  assert.deepEqual(commandTransaction.commandTransaction.modified, ['src/modify.txt']);
  assert.deepEqual(commandTransaction.commandTransaction.deleted, ['src/delete.txt']);
  assert.equal(commandTransaction.commandTransaction.cleanupSucceeded, true);
  assert.equal(fs.readFileSync(path.join(commandTransactionWorkspace, 'src', 'modify.txt'), 'utf8'), 'after');
  assert.equal(fs.readFileSync(path.join(commandTransactionWorkspace, 'src', 'create.txt'), 'utf8'), 'created');
  assert.equal(fs.existsSync(path.join(commandTransactionWorkspace, 'src', 'delete.txt')), false);

  const failedCommandWorkspace = createTempWorkspace('forge-command-failed-');
  const failedCommandTransaction = await new TransactionalCommandExecutor().dispatch(failedCommandWorkspace, 'Reviewer', {
    name: 'run_command',
    arguments: { command: 'node -e "require(\'fs\').writeFileSync(\'should-not-merge.txt\',\'staged\'); process.exit(1)"' }
  });
  assert.equal(failedCommandTransaction.success, false, 'failed command must not merge staged side effects.');
  assert.equal(failedCommandTransaction.commandTransaction.committed, false);
  assert.equal(fs.existsSync(path.join(failedCommandWorkspace, 'should-not-merge.txt')), false);

  const directSourceReference = await new TransactionalCommandExecutor().dispatch(failedCommandWorkspace, 'Reviewer', {
    name: 'run_command',
    arguments: { command: `node -e "require('fs').writeFileSync('${failedCommandWorkspace.replace(/\\/g, '/')}/direct.txt','unsafe')"` }
  });
  assert.equal(directSourceReference.success, false, 'explicit active-workspace path must be rejected before worker launch.');
  assert.match(directSourceReference.output, /explicit reference to the active workspace root/);
  assert.equal(directSourceReference.commandTransaction.workerPid, 0);
  assert.equal(fs.existsSync(path.join(failedCommandWorkspace, 'direct.txt')), false);

  const commandConflictWorkspace = createTempWorkspace('forge-command-conflict-');
  fs.writeFileSync(path.join(commandConflictWorkspace, 'target.txt'), 'before', 'utf8');
  const commandConflictWorker = {
    dispatch: async (stagingRoot: string, role: string) => {
      fs.writeFileSync(path.join(stagingRoot, 'target.txt'), 'command-result', 'utf8');
      fs.writeFileSync(path.join(commandConflictWorkspace, 'target.txt'), 'concurrent-user-change', 'utf8');
      return {
        success: true,
        output: 'staged command',
        worker: { role, pid: process.pid + 2, durationMs: 1, sanitizedEnv: true, inheritedEnvKeyCount: 0, allowedEnvKeys: [], blockedEnvKeys: [] }
      };
    }
  };
  const commandConflict = await new TransactionalCommandExecutor(commandConflictWorker as any).dispatch(commandConflictWorkspace, 'Reviewer', {
    name: 'run_command', arguments: { command: 'mock command' }
  });
  assert.equal(commandConflict.success, false, 'concurrent source change must refuse the entire command transaction.');
  assert.equal(commandConflict.commandTransaction.conflict, true);
  assert.equal(commandConflict.commandTransaction.mergedFileCount, 0);
  assert.equal(fs.readFileSync(path.join(commandConflictWorkspace, 'target.txt'), 'utf8'), 'concurrent-user-change');

  const commandRollbackWorkspace = createTempWorkspace('forge-command-rollback-');
  fs.writeFileSync(path.join(commandRollbackWorkspace, 'a.txt'), 'a-before', 'utf8');
  fs.writeFileSync(path.join(commandRollbackWorkspace, 'b.txt'), 'b-before', 'utf8');
  const commandRollbackWorker = {
    dispatch: async (stagingRoot: string, role: string) => {
      fs.writeFileSync(path.join(stagingRoot, 'a.txt'), 'a-after', 'utf8');
      fs.writeFileSync(path.join(stagingRoot, 'b.txt'), 'b-after', 'utf8');
      return {
        success: true,
        output: 'staged two-file command',
        worker: { role, pid: process.pid + 3, durationMs: 1, sanitizedEnv: true, inheritedEnvKeyCount: 0, allowedEnvKeys: [], blockedEnvKeys: [] }
      };
    }
  };
  const commandRollback = await new TransactionalCommandExecutor(
    commandRollbackWorker as any,
    (stagedPath: string, targetPath: string, index: number) => {
      if (index === 1) throw new Error('injected second-file merge failure');
      fs.copyFileSync(stagedPath, targetPath);
    }
  ).dispatch(commandRollbackWorkspace, 'Reviewer', { name: 'run_command', arguments: { command: 'mock two-file command' } });
  assert.equal(commandRollback.success, false, 'partial merge failure must fail the command transaction.');
  assert.equal(commandRollback.commandTransaction.rollbackAttempted, true);
  assert.equal(commandRollback.commandTransaction.rollbackSucceeded, true);
  assert.equal(commandRollback.commandTransaction.committed, false);
  assert.equal(fs.readFileSync(path.join(commandRollbackWorkspace, 'a.txt'), 'utf8'), 'a-before', 'rollback must restore the first file after the second merge fails.');
  assert.equal(fs.readFileSync(path.join(commandRollbackWorkspace, 'b.txt'), 'utf8'), 'b-before');
  const safeNetworkRead = classifyCommandNetworkIntent('curl https://example.test/status');
  assert.equal(safeNetworkRead.risk, 'read', 'GET-like curl should classify as read-only network intent.');
  assert.equal(safeNetworkRead.decision, 'allowed', 'read-only network intent should remain available for repository research and downloads.');
  assert.deepEqual(safeNetworkRead.endpoints, ['https://example.test/status'], 'network classifier should preserve explicit endpoints for evidence.');
  const blockedNetworkWrite = classifyCommandNetworkIntent('curl -X POST --data "payload" https://example.test/upload');
  assert.equal(blockedNetworkWrite.risk, 'write', 'upload-like curl should classify as outbound write intent.');
  assert.equal(blockedNetworkWrite.decision, 'blocked', 'outbound write intent must be blocked before execution.');
  const commandPolicyFirewall = new Firewall(new WorkspaceTools(workspace));
  assert.equal(commandPolicyFirewall.validateCommand('git push origin main').valid, false, 'git push must be rejected as outbound network mutation.');
  assert.equal(commandPolicyFirewall.validateCommand('npm publish').valid, false, 'package publication must be rejected as outbound network mutation.');
  assert.equal(commandPolicyFirewall.validateCommand('git commit -am "agent commit"').valid, false, 'shared git history mutation must be rejected.');
  assert.equal(commandPolicyFirewall.validateCommand('git config user.name Forge').valid, false, 'shared git configuration mutation must be rejected.');
  assert.equal(commandPolicyFirewall.validateCommand('git status --short').valid, true, 'read-only git inspection should remain allowed.');
  assert.equal(commandPolicyFirewall.validateCommand('curl https://example.test/status').valid, true, 'read-only network command intent should pass deterministic policy.');
  const blockedNetworkWorkspace = createTempWorkspace('forge-network-block-');
  const blockedNetworkProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => ({
      text: JSON.stringify({
        explanation: 'Attempt an outbound repository mutation.',
        proposal: { name: 'run_command', arguments: { command: 'git push origin main' } }
      })
    })
  };
  const blockedNetworkLoop = new AgentHarnessLoop(blockedNetworkProvider as any, blockedNetworkWorkspace);
  let blockedNetworkState = await blockedNetworkLoop.initializeHarness('Prove outbound network mutation is rejected before execution.');
  blockedNetworkState.taskGraph.tasks[0].status = 'completed';
  blockedNetworkState.taskGraph.tasks[1].status = 'completed';
  blockedNetworkState.taskGraph.tasks[2].status = 'completed';
  blockedNetworkState = await blockedNetworkLoop.runStep(blockedNetworkState, {});
  assert.equal(blockedNetworkState.runStats.networkWriteBlocks, 1, 'blocked network mutation should increment an explicit run counter.');
  assert.equal(blockedNetworkState.commandEffects.length, 0, 'blocked network mutation must never reach command execution or its post-execution ledger.');
  assert.match(String(blockedNetworkState.firewall.validationReason), /network_intent_blocked/, 'firewall evidence should identify network-intent policy as the rejection source.');
  assert.ok(blockedNetworkState.blockers.some((blocker: any) => blocker.category === 'network_policy' && blocker.status === 'open'), 'network rejection should persist a retryable open blocker.');

  const roleSessionIds: string[] = [];
  const editorEscapeProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (request: any) => {
      roleSessionIds.push(request.sessionId);
      return {
        text: JSON.stringify({
          explanation: 'Editor attempts to bypass reviewer evidence gates.',
          proposal: { name: 'declare_success', arguments: {} }
        })
      };
    }
  };
  const roleWorkspace = createTempWorkspace('forge-role-capability-');
  fs.mkdirSync(path.join(roleWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(roleWorkspace, 'src', 'guard.txt'), 'unchanged', 'utf8');
  const editorEscapeLoop = new AgentHarnessLoop(editorEscapeProvider as any, roleWorkspace);
  let editorEscapeState = await editorEscapeLoop.initializeHarness('Prove Editor cannot claim success.');
  editorEscapeState.taskGraph.tasks[0].status = 'completed';
  editorEscapeState.taskGraph.tasks[1].status = 'completed';
  editorEscapeState = await editorEscapeLoop.runStep(editorEscapeState, {});
  assert.equal(editorEscapeState.runStats.roleCapabilityBlocks, 1, 'Editor cross-role proposal should increment capability block evidence.');
  assert.match(String(editorEscapeState.firewall.validationReason), /Editor cannot use declare_success/, 'Editor must not access reviewer-only success declaration.');
  assert.ok(editorEscapeState.blockers.some((blocker: any) => blocker.category === 'role_capability' && blocker.retryable), 'role violation should persist with deterministic retry policy.');
  assert.equal(editorEscapeState.workerContexts.Editor.rejectedProposals, 1, 'Editor worker context should retain its rejected proposal count.');
  assert.match(roleSessionIds[0], /:worker:editor$/, 'Editor provider call must use a role-scoped session identity.');

  const reviewerEscapeProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (request: any) => {
      roleSessionIds.push(request.sessionId);
      return {
        text: JSON.stringify({
          explanation: 'Reviewer attempts to mutate a workspace file.',
          proposal: {
            name: 'apply_patch',
            arguments: { path: 'src/guard.txt', patchContent: '<<<<<<< SEARCH\nunchanged\n=======\nmutated\n>>>>>>> REPLACE' }
          }
        })
      };
    }
  };
  const reviewerEscapeLoop = new AgentHarnessLoop(reviewerEscapeProvider as any, roleWorkspace);
  let reviewerEscapeState = await reviewerEscapeLoop.initializeHarness('Prove Reviewer cannot edit files.');
  reviewerEscapeState.taskGraph.tasks[0].status = 'completed';
  reviewerEscapeState.taskGraph.tasks[1].status = 'completed';
  reviewerEscapeState.taskGraph.tasks[2].status = 'completed';
  reviewerEscapeState = await reviewerEscapeLoop.runStep(reviewerEscapeState, {});
  assert.equal(fs.readFileSync(path.join(roleWorkspace, 'src', 'guard.txt'), 'utf8'), 'unchanged', 'Reviewer capability rejection must happen before file mutation.');
  assert.equal(reviewerEscapeState.runStats.roleCapabilityBlocks, 1, 'Reviewer cross-role proposal should increment capability block evidence.');
  assert.match(String(reviewerEscapeState.firewall.validationReason), /Reviewer cannot use apply_patch/, 'Reviewer must not access Editor mutation tools.');
  assert.match(roleSessionIds[1], /:worker:reviewer$/, 'Reviewer provider call must use a distinct role-scoped session identity.');
  assert.notEqual(roleSessionIds[0], roleSessionIds[1], 'Editor and Reviewer must not share provider session identity.');
  const workerContextsArtifact = JSON.parse(fs.readFileSync(path.join(roleWorkspace, '.forge', 'worker-contexts.json'), 'utf8'));
  assert.equal(workerContextsArtifact.Reviewer.rejectedProposals, 1, 'worker-contexts artifact should persist role rejection evidence.');
  const budgetedPrompt = assemblePromptWithinBudget([
    { id: 'goal', required: true, priority: 100, content: `GOAL-MARKER ${'g'.repeat(1400)}` },
    { id: 'open-tasks', required: true, priority: 100, content: `OPEN-TASK-MARKER ${'t'.repeat(1400)}` },
    { id: 'stale-tool-output', priority: 10, toolResult: true, content: `STALE-TOOL-MARKER ${'x'.repeat(5000)}` }
  ], 1024);
  assert.ok(budgetedPrompt.promptChars <= 1024, 'context scheduler must enforce its hard prompt budget.');
  assert.ok(budgetedPrompt.text.includes('GOAL-MARKER') && budgetedPrompt.text.includes('OPEN-TASK-MARKER'), 'required goal and open-task state must survive compaction.');
  assert.ok(!budgetedPrompt.text.includes('STALE-TOOL-MARKER'), 'stale optional tool output must clear before required state.');
  assert.ok(budgetedPrompt.clearedSections.includes('stale-tool-output'), 'cleared tool output must be explicitly accounted.');

  const rateSplitWorkspace = createTempWorkspace('forge-rate-split-');
  fs.mkdirSync(path.join(rateSplitWorkspace, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rateSplitWorkspace, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(rateSplitWorkspace, 'src', 'math.js'), 'exports.add = (a, b) => a - b;\n', 'utf8');
  fs.writeFileSync(path.join(rateSplitWorkspace, 'lib', 'math.js'), 'exports.identity = value => value;\n', 'utf8');
  fs.writeFileSync(path.join(rateSplitWorkspace, 'test.js'), "const assert = require('assert'); const { add } = require('./src/math'); assert.equal(add(2, 3), 5);\n", 'utf8');
  fs.writeFileSync(path.join(rateSplitWorkspace, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  assert.deepEqual(extractPlanFocusFiles('Fix math.js without guessing.', rateSplitWorkspace), [], 'ambiguous basenames must not become focus files.');
  assert.deepEqual(extractPlanFocusFiles('Ignore src/math.js.bak.', rateSplitWorkspace), [], 'lookalike path suffixes must not become focus files.');
  const architectPlan = '# Plan\n\n## Premise Checks\n- src/math.js subtracts.\n\n## Focus Files\n- src/math.js\n\n## Ordered Steps\n1. Fix src/math.js.\n2. Run tests.';
  const routedCalls: Array<{ modelId: string; prompt: string }> = [];
  let architectCalls = 0;
  let editorCalls = 0;
  const rateSplitProvider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 32768 }),
    listModels: async () => [],
    generateChat: async (options: any) => {
      const prompt = options.messages.find((message: any) => message.role === 'system')?.content || '';
      routedCalls.push({ modelId: options.modelId, prompt });
      let proposal: any;
      if (prompt.includes('Active task: Inspect workspace')) {
        proposal = { name: 'read_file', arguments: { path: 'src/math.js' } };
      } else if (prompt.includes('Active task: Create or update')) {
        architectCalls += 1;
        proposal = architectCalls === 1
          ? { name: 'read_file', arguments: { path: 'src/math.js' } }
          : { name: 'update_plan', arguments: { planMd: architectPlan } };
      } else if (prompt.includes('Active task: Apply scoped')) {
        editorCalls += 1;
        proposal = editorCalls === 1
          ? { name: 'read_file', arguments: { path: 'src/math.js' } }
          : { name: 'apply_patch', arguments: { path: 'src/math.js', patchContent: '<<<<<<< SEARCH\nexports.add = (a, b) => a - b;\n=======\nexports.add = (a, b) => a + b;\n>>>>>>> REPLACE' } };
      } else {
        throw new Error('Unexpected provider task in product rate-split proof.');
      }
      return { text: JSON.stringify({ explanation: 'Product rate-split proof.', proposal }), usage: { promptTokens: 1, completionTokens: 1, totalCost: 0 } };
    }
  };
  const rateSplitLoop = new AgentHarnessLoop(rateSplitProvider as any, rateSplitWorkspace);
  const rateSplitBindings = { plan: 'deepseek/deepseek-v4-pro', code: 'qwen/qwen-2.5-7b-instruct' };
  let rateSplitState = await rateSplitLoop.initializeHarness('Fix addition.', rateSplitBindings, {}, { goalOverrides: { maxSteps: 12 } });
  rateSplitState = await rateSplitLoop.runStep(rateSplitState, rateSplitBindings);
  rateSplitState = await rateSplitLoop.runStep(rateSplitState, rateSplitBindings);
  assert.equal(rateSplitState.taskGraph.tasks.find(task => task.id === '2')?.status, 'running', 'Architect read must not complete planning.');
  rateSplitState = await rateSplitLoop.runStep(rateSplitState, rateSplitBindings);
  assert.equal(rateSplitState.taskGraph.tasks.find(task => task.id === '2')?.status, 'completed', 'Architect update_plan must complete planning.');
  rateSplitState = await rateSplitLoop.runStep(rateSplitState, rateSplitBindings);
  assert.equal(rateSplitState.taskGraph.tasks.find(task => task.id === '3')?.status, 'running', 'Editor read must not complete editing.');
  rateSplitState = await rateSplitLoop.runStep(rateSplitState, rateSplitBindings);
  while (!['success', 'failed', 'gave_up'].includes(rateSplitState.status) && rateSplitState.currentStepIndex < rateSplitState.maxSteps) {
    rateSplitState = await rateSplitLoop.runStep(rateSplitState, rateSplitBindings);
  }
  assert.equal(rateSplitState.status, 'success', 'product rate-split fixture must reach terminal success.');
  assert.deepEqual(routedCalls.filter(call => call.prompt.includes('Active task: Create or update')).map(call => call.modelId), ['deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-pro'], 'plan alias must route Architect calls to DeepSeek.');
  assert.deepEqual(routedCalls.filter(call => call.prompt.includes('Active task: Apply scoped')).map(call => call.modelId), ['qwen/qwen-2.5-7b-instruct', 'qwen/qwen-2.5-7b-instruct'], 'code alias must route Editor calls to Qwen.');
  assert.ok(routedCalls.filter(call => call.prompt.includes('Active task: Apply scoped')).every(call => call.prompt.includes(architectPlan) && call.prompt.includes('Architect focus file src/math.js')), 'Editor must receive the committed plan and focus file.');
  assert.equal(rateSplitState.runStats.fallbackProposals, 0, 'product rate-split proof must not use fallback proposals.');
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
  assert.ok(state.runStats.workerProcessExecutions > 0, 'normal harness run should execute workspace tools outside the extension host.');
  assert.equal(state.runStats.workerProcessFailures, 0, 'normal successful harness run should not manufacture worker-process failures from IPC shutdown races.');
  assert.ok(Object.values(state.workerContexts).some((worker: any) => worker.lastWorkerPid && worker.lastWorkerPid !== process.pid), 'worker context should persist an external process id.');
  assert.ok(state.runStats.retrievalRefreshes > 0, 'retrieval refreshes should be counted.');
  assert.ok(typeof state.runStats.contextCompactions === 'number', 'context compactions should be counted.');
  assert.ok(typeof state.runStats.toolResultSectionsCleared === 'number', 'cleared tool-result sections should be counted.');
  assert.ok(state.runStats.safetyCheckpoints > 0, 'mutating proposals should create safety checkpoints.');
  assert.ok(Object.keys(state.roleHandoffs || {}).length > 0, 'role handoffs should be captured during a real run.');
  assert.ok(state.safetyCheckpoints.some((checkpoint: any) => checkpoint.manifestPath && checkpoint.protectedPaths?.length), 'safety checkpoints should include manifest paths and protected path scopes.');
  const persistedContext = JSON.parse(fs.readFileSync(path.join(workspace, '.forge', 'context-bundle.json'), 'utf8'));
  assert.equal(persistedContext.goal, state.goalContract.goal, 'context bundle should rehydrate the goal.');
  assert.ok(Array.isArray(persistedContext.openTasks), 'context bundle should persist open task state.');
  assert.ok(Array.isArray(persistedContext.retrievalCandidates) && persistedContext.retrievalCandidates.length > 0, 'context bundle should persist retrieval candidates.');
  assert.ok(typeof persistedContext.promptCharBudget === 'number' && persistedContext.promptCharBudget > 0, 'context bundle should persist the prompt budget.');
  assert.ok(typeof persistedContext.promptChars === 'number' && persistedContext.promptChars <= persistedContext.promptCharBudget, 'persisted prompt accounting must stay within budget.');
  assert.ok(Array.isArray(persistedContext.includedSections), 'context bundle should persist included prompt sections.');
  assert.ok(Array.isArray(persistedContext.clearedSections), 'context bundle should persist cleared prompt sections.');
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
  commandState.taskGraph.tasks[2].status = 'completed';
  commandState = await commandLoop.runStep(commandState, {});
  delete process.env.FORGE_SANDBOX_SECRET;
  assert.ok(fs.existsSync(path.join(commandWorkspace, 'generated', 'effect.txt')), 'command should create fixture file.');
  assert.ok(commandState.commandEffects.some((entry: any) => entry.created.includes('generated/effect.txt')), 'command side-effect ledger should record created file.');
  assert.ok(commandState.commandEffects.some((entry: any) => entry.sandbox?.sanitizedEnv === true), 'command side-effect ledger should record sanitized sandbox metadata.');
  assert.ok(commandState.commandEffects.some((entry: any) => entry.sandbox?.blockedEnvKeys?.includes('FORGE_SANDBOX_SECRET')), 'command sandbox should block non-allowlisted secret env keys.');
  assert.ok(commandState.commandEffects.every((entry: any) => !(entry.sandbox?.allowedEnvKeys || []).includes('FORGE_SANDBOX_SECRET')), 'command sandbox must not allow the secret env key.');
  assert.equal(commandState.runStats.commandEffectCaptures, 1, 'command side-effect capture should be counted.');
  assert.equal(commandState.runStats.commandTransactions, 1, 'command transaction should be counted.');
  assert.equal(commandState.runStats.commandTransactionMergedFiles, 1, 'merged command files should be counted.');
  assert.equal(commandState.workerCommandTransactions[0]?.committed, true, 'main loop must persist committed command transaction evidence.');
  assert.equal(commandState.commandEffects[0]?.transactionId, commandState.workerCommandTransactions[0]?.id, 'side-effect evidence must link to its command transaction.');
  const commandEffectsArtifact = JSON.parse(fs.readFileSync(path.join(commandWorkspace, '.forge', 'command-effects.json'), 'utf8'));
  assert.ok(commandEffectsArtifact.some((entry: any) => entry.created.includes('generated/effect.txt')), 'command side-effect artifact should persist created file.');
  assert.ok(commandEffectsArtifact.some((entry: any) => entry.sandbox?.blockedEnvKeys?.includes('FORGE_SANDBOX_SECRET')), 'command side-effect artifact should persist sandbox blocked key names.');
  const commandTransactionsArtifact = JSON.parse(fs.readFileSync(path.join(commandWorkspace, '.forge', 'worker-command-transactions.json'), 'utf8'));
  assert.equal(commandTransactionsArtifact[0]?.mergedFileCount, 1, 'command transaction artifact should persist merged-file evidence.');
  const versionResult = await new WorkspaceTools(commandWorkspace).runCommand('curl.exe --version');
  assert.equal(versionResult.success, true, 'curl version probe should execute without making a network request.');
  assert.equal(versionResult.commandMetadata?.network.detected, true, 'command metadata should capture network-capable command intent.');
  assert.equal(versionResult.commandMetadata?.network.risk, 'read', 'non-mutating curl probe should classify as read intent.');

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
  assert.ok(costState.blockers.some((blocker: any) => blocker.category === 'budget' && blocker.status === 'terminal' && blocker.retryable === false), 'cost halt should terminalize a non-retryable budget blocker.');
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
  const transactionGitWorkspace = createTempWorkspace('forge-transaction-worktree-');
  fs.mkdirSync(path.join(transactionGitWorkspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(transactionGitWorkspace, 'src', 'edit.txt'), 'committed baseline\n', 'utf8');
  runGitTest(transactionGitWorkspace, ['init']);
  runGitTest(transactionGitWorkspace, ['add', '-A']);
  runGitTest(transactionGitWorkspace, ['-c', 'user.email=forge@test.local', '-c', 'user.name=Forge Test', 'commit', '-m', 'transaction baseline']);
  fs.writeFileSync(path.join(transactionGitWorkspace, 'src', 'edit.txt'), 'dirty source bytes\n', 'utf8');
  const worktreesBeforeTransaction = runGitTest(transactionGitWorkspace, ['worktree', 'list', '--porcelain']);
  const worktreeTransaction = await new TransactionalEditExecutor().dispatch(transactionGitWorkspace, 'Editor', {
    name: 'apply_patch',
    arguments: { path: 'src/edit.txt', patchContent: '<<<<<<< SEARCH\ndirty source bytes\n=======\ntransaction result\n>>>>>>> REPLACE' }
  });
  assert.equal(worktreeTransaction.success, true, 'git-backed edit transaction should commit.');
  assert.equal(worktreeTransaction.transaction.mode, 'git-worktree');
  assert.equal(worktreeTransaction.transaction.committed, true);
  assert.equal(worktreeTransaction.transaction.cleanupSucceeded, true);
  assert.ok(worktreeTransaction.transaction.baseCommit, 'worktree transaction should record base commit.');
  assert.equal(fs.readFileSync(path.join(transactionGitWorkspace, 'src', 'edit.txt'), 'utf8'), 'transaction result\n', 'dirty source overlay should be the patch base and merge target.');
  assert.equal(runGitTest(transactionGitWorkspace, ['worktree', 'list', '--porcelain']), worktreesBeforeTransaction, 'transaction worktree must be removed from git registry.');

  fs.writeFileSync(path.join(transactionGitWorkspace, 'src', 'command-dirty.txt'), 'dirty overlay', 'utf8');
  const worktreesBeforeCommand = runGitTest(transactionGitWorkspace, ['worktree', 'list', '--porcelain']);
  const worktreeCommand = await new TransactionalCommandExecutor().dispatch(transactionGitWorkspace, 'Reviewer', {
    name: 'run_command',
    arguments: { command: 'node -e "const fs=require(\'fs\'); fs.writeFileSync(\'src/command-dirty.txt\', fs.readFileSync(\'src/command-dirty.txt\',\'utf8\')+\'-processed\'); fs.writeFileSync(\'src/command-created.txt\',\'created in command worktree\')"' }
  });
  assert.equal(worktreeCommand.success, true, 'git-backed command transaction should commit staged multi-file effects.');
  assert.equal(worktreeCommand.commandTransaction.mode, 'git-worktree');
  assert.equal(worktreeCommand.commandTransaction.committed, true);
  assert.equal(worktreeCommand.commandTransaction.mergedFileCount, 2);
  assert.ok(worktreeCommand.commandTransaction.baseCommit);
  assert.equal(fs.readFileSync(path.join(transactionGitWorkspace, 'src', 'command-dirty.txt'), 'utf8'), 'dirty overlay-processed', 'command must execute from current dirty source state.');
  assert.equal(fs.readFileSync(path.join(transactionGitWorkspace, 'src', 'command-created.txt'), 'utf8'), 'created in command worktree');
  assert.equal(runGitTest(transactionGitWorkspace, ['worktree', 'list', '--porcelain']), worktreesBeforeCommand, 'command worktree must be removed from git registry.');
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
  assert.ok(aarOn.skillsBanked.length >= 1, 'verified reflected success must bank at least one procedural skill.');
  assert.ok(fs.existsSync(path.join(aarOnFixture, '.forge', 'lessons.json')), 'banked lessons must persist to lessons.json.');
  const aarOnSkills = JSON.parse(fs.readFileSync(path.join(aarOnFixture, '.forge', 'skill-registry.json'), 'utf8'));
  assert.ok(aarOnSkills.some((skill: any) => skill.successfulRuns >= 1 && skill.sourceSessionIds?.length), 'successful recovery skill must persist verified provenance.');
  const aarOff = JSON.parse(fs.readFileSync(path.join(aarOffFixture, '.forge', 'aar.json'), 'utf8'));
  assert.equal(aarOff.terminalStatus, 'failed', 'off-lane AAR should record the failed terminal state.');
  assert.ok(aarOff.triggers.reflectionSuppressed >= 1, 'off-lane AAR should count suppressed reflections.');
  assert.ok(aarOff.improveTools.some((note: string) => /suppressed/i.test(note)), 'off-lane AAR should flag reflection suppression in improve-tools.');
  const aarOffSkills = JSON.parse(fs.readFileSync(path.join(aarOffFixture, '.forge', 'skill-registry.json'), 'utf8'));
  assert.equal(aarOffSkills.length, 0, 'failed reflection-off lane must not teach the skill registry.');
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

  for (const rel of ['.forge/state.json', '.forge/context-bundle.json', '.forge/retrieval-index.json', '.forge/semantic-retrieval.json', '.forge/role-handoffs.json', '.forge/worker-contexts.json', '.forge/worker-edit-transactions.json', '.forge/worker-command-transactions.json', '.forge/skill-registry.json', '.forge/blockers.json', '.forge/safety-checkpoints.json', '.forge/command-effects.json', '.forge/budget.json', '.forge/isolated-runs/latest-isolated-run.json', '.forge/isolated-runs/latest-isolated-run.diff', '.forge/goal-contract.json', '.forge/task-graph.json', '.forge/evidence-ledger.json', '.forge/diff-reviews.json', '.forge/reviewer-critiques.json', '.forge/precommit-reviews.json', '.forge/escalations.json', '.forge/latest-proof-report.json', '.forge/evals/latest-weak-model-eval.json', '.forge/verification-fixture-matrix.json', 'PLAN.md', 'todos.json', 'SCRATCHPAD.md', 'evidence_ledger.json']) {
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

  const openedArchitectHandoff = await vscode.commands.executeCommand('forge-agent.openArtifact', 'architectHandoff');
  assert.equal(openedArchitectHandoff, path.join(workspace, '.forge', 'architect-handoff.json'), 'architect handoff should open through native editor command.');

  const openedRetrieval = await vscode.commands.executeCommand('forge-agent.openArtifact', 'retrieval');
  assert.equal(openedRetrieval, path.join(workspace, '.forge', 'retrieval-index.json'), 'retrieval index should open through native editor command.');

  const openedHandoffs = await vscode.commands.executeCommand('forge-agent.openArtifact', 'handoffs');
  assert.equal(openedHandoffs, path.join(workspace, '.forge', 'role-handoffs.json'), 'role handoffs should open through native editor command.');
  const openedWorkerContexts = await vscode.commands.executeCommand('forge-agent.openArtifact', 'workerContexts');
  assert.equal(openedWorkerContexts, path.join(workspace, '.forge', 'worker-contexts.json'), 'worker contexts should open through native editor command.');
  const openedBlockers = await vscode.commands.executeCommand('forge-agent.openArtifact', 'blockers');
  assert.equal(openedBlockers, path.join(workspace, '.forge', 'blockers.json'), 'blocker ledger should open through native editor command.');
  const openedSemanticRetrieval = await vscode.commands.executeCommand('forge-agent.openArtifact', 'semanticRetrieval');
  assert.equal(openedSemanticRetrieval, path.join(workspace, '.forge', 'semantic-retrieval.json'), 'semantic retrieval report should open through native editor command.');
  const openedEditTransactions = await vscode.commands.executeCommand('forge-agent.openArtifact', 'editTransactions');
  assert.equal(openedEditTransactions, path.join(workspace, '.forge', 'worker-edit-transactions.json'), 'edit transaction ledger should open through native editor command.');

  const openedCommandTransactions = await vscode.commands.executeCommand('forge-agent.openArtifact', 'commandTransactions');
  assert.equal(openedCommandTransactions, path.join(workspace, '.forge', 'worker-command-transactions.json'), 'command transaction ledger should open through native editor command.');

  const openedSkills = await vscode.commands.executeCommand('forge-agent.openArtifact', 'skills');
  assert.equal(openedSkills, path.join(workspace, '.forge', 'skill-registry.json'), 'procedural skill registry should open through native editor command.');

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

export async function run(): Promise<void> {
  try {
    await runSuite();
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`Forge Agent E2E failure: ${detail}`);
    const failurePath = path.resolve(__dirname, '..', '..', '..', '.tmp', 'e2e-failure.log');
    fs.mkdirSync(path.dirname(failurePath), { recursive: true });
    fs.writeFileSync(failurePath, detail, 'utf8');
    throw error;
  }
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

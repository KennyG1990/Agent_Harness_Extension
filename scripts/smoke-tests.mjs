import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const provider = read('src/harness/provider.ts');
assert.match(provider, /openrouter\/pareto-code/, 'provider must default to openrouter/pareto-code');
assert.match(provider, /openrouter\/auto/, 'provider must include openrouter/auto fallback');
assert.match(provider, /session_id/, 'provider must pass session_id');
assert.match(provider, /json_schema/, 'provider must use json_schema response format');
assert.doesNotMatch(provider, /slice\(0,\s*75\)/, 'provider must not truncate the OpenRouter model catalog');
assert.match(provider, /promptPrice/, 'provider must expose model prompt price metadata');
assert.match(provider, /completionPrice/, 'provider must expose model completion price metadata');
assert.match(provider, /supportedParameters/, 'provider must expose supported parameter metadata');
assert.match(provider, /fetchModelCatalog/, 'provider must fetch OpenRouter catalog through a dedicated helper');
assert.match(provider, /mergeModels/, 'provider must merge authenticated and anonymous OpenRouter catalogs');

const firewall = read('src/harness/firewall.ts');
assert.doesNotMatch(firewall, /execPromise\(['"`]git reset --hard/, 'firewall must not execute git reset --hard');
assert.match(firewall, /validatePatchApplicability/, 'firewall must validate patch applicability');
assert.match(firewall, /validateCommand/, 'firewall must validate commands');
assert.match(firewall, /manifest\.json/, 'firewall checkpoints must write manifest artifacts');
assert.match(firewall, /targeted-files/, 'firewall must support targeted file checkpoints');
assert.match(firewall, /workspace-snapshot/, 'firewall must support workspace snapshot checkpoints');
assert.match(firewall, /network_intent_blocked/, 'firewall must reject high-risk outbound network intent before execution');

const commandNetwork = read('src/harness/commandNetwork.ts');
assert.match(commandNetwork, /classifyCommandNetworkIntent/, 'network command intent classifier must exist');
assert.match(commandNetwork, /package-registry-write/, 'network classifier must identify package publication');
assert.match(commandNetwork, /remote-file-transfer/, 'network classifier must identify remote file transfer');
assert.match(commandNetwork, /Allowed read-only network intent with audit capture/, 'network classifier must preserve auditable read-only access');

const tools = read('src/harness/tools.ts');
assert.match(tools, /Malformed patch: expected SEARCH\/REPLACE hunk/, 'malformed patches must be rejected');
assert.match(tools, /findLenientMatch/, 'patch application must support whitespace-lenient matching');
assert.match(tools, /ambiguous/, 'lenient matching must reject ambiguous windows');
assert.match(tools, /whitespace-lenient matching/, 'lenient applications must be visible in tool output');
assert.match(tools, /resolvePatchTargetByContent/, 'content-addressed patch target resolution must exist');
assert.doesNotMatch(tools, /rewrote entire file contents/, 'malformed patches must not fall back to full-file rewrite');
assert.match(tools, /buildCommandSandbox/, 'commands must build a sandbox environment');
assert.match(tools, /sanitizedEnv: true/, 'command results must record sanitized environment execution');
assert.match(tools, /blockedEnvKeys/, 'command sandbox must report blocked env key names');
assert.match(tools, /classifyCommandNetworkIntent/, 'command evidence must use the same network classifier as the firewall');
const workerExecutor = read('src/harness/workerExecutor.ts');
const workerHost = read('src/harness/workerHost.ts');
const semanticRetrieval = read('src/harness/semanticRetrieval.ts');
assert.match(semanticRetrieval, /api\/v1\/embeddings/, 'semantic provider must use the official OpenRouter embeddings endpoint');
assert.match(semanticRetrieval, /input: inputs/, 'embedding requests must batch text inputs');
assert.match(semanticRetrieval, /cosineSimilarity/, 'semantic ranking must use cosine similarity');
assert.match(semanticRetrieval, /embedding-cache\.json/, 'embedding vectors must use a content-addressed cache');
assert.match(semanticRetrieval, /semanticRetrievalEnabled/, 'external source embedding must remain explicit opt-in');
assert.match(workerExecutor, /fork\(workerModule/, 'workspace tools must execute in a child process');
assert.match(workerExecutor, /buildWorkerEnvironment/, 'worker process must receive a sanitized environment');
assert.match(workerExecutor, /Worker process timed out/, 'worker process boundary must fail honestly on timeout');
assert.match(workerExecutor, /blockedEnvKeys/, 'worker process evidence must list removed environment key names');
assert.match(workerHost, /WorkspaceTools\(request\.workspaceRoot\)\.dispatch/, 'child worker must dispatch only the validated workspace proposal it receives');
assert.match(workerHost, /process\.exit/, 'one-shot worker must exit after returning its result');

const loop = read('src/harness/loop.ts');
const harnessTypes = read('src/harness/types.ts');
const blockers = read('src/harness/blockers.ts');
assert.match(blockers, /classifyBlocker/, 'deterministic blocker classifier must exist');
assert.match(blockers, /role_capability/, 'blocker taxonomy must distinguish role capability violations');
assert.match(blockers, /patch_applicability/, 'blocker taxonomy must distinguish patch applicability failures');
assert.match(blockers, /network_policy/, 'blocker taxonomy must distinguish network policy failures');
assert.match(blockers, /worker_process/, 'blocker taxonomy must distinguish worker process failures');
assert.match(harnessTypes, /interface ArchitectHandoff/, 'product loop must define a persisted architect handoff');
assert.match(loop, /architect-handoff\.json/, 'architect handoff must persist as a first-class artifact');
assert.match(loop, /extractPlanFocusFiles/, 'architect handoff must extract exact plan-named focus files');
assert.match(loop, /proposalCompletesTask/, 'task completion must be role-specific');
assert.match(loop, /proposal\.name === 'run_tests'.*activeTask\.owner === 'Reviewer'/, 'green tests must not complete Architect or Editor tasks');
assert.match(loop, /proposal\.name === 'record_evidence'.*activeTask\.owner === 'Reviewer'/, 'evidence recording must not complete Architect or Editor tasks');
assert.match(loop, /modelBindings\.Architect \|\| modelBindings\.plan/, 'product Architect must honor the webview plan binding alias');
assert.match(loop, /modelBindings\.Editor \|\| modelBindings\.code/, 'product Editor must honor the webview code binding alias');
assert.match(loop, /architect-plan/, 'Editor prompt must include the committed architect plan');
assert.match(loop, /focus-file:/, 'Editor prompt must include plan-focused file sections');
assert.ok(fs.existsSync(path.join(root, 'src/harness/contextBudget.ts')), 'context budget scheduler module must exist');
const contextBudget = fs.existsSync(path.join(root, 'src/harness/contextBudget.ts')) ? read('src/harness/contextBudget.ts') : '';
assert.match(contextBudget, /assemblePromptWithinBudget/, 'context scheduler must expose deterministic prompt assembly');
assert.match(contextBudget, /required/, 'context scheduler must protect required sections');
assert.match(contextBudget, /clearedSections/, 'context scheduler must report prompt-only clearing');
assert.match(contextBudget, /truncatedSections/, 'context scheduler must report deterministic truncation');
assert.match(contextBudget, /budgetChars/, 'context scheduler must enforce a hard character budget');
assert.match(loop, /hasGreenEvidence/, 'loop must gate success on green evidence');
assert.doesNotMatch(loop, /No pending tasks left\. Harness halting/, 'loop must not mark success from task count only');
assert.match(loop, /ESCALATE_AFTER_REFLECTIONS/, 'loop must define bounded escalation threshold');
assert.match(loop, /selectModelForTask/, 'loop must route model selection through escalation policy');
assert.match(loop, /escalations\.json/, 'loop must persist escalation artifacts');
assert.match(loop, /context-bundle\.json/, 'loop must persist context bundle artifacts');
assert.match(loop, /refreshContextBundle/, 'loop must refresh a rehydratable context bundle');
assert.match(loop, /assemblePromptWithinBudget/, 'product loop must assemble prompts through the context budget scheduler');
assert.match(loop, /contextCompactions/, 'product loop must count actual context compactions');
assert.match(loop, /toolResultSectionsCleared/, 'product loop must count cleared stale tool-result sections');
assert.match(loop, /retrievalPolicy/, 'context bundle must include retrieval policy');
assert.match(loop, /retrieval-index\.json/, 'loop must persist retrieval index artifacts');
assert.match(loop, /rankRetrievalCandidates/, 'loop must rank retrieval candidates deterministically');
assert.match(loop, /retrievalCandidates/, 'context bundle must include retrieval candidates');
assert.match(loop, /role-handoffs\.json/, 'loop must persist per-role handoff artifacts');
assert.match(loop, /refreshRoleHandoff/, 'loop must refresh per-role handoff artifacts');
assert.match(loop, /allowedToolsForRole/, 'role handoffs must include allowed tool scopes');
assert.match(loop, /validateRoleCapability/, 'role tool scopes must be enforced before commit');
assert.match(loop, /role_capability_blocked/, 'cross-role tool use must produce an explicit firewall reason');
assert.match(loop, /worker-contexts\.json/, 'role-scoped worker contexts must persist as evidence');
assert.match(loop, /:worker:/, 'provider sessions must be role-scoped rather than shared across workers');
assert.match(loop, /roleCapabilityBlocks/, 'role capability denials must be counted');
assert.match(loop, /ProcessWorkerExecutor/, 'main product loop must route tool commits through process workers');
assert.match(loop, /recordWorkerExecution/, 'worker PID and outcome evidence must persist in role context');
assert.match(loop, /workerProcessExecutions/, 'worker process executions must be counted');
assert.match(loop, /recordBlocker/, 'loop must record structured blockers at deterministic failure points');
assert.match(loop, /resolveBlockers/, 'loop must resolve blockers only from subsequent deterministic success');
assert.match(loop, /blockers\.json/, 'structured blocker ledger must persist');
assert.match(loop, /open-blockers/, 'open blockers must feed bounded proposal context');
assert.match(loop, /refreshSemanticRetrieval/, 'product loop must refresh semantic retrieval before prompt assembly');
assert.match(loop, /semantic cosine/, 'hybrid retrieval must expose semantic score provenance');
assert.match(loop, /semantic-retrieval\.json/, 'semantic retrieval report must persist');
assert.match(loop, /safety-checkpoints\.json/, 'loop must persist safety checkpoint ledger');
assert.match(loop, /command-effects\.json/, 'loop must persist command side-effect ledger');
assert.match(loop, /recordCommandSideEffects/, 'loop must capture command side effects');
assert.match(loop, /snapshotWorkspaceFiles/, 'loop must snapshot workspace files around commands');
assert.match(loop, /sandbox env allowed/, 'loop must log command sandbox env metadata');
assert.match(loop, /networkIntentCaptures/, 'loop must count captured network command intent');
assert.match(loop, /networkWriteBlocks/, 'loop must count blocked network mutation intent');
assert.match(loop, /RunBudget/, 'loop must carry explicit run budget state');
assert.match(loop, /DEFAULT_MAX_WALL_CLOCK_MS/, 'loop must define a wall-clock budget cap');
assert.match(loop, /enforceBudget/, 'loop must enforce run budget caps');
assert.match(loop, /budget\.json/, 'loop must persist budget artifacts');
assert.match(loop, /reviewer-critiques\.json/, 'loop must persist reviewer critique artifacts');
assert.match(loop, /REVIEWER_CRITIQUE_SCHEMA/, 'loop must request structured reviewer critiques');
assert.match(loop, /createReviewerCritique/, 'loop must create reviewer critique artifacts');
assert.match(loop, /precommit-reviews\.json/, 'loop must persist pre-commit review artifacts');
assert.match(loop, /PRE_COMMIT_REVIEW_SCHEMA/, 'loop must request structured pre-commit reviews');
assert.match(loop, /createPreCommitReview/, 'loop must review mutating proposals before commit');

const proof = read('src/harness/proof.ts');
assert.match(proof, /BlueprintProofRunner/, 'proof runner must exist');
assert.match(proof, /actuallyModelDriven/, 'proof report must distinguish model-driven runs from fallback runs');
assert.match(proof, /rejectedMalformedPatch/, 'proof report must include firewall rejection proof');

const isolation = read('src/harness/isolation.ts');
assert.match(isolation, /runIsolatedAgentGoal/, 'isolated run API must exist');
assert.match(isolation, /copyWorkspace/, 'isolated run must keep workspace-copy fallback for non-git sources');
assert.match(isolation, /sourceMutated/, 'isolated run report must prove whether source workspace mutated');
assert.match(isolation, /latest-isolated-run\.json/, 'isolated run report must persist a JSON artifact');
assert.match(isolation, /'worktree', 'add', '--detach'/, 'isolated run must support real git worktree execution');
assert.match(isolation, /'worktree', 'remove', '--force'/, 'non-kept git worktrees must be removed');
assert.match(isolation, /'worktree', 'prune'/, 'git worktree registration must be pruned after removal');
assert.match(isolation, /isolationMode/, 'isolated run report must record the isolation mode');
assert.match(isolation, /isolationFallbackReason/, 'isolated run report must explain copy fallback');
assert.match(isolation, /baseCommit/, 'worktree runs must record the base commit');
assert.match(isolation, /dirtyFilesOverlaid/, 'dirty source state must be overlaid into the worktree');
assert.match(isolation, /sourceDirtyStatusPreserved/, 'isolated run report must prove dirty source state was preserved');

const reflectionAb = read('src/harness/reflectionAb.ts');
assert.match(reflectionAb, /runReflectionAbEval/, 'reflection A/B eval runner must exist');
assert.match(reflectionAb, /reflectionEnabled/, 'reflection A/B must toggle reflection per lane');
assert.match(reflectionAb, /createScriptedRecoveryProvider/, 'reflection A/B must script causal recovery-after-reflection');
assert.match(reflectionAb, /latest-reflection-ab\.json/, 'reflection A/B must persist a scorecard artifact');
assert.match(reflectionAb, /offLaneHonestHalts/, 'reflection A/B must prove the off lane halts honestly');
assert.match(loop, /reflectionEnabled === false/, 'loop must support disabling reflection for A/B lanes');
assert.match(loop, /reflectionSuppressed/, 'loop must count suppressed reflections in the off lane');
assert.doesNotMatch(loop, /arguments: \{ type: 'object' \}/, 'TOOL_SCHEMA must not declare a property-less arguments object (live constrained decoders force arguments to {})');
assert.match(loop, /patchContent: \{ type: 'string' \}/, 'TOOL_SCHEMA must enumerate patchContent so grammar engines can emit it');
assert.match(loop, /planMd: \{ type: 'string' \}/, 'TOOL_SCHEMA must enumerate planMd');
assert.match(loop, /observation: \{ type: 'string' \}/, 'TOOL_SCHEMA must enumerate observation');
assert.match(loop, /export const TOOL_SCHEMA/, 'TOOL_SCHEMA must be exported for strict-decoder regression tests');
assert.match(loop, /applyControl/, 'loop must apply user control (pause/steer) before proposing');
assert.match(loop, /resumeFromDisk/, 'loop must support session-spanning resume from persisted state');
assert.match(loop, /control\.json/, 'run control must persist as a .forge artifact');
assert.match(loop, /Goal steered mid-run/, 'mid-run goal edits must merge without restart and be logged');
const goalContractSrc = read('src/harness/goalContract.ts');
assert.match(goalContractSrc, /parseGoalDirective/, 'goal directive parser must exist');
assert.match(goalContractSrc, /MANDATORY_ORACLE_GATES/, 'user doneWhen must add to, never replace, the oracle gates');
assert.match(loop, /resolvePatchTargetByContent/, 'MAIN loop must carry content-addressed path repair (Phase 50 port)');
assert.match(loop, /malformedPatchStreak/, 'MAIN loop must track malformed-patch streaks');
assert.match(loop, /STOP emitting apply_patch/, 'MAIN loop must switch to whole-file guidance after repeated malformed patches');
assert.match(loop, /SEARCH \/ \(exact lines copied from the file\)/, 'MAIN loop rejection reflections must carry the format exemplar');
assert.match(loop, /recordAar/, 'loop must record a terminal-state AAR');
assert.match(loop, /aar\.json/, 'loop must persist the AAR artifact');
assert.match(loop, /bankLessons/, 'loop must bank durable lessons from fired triggers');
assert.match(loop, /lessons\.json/, 'loop must persist the lessons artifact');
assert.match(loop, /recentLessons/, 'context bundle must rehydrate recent lessons for future runs');

const weakEval = read('src/harness/weakEval.ts');
assert.match(weakEval, /WeakModelEvalRunner/, 'weak-model eval runner must exist');
assert.doesNotMatch(weakEval, /arguments: \{ type: 'object' \}/, 'ACTION_SCHEMA must not declare a property-less arguments object');
assert.match(weakEval, /export const ACTION_SCHEMA/, 'ACTION_SCHEMA must be exported for strict-decoder regression tests');
assert.match(weakEval, /assertModelEndpointsLive/, 'live eval must probe endpoint liveness before running');
assert.match(weakEval, /PATCH_FORMAT_EXEMPLAR/, 'eval prompts must show a concrete SEARCH/REPLACE exemplar, not just name the format');
assert.match(weakEval, /REJECTED by deterministic validation/, 'harness lane must feed firewall rejection reasons into retries');
assert.match(weakEval, /lastValidationError/, 'lane results must capture the last validation error for diagnosis');
assert.match(weakEval, /rejectedPatchSample/, 'lane results must capture a rejected patch sample for diagnosis');
assert.match(weakEval, /pathRepairs/, 'harness path repairs must be counted, never silent');
assert.match(weakEval, /wholeFileRecoveries/, 'whole-file rewrite recoveries must be counted, never silent');
assert.match(weakEval, /STOP emitting patches/, 'harness must switch to whole-file requests after repeated malformed patches');
const firewallSrc = read('src/harness/firewall.ts');
assert.match(firewallSrc, /findLenientMatch/, 'firewall applicability must use the shared lenient matcher');
assert.match(weakEval, /runLiveSchemaCanary/, 'live eval must run a schema canary before the task suite');
assert.match(weakEval, /liveCanary/, 'weak eval report must record the live canary result');
assert.match(weakEval, /qwen\/qwen2\.5-coder-7b-instruct/, 'weak eval must prefer a small older inexpensive model');
assert.match(weakEval, /microsoft\/phi-3-mini-128k-instruct/, 'weak eval must include Phi-3 Mini as a weak candidate');
assert.match(weakEval, /north-mini-code/, 'weak eval must explicitly exclude new agentic coding specialists');
assert.match(weakEval, /fallbackSolved/, 'weak eval must report fallback-solved tasks separately');
assert.match(weakEval, /actuallyModelDriven/, 'weak eval must report model-driven harness successes');
assert.match(weakEval, /BARE_BASELINE/, 'weak eval must include a bare baseline lane');
assert.match(weakEval, /HARNESS_LANE/, 'weak eval must include a harness lane');
assert.ok((weakEval.match(/id: '[^']+'/g) || []).length >= 15, 'weak eval must include at least 15 disposable fixture tasks');

const tier2 = read('src/harness/weakEvalTier2.ts');
assert.match(tier2, /Tier2EvalRunner/, 'tier-2 eval runner must exist');
assert.match(tier2, /heldOutTest/, 'tier-2 tasks must carry a held-out judge');
assert.match(tier2, /runHeldOutJudge/, 'tier-2 solve must be decided by the runner-owned judge, never the model test');
assert.match(tier2, /workspaceOracleGreen/, 'tier-2 must track the model-visible oracle separately from the judge');
assert.match(tier2, /NO TEST SUITE EXISTS/, 'missing-test tasks must instruct the harness to author its oracle first');
assert.match(tier2, /authoredTest/, 'authored oracles must be visible in lane results');
assert.match(tier2, /'multi-file-bug'/, 'tier-2 must include multi-file bug tasks');
assert.match(tier2, /'missing-test'/, 'tier-2 must include missing-test tasks');
assert.match(tier2, /'feature'/, 'tier-2 must include feature tasks');
assert.ok(JSON.parse(read('package.json')).scripts['eval:tier2'], 'package must expose npm run eval:tier2');
assert.match(tier2, /contentAddressedRepairs/, 'content-addressed repairs must be counted, never silent');
assert.match(tier2, /runSwarmLane/, 'tier-2 must support the swarm A/B lane');
assert.match(tier2, /EXPLORER_WORKER/, 'explorer workers must be single-file, fresh-context, read-only');
assert.match(tier2, /swarm-handoff\.json/, 'swarm context must partition via a handoff artifact, never transcripts');
assert.match(tier2, /implementerPromptChars/, 'context multiplication must be measured, not assumed');
assert.match(tier2, /suspectRotations/, 'suspect rotation on red oracles must be counted');
assert.match(tier2, /extractInterlocks/, 'interlocking arcs: the require-graph must be extracted deterministically');
assert.match(tier2, /Interlocking interfaces/, 'explorers and implementer must see seam interfaces');
assert.match(tier2, /DEFAULT_TERRAIN_ROUTING/, 'terrain dispatch must route by a deterministic lookup, not a model');
assert.match(tier2, /dispatchLane/, 'dispatch decisions must be visible per task');
assert.match(tier2, /SOLO_PROMPT_CHAR_BUDGET/, 'solo prompts must have an honest character budget');
assert.match(tier2, /TRUNCATED: /, 'context overflow must be visible, never silent');
const tier3 = read('src/harness/weakEvalTier3.ts');
assert.match(tier3, /tier3Tasks/, 'tier-3 generated suite must exist');
assert.match(tier3, /beyond the solo lane's per-file truncation horizon/i, 'tier-3 defects must be seeded beyond the truncation horizon');
assert.match(tier3, /MockTier3Provider/, 'tier-3 mock must exist');
assert.match(tier3, /fix only what is visible/i, 'tier-3 mock must be honest-by-construction (information-gated)');
assert.ok(JSON.parse(read('package.json')).scripts['eval:tier3'], 'package must expose npm run eval:tier3');
assert.match(tier2, /ARCHITECT_PLANNER/, 'architect lane must exist: one planning call, judgment over goal and structure');
assert.match(tier2, /architectCost/, 'architect cost must be metered separately - the rate split is measured, never assumed');
assert.match(tier2, /premiseCheck/, 'plans must carry a premise check (cookbook caveat: audit the decomposition)');
assert.match(tier2, /verify the premise before trusting the plan/, 'implementer must be told to verify the premise');
assert.match(tier2, /architectSolved\?: number/, 'architect solves must be represented in reports');
assert.match(tier2, /architectSolved: 0/, 'by-kind accounting must include architect solves');
assert.match(tier2, /Math\.max\(harnessSolved, swarmSolved \|\| 0, architectSolved \|\| 0\)/, 'architect uplift must own the headline status when it beats bare/solo');
assert.match(tier2, /planSubtasks: string\[\]/, 'architect plans must persist ordered subtasks');
assert.match(tier2, /subtaskChecks/, 'architect lane must record oracle checks after committed subtasks');
assert.match(tier2, /CURRENT SUBTASK/, 'architect implementer prompt must execute one current subtask at a time');
assert.match(tier2, /extractPlanFiles/, 'architect lane must extract subtask file paths for focused full-file context');
assert.match(tier2, /normalizePlanSubtask/, 'architect lane must preserve real-model object subtasks instead of stringifying to [object Object]');
assert.match(tier2, /rejectProtectedWorkspaceTestMutation/, 'eval lanes must reject visible test-oracle mutation when a workspace test already exists');
assert.match(tier2, /Protected workspace oracle/, 'test-oracle mutation rejection must feed a clear reflection reason');
assert.match(tier2, /matched \$\{resolved\.matchCount\} candidate files/, 'ambiguous content-addressing must feed candidate counts back to the model');
assert.match(tier2, /providerCallTimeoutMs/, 'live eval calls must support a per-call timeout');
assert.match(tier2, /class TimeoutProvider implements Provider/, 'provider timeouts must be enforced by a provider wrapper');
assert.match(tier2, /persistTierReport\(buildReport/, 'tier eval reports must be flushed after completed tasks');
assert.match(tier2, /partial: results\.length < tasks\.length/, 'mid-suite reports must be marked partial');
assert.match(tier2, /completedTaskCount: results\.length/, 'partial reports must expose completed task count');
assert.match(tier2, /runId: string/, 'tier eval reports must expose a durable run identity');
assert.match(tier2, /startedAt: string/, 'tier eval reports must expose a stable run start time');
assert.match(tier2, /archivePath\?: string/, 'tier eval reports must expose an immutable archive path');
assert.match(tier2, /evals', 'runs', `tier-\$\{tier\}`/, 'tier eval archives must be separated by tier');
assert.match(tier2, /report\.archivePath/, 'tier eval persistence must write the immutable archive');
assert.match(read('scripts/weak-model-eval-tier2.mjs'), /--call-timeout-ms/, 'tier-2 CLI must expose provider call timeout control');
assert.match(read('scripts/weak-model-eval-tier3.mjs'), /--call-timeout-ms/, 'tier-3 CLI must expose provider call timeout control');
assert.match(read('scripts/weak-model-eval-tier4.mjs'), /--call-timeout-ms/, 'tier-4 CLI must expose provider call timeout control');
for (const cli of ['scripts/weak-model-eval-tier2.mjs', 'scripts/weak-model-eval-tier3.mjs', 'scripts/weak-model-eval-tier4.mjs']) {
  assert.match(read(cli), /runId: report\.runId/, `${cli} must print the durable run identity`);
  assert.match(read(cli), /archivePath: report\.archivePath/, `${cli} must print the immutable archive path`);
}
assert.match(read('scripts/weak-model-eval-tier4.mjs'), /providerCallTimeoutMs = 90000/, 'tier-4 live eval must default to a conservative provider timeout');

const tier4 = read('src/harness/weakEvalTier4.ts');
assert.match(tier4, /proveTier4SuiteSolvable/, 'tier-4 must mechanically prove fixtures are solvable');
assert.match(tier4, /applyProvenFixes/, 'tier-4 solvability proof must apply hidden proven fixes');
assert.match(tier4, /PROVEN_EXTRA\[task\.id\]/, 'tier-4 solvability proof must include coordinated extra fixes');
assert.match(read('scripts/weak-model-eval-tier4.mjs'), /proveTier4SuiteSolvable\(tasks\)/, 'tier-4 CLI must refuse unsolvable suites before model calls');

const extension = read('src/extension.ts');
assert.match(extension, /forge-agent\.runBlueprintProofMatrix/, 'extension must expose proof matrix command');
assert.match(extension, /forge-agent\.getProofReport/, 'extension must expose proof report command');
assert.match(extension, /forge-agent\.runWeakModelEval/, 'extension must expose weak-model eval command');
assert.match(extension, /forge-agent\.runVerificationFixtureMatrix/, 'extension must expose verification fixture matrix command');
assert.match(extension, /forge-agent\.getWeakModelEvalReport/, 'extension must expose weak-model eval report command');
assert.match(extension, /forge-agent\.openArtifact/, 'extension must expose native artifact open command');
assert.match(extension, /retrieval: path\.join\('\.forge', 'retrieval-index\.json'\)/, 'extension must expose retrieval artifact open path');
assert.match(extension, /safety: path\.join\('\.forge', 'safety-checkpoints\.json'\)/, 'extension must expose safety checkpoint artifact open path');
assert.match(extension, /commandEffects: path\.join\('\.forge', 'command-effects\.json'\)/, 'extension must expose command effects artifact open path');
assert.match(extension, /budget: path\.join\('\.forge', 'budget\.json'\)/, 'extension must expose budget artifact open path');
assert.match(extension, /isolatedRun: path\.join\('\.forge', 'isolated-runs', 'latest-isolated-run\.json'\)/, 'extension must expose isolated run artifact open path');
assert.match(extension, /critiques: path\.join\('\.forge', 'reviewer-critiques\.json'\)/, 'extension must expose reviewer critique artifact open path');
assert.match(extension, /precommit: path\.join\('\.forge', 'precommit-reviews\.json'\)/, 'extension must expose pre-commit artifact open path');
assert.match(extension, /forge-agent\.chat/, 'extension must expose chat command');
assert.match(extension, /forge-agent\.runAgentGoal/, 'extension must expose autonomous goal run command');
assert.match(extension, /forge-agent\.runIsolatedAgentGoal/, 'extension must expose isolated goal run command');
assert.match(extension, /forge-agent\.runReflectionAbEval/, 'extension must expose reflection A/B eval command');
assert.match(extension, /forge-agent\.setGoal/, 'extension must expose goal elicitation command');
assert.match(extension, /forge-agent\.pauseGoal/, 'extension must expose pause command');
assert.match(extension, /forge-agent\.steerGoal/, 'extension must expose mid-run steering command');
assert.match(extension, /forge-agent\.resumeAgentGoal/, 'extension must expose session resume command');
assert.match(extension, /\/goal\\s\+/, 'chat bridge must intercept /goal directives');
assert.match(loop, /persistSession/, 'sessions must persist durably under .forge/sessions/<id>/');
assert.match(loop, /autoTitle/, 'sessions must get contextual titles (cosmetic; sessionId is identity)');
assert.match(loop, /sessions', 'index\.json'/, 'a fast session index must be maintained');
assert.match(loop, /reviewerGateProposal/, 'reviewer diff/evidence gates must run deterministically before model proposals');
assert.match(loop, /green tests require diff inspection/, 'green tests must force get_diff before evidence or success');
assert.match(loop, /proposal: \{ name: 'get_diff'/, 'reviewer gate must force native diff inspection');
assert.match(loop, /declare success after green evidence and required diff review/, 'reviewer gate must own terminal success declaration after proof exists');
assert.match(extension, /'list-sessions'/, 'bridge must list sessions');
assert.match(extension, /'load-session'/, 'bridge must load a session (and make it active)');
assert.match(extension, /'pin-session'/, 'bridge must pin sessions');
assert.match(extension, /'save-chat'/, 'bridge must persist chat per session');
assert.match(extension, /'pause-goal'/, 'webview bridge must expose pause');
assert.match(extension, /'resume-goal'/, 'webview bridge must expose resume');
assert.match(extension, /'success', 'failed', 'gave_up', 'paused'/, 'ALL run loops must exit on paused');
assert.match(extension, /getConfiguration\('forge'\)/, 'UI runs must honor forge.* settings');
assert.ok(JSON.parse(read('package.json')).contributes.configuration.properties['forge.maxCostUsd'], 'budget cap must be a native setting');
assert.ok(JSON.parse(read('package.json')).contributes.configuration.properties['forge.reflectionEnabled'], 'reflection toggle must be a native setting');
assert.match(extension, /reflectionAb: path\.join\('\.forge', 'evals', 'latest-reflection-ab\.json'\)/, 'extension must expose reflection A/B artifact open path');
assert.match(extension, /aar: path\.join\('\.forge', 'aar\.json'\)/, 'extension must expose AAR artifact open path');
assert.match(extension, /lessons: path\.join\('\.forge', 'lessons\.json'\)/, 'extension must expose lessons artifact open path');
assert.match(extension, /run-agent-loop/, 'extension webview bridge must expose autonomous run loop');
assert.match(extension, /run-isolated-agent-goal/, 'extension webview bridge must expose isolated run loop');
assert.match(extension, /workbench\.action\.openSettings/, 'extension must route settings to native settings');
assert.match(extension, /createTerminal/, 'extension must use native IDE terminals');

const webview = read('src/webview/src/App.tsx');
assert.match(webview, /testId="pause-run"/, 'webview must expose a pause button');
assert.match(webview, /testId="resume-run"/, 'webview must expose a resume button');
for (const testId of ['forge-agent-app', 'run-console', 'view-run', 'view-proof', 'view-settings', 'initialize-run', 'step-loop', 'proof-panel', 'settings-panel', 'run-proof-matrix', 'refresh-models', 'agent-chat', 'chat-input', 'send-chat', 'role-menu-button', 'model-menu-button', 'inference-menu-button', 'role-menu', 'composer-model-menu', 'composer-model-search', 'inference-menu']) {
  assert.match(webview, new RegExp(`(data-testid|testId)="${testId}"`), `missing webview selector ${testId}`);
}
assert.match(webview, /run-weak-model-eval/, 'webview must expose weak eval button');
assert.match(webview, /open-weak-model-eval/, 'webview must expose weak eval scorecard open button');
assert.match(webview, /run-verification-matrix/, 'webview must expose verification fixture matrix button');
assert.match(webview, /open-verification-matrix/, 'webview must expose verification matrix open button');
assert.match(webview, /run-isolated-agent-goal/, 'webview must expose isolated run button');
assert.match(webview, /open-isolated-run/, 'webview must expose isolated run report open button');
assert.match(webview, /command: 'chat'/, 'webview must post chat messages to extension host');
assert.match(webview, /run-agent-loop/, 'webview run button must start the firewalled agent loop');
assert.match(webview, /agentRoles/, 'webview must expose role presets');
assert.match(webview, /selectedRole/, 'webview must track selected composer role');
assert.match(webview, /inferenceMode/, 'webview must track selected inference mode');
assert.match(webview, /favoriteModels/, 'webview must support model favorites');
assert.match(webview, /role="code"/, 'missing code model picker');
assert.match(webview, /role="plan"/, 'missing plan model picker');
assert.match(webview, /role="review"/, 'missing review model picker');
assert.match(webview, /data-testid=\{`model-picker-\$\{role\}`\}/, 'missing model picker test id template');
assert.match(webview, /data-testid=\{`model-search-\$\{role\}`\}/, 'missing model search test id template');
assert.match(webview, /scoreModelForRole/, 'webview must rank models per role');
assert.match(webview, /ModelSortSelect/, 'webview must expose model sorting controls');
assert.match(webview, /reasoningRank/, 'webview must support reasoning rank sort');
assert.match(webview, /codingRank/, 'webview must support coding rank sort');
assert.match(webview, /modelCost/, 'webview must support cost sort');
assert.match(webview, /formatCost/, 'webview must display model cost metadata');
assert.match(webview, /SearchableModelPicker/, 'webview must expose searchable model pickers');
assert.match(webview, /escalationCount/, 'webview must expose escalation counter in run status');
assert.match(webview, /contextRefreshes/, 'webview must expose context refresh counter in run status');
assert.match(webview, /roleHandoffRefreshes/, 'webview must expose role handoff refresh counter in run status');
assert.match(webview, /retrievalRefreshes/, 'webview must expose retrieval refresh counter in run status');
assert.match(webview, /safetyCheckpoints/, 'webview must expose safety checkpoint counter in run status');
assert.match(webview, /commandEffectCaptures/, 'webview must expose command effect counter in run status');
assert.match(webview, /budgetHalts/, 'webview must expose budget halt counter in run status');
assert.match(webview, /maxCostUsd/, 'webview must expose run budget cost cap in run status');
assert.match(webview, /reviewerCritiques/, 'webview must expose reviewer critique counter in run status');
assert.match(webview, /preCommitReviews/, 'webview must expose pre-commit review counter in run status');

const pkg = JSON.parse(read('package.json'));
assert.ok(pkg.scripts.eval, 'package must expose npm run eval');
assert.ok(pkg.scripts['eval:reflection'], 'package must expose npm run eval:reflection');

const verificationMatrix = read('src/harness/verificationMatrix.ts');
for (const fixtureId of ['passing-tests', 'failing-tests', 'missing-test-suite', 'typecheck-failure', 'lint-failure', 'malformed-patch', 'out-of-workspace-path', 'blocked-command', 'unsolvable-step-cap']) {
  assert.match(verificationMatrix, new RegExp(fixtureId), `verification matrix must include fixture ${fixtureId}`);
}
for (const removed of [
  'CodeEditor',
  'GoalLoopTerminal',
  'WorkspaceExplorer',
  'PlanEditorPanel',
  'TaskGraphWidget',
  'EvidenceLedgerView',
  'SubAgentActivityWidget',
  'CostWidget',
  'Workspace Filetree',
  'Terminal: agent-loop',
  'marketplace',
  'mode-generative',
  'terminal-pane',
  'plan-pane',
  'fake terminal'
]) {
  assert.doesNotMatch(webview, new RegExp(removed, 'i'), `product webview must not include cloned IDE surface: ${removed}`);
}

console.log('smoke invariants: PASS');

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AarReport, AarTriggerCounts, ArchitectHandoff, BlockerCategory, BlockerEntry, BlockerSource, ClarificationRequest, CommandSideEffectEntry, ContextBundle, DiffReviewEntry, EscalationEntry, EvidenceLedgerItem, GoalContract, HarnessState, LessonEntry, PreCommitReviewEntry, ReflectionEntry, RetrievalCandidate, ReviewerCritiqueEntry, RoleHandoff, RunBudget, SafetyCheckpoint, StepLog, TaskItem, ToolName, ToolProposal, WorkerCommandTransaction, WorkerContext, WorkerEditTransaction } from './types';
import { createConfiguredProvider, OpenRouterProvider, Provider } from './provider';
import { resolvePatchTargetByContent, WorkspaceTools } from './tools';
import { Firewall } from './firewall';
import { VerificationOracles, OracleResult } from './oracles';
import { assemblePromptWithinBudget, PromptSection } from './contextBudget';
import { ProcessWorkerExecutor, WorkerProcessMetadata } from './workerExecutor';
import { classifyBlocker } from './blockers';
import { createConfiguredEmbeddingProvider, EmbeddingProvider, rankSemantically, SemanticDocument } from './semanticRetrieval';
import { TransactionalEditExecutor } from './transactionalEdits';
import { TransactionalCommandExecutor } from './transactionalCommands';
import { bankProceduralSkills, renderProceduralSkills, selectProceduralSkills } from './proceduralSkills';
import { createWorkflowGovernance, enforceWorkflowPlan, finalizeWorkflow, recordWorkflowEvent, renderWorkflowTaskRecord, validateWorkflowProposal, workflowReadyForSuccess } from './workflowGovernance';
import { renderOpenOracleFailures, updateOracleFailures } from './oracleRemediation';

const MAX_REPAIR_ATTEMPTS = 2;
const MAX_NO_PROGRESS_TURNS = 4;
const MAX_REFLECTION_ATTEMPTS = 3;
const MAX_IDENTICAL_ORACLE_FAILURES = 3;
const ESCALATE_AFTER_REFLECTIONS = 2;
const DEFAULT_MAX_WALL_CLOCK_MS = 30 * 60 * 1000;
export const DEFAULT_PROMPT_CHAR_BUDGET = 96_000;

interface ProposalEnvelope {
  explanation: string;
  proposal: ToolProposal;
  confidence?: number;
  materialUncertainty?: boolean;
  uncertainties?: string[];
}

export const TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'proposal'],
  properties: {
    explanation: { type: 'string' },
    proposal: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'arguments'],
      properties: {
        name: {
          type: 'string',
          enum: ['repo_search', 'symbol_search', 'read_file', 'read_range', 'write_file', 'apply_patch', 'run_command', 'run_tests', 'get_diff', 'update_tasks', 'update_plan', 'record_evidence', 'ask_user', 'declare_success']
        },
        // Live constrained decoders emit ONLY schema-declared properties. A bare
        // { type: 'object' } here forces `arguments: {}` under strict grammar
        // enforcement (proven live in the 2026-07-08 OpenRouter run), so every
        // tool argument must be enumerated. Properties stay optional to remain
        // lenient for weak models; the firewall still validates content.
        arguments: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            patchContent: { type: 'string' },
            content: { type: 'string' },
            command: { type: 'string' },
            query: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
            planMd: { type: 'string' },
            tasks: { type: 'array', items: { type: 'object' } },
            observation: { type: 'string' }
            ,question: { type: 'string' }
            ,uncertainty: { type: 'string' }
            ,options: { type: 'array', items: { type: 'string' } }
            ,recommendedAnswer: { type: 'string' }
          }
        }
      }
    },
    confidence: { type: 'number' },
    materialUncertainty: { type: 'boolean' },
    uncertainties: { type: 'array', items: { type: 'string' } }
  }
};

const REVIEWER_CRITIQUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'concerns'],
  properties: {
    status: { type: 'string', enum: ['approved', 'no_changes', 'blocked'] },
    summary: { type: 'string' },
    concerns: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

const PRE_COMMIT_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'concerns'],
  properties: {
    status: { type: 'string', enum: ['approved', 'blocked'] },
    summary: { type: 'string' },
    concerns: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

export class AgentHarnessLoop {
  private provider: Provider;
  private tools: WorkspaceTools;
  private firewall: Firewall;
  private oracles: VerificationOracles;
  private workerExecutor = new ProcessWorkerExecutor();
  private transactionalEditExecutor = new TransactionalEditExecutor(this.workerExecutor);
  private transactionalCommandExecutor = new TransactionalCommandExecutor(this.workerExecutor);
  private latestState?: HarnessState;
  private proofStats = { providerCalls: 0, providerFailures: 0, fallbackProposals: 0 };

  constructor(provider: Provider = createConfiguredProvider(), private readonly workspaceRootOverride?: string, private readonly embeddingProvider: EmbeddingProvider | undefined = createConfiguredEmbeddingProvider()) {
    this.provider = provider;
    this.tools = new WorkspaceTools(workspaceRootOverride);
    this.firewall = new Firewall(this.tools);
    this.oracles = new VerificationOracles(workspaceRootOverride);
  }

  public getDiagnostics(): any {
    return {
      hasState: Boolean(this.latestState),
      state: this.latestState,
      provider: getVscode()?.workspace.getConfiguration('forge').get('providerDefault', 'openrouter') || 'openrouter'
    };
  }

  public getProofStats(): { providerCalls: number; providerFailures: number; fallbackProposals: number } {
    return { ...this.proofStats };
  }

  public async listModels() {
    return this.provider.listModels();
  }

  public async initializeHarness(goal: string, modelBindings: Record<string, string> = {}, budgetOverrides: Partial<RunBudget> = {}, harnessOptions: { reflectionEnabled?: boolean; goalOverrides?: GoalOverrides } = {}): Promise<HarnessState> {
    const sessionId = `forge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const overrides = harnessOptions.goalOverrides || {};
    const goalContract: GoalContract = {
      goal: goal.trim() || 'Run verification and make the workspace green.',
      context: 'VS Code workspace extension host',
      constraints: mergeUnique(['All mutations must pass deterministic firewall validation.', 'Terminal success requires a green test oracle and ledger evidence.'], overrides.constraints),
      // User doneWhen criteria ADD to the oracle gates, never replace them.
      doneWhen: mergeUnique(overrides.doneWhen || [], ['run_tests oracle passes', 'evidence ledger contains the green oracle result']),
      nonGoals: mergeUnique(['No out-of-workspace writes', 'No destructive shell commands'], overrides.nonGoals),
      budget: 2,
      spent: 0
    };
    const mergedBudgetOverrides: Partial<RunBudget> = Number.isFinite(overrides.budgetUsd)
      ? { ...budgetOverrides, maxCostUsd: Number(overrides.budgetUsd) }
      : budgetOverrides;
    const workflow = createWorkflowGovernance(this.tools.getWorkspaceRoot(), goalContract);
    const initialTasks: TaskItem[] = [
      { id: '1', title: 'Inspect workspace and identify relevant files', status: 'pending', dependencies: [], blockers: [], owner: 'Explorer' },
      { id: '2', title: 'Create or update the implementation plan', status: workflow.lane === 'light' ? 'completed' : 'pending', dependencies: ['1'], blockers: [], owner: 'Architect' },
      { id: '3', title: 'Apply scoped code changes through the firewall', status: 'pending', dependencies: ['2'], blockers: [], owner: 'Editor' },
      { id: '4', title: 'Run verification oracle', status: 'pending', dependencies: ['3'], blockers: [], owner: 'Reviewer' },
      { id: '5', title: 'Record green evidence and declare success', status: 'pending', dependencies: ['4'], blockers: [], owner: 'Reviewer' }
    ];

    const state: HarnessState = {
      sessionId,
      goalContract,
      taskGraph: {
        tasks: initialTasks
      },
      planMd: `# PLAN.md\n\n## Goal\n${goalContract.goal}\n\n## Acceptance Contract\n- ${goalContract.doneWhen.join('\n- ')}\n\n## Validation\n- Run deterministic firewall checks.\n- Run tests and record green evidence.\n\n## Negative Path\n- Reject workflow-order bypass and false success.\n\n## Rollback\n- Use Forge transactions and safety checkpoints.\n\n## Steps\n- [x] Create durable harness artifacts and baseline.\n- [ ] Reconcile the workspace.\n- [ ] Implement the bounded unit.\n- [ ] Run the selected verification oracle.\n- [ ] Review the diff and record evidence.\n`,
      scratchpadMd: `# SCRATCHPAD.md\n\n- Session: ${sessionId}\n- Workspace: ${this.tools.getWorkspaceRoot()}\n`,
      evidenceLedger: [],
      knowledge: this.loadRepositoryKnowledge(),
      projectAdapter: this.oracles.getProjectAdapter(),
      skills: this.loadSkillRegistry(),
      files: {},
      firewall: { stage: 'IDLE', timestamp: new Date().toISOString(), details: 'Harness initialized. Waiting for proposals.' },
      logs: [this.log('success', 'Forge Agent harness initialized with durable artifacts.', 'Orchestrator')],
      reflections: [],
      diffReviews: [],
      reviewerCritiques: [],
      preCommitReviews: [],
      escalations: [],
      blockers: [],
      semanticRetrieval: {
        generatedAt: new Date().toISOString(), status: this.embeddingProvider ? 'failed' : 'disabled', provider: this.embeddingProvider?.id || 'deterministic-fallback', modelId: this.embeddingProvider?.modelId || '', query: '', cacheHits: 0, embeddedDocuments: 0, candidates: [], error: this.embeddingProvider ? 'Semantic retrieval has not run yet.' : undefined
      },
      workerEditTransactions: [],
      workerCommandTransactions: [],
      clarifications: [],
      oracleFailures: [],
      workflow,
      contextBundle: this.createContextBundleSkeleton(goalContract.goal),
      roleHandoffs: {},
      workerContexts: {},
      safetyCheckpoints: [],
      commandEffects: [],
      runBudget: this.createRunBudget(goalContract, mergedBudgetOverrides),
      runStats: this.createRunStats(),
      currentStepIndex: 0,
      maxSteps: Number.isFinite(overrides.maxSteps) && Number(overrides.maxSteps) > 0 ? Number(overrides.maxSteps) : 30,
      reflectionEnabled: harnessOptions.reflectionEnabled !== false,
      status: 'idle',
      activeSubAgent: 'Orchestrator',
      activeFilePath: '',
      oracleStatuses: { linter: 'unchecked', compiler: 'unchecked', tests: 'unchecked', build: 'unchecked' },
      lastOraclePass: false
    };

    this.persistStateToDisk(state);
    this.latestState = state;
    return state;
  }

  public async runStep(state: HarnessState, modelBindings: Record<string, string> = {}): Promise<HarnessState> {
    state.runStats = state.runStats || this.createRunStats();
    state.runStats.roleHandoffRefreshes = state.runStats.roleHandoffRefreshes || 0;
    state.runStats.retrievalRefreshes = state.runStats.retrievalRefreshes || 0;
    state.runStats.contextCompactions = state.runStats.contextCompactions || 0;
    state.runStats.toolResultSectionsCleared = state.runStats.toolResultSectionsCleared || 0;
    state.runStats.safetyCheckpoints = state.runStats.safetyCheckpoints || 0;
    state.runStats.safetyReverts = state.runStats.safetyReverts || 0;
    state.runStats.reviewerCritiques = state.runStats.reviewerCritiques || 0;
    state.runStats.reviewerModelCritiques = state.runStats.reviewerModelCritiques || 0;
    state.runStats.preCommitReviews = state.runStats.preCommitReviews || 0;
    state.runStats.preCommitModelReviews = state.runStats.preCommitModelReviews || 0;
    state.runStats.preCommitBlocks = state.runStats.preCommitBlocks || 0;
    state.runStats.commandEffectCaptures = state.runStats.commandEffectCaptures || 0;
    state.runStats.commandCreatedFiles = state.runStats.commandCreatedFiles || 0;
    state.runStats.commandModifiedFiles = state.runStats.commandModifiedFiles || 0;
    state.runStats.commandDeletedFiles = state.runStats.commandDeletedFiles || 0;
    state.runStats.networkIntentCaptures = state.runStats.networkIntentCaptures || 0;
    state.runStats.networkWriteBlocks = state.runStats.networkWriteBlocks || 0;
    state.runStats.roleCapabilityBlocks = state.runStats.roleCapabilityBlocks || 0;
    state.runStats.workerProcessExecutions = state.runStats.workerProcessExecutions || 0;
    state.runStats.workerProcessFailures = state.runStats.workerProcessFailures || 0;
    state.runStats.blockerEvents = state.runStats.blockerEvents || 0;
    state.runStats.openBlockers = state.runStats.openBlockers || 0;
    state.runStats.resolvedBlockers = state.runStats.resolvedBlockers || 0;
    state.runStats.semanticRefreshes = state.runStats.semanticRefreshes || 0;
    state.runStats.semanticFailures = state.runStats.semanticFailures || 0;
    state.runStats.semanticCacheHits = state.runStats.semanticCacheHits || 0;
    state.runStats.semanticEmbeddedDocuments = state.runStats.semanticEmbeddedDocuments || 0;
    state.runStats.editTransactions = state.runStats.editTransactions || 0;
    state.runStats.editTransactionConflicts = state.runStats.editTransactionConflicts || 0;
    state.runStats.worktreeEditTransactions = state.runStats.worktreeEditTransactions || 0;
    state.runStats.sparseEditTransactions = state.runStats.sparseEditTransactions || 0;
    state.runStats.commandTransactions = state.runStats.commandTransactions || 0;
    state.runStats.commandTransactionConflicts = state.runStats.commandTransactionConflicts || 0;
    state.runStats.commandTransactionMergedFiles = state.runStats.commandTransactionMergedFiles || 0;
    state.runStats.commandTransactionRollbacks = state.runStats.commandTransactionRollbacks || 0;
    state.runStats.skillRetrievals = state.runStats.skillRetrievals || 0;
    state.runStats.skillApplications = state.runStats.skillApplications || 0;
    state.runStats.workflowGateBlocks = state.runStats.workflowGateBlocks || 0;
    state.runStats.budgetHalts = state.runStats.budgetHalts || 0;
    state.runBudget = state.runBudget || this.createRunBudget(state.goalContract);
    const preStepBudget = this.enforceBudget(state);
    if (preStepBudget) {
      return preStepBudget;
    }
    const controlHalt = this.applyControl(state);
    if (controlHalt) {
      return controlHalt;
    }
    state.reflections = state.reflections || [];
    state.diffReviews = state.diffReviews || [];
    state.reviewerCritiques = state.reviewerCritiques || [];
    state.preCommitReviews = state.preCommitReviews || [];
    state.escalations = state.escalations || [];
    state.blockers = state.blockers || [];
    state.semanticRetrieval = state.semanticRetrieval || {
      generatedAt: new Date().toISOString(), status: 'disabled', provider: 'deterministic-fallback', modelId: '', query: '', cacheHits: 0, embeddedDocuments: 0, candidates: []
    };
    state.workerEditTransactions = state.workerEditTransactions || [];
    state.workerCommandTransactions = state.workerCommandTransactions || [];
    state.projectAdapter = state.projectAdapter || this.oracles.getProjectAdapter();
    state.oracleStatuses = state.oracleStatuses
      ? { ...state.oracleStatuses, build: state.oracleStatuses.build || 'unchecked' }
      : { linter: 'unchecked', compiler: 'unchecked', tests: 'unchecked', build: 'unchecked' };
    state.clarifications = state.clarifications || [];
    state.oracleFailures = state.oracleFailures || [];
    state.runStats.clarificationRequests = state.runStats.clarificationRequests || 0;
    state.runStats.clarificationAnswers = state.runStats.clarificationAnswers || 0;
    state.runStats.clarificationGateBlocks = state.runStats.clarificationGateBlocks || 0;
    state.runStats.oracleFailureCaptures = state.runStats.oracleFailureCaptures || 0;
    state.runStats.repeatedOracleFailures = state.runStats.repeatedOracleFailures || 0;
    state.runStats.oracleFailureResolutions = state.runStats.oracleFailureResolutions || 0;
    state.runStats.remediationGuidanceInjections = state.runStats.remediationGuidanceInjections || 0;
    state.runStats.oracleStagnationHalts = state.runStats.oracleStagnationHalts || 0;
    if (state.clarifications.some(item => item.status === 'pending')) {
      state.status = 'awaiting_input';
      this.persistStateToDisk(state);
      this.latestState = state;
      return state;
    }
    state.workflow = state.workflow || createWorkflowGovernance(this.tools.getWorkspaceRoot(), state.goalContract);
    state.roleHandoffs = state.roleHandoffs || {};
    state.workerContexts = state.workerContexts || {};
    state.safetyCheckpoints = state.safetyCheckpoints || [];
    state.commandEffects = state.commandEffects || [];
    const progressBefore = this.progressSignature(state);
    state.status = 'running';
    state.currentStepIndex += 1;

    if (state.currentStepIndex > state.maxSteps) {
      this.recordBlocker(state, 'step_cap', 'Step cap reached before oracle success.');
      return this.halt(state, 'gave_up', 'Step cap reached before oracle success.');
    }

    const activeTask = state.taskGraph.tasks.find(t => t.status === 'pending' || t.status === 'running');
    state.activeSubAgent = activeTask?.owner || 'Orchestrator';
    if (activeTask) {
      await this.refreshSemanticRetrieval(state, activeTask);
    }
    this.refreshContextBundle(state, activeTask);
    if (activeTask) {
      this.refreshRoleHandoff(state, activeTask);
    }

    if (!activeTask) {
      const workflowGate = workflowReadyForSuccess(state.workflow);
      if (this.hasGreenEvidence(state) && workflowGate.ready) {
        state.status = 'success';
        state.haltReason = 'All tasks complete and green oracle evidence is present.';
      } else {
        state.status = 'failed';
        state.haltReason = this.hasGreenEvidence(state) ? `Tasks completed with incomplete workflow gates: ${workflowGate.missing.join(', ')}.` : 'Tasks completed without green oracle evidence.';
      }
      this.persistStateToDisk(state);
      this.latestState = state;
      return state;
    }

    activeTask.status = 'running';
    const proposalEnvelope = await this.getProposal(state, activeTask, modelBindings);
    const postProposalBudget = this.enforceBudget(state);
    if (postProposalBudget) {
      return postProposalBudget;
    }
    const proposal = proposalEnvelope.proposal;
    const uncertaintyValidation = this.validateUncertaintyGate(state, proposalEnvelope, proposal);
    if (!uncertaintyValidation.valid) {
      state.runStats.clarificationGateBlocks += 1;
      state.runStats.validationFailures += 1;
      state.firewall = { stage: 'VALIDATE', timestamp: new Date().toISOString(), details: proposalEnvelope.explanation, proposalToolCall: proposal, isValidated: false, validationReason: uncertaintyValidation.reason };
      this.recordBlocker(state, 'clarification', String(uncertaintyValidation.reason), activeTask);
      state.logs.push(this.log('error', String(uncertaintyValidation.reason), 'Clarification Gate'));
      state.status = 'idle';
      this.persistStateToDisk(state);
      this.latestState = state;
      return state;
    }
    // Ported from the proven eval-lane gradient (Phase 46): content-addressed
    // path repair. Candidate policy is bounded and deterministic — only files
    // the agent has actually read this run; unique match or refuse.
    if (proposal.name === 'apply_patch' && !String(proposal.arguments?.path || '').trim()) {
      const candidates = Object.values(state.files).map(file => ({ path: file.path, content: file.content }));
      const resolved = resolvePatchTargetByContent(candidates, String(proposal.arguments?.patchContent || ''));
      if (resolved.path) {
        proposal.arguments = { ...proposal.arguments, path: resolved.path };
        state.runStats.pathRepairs = (state.runStats.pathRepairs || 0) + 1;
        state.logs.push(this.log('validation', `Deterministic path repair: empty path resolved to ${resolved.path} by content addressing (${candidates.length} candidates).`, 'Firewall'));
      } else {
        state.logs.push(this.log('warning', `Empty patch path could not be content-addressed: ${resolved.matchCount} candidate match(es) among files read this run. Emit the "path" argument explicitly.`, 'Firewall'));
      }
    }
    state.firewall = {
      stage: 'PROPOSE',
      timestamp: new Date().toISOString(),
      details: proposalEnvelope.explanation,
      proposalToolCall: proposal
    };
    state.logs.push(this.log('proposal', `${activeTask.owner} proposed ${proposal.name}: ${proposalEnvelope.explanation}`, activeTask.owner));

    state.firewall.stage = 'VALIDATE';
    const roleValidation = this.validateRoleCapability(state, activeTask, proposal);
    const workflowValidation = roleValidation.valid ? validateWorkflowProposal(state, proposal) : roleValidation;
    const validation = workflowValidation.valid ? await this.firewall.validateProposal(proposal) : workflowValidation;
    if (!validation.valid) {
      state.runStats.validationFailures += 1;
      this.recordBlocker(state, 'firewall', String(validation.reason || 'Proposal validation failed.'), activeTask);
      this.recordWorkerProposal(state, activeTask, proposal, false);
      if (/\[role_capability_blocked\]/.test(String(validation.reason || ''))) {
        state.runStats.roleCapabilityBlocks = (state.runStats.roleCapabilityBlocks || 0) + 1;
      }
      if (/\[network_intent_blocked\]/.test(String(validation.reason || ''))) {
        state.runStats.networkWriteBlocks = (state.runStats.networkWriteBlocks || 0) + 1;
      }
      if (/\[workflow_gate_blocked\]/.test(String(validation.reason || ''))) {
        state.runStats.workflowGateBlocks = (state.runStats.workflowGateBlocks || 0) + 1;
      }
      state.firewall.isValidated = false;
      state.firewall.validationReason = validation.reason;
      state.logs.push(this.log('error', `Firewall rejected ${proposal.name}: ${validation.reason}`, 'Firewall'));
      const isMalformedPatch = /Malformed patch/i.test(String(validation.reason || ''));
      if (isMalformedPatch) {
        state.runStats.malformedPatchStreak = (state.runStats.malformedPatchStreak || 0) + 1;
      }
      const rejectionDetail = isMalformedPatch
        ? `Firewall rejected ${proposal.name}: ${validation.reason}\nThe patchContent MUST use exactly: <<<<<<< SEARCH / (exact lines copied from the file) / ======= / (replacement lines) / >>>>>>> REPLACE`
        : `Firewall rejected ${proposal.name}: ${validation.reason}`;
      if (this.scheduleReflection(state, activeTask, 'firewall', rejectionDetail)) {
        state.status = 'idle';
        this.persistStateToDisk(state);
        this.latestState = state;
        return state;
      }
      activeTask.status = 'failed';
      state.status = 'failed';
      state.haltReason = `Firewall rejection exceeded reflection cap: ${validation.reason}`;
      this.persistStateToDisk(state);
      this.latestState = state;
      return state;
    }
    this.resolveBlockers(state, activeTask, ['workflow_gate', 'role_capability', 'workspace_scope', 'command_policy', 'network_policy', 'patch_format', 'patch_applicability', 'firewall'], 'A corrected proposal passed deterministic validation.');
    this.recordWorkerProposal(state, activeTask, proposal, true);
    state.firewall.isValidated = true;
    state.firewall.validationReason = 'Proposal accepted by deterministic validator.';
    if (proposalEnvelope.fallback) {
      state.runStats.fallbackActions += 1;
    }

    if (proposal.name === 'ask_user') {
      this.commitClarification(state, activeTask, proposal);
      state.firewall.stage = 'NARRATE';
      state.firewall.isValidated = true;
      state.firewall.validationReason = 'Clarification request accepted; run paused before any mutation.';
      this.persistStateToDisk(state);
      this.latestState = state;
      return state;
    }

    if (this.firewall.isMutating(proposal)) {
      const preCommitReview = await this.createPreCommitReview(state, activeTask, proposal, modelBindings);
      state.preCommitReviews.push(preCommitReview);
      state.runStats.preCommitReviews += 1;
      if (preCommitReview.source === 'model') {
        state.runStats.preCommitModelReviews += 1;
      }
      state.logs.push(this.log('validation', `Pre-commit review (${preCommitReview.source}) ${preCommitReview.status}: ${preCommitReview.summary}`, 'Reviewer'));
      state.scratchpadMd = `${state.scratchpadMd}\n## Pre-Commit Review - ${preCommitReview.timestamp}\nSource: ${preCommitReview.source}\nModel: ${preCommitReview.modelId}\nStatus: ${preCommitReview.status}\nProposal: ${preCommitReview.proposalName}\n\n${preCommitReview.summary}\n`;
      if (preCommitReview.status === 'blocked') {
        state.runStats.preCommitBlocks += 1;
        this.recordBlocker(state, 'precommit', preCommitReview.summary, activeTask);
        state.firewall.isValidated = false;
        state.firewall.validationReason = `Pre-commit review blocked ${proposal.name}: ${preCommitReview.summary}`;
        if (this.scheduleReflection(state, activeTask, 'firewall', state.firewall.validationReason)) {
          state.status = 'idle';
          this.persistStateToDisk(state);
          this.latestState = state;
          return state;
        }
        activeTask.status = 'failed';
        state.status = 'failed';
        state.haltReason = state.firewall.validationReason;
        this.persistStateToDisk(state);
        this.latestState = state;
        return state;
      }
      this.resolveBlockers(state, activeTask, ['precommit_review'], 'A subsequent pre-commit review approved the proposal.');
    }

    state.firewall.stage = 'COMMIT';
    if (this.firewall.isMutating(proposal)) {
      const checkpoint: SafetyCheckpoint = await this.firewall.createCheckpoint(state.currentStepIndex, proposal);
      state.checkpointId = checkpoint.id;
      state.safetyCheckpoints.push(checkpoint);
      state.runStats.safetyCheckpoints += 1;
      state.logs.push(this.log('validation', `Safety checkpoint ${checkpoint.id} created with ${checkpoint.strategy} for ${checkpoint.proposalName}.`, 'Firewall'));
    }

    const commitResult = await this.commitProposal(state, activeTask, proposal, modelBindings);
    if (['apply_patch', 'write_file', 'run_command', 'run_tests'].includes(proposal.name)) {
      await this.runOracles(state);
    }
    recordWorkflowEvent(state, proposal, commitResult.success);
    if ((proposal.name === 'apply_patch' || proposal.name === 'write_file') && commitResult.success) {
      // Any successful file mutation clears the malformed streak — matching
      // the eval lane, which clears its rejection state on any valid commit.
      state.runStats.malformedPatchStreak = 0;
    }

    state.firewall.stage = 'NARRATE';
    state.logs.push(this.log('narration', `Oracle state: lint=${state.oracleStatuses.linter}, typecheck=${state.oracleStatuses.compiler}, tests=${state.oracleStatuses.tests}`, activeTask.owner));

    if (!state.lastOraclePass && ['run_tests', 'apply_patch', 'write_file', 'run_command'].includes(proposal.name)) {
      const stagnantFailure = (state.oracleFailures || []).filter(item => item.status === 'open').sort((a, b) => b.occurrences - a.occurrences)[0];
      if (stagnantFailure && stagnantFailure.occurrences >= MAX_IDENTICAL_ORACLE_FAILURES) {
        state.runStats.oracleStagnationHalts += 1;
        state.runStats.noProgressTurns = Math.max(state.runStats.noProgressTurns, stagnantFailure.occurrences);
        const reason = `Oracle stagnation: ${stagnantFailure.kind}/${stagnantFailure.category} repeated ${stagnantFailure.occurrences} times without changing signature ${stagnantFailure.signature.slice(0, 12)}.`;
        this.recordBlocker(state, 'progress', reason, activeTask);
        state.logs.push(this.log('error', `${reason} Giving up honestly before another provider/tool attempt.`, 'Oracle Remediation'));
        return this.halt(state, 'gave_up', reason);
      }
    }

    if (!commitResult.success) {
      this.recordBlocker(state, 'tool', `${proposal.name} failed: ${commitResult.output.slice(0, 1000)}`, activeTask);
      if (this.scheduleReflection(state, activeTask, 'tool_failure', `${proposal.name} failed: ${commitResult.output.slice(0, 1000)}`)) {
        state.status = 'idle';
        this.persistStateToDisk(state);
        this.latestState = state;
        return state;
      }
      activeTask.status = 'failed';
      state.status = 'failed';
      state.haltReason = commitResult.output;
    }

    if (
      state.status !== 'failed' &&
      !state.lastOraclePass &&
      ['run_tests', 'apply_patch', 'write_file', 'run_command'].includes(proposal.name)
    ) {
      const oracleDetails = state.logs.filter(log => log.subAgent === 'Oracle').slice(-1)[0]?.message || 'Oracle failed without captured details.';
      this.recordBlocker(state, 'oracle', oracleDetails, activeTask);
      if (this.scheduleReflection(state, activeTask, 'red_oracle', oracleDetails)) {
        state.status = 'idle';
        this.persistStateToDisk(state);
        this.latestState = state;
        return state;
      }
      activeTask.status = 'failed';
      state.status = 'failed';
      state.haltReason = `Red oracle exceeded reflection cap: ${oracleDetails}`;
    }

    if (proposal.name === 'declare_success') {
      if (this.hasGreenEvidence(state) && this.hasRequiredDiffReview(state)) {
        activeTask.status = 'completed';
        state.status = 'success';
        state.haltReason = 'Declared success after green oracle evidence.';
      } else {
        activeTask.status = 'failed';
        state.status = 'failed';
        state.haltReason = this.hasGreenEvidence(state)
          ? 'Success declaration rejected because diff review evidence is missing.'
          : 'Success declaration rejected because green oracle evidence is missing.';
        if (state.checkpointId) {
          if (await this.firewall.revertToCheckpoint(state.checkpointId)) {
            state.runStats.safetyReverts += 1;
          }
        }
      }
    } else if (proposal.name === 'run_tests' && state.lastOraclePass && activeTask.owner === 'Reviewer') {
      activeTask.status = 'completed';
      const evidenceTask = state.taskGraph.tasks.find(t => t.id === '5');
      if (evidenceTask && evidenceTask.status === 'pending') {
        evidenceTask.status = 'running';
      }
    } else if (proposal.name === 'record_evidence' && activeTask.owner === 'Reviewer') {
      activeTask.status = 'completed';
    } else if (commitResult.success && this.proposalCompletesTask(activeTask, proposal, state) && !state.haltReason) {
      activeTask.status = 'completed';
    }

    if (state.status !== 'success' && state.taskGraph.tasks.every(t => t.status === 'completed')) {
      const workflowGate = workflowReadyForSuccess(state.workflow);
      state.status = this.hasGreenEvidence(state) && this.hasRequiredDiffReview(state) && workflowGate.ready ? 'success' : 'failed';
      state.haltReason = state.status === 'success'
        ? 'All tasks complete with green evidence and required diff review.'
        : `All tasks complete but required proof is missing${workflowGate.ready ? '.' : `; workflow=${workflowGate.missing.join(', ')}.`}`;
    } else if (state.status !== 'success' && state.status !== 'failed') {
      state.status = 'idle';
    }

    if (state.status !== 'success' && state.status !== 'failed') {
      this.updateProgressTracking(state, progressBefore);
      if (state.runStats.noProgressTurns >= MAX_NO_PROGRESS_TURNS) {
        this.recordBlocker(state, 'progress', `No progress detected for ${state.runStats.noProgressTurns} consecutive harness steps.`, activeTask);
        return this.halt(state, 'gave_up', `No progress detected for ${state.runStats.noProgressTurns} consecutive harness steps.`);
      }
    } else {
      state.runStats.lastProgressSignature = this.progressSignature(state);
    }

    state.firewall.stage = 'IDLE';
    this.persistStateToDisk(state);
    this.latestState = state;
    return state;
  }

  private async commitProposal(state: HarnessState, activeTask: TaskItem, proposal: ToolProposal, modelBindings: Record<string, string> = {}): Promise<{ success: boolean; output: string }> {
    if (proposal.name === 'update_plan') {
      state.planMd = enforceWorkflowPlan(String(proposal.arguments.planMd || proposal.arguments.patchContent || state.planMd), state.workflow);
      if (activeTask.owner === 'Architect') {
        state.architectHandoff = this.createArchitectHandoff(state, activeTask);
      }
      state.logs.push(this.log('commit', 'PLAN.md updated.', 'Harness'));
      return { success: true, output: 'PLAN.md updated.' };
    }

    if (proposal.name === 'update_tasks') {
      if (Array.isArray(proposal.arguments.tasks)) {
        state.taskGraph.tasks = proposal.arguments.tasks;
      }
      state.logs.push(this.log('commit', 'Task graph updated.', 'Harness'));
      return { success: true, output: 'Task graph updated.' };
    }

    if (proposal.name === 'record_evidence') {
      const evidence = this.makeEvidence(activeTask.title, String(proposal.arguments.observation || 'Recorded evidence.'), state);
      state.evidenceLedger.push(evidence);
      state.logs.push(this.log('commit', `Evidence recorded: ${evidence.observation}`, 'Harness'));
      return { success: true, output: `Evidence recorded: ${evidence.observation}` };
    }

    const commandSnapshotBefore = proposal.name === 'run_command' ? snapshotWorkspaceFiles(this.tools.getWorkspaceRoot()) : undefined;
    const result = proposal.name === 'apply_patch' || proposal.name === 'write_file'
      ? await this.transactionalEditExecutor.dispatch(this.tools.getWorkspaceRoot(), activeTask.owner || 'Orchestrator', proposal)
      : proposal.name === 'run_command'
        ? await this.transactionalCommandExecutor.dispatch(this.tools.getWorkspaceRoot(), activeTask.owner || 'Orchestrator', proposal)
        : await this.workerExecutor.dispatch(this.tools.getWorkspaceRoot(), activeTask.owner || 'Orchestrator', proposal);
    if ('transaction' in result) {
      this.recordEditTransaction(state, result.transaction as WorkerEditTransaction);
    }
    if ('commandTransaction' in result) {
      this.recordCommandTransaction(state, result.commandTransaction as WorkerCommandTransaction);
    }
    this.recordWorkerExecution(state, activeTask, result.worker, result.success);
    if (result.commandMetadata) {
      result.commandMetadata.blockedEnvKeys = Array.from(new Set([
        ...result.commandMetadata.blockedEnvKeys,
        ...result.worker.blockedEnvKeys
      ])).sort((a, b) => a.localeCompare(b));
      result.commandMetadata.inheritedEnvKeyCount = Math.max(
        result.commandMetadata.inheritedEnvKeyCount,
        result.worker.inheritedEnvKeyCount
      );
    }
    state.logs.push(this.log(result.success ? 'commit' : 'error', `${proposal.name}: ${result.output.slice(0, 500)}`, 'Harness'));
    if (result.success) {
      this.resolveBlockers(state, activeTask, ['worker_process', 'tool_failure'], 'A corrected tool action completed successfully.');
    }
    this.captureToolResult(state, proposal, result);
    if (proposal.name === 'run_command' && commandSnapshotBefore) {
      this.recordCommandSideEffects(state, proposal, commandSnapshotBefore, result.output, result.commandMetadata, 'commandTransaction' in result ? result.commandTransaction as WorkerCommandTransaction : undefined);
    }
    if (result.success && proposal.name === 'get_diff') {
      await this.recordDiffReview(state, result.output, activeTask.owner || 'Reviewer', modelBindings);
    }
    return { success: result.success, output: result.output };
  }

  private async runOracles(state: HarnessState): Promise<void> {
    const composite = await this.oracles.runAll();
    const { lint, typecheck, test: tests, build } = composite.results;
    state.projectAdapter = this.oracles.getProjectAdapter();
    const status = (item: OracleResult): 'pass' | 'fail' | 'skipped' => item.skipped ? 'skipped' : item.pass ? 'pass' : 'fail';
    state.oracleStatuses = {
      linter: status(lint),
      compiler: status(typecheck),
      tests: tests.pass && !tests.skipped ? 'pass' : 'fail',
      build: status(build)
    };
    state.lastOraclePass = composite.pass;
    const activeTask = state.taskGraph.tasks.find(task => task.status === 'running');
    const failureUpdate = updateOracleFailures(state.oracleFailures || [], composite, activeTask, activeTask?.owner || 'Oracle');
    state.oracleFailures = failureUpdate.entries;
    state.runStats.oracleFailureCaptures += failureUpdate.captured;
    state.runStats.repeatedOracleFailures += failureUpdate.repeated;
    state.runStats.oracleFailureResolutions += failureUpdate.resolved;
    if (failureUpdate.captured || failureUpdate.repeated || failureUpdate.resolved) {
      state.logs.push(this.log(composite.pass ? 'success' : 'warning', `Oracle remediation lifecycle: captured=${failureUpdate.captured}, repeated=${failureUpdate.repeated}, resolved=${failureUpdate.resolved}.`, 'Oracle Remediation'));
    }
    state.logs.push(this.log(composite.pass ? 'oracle' : 'error', `composite oracle pass=${composite.pass}: ${composite.summary}\n${Object.values(composite.results).filter(item => !item.pass).map(item => `${item.kind}: ${item.output.slice(0, 350)}`).join('\n')}`, 'Oracle'));

    if (composite.pass) {
      this.resolveBlockers(state, activeTask, ['oracle'], 'Every required adapter oracle passed.');
      state.evidenceLedger.push(this.makeEvidence('Composite verification oracle', composite.summary, state, {
        ...tests,
        output: `${composite.summary}\n${Object.values(composite.results).map(item => `${item.kind} [${item.command || 'skipped'}]: ${item.output}`).join('\n')}`
      }));
    }
  }

  private async getProposal(state: HarnessState, activeTask: TaskItem, modelBindings: Record<string, string>): Promise<ProposalEnvelope & { fallback: boolean }> {
    state.runStats = state.runStats || this.createRunStats();
    const reviewerGate = this.reviewerGateProposal(state, activeTask);
    if (reviewerGate) {
      return { ...reviewerGate, fallback: false };
    }
    const fallback = this.fallbackProposal(state, activeTask);
    const modelId = this.selectModelForTask(state, activeTask, modelBindings);
    let repairHint = '';

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        state.runStats.repairAttempts += 1;
      }
      this.proofStats.providerCalls += 1;
      state.runStats.providerCalls += 1;
      try {
        const worker = this.ensureWorkerContext(state, activeTask.owner, activeTask);
        worker.providerCalls += 1;
        const response = await this.provider.generateChat({
          modelId,
          sessionId: worker.sessionId,
          fallbackModels: [OpenRouterProvider.mixedModel(), 'meta-llama/llama-3.3-70b-instruct'],
          responseFormatSchema: TOOL_SCHEMA,
          messages: [
            { role: 'system', content: this.systemPrompt(state, activeTask) },
            { role: 'user', content: this.proposalRequest(repairHint) }
          ]
        });
        state.goalContract.spent += response.usage?.totalCost || 0;
        const parsed = this.parseProposalEnvelope(response.text);
        const schema = this.firewall.validateSchema(parsed.proposal);
        if (!schema.valid) {
          state.runStats.schemaFailures += 1;
          repairHint = `Previous response was rejected by schema validation: ${schema.reason}`;
          this.recordBlocker(state, 'schema', repairHint, activeTask);
          state.logs.push(this.log('warning', repairHint, 'Harness'));
          continue;
        }

        this.resolveBlockers(state, activeTask, ['provider', 'schema'], 'A subsequent provider response parsed and matched the required schema.');

        state.runStats.modelDrivenProposals += 1;
        state.runStats.actuallyModelDriven = true;
        return { ...parsed, fallback: false };
      } catch (e: any) {
        state.runStats.providerFailures += 1;
        this.proofStats.providerFailures += 1;
        repairHint = `Previous response could not be parsed or generated: ${e.message}`;
        this.recordBlocker(state, 'provider', repairHint, activeTask);
        state.logs.push(this.log('warning', repairHint, 'Harness'));
      }
    }

    this.proofStats.fallbackProposals += 1;
    state.runStats.fallbackProposals += 1;
    state.logs.push(this.log('warning', 'Using deterministic fallback proposal after provider/schema repair attempts failed.', 'Harness'));
    return { ...fallback, fallback: true };
  }

  private parseProposalEnvelope(text: string): ProposalEnvelope {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Response envelope must be a JSON object.');
    }
    if (!parsed.proposal || typeof parsed.proposal !== 'object') {
      throw new Error('Response envelope is missing proposal object.');
    }
    return {
      explanation: String(parsed.explanation || 'Model proposed next action.'),
      proposal: parsed.proposal,
      confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : undefined,
      materialUncertainty: parsed.materialUncertainty === true,
      uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String).filter(Boolean) : []
    };
  }

  private validateUncertaintyGate(state: HarnessState, envelope: ProposalEnvelope, proposal: ToolProposal): { valid: boolean; reason?: string } {
    if (proposal.name === 'ask_user') return { valid: true };
    const material = envelope.materialUncertainty === true || (envelope.uncertainties || []).length > 0 || (envelope.confidence !== undefined && envelope.confidence < 70);
    if (!material) return { valid: true };
    const detail = (envelope.uncertainties || []).join('; ') || envelope.explanation || 'Model confidence is below 70.';
    return { valid: false, reason: `[clarification_required] Material uncertainty must be resolved with ask_user before ${proposal.name}: ${detail}` };
  }

  private commitClarification(state: HarnessState, activeTask: TaskItem, proposal: ToolProposal): void {
    const question = String(proposal.arguments.question || '').trim();
    const normalized = question.toLowerCase().replace(/\s+/g, ' ');
    const prior = state.clarifications.find(item => item.question.toLowerCase().replace(/\s+/g, ' ') === normalized);
    if (prior || state.clarifications.length >= 3) {
      state.runStats.clarificationGateBlocks += 1;
      state.status = 'failed';
      state.haltReason = prior ? 'Duplicate clarification request rejected.' : 'Clarification request cap (3) exceeded.';
      state.logs.push(this.log('error', state.haltReason, 'Clarification Gate'));
      return;
    }
    const request: ClarificationRequest = {
      id: `clarification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question,
      uncertainty: String(proposal.arguments.uncertainty || '').trim(),
      options: Array.isArray(proposal.arguments.options) ? proposal.arguments.options.map(String).filter(Boolean).slice(0, 5) : [],
      recommendedAnswer: String(proposal.arguments.recommendedAnswer || '').trim() || undefined,
      status: 'pending', role: activeTask.owner, taskId: activeTask.id, askedAt: new Date().toISOString()
    };
    state.clarifications.push(request);
    state.runStats.clarificationRequests += 1;
    state.status = 'awaiting_input';
    state.haltReason = `Awaiting user clarification: ${question}`;
    state.logs.push(this.log('info', question, 'Forge Agent'));
    state.scratchpadMd += `\n## Clarification requested - ${request.askedAt}\n- Uncertainty: ${request.uncertainty}\n- Question: ${request.question}\n`;
  }

  public answerClarification(answer: string, clarificationId?: string): HarnessState {
    let state = this.latestState;
    if (!state) {
      const statePath = path.join(this.tools.getWorkspaceRoot(), '.forge', 'state.json');
      if (!fs.existsSync(statePath)) throw new Error('No persisted Forge run is available.');
      state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as HarnessState;
    }
    state.clarifications = state.clarifications || [];
    const pending = state.clarifications.find(item => item.status === 'pending' && (!clarificationId || item.id === clarificationId));
    if (!pending) throw new Error('No pending clarification request was found.');
    const value = String(answer || '').trim();
    if (!value) throw new Error('Clarification answer cannot be empty.');
    pending.status = 'answered'; pending.answer = value; pending.answeredAt = new Date().toISOString();
    state.runStats = state.runStats || this.createRunStats();
    state.runStats.clarificationAnswers = (state.runStats.clarificationAnswers || 0) + 1;
    state.status = 'idle'; state.haltReason = undefined;
    state.logs.push(this.log('info', `Clarification answered: ${value}`, 'User'));
    state.scratchpadMd += `- Answer (${pending.answeredAt}): ${value}\n`;
    this.resolveBlockers(state, state.taskGraph.tasks.find(item => item.id === pending.taskId), ['clarification'], 'User supplied the requested clarification.');
    this.persistStateToDisk(state); this.latestState = state;
    return state;
  }

  private proposalRequest(repairHint: string): string {
    if (!repairHint) {
      return 'Propose exactly one next tool call.';
    }
    return [
      'Repair your previous response and propose exactly one next tool call.',
      repairHint,
      'Return only a JSON object matching the required schema.'
    ].join('\n');
  }

  private fallbackProposal(state: HarnessState, activeTask?: TaskItem): { explanation: string; proposal: ToolProposal } {
    if (activeTask?.owner === 'Explorer') {
      return { explanation: 'Provider unavailable; inspect workspace with a broad repository search.', proposal: { name: 'repo_search', arguments: { query: state.goalContract.goal.split(/\s+/).find(part => part.length > 3) || 'TODO' } } };
    }
    if (activeTask?.owner === 'Architect') {
      return {
        explanation: 'Provider unavailable; create a minimal plan from the current goal and scratchpad.',
        proposal: {
          name: 'update_plan',
          arguments: {
            planMd: `# PLAN.md\n\n## Goal\n${state.goalContract.goal}\n\n## Harness Plan\n- Inspect relevant files.\n- Apply the smallest safe patch through the firewall.\n- Run tests.\n- Record evidence only if tests pass.\n`
          }
        }
      };
    }
    if (activeTask?.owner === 'Editor') {
      return {
        explanation: state.lastOraclePass
          ? 'Provider unavailable; rerun the green oracle to prove this Editor phase requires no mutation.'
          : 'Provider unavailable; no safe edit can be inferred, so run verification before mutating.',
        proposal: { name: 'run_tests', arguments: {} }
      };
    }
    if (!state.lastOraclePass) {
      return { explanation: 'Run the verification oracle before any success declaration.', proposal: { name: 'run_tests', arguments: {} } };
    }
    if (!this.hasRequiredDiffReview(state)) {
      return { explanation: 'Reviewer must inspect the current native diff before evidence or success.', proposal: { name: 'get_diff', arguments: {} } };
    }
    if (!this.hasGreenEvidence(state)) {
      return { explanation: 'Record the green oracle result in the evidence ledger.', proposal: { name: 'record_evidence', arguments: { observation: 'Green oracle observed in this run.' } } };
    }
    return { explanation: 'Declare success after green evidence exists.', proposal: { name: 'declare_success', arguments: {} } };
  }

  private reviewerGateProposal(state: HarnessState, activeTask: TaskItem): { explanation: string; proposal: ToolProposal } | null {
    const reviewerTask = activeTask.owner === 'Reviewer' || activeTask.title.toLowerCase().includes('verification');
    if (!reviewerTask || !state.lastOraclePass) {
      return null;
    }
    if (!this.hasRequiredDiffReview(state)) {
      return {
        explanation: 'Deterministic reviewer gate: green tests require diff inspection before evidence or success.',
        proposal: { name: 'get_diff', arguments: {} }
      };
    }
    if (!this.hasGreenEvidence(state)) {
      return {
        explanation: 'Deterministic reviewer gate: record green oracle evidence before success.',
        proposal: { name: 'record_evidence', arguments: { observation: 'Green oracle observed after required diff review.' } }
      };
    }
    return {
      explanation: 'Deterministic reviewer gate: declare success after green evidence and required diff review.',
      proposal: { name: 'declare_success', arguments: {} }
    };
  }

  private systemPrompt(state: HarnessState, activeTask: TaskItem): string {
    const recentLogs = state.logs.slice(-8).map(log => `${log.type}: ${log.message}`).join('\n');
    const context = this.refreshContextBundle(state, activeTask);
    const recentReflections = context.recentReflections.map(item => `- ${item}`).join('\n') || '- none';
    // Ported from the eval-lane gradient (Phase 41): after repeated malformed
    // patches, stop asking for a format this model cannot hold.
    let wholeFileGuidance = '';
    if ((state.runStats?.malformedPatchStreak || 0) >= 2) {
      wholeFileGuidance = '\nIMPORTANT: Your recent patches were repeatedly REJECTED as malformed. STOP emitting apply_patch. Use write_file with the COMPLETE corrected content of the file you need to change.\n';
      state.runStats.wholeFileGuidanceInjections = (state.runStats.wholeFileGuidanceInjections || 0) + 1;
    }
    const recentEscalations = context.recentEscalations.map(item => `- ${item}`).join('\n') || '- none';
    const openBlockers = context.recentBlockers.map(item => `- ${item}`).join('\n') || '- none';
    const fileMemory = context.recentFiles.map(file => `- ${file}`).join('\n') || '- none yet';
    const retrievalCandidates = context.retrievalCandidates.map(candidate => `- ${candidate.path} score=${candidate.score} ${candidate.reason}`).join('\n') || '- none yet';
    const openTasks = context.openTasks.map(task => `- ${task}`).join('\n') || '- none';
    const handoff = this.refreshRoleHandoff(state, activeTask);
    const handoffResponsibilities = handoff.responsibilities.map(item => `- ${item}`).join('\n') || '- none';
    const handoffTasks = handoff.openTasks.map(item => `- ${item}`).join('\n') || '- none';
    const handoffContext = handoff.recentContext.map(item => `- ${item}`).join('\n') || '- none';
    const toolGuidance = this.toolGuidanceForTask(activeTask);
    const architectExecutionSections = this.architectExecutionSections(state, activeTask);
    const workflowSummary = `Lane: ${state.workflow.lane}\nCurrent stage: ${state.workflow.currentStage}\nStages: ${state.workflow.stages.map(stage => `${stage.id}=${stage.status}`).join(', ')}\nAcceptance: ${state.workflow.acceptance.acceptanceCriteria.join('; ')}\nRequired validation: ${state.workflow.acceptance.requiredValidation.join('; ')}`;
    const adapterSummary = `${state.projectAdapter.ecosystem}/${state.projectAdapter.packageManager || 'none'} manifest=${state.projectAdapter.manifest || 'none'}\n${Object.values(state.projectAdapter.commands).map(item => `- ${item.kind}: ${item.command || 'not detected'} required=${item.required} source=${item.source}`).join('\n')}`;
    const oracleRemediation = renderOpenOracleFailures(state.oracleFailures || []);
    if (oracleRemediation !== '- none') state.runStats.remediationGuidanceInjections += 1;
    const clarificationHistory = (state.clarifications || []).map(item => `- Q: ${item.question}\n  A: ${item.answer || '(pending)'}`).join('\n') || '- none';
    const skillSelection = selectProceduralSkills(
      state.skills || [],
      `${state.goalContract.goal} ${activeTask.title}`,
      (state.blockers || []).filter(blocker => blocker.status === 'open').map(blocker => blocker.category),
      state.sessionId,
      3
    );
    state.skills = skillSelection.skills;
    if (state.skills.length) state.runStats.skillRetrievals += 1;
    state.runStats.skillApplications = state.skills.filter(skill => (skill.appliedSessionIds || []).includes(state.sessionId)).length;
    const proceduralSkillText = renderProceduralSkills(skillSelection.selected);
    const sections: PromptSection[] = [
      {
        id: 'identity-contract',
        required: true,
        priority: 100,
        content: 'You are a Forge Agent worker. The harness owns correctness.\nAllowed behavior: propose one structured tool call only. The deterministic firewall validates, then commits. Success requires run_tests pass and evidence ledger proof.'
      },
      { id: 'goal-contract', required: true, priority: 100, content: `Goal: ${state.goalContract.goal}` },
      { id: 'workflow-governance', required: true, priority: 100, content: `Universal workflow governance:\n${workflowSummary}` },
      { id: 'project-adapter', required: true, priority: 100, content: `Deterministically selected project adapter (models cannot change these commands):\n${adapterSummary}` },
      { id: 'oracle-remediation', required: true, priority: 100, content: `Open deterministic oracle remediation capsules (fix these causes; never weaken verification):\n${oracleRemediation}` },
      { id: 'clarification-history', required: true, priority: 100, content: `User-owned clarification history (answers are authoritative):\n${clarificationHistory}` },
      { id: 'active-task', required: true, priority: 100, content: `Active task: ${activeTask.title}` },
      ...architectExecutionSections,
      {
        id: 'role-handoff',
        required: true,
        priority: 100,
        content: `Role handoff:\nRole: ${handoff.role}\nAllowed tools: ${handoff.allowedTools.join(', ')}\nResponsibilities:\n${handoffResponsibilities}\nRole open tasks:\n${handoffTasks}\nRole recent context:\n${handoffContext}\nHandoff summary: ${handoff.handoffSummary}`
      },
      {
        id: 'tool-contract',
        required: true,
        priority: 100,
        content: `Tool contract:\n- repo_search: {"query":"text"}\n- symbol_search: {"query":"symbol"}\n- read_file: {"path":"workspace-relative/path"}\n- read_range: {"path":"workspace-relative/path","startLine":1,"endLine":80}\n- apply_patch: {"path":"workspace-relative/path","patchContent":"<<<<<<< SEARCH\\nold\\n=======\\nnew\\n>>>>>>> REPLACE"}\n- run_command: {"command":"safe non-destructive command"}\n- run_tests: {}\n- get_diff: {}\n- update_plan: {"planMd":"# PLAN.md..."}\n- update_tasks: {"tasks":[...]}\n- record_evidence: {"observation":"what passed"}\n- ask_user: {"question":"one focused question","uncertainty":"why the answer changes the work","options":["choice"],"recommendedAnswer":"best default"}\n- declare_success: {}\n\nUNCERTAINTY GATE: Report confidence (0-100), materialUncertainty, and uncertainties in every response. If material uncertainty about user intent, scope, authorization, behavior, cost, or acceptance could change the implementation, call ask_user before mutation. Do not ask for facts discoverable from the workspace: use read/search tools first. Non-material uncertainty should be handled conservatively without asking.`
      },
      { id: 'task-guidance', required: true, priority: 100, content: `Task guidance: ${toolGuidance}` },
      { id: 'known-files', priority: 90, content: `Known files:\n${fileMemory}` },
      { id: 'retrieval-candidates', priority: 85, content: `Retrieval candidates:\n${retrievalCandidates}` },
      ...(proceduralSkillText ? [{ id: 'procedural-skills', priority: 88, content: `Verified procedural skills from prior successful recoveries:\n${proceduralSkillText}` }] : []),
      { id: 'open-task-state', required: true, priority: 100, content: `Open task state:\n${openTasks}` },
      { id: 'open-blockers', required: true, priority: 100, content: `Deterministically classified open blockers:\n${openBlockers}` },
      { id: 'reflection-failures', priority: 75, toolResult: true, content: `Recent reflection failures to address:\n${recentReflections}` },
      ...(wholeFileGuidance ? [{ id: 'recovery-guidance', required: true, priority: 100, content: wholeFileGuidance.trim() }] : []),
      { id: 'scratchpad-summary', priority: 60, toolResult: true, content: `Scratchpad summary:\n${context.scratchpadSummary}` },
      { id: 'escalation-routing', priority: 55, toolResult: true, content: `Recent escalation routing:\n${recentEscalations}` },
      { id: 'recent-harness-log', priority: 40, toolResult: true, content: `Recent harness log:\n${recentLogs || 'none'}` }
    ];
    const scheduled = assemblePromptWithinBudget(sections, DEFAULT_PROMPT_CHAR_BUDGET);
    context.promptCharBudget = scheduled.budgetChars;
    context.promptChars = scheduled.promptChars;
    context.promptTokenEstimate = scheduled.estimatedTokens;
    context.includedSections = scheduled.includedSections;
    context.clearedSections = scheduled.clearedSections;
    context.truncatedSections = scheduled.truncatedSections;
    context.droppedChars = scheduled.droppedChars;
    context.compacted = scheduled.compacted;
    context.compactionReason = scheduled.compacted
      ? `Prompt budget ${scheduled.budgetChars} chars cleared ${scheduled.clearedSections.length} section(s), truncated ${scheduled.truncatedSections.length}, dropped ${scheduled.droppedChars} chars.`
      : undefined;
    if (scheduled.compacted) {
      state.runStats.contextCompactions += 1;
    }
    const clearedToolResults = sections.filter(section => section.toolResult && scheduled.clearedSections.includes(section.id)).length;
    state.runStats.toolResultSectionsCleared += clearedToolResults;
    return scheduled.text;
  }

  private toolGuidanceForTask(activeTask: TaskItem): string {
    if (activeTask.owner === 'Explorer') {
      return 'Search and read files before editing. Prefer repo_search, symbol_search, read_file, or read_range.';
    }
    if (activeTask.owner === 'Architect') {
      return 'Inspect as needed, then finish with update_plan. The plan must contain ## Premise Checks, ## Focus Files with exact workspace-relative paths, and ## Ordered Steps. A read/search does not complete this task.';
    }
    if (activeTask.owner === 'Editor') {
      return 'Execute the committed architect plan. Inspect further if needed, then apply the smallest correct code change with apply_patch or write_file. A read/search does not complete this task. Do not declare success.';
    }
    if (activeTask.title.includes('verification')) {
      return 'Run run_tests or a safe command needed for verification.';
    }
    return 'Record green evidence only after tests pass, then declare_success.';
  }

  private proposalMadeProgress(proposal: ToolProposal): boolean {
    return ['repo_search', 'symbol_search', 'read_file', 'read_range', 'get_diff', 'update_plan', 'update_tasks', 'apply_patch', 'write_file', 'run_command'].includes(proposal.name);
  }

  private proposalCompletesTask(activeTask: TaskItem, proposal: ToolProposal, state: HarnessState): boolean {
    if (activeTask.owner === 'Explorer') {
      return ['repo_search', 'symbol_search', 'read_file', 'read_range'].includes(proposal.name);
    }
    if (activeTask.owner === 'Architect') {
      return proposal.name === 'update_plan';
    }
    if (activeTask.owner === 'Editor') {
      return proposal.name === 'apply_patch'
        || proposal.name === 'write_file'
        || (proposal.name === 'run_tests' && state.lastOraclePass === true);
    }
    if (activeTask.owner === 'Reviewer' && proposal.name === 'get_diff') {
      return state.lastOraclePass === true;
    }
    return this.proposalMadeProgress(proposal);
  }

  private createRunStats() {
    return {
      providerCalls: 0,
      providerFailures: 0,
      fallbackProposals: 0,
      modelDrivenProposals: 0,
      fallbackActions: 0,
      repairAttempts: 0,
      schemaFailures: 0,
      validationFailures: 0,
      reflectionAttempts: 0,
      firewallReflections: 0,
      toolFailureReflections: 0,
      oracleReflections: 0,
      diffReviewAttempts: 0,
      reviewerApprovals: 0,
      reviewerCritiques: 0,
      reviewerModelCritiques: 0,
      preCommitReviews: 0,
      preCommitModelReviews: 0,
      preCommitBlocks: 0,
      escalationCount: 0,
      contextRefreshes: 0,
      roleHandoffRefreshes: 0,
      retrievalRefreshes: 0,
      contextCompactions: 0,
      toolResultSectionsCleared: 0,
      safetyCheckpoints: 0,
      safetyReverts: 0,
      commandEffectCaptures: 0,
      commandCreatedFiles: 0,
      commandModifiedFiles: 0,
      commandDeletedFiles: 0,
      networkIntentCaptures: 0,
      networkWriteBlocks: 0,
      roleCapabilityBlocks: 0,
      workerProcessExecutions: 0,
      workerProcessFailures: 0,
      blockerEvents: 0,
      openBlockers: 0,
      resolvedBlockers: 0,
      semanticRefreshes: 0,
      semanticFailures: 0,
      semanticCacheHits: 0,
      semanticEmbeddedDocuments: 0,
      editTransactions: 0,
      editTransactionConflicts: 0,
      worktreeEditTransactions: 0,
      sparseEditTransactions: 0,
      commandTransactions: 0,
      commandTransactionConflicts: 0,
      commandTransactionMergedFiles: 0,
      commandTransactionRollbacks: 0,
      skillRetrievals: 0,
      skillApplications: 0,
      workflowGateBlocks: 0,
      clarificationRequests: 0,
      clarificationAnswers: 0,
      clarificationGateBlocks: 0,
      oracleFailureCaptures: 0,
      repeatedOracleFailures: 0,
      oracleFailureResolutions: 0,
      remediationGuidanceInjections: 0,
      oracleStagnationHalts: 0,
      budgetHalts: 0,
      noProgressTurns: 0,
      lastProgressSignature: '',
      actuallyModelDriven: false
    };
  }

  private createRunBudget(goalContract: GoalContract, overrides: Partial<RunBudget> = {}): RunBudget {
    const now = new Date().toISOString();
    return {
      startedAt: overrides.startedAt || now,
      maxWallClockMs: Number.isFinite(overrides.maxWallClockMs) ? Number(overrides.maxWallClockMs) : DEFAULT_MAX_WALL_CLOCK_MS,
      maxCostUsd: Number.isFinite(overrides.maxCostUsd) ? Number(overrides.maxCostUsd) : goalContract.budget,
      lastCheckedAt: now,
      haltReason: overrides.haltReason
    };
  }

  private enforceBudget(state: HarnessState): HarnessState | undefined {
    state.runBudget = state.runBudget || this.createRunBudget(state.goalContract);
    state.runBudget.lastCheckedAt = new Date().toISOString();
    const elapsedMs = Date.now() - Date.parse(state.runBudget.startedAt);
    if (Number.isFinite(state.runBudget.maxWallClockMs) && elapsedMs >= state.runBudget.maxWallClockMs) {
      state.runBudget.haltReason = 'wall_clock_exceeded';
      state.runStats.budgetHalts += 1;
      this.recordBlocker(state, 'budget', `Wall-clock cap ${state.runBudget.maxWallClockMs}ms exceeded before green oracle evidence.`);
      return this.halt(state, 'gave_up', `Run budget exceeded: wall-clock cap ${state.runBudget.maxWallClockMs}ms elapsed before green oracle evidence.`);
    }
    const spent = state.goalContract.spent || 0;
    if (Number.isFinite(state.runBudget.maxCostUsd) && spent >= state.runBudget.maxCostUsd) {
      state.runBudget.haltReason = 'cost_exceeded';
      state.runStats.budgetHalts += 1;
      this.recordBlocker(state, 'budget', `Cost cap $${state.runBudget.maxCostUsd.toFixed(6)} reached before green oracle evidence.`);
      return this.halt(state, 'gave_up', `Run budget exceeded: cost $${spent.toFixed(6)} reached cap $${state.runBudget.maxCostUsd.toFixed(6)} before green oracle evidence.`);
    }
    return undefined;
  }

  private progressSignature(state: HarnessState): string {
    return JSON.stringify({
      tasks: state.taskGraph.tasks.map(task => `${task.id}:${task.status}`).join('|'),
      evidence: state.evidenceLedger.length,
      diffReviews: (state.diffReviews || []).length,
      reviewerCritiques: (state.reviewerCritiques || []).length,
      preCommitReviews: (state.preCommitReviews || []).length,
      escalations: (state.escalations || []).length,
      blockers: (state.blockers || []).map(blocker => `${blocker.category}:${blocker.status}:${blocker.occurrences}`).join('|'),
      contextBundle: state.contextBundle?.generatedAt || '',
      retrievalCandidates: (state.contextBundle?.retrievalCandidates || []).map(candidate => `${candidate.path}:${candidate.score}`).join('|'),
      roleHandoffs: Object.keys(state.roleHandoffs || {}).sort().map(role => `${role}:${state.roleHandoffs[role].generatedAt}`).join('|'),
      safetyCheckpoints: (state.safetyCheckpoints || []).length,
      commandEffects: (state.commandEffects || []).length,
      files: Object.keys(state.files).sort(),
      oracle: state.oracleStatuses,
      oracleFailures: (state.oracleFailures || []).map(item => `${item.signature}:${item.status}:${item.occurrences}`).join('|'),
      lastOraclePass: state.lastOraclePass,
      status: state.status,
      haltReason: state.haltReason || ''
    });
  }

  private updateProgressTracking(state: HarnessState, previousSignature: string): void {
    const nextSignature = this.progressSignature(state);
    const noProgress = previousSignature === nextSignature || state.runStats.lastProgressSignature === nextSignature;
    state.runStats.noProgressTurns = noProgress ? state.runStats.noProgressTurns + 1 : 0;
    state.runStats.lastProgressSignature = nextSignature;
  }

  private scheduleReflection(state: HarnessState, activeTask: TaskItem, trigger: ReflectionEntry['trigger'], details: string): boolean {
    if (state.reflectionEnabled === false) {
      state.runStats.reflectionSuppressed = (state.runStats.reflectionSuppressed || 0) + 1;
      state.logs.push(this.log('warning', `Reflection disabled for this run (A/B lane); ${trigger} failure will halt instead of reflecting.`, 'Harness'));
      return false;
    }
    state.reflections = state.reflections || [];
    state.runStats = state.runStats || this.createRunStats();
    if (state.runStats.reflectionAttempts >= MAX_REFLECTION_ATTEMPTS) {
      return false;
    }

    state.runStats.reflectionAttempts += 1;
    if (trigger === 'firewall') {
      state.runStats.firewallReflections += 1;
    } else if (trigger === 'tool_failure') {
      state.runStats.toolFailureReflections += 1;
    } else {
      state.runStats.oracleReflections += 1;
    }

    const reflection: ReflectionEntry = {
      id: `reflection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trigger,
      taskId: activeTask.id,
      taskTitle: activeTask.title,
      details,
      timestamp: new Date().toISOString()
    };
    state.reflections.push(reflection);
    this.maybeScheduleEscalation(state, activeTask, `${trigger}: ${details.slice(0, 300)}`);
    activeTask.status = 'running';
    state.haltReason = undefined;
    state.logs.push(this.log('warning', `Reflection ${state.runStats.reflectionAttempts}/${MAX_REFLECTION_ATTEMPTS} queued for ${trigger}: ${details.slice(0, 500)}`, 'Harness'));
    state.scratchpadMd = `${state.scratchpadMd}\n## Reflection - ${reflection.timestamp}\nTrigger: ${trigger}\nTask: ${activeTask.title}\n\n${details.slice(0, 4000)}\n`;
    return true;
  }

  private selectModelForTask(state: HarnessState, activeTask: TaskItem, modelBindings: Record<string, string>): string {
    const escalationModel = this.escalationModel(modelBindings);
    if (this.shouldEscalate(state) && escalationModel) {
      this.ensureEscalationEntry(state, activeTask, escalationModel, 'Repeated reflection failures reached escalation threshold.');
      return escalationModel;
    }
    if (activeTask.owner === 'Architect') {
      return modelBindings.Architect || modelBindings.plan || OpenRouterProvider.architectModel();
    }
    if (activeTask.owner === 'Editor') {
      return modelBindings.Editor || modelBindings.code || OpenRouterProvider.codingModel();
    }
    if (activeTask.owner === 'Reviewer') {
      return modelBindings.Reviewer || modelBindings.review || OpenRouterProvider.mixedModel();
    }
    return modelBindings[activeTask.owner] || modelBindings.code || OpenRouterProvider.codingModel();
  }

  private shouldEscalate(state: HarnessState): boolean {
    return (state.runStats?.reflectionAttempts || 0) >= ESCALATE_AFTER_REFLECTIONS;
  }

  private escalationModel(modelBindings: Record<string, string>): string {
    return modelBindings.Escalation || modelBindings.escalation || modelBindings.review || modelBindings.Reviewer || OpenRouterProvider.mixedModel();
  }

  private maybeScheduleEscalation(state: HarnessState, activeTask: TaskItem, reason: string): void {
    if (!this.shouldEscalate(state)) {
      return;
    }
    this.ensureEscalationEntry(state, activeTask, '', reason);
  }

  private ensureEscalationEntry(state: HarnessState, activeTask: TaskItem, modelId: string, reason: string): void {
    state.escalations = state.escalations || [];
    state.runStats = state.runStats || this.createRunStats();
    const toModel = modelId || 'pending model binding';
    const existing = state.escalations.find(entry => entry.reflectionAttempts === state.runStats.reflectionAttempts && entry.fromRole === activeTask.owner);
    if (existing) {
      if (modelId && existing.toModel !== modelId) {
        existing.toModel = modelId;
      }
      return;
    }

    const entry: EscalationEntry = {
      id: `escalation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reason,
      fromRole: activeTask.owner,
      toModel,
      reflectionAttempts: state.runStats.reflectionAttempts,
      timestamp: new Date().toISOString()
    };
    state.escalations.push(entry);
    state.runStats.escalationCount += 1;
    state.logs.push(this.log('warning', `Escalation queued for ${activeTask.owner}: ${reason}`, 'Harness'));
    state.scratchpadMd = `${state.scratchpadMd}\n## Escalation - ${entry.timestamp}\nRole: ${activeTask.owner}\nModel: ${toModel}\nReason: ${reason}\n`;
  }

  private captureToolResult(state: HarnessState, proposal: ToolProposal, result: { success: boolean; output: string; diff?: string }): void {
    const relPath = typeof proposal.arguments.path === 'string' ? proposal.arguments.path : '';
    if (result.success && relPath && ['read_file', 'read_range', 'write_file', 'apply_patch'].includes(proposal.name)) {
      try {
        const fullPath = this.tools.resolveWorkspacePath(relPath);
        if (fs.existsSync(fullPath)) {
          state.files[relPath] = {
            path: relPath,
            content: fs.readFileSync(fullPath, 'utf8').slice(0, 20000),
            language: path.extname(relPath).replace('.', '') || 'text'
          };
          state.activeFilePath = relPath;
        }
      } catch {
        // The firewall already owns scope errors; this is best-effort memory capture.
      }
    }

    const scratchEntry = [
      `\n## ${proposal.name} - ${new Date().toISOString()}`,
      relPath ? `Path: ${relPath}` : '',
      'Output:',
      '```',
      result.output.slice(0, 4000),
      '```'
    ].filter(Boolean).join('\n');
    state.scratchpadMd = `${state.scratchpadMd}\n${scratchEntry}\n`;
  }

  private recordCommandSideEffects(
    state: HarnessState,
    proposal: ToolProposal,
    before: Map<string, string>,
    output: string,
    commandMetadata: CommandSideEffectEntry['sandbox'] | undefined,
    transaction?: WorkerCommandTransaction
  ): void {
    state.commandEffects = state.commandEffects || [];
    state.runStats = state.runStats || this.createRunStats();
    const after = snapshotWorkspaceFiles(this.tools.getWorkspaceRoot());
    const created = Array.from(after.keys()).filter(file => !before.has(file)).sort();
    const deleted = Array.from(before.keys()).filter(file => !after.has(file)).sort();
    const modified = Array.from(after.keys()).filter(file => before.has(file) && before.get(file) !== after.get(file)).sort();
    const unchangedCount = Array.from(after.keys()).filter(file => before.has(file) && before.get(file) === after.get(file)).length;
    const entry: CommandSideEffectEntry = {
      id: `command-effect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      command: String(proposal.arguments.command || ''),
      created,
      modified,
      deleted,
      unchangedCount,
      sandbox: commandMetadata || {
        cwd: this.tools.getWorkspaceRoot(),
        timeoutMs: 0,
        durationMs: 0,
        exitCode: null,
        signal: null,
        sanitizedEnv: false,
        inheritedEnvKeyCount: 0,
        allowedEnvKeys: [],
        blockedEnvKeys: [],
        network: {
          detected: false,
          risk: 'none',
          decision: 'allowed',
          operations: [],
          endpoints: [],
          reason: 'No command execution metadata was returned.'
        }
      },
      outputExcerpt: output.slice(0, 2000),
      timestamp: new Date().toISOString(),
      transactionId: transaction?.id,
      transactionMode: transaction?.mode
    };
    state.commandEffects.push(entry);
    state.runStats.commandEffectCaptures += 1;
    state.runStats.commandCreatedFiles += created.length;
    state.runStats.commandModifiedFiles += modified.length;
    state.runStats.commandDeletedFiles += deleted.length;
    if (entry.sandbox.network.detected) {
      state.runStats.networkIntentCaptures = (state.runStats.networkIntentCaptures || 0) + 1;
    }
    state.logs.push(this.log('validation', `Command side effects captured: +${created.length} ~${modified.length} -${deleted.length}; sandbox env allowed ${entry.sandbox.allowedEnvKeys.length}, blocked ${entry.sandbox.blockedEnvKeys.length}; network=${entry.sandbox.network.risk}/${entry.sandbox.network.decision}.`, 'Firewall'));
    state.scratchpadMd = `${state.scratchpadMd}\n## Command Side Effects - ${entry.timestamp}\nCommand: ${entry.command}\nCreated: ${created.join(', ') || 'none'}\nModified: ${modified.join(', ') || 'none'}\nDeleted: ${deleted.join(', ') || 'none'}\nSandbox: sanitized=${entry.sandbox.sanitizedEnv}; allowedEnv=${entry.sandbox.allowedEnvKeys.length}; blockedEnv=${entry.sandbox.blockedEnvKeys.length}; exit=${entry.sandbox.exitCode}\nNetwork: detected=${entry.sandbox.network.detected}; risk=${entry.sandbox.network.risk}; decision=${entry.sandbox.network.decision}; operations=${entry.sandbox.network.operations.join(', ') || 'none'}; endpoints=${entry.sandbox.network.endpoints.join(', ') || 'none'}\n`;
  }

  private async createPreCommitReview(
    state: HarnessState,
    activeTask: TaskItem,
    proposal: ToolProposal,
    modelBindings: Record<string, string>
  ): Promise<PreCommitReviewEntry> {
    const modelId = modelBindings.review || modelBindings.Reviewer || '';
    const protectedPaths = typeof proposal.arguments.path === 'string' && proposal.arguments.path
      ? [proposal.arguments.path.replace(/\\/g, '/')]
      : ['.'];
    if (modelId) {
      try {
        const reviewerWorker = this.ensureWorkerContext(state, 'Reviewer');
        reviewerWorker.providerCalls += 1;
        const response = await this.provider.generateChat({
          modelId,
          sessionId: reviewerWorker.sessionId,
          fallbackModels: [OpenRouterProvider.mixedModel()],
          responseFormatSchema: PRE_COMMIT_REVIEW_SCHEMA,
          messages: [
            {
              role: 'system',
              content: 'You are Forge Pre-Commit Reviewer. Decide whether this proposed mutating tool call should be allowed before COMMIT. Return only schema-valid JSON.'
            },
            {
              role: 'user',
              content: [
                `Goal: ${state.goalContract.goal}`,
                `Active task: ${activeTask.owner}:${activeTask.title}`,
                `Proposal: ${proposal.name}`,
                `Arguments: ${JSON.stringify(proposal.arguments).slice(0, 8000)}`,
                'Block only for concrete correctness, scope, safety, or evidence risks. Do not block just because final tests have not run yet.'
              ].join('\n')
            }
          ]
        });
        const parsed = JSON.parse(response.text || '{}');
        const status = parsed.status === 'blocked' ? 'blocked' : 'approved';
        return {
          id: `precommit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          reviewer: activeTask.owner || 'Reviewer',
          modelId,
          source: 'model',
          status,
          proposalName: proposal.name,
          protectedPaths,
          summary: String(parsed.summary || 'Reviewer model pre-commit review completed.').slice(0, 1200),
          concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map((item: any) => String(item).slice(0, 300)).slice(0, 8) : [],
          timestamp: new Date().toISOString()
        };
      } catch (error: any) {
        state.logs.push(this.log('warning', `Pre-commit reviewer model failed; deterministic review used: ${error.message}`, 'Reviewer'));
      }
    }

    return {
      id: `precommit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reviewer: activeTask.owner || 'Reviewer',
      modelId: modelId || 'deterministic-precommit-reviewer',
      source: 'deterministic',
      status: 'approved',
      proposalName: proposal.name,
      protectedPaths,
      summary: 'Deterministic pre-commit review approved after schema, scope, command policy, and patch applicability validation.',
      concerns: [],
      timestamp: new Date().toISOString()
    };
  }

  private async recordDiffReview(state: HarnessState, diffOutput: string, reviewer: string, modelBindings: Record<string, string> = {}): Promise<void> {
    state.diffReviews = state.diffReviews || [];
    state.reviewerCritiques = state.reviewerCritiques || [];
    state.runStats = state.runStats || this.createRunStats();
    state.runStats.diffReviewAttempts += 1;
    state.runStats.reviewerCritiques = state.runStats.reviewerCritiques || 0;
    state.runStats.reviewerModelCritiques = state.runStats.reviewerModelCritiques || 0;
    const normalized = diffOutput.trim();
    const status: DiffReviewEntry['status'] = !normalized || /^no changes\.?$/i.test(normalized)
      ? 'no_changes'
      : 'approved';
    state.runStats.reviewerApprovals += 1;
    const review: DiffReviewEntry = {
      id: `diff-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reviewer,
      status,
      summary: status === 'no_changes' ? 'Reviewer inspected diff: no workspace changes.' : 'Reviewer inspected current diff and allowed verification to continue.',
      diffExcerpt: normalized.slice(0, 4000),
      timestamp: new Date().toISOString()
    };
    state.diffReviews.push(review);
    state.logs.push(this.log('validation', `${review.summary} (${status})`, 'Reviewer'));
    state.scratchpadMd = `${state.scratchpadMd}\n## Diff Review - ${review.timestamp}\nStatus: ${status}\nReviewer: ${reviewer}\n\n${review.diffExcerpt || 'No changes.'}\n`;
    const critique = await this.createReviewerCritique(state, normalized, reviewer, status, modelBindings);
    state.reviewerCritiques.push(critique);
    state.runStats.reviewerCritiques += 1;
    if (critique.source === 'model') {
      state.runStats.reviewerModelCritiques += 1;
    }
    state.logs.push(this.log('validation', `Reviewer critique (${critique.source}) ${critique.status}: ${critique.summary}`, 'Reviewer'));
    state.scratchpadMd = `${state.scratchpadMd}\n## Reviewer Critique - ${critique.timestamp}\nSource: ${critique.source}\nModel: ${critique.modelId}\nStatus: ${critique.status}\n\n${critique.summary}\n`;
  }

  private async createReviewerCritique(
    state: HarnessState,
    diffOutput: string,
    reviewer: string,
    defaultStatus: ReviewerCritiqueEntry['status'],
    modelBindings: Record<string, string>
  ): Promise<ReviewerCritiqueEntry> {
    const modelId = modelBindings.review || modelBindings.Reviewer || '';
    if (modelId) {
      try {
        const reviewerWorker = this.ensureWorkerContext(state, 'Reviewer');
        reviewerWorker.providerCalls += 1;
        const response = await this.provider.generateChat({
          modelId,
          sessionId: reviewerWorker.sessionId,
          fallbackModels: [OpenRouterProvider.mixedModel()],
          responseFormatSchema: REVIEWER_CRITIQUE_SCHEMA,
          messages: [
            {
              role: 'system',
              content: 'You are Forge Reviewer. Critique the diff for correctness, test risk, scope creep, and evidence gaps. Return only schema-valid JSON.'
            },
            {
              role: 'user',
              content: [
                `Goal: ${state.goalContract.goal}`,
                `Oracle: lint=${state.oracleStatuses.linter} typecheck=${state.oracleStatuses.compiler} tests=${state.oracleStatuses.tests}`,
                'Diff:',
                diffOutput.slice(0, 12000) || 'No changes.'
              ].join('\n')
            }
          ]
        });
        const parsed = JSON.parse(response.text || '{}');
        const status = ['approved', 'no_changes', 'blocked'].includes(parsed.status) ? parsed.status : defaultStatus;
        return {
          id: `critique-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          reviewer,
          modelId,
          source: 'model',
          status,
          summary: String(parsed.summary || 'Reviewer model critique completed.').slice(0, 1200),
          concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map((item: any) => String(item).slice(0, 300)).slice(0, 8) : [],
          diffExcerpt: diffOutput.slice(0, 4000),
          timestamp: new Date().toISOString()
        };
      } catch (error: any) {
        state.logs.push(this.log('warning', `Reviewer model critique failed; deterministic critique used: ${error.message}`, 'Reviewer'));
      }
    }

    const noChanges = !diffOutput || /^no changes\.?$/i.test(diffOutput);
    return {
      id: `critique-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reviewer,
      modelId: modelId || 'deterministic-reviewer',
      source: 'deterministic',
      status: noChanges ? 'no_changes' : defaultStatus,
      summary: noChanges
        ? 'Deterministic reviewer found no diff to critique.'
        : 'Deterministic reviewer recorded diff presence; configured reviewer model was not used or failed.',
      concerns: noChanges ? [] : ['No model critique was available; rely on oracle evidence and deterministic firewall checks.'],
      diffExcerpt: diffOutput.slice(0, 4000),
      timestamp: new Date().toISOString()
    };
  }

  private architectExecutionSections(state: HarnessState, activeTask: TaskItem): PromptSection[] {
    if (activeTask.owner !== 'Editor') {
      return [];
    }
    const handoff = state.architectHandoff || {
      generatedAt: new Date().toISOString(),
      sourceTaskId: 'legacy-plan',
      sourceTaskTitle: 'Recovered persisted plan',
      planMd: state.planMd,
      focusFiles: extractPlanFocusFiles(state.planMd, this.tools.getWorkspaceRoot(), 6),
      premiseChecks: extractMarkdownListSection(state.planMd, 'Premise Checks', 8),
      orderedSteps: extractMarkdownListSection(state.planMd, 'Ordered Steps', 12)
    };
    const sections: PromptSection[] = [{
      id: 'architect-plan',
      required: true,
      priority: 100,
      content: `Committed architect execution plan:\n${handoff.planMd}`
    }];
    for (const filePath of handoff.focusFiles) {
      let content = '';
      try {
        content = fs.readFileSync(path.join(this.tools.getWorkspaceRoot(), filePath), 'utf8');
      } catch (error: any) {
        content = `[Focus file unavailable: ${error.message}]`;
      }
      sections.push({
        id: `focus-file:${filePath}`,
        required: true,
        priority: 100,
        content: `Architect focus file ${filePath} - full current content:\n${content}`
      });
    }
    return sections;
  }

  private createArchitectHandoff(state: HarnessState, activeTask: TaskItem): ArchitectHandoff {
    return {
      generatedAt: new Date().toISOString(),
      sourceTaskId: activeTask.id,
      sourceTaskTitle: activeTask.title,
      planMd: state.planMd,
      focusFiles: extractPlanFocusFiles(state.planMd, this.tools.getWorkspaceRoot(), 6),
      premiseChecks: extractMarkdownListSection(state.planMd, 'Premise Checks', 8),
      orderedSteps: extractMarkdownListSection(state.planMd, 'Ordered Steps', 12)
    };
  }

  private createContextBundleSkeleton(goal: string): ContextBundle {
    return {
      generatedAt: new Date().toISOString(),
      goal,
      openTasks: [],
      recentFiles: [],
      retrievalCandidates: [],
      recentReflections: [],
      recentEscalations: [],
      recentReviews: [],
      recentBlockers: [],
      scratchpadSummary: 'No scratchpad entries yet.',
      retrievalPolicy: [
        'Prefer files already read into state.files before broad search.',
        'Use repo_search/symbol_search before reading unrelated files.',
        'Carry open blockers, reflections, escalations, and reviewer notes into the next proposal.'
      ],
      tokenEstimate: 0,
      compacted: false,
      promptCharBudget: DEFAULT_PROMPT_CHAR_BUDGET,
      promptChars: 0,
      promptTokenEstimate: 0,
      includedSections: [],
      clearedSections: [],
      truncatedSections: [],
      droppedChars: 0
    };
  }

  private refreshContextBundle(state: HarnessState, activeTask?: TaskItem): ContextBundle {
    state.runStats = state.runStats || this.createRunStats();
    state.runStats.retrievalRefreshes = state.runStats.retrievalRefreshes || 0;
    const openTasks = state.taskGraph.tasks
      .filter(task => task.status !== 'completed')
      .map(task => `${task.id}:${task.status}:${task.owner}:${task.title}`);
    const recentFiles = Object.values(state.files)
      .slice(-12)
      .map(file => `${file.path} (${file.language}, ${file.content.length} chars)`);
    const retrievalCandidates = this.rankRetrievalCandidates(state, activeTask, 10);
    const scratchTail = state.scratchpadMd.slice(-6000);
    const scratchpadSummary = summarizeText(scratchTail, 1200) || 'No scratchpad entries yet.';
    const previous = state.contextBundle;
    const bundle: ContextBundle = {
      generatedAt: new Date().toISOString(),
      goal: state.goalContract.goal,
      activeTask: activeTask ? `${activeTask.id}:${activeTask.owner}:${activeTask.title}` : undefined,
      openTasks,
      recentFiles,
      retrievalCandidates,
      recentReflections: (state.reflections || []).slice(-5).map(reflection => `${reflection.trigger}:${reflection.taskTitle}:${reflection.details.slice(0, 500)}`),
      recentLessons: this.readRecentLessons(3),
      recentEscalations: (state.escalations || []).slice(-5).map(escalation => `${escalation.fromRole}->${escalation.toModel}:${escalation.reason}`),
      recentReviews: (state.diffReviews || []).slice(-5).map(review => `${review.status}:${review.summary}`),
      recentBlockers: (state.blockers || []).filter(blocker => blocker.status === 'open').slice(-6).map(blocker => `${blocker.category}: ${blocker.summary} -> ${blocker.suggestedAction}`),
      scratchpadSummary,
      retrievalPolicy: [
        'Prefer files already read into state.files before broad search.',
        'Prefer retrievalCandidates before unrelated file reads.',
        state.semanticRetrieval?.status === 'ready' ? `Blend deterministic evidence with ${state.semanticRetrieval.modelId} cosine similarity; semantic provenance must remain visible.` : 'Semantic retrieval unavailable or disabled; use deterministic ranking only.',
        'Use repo_search/symbol_search before reading unrelated files.',
        'Rehydrate goal, open tasks, recent files, reflections, escalations, and reviewer notes after compaction.'
      ],
      tokenEstimate: estimateTokens([state.goalContract.goal, ...openTasks, ...recentFiles, ...retrievalCandidates.map(candidate => candidate.path), ...(state.blockers || []).filter(blocker => blocker.status === 'open').map(blocker => `${blocker.category}:${blocker.summary}`), scratchpadSummary].join('\n')),
      compacted: previous?.compacted || false,
      promptCharBudget: previous?.promptCharBudget || DEFAULT_PROMPT_CHAR_BUDGET,
      promptChars: previous?.promptChars || 0,
      promptTokenEstimate: previous?.promptTokenEstimate || 0,
      includedSections: previous?.includedSections || [],
      clearedSections: previous?.clearedSections || [],
      truncatedSections: previous?.truncatedSections || [],
      droppedChars: previous?.droppedChars || 0,
      compactionReason: previous?.compactionReason
    };
    state.contextBundle = bundle;
    state.runStats.contextRefreshes += 1;
    state.runStats.retrievalRefreshes += 1;
    return bundle;
  }

  private async refreshSemanticRetrieval(state: HarnessState, activeTask: TaskItem): Promise<void> {
    state.runStats = state.runStats || this.createRunStats();
    if (!this.embeddingProvider) {
      state.semanticRetrieval = {
        generatedAt: new Date().toISOString(), status: 'disabled', provider: 'deterministic-fallback', modelId: '', query: '', cacheHits: 0, embeddedDocuments: 0, candidates: []
      };
      return;
    }
    const root = this.tools.getWorkspaceRoot();
    const query = [
      state.goalContract.goal,
      activeTask.title,
      activeTask.owner,
      ...(state.blockers || []).filter(blocker => blocker.status === 'open').map(blocker => `${blocker.category} ${blocker.summary}`)
    ].join('\n').slice(0, 8000);
    const documents: SemanticDocument[] = [];
    for (const filePath of listRetrievalFiles(root, 80)) {
      try {
        const rel = path.relative(root, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf8').slice(0, 6000);
        documents.push({ path: rel, text: `Path: ${rel}\n${content}` });
      } catch {
        // Binary/unreadable files remain covered by deterministic path ranking.
      }
    }
    try {
      const report = await rankSemantically(root, query, documents, this.embeddingProvider, 30);
      state.semanticRetrieval = report;
      state.runStats.semanticRefreshes += 1;
      state.runStats.semanticCacheHits += report.cacheHits;
      state.runStats.semanticEmbeddedDocuments += report.embeddedDocuments;
      state.logs.push(this.log('validation', `Semantic retrieval ready: ${report.candidates.length} candidates via ${report.modelId}; cache hits ${report.cacheHits}, embedded documents ${report.embeddedDocuments}.`, 'Retrieval'));
    } catch (error: any) {
      state.semanticRetrieval = {
        generatedAt: new Date().toISOString(),
        status: 'failed',
        provider: this.embeddingProvider.id,
        modelId: this.embeddingProvider.modelId,
        query,
        cacheHits: 0,
        embeddedDocuments: 0,
        candidates: [],
        error: String(error?.message || error).slice(0, 1200)
      };
      state.runStats.semanticFailures += 1;
      state.logs.push(this.log('warning', `Semantic retrieval failed; deterministic ranking retained: ${state.semanticRetrieval.error}`, 'Retrieval'));
    }
  }

  private rankRetrievalCandidates(state: HarnessState, activeTask?: TaskItem, limit = 10): RetrievalCandidate[] {
    const root = this.tools.getWorkspaceRoot();
    const queryText = [
      state.goalContract.goal,
      activeTask?.title || '',
      activeTask?.owner || '',
      ...state.taskGraph.tasks.filter(task => task.status !== 'completed').map(task => `${task.owner} ${task.title}`)
    ].join(' ');
    const queryTokens = tokenize(queryText);
    const files = listRetrievalFiles(root, 300);
    const semanticByPath = new Map((state.semanticRetrieval?.status === 'ready' ? state.semanticRetrieval.candidates : []).map(candidate => [candidate.path.replace(/\\/g, '/'), candidate.similarity]));
    const candidates = files.map(filePath => {
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      const language = path.extname(rel).replace('.', '') || 'text';
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf8').slice(0, 12000);
      } catch {
        content = '';
      }
      const pathTokens = tokenize(rel);
      const contentTokens = tokenize(content);
      const pathHits = countTokenHits(queryTokens, pathTokens);
      const contentHits = countTokenHits(queryTokens, contentTokens);
      const rememberedBoost = state.files[rel] ? 8 : 0;
      const sourceBoost = /\.(ts|tsx|js|jsx|py|cs|go|rs)$/i.test(rel) ? 2 : 0;
      const configBoost = /(^|\/)(package\.json|tsconfig\.json|vite\.config|jest\.config|AGENTS\.md|README\.md)$/i.test(rel) ? 2 : 0;
      const semanticScore = semanticByPath.get(rel);
      const semanticBoost = semanticScore === undefined ? 0 : Math.max(0, semanticScore) * 40;
      const score = pathHits * 6 + contentHits + rememberedBoost + sourceBoost + configBoost + semanticBoost;
      const reasons = [
        pathHits ? `${pathHits} path token hits` : '',
        contentHits ? `${contentHits} content token hits` : '',
        rememberedBoost ? 'already in state.files' : '',
        sourceBoost ? 'source file' : '',
        configBoost ? 'project config/doc' : '',
        semanticScore === undefined ? '' : `semantic cosine ${semanticScore.toFixed(3)}`
      ].filter(Boolean);
      return {
        path: rel,
        score,
        reason: reasons.join('; ') || 'fallback candidate',
        language,
        semanticScore,
        source: semanticScore === undefined ? 'deterministic' as const : 'hybrid' as const
      };
    });
    return candidates
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, limit);
  }

  private refreshRoleHandoff(state: HarnessState, activeTask: TaskItem): RoleHandoff {
    state.roleHandoffs = state.roleHandoffs || {};
    state.runStats = state.runStats || this.createRunStats();
    state.runStats.roleHandoffRefreshes = state.runStats.roleHandoffRefreshes || 0;
    const role = activeTask.owner || 'Orchestrator';
    const openTasks = state.taskGraph.tasks
      .filter(task => task.owner === role && task.status !== 'completed')
      .map(task => `${task.id}:${task.status}:${task.title}`);
    const relatedOpenTasks = openTasks.length > 0
      ? openTasks
      : state.taskGraph.tasks
        .filter(task => task.status !== 'completed')
        .slice(0, 4)
        .map(task => `${task.id}:${task.status}:${task.owner}:${task.title}`);
    const context = [
      ...(state.contextBundle?.recentFiles || []).slice(-4),
      ...(state.contextBundle?.recentReflections || []).slice(-3),
      ...(state.contextBundle?.recentEscalations || []).slice(-2),
      ...(state.contextBundle?.recentReviews || []).slice(-2)
    ].slice(-8);
    const handoff: RoleHandoff = {
      role,
      generatedAt: new Date().toISOString(),
      allowedTools: this.allowedToolsForRole(role, activeTask),
      responsibilities: this.responsibilitiesForRole(role, activeTask),
      openTasks: relatedOpenTasks,
      recentContext: context,
      handoffSummary: `${role} owns "${activeTask.title}". Propose one valid tool call, keep mutations behind VALIDATE -> COMMIT, and leave success claims to green evidence plus reviewer proof.`
    };
    state.roleHandoffs[role] = handoff;
    this.ensureWorkerContext(state, role, activeTask);
    state.runStats.roleHandoffRefreshes += 1;
    return handoff;
  }

  private allowedToolsForRole(role: string, activeTask: TaskItem): ToolName[] {
    const withAsk = (tools: ToolName[]): ToolName[] => [...tools, 'ask_user'];
    if (role === 'Explorer') {
      return withAsk(['repo_search', 'symbol_search', 'read_file', 'read_range']);
    }
    if (role === 'Architect') {
      return withAsk(['repo_search', 'symbol_search', 'read_file', 'read_range', 'update_plan', 'update_tasks']);
    }
    if (role === 'Editor') {
      return withAsk(['repo_search', 'symbol_search', 'read_file', 'read_range', 'apply_patch', 'write_file', 'run_tests']);
    }
    if (role === 'Reviewer' || activeTask.title.toLowerCase().includes('verification')) {
      return withAsk(['run_tests', 'run_command', 'get_diff', 'record_evidence', 'declare_success']);
    }
    if (role === 'Escalation') {
      return withAsk(['repo_search', 'symbol_search', 'read_file', 'read_range', 'apply_patch', 'run_tests', 'get_diff']);
    }
    return withAsk(['repo_search', 'read_file', 'read_range', 'update_plan']);
  }

  private validateRoleCapability(state: HarnessState, activeTask: TaskItem, proposal: ToolProposal): { valid: boolean; reason?: string } {
    void state;
    const role = activeTask.owner || 'Orchestrator';
    const allowed = this.allowedToolsForRole(role, activeTask);
    if (allowed.includes(proposal.name)) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `[role_capability_blocked] ${role} cannot use ${proposal.name} while assigned to "${activeTask.title}". Allowed tools: ${allowed.join(', ')}.`
    };
  }

  private ensureWorkerContext(state: HarnessState, role: string, activeTask?: TaskItem): WorkerContext {
    state.workerContexts = state.workerContexts || {};
    const normalizedRole = role || 'Orchestrator';
    const fallbackTask: TaskItem = activeTask || {
      id: 'worker-context',
      title: 'Persisted worker context',
      status: 'running',
      dependencies: [],
      blockers: [],
      owner: normalizedRole
    };
    const existing = state.workerContexts[normalizedRole];
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      existing.allowedTools = this.allowedToolsForRole(normalizedRole, fallbackTask);
      if (activeTask) {
        existing.lastTaskId = activeTask.id;
        existing.lastTaskTitle = activeTask.title;
      }
      return existing;
    }
    const now = new Date().toISOString();
    const worker: WorkerContext = {
      role: normalizedRole,
      sessionId: `${state.sessionId}:worker:${normalizedRole.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      allowedTools: this.allowedToolsForRole(normalizedRole, fallbackTask),
      createdAt: now,
      updatedAt: now,
      providerCalls: 0,
      acceptedProposals: 0,
      rejectedProposals: 0,
      processExecutions: 0,
      processFailures: 0,
      lastWorkerPid: null,
      lastWorkerDurationMs: 0,
      lastWorkerBlockedEnvKeys: [],
      recentTools: [],
      lastTaskId: activeTask?.id || '',
      lastTaskTitle: activeTask?.title || ''
    };
    state.workerContexts[normalizedRole] = worker;
    return worker;
  }

  private recordWorkerProposal(state: HarnessState, activeTask: TaskItem, proposal: ToolProposal, accepted: boolean): void {
    const worker = this.ensureWorkerContext(state, activeTask.owner || 'Orchestrator', activeTask);
    if (accepted) worker.acceptedProposals += 1;
    else worker.rejectedProposals += 1;
    worker.recentTools = [...worker.recentTools, proposal.name].slice(-12);
    worker.updatedAt = new Date().toISOString();
  }

  private recordWorkerExecution(state: HarnessState, activeTask: TaskItem, metadata: WorkerProcessMetadata, success: boolean): void {
    state.runStats = state.runStats || this.createRunStats();
    const worker = this.ensureWorkerContext(state, activeTask.owner || metadata.role || 'Orchestrator', activeTask);
    worker.processExecutions += 1;
    if (!success) worker.processFailures += 1;
    worker.lastWorkerPid = metadata.pid;
    worker.lastWorkerDurationMs = metadata.durationMs;
    worker.lastWorkerBlockedEnvKeys = metadata.blockedEnvKeys;
    worker.updatedAt = new Date().toISOString();
    state.runStats.workerProcessExecutions += 1;
    if (!success) state.runStats.workerProcessFailures += 1;
    state.logs.push(this.log(success ? 'validation' : 'warning', `Worker process ${metadata.pid} executed ${activeTask.owner} tool in ${metadata.durationMs}ms; env allowed ${metadata.allowedEnvKeys.length}, blocked ${metadata.blockedEnvKeys.length}.`, 'Worker'));
  }

  private recordEditTransaction(state: HarnessState, transaction: WorkerEditTransaction): void {
    state.workerEditTransactions = state.workerEditTransactions || [];
    state.runStats = state.runStats || this.createRunStats();
    state.workerEditTransactions.push(transaction);
    state.runStats.editTransactions += 1;
    if (transaction.conflict) state.runStats.editTransactionConflicts += 1;
    if (transaction.mode === 'git-worktree') state.runStats.worktreeEditTransactions += 1;
    else state.runStats.sparseEditTransactions += 1;
    state.logs.push(this.log(transaction.committed ? 'validation' : 'warning', `Edit transaction ${transaction.id} ${transaction.committed ? 'committed' : 'refused'} via ${transaction.mode}; target=${transaction.targetPath}; conflict=${transaction.conflict}; cleanup=${transaction.cleanupSucceeded}.`, 'Worker'));
  }

  private recordCommandTransaction(state: HarnessState, transaction: WorkerCommandTransaction): void {
    state.workerCommandTransactions = state.workerCommandTransactions || [];
    state.runStats = state.runStats || this.createRunStats();
    state.workerCommandTransactions.push(transaction);
    state.runStats.commandTransactions += 1;
    if (transaction.conflict) state.runStats.commandTransactionConflicts += 1;
    state.runStats.commandTransactionMergedFiles += transaction.mergedFileCount;
    if (transaction.rollbackAttempted) state.runStats.commandTransactionRollbacks += 1;
    state.logs.push(this.log(transaction.committed ? 'validation' : 'warning', `Command transaction ${transaction.id} ${transaction.committed ? 'committed' : 'refused'} via ${transaction.mode}; files=${transaction.mergedFileCount}; conflict=${transaction.conflict}; rollback=${transaction.rollbackAttempted}/${transaction.rollbackSucceeded}; cleanup=${transaction.cleanupSucceeded}.`, 'Worker'));
  }

  private recordBlocker(state: HarnessState, source: BlockerSource, details: string, activeTask?: TaskItem): BlockerEntry {
    state.blockers = state.blockers || [];
    state.runStats = state.runStats || this.createRunStats();
    const classification = classifyBlocker(source, details);
    const role = activeTask?.owner || state.activeSubAgent || 'Orchestrator';
    const taskId = activeTask?.id || '';
    const existing = state.blockers.find(blocker => blocker.status === 'open' && blocker.category === classification.category && blocker.taskId === taskId && blocker.role === role);
    const now = new Date().toISOString();
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = now;
      existing.summary = String(details).slice(0, 1200);
      existing.retryable = classification.retryable;
      existing.suggestedAction = classification.suggestedAction;
      state.runStats.blockerEvents += 1;
      this.syncBlockerStats(state);
      return existing;
    }
    const blocker: BlockerEntry = {
      id: `blocker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      category: classification.category,
      status: 'open',
      retryable: classification.retryable,
      taskId,
      taskTitle: activeTask?.title || '',
      role,
      summary: String(details).slice(0, 1200),
      suggestedAction: classification.suggestedAction,
      occurrences: 1,
      firstSeenAt: now,
      lastSeenAt: now
    };
    state.blockers.push(blocker);
    state.runStats.blockerEvents += 1;
    this.syncBlockerStats(state);
    state.logs.push(this.log('warning', `Blocker ${blocker.category} opened (${blocker.retryable ? 'retryable' : 'non-retryable'}): ${blocker.summary.slice(0, 400)}`, 'Harness'));
    return blocker;
  }

  private resolveBlockers(state: HarnessState, activeTask: TaskItem | undefined, categories: BlockerCategory[], resolution: string): void {
    state.blockers = state.blockers || [];
    const now = new Date().toISOString();
    for (const blocker of state.blockers) {
      if (blocker.status !== 'open' || !categories.includes(blocker.category)) continue;
      if (activeTask && blocker.taskId && blocker.taskId !== activeTask.id) continue;
      blocker.status = 'resolved';
      blocker.resolvedAt = now;
      blocker.resolution = resolution;
    }
    this.syncBlockerStats(state);
  }

  private finalizeBlockers(state: HarnessState): void {
    state.blockers = state.blockers || [];
    if (state.status === 'success') {
      this.resolveBlockers(state, undefined, state.blockers.filter(blocker => blocker.status === 'open').map(blocker => blocker.category), 'Run reached terminal success with green oracle evidence and required review.');
      return;
    }
    if (!['failed', 'gave_up'].includes(state.status)) return;
    for (const blocker of state.blockers) {
      if (blocker.status === 'open') {
        blocker.status = 'terminal';
        blocker.resolution = state.haltReason || 'Run terminated with blocker unresolved.';
      }
    }
    this.syncBlockerStats(state);
  }

  private syncBlockerStats(state: HarnessState): void {
    state.runStats = state.runStats || this.createRunStats();
    state.runStats.openBlockers = (state.blockers || []).filter(blocker => blocker.status !== 'resolved').length;
    state.runStats.resolvedBlockers = (state.blockers || []).filter(blocker => blocker.status === 'resolved').length;
  }

  private responsibilitiesForRole(role: string, activeTask: TaskItem): string[] {
    if (role === 'Explorer') {
      return ['Discover relevant files and symbols.', 'Avoid edits and terminal commands.', 'Populate durable context for later roles.'];
    }
    if (role === 'Architect') {
      return ['Convert findings into an implementation plan.', 'Update task graph only through structured tool calls.', 'Keep the plan executable and scoped.'];
    }
    if (role === 'Editor') {
      return ['Make the smallest workspace-contained patch.', 'Use run_tests only to diagnose or prove that no edit is needed.', 'Do not review, record evidence, or claim success.'];
    }
    if (role === 'Reviewer' || activeTask.title.toLowerCase().includes('verification')) {
      return ['Inspect the diff with get_diff before success.', 'Run the selected oracle.', 'Record green evidence before declaring success.'];
    }
    return ['Use only the tools allowed by this handoff.', 'Preserve PROPOSE -> VALIDATE -> COMMIT -> NARRATE.', 'Escalate through harness state instead of bypassing validation.'];
  }

  private hasGreenEvidence(state: HarnessState): boolean {
    return state.lastOraclePass === true && state.evidenceLedger.some(item => item.testResult?.pass === true);
  }

  private hasRequiredDiffReview(state: HarnessState): boolean {
    return (state.diffReviews || []).some(review => review.status === 'approved' || review.status === 'no_changes');
  }

  private makeEvidence(stepTitle: string, observation: string, state: HarnessState, testResult?: OracleResult): EvidenceLedgerItem {
    const latestReview = (state.diffReviews || []).slice(-1)[0];
    return {
      id: `ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stepTitle,
      command: testResult?.command || Object.values(state.projectAdapter?.commands || {}).filter(item => item.command).map(item => item.command).join(' && ') || 'adapter composite oracle',
      observation,
      diff: latestReview?.diffExcerpt,
      testResult: testResult ? { pass: testResult.pass, summary: testResult.output.slice(0, 500), details: testResult.output } : { pass: state.lastOraclePass === true, summary: 'Green oracle already recorded.' },
      confidence: state.lastOraclePass ? 95 : 20,
      timestamp: new Date().toISOString()
    };
  }

  private persistStateToDisk(state: HarnessState): void {
    const root = this.tools.getWorkspaceRoot();
    const forgeDir = path.join(root, '.forge');
    fs.mkdirSync(forgeDir, { recursive: true });

    this.finalizeBlockers(state);

    if (['success', 'failed', 'gave_up'].includes(state.status) && !state.aar) {
      this.recordAar(state, forgeDir);
    }
    finalizeWorkflow(state);
    if (state.aar) {
      fs.writeFileSync(path.join(forgeDir, 'aar.json'), JSON.stringify(state.aar, null, 2), 'utf8');
    }

    fs.writeFileSync(path.join(root, 'PLAN.md'), state.planMd, 'utf8');
    fs.writeFileSync(path.join(root, 'SCRATCHPAD.md'), state.scratchpadMd, 'utf8');
    fs.writeFileSync(path.join(root, 'todos.json'), JSON.stringify(state.taskGraph.tasks, null, 2), 'utf8');
    fs.writeFileSync(path.join(root, 'evidence_ledger.json'), JSON.stringify(state.evidenceLedger, null, 2), 'utf8');

    fs.writeFileSync(path.join(forgeDir, 'goal-contract.json'), JSON.stringify(state.goalContract, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'task-graph.json'), JSON.stringify(state.taskGraph, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'plan.md'), state.planMd, 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'evidence-ledger.json'), JSON.stringify(state.evidenceLedger, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'diff-reviews.json'), JSON.stringify(state.diffReviews || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'reviewer-critiques.json'), JSON.stringify(state.reviewerCritiques || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'precommit-reviews.json'), JSON.stringify(state.preCommitReviews || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'escalations.json'), JSON.stringify(state.escalations || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'blockers.json'), JSON.stringify(state.blockers || [], null, 2), 'utf8');
    this.refreshContextBundle(state);
    fs.writeFileSync(path.join(forgeDir, 'context-bundle.json'), JSON.stringify(state.contextBundle, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'retrieval-index.json'), JSON.stringify(state.contextBundle.retrievalCandidates || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'semantic-retrieval.json'), JSON.stringify(state.semanticRetrieval, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'worker-edit-transactions.json'), JSON.stringify(state.workerEditTransactions || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'worker-command-transactions.json'), JSON.stringify(state.workerCommandTransactions || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'clarifications.json'), JSON.stringify(state.clarifications || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'workflow-governance.json'), JSON.stringify(state.workflow, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'workflow-task-record.md'), renderWorkflowTaskRecord(state), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'role-handoffs.json'), JSON.stringify(state.roleHandoffs || {}, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'worker-contexts.json'), JSON.stringify(state.workerContexts || {}, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'architect-handoff.json'), JSON.stringify(state.architectHandoff || null, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'safety-checkpoints.json'), JSON.stringify(state.safetyCheckpoints || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'command-effects.json'), JSON.stringify(state.commandEffects || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'budget.json'), JSON.stringify(state.runBudget || this.createRunBudget(state.goalContract), null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'repository-knowledge.json'), JSON.stringify(state.knowledge, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'project-adapter.json'), JSON.stringify(state.projectAdapter, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'oracle-failures.json'), JSON.stringify(state.oracleFailures || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'skill-registry.json'), JSON.stringify(state.skills, null, 2), 'utf8');
    fs.writeFileSync(path.join(forgeDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
    this.persistSession(state, forgeDir);
  }

  /** Phase 55.1: sessions are durable. state.json stays the ACTIVE copy (backcompat: resumeFromDisk, artifact paths); every session also persists under .forge/sessions/<id>/ with meta + a fast index. Titles are cosmetic; sessionId is identity. */
  private persistSession(state: HarnessState, forgeDir: string): void {
    try {
      const sessionDir = path.join(forgeDir, 'sessions', state.sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
      const metaPath = path.join(sessionDir, 'meta.json');
      let existing: any = {};
      try {
        existing = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        existing = {};
      }
      const autoTitle = state.goalContract.goal.replace(/^\/goal\s+/i, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled run';
      const meta = {
        sessionId: state.sessionId,
        title: existing.title || autoTitle,
        autoTitle,
        createdAt: existing.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pinned: existing.pinned === true,
        goal: state.goalContract.goal,
        status: state.status,
        steps: state.currentStepIndex,
        costUsd: state.goalContract.spent || 0
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      const indexPath = path.join(forgeDir, 'sessions', 'index.json');
      let index: any[] = [];
      try {
        index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (!Array.isArray(index)) {
          index = [];
        }
      } catch {
        index = [];
      }
      const entry = { sessionId: meta.sessionId, title: meta.title, pinned: meta.pinned, updatedAt: meta.updatedAt, status: meta.status };
      const at = index.findIndex(item => item.sessionId === state.sessionId);
      if (at >= 0) {
        index[at] = { ...index[at], ...entry };
      } else {
        index.push(entry);
      }
      index.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
      fs.writeFileSync(indexPath, JSON.stringify(index.slice(0, 200), null, 2), 'utf8');
    } catch {
      // Session persistence must never break a run.
    }
  }

  private loadRepositoryKnowledge() {
    const root = this.tools.getWorkspaceRoot();
    return {
      ruleFile: fs.existsSync(path.join(root, 'AGENTS.md')) ? 'AGENTS.md' : '',
      commandsFile: fs.existsSync(path.join(root, 'package.json')) ? 'package.json' : '',
      architectureFile: fs.existsSync(path.join(root, 'README.md')) ? 'README.md' : ''
    };
  }

  private loadSkillRegistry() {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.tools.getWorkspaceRoot(), '.forge', 'skill-registry.json'), 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private recordAar(state: HarnessState, forgeDir: string): void {
    const stats = state.runStats || this.createRunStats();
    const triggers: AarTriggerCounts = {
      reflectionAttempts: stats.reflectionAttempts || 0,
      reflectionSuppressed: stats.reflectionSuppressed || 0,
      escalations: stats.escalationCount || 0,
      budgetHalts: stats.budgetHalts || 0,
      preCommitBlocks: stats.preCommitBlocks || 0,
      validationFailures: stats.validationFailures || 0,
      providerFailures: stats.providerFailures || 0,
      repairAttempts: stats.repairAttempts || 0,
      safetyReverts: stats.safetyReverts || 0,
      noProgressTurns: stats.noProgressTurns || 0,
      blockerEvents: stats.blockerEvents || 0,
      terminalBlockers: (state.blockers || []).filter(blocker => blocker.status === 'terminal').length
    };
    const clean = Object.values(triggers).every(count => count === 0);
    const success = state.status === 'success';
    const sustain: string[] = [];
    const improveWork: string[] = [];
    const improveTools: string[] = [];
    if (success && triggers.reflectionAttempts > 0) {
      sustain.push(`Bounded reflection recovered the run after ${triggers.reflectionAttempts} failure(s); verification feedback carried the model to green.`);
    }
    if (success && triggers.validationFailures === 0) {
      sustain.push('Every committed proposal passed firewall validation on the first attempt.');
    }
    if (!success) {
      improveWork.push(`Run ended ${state.status}: ${String(state.haltReason || 'no halt reason recorded').slice(0, 300)}`);
    }
    if (triggers.escalations > 0) {
      improveWork.push(`Primary model required ${triggers.escalations} escalation(s); consider a stronger primary binding or smaller task decomposition for this goal shape.`);
    }
    if (triggers.noProgressTurns > 0) {
      improveWork.push(`${triggers.noProgressTurns} no-progress turn(s) detected; goal may need tighter decomposition.`);
    }
    if (triggers.validationFailures > 0) {
      improveTools.push(`Firewall rejected ${triggers.validationFailures} proposal(s); improve proposal prompting or schema repair for this model tier.`);
    }
    if (triggers.providerFailures > 0) {
      improveTools.push(`${triggers.providerFailures} provider failure(s); check fallback model routing.`);
    }
    if (triggers.repairAttempts > 0) {
      improveTools.push(`${triggers.repairAttempts} malformed output repair(s); consider stricter structured-output settings for this model.`);
    }
    if (triggers.terminalBlockers > 0) {
      const categories = Array.from(new Set((state.blockers || []).filter(blocker => blocker.status === 'terminal').map(blocker => blocker.category)));
      improveWork.push(`${triggers.terminalBlockers} blocker(s) remained terminal: ${categories.join(', ') || 'uncategorized'}.`);
    }
    if (triggers.reflectionSuppressed > 0) {
      improveTools.push(`Reflection was suppressed ${triggers.reflectionSuppressed} time(s) (disabled lane); failures halted instead of recovering.`);
    }
    const lessonsBanked = clean ? [] : this.bankLessons(state, triggers, forgeDir);
    const skillBank = bankProceduralSkills(state.skills || [], {
      terminalStatus: state.status,
      goal: state.goalContract.goal,
      sessionId: state.sessionId,
      languageExtensions: Array.from(new Set(Object.keys(state.files || {}).map(file => path.extname(file)).filter(Boolean))),
      reflectionAttempts: triggers.reflectionAttempts,
      oracleReflectionAttempts: stats.oracleReflections || 0,
      validationFailures: triggers.validationFailures,
      repairAttempts: triggers.repairAttempts,
      preCommitBlocks: triggers.preCommitBlocks,
      escalationCount: triggers.escalations,
      resolvedBlockerCategories: (state.blockers || []).filter(blocker => blocker.status === 'resolved').map(blocker => blocker.category)
    });
    state.skills = skillBank.skills;
    state.aar = {
      generatedAt: new Date().toISOString(),
      sessionId: state.sessionId,
      goal: state.goalContract.goal,
      terminalStatus: state.status,
      haltReason: state.haltReason,
      steps: state.currentStepIndex,
      clean,
      triggers,
      sustain,
      improveWork,
      improveTools,
      lessonsBanked,
      skillsBanked: skillBank.bankedIds
    };
    state.logs.push(this.log(clean ? 'success' : 'warning', clean ? 'AAR recorded: clean run, zero triggers.' : `AAR recorded: ${lessonsBanked.length} lesson(s) banked from fired triggers.`, 'Harness'));
  }

  private bankLessons(state: HarnessState, triggers: AarTriggerCounts, forgeDir: string): string[] {
    const candidates: Array<{ category: string; lesson: string }> = [];
    if (triggers.reflectionAttempts > 0) {
      candidates.push({ category: 'reflection', lesson: `Goal shape "${state.goalContract.goal.slice(0, 120)}" needed ${triggers.reflectionAttempts} reflection(s) before ${state.status}; expect first-attempt red oracles here.` });
    }
    if (triggers.escalations > 0) {
      candidates.push({ category: 'escalation', lesson: `Goal shape "${state.goalContract.goal.slice(0, 120)}" exceeded the primary model; escalation fired ${triggers.escalations} time(s).` });
    }
    if (triggers.budgetHalts > 0) {
      candidates.push({ category: 'budget', lesson: `Budget cap halted this goal shape; consider larger caps or smaller scope.` });
    }
    if (triggers.preCommitBlocks > 0) {
      candidates.push({ category: 'review', lesson: `Pre-commit review blocked ${triggers.preCommitBlocks} mutation(s); reviewer gate is load-bearing for this goal shape.` });
    }
    if (triggers.validationFailures > 0) {
      candidates.push({ category: 'firewall', lesson: `Firewall rejected ${triggers.validationFailures} proposal(s) for this goal shape; model tier needs stronger proposal constraints.` });
    }
    if (triggers.noProgressTurns > 0) {
      candidates.push({ category: 'progress', lesson: `No-progress detector fired on this goal shape; decompose before retrying.` });
    }
    if (triggers.terminalBlockers > 0) {
      const categories = Array.from(new Set((state.blockers || []).filter(blocker => blocker.status === 'terminal').map(blocker => blocker.category)));
      candidates.push({ category: 'blocker', lesson: `Terminal blockers for this goal shape: ${categories.join(', ') || 'uncategorized'}; address these categories before retrying.` });
    }
    const lessonsPath = path.join(forgeDir, 'lessons.json');
    let existing: LessonEntry[] = [];
    try {
      existing = JSON.parse(fs.readFileSync(lessonsPath, 'utf8'));
      if (!Array.isArray(existing)) {
        existing = [];
      }
    } catch {
      existing = [];
    }
    const banked: string[] = [];
    for (const candidate of candidates) {
      const signature = `${candidate.category}:${state.status}:${state.goalContract.goal.slice(0, 80)}`;
      const previous = existing.find(entry => entry.signature === signature);
      if (previous) {
        previous.occurrences += 1;
        previous.recordedAt = new Date().toISOString();
      } else {
        existing.push({
          signature,
          category: candidate.category,
          lesson: candidate.lesson,
          terminalStatus: state.status,
          goal: state.goalContract.goal.slice(0, 200),
          sessionId: state.sessionId,
          recordedAt: new Date().toISOString(),
          occurrences: 1
        });
      }
      banked.push(signature);
    }
    fs.writeFileSync(lessonsPath, JSON.stringify(existing.slice(-50), null, 2), 'utf8');
    return banked;
  }

  private readRecentLessons(limit: number): string[] {
    try {
      const lessonsPath = path.join(this.tools.getWorkspaceRoot(), '.forge', 'lessons.json');
      const lessons: LessonEntry[] = JSON.parse(fs.readFileSync(lessonsPath, 'utf8'));
      if (!Array.isArray(lessons)) {
        return [];
      }
      return lessons.slice(-limit).map(entry => `${entry.category} (x${entry.occurrences}): ${entry.lesson}`);
    } catch {
      return [];
    }
  }

  private controlFilePath(): string {
    return path.join(this.tools.getWorkspaceRoot(), '.forge', 'control.json');
  }

  private readControlFile(): RunControl | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.controlFilePath(), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeControlFile(control: RunControl): void {
    const filePath = this.controlFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(control, null, 2), 'utf8');
  }

  /** Deterministic mid-run steering: goal edits merge without restart; pause halts before any provider call. */
  private applyControl(state: HarnessState): HarnessState | null {
    const control = this.readControlFile();
    if (!control) {
      return null;
    }
    if (control.editedGoal && typeof control.editedGoal === 'object') {
      const edit = control.editedGoal;
      if (typeof edit.goal === 'string' && edit.goal.trim()) {
        state.goalContract.goal = edit.goal.trim();
      }
      if (Array.isArray(edit.doneWhen)) {
        state.goalContract.doneWhen = mergeUnique(edit.doneWhen, ['run_tests oracle passes', 'evidence ledger contains the green oracle result']);
      }
      if (Array.isArray(edit.constraints)) {
        state.goalContract.constraints = mergeUnique(state.goalContract.constraints, edit.constraints);
      }
      if (Array.isArray(edit.nonGoals)) {
        state.goalContract.nonGoals = mergeUnique(state.goalContract.nonGoals, edit.nonGoals);
      }
      if (Number.isFinite(edit.budgetUsd)) {
        state.runBudget.maxCostUsd = Number(edit.budgetUsd);
      }
      if (Number.isFinite(edit.maxSteps) && Number(edit.maxSteps) > state.currentStepIndex) {
        state.maxSteps = Number(edit.maxSteps);
      }
      state.logs.push(this.log('warning', `Goal steered mid-run: ${JSON.stringify(edit).slice(0, 300)}`, 'Harness'));
      state.scratchpadMd = `${state.scratchpadMd}\n## Goal steered - ${new Date().toISOString()}\n${JSON.stringify(edit, null, 2).slice(0, 1000)}\n`;
      this.writeControlFile({ ...control, editedGoal: undefined });
    }
    if (control.paused === true) {
      if (state.status !== 'paused') {
        state.status = 'paused';
        state.logs.push(this.log('warning', 'Run paused by user control. No provider calls will be made until resume.', 'Harness'));
        this.persistStateToDisk(state);
        this.latestState = state;
      }
      return state;
    }
    if (state.status === 'paused') {
      state.status = 'idle';
      state.logs.push(this.log('success', 'Run resumed by user control.', 'Harness'));
    }
    return null;
  }

  /**
   * Session-spanning resume: rehydrate the persisted state and continue.
   * Terminal success/failure is respected (no zombie resurrection); a budget
   * halt resumes only via the explicit flag. Resume grants a fresh wall-clock
   * window and step allowance; cost spent is never forgotten.
   */
  public async resumeFromDisk(options: { additionalSteps?: number; allowBudgetHaltResume?: boolean } = {}): Promise<HarnessState | null> {
    const statePath = path.join(this.tools.getWorkspaceRoot(), '.forge', 'state.json');
    let state: HarnessState;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      return null;
    }
    if (state.status === 'success' || state.status === 'failed') {
      this.latestState = state;
      return state;
    }
    const wasBudgetHalt = state.status === 'gave_up' && Boolean(state.runBudget?.haltReason);
    if (state.status === 'gave_up' && !(wasBudgetHalt && options.allowBudgetHaltResume === true)) {
      this.latestState = state;
      return state;
    }
    const control = this.readControlFile();
    if (control?.paused) {
      this.writeControlFile({ ...control, paused: false });
    }
    state.status = 'idle';
    state.haltReason = undefined;
    state.runBudget = state.runBudget || this.createRunBudget(state.goalContract);
    state.runBudget.startedAt = new Date().toISOString();
    state.runBudget.lastCheckedAt = new Date().toISOString();
    state.runBudget.haltReason = undefined;
    state.maxSteps = state.currentStepIndex + Math.max(1, options.additionalSteps || 30);
    state.logs.push(this.log('success', `Run resumed from disk at step ${state.currentStepIndex} with a fresh wall-clock window and ${Math.max(1, options.additionalSteps || 30)} additional steps. Cost spent so far is retained.`, 'Harness'));
    this.persistStateToDisk(state);
    this.latestState = state;
    return state;
  }

  private halt(state: HarnessState, status: 'failed' | 'gave_up', reason: string): HarnessState {
    state.status = status;
    state.haltReason = reason;
    state.logs.push(this.log('error', reason, 'Harness'));
    this.persistStateToDisk(state);
    this.latestState = state;
    return state;
  }

  private log(type: StepLog['type'], message: string, subAgent: string): StepLog {
    return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, message, subAgent, timestamp: new Date().toISOString() };
  }
}

export interface GoalOverrides {
  doneWhen?: string[];
  constraints?: string[];
  nonGoals?: string[];
  budgetUsd?: number;
  maxSteps?: number;
}

export interface RunControl {
  paused?: boolean;
  editedGoal?: (GoalOverrides & { goal?: string }) | undefined;
  requestedAt?: string;
}

function mergeUnique(base: string[], extra?: string[]): string[] {
  return Array.from(new Set([...(base || []), ...(extra || [])].map(item => String(item).trim()).filter(Boolean)));
}

function getVscode(): typeof import('vscode') | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode');
  } catch {
    return undefined;
  }
}

function summarizeText(text: string, maxLength: number): string {
  const compact = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.floor(maxLength / 2))}\n...\n${compact.slice(-Math.floor(maxLength / 2))}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function extractPlanFocusFiles(planMd: string, root: string, limit = 6): string[] {
  const normalizedPlan = String(planMd || '').replace(/\\/g, '/');
  const comparisonPlan = process.platform === 'win32' ? normalizedPlan.toLowerCase() : normalizedPlan;
  return listRetrievalFiles(root, 10_000)
    .map(filePath => path.relative(root, filePath).replace(/\\/g, '/'))
    .map(filePath => ({ filePath, mentionIndex: exactPathMentionIndex(comparisonPlan, process.platform === 'win32' ? filePath.toLowerCase() : filePath) }))
    .filter(item => item.mentionIndex >= 0)
    .sort((a, b) => a.mentionIndex - b.mentionIndex || a.filePath.localeCompare(b.filePath))
    .slice(0, Math.max(1, limit))
    .map(item => item.filePath);
}

function exactPathMentionIndex(text: string, filePath: string): number {
  let fromIndex = 0;
  while (fromIndex < text.length) {
    const index = text.indexOf(filePath, fromIndex);
    if (index < 0) {
      return -1;
    }
    const before = index > 0 ? text[index - 1] : '';
    const afterIndex = index + filePath.length;
    const after = afterIndex < text.length ? text[afterIndex] : '';
    const pathChar = /[a-zA-Z0-9_.\/-]/;
    if ((!before || !pathChar.test(before)) && (!after || !pathChar.test(after))) {
      return index;
    }
    fromIndex = index + filePath.length;
  }
  return -1;
}

function extractMarkdownListSection(markdown: string, heading: string, limit: number): string[] {
  const lines = String(markdown || '').split(/\r?\n/);
  const headingPattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'i');
  const start = lines.findIndex(line => headingPattern.test(line.trim()));
  if (start < 0) {
    return [];
  }
  const items: string[] = [];
  for (let index = start + 1; index < lines.length && items.length < limit; index += 1) {
    const line = lines[index].trim();
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }
    const match = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (match?.[1]?.trim()) {
      items.push(match[1].trim());
    }
  }
  return items;
}

function snapshotWorkspaceFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const filePath of listSideEffectFiles(root, 1000)) {
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    try {
      const stat = fs.statSync(filePath);
      const hash = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
      snapshot.set(rel, `${stat.size}:${stat.mtimeMs}:${hash}`);
    } catch {
      // Ignore files that disappear during scanning.
    }
  }
  return snapshot;
}

function listSideEffectFiles(root: string, limit: number): string[] {
  const results: string[] = [];
  const visit = (dir: string) => {
    if (results.length >= limit) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SIDE_EFFECT_EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        visit(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  };
  visit(root);
  return results;
}

function tokenize(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !COMMON_RETRIEVAL_STOPWORDS.has(token))
  ));
}

function countTokenHits(queryTokens: string[], targetTokens: string[]): number {
  if (!queryTokens.length || !targetTokens.length) {
    return 0;
  }
  const target = new Set(targetTokens);
  return queryTokens.reduce((count, token) => count + (target.has(token) ? 1 : 0), 0);
}

function listRetrievalFiles(root: string, limit: number): string[] {
  const results: string[] = [];
  const visit = (dir: string) => {
    if (results.length >= limit) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (RETRIEVAL_EXCLUDED_DIRS.has(entry.name) || rel.startsWith('.forge/')) {
          continue;
        }
        visit(fullPath);
      } else if (entry.isFile() && isRetrievableFile(entry.name) && !HARNESS_OWNED_RETRIEVAL_FILES.has(rel)) {
        results.push(fullPath);
      }
    }
  };
  visit(root);
  return results;
}

function isRetrievableFile(fileName: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|py|cs|go|rs|java|kt|yml|yaml|toml|xml|html|css)$/i.test(fileName);
}

const RETRIEVAL_EXCLUDED_DIRS = new Set(['node_modules', 'out', 'dist', '.git', '.forge', '.vscode-test', 'coverage', 'artifacts']);
const HARNESS_OWNED_RETRIEVAL_FILES = new Set(['PLAN.md', 'SCRATCHPAD.md', 'todos.json', 'evidence_ledger.json']);
const SIDE_EFFECT_EXCLUDED_DIRS = new Set(['node_modules', 'out', 'dist', '.git', '.vscode-test', 'coverage', 'artifacts', '.forge']);
const COMMON_RETRIEVAL_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'task',
  'workspace',
  'validate',
  'agent',
  'forge',
  'run',
  'runs',
  'test',
  'tests'
]);

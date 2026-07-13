export interface GoalContract {
  goal: string;
  context: string;
  constraints: string[];
  doneWhen: string[];
  nonGoals: string[];
  budget: number; // in USD
  spent: number;  // in USD
}

export interface ModePolicy {
  id: string;
  name: string;
  intent: 'code';
  instructions: string;
  allowedTools: ToolName[];
}

// Persisted task status
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type HarnessStatus = 'idle' | 'running' | 'paused' | 'awaiting_input' | 'awaiting_approval' | 'success' | 'failed' | 'gave_up';
export type HumanApprovalPolicy = 'ask' | 'auto';
export type ToolName =
  | 'repo_search'
  | 'symbol_search'
  | 'read_file'
  | 'read_range'
  | 'write_file'
  | 'apply_patch'
  | 'run_command'
  | 'run_tests'
  | 'browser_validate'
  | 'browser_inspect'
  | 'browser_action'
  | 'computer_inspect'
  | 'computer_action'
  | 'get_diff'
  | 'update_tasks'
  | 'update_plan'
  | 'record_evidence'
  | 'ask_user'
  | 'declare_success';

export interface ClarificationRequest {
  id: string;
  question: string;
  uncertainty: string;
  options: string[];
  recommendedAnswer?: string;
  status: 'pending' | 'answered';
  answer?: string;
  role: string;
  taskId: string;
  askedAt: string;
  answeredAt?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  dependencies: string[];
  blockers: string[];
  owner: string; // 'Orchestrator' | 'Architect' | 'Editor' | 'Reviewer' | 'Explorer' | 'Escalation'
}

export interface TaskGraph {
  tasks: TaskItem[];
}

export interface EvidenceLedgerItem {
  id: string;
  stepTitle: string;
  command?: string;
  observation: string;
  diff?: string; // Unified diff format
  testResult?: {
    pass: boolean;
    summary: string;
    details?: string;
  };
  confidence: number; // 0 to 100
  timestamp: string;
}

export interface ToolProposal {
  name: ToolName;
  arguments: Record<string, any>;
}

export interface HumanApprovalRecord {
  id: string;
  sessionId: string;
  taskId: string;
  taskTitle: string;
  role: string;
  proposal: ToolProposal;
  proposalDigest: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface RepositoryKnowledge {
  ruleFile: string; // e.g. AGENTS.md
  commandsFile: string; // build, test, lint commands
  architectureFile: string; // overview
}

export interface ProjectAdapterState {
  version: 1;
  id: string;
  ecosystem: 'node' | 'python' | 'rust' | 'go' | 'unknown';
  manifest?: string;
  packageManager?: string;
  detectedAt: string;
  fingerprint: string;
  evidence: string[];
  commands: Record<'test' | 'lint' | 'typecheck' | 'build', { kind: 'test' | 'lint' | 'typecheck' | 'build'; command?: string; required: boolean; source: string }>;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  workflow: string[];
  category?: string;
  triggerTokens?: string[];
  confidence?: number;
  occurrences?: number;
  successfulRuns?: number;
  useCount?: number;
  sourceSessionIds?: string[];
  appliedSessionIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  language: string;
}

export interface FirewallAction {
  stage: 'PROPOSE' | 'VALIDATE' | 'COMMIT' | 'NARRATE' | 'IDLE';
  timestamp: string;
  details: string;
  modelResponse?: string;
  isValidated?: boolean;
  validationReason?: string;
  proposalToolCall?: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface StepLog {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'proposal' | 'validation' | 'commit' | 'narration' | 'oracle';
  message: string;
  timestamp: string;
  subAgent?: string;
}

export type RunProgressKind =
  | 'run_started'
  | 'step_started'
  | 'provider_wait'
  | 'proposal'
  | 'validation'
  | 'tool_started'
  | 'tool_finished'
  | 'oracle'
  | 'reflection'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'paused'
  | 'resumed'
  | 'terminal';

export interface RunProgressEvent {
  id: string;
  sequence: number;
  sessionId: string;
  stepIndex: number;
  kind: RunProgressKind;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'warning' | 'info';
  summary: string;
  detail?: string;
  role: string;
  taskId?: string;
  taskTitle?: string;
  phase: FirewallAction['stage'];
  toolName?: ToolName;
  timestamp: string;
}

export interface ReflectionEntry {
  id: string;
  trigger: 'firewall' | 'tool_failure' | 'red_oracle';
  taskId: string;
  taskTitle: string;
  details: string;
  timestamp: string;
}

export interface OracleFailureEntry {
  id: string;
  signature: string;
  kind: 'test' | 'lint' | 'typecheck' | 'build';
  category: 'missing_test_contract' | 'test_failure' | 'lint_failure' | 'typecheck_failure' | 'build_failure';
  command?: string;
  source: string;
  required: boolean;
  status: 'open' | 'resolved';
  occurrences: number;
  taskId: string;
  taskTitle: string;
  role: string;
  outputExcerpt: string;
  guidance: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface DiffReviewEntry {
  id: string;
  reviewer: string;
  status: 'approved' | 'no_changes' | 'blocked';
  summary: string;
  diffExcerpt: string;
  timestamp: string;
}

export interface ReviewerCritiqueEntry {
  id: string;
  reviewer: string;
  modelId: string;
  source: 'model' | 'deterministic';
  status: 'approved' | 'no_changes' | 'blocked';
  summary: string;
  concerns: string[];
  diffExcerpt: string;
  timestamp: string;
}

export interface PreCommitReviewEntry {
  id: string;
  reviewer: string;
  modelId: string;
  source: 'model' | 'deterministic';
  status: 'approved' | 'blocked';
  proposalName: ToolName;
  protectedPaths: string[];
  summary: string;
  concerns: string[];
  timestamp: string;
}

export interface EscalationEntry {
  id: string;
  reason: string;
  fromRole: string;
  toModel: string;
  reflectionAttempts: number;
  timestamp: string;
}

export type BlockerSource = 'provider' | 'schema' | 'clarification' | 'firewall' | 'precommit' | 'tool' | 'oracle' | 'budget' | 'progress' | 'step_cap';
export type BlockerCategory = 'provider' | 'schema' | 'clarification' | 'workflow_gate' | 'role_capability' | 'workspace_scope' | 'command_policy' | 'network_policy' | 'patch_format' | 'patch_applicability' | 'firewall' | 'precommit_review' | 'worker_process' | 'tool_failure' | 'oracle' | 'budget' | 'no_progress' | 'step_cap';

export interface BlockerEntry {
  id: string;
  source: BlockerSource;
  category: BlockerCategory;
  status: 'open' | 'resolved' | 'terminal';
  retryable: boolean;
  taskId: string;
  taskTitle: string;
  role: string;
  summary: string;
  suggestedAction: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface ContextBundle {
  generatedAt: string;
  goal: string;
  activeTask?: string;
  openTasks: string[];
  recentFiles: string[];
  retrievalCandidates: RetrievalCandidate[];
  recentReflections: string[];
  recentEscalations: string[];
  recentReviews: string[];
  recentBlockers: string[];
  recentLessons?: string[];
  scratchpadSummary: string;
  retrievalPolicy: string[];
  tokenEstimate: number;
  compacted: boolean;
  promptCharBudget: number;
  promptChars: number;
  promptTokenEstimate: number;
  includedSections: string[];
  clearedSections: string[];
  truncatedSections: string[];
  droppedChars: number;
  compactionReason?: string;
}

export interface AarTriggerCounts {
  reflectionAttempts: number;
  reflectionSuppressed: number;
  escalations: number;
  budgetHalts: number;
  preCommitBlocks: number;
  validationFailures: number;
  providerFailures: number;
  repairAttempts: number;
  safetyReverts: number;
  noProgressTurns: number;
  blockerEvents: number;
  terminalBlockers: number;
}

export interface LessonEntry {
  signature: string;
  category: string;
  lesson: string;
  terminalStatus: string;
  goal: string;
  sessionId: string;
  recordedAt: string;
  occurrences: number;
}

export interface AarReport {
  generatedAt: string;
  sessionId: string;
  goal: string;
  terminalStatus: string;
  haltReason?: string;
  steps: number;
  clean: boolean;
  triggers: AarTriggerCounts;
  sustain: string[];
  improveWork: string[];
  improveTools: string[];
  lessonsBanked: string[];
  skillsBanked?: string[];
}

export type WorkflowLane = 'full' | 'light';
export type WorkflowStageId = 'classify' | 'plan' | 'baseline' | 'reconcile' | 'document_plan' | 'implement' | 'validate' | 'review' | 'document_close' | 'aar' | 'complete';

export interface WorkflowStageRecord {
  id: WorkflowStageId;
  status: 'pending' | 'completed' | 'blocked' | 'skipped';
  completedAt?: string;
  evidence: string[];
}

export interface WorkflowBaseline {
  capturedAt: string;
  workspaceRoot: string;
  packageVersion: string;
  gitHead: string;
  gitStatus: string[];
  fileCount: number;
  existingForgeState: boolean;
  rollbackMethod: string;
}

export interface WorkflowAcceptanceContract {
  boundedUnit: string;
  assumptions: string[];
  inScope: string[];
  outOfScope: string[];
  risks: string[];
  rollbackMethod: string;
  acceptanceCriteria: string[];
  requiredValidation: string[];
  negativePaths: string[];
  evidenceArtifacts: string[];
}

export interface WorkflowViolation {
  timestamp: string;
  stage: WorkflowStageId;
  proposalName: ToolName;
  reason: string;
}

export interface WorkflowGovernance {
  version: 1;
  lane: WorkflowLane;
  laneReason: string;
  currentStage: WorkflowStageId;
  stages: WorkflowStageRecord[];
  acceptance: WorkflowAcceptanceContract;
  baseline: WorkflowBaseline;
  violations: WorkflowViolation[];
  capabilityMapDelta: string;
  finalStatus?: 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'BLOCKED' | 'REVERTED';
  generatedAt: string;
  updatedAt: string;
}

export interface RetrievalCandidate {
  path: string;
  score: number;
  reason: string;
  language: string;
  semanticScore?: number;
  source?: 'deterministic' | 'hybrid';
}

export interface SemanticRetrievalState {
  generatedAt: string;
  status: 'ready' | 'disabled' | 'failed';
  provider: string;
  modelId: string;
  query: string;
  cacheHits: number;
  embeddedDocuments: number;
  candidates: Array<{ path: string; similarity: number }>;
  error?: string;
}

export interface WorkerEditTransaction {
  id: string;
  role: string;
  proposalName: 'apply_patch' | 'write_file';
  targetPath: string;
  mode: 'git-worktree' | 'sparse-copy';
  sourceHashBefore: string;
  sourceHashAtMerge: string;
  stagedHash: string;
  baseCommit: string | null;
  committed: boolean;
  conflict: boolean;
  cleanupSucceeded: boolean;
  workerPid: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: string;
}

export interface WorkerCommandTransaction {
  id: string;
  role: string;
  command: string;
  mode: 'git-worktree' | 'workspace-copy';
  baseCommit: string | null;
  changedFiles: string[];
  created: string[];
  modified: string[];
  deleted: string[];
  mergedFileCount: number;
  mergedBytes: number;
  committed: boolean;
  conflict: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  cleanupSucceeded: boolean;
  workerPid: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: string;
}

export interface RoleHandoff {
  role: string;
  generatedAt: string;
  allowedTools: ToolName[];
  responsibilities: string[];
  openTasks: string[];
  recentContext: string[];
  handoffSummary: string;
}

export interface WorkerContext {
  role: string;
  sessionId: string;
  allowedTools: ToolName[];
  createdAt: string;
  updatedAt: string;
  providerCalls: number;
  acceptedProposals: number;
  rejectedProposals: number;
  processExecutions: number;
  processFailures: number;
  lastWorkerPid: number | null;
  lastWorkerDurationMs: number;
  lastWorkerBlockedEnvKeys: string[];
  recentTools: ToolName[];
  lastTaskId: string;
  lastTaskTitle: string;
}

export interface ArchitectHandoff {
  generatedAt: string;
  sourceTaskId: string;
  sourceTaskTitle: string;
  planMd: string;
  focusFiles: string[];
  premiseChecks: string[];
  orderedSteps: string[];
}

export interface SafetyCheckpoint {
  id: string;
  strategy: 'targeted-files' | 'workspace-snapshot';
  proposalName: ToolName;
  protectedPaths: string[];
  manifestPath: string;
  timestamp: string;
}

export interface CheckpointRestoreEntry {
  id: string;
  checkpointId: string;
  strategy: 'targeted-files' | 'workspace-snapshot';
  protectedPaths: string[];
  status: 'restored' | 'failed';
  invalidatedEvidence: number;
  invalidatedDiffReviews: number;
  invalidatedOracleFailures: number;
  invalidatedAar: boolean;
  restoredAt: string;
  error?: string;
}

export interface BrowserValidationEvidence {
  id: string;
  status: 'pass' | 'fail';
  requestedUrl: string;
  finalUrl: string;
  title: string;
  expectedText?: string;
  expectedTextFound?: boolean;
  visibleTextExcerpt: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  screenshotPath?: string;
  reportPath: string;
  browserExecutable?: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  failureReason?: string;
}

export interface BrowserInteractionEvidence {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  status: 'ready' | 'consumed' | 'failed';
  url: string;
  title: string;
  visibleTextExcerpt: string;
  targets: Array<{ id: string; role: string; name: string; ordinal: number; tag: string; inputType?: string; disabled: boolean }>;
  screenshotPath: string;
  reportPath: string;
  createdAt: string;
  consumedAt?: string;
  action?: { kind: 'click' | 'fill' | 'press' | 'select' | 'wait'; targetId?: string; value?: string; key?: string };
  previousStateId?: string;
  failureReason?: string;
}

export interface ComputerInteractionEvidence {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  status: 'ready' | 'consumed' | 'failed';
  windowTitle: string;
  targets: Array<{ id: string; name: string; controlType: string; automationId: string; className: string; ordinal: number; enabled: boolean; patterns: string[] }>;
  screenshotPath: string;
  reportPath: string;
  createdAt: string;
  consumedAt?: string;
  previousStateId?: string;
  action?: { kind: 'invoke' | 'set_value' | 'focus'; targetId: string; value?: string };
  failureReason?: string;
}

export interface CommandSideEffectEntry {
  id: string;
  command: string;
  created: string[];
  modified: string[];
  deleted: string[];
  unchangedCount: number;
  sandbox: CommandExecutionMetadata;
  outputExcerpt: string;
  timestamp: string;
  transactionId?: string;
  transactionMode?: WorkerCommandTransaction['mode'];
}

export interface CommandExecutionMetadata {
  cwd: string;
  timeoutMs: number;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  sanitizedEnv: boolean;
  inheritedEnvKeyCount: number;
  allowedEnvKeys: string[];
  blockedEnvKeys: string[];
  network: import('./commandNetwork').CommandNetworkIntent;
}

export interface RunBudget {
  startedAt: string;
  maxWallClockMs: number;
  maxCostUsd: number;
  lastCheckedAt: string;
  haltReason?: 'wall_clock_exceeded' | 'cost_exceeded';
}

export interface RunStats {
  providerCalls: number;
  providerFailures: number;
  fallbackProposals: number;
  modelDrivenProposals: number;
  fallbackActions: number;
  repairAttempts: number;
  schemaFailures: number;
  validationFailures: number;
  reflectionAttempts: number;
  firewallReflections: number;
  toolFailureReflections: number;
  oracleReflections: number;
  diffReviewAttempts: number;
  reviewerApprovals: number;
  reviewerCritiques: number;
  reviewerModelCritiques: number;
  preCommitReviews: number;
  preCommitModelReviews: number;
  preCommitBlocks: number;
  escalationCount: number;
  contextRefreshes: number;
  roleHandoffRefreshes: number;
  retrievalRefreshes: number;
  contextCompactions: number;
  toolResultSectionsCleared: number;
  safetyCheckpoints: number;
  safetyReverts: number;
  commandEffectCaptures: number;
  commandCreatedFiles: number;
  commandModifiedFiles: number;
  commandDeletedFiles: number;
  networkIntentCaptures: number;
  networkWriteBlocks: number;
  roleCapabilityBlocks: number;
  workerProcessExecutions: number;
  workerProcessFailures: number;
  blockerEvents: number;
  openBlockers: number;
  resolvedBlockers: number;
  semanticRefreshes: number;
  semanticFailures: number;
  semanticCacheHits: number;
  semanticEmbeddedDocuments: number;
  editTransactions: number;
  editTransactionConflicts: number;
  worktreeEditTransactions: number;
  sparseEditTransactions: number;
  skillRetrievals: number;
  skillApplications: number;
  workflowGateBlocks: number;
  clarificationRequests: number;
  clarificationAnswers: number;
  clarificationGateBlocks: number;
  humanApprovalRequests: number;
  humanApprovalApprovals: number;
  humanApprovalRejections: number;
  oracleFailureCaptures: number;
  repeatedOracleFailures: number;
  oracleFailureResolutions: number;
  remediationGuidanceInjections: number;
  oracleStagnationHalts: number;
  checkpointRestores: number;
  checkpointRestoreFailures: number;
  browserValidations: number;
  browserValidationFailures: number;
  browserInspections: number;
  browserActions: number;
  browserInteractionFailures: number;
  computerInspections: number;
  computerActions: number;
  computerInteractionFailures: number;
  progressEventsEmitted: number;
  commandTransactions: number;
  commandTransactionConflicts: number;
  commandTransactionMergedFiles: number;
  commandTransactionRollbacks: number;
  budgetHalts: number;
  noProgressTurns: number;
  lastProgressSignature: string;
  actuallyModelDriven: boolean;
  reflectionSuppressed?: number;
  pathRepairs?: number;
  malformedPatchStreak?: number;
  wholeFileGuidanceInjections?: number;
}

// Full execution context representing the overall harness state
export interface HarnessState {
  sessionId: string;
  goalContract: GoalContract;
  taskGraph: TaskGraph;
  planMd: string;
  scratchpadMd: string;
  evidenceLedger: EvidenceLedgerItem[];
  knowledge: RepositoryKnowledge;
  projectAdapter: ProjectAdapterState;
  skills: SkillItem[];
  files: Record<string, WorkspaceFile>;
  userContext?: import('./composerContext').ComposerContextAttachment[];
  firewall: FirewallAction;
  logs: StepLog[];
  reflections: ReflectionEntry[];
  diffReviews: DiffReviewEntry[];
  reviewerCritiques: ReviewerCritiqueEntry[];
  preCommitReviews: PreCommitReviewEntry[];
  escalations: EscalationEntry[];
  blockers: BlockerEntry[];
  semanticRetrieval: SemanticRetrievalState;
  workerEditTransactions: WorkerEditTransaction[];
  workerCommandTransactions: WorkerCommandTransaction[];
  clarifications: ClarificationRequest[];
  humanApprovalPolicy: HumanApprovalPolicy;
  pendingHumanApproval?: HumanApprovalRecord;
  humanApprovals: HumanApprovalRecord[];
  oracleFailures: OracleFailureEntry[];
  workflow: WorkflowGovernance;
  contextBundle: ContextBundle;
  roleHandoffs: Record<string, RoleHandoff>;
  workerContexts: Record<string, WorkerContext>;
  architectHandoff?: ArchitectHandoff;
  safetyCheckpoints: SafetyCheckpoint[];
  checkpointRestores: CheckpointRestoreEntry[];
  browserValidations: BrowserValidationEvidence[];
  browserInteractions: BrowserInteractionEvidence[];
  computerInteractions: ComputerInteractionEvidence[];
  progressEvents: RunProgressEvent[];
  modePolicy?: ModePolicy;
  commandEffects: CommandSideEffectEntry[];
  runBudget: RunBudget;
  runStats: RunStats;
  currentStepIndex: number;
  maxSteps: number;
  reflectionEnabled?: boolean;
  aar?: AarReport;
  status: HarnessStatus;
  haltReason?: string;
  lastOraclePass?: boolean;
  checkpointId?: string;
  activeSubAgent: string;
  activeFilePath: string;
  oracleStatuses: {
    linter: 'pass' | 'fail' | 'skipped' | 'unchecked';
    compiler: 'pass' | 'fail' | 'skipped' | 'unchecked';
    tests: 'pass' | 'fail' | 'unchecked';
    build: 'pass' | 'fail' | 'skipped' | 'unchecked';
  };
}

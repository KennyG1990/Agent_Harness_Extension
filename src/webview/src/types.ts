export interface GoalContract {
  goal: string;
  context: string;
  constraints: string[];
  doneWhen: string[];
  nonGoals: string[];
  budget: number; // in USD
  spent: number;  // in USD
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type HarnessStatus = 'idle' | 'running' | 'paused' | 'awaiting_input' | 'awaiting_approval' | 'success' | 'failed' | 'gave_up';
export type HumanApprovalPolicy = 'ask' | 'auto';
export type AssuranceLevel = 'standard' | 'verified' | 'audited';

export interface ExecutionContract {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  revision: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'superseded';
  authority: {
    assurance: AssuranceLevel;
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
    nonGoals: string[];
    workspaceScopes: string[];
    allowedTools: string[];
    expectedFiles: string[];
    requiredOracles: string[];
    budget: { maxCostUsd: number; maxWallClockMs: number; maxSteps: number };
    modelBindings: Record<string, string>;
    approvalPolicy: HumanApprovalPolicy;
    requirements: Record<string, boolean>;
  };
  availability: { available: boolean; missing: string[] };
  digest: string;
  compiledAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
  supersededAt?: string;
  revisionReason?: string;
}

export interface HumanApprovalRecord {
  id: string;
  taskTitle: string;
  role: string;
  proposal: { name: string; arguments: Record<string, unknown> };
  proposalDigest: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  decisionReason?: string;
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

export interface RepositoryKnowledge {
  ruleFile: string; // e.g. AGENTS.md
  commandsFile: string; // build, test, lint commands
  architectureFile: string; // overview
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  workflow: string[];
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

export interface RunProgressEvent {
  id: string;
  sequence: number;
  sessionId: string;
  stepIndex: number;
  kind: 'run_started' | 'step_started' | 'provider_wait' | 'proposal' | 'validation' | 'tool_started' | 'tool_finished' | 'oracle' | 'reflection' | 'awaiting_input' | 'awaiting_approval' | 'paused' | 'resumed' | 'terminal';
  status: 'pending' | 'running' | 'pass' | 'fail' | 'warning' | 'info';
  summary: string;
  detail?: string;
  role: string;
  taskId?: string;
  taskTitle?: string;
  phase: FirewallAction['stage'];
  toolName?: string;
  timestamp: string;
}

export interface ProviderReadiness {
  provider: 'openrouter' | 'openai-compatible';
  ready: boolean;
  workspaceOpen: boolean;
  credential: { required: boolean; configured: boolean; source: 'secret-storage' | 'environment' | 'not-required' | 'none'; valid: boolean | null };
  authentication: { status: 'pass' | 'fail' | 'skipped'; latencyMs: number };
  catalog: { status: 'live' | 'fallback' | 'error'; modelCount: number };
  blockers: Array<{ code: string; message: string }>;
  checkedAt: string;
}

export interface WorkspaceIndexStatus {
  status: 'missing' | 'building' | 'ready' | 'stale' | 'error';
  fileCount: number;
  symbolCount: number;
  ignoredCount: number;
  truncated: boolean;
  generatedAt?: string;
  fingerprint?: string;
  error?: string;
}

export interface ComposerContextSummary {
  id: string;
  kind: 'file' | 'folder' | 'selection' | 'diagnostics' | 'symbol' | 'image';
  label: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  diagnosticCount?: number;
  symbolName?: string;
  neighborPaths?: string[];
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256?: string;
  byteCount: number;
  capturedAt: string;
}

export interface WorkspaceMentionCandidate {
  kind: 'file' | 'folder' | 'symbol';
  path: string;
  label: string;
  detail: string;
  symbolName?: string;
  line?: number;
  symbolKind?: string;
}

export interface AgentMode {
  id: string;
  name: string;
  description: string;
  instructions: string;
  intent: 'code' | 'architect' | 'ask' | 'review';
  modelRole: 'code' | 'plan' | 'review';
  inference: 'Instant' | 'Thinking';
  allowedTools: string[];
  builtIn: boolean;
}

export interface SessionSummary {
  sessionId: string;
  kind: 'run' | 'chat';
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  status: string;
  steps: number;
  costUsd: number;
  resumable: boolean;
}

export interface ReflectionEntry {
  id: string;
  trigger: 'firewall' | 'tool_failure' | 'red_oracle';
  taskId: string;
  taskTitle: string;
  details: string;
  timestamp: string;
}

export interface DiffReviewEntry {
  id: string;
  reviewer: string;
  status: 'approved' | 'no_changes' | 'blocked';
  summary: string;
  diffExcerpt: string;
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

export interface RunBudget {
  startedAt: string;
  maxWallClockMs: number;
  maxCostUsd: number;
  lastCheckedAt: string;
  haltReason?: 'wall_clock_exceeded' | 'cost_exceeded';
}

export interface ContextBundle {
  generatedAt: string;
  goal: string;
  activeTask?: string;
  openTasks: string[];
  recentFiles: string[];
  recentReflections: string[];
  recentEscalations: string[];
  recentReviews: string[];
  recentBlockers?: string[];
  scratchpadSummary: string;
  retrievalPolicy: string[];
  tokenEstimate: number;
  compacted: boolean;
  promptCharBudget?: number;
  promptChars?: number;
  promptTokenEstimate?: number;
  includedSections?: string[];
  clearedSections?: string[];
  truncatedSections?: string[];
  droppedChars?: number;
  compactionReason?: string;
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
  escalationCount: number;
  contextRefreshes: number;
  contextCompactions?: number;
  toolResultSectionsCleared?: number;
  networkIntentCaptures?: number;
  networkWriteBlocks?: number;
  roleCapabilityBlocks?: number;
  workerProcessExecutions?: number;
  workerProcessFailures?: number;
  blockerEvents?: number;
  openBlockers?: number;
  resolvedBlockers?: number;
  semanticRefreshes?: number;
  semanticFailures?: number;
  semanticCacheHits?: number;
  semanticEmbeddedDocuments?: number;
  editTransactions?: number;
  editTransactionConflicts?: number;
  worktreeEditTransactions?: number;
  sparseEditTransactions?: number;
  commandTransactions?: number;
  commandTransactionConflicts?: number;
  commandTransactionMergedFiles?: number;
  commandTransactionRollbacks?: number;
  skillRetrievals?: number;
  skillApplications?: number;
  workflowGateBlocks?: number;
  oracleFailureCaptures?: number;
  repeatedOracleFailures?: number;
  oracleFailureResolutions?: number;
  remediationGuidanceInjections?: number;
  oracleStagnationHalts?: number;
  checkpointRestores?: number;
  checkpointRestoreFailures?: number;
  humanApprovalRequests?: number;
  humanApprovalApprovals?: number;
  humanApprovalRejections?: number;
  browserValidations?: number;
  browserValidationFailures?: number;
  browserInspections?: number;
  browserActions?: number;
  browserInteractionFailures?: number;
  computerInspections?: number;
  computerActions?: number;
  computerInteractionFailures?: number;
  progressEventsEmitted?: number;
  budgetHalts: number;
  noProgressTurns: number;
  lastProgressSignature: string;
  actuallyModelDriven: boolean;
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
  proposalName: string;
  protectedPaths: string[];
  manifestPath: string;
  timestamp: string;
}

export interface BrowserValidationEvidence {
  id: string;
  status: 'pass' | 'fail';
  requestedUrl: string;
  finalUrl: string;
  title: string;
  expectedText?: string;
  expectedTextFound?: boolean;
  screenshotPath?: string;
  reportPath: string;
  failureReason?: string;
  completedAt: string;
}

// Full execution context that represents the overall harness state
export interface HarnessState {
  sessionId?: string;
  executionContract: ExecutionContract;
  executionContractHistory: ExecutionContract[];
  goalContract: GoalContract;
  taskGraph: TaskGraph;
  planMd: string;
  scratchpadMd: string;
  evidenceLedger: EvidenceLedgerItem[];
  knowledge: RepositoryKnowledge;
  projectAdapter?: { ecosystem: string; packageManager?: string; manifest?: string };
  skills: SkillItem[];
  files: Record<string, WorkspaceFile>;
  firewall: FirewallAction;
  logs: StepLog[];
  reflections?: ReflectionEntry[];
  diffReviews?: DiffReviewEntry[];
  escalations?: EscalationEntry[];
  contextBundle?: ContextBundle;
  architectHandoff?: ArchitectHandoff;
  safetyCheckpoints?: SafetyCheckpoint[];
  checkpointRestores?: Array<{ checkpointId: string; status: 'restored' | 'failed'; restoredAt: string }>;
  browserValidations?: BrowserValidationEvidence[];
  browserInteractions?: Array<{ id: string; status: 'ready' | 'consumed' | 'failed'; screenshotPath: string; failureReason?: string }>;
  computerInteractions?: Array<{ id: string; status: 'ready' | 'consumed' | 'failed'; screenshotPath: string; failureReason?: string }>;
  humanApprovalPolicy?: HumanApprovalPolicy;
  pendingHumanApproval?: HumanApprovalRecord;
  humanApprovals?: HumanApprovalRecord[];
  progressEvents?: RunProgressEvent[];
  modePolicy?: { id: string; name: string; intent: 'code'; instructions: string; allowedTools: string[] };
  workflow?: {
    lane: 'full' | 'light';
    currentStage: string;
    finalStatus?: string;
    violations: Array<{ reason: string }>;
  };
  runBudget?: RunBudget;
  runStats?: RunStats;
  currentStepIndex: number;
  maxSteps: number;
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

export interface SandboxTaskTemplate {
  name: string;
  description: string;
  goal: string;
  files: Record<string, WorkspaceFile>;
  expectedOutputPrefix?: string;
  doneWhen: string[];
  constraints: string[];
  knowledge: RepositoryKnowledge;
  testSuite: {
    run: (files: Record<string, WorkspaceFile>) => { pass: boolean; summary: string; details: string };
  };
}

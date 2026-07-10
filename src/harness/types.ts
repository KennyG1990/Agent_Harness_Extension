export interface GoalContract {
  goal: string;
  context: string;
  constraints: string[];
  doneWhen: string[];
  nonGoals: string[];
  budget: number; // in USD
  spent: number;  // in USD
}

// Persisted task status
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type HarnessStatus = 'idle' | 'running' | 'paused' | 'success' | 'failed' | 'gave_up';
export type ToolName =
  | 'repo_search'
  | 'symbol_search'
  | 'read_file'
  | 'read_range'
  | 'write_file'
  | 'apply_patch'
  | 'run_command'
  | 'run_tests'
  | 'get_diff'
  | 'update_tasks'
  | 'update_plan'
  | 'record_evidence'
  | 'declare_success';

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
  recentLessons?: string[];
  scratchpadSummary: string;
  retrievalPolicy: string[];
  tokenEstimate: number;
  compacted: boolean;
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
}

export interface RetrievalCandidate {
  path: string;
  score: number;
  reason: string;
  language: string;
}

export interface RoleHandoff {
  role: string;
  generatedAt: string;
  allowedTools: string[];
  responsibilities: string[];
  openTasks: string[];
  recentContext: string[];
  handoffSummary: string;
}

export interface SafetyCheckpoint {
  id: string;
  strategy: 'targeted-files' | 'workspace-snapshot';
  proposalName: ToolName;
  protectedPaths: string[];
  manifestPath: string;
  timestamp: string;
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
  safetyCheckpoints: number;
  safetyReverts: number;
  commandEffectCaptures: number;
  commandCreatedFiles: number;
  commandModifiedFiles: number;
  commandDeletedFiles: number;
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
  skills: SkillItem[];
  files: Record<string, WorkspaceFile>;
  firewall: FirewallAction;
  logs: StepLog[];
  reflections: ReflectionEntry[];
  diffReviews: DiffReviewEntry[];
  reviewerCritiques: ReviewerCritiqueEntry[];
  preCommitReviews: PreCommitReviewEntry[];
  escalations: EscalationEntry[];
  contextBundle: ContextBundle;
  roleHandoffs: Record<string, RoleHandoff>;
  safetyCheckpoints: SafetyCheckpoint[];
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
    linter: 'pass' | 'fail' | 'unchecked';
    compiler: 'pass' | 'fail' | 'unchecked';
    tests: 'pass' | 'fail' | 'unchecked';
  };
}

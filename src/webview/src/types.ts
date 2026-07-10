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
export type HarnessStatus = 'idle' | 'running' | 'paused' | 'success' | 'failed' | 'gave_up';

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
  scratchpadSummary: string;
  retrievalPolicy: string[];
  tokenEstimate: number;
  compacted: boolean;
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
  budgetHalts: number;
  noProgressTurns: number;
  lastProgressSignature: string;
  actuallyModelDriven: boolean;
}

// Full execution context that represents the overall harness state
export interface HarnessState {
  sessionId?: string;
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
  reflections?: ReflectionEntry[];
  diffReviews?: DiffReviewEntry[];
  escalations?: EscalationEntry[];
  contextBundle?: ContextBundle;
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
    linter: 'pass' | 'fail' | 'unchecked';
    compiler: 'pass' | 'fail' | 'unchecked';
    tests: 'pass' | 'fail' | 'unchecked';
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

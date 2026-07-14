import * as crypto from 'crypto';
import { ComposerContextAttachment } from './composerContext';
import { GoalContract, HarnessState, HumanApprovalPolicy, ModePolicy, ProjectAdapterState, RunBudget, ToolName, WorkflowGovernance } from './types';

export type AssuranceLevel = 'standard' | 'verified' | 'audited';
export type ExecutionContractStatus = 'pending' | 'confirmed' | 'rejected' | 'superseded';

export interface AssuranceRequirements {
  explicitConfirmation: boolean;
  modelDrivenCompletion: boolean;
  fallbackFreeCompletion: boolean;
  independentReview: boolean;
  compositeOracle: boolean;
  signedAttestation: boolean;
  oracleCalibration: boolean;
  provenIsolation: boolean;
}

export interface ExecutionContractAuthority {
  assurance: AssuranceLevel;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  nonGoals: string[];
  workspaceScopes: string[];
  allowedTools: ToolName[];
  expectedFiles: string[];
  requiredOracles: string[];
  budget: {
    maxCostUsd: number;
    maxWallClockMs: number;
    maxSteps: number;
  };
  modelBindings: Record<string, string>;
  approvalPolicy: HumanApprovalPolicy;
  customizationDigest?: string;
  requirements: AssuranceRequirements;
}

export interface AssuranceAvailability {
  available: boolean;
  missing: string[];
}

export interface ExecutionContractV1 {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  revision: number;
  digest: string;
  status: ExecutionContractStatus;
  authority: ExecutionContractAuthority;
  availability: AssuranceAvailability;
  compiledAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
  supersededAt?: string;
  revisionReason?: string;
}

export interface CompileExecutionContractOptions {
  sessionId: string;
  assurance?: AssuranceLevel;
  goalContract: GoalContract;
  workflow: WorkflowGovernance;
  modePolicy?: ModePolicy;
  userContext?: ComposerContextAttachment[];
  projectAdapter: ProjectAdapterState;
  runBudget: RunBudget;
  maxSteps: number;
  modelBindings?: Record<string, string>;
  humanApprovalPolicy: HumanApprovalPolicy;
  customizationDigest?: string;
  auditedCapabilities?: {
    provenIsolation?: boolean;
    oracleCalibration?: boolean;
    signedAttestation?: boolean;
  };
  previous?: ExecutionContractV1;
  revisionReason?: string;
}

const ALL_TOOLS: ToolName[] = [
  'repo_search', 'symbol_search', 'read_file', 'read_range', 'write_file', 'apply_patch', 'run_command', 'run_tests',
  'browser_validate', 'browser_inspect', 'browser_action', 'computer_inspect', 'computer_action', 'external_tool',
  'get_diff', 'update_tasks', 'update_plan', 'record_evidence', 'ask_user', 'declare_success'
];

export function normalizeAssuranceLevel(value: unknown): AssuranceLevel {
  return value === 'verified' || value === 'audited' ? value : 'standard';
}

export function assuranceRequirements(level: AssuranceLevel): AssuranceRequirements {
  const verified = level === 'verified' || level === 'audited';
  return {
    explicitConfirmation: verified,
    modelDrivenCompletion: verified,
    fallbackFreeCompletion: verified,
    independentReview: verified,
    compositeOracle: true,
    signedAttestation: level === 'audited',
    oracleCalibration: level === 'audited',
    provenIsolation: level === 'audited'
  };
}

export function compileExecutionContract(options: CompileExecutionContractOptions): ExecutionContractV1 {
  const assurance = normalizeAssuranceLevel(options.assurance);
  const requirements = assuranceRequirements(assurance);
  const scopes = normalizeScopes(options.userContext || []);
  const expectedFiles = normalizeStrings((options.userContext || [])
    .filter(item => item.kind !== 'diagnostics' && item.kind !== 'image' && Boolean(item.path))
    .map(item => String(item.path)));
  const requiredOracles = normalizeStrings([
    ...(Array.isArray(options.goalContract.doneWhen) ? options.goalContract.doneWhen : []),
    ...Object.values(options.projectAdapter.commands || {})
      .filter(command => command.required)
      .map(command => `${command.kind}: ${command.command || 'required but unavailable'}`)
  ]);
  const authority: ExecutionContractAuthority = {
    assurance,
    objective: boundedText(options.goalContract.goal, 20_000),
    constraints: normalizeStrings(options.goalContract.constraints),
    acceptanceCriteria: normalizeStrings(options.goalContract.doneWhen),
    nonGoals: normalizeStrings(options.goalContract.nonGoals),
    workspaceScopes: scopes,
    allowedTools: normalizeTools(options.modePolicy?.allowedTools || ALL_TOOLS),
    expectedFiles,
    requiredOracles,
    budget: {
      maxCostUsd: finiteNonNegative(options.runBudget.maxCostUsd, options.goalContract.budget),
      maxWallClockMs: finitePositive(options.runBudget.maxWallClockMs, 30 * 60 * 1000),
      maxSteps: finitePositive(options.maxSteps, 30)
    },
    modelBindings: normalizeBindings(options.modelBindings || {}),
    approvalPolicy: options.humanApprovalPolicy === 'auto' ? 'auto' : 'ask',
    ...(boundedToken(options.customizationDigest || '', 128) ? { customizationDigest: boundedToken(options.customizationDigest || '', 128) } : {}),
    requirements
  };
  const availability = assuranceAvailability(assurance, options.auditedCapabilities);
  const previous = options.previous;
  const revision = previous ? previous.revision + 1 : 1;
  const digest = executionContractDigest(authority);
  const widening = previous ? isAuthorityWidening(previous.authority, authority) : requirements.explicitConfirmation;
  const keepConfirmed = Boolean(previous && previous.status === 'confirmed' && !widening);
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: previous?.id || `execution-contract-${options.sessionId}`,
    sessionId: options.sessionId,
    revision,
    digest,
    status: keepConfirmed || (!previous && !requirements.explicitConfirmation) ? 'confirmed' : 'pending',
    authority,
    availability,
    compiledAt: now,
    confirmedAt: keepConfirmed ? previous?.confirmedAt : (!previous && !requirements.explicitConfirmation ? now : undefined),
    revisionReason: boundedText(options.revisionReason || (previous ? 'authority revised' : 'run initialized'), 500)
  };
}

export function executionContractDigest(authority: ExecutionContractAuthority): string {
  return crypto.createHash('sha256').update(canonicalJson(authority)).digest('hex');
}

export function decideExecutionContract(contract: ExecutionContractV1, decision: 'confirm' | 'reject', digest: string): ExecutionContractV1 {
  if (contract.status !== 'pending') throw new Error('Execution contract is not awaiting confirmation.');
  if (contract.digest !== String(digest || '')) throw new Error('Execution contract digest does not match the pending revision.');
  if (decision === 'confirm' && !contract.availability.available) throw new Error(`Execution contract assurance is unavailable: ${contract.availability.missing.join(', ')}.`);
  const now = new Date().toISOString();
  return decision === 'confirm'
    ? { ...contract, status: 'confirmed', confirmedAt: now, rejectedAt: undefined }
    : { ...contract, status: 'rejected', rejectedAt: now, confirmedAt: undefined };
}

export function isAuthorityWidening(previous: ExecutionContractAuthority, next: ExecutionContractAuthority): boolean {
  if (previous.objective !== next.objective) return true;
  if (assuranceRank(next.assurance) < assuranceRank(previous.assurance)) return true;
  if (next.budget.maxCostUsd > previous.budget.maxCostUsd || next.budget.maxWallClockMs > previous.budget.maxWallClockMs || next.budget.maxSteps > previous.budget.maxSteps) return true;
  if (previous.approvalPolicy === 'ask' && next.approvalPolicy === 'auto') return true;
  if ((previous.customizationDigest || '') !== (next.customizationDigest || '')) return true;
  if (!isSubset(next.allowedTools, previous.allowedTools)) return true;
  if (!isSubset(previous.acceptanceCriteria, next.acceptanceCriteria)) return true;
  if (!isSubset(previous.requiredOracles, next.requiredOracles)) return true;
  if (!isSubset(previous.nonGoals, next.nonGoals)) return true;
  if (!isScopeNarrowerOrEqual(next.workspaceScopes, previous.workspaceScopes)) return true;
  if (canonicalJson(previous.modelBindings) !== canonicalJson(next.modelBindings)) {
    // Standard preserves legacy callers that choose their initial model at the
    // first governed step. Once any binding exists, rebinding is authority
    // widening and always requires a new digest-bound confirmation.
    const standardInitialBinding = previous.assurance === 'standard'
      && Object.keys(previous.modelBindings).length === 0
      && Object.keys(next.modelBindings).length > 0;
    if (!standardInitialBinding) return true;
  }
  return false;
}

export function assuranceSuccessGate(state: HarnessState): { ready: boolean; missing: string[] } {
  const contract = state.executionContract;
  if (!contract || contract.status !== 'confirmed') return { ready: false, missing: ['confirmed execution contract'] };
  const missing: string[] = [];
  if (!contract.availability.available) missing.push(...contract.availability.missing);
  if (contract.authority.requirements.modelDrivenCompletion && state.runStats?.actuallyModelDriven !== true) missing.push('model-driven completion');
  if (contract.authority.requirements.fallbackFreeCompletion && Number(state.runStats?.fallbackActions || 0) > 0) missing.push('zero fallback actions');
  if (contract.authority.requirements.compositeOracle && state.lastOraclePass !== true) missing.push('green composite oracle');
  const changed = Number(state.runStats?.editTransactions || 0) > 0
    || Number(state.runStats?.commandTransactions || 0) > 0
    || Number(state.runStats?.subAgentMerges || 0) > 0;
  if (contract.authority.requirements.independentReview && changed) {
    const modelReview = (state.reviewerCritiques || []).some(review => review.source === 'model' && review.status === 'approved');
    const diffReview = (state.diffReviews || []).some(review => review.status === 'approved');
    if (!modelReview || !diffReview) missing.push('independent model and diff review');
  }
  if (contract.authority.requirements.provenIsolation && !contract.availability.available) missing.push('proven isolation');
  if (contract.authority.requirements.oracleCalibration && state.oracleCalibration?.available !== true) {
    missing.push(`oracle calibration evidence${state.oracleCalibration?.reason ? ` (${state.oracleCalibration.reason})` : ''}`);
  }
  // Signing occurs after terminal persistence in the trusted extension host.
  // Audited signing failures demote terminal success before it is returned.
  return { ready: missing.length === 0, missing: [...new Set(missing)] };
}

export function assuranceAvailability(level: AssuranceLevel, capabilities: CompileExecutionContractOptions['auditedCapabilities'] = {}): AssuranceAvailability {
  if (level !== 'audited') return { available: true, missing: [] };
  const missing: string[] = [];
  if (capabilities?.provenIsolation !== true) missing.push('proven OS/container isolation');
  if (capabilities?.oracleCalibration !== true) missing.push('oracle calibration');
  if (capabilities?.signedAttestation !== true) missing.push('signed attestation');
  return { available: missing.length === 0, missing };
}

function normalizeScopes(context: ComposerContextAttachment[]): string[] {
  const scopes = normalizeStrings(context.filter(item => item.path).map(item => item.kind === 'folder' ? `${item.path}/**` : String(item.path)));
  return scopes.length ? scopes : ['**'];
}

function normalizeTools(values: ToolName[]): ToolName[] {
  return [...new Set(values.filter(value => ALL_TOOLS.includes(value)))].sort() as ToolName[];
}

function normalizeBindings(bindings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(bindings)
    .map(([role, model]) => [boundedToken(role, 64), boundedToken(model, 200)] as const)
    .filter(([role, model]) => role && model)
    .sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeStrings(values: unknown[]): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map(value => boundedText(value, 2_000)).filter(Boolean))].sort();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSubset<T>(subset: T[], superset: T[]): boolean {
  const allowed = new Set(superset);
  return subset.every(item => allowed.has(item));
}

function isScopeNarrowerOrEqual(next: string[], previous: string[]): boolean {
  if (previous.includes('**')) return true;
  return next.every(scope => previous.some(parent => parent === scope || (parent.endsWith('/**') && scope.startsWith(parent.slice(0, -2)))));
}

function assuranceRank(level: AssuranceLevel): number {
  return level === 'audited' ? 3 : level === 'verified' ? 2 : 1;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function finitePositive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedText(value: unknown, max: number): string {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function boundedToken(value: unknown, max: number): string {
  return String(value || '').replace(/[^a-zA-Z0-9_./:@+-]/g, '_').slice(0, max);
}

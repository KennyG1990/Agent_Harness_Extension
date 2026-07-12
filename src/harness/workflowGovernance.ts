import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GoalContract, HarnessState, ToolProposal, WorkflowAcceptanceContract, WorkflowBaseline, WorkflowGovernance, WorkflowLane, WorkflowStageId } from './types';

const STAGE_ORDER: WorkflowStageId[] = ['classify', 'plan', 'baseline', 'reconcile', 'document_plan', 'implement', 'validate', 'review', 'document_close', 'aar', 'complete'];
const IMPLEMENTATION_TOOLS = new Set(['apply_patch', 'write_file', 'run_command']);

export function classifyWorkflowLane(goal: string): { lane: WorkflowLane; reason: string } {
  const normalized = String(goal || '').toLowerCase();
  const behavioral = /\b(code|bug|feature|implement|refactor|test|schema|api|endpoint|database|table|panel|dependency|security|permission|network|migration|runtime|command)\b/.test(normalized);
  const docOnly = /\b(doc|docs|documentation|readme|markdown|spelling|typo|wording|format text|rewrite text)\b/.test(normalized);
  if (docOnly && !behavioral) return { lane: 'light', reason: 'Goal is deterministically classified as documentation/text-only with no behavioral signal.' };
  return { lane: 'full', reason: behavioral ? 'Goal contains executable, behavioral, contract, or risk-bearing signals.' : 'Ambiguous goals default to the full governance lane.' };
}

export function createWorkflowGovernance(root: string, goalContract: GoalContract): WorkflowGovernance {
  const now = new Date().toISOString();
  const classification = classifyWorkflowLane(goalContract.goal);
  const baseline = captureWorkflowBaseline(root);
  const acceptance: WorkflowAcceptanceContract = {
    boundedUnit: goalContract.goal,
    assumptions: ['Current workspace and declared goal are the authoritative starting point.'],
    inScope: [goalContract.goal],
    outOfScope: goalContract.nonGoals,
    risks: ['Unvalidated workspace mutation', 'False success without green oracle evidence', 'Overwriting concurrent user changes'],
    rollbackMethod: baseline.rollbackMethod,
    acceptanceCriteria: goalContract.doneWhen,
    requiredValidation: ['deterministic firewall acceptance', 'run_tests green oracle', 'approved diff review when files change', 'evidence ledger entry'],
    negativePaths: ['workflow-order bypass is rejected', 'out-of-workspace and unsafe mutation is rejected', 'success while oracle is red is rejected'],
    evidenceArtifacts: ['.forge/workflow-governance.json', '.forge/workflow-task-record.md', '.forge/evidence-ledger.json', '.forge/diff-reviews.json']
  };
  const workflow: WorkflowGovernance = {
    version: 1,
    lane: classification.lane,
    laneReason: classification.reason,
    currentStage: 'reconcile',
    stages: STAGE_ORDER.map(id => ({ id, status: ['classify', 'plan', 'baseline'].includes(id) ? 'completed' : 'pending', completedAt: ['classify', 'plan', 'baseline'].includes(id) ? now : undefined, evidence: [] })),
    acceptance,
    baseline,
    violations: [],
    capabilityMapDelta: 'pending reconciliation',
    generatedAt: now,
    updatedAt: now
  };
  evidence(workflow, 'classify', `${classification.lane}: ${classification.reason}`);
  evidence(workflow, 'plan', `Acceptance contract created for bounded unit: ${goalContract.goal}`);
  evidence(workflow, 'baseline', `Baseline captured at ${baseline.capturedAt}; files=${baseline.fileCount}; git=${baseline.gitHead || 'unavailable'}.`);
  if (classification.lane === 'light') {
    complete(workflow, 'document_plan', 'Light lane uses the generated one-line acceptance plan.');
  }
  return workflow;
}

export function validateWorkflowProposal(state: HarnessState, proposal: ToolProposal): { valid: boolean; reason?: string } {
  const workflow = state.workflow;
  if (!workflow) return { valid: false, reason: '[workflow_gate_blocked] Workflow governance state is missing.' };
  if (IMPLEMENTATION_TOOLS.has(proposal.name)) {
    if (!isComplete(workflow, 'baseline') || !isComplete(workflow, 'reconcile') || !isComplete(workflow, 'document_plan')) {
      return reject(workflow, proposal, `Implementation requires completed baseline, reconcile, and documented-plan stages.`);
    }
  }
  if (proposal.name === 'update_plan' && !isComplete(workflow, 'reconcile')) {
    return reject(workflow, proposal, 'Documenting the implementation plan requires completed reconciliation.');
  }
  if (proposal.name === 'record_evidence' && !isComplete(workflow, 'validate')) {
    return reject(workflow, proposal, 'Closing evidence cannot be recorded before deterministic validation is complete.');
  }
  if (proposal.name === 'declare_success') {
    const required: WorkflowStageId[] = ['baseline', 'reconcile', 'document_plan', 'implement', 'validate', 'review', 'document_close'];
    const missing = required.filter(stage => !isComplete(workflow, stage));
    if (missing.length) return reject(workflow, proposal, `Success declaration requires completed workflow stages: ${missing.join(', ')}.`);
  }
  return { valid: true };
}

export function workflowReadyForSuccess(workflow: WorkflowGovernance): { ready: boolean; missing: WorkflowStageId[] } {
  const required: WorkflowStageId[] = ['baseline', 'reconcile', 'document_plan', 'implement', 'validate', 'review', 'document_close'];
  const missing = required.filter(stage => !isComplete(workflow, stage));
  return { ready: missing.length === 0, missing };
}

export function enforceWorkflowPlan(candidate: string, workflow: WorkflowGovernance): string {
  let plan = String(candidate || '').trim();
  const sections: Array<[string, string[]]> = [
    ['Acceptance Contract', workflow.acceptance.acceptanceCriteria],
    ['Validation', workflow.acceptance.requiredValidation],
    ['Negative Path', workflow.acceptance.negativePaths],
    ['Rollback', [workflow.acceptance.rollbackMethod]]
  ];
  for (const [heading, items] of sections) {
    const pattern = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'im');
    if (!pattern.test(plan)) plan += `\n\n## ${heading}\n${items.map(item => `- ${item}`).join('\n')}`;
  }
  return `${plan.trim()}\n`;
}

export function recordWorkflowEvent(state: HarnessState, proposal: ToolProposal, success: boolean): void {
  if (!success || !state.workflow) return;
  const workflow = state.workflow;
  if (['repo_search', 'symbol_search', 'read_file', 'read_range'].includes(proposal.name)) {
    complete(workflow, 'reconcile', `${proposal.name} completed workspace reconciliation evidence.`);
    workflow.capabilityMapDelta = state.files && Object.keys(state.files).length ? `Reconciled ${Object.keys(state.files).length} remembered file(s); capability change requires close review.` : 'no capability-map delta';
  }
  if (proposal.name === 'update_plan') complete(workflow, 'document_plan', 'PLAN.md updated through the Architect role.');
  if (IMPLEMENTATION_TOOLS.has(proposal.name)) {
    complete(workflow, 'implement', `${proposal.name} committed through deterministic validation.`);
    if (state.lastOraclePass) complete(workflow, 'validate', `Automatic post-${proposal.name} oracle passed.`);
  }
  if (proposal.name === 'run_tests' && state.lastOraclePass) {
    if (!isComplete(workflow, 'implement')) complete(workflow, 'implement', 'Green baseline proved no implementation mutation was required.');
    complete(workflow, 'validate', 'run_tests oracle passed.');
  }
  if (proposal.name === 'get_diff' && hasApprovedDiff(state)) complete(workflow, 'review', 'Diff review approved.');
  if (proposal.name === 'record_evidence' && state.lastOraclePass) complete(workflow, 'document_close', 'Green evidence recorded in the durable ledger.');
  if (isComplete(workflow, 'validate') && isComplete(workflow, 'review') && hasGreenEvidence(state)) {
    complete(workflow, 'document_close', 'Harness-authored green oracle evidence persisted in the durable ledger.');
  }
  advance(workflow);
}

export function finalizeWorkflow(state: HarnessState): void {
  if (!state.workflow) return;
  const workflow = state.workflow;
  if (state.aar) complete(workflow, 'aar', `AAR outcome recorded for terminal state ${state.status}.`);
  if (state.status === 'success' && ['baseline', 'reconcile', 'document_plan', 'implement', 'validate', 'review', 'document_close', 'aar'].every(stage => isComplete(workflow, stage as WorkflowStageId))) {
    complete(workflow, 'complete', 'All universal workflow gates completed with green evidence.');
    workflow.finalStatus = 'VERIFIED';
  } else if (state.status === 'failed' || state.status === 'gave_up') {
    workflow.finalStatus = state.status === 'gave_up' ? 'BLOCKED' : 'FAILED';
  }
  advance(workflow);
}

export function renderWorkflowTaskRecord(state: HarnessState): string {
  const workflow = state.workflow;
  const stageLines = workflow.stages.map(stage => `- ${stage.id}: ${stage.status}${stage.evidence.length ? ` - ${stage.evidence.slice(-1)[0]}` : ''}`).join('\n');
  return `# Forge Workflow Task Record\n\nTask: ${state.goalContract.goal}\nLane: ${workflow.lane.toUpperCase()}\nCurrent stage: ${workflow.currentStage}\nFinal status: ${workflow.finalStatus || 'IN PROGRESS'}\n\n## Acceptance Contract\n- Bounded unit: ${workflow.acceptance.boundedUnit}\n- Rollback: ${workflow.acceptance.rollbackMethod}\n- Criteria: ${workflow.acceptance.acceptanceCriteria.join('; ')}\n- Validation: ${workflow.acceptance.requiredValidation.join('; ')}\n- Negative paths: ${workflow.acceptance.negativePaths.join('; ')}\n\n## Baseline\n- Captured: ${workflow.baseline.capturedAt}\n- Version: ${workflow.baseline.packageVersion || 'unknown'}\n- Git: ${workflow.baseline.gitHead || 'unavailable'}\n- Dirty entries: ${workflow.baseline.gitStatus.length}\n- Files: ${workflow.baseline.fileCount}\n\n## Workflow Stages\n${stageLines}\n\n## Capability Map\n${workflow.capabilityMapDelta}\n\n## Violations\n${workflow.violations.length ? workflow.violations.map(item => `- ${item.timestamp}: ${item.proposalName} - ${item.reason}`).join('\n') : '- none'}\n`;
}

function captureWorkflowBaseline(root: string): WorkflowBaseline {
  let packageVersion = '';
  try { packageVersion = String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || ''); } catch { /* optional */ }
  let gitHead = '';
  let gitStatus: string[] = [];
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    gitStatus = execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split(/\r?\n/).filter(Boolean).slice(0, 200);
  } catch { /* non-git workspace */ }
  return {
    capturedAt: new Date().toISOString(), workspaceRoot: root, packageVersion, gitHead, gitStatus,
    fileCount: countFiles(root), existingForgeState: fs.existsSync(path.join(root, '.forge', 'state.json')),
    rollbackMethod: 'Forge transactional edits/commands plus manifest-backed safety checkpoints.'
  };
}

function countFiles(root: string): number {
  const excluded = new Set(['.git', '.forge', 'node_modules', 'out', 'dist', '.vscode-test', 'artifacts']);
  let count = 0;
  const visit = (dir: string) => {
    if (count >= 10000) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && excluded.has(entry.name)) continue;
      if (entry.isDirectory()) visit(path.join(dir, entry.name));
      else if (entry.isFile()) count += 1;
    }
  };
  try { visit(root); } catch { /* retain bounded count */ }
  return count;
}

function reject(workflow: WorkflowGovernance, proposal: ToolProposal, reason: string): { valid: false; reason: string } {
  const detail = `[workflow_gate_blocked] ${reason}`;
  workflow.violations.push({ timestamp: new Date().toISOString(), stage: workflow.currentStage, proposalName: proposal.name, reason: detail });
  workflow.updatedAt = new Date().toISOString();
  return { valid: false, reason: detail };
}

function evidence(workflow: WorkflowGovernance, stage: WorkflowStageId, detail: string): void {
  const record = workflow.stages.find(item => item.id === stage);
  if (record && !record.evidence.includes(detail)) record.evidence.push(detail);
}

function complete(workflow: WorkflowGovernance, stage: WorkflowStageId, detail: string): void {
  const record = workflow.stages.find(item => item.id === stage);
  if (!record) return;
  record.status = 'completed';
  record.completedAt = record.completedAt || new Date().toISOString();
  evidence(workflow, stage, detail);
  workflow.updatedAt = new Date().toISOString();
}

function isComplete(workflow: WorkflowGovernance, stage: WorkflowStageId): boolean {
  return workflow.stages.find(item => item.id === stage)?.status === 'completed';
}

function advance(workflow: WorkflowGovernance): void {
  workflow.currentStage = workflow.stages.find(stage => stage.status === 'pending')?.id || 'complete';
  workflow.updatedAt = new Date().toISOString();
}

function hasApprovedDiff(state: HarnessState): boolean {
  return (state.diffReviews || []).some(review => review.status === 'approved' || review.status === 'no_changes');
}

function hasGreenEvidence(state: HarnessState): boolean {
  return state.lastOraclePass === true && (state.evidenceLedger || []).some(item => item.testResult?.pass === true);
}

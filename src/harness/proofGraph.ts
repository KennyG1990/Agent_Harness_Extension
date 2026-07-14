import * as crypto from 'crypto';
import { HarnessState } from './types';

export type ProofNodeKind = 'run' | 'contract' | 'requirement' | 'task' | 'proposal' | 'validation' | 'approval' | 'change' | 'diff' | 'oracle' | 'review' | 'evidence' | 'terminal';
export type ProofEdgeKind = 'requires' | 'addresses' | 'validated_by' | 'approved_by' | 'committed_as' | 'verified_by' | 'reviewed_by' | 'evidenced_by' | 'terminates_as' | 'precedes';

export interface ProofNodeV1 {
  id: string;
  kind: ProofNodeKind;
  status: string;
  summary: string;
  sourceArtifact: string;
  payloadDigest: string;
  timestamp?: string;
}

export interface ProofEdgeV1 {
  from: string;
  to: string;
  kind: ProofEdgeKind;
}

export interface ProofGraphV1 {
  schemaVersion: 1;
  sessionId: string;
  contractDigest: string;
  terminalStatus: HarnessState['status'];
  generatedAt: string;
  nodes: ProofNodeV1[];
  edges: ProofEdgeV1[];
  completeness: { complete: boolean; missing: string[]; claimsSuccess: boolean };
  digest: string;
}

export function buildProofGraph(state: HarnessState): ProofGraphV1 {
  const nodes: ProofNodeV1[] = [];
  const edges: ProofEdgeV1[] = [];
  const add = (kind: ProofNodeKind, stableId: string, status: string, summary: string, sourceArtifact: string, payload: unknown, timestamp?: string): string => {
    const id = `${kind}:${stableId}`;
    nodes.push({ id, kind, status: bounded(status, 80), summary: bounded(summary, 240), sourceArtifact, payloadDigest: sha256(canonicalJson(payload)), ...(timestamp ? { timestamp } : {}) });
    return id;
  };
  const link = (from: string | undefined, to: string | undefined, kind: ProofEdgeKind): void => {
    if (from && to && from !== to) edges.push({ from, to, kind });
  };

  const runId = add('run', state.sessionId, state.status, `Forge run; steps=${state.currentStepIndex}; modelDriven=${state.runStats?.actuallyModelDriven === true}; fallback=${Number(state.runStats?.fallbackActions || 0)}`, '.forge/state.json', {
    sessionId: state.sessionId, status: state.status, currentStepIndex: state.currentStepIndex,
    actuallyModelDriven: state.runStats?.actuallyModelDriven === true, fallbackActions: Number(state.runStats?.fallbackActions || 0)
  }, state.executionContract?.compiledAt);
  const contractId = add('contract', state.executionContract.digest, state.executionContract.status, `Execution contract revision ${state.executionContract.revision}; assurance=${state.executionContract.authority.assurance}`, '.forge/execution-contract.json', state.executionContract, state.executionContract.compiledAt);
  link(runId, contractId, 'requires');

  const requirements = [...(state.goalContract.doneWhen || []), ...(state.executionContract.authority.requiredOracles || [])];
  const requirementNodes: string[] = [];
  for (const [index, requirement] of [...new Set(requirements)].entries()) {
    const reqId = add('requirement', sha256(requirement).slice(0, 20), 'required', `Requirement ${index + 1}`, '.forge/goal-contract.json', requirement);
    requirementNodes.push(reqId);
    link(contractId, reqId, 'requires');
  }

  const taskNodes = new Map<string, string>();
  for (const task of state.taskGraph.tasks || []) {
    const id = add('task', task.id, task.status, `${task.owner} task`, '.forge/task-graph.json', task);
    taskNodes.set(task.id, id);
    link(contractId, id, 'requires');
    for (const requirementId of requirementNodes) link(requirementId, id, 'addresses');
  }

  const stepLast = new Map<number, string>();
  const proposalByStep = new Map<number, string>();
  const validationByStep = new Map<number, string>();
  const toolByStep = new Map<number, string>();
  for (const event of state.progressEvents || []) {
    let kind: ProofNodeKind | undefined;
    if (event.kind === 'proposal') kind = 'proposal';
    else if (event.kind === 'validation') kind = 'validation';
    else if (event.kind === 'tool_finished') kind = 'change';
    else if (event.kind === 'oracle') kind = 'oracle';
    if (!kind) continue;
    const id = add(kind, event.id, event.status, `${event.role}; tool=${event.toolName || 'none'}`, '.forge/progress-events.json', event, event.timestamp);
    link(taskNodes.get(event.taskId || ''), id, 'addresses');
    link(stepLast.get(event.stepIndex), id, 'precedes');
    stepLast.set(event.stepIndex, id);
    if (kind === 'proposal') proposalByStep.set(event.stepIndex, id);
    if (kind === 'validation') { validationByStep.set(event.stepIndex, id); link(proposalByStep.get(event.stepIndex), id, 'validated_by'); }
    if (kind === 'change') { toolByStep.set(event.stepIndex, id); link(validationByStep.get(event.stepIndex), id, 'committed_as'); }
    if (kind === 'oracle') link(toolByStep.get(event.stepIndex) || validationByStep.get(event.stepIndex), id, 'verified_by');
  }

  for (const approval of state.humanApprovals || []) {
    const id = add('approval', approval.id, approval.status, `Human approval for ${approval.proposal.name}`, '.forge/human-approvals.json', approval, approval.requestedAt);
    const proposal = [...proposalByStep.values()].at(-1);
    link(proposal, id, 'approved_by');
  }

  const changes = [...(state.workerEditTransactions || []), ...(state.workerCommandTransactions || [])] as any[];
  for (const change of changes) {
    const stable = String(change.id || change.transactionId || sha256(canonicalJson(change)).slice(0, 20));
    const id = add('change', stable, change.success === false || change.status === 'failed' ? 'failed' : 'recorded', `Governed transaction; mode=${bounded(change.mode || change.kind || 'worker', 40)}`, change.command ? '.forge/worker-command-transactions.json' : '.forge/worker-edit-transactions.json', change, change.timestamp || change.completedAt);
    link([...validationByStep.values()].at(-1), id, 'committed_as');
  }

  const oracleEvents = nodes.filter(node => node.kind === 'oracle');
  const diffNodes: string[] = [];
  for (const review of state.diffReviews || []) {
    const diffId = add('diff', review.id, review.status, 'Deterministic diff record', '.forge/diff-reviews.json', { id: review.id, status: review.status, diffDigest: sha256(review.diffExcerpt || '') }, review.timestamp);
    diffNodes.push(diffId);
    link([...toolByStep.values()].at(-1), diffId, 'reviewed_by');
    link(oracleEvents.at(-1)?.id, diffId, 'reviewed_by');
  }
  for (const review of state.reviewerCritiques || []) {
    const id = add('review', review.id, review.status, `${review.source} reviewer; model=${bounded(review.modelId || 'none', 100)}`, '.forge/reviewer-critiques.json', { ...review, diffExcerpt: sha256(review.diffExcerpt || '') }, review.timestamp);
    link(diffNodes.at(-1) || [...toolByStep.values()].at(-1), id, 'reviewed_by');
  }

  const evidenceNodes: string[] = [];
  for (const evidence of state.evidenceLedger || []) {
    const id = add('evidence', evidence.id, evidence.testResult?.pass === true ? 'pass' : 'recorded', `Evidence; testPass=${evidence.testResult?.pass === true}`, '.forge/evidence-ledger.json', evidence, evidence.timestamp);
    evidenceNodes.push(id);
    link(oracleEvents.at(-1)?.id, id, 'evidenced_by');
    link(nodes.filter(node => node.kind === 'review' || node.kind === 'diff').at(-1)?.id, id, 'evidenced_by');
  }

  const terminalId = add('terminal', state.sessionId, state.status, `Terminal state ${state.status}; reasonDigest=${sha256(state.haltReason || '').slice(0, 16)}`, '.forge/state.json', { status: state.status, haltReason: state.haltReason || '', lastOraclePass: state.lastOraclePass === true });
  link(runId, terminalId, 'terminates_as');
  link(evidenceNodes.at(-1) || oracleEvents.at(-1)?.id, terminalId, 'terminates_as');

  const changed = changes.length > 0;
  const missing: string[] = [];
  if (state.executionContract.status !== 'confirmed') missing.push('confirmed execution contract');
  if (state.lastOraclePass !== true || !oracleEvents.some(node => node.status === 'pass')) missing.push('green composite oracle node');
  if (!(state.evidenceLedger || []).some(item => item.testResult?.pass === true)) missing.push('green evidence node');
  if (changed && !(state.diffReviews || []).some(item => item.status === 'approved')) missing.push('approved diff review');
  if (changed && state.executionContract.authority.requirements.independentReview && !(state.reviewerCritiques || []).some(item => item.source === 'model' && item.status === 'approved')) missing.push('independent model review');
  if (state.status === 'success' && (state.runStats?.actuallyModelDriven !== true) && state.executionContract.authority.requirements.modelDrivenCompletion) missing.push('model-driven completion');
  const complete = missing.length === 0;
  const graphBase = {
    schemaVersion: 1 as const,
    sessionId: state.sessionId,
    contractDigest: state.executionContract.digest,
    terminalStatus: state.status,
    generatedAt: new Date().toISOString(),
    nodes: uniqueNodes(nodes).sort((a, b) => a.id.localeCompare(b.id)),
    edges: uniqueEdges(edges).sort((a, b) => `${a.from}:${a.kind}:${a.to}`.localeCompare(`${b.from}:${b.kind}:${b.to}`)),
    completeness: { complete, missing, claimsSuccess: complete && state.status === 'success' }
  };
  assertAcyclic(graphBase.nodes, graphBase.edges);
  return { ...graphBase, digest: proofGraphDigest(graphBase) };
}

export function proofGraphDigest(graph: Omit<ProofGraphV1, 'digest'> | ProofGraphV1): string {
  const { digest: _ignored, generatedAt: _generatedAt, ...canonical } = graph as ProofGraphV1;
  return sha256(canonicalJson(canonical));
}

export function verifyProofGraph(graph: ProofGraphV1): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (graph.schemaVersion !== 1) errors.push('unsupported schema');
  if (proofGraphDigest(graph) !== graph.digest) errors.push('graph digest mismatch');
  try { assertAcyclic(graph.nodes, graph.edges); } catch (error: any) { errors.push(String(error.message || error)); }
  const ids = new Set(graph.nodes.map(node => node.id));
  if (ids.size !== graph.nodes.length) errors.push('duplicate node id');
  if (graph.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) errors.push('dangling edge');
  return { valid: errors.length === 0, errors };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function bounded(value: unknown, max: number): string { return String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, max); }
function uniqueNodes(nodes: ProofNodeV1[]): ProofNodeV1[] { return [...new Map(nodes.map(node => [node.id, node])).values()]; }
function uniqueEdges(edges: ProofEdgeV1[]): ProofEdgeV1[] { return [...new Map(edges.map(edge => [`${edge.from}:${edge.kind}:${edge.to}`, edge])).values()]; }
function assertAcyclic(nodes: ProofNodeV1[], edges: ProofEdgeV1[]): void {
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
  }
  const queue = [...indegree.entries()].filter(([, value]) => value === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited += 1;
    for (const next of outgoing.get(id) || []) { indegree.set(next, (indegree.get(next) || 0) - 1); if (indegree.get(next) === 0) queue.push(next); }
  }
  if (visited !== nodes.length) throw new Error('proof graph contains a cycle');
}

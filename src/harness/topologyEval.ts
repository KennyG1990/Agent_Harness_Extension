import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentHarnessLoop } from './loop';
import { ChatOptions, ModelDescriptor, Provider, ProviderCapabilities } from './provider';

export interface TopologyEvalLane {
  lane: 'solo-frontier' | 'plan-big-execute-small';
  solved: boolean;
  status: string;
  providerCalls: number;
  providerFailures: number;
  fallbackProposals: number;
  actuallyModelDriven: boolean;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  roleMetrics: Array<{ role: string; modelId: string; providerCalls: number; promptTokens: number; completionTokens: number; costUsd: number; latencyMs: number }>;
  greenEvidence: boolean;
  diffReviewed: boolean;
}

export interface TopologyEvalReport {
  schemaVersion: 1;
  generatedAt: string;
  fixture: string;
  rigorMatched: true;
  lanes: TopologyEvalLane[];
  costDeltaUsd: number;
  promptTokenDelta: number;
  upliftObserved: boolean;
  note: string;
  reportPath: string;
}

export async function runScriptedPlanBigExecuteSmallEval(reportRoot: string): Promise<TopologyEvalReport> {
  const roots: string[] = [];
  try {
    const solo = await runLane('solo-frontier', roots);
    const split = await runLane('plan-big-execute-small', roots);
    const target = path.join(fs.realpathSync(path.resolve(reportRoot)), '.forge', 'evals', 'latest-plan-big-execute-small.json');
    const report: TopologyEvalReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      fixture: 'single-file value repair through full product workflow',
      rigorMatched: true,
      lanes: [solo, split],
      costDeltaUsd: Number((solo.costUsd - split.costUsd).toFixed(8)),
      promptTokenDelta: solo.promptTokens - split.promptTokens,
      upliftObserved: split.solved && solo.solved && split.costUsd < solo.costUsd,
      note: split.solved && solo.solved && split.costUsd < solo.costUsd
        ? 'Both lanes solved under equal rigor; scripted usage accounting reports lower split-lane cost.'
        : 'No topology uplift observed; no success claim is inferred.',
      reportPath: target
    };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
    return report;
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

async function runLane(lane: TopologyEvalLane['lane'], roots: string[]): Promise<TopologyEvalLane> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-topology-${lane}-`));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'value.js'), 'export const value = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'test.js'), "const fs=require('fs');const text=fs.readFileSync('src/value.js','utf8');if(!/value = 2/.test(text)){console.error('expected value two');process.exit(1)}console.log('green');\n", 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'topology-fixture', private: true, scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  const provider = new TopologyScriptedProvider(root);
  const loop = new AgentHarnessLoop(provider, root, undefined);
  const bindings = lane === 'solo-frontier'
    ? { Explorer: 'frontier/control', Architect: 'frontier/control', Editor: 'frontier/control', Reviewer: 'frontier/control', review: 'frontier/control', code: 'frontier/control', plan: 'frontier/control' }
    : { Explorer: 'cheap/worker', Architect: 'frontier/architect', Editor: 'cheap/worker', Reviewer: 'frontier/reviewer', review: 'frontier/reviewer', code: 'cheap/worker', plan: 'frontier/architect' };
  let state = await loop.initializeHarness('Fix src/value.js so the held-out test passes.', bindings, {}, { humanApprovalPolicy: 'auto' });
  for (let step = 0; step < 14 && !['success', 'failed', 'gave_up'].includes(state.status); step += 1) state = await loop.runStep(state, bindings);
  const roleMetrics = state.subAgentTopology.workers.map(worker => ({
    role: worker.role, modelId: worker.modelId, providerCalls: worker.usage.providerCalls,
    promptTokens: worker.usage.promptTokens, completionTokens: worker.usage.completionTokens,
    costUsd: worker.usage.costUsd, latencyMs: worker.usage.latencyMs
  }));
  return {
    lane,
    solved: state.status === 'success' && state.lastOraclePass === true && state.evidenceLedger.some(item => item.testResult?.pass),
    status: state.status,
    providerCalls: state.runStats.providerCalls,
    providerFailures: state.runStats.providerFailures,
    fallbackProposals: state.runStats.fallbackProposals,
    actuallyModelDriven: state.runStats.actuallyModelDriven,
    costUsd: Number(state.goalContract.spent.toFixed(8)),
    promptTokens: roleMetrics.reduce((sum, item) => sum + item.promptTokens, 0),
    completionTokens: roleMetrics.reduce((sum, item) => sum + item.completionTokens, 0),
    roleMetrics,
    greenEvidence: state.evidenceLedger.some(item => item.testResult?.pass),
    diffReviewed: state.diffReviews.some(item => item.status === 'approved')
  };
}

class TopologyScriptedProvider implements Provider {
  constructor(private readonly root: string) {}
  public capabilities(modelId: string): ProviderCapabilities {
    return { structuredOutput: true, toolCalls: true, vision: false, contextLength: modelId.includes('cheap') ? 64_000 : 128_000 };
  }
  public async listModels(): Promise<ModelDescriptor[]> {
    return ['frontier/control', 'frontier/architect', 'frontier/reviewer', 'cheap/worker'].map(id => ({
      id, name: id, provider: 'scripted', capabilities: ['structured_output', 'tool_calls'], contextLength: id.includes('cheap') ? 64_000 : 128_000,
      promptPrice: id.includes('cheap') ? 0.0000001 : 0.00001, completionPrice: id.includes('cheap') ? 0.0000002 : 0.00003
    }));
  }
  public async generateChat(options: ChatOptions) {
    const system = String(options.messages[0]?.content || '');
    const cheap = options.modelId.includes('cheap');
    const usage = { promptTokens: cheap ? 80 : 120, completionTokens: cheap ? 16 : 24, totalCost: cheap ? 0.0001 : 0.002 };
    if (/Pre-Commit Reviewer/.test(system)) return { text: JSON.stringify({ status: 'approved', summary: 'Scoped proposal.', concerns: [] }), usage };
    if (/staged-diff Reviewer/.test(system)) {
      if (!/value = 1/.test(fs.readFileSync(path.join(this.root, 'src', 'value.js'), 'utf8'))) throw new Error('Active workspace changed before staged review.');
      return { text: JSON.stringify({ status: 'approved', summary: 'Staged diff is scoped and green.', concerns: [] }), usage };
    }
    if (options.sessionId.includes(':subagent:explorer:')) return { text: envelope('repo_search', { query: 'value' }), usage };
    if (options.sessionId.includes(':subagent:architect:')) return { text: envelope('update_plan', { planMd: '# PLAN.md\n\n## Premise Checks\n- test expects value two\n\n## Focus Files\n- src/value.js\n\n## Ordered Steps\n- Change value from one to two.\n' }), usage };
    if (options.sessionId.includes(':subagent:editor:')) return { text: envelope('apply_patch', { path: 'src/value.js', patchContent: '<<<<<<< SEARCH\nexport const value = 1;\n=======\nexport const value = 2;\n>>>>>>> REPLACE' }), usage };
    return { text: envelope('run_tests', {}), usage };
  }
}

function envelope(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({ explanation: `propose ${name}`, confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name, arguments: args } });
}

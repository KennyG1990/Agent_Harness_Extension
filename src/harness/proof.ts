import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentHarnessLoop } from './loop';
import { OpenRouterProvider, Provider } from './provider';
import { Firewall } from './firewall';
import { WorkspaceTools } from './tools';

export interface BlueprintProofOptions {
  models?: string[];
  goal?: string;
  keepFixtures?: boolean;
}

export interface ModelProofResult {
  modelId: string;
  passed: boolean;
  fixtureRoot: string;
  sessionId?: string;
  providerCalls: number;
  providerFailures: number;
  fallbackProposals: number;
  actuallyModelDriven: boolean;
  finalStatus?: string;
  haltReason?: string;
  testsPass: boolean;
  greenEvidence: boolean;
  artifacts: Record<string, string>;
  firewall: {
    rejectedMalformedPatch: boolean;
    rejectedOutOfWorkspacePath: boolean;
    rejectedBlockedCommand: boolean;
  };
}

export interface BlueprintProofReport {
  passed: boolean;
  generatedAt: string;
  goal: string;
  models: ModelProofResult[];
}

export class BlueprintProofRunner {
  private latestReport?: BlueprintProofReport;

  constructor(private readonly providerFactory: () => Provider = () => new OpenRouterProvider()) {}

  public getLatestReport(): BlueprintProofReport | undefined {
    return this.latestReport;
  }

  public async run(options: BlueprintProofOptions = {}): Promise<BlueprintProofReport> {
    const models = options.models?.length ? options.models : [
      OpenRouterProvider.codingModel(),
      OpenRouterProvider.mixedModel(),
      'meta-llama/llama-3.3-70b-instruct'
    ];
    const goal = options.goal || 'Validate that the Forge harness can run a fixture to green without false success.';
    const results: ModelProofResult[] = [];

    for (const modelId of models) {
      results.push(await this.runOne(modelId, goal, options.keepFixtures === true));
    }

    this.latestReport = {
      passed: results.every(result => result.passed),
      generatedAt: new Date().toISOString(),
      goal,
      models: results
    };
    return this.latestReport;
  }

  private async runOne(modelId: string, goal: string, keepFixture: boolean): Promise<ModelProofResult> {
    const fixtureRoot = createPassingFixture(modelId);
    const tools = new WorkspaceTools(fixtureRoot);
    const firewall = new Firewall(tools);
    const malformed = await firewall.validateProposal({ name: 'apply_patch', arguments: { path: 'src/math.js', patchContent: 'not a patch' } });
    const outOfScope = await firewall.validateProposal({ name: 'write_file', arguments: { path: '../escape.txt', content: 'bad' } });
    const blockedCommand = await firewall.validateProposal({ name: 'run_command', arguments: { command: 'git reset --hard HEAD~1' } });

    const loop = new AgentHarnessLoop(this.providerFactory(), fixtureRoot);
    const bindings = { code: modelId, Explorer: modelId, Architect: modelId, Editor: modelId, Orchestrator: modelId, Reviewer: modelId };
    let state = await loop.initializeHarness(goal, bindings);
    while (!['success', 'failed', 'gave_up'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
      state = await loop.runStep(state, bindings);
    }

    const stats = loop.getProofStats();
    const greenEvidence = state.evidenceLedger.some(item => item.testResult?.pass === true);
    const artifacts = {
      stateJson: path.join(fixtureRoot, '.forge', 'state.json'),
      evidenceLedger: path.join(fixtureRoot, '.forge', 'evidence-ledger.json'),
      plan: path.join(fixtureRoot, 'PLAN.md'),
      todos: path.join(fixtureRoot, 'todos.json')
    };

    const passed =
      state.status === 'success' &&
      state.oracleStatuses.tests === 'pass' &&
      greenEvidence &&
      malformed.valid === false &&
      outOfScope.valid === false &&
      blockedCommand.valid === false &&
      Object.values(artifacts).every(file => fs.existsSync(file));

    if (!keepFixture) {
      fs.writeFileSync(path.join(fixtureRoot, 'PROOF_RESULT.json'), JSON.stringify({ modelId, passed, stateStatus: state.status, stats }, null, 2), 'utf8');
    }

    return {
      modelId,
      passed,
      fixtureRoot,
      sessionId: state.sessionId,
      providerCalls: stats.providerCalls,
      providerFailures: stats.providerFailures,
      fallbackProposals: stats.fallbackProposals,
      actuallyModelDriven: stats.providerCalls > 0 && stats.providerFailures === 0,
      finalStatus: state.status,
      haltReason: state.haltReason,
      testsPass: state.oracleStatuses.tests === 'pass',
      greenEvidence,
      artifacts,
      firewall: {
        rejectedMalformedPatch: malformed.valid === false,
        rejectedOutOfWorkspacePath: outOfScope.valid === false,
        rejectedBlockedCommand: blockedCommand.valid === false
      }
    };
  }
}

function createPassingFixture(modelId: string): string {
  const safeModel = modelId.replace(/[^a-z0-9_.-]+/gi, '_');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `forge-proof-${safeModel}-`));
  fs.mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test-pass.js' }
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'test-pass.js'), 'console.log("forge proof fixture tests pass");\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'src', 'math.js'), 'export function add(a, b) { return a + b; }\n', 'utf8');
  return fixtureRoot;
}

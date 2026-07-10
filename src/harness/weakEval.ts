import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Firewall } from './firewall';
import { VerificationOracles } from './oracles';
import { OpenRouterProvider, Provider, ChatOptions, ChatUsage, ModelDescriptor } from './provider';
import { ToolProposal } from './types';
import { WorkspaceTools } from './tools';

export const ACTION_SCHEMA = {
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
        name: { type: 'string', enum: ['apply_patch', 'run_tests', 'write_file'] },
        // Must enumerate argument properties: live constrained decoders emit only
        // schema-declared keys, and a property-less object forces `arguments: {}`.
        arguments: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            patchContent: { type: 'string' },
            content: { type: 'string' }
          }
        }
      }
    }
  }
};

export interface WeakModelEvalOptions {
  model?: string;
  live?: boolean;
  taskLimit?: number;
  keepFixtures?: boolean;
  reportRoot?: string;
}

export interface WeakModelLaneResult {
  solved: boolean;
  modelDriven: boolean;
  fallbackSolved: boolean;
  testsPass: boolean;
  greenEvidence: boolean;
  providerCalls: number;
  providerFailures: number;
  fallbackProposals: number;
  steps: number;
  cost: number;
  fixtureRoot: string;
  evidencePath?: string;
  error?: string;
  lastValidationError?: string;
  rejectedPatchSample?: string;
  pathRepairs?: number;
  wholeFileRecoveries?: number;
}

export interface WeakModelTaskResult {
  id: string;
  title: string;
  bare: WeakModelLaneResult;
  harness: WeakModelLaneResult;
}

export interface WeakModelEvalReport {
  passed: boolean;
  status: 'uplift_observed' | 'no_uplift_observed';
  generatedAt: string;
  modelId: string;
  modelSelection: {
    rationale: string;
    excludedStrongPatterns: string[];
    preferredWeakSlugs: string[];
  };
  live: boolean;
  taskCount: number;
  bareSolved: number;
  harnessSolved: number;
  solveRateDelta: number;
  meanHarnessSteps: number;
  providerCalls: number;
  providerFailures: number;
  fallbackProposals: number;
  actuallyModelDriven: number;
  fallbackSolved: number;
  cost: number;
  reportPath?: string;
  liveCanary?: {
    ok: boolean;
    proposalName: string;
    argumentKeys: string[];
    pathNonEmpty: boolean;
  };
  tasks: WeakModelTaskResult[];
}

interface EvalTask {
  id: string;
  title: string;
  goal: string;
  filePath: string;
  broken: string;
  fixed: string;
  test: string;
}

export class WeakModelEvalRunner {
  private latestReport?: WeakModelEvalReport;

  constructor(private readonly providerFactory: (live: boolean) => Provider = live => live ? new OpenRouterProvider() : new MockWeakProvider()) {}

  public getLatestReport(): WeakModelEvalReport | undefined {
    return this.latestReport;
  }

  public async run(options: WeakModelEvalOptions = {}): Promise<WeakModelEvalReport> {
    const live = options.live === true;
    const provider = this.providerFactory(live);
    const modelId = options.model || await selectWeakModel(provider);
    let liveCanary: WeakModelEvalReport['liveCanary'];
    if (live) {
      await assertModelEndpointsLive(modelId);
      liveCanary = await runLiveSchemaCanary(provider, modelId);
      if (!liveCanary.ok) {
        throw new Error(`Live schema canary failed for ${modelId}: the constrained decoder returned arguments keys [${liveCanary.argumentKeys.join(', ')}] with pathNonEmpty=${liveCanary.pathNonEmpty}. The response schema and the provider's structured-output enforcement are incompatible; aborting before burning ${(options.taskLimit || 15) * 5} calls.`);
      }
    }
    const tasks = evalTasks().slice(0, Math.max(1, options.taskLimit || 15));
    const results: WeakModelTaskResult[] = [];

    for (const task of tasks) {
      const bareRoot = createFixture(task, modelId, 'bare');
      const harnessRoot = createFixture(task, modelId, 'harness');
      results.push({
        id: task.id,
        title: task.title,
        bare: await this.runBareLane(provider, modelId, task, bareRoot),
        harness: await this.runHarnessLane(provider, modelId, task, harnessRoot)
      });
      if (options.keepFixtures === false) {
        fs.rmSync(bareRoot, { recursive: true, force: true });
        fs.rmSync(harnessRoot, { recursive: true, force: true });
      }
    }

    const bareSolved = results.filter(result => result.bare.solved).length;
    const harnessSolved = results.filter(result => result.harness.solved).length;
    const providerCalls = sum(results, result => result.bare.providerCalls + result.harness.providerCalls);
    const providerFailures = sum(results, result => result.bare.providerFailures + result.harness.providerFailures);
    const fallbackProposals = sum(results, result => result.bare.fallbackProposals + result.harness.fallbackProposals);
    const fallbackSolved = results.filter(result => result.harness.fallbackSolved).length;
    const actuallyModelDriven = results.filter(result => result.harness.solved && result.harness.modelDriven).length;
    const report: WeakModelEvalReport = {
      passed: harnessSolved > bareSolved,
      status: harnessSolved > bareSolved ? 'uplift_observed' : 'no_uplift_observed',
      generatedAt: new Date().toISOString(),
      modelId,
      modelSelection: weakModelSelectionMetadata(),
      live,
      taskCount: results.length,
      bareSolved,
      harnessSolved,
      solveRateDelta: harnessSolved / results.length - bareSolved / results.length,
      meanHarnessSteps: results.length ? sum(results, result => result.harness.steps) / results.length : 0,
      providerCalls,
      providerFailures,
      fallbackProposals,
      actuallyModelDriven,
      fallbackSolved,
      cost: sum(results, result => result.bare.cost + result.harness.cost),
      liveCanary,
      tasks: results
    };

    report.reportPath = persistEvalReport(options.reportRoot || process.cwd(), report);
    this.latestReport = report;
    return report;
  }

  private async runBareLane(provider: Provider, modelId: string, task: EvalTask, fixtureRoot: string): Promise<WeakModelLaneResult> {
    const base = laneBase(fixtureRoot);
    try {
      base.providerCalls += 1;
      const response = await provider.generateChat({
        modelId,
        sessionId: `bare-${task.id}-${Date.now()}`,
        responseFormatSchema: ACTION_SCHEMA,
        messages: [
          { role: 'system', content: 'BARE_BASELINE: Return one JSON action only. No harness scaffolding is available.' },
          { role: 'user', content: taskPrompt(task, fixtureRoot, 'bare') }
        ]
      });
      base.cost += response.usage?.totalCost || 0;
      const proposal = parseProposal(response.text);
      const tools = new WorkspaceTools(fixtureRoot);
      const firewall = new Firewall(tools);
      const validation = await firewall.validateProposal(proposal);
      if (!validation.valid) {
        return { ...base, error: validation.reason || 'Bare proposal rejected.', lastValidationError: validation.reason, rejectedPatchSample: String(proposal.arguments?.patchContent || '').slice(0, 500) };
      }
      await tools.dispatch(proposal);
      const tests = await new VerificationOracles(fixtureRoot).runTest();
      if (tests.pass) {
        const evidencePath = path.join(fixtureRoot, '.forge', 'evidence-ledger.json');
        fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
        fs.writeFileSync(evidencePath, JSON.stringify([{
          command: 'npm run test',
          observation: `Weak-model eval task ${task.id} reached green tests through bare baseline lane.`,
          testResult: { pass: true, summary: tests.output.slice(0, 500), details: tests.output },
          confidence: 80,
          timestamp: new Date().toISOString()
        }], null, 2), 'utf8');
        return { ...base, solved: true, modelDriven: true, testsPass: true, greenEvidence: true, evidencePath, steps: 1 };
      }
      return { ...base, testsPass: false, steps: 1 };
    } catch (e: any) {
      return { ...base, providerFailures: base.providerFailures + 1, error: e.message };
    }
  }

  private async runHarnessLane(provider: Provider, modelId: string, task: EvalTask, fixtureRoot: string): Promise<WeakModelLaneResult> {
    const base = laneBase(fixtureRoot);
    const tools = new WorkspaceTools(fixtureRoot);
    const firewall = new Firewall(tools);
    const oracles = new VerificationOracles(fixtureRoot);
    const evidencePath = path.join(fixtureRoot, '.forge', 'evidence-ledger.json');
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

    let lastRejection = '';
    let malformedRejections = 0;
    for (let step = 1; step <= 6; step++) {
      base.steps = step;
      try {
        base.providerCalls += 1;
        const testBefore = await oracles.runTest();
        // Whole-file rewrite recovery (research: the weakest models emit a full
        // small file more reliably than any diff format). After two malformed
        // patches, stop asking for hunks and ask for the complete file.
        const wantWholeFile = malformedRejections >= 2;
        const rejectionFeedback = lastRejection
          ? wantWholeFile
            ? `\nYour previous patches were REJECTED as malformed: ${lastRejection}\nSTOP emitting patches. Instead emit a write_file proposal with the COMPLETE corrected content of ${task.filePath} in the "content" argument. Include every line of the file, fixed.`
            : `\nYour previous proposal was REJECTED by deterministic validation: ${lastRejection}\nCorrect the problem and re-emit the proposal. Reminder of the required format:\n${PATCH_FORMAT_EXEMPLAR}`
          : '';
        const response = await provider.generateChat({
          modelId,
          sessionId: `harness-${task.id}-${Date.now()}`,
          responseFormatSchema: ACTION_SCHEMA,
          messages: [
            { role: 'system', content: 'HARNESS_LANE: Propose exactly one tool call. Deterministic validation owns accept/reject. Success requires green tests and evidence.' },
            { role: 'user', content: `${taskPrompt(task, fixtureRoot, 'harness')}\nCurrent test output:\n${testBefore.output.slice(0, 1200)}${rejectionFeedback}` }
          ]
        });
        base.cost += response.usage?.totalCost || 0;
        const proposal = parseProposal(response.text);
        // Deterministic harness assistance (single-file fixture, unambiguous
        // target): repair an empty path instead of burning a retry. Counted
        // honestly in pathRepairs — assistance must be visible, never silent.
        if ((proposal.name === 'apply_patch' || proposal.name === 'write_file') && !String(proposal.arguments?.path || '').trim()) {
          proposal.arguments = { ...proposal.arguments, path: task.filePath };
          base.pathRepairs = (base.pathRepairs || 0) + 1;
        }
        if (proposal.name === 'write_file' && wantWholeFile) {
          base.wholeFileRecoveries = (base.wholeFileRecoveries || 0) + 1;
        }
        const validation = await firewall.validateProposal(proposal);
        if (!validation.valid) {
          lastRejection = validation.reason || 'Proposal rejected without a reason.';
          base.lastValidationError = lastRejection;
          base.rejectedPatchSample = String(proposal.arguments?.patchContent || '').slice(0, 500);
          if (/Malformed patch/i.test(lastRejection)) {
            malformedRejections += 1;
          }
          continue;
        }
        lastRejection = '';
        await tools.dispatch(proposal);
        const tests = await oracles.runTest();
        if (tests.pass) {
          const evidence = [{
            command: 'npm run test',
            observation: `Weak-model eval task ${task.id} reached green tests through firewalled harness lane.`,
            testResult: { pass: true, summary: tests.output.slice(0, 500), details: tests.output },
            confidence: 95,
            timestamp: new Date().toISOString()
          }];
          fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
          return { ...base, solved: true, modelDriven: true, testsPass: true, greenEvidence: true, evidencePath };
        }
      } catch {
        base.providerFailures += 1;
      }
    }

    const fallback = deterministicFixProposal(task);
    base.fallbackProposals += 1;
    const validation = await firewall.validateProposal(fallback);
    if (validation.valid) {
      await tools.dispatch(fallback);
    }
    const tests = await oracles.runTest();
    if (tests.pass) {
      const evidence = [{
        command: 'npm run test',
        observation: `Weak-model eval task ${task.id} reached green tests through deterministic fallback.`,
        testResult: { pass: true, summary: tests.output.slice(0, 500), details: tests.output },
        confidence: 60,
        timestamp: new Date().toISOString()
      }];
      fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    }
    return { ...base, solved: false, fallbackSolved: tests.pass, testsPass: tests.pass, greenEvidence: tests.pass, evidencePath };
  }
}

export async function assertModelEndpointsLive(modelId: string): Promise<void> {
  let payload: any;
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`);
    payload = response.ok ? await response.json() : null;
  } catch {
    // Network failure probing the catalog should not block the eval; the real
    // call will surface its own error.
    return;
  }
  const endpoints = payload?.data?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error(`Model ${modelId} has no live OpenRouter endpoints (delisted or renamed). Pick a served weak slug before running the live eval.`);
  }
}

export async function runLiveSchemaCanary(provider: Provider, modelId: string): Promise<{ ok: boolean; proposalName: string; argumentKeys: string[]; pathNonEmpty: boolean }> {
  const response = await provider.generateChat({
    modelId,
    sessionId: `schema-canary-${Date.now()}`,
    responseFormatSchema: ACTION_SCHEMA,
    messages: [
      { role: 'system', content: 'HARNESS_LANE: Propose exactly one tool call as JSON.' },
      { role: 'user', content: 'Return an apply_patch proposal for the file src/canary.js that replaces the line "return a - b;" with "return a + b;" using SEARCH/REPLACE patch format. The path argument must be "src/canary.js".' }
    ]
  });
  let proposalName = '';
  let argumentKeys: string[] = [];
  let pathNonEmpty = false;
  try {
    const proposal = parseProposal(response.text);
    proposalName = proposal.name;
    argumentKeys = Object.keys(proposal.arguments || {});
    pathNonEmpty = typeof proposal.arguments?.path === 'string' && proposal.arguments.path.trim().length > 0;
  } catch {
    // Leave defaults; ok stays false.
  }
  return { ok: proposalName === 'apply_patch' && pathNonEmpty, proposalName, argumentKeys, pathNonEmpty };
}

export async function selectWeakModel(provider: Provider): Promise<string> {
  const blocked = /(pareto|auto|opus|sonnet|gpt-4|gpt-5|claude|gemini.*pro|o3|o4|qwen3-coder|north-mini-code)/i;
  const preferredLegacyWeak = [
    'qwen/qwen2.5-coder-7b-instruct',
    'qwen/qwen-2.5-7b-instruct',
    'microsoft/phi-3-mini-128k-instruct',
    'mistralai/mistral-7b-instruct'
  ];
  const preferred = /(7b|3\.8b|mini|small|lite|qwen2\.5|phi-3|mistral-7b|coder)/i;
  const fallback = 'qwen/qwen2.5-coder-7b-instruct';
  try {
    const models = await provider.listModels();
    const byId = new Map(models.map(model => [model.id, model]));
    const exact = preferredLegacyWeak.find(slug => byId.has(slug));
    if (exact) {
      return exact;
    }
    return models
      .filter(model => !blocked.test(model.id) && !blocked.test(model.name || ''))
      .sort((a, b) => weakScore(b, preferred) - weakScore(a, preferred))[0]?.id || fallback;
  } catch {
    return fallback;
  }
}

export function weakModelSelectionMetadata() {
  return {
    rationale: 'Prefer older, small, inexpensive models that are plausibly weak at agentic coding. Exclude OpenRouter routers, frontier models, and newer agentic coding specialists so uplift is attributable to the harness rather than a strong model.',
    excludedStrongPatterns: ['openrouter/pareto-code', 'openrouter/auto', 'Claude Sonnet/Opus', 'GPT-4/5 class', 'Gemini Pro', 'Qwen3 Coder', 'Cohere North Mini Code'],
    preferredWeakSlugs: ['qwen/qwen2.5-coder-7b-instruct', 'qwen/qwen-2.5-7b-instruct', 'microsoft/phi-3-mini-128k-instruct', 'mistralai/mistral-7b-instruct']
  };
}

function weakScore(model: ModelDescriptor, preferred: RegExp): number {
  const haystack = `${model.id} ${model.name || ''}`.toLowerCase();
  return (preferred.test(haystack) ? 100 : 0) + (haystack.includes(':free') ? 50 : 0) - Math.min(model.contextLength || 0, 200000) / 100000;
}

function parseProposal(text: string): ToolProposal {
  const parsed = JSON.parse(text);
  if (!parsed?.proposal?.name || !parsed?.proposal?.arguments) {
    throw new Error('Model response did not contain a proposal.');
  }
  return parsed.proposal;
}

function laneBase(fixtureRoot: string): WeakModelLaneResult {
  return {
    solved: false,
    modelDriven: false,
    fallbackSolved: false,
    testsPass: false,
    greenEvidence: false,
    providerCalls: 0,
    providerFailures: 0,
    fallbackProposals: 0,
    steps: 0,
    cost: 0,
    fixtureRoot
  };
}

const PATCH_FORMAT_EXEMPLAR = [
  'The patchContent argument MUST use this exact SEARCH/REPLACE format (fence tokens verbatim, no other text):',
  '<<<<<<< SEARCH',
  'function example(a) {',
  '  return a - 1;',
  '}',
  '=======',
  'function example(a) {',
  '  return a + 1;',
  '}',
  '>>>>>>> REPLACE',
  'The SEARCH block must be copied character-for-character from the current file content, including whitespace.'
].join('\n');

function taskPrompt(task: EvalTask, fixtureRoot: string, lane: string): string {
  const content = fs.readFileSync(path.join(fixtureRoot, task.filePath), 'utf8');
  return [
    `Task id: ${task.id}`,
    `Lane: ${lane}`,
    `Goal: ${task.goal}`,
    `File: ${task.filePath}`,
    'Return one apply_patch proposal for this file.',
    PATCH_FORMAT_EXEMPLAR,
    'Current file content:',
    content
  ].join('\n');
}

function deterministicFixProposal(task: EvalTask): ToolProposal {
  return {
    name: 'apply_patch',
    arguments: {
      path: task.filePath,
      patchContent: patchFor(task.broken, task.fixed)
    }
  };
}

function createFixture(task: EvalTask, modelId: string, lane: string): string {
  const safe = `${task.id}-${lane}-${modelId}`.replace(/[^a-z0-9_.-]+/gi, '_');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-weak-eval-${safe}-`));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, task.filePath), task.broken, 'utf8');
  fs.writeFileSync(path.join(root, 'test.js'), task.test, 'utf8');
  return root;
}

function patchFor(search: string, replace: string): string {
  return `<<<<<<< SEARCH\n${search.replace(/\r\n/g, '\n')}\n=======\n${replace.replace(/\r\n/g, '\n')}\n>>>>>>> REPLACE`;
}

function persistEvalReport(root: string, report: WeakModelEvalReport): string {
  const evalDir = path.join(root, '.forge', 'evals');
  fs.mkdirSync(evalDir, { recursive: true });
  const reportPath = path.join(evalDir, 'latest-weak-model-eval.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

function sum<T>(items: T[], get: (item: T) => number): number {
  return items.reduce((total, item) => total + get(item), 0);
}

function evalTasks(): EvalTask[] {
  return [
    {
      id: 'syntax-error',
      title: 'Syntax error fix',
      goal: 'Fix the syntax error so exports load and tests pass.',
      filePath: 'src/math.js',
      broken: 'function add(a, b) {\n  return a + b;\n\nmodule.exports = { add };\n',
      fixed: 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n',
      test: "const assert = require('assert');\nconst { add } = require('./src/math');\nassert.equal(add(2, 3), 5);\nconsole.log('pass syntax-error');\n"
    },
    {
      id: 'failing-test',
      title: 'Failing unit test fix',
      goal: 'Fix subtraction behavior.',
      filePath: 'src/math.js',
      broken: 'function subtract(a, b) {\n  return a + b;\n}\n\nmodule.exports = { subtract };\n',
      fixed: 'function subtract(a, b) {\n  return a - b;\n}\n\nmodule.exports = { subtract };\n',
      test: "const assert = require('assert');\nconst { subtract } = require('./src/math');\nassert.equal(subtract(7, 3), 4);\nconsole.log('pass failing-test');\n"
    },
    {
      id: 'edge-case',
      title: 'Edge-case function bug',
      goal: 'Return null for division by zero.',
      filePath: 'src/math.js',
      broken: 'function divide(a, b) {\n  return a / b;\n}\n\nmodule.exports = { divide };\n',
      fixed: 'function divide(a, b) {\n  if (b === 0) return null;\n  return a / b;\n}\n\nmodule.exports = { divide };\n',
      test: "const assert = require('assert');\nconst { divide } = require('./src/math');\nassert.equal(divide(8, 2), 4);\nassert.equal(divide(8, 0), null);\nconsole.log('pass edge-case');\n"
    },
    {
      id: 'small-refactor',
      title: 'Small refactor with preserved tests',
      goal: 'Normalize names by trimming whitespace and lowercasing.',
      filePath: 'src/normalize.js',
      broken: 'function normalizeName(name) {\n  return name.toLowerCase();\n}\n\nmodule.exports = { normalizeName };\n',
      fixed: 'function normalizeName(name) {\n  return name.trim().toLowerCase();\n}\n\nmodule.exports = { normalizeName };\n',
      test: "const assert = require('assert');\nconst { normalizeName } = require('./src/normalize');\nassert.equal(normalizeName('  Ada Lovelace  '), 'ada lovelace');\nconsole.log('pass small-refactor');\n"
    },
    {
      id: 'missing-validation',
      title: 'Missing validation branch',
      goal: 'Reject empty email strings.',
      filePath: 'src/validate.js',
      broken: 'function isValidEmail(email) {\n  return email.includes(\"@\");\n}\n\nmodule.exports = { isValidEmail };\n',
      fixed: 'function isValidEmail(email) {\n  if (!email) return false;\n  return email.includes(\"@\");\n}\n\nmodule.exports = { isValidEmail };\n',
      test: "const assert = require('assert');\nconst { isValidEmail } = require('./src/validate');\nassert.equal(isValidEmail('a@example.com'), true);\nassert.equal(isValidEmail(''), false);\nconsole.log('pass missing-validation');\n"
    },
    {
      id: 'array-empty',
      title: 'Empty array branch',
      goal: 'Return 0 for the average of an empty array.',
      filePath: 'src/stats.js',
      broken: 'function average(values) {\n  return values.reduce((total, value) => total + value, 0) / values.length;\n}\n\nmodule.exports = { average };\n',
      fixed: 'function average(values) {\n  if (values.length === 0) return 0;\n  return values.reduce((total, value) => total + value, 0) / values.length;\n}\n\nmodule.exports = { average };\n',
      test: "const assert = require('assert');\nconst { average } = require('./src/stats');\nassert.equal(average([2, 4, 6]), 4);\nassert.equal(average([]), 0);\nconsole.log('pass array-empty');\n"
    },
    {
      id: 'off-by-one',
      title: 'Off-by-one slice bug',
      goal: 'Return the first n items, not n plus one items.',
      filePath: 'src/list.js',
      broken: 'function firstN(items, count) {\n  return items.slice(0, count + 1);\n}\n\nmodule.exports = { firstN };\n',
      fixed: 'function firstN(items, count) {\n  return items.slice(0, count);\n}\n\nmodule.exports = { firstN };\n',
      test: "const assert = require('assert');\nconst { firstN } = require('./src/list');\nassert.deepEqual(firstN(['a', 'b', 'c'], 2), ['a', 'b']);\nconsole.log('pass off-by-one');\n"
    },
    {
      id: 'case-insensitive',
      title: 'Case-insensitive comparison',
      goal: 'Make role checks case-insensitive.',
      filePath: 'src/auth.js',
      broken: 'function isAdmin(role) {\n  return role === \"admin\";\n}\n\nmodule.exports = { isAdmin };\n',
      fixed: 'function isAdmin(role) {\n  return String(role).toLowerCase() === \"admin\";\n}\n\nmodule.exports = { isAdmin };\n',
      test: "const assert = require('assert');\nconst { isAdmin } = require('./src/auth');\nassert.equal(isAdmin('admin'), true);\nassert.equal(isAdmin('Admin'), true);\nassert.equal(isAdmin('user'), false);\nconsole.log('pass case-insensitive');\n"
    },
    {
      id: 'default-value',
      title: 'Default value handling',
      goal: 'Use a default retry count when options omit retries.',
      filePath: 'src/options.js',
      broken: 'function retryCount(options) {\n  return options.retries;\n}\n\nmodule.exports = { retryCount };\n',
      fixed: 'function retryCount(options) {\n  return options.retries ?? 3;\n}\n\nmodule.exports = { retryCount };\n',
      test: "const assert = require('assert');\nconst { retryCount } = require('./src/options');\nassert.equal(retryCount({ retries: 5 }), 5);\nassert.equal(retryCount({}), 3);\nconsole.log('pass default-value');\n"
    },
    {
      id: 'parse-integer',
      title: 'Integer parsing validation',
      goal: 'Return null instead of NaN for invalid integer input.',
      filePath: 'src/parse.js',
      broken: 'function parseCount(value) {\n  return parseInt(value, 10);\n}\n\nmodule.exports = { parseCount };\n',
      fixed: 'function parseCount(value) {\n  const parsed = parseInt(value, 10);\n  return Number.isNaN(parsed) ? null : parsed;\n}\n\nmodule.exports = { parseCount };\n',
      test: "const assert = require('assert');\nconst { parseCount } = require('./src/parse');\nassert.equal(parseCount('12'), 12);\nassert.equal(parseCount('bad'), null);\nconsole.log('pass parse-integer');\n"
    },
    {
      id: 'dedupe-list',
      title: 'Duplicate removal',
      goal: 'Return unique items while preserving first-seen order.',
      filePath: 'src/dedupe.js',
      broken: 'function unique(items) {\n  return items;\n}\n\nmodule.exports = { unique };\n',
      fixed: 'function unique(items) {\n  return Array.from(new Set(items));\n}\n\nmodule.exports = { unique };\n',
      test: "const assert = require('assert');\nconst { unique } = require('./src/dedupe');\nassert.deepEqual(unique(['a', 'b', 'a', 'c']), ['a', 'b', 'c']);\nconsole.log('pass dedupe-list');\n"
    },
    {
      id: 'clamp-range',
      title: 'Range clamping',
      goal: 'Clamp percentages to the inclusive 0-100 range.',
      filePath: 'src/range.js',
      broken: 'function clampPercent(value) {\n  return value;\n}\n\nmodule.exports = { clampPercent };\n',
      fixed: 'function clampPercent(value) {\n  return Math.min(100, Math.max(0, value));\n}\n\nmodule.exports = { clampPercent };\n',
      test: "const assert = require('assert');\nconst { clampPercent } = require('./src/range');\nassert.equal(clampPercent(50), 50);\nassert.equal(clampPercent(-4), 0);\nassert.equal(clampPercent(120), 100);\nconsole.log('pass clamp-range');\n"
    },
    {
      id: 'promise-return',
      title: 'Promise return bug',
      goal: 'Return the promise chain so callers can await the fetched value.',
      filePath: 'src/fetcher.js',
      broken: 'function loadName(fetchName) {\n  fetchName().then(name => name.trim());\n}\n\nmodule.exports = { loadName };\n',
      fixed: 'function loadName(fetchName) {\n  return fetchName().then(name => name.trim());\n}\n\nmodule.exports = { loadName };\n',
      test: "const assert = require('assert');\nconst { loadName } = require('./src/fetcher');\nloadName(() => Promise.resolve(' Ada ')).then(value => {\n  assert.equal(value, 'Ada');\n  console.log('pass promise-return');\n});\n"
    },
    {
      id: 'object-copy',
      title: 'Avoid input mutation',
      goal: 'Return an updated copy without mutating the original object.',
      filePath: 'src/copy.js',
      broken: 'function withStatus(item, status) {\n  item.status = status;\n  return item;\n}\n\nmodule.exports = { withStatus };\n',
      fixed: 'function withStatus(item, status) {\n  return { ...item, status };\n}\n\nmodule.exports = { withStatus };\n',
      test: "const assert = require('assert');\nconst { withStatus } = require('./src/copy');\nconst original = { id: 1, status: 'old' };\nconst updated = withStatus(original, 'new');\nassert.equal(updated.status, 'new');\nassert.equal(original.status, 'old');\nconsole.log('pass object-copy');\n"
    },
    {
      id: 'sort-copy',
      title: 'Non-mutating sort',
      goal: 'Sort a copy of the list without mutating the caller array.',
      filePath: 'src/sort.js',
      broken: 'function sortedNumbers(values) {\n  return values.sort((a, b) => a - b);\n}\n\nmodule.exports = { sortedNumbers };\n',
      fixed: 'function sortedNumbers(values) {\n  return [...values].sort((a, b) => a - b);\n}\n\nmodule.exports = { sortedNumbers };\n',
      test: "const assert = require('assert');\nconst { sortedNumbers } = require('./src/sort');\nconst input = [3, 1, 2];\nassert.deepEqual(sortedNumbers(input), [1, 2, 3]);\nassert.deepEqual(input, [3, 1, 2]);\nconsole.log('pass sort-copy');\n"
    }
  ];
}

class MockWeakProvider implements Provider {
  public capabilities() {
    return { structuredOutput: true, toolCalls: false, vision: false, contextLength: 8192 };
  }

  public async listModels(): Promise<ModelDescriptor[]> {
    return [
      { id: 'qwen/qwen2.5-coder-7b-instruct', name: 'Qwen2.5 Coder 7B Instruct', provider: 'qwen', contextLength: 131000, capabilities: ['structured_output'] },
      { id: 'cohere/north-mini-code:free', name: 'North Mini Code Free', provider: 'cohere', contextLength: 8192, capabilities: ['structured_output'] },
      { id: 'openrouter/pareto-code', name: 'OpenRouter Pareto Code', provider: 'openrouter', contextLength: 200000, capabilities: ['structured_output', 'tool_calls'] }
    ];
  }

  public async generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    const prompt = options.messages.map(message => message.content).join('\n');
    const task = evalTasks().find(candidate => prompt.includes(`Task id: ${candidate.id}`));
    if (!task) {
      throw new Error('Mock provider could not identify task.');
    }
    if (prompt.includes('BARE_BASELINE') && task.id !== 'syntax-error') {
      return { text: JSON.stringify({ explanation: 'Weak bare model emitted malformed patch.', proposal: { name: 'apply_patch', arguments: { path: task.filePath, patchContent: 'not a patch' } } }) };
    }
    return { text: JSON.stringify({ explanation: 'Weak model proposed a context patch.', proposal: deterministicFixProposal(task) }) };
  }
}

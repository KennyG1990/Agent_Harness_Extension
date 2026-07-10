import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentHarnessLoop } from './loop';
import { Provider } from './provider';

export interface ReflectionAbOptions {
  taskLimit?: number;
  maxSteps?: number;
  keepFixtures?: boolean;
  reportRoot?: string;
}

export interface ReflectionAbLaneResult {
  reflectionEnabled: boolean;
  solved: boolean;
  status: string;
  steps: number;
  reflectionAttempts: number;
  oracleReflections: number;
  reflectionSuppressed: number;
  haltReason?: string;
  fixtureRoot: string;
}

export interface ReflectionAbTaskResult {
  id: string;
  title: string;
  on: ReflectionAbLaneResult;
  off: ReflectionAbLaneResult;
}

export interface ReflectionAbReport {
  passed: boolean;
  status: 'reflection_uplift_observed' | 'no_reflection_uplift';
  generatedAt: string;
  taskCount: number;
  reflectionOnSolved: number;
  reflectionOffSolved: number;
  solveRateDelta: number;
  offLaneHonestHalts: number;
  reportPath?: string;
  tasks: ReflectionAbTaskResult[];
}

interface AbTask {
  id: string;
  title: string;
  goal: string;
  filePath: string;
  broken: string;
  wrong: string;
  fixed: string;
  test: string;
}

const REFLECTION_CONTEXT_MARKER = /red_oracle:/;

export async function runReflectionAbEval(options: ReflectionAbOptions = {}, providerFactory: (task: AbTask) => Provider = createScriptedRecoveryProvider): Promise<ReflectionAbReport> {
  const tasks = abTasks().slice(0, Math.max(1, options.taskLimit || 5));
  const results: ReflectionAbTaskResult[] = [];
  for (const task of tasks) {
    const on = await runLane(task, true, options, providerFactory);
    const off = await runLane(task, false, options, providerFactory);
    results.push({ id: task.id, title: task.title, on, off });
  }
  const reflectionOnSolved = results.filter(result => result.on.solved).length;
  const reflectionOffSolved = results.filter(result => result.off.solved).length;
  const offLaneHonestHalts = results.filter(result => !result.off.solved && ['failed', 'gave_up'].includes(result.off.status)).length;
  const report: ReflectionAbReport = {
    passed: reflectionOnSolved > reflectionOffSolved,
    status: reflectionOnSolved > reflectionOffSolved ? 'reflection_uplift_observed' : 'no_reflection_uplift',
    generatedAt: new Date().toISOString(),
    taskCount: results.length,
    reflectionOnSolved,
    reflectionOffSolved,
    solveRateDelta: results.length ? reflectionOnSolved / results.length - reflectionOffSolved / results.length : 0,
    offLaneHonestHalts,
    tasks: results
  };
  report.reportPath = persistReport(options.reportRoot || process.cwd(), report);
  return report;
}

async function runLane(task: AbTask, reflectionEnabled: boolean, options: ReflectionAbOptions, providerFactory: (task: AbTask) => Provider): Promise<ReflectionAbLaneResult> {
  const fixtureRoot = createFixture(task, reflectionEnabled ? 'on' : 'off');
  const provider = providerFactory(task);
  const loop = new AgentHarnessLoop(provider, fixtureRoot);
  let state = await loop.initializeHarness(task.goal, {}, {}, { reflectionEnabled });
  state.maxSteps = Math.max(4, options.maxSteps || 8);
  while (!['success', 'failed', 'gave_up'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
    state = await loop.runStep(state, {});
  }
  const lane: ReflectionAbLaneResult = {
    reflectionEnabled,
    solved: state.status === 'success',
    status: state.status,
    steps: state.currentStepIndex,
    reflectionAttempts: state.runStats?.reflectionAttempts || 0,
    oracleReflections: state.runStats?.oracleReflections || 0,
    reflectionSuppressed: state.runStats?.reflectionSuppressed || 0,
    haltReason: state.haltReason,
    fixtureRoot
  };
  if (options.keepFixtures === false) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  return lane;
}

/**
 * Scripted provider that models a weak model which needs verification feedback:
 * its first patch applies cleanly but does not fix the bug (red oracle). It only
 * proposes the correct patch after harness-injected reflection context appears in
 * the prompt, so solving is causally dependent on the reflection mechanism.
 */
export function createScriptedRecoveryProvider(task: AbTask): Provider {
  let calls = 0;
  let correctPatchProposed = false;
  let testsRequested = false;
  return {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async (chatOptions: any) => {
      calls += 1;
      const prompt = (chatOptions.messages || []).map((message: any) => message.content).join('\n');
      const sawReflection = REFLECTION_CONTEXT_MARKER.test(prompt);
      let proposal: any;
      if (calls === 1) {
        proposal = { name: 'update_plan', arguments: { planMd: `# PLAN.md\n\nFix ${task.filePath} until tests pass.` } };
      } else if (!correctPatchProposed && !sawReflection) {
        proposal = { name: 'apply_patch', arguments: { path: task.filePath, patchContent: patchFor(task.broken, task.wrong) } };
      } else if (!correctPatchProposed && sawReflection) {
        correctPatchProposed = true;
        proposal = { name: 'apply_patch', arguments: { path: task.filePath, patchContent: patchFor(task.wrong, task.fixed) } };
      } else if (!testsRequested) {
        testsRequested = true;
        proposal = { name: 'run_tests', arguments: {} };
      } else {
        proposal = { name: 'get_diff', arguments: {} };
      }
      return {
        text: JSON.stringify({
          explanation: `Reflection A/B scripted proposal ${calls} (reflection context seen: ${sawReflection}).`,
          proposal
        })
      };
    }
  } as Provider;
}

function createFixture(task: AbTask, lane: string): string {
  const safe = `${task.id}-${lane}`.replace(/[^a-z0-9_.-]+/gi, '_');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-reflection-ab-${safe}-`));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, task.filePath), task.broken, 'utf8');
  fs.writeFileSync(path.join(root, 'test.js'), task.test, 'utf8');
  return root;
}

function patchFor(search: string, replace: string): string {
  return `<<<<<<< SEARCH\n${search.replace(/\r\n/g, '\n')}\n=======\n${replace.replace(/\r\n/g, '\n')}\n>>>>>>> REPLACE`;
}

function persistReport(root: string, report: ReflectionAbReport): string {
  const evalDir = path.join(root, '.forge', 'evals');
  fs.mkdirSync(evalDir, { recursive: true });
  const reportPath = path.join(evalDir, 'latest-reflection-ab.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

function abTasks(): AbTask[] {
  return [
    {
      id: 'wrong-operator',
      title: 'Wrong operator needs oracle feedback',
      goal: 'Make addition return the sum so tests pass.',
      filePath: 'src/math.js',
      broken: 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n',
      wrong: 'function add(a, b) {\n  return a * b;\n}\n\nmodule.exports = { add };\n',
      fixed: 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n',
      test: "const assert = require('assert');\nconst { add } = require('./src/math');\nassert.equal(add(2, 3), 5);\nconsole.log('pass wrong-operator');\n"
    },
    {
      id: 'wrong-default',
      title: 'Wrong default needs oracle feedback',
      goal: 'Default retries to 3 when options omit retries.',
      filePath: 'src/options.js',
      broken: 'function retryCount(options) {\n  return options.retries;\n}\n\nmodule.exports = { retryCount };\n',
      wrong: 'function retryCount(options) {\n  return options.retries ?? 0;\n}\n\nmodule.exports = { retryCount };\n',
      fixed: 'function retryCount(options) {\n  return options.retries ?? 3;\n}\n\nmodule.exports = { retryCount };\n',
      test: "const assert = require('assert');\nconst { retryCount } = require('./src/options');\nassert.equal(retryCount({ retries: 5 }), 5);\nassert.equal(retryCount({}), 3);\nconsole.log('pass wrong-default');\n"
    },
    {
      id: 'wrong-clamp',
      title: 'Wrong clamp bound needs oracle feedback',
      goal: 'Clamp percentages to the inclusive 0-100 range.',
      filePath: 'src/range.js',
      broken: 'function clampPercent(value) {\n  return value;\n}\n\nmodule.exports = { clampPercent };\n',
      wrong: 'function clampPercent(value) {\n  return Math.max(0, value);\n}\n\nmodule.exports = { clampPercent };\n',
      fixed: 'function clampPercent(value) {\n  return Math.min(100, Math.max(0, value));\n}\n\nmodule.exports = { clampPercent };\n',
      test: "const assert = require('assert');\nconst { clampPercent } = require('./src/range');\nassert.equal(clampPercent(-4), 0);\nassert.equal(clampPercent(120), 100);\nconsole.log('pass wrong-clamp');\n"
    },
    {
      id: 'wrong-trim',
      title: 'Missing trim needs oracle feedback',
      goal: 'Normalize names by trimming whitespace and lowercasing.',
      filePath: 'src/normalize.js',
      broken: 'function normalizeName(name) {\n  return name;\n}\n\nmodule.exports = { normalizeName };\n',
      wrong: 'function normalizeName(name) {\n  return name.toLowerCase();\n}\n\nmodule.exports = { normalizeName };\n',
      fixed: 'function normalizeName(name) {\n  return name.trim().toLowerCase();\n}\n\nmodule.exports = { normalizeName };\n',
      test: "const assert = require('assert');\nconst { normalizeName } = require('./src/normalize');\nassert.equal(normalizeName('  Ada Lovelace  '), 'ada lovelace');\nconsole.log('pass wrong-trim');\n"
    },
    {
      id: 'wrong-guard',
      title: 'Missing empty guard needs oracle feedback',
      goal: 'Return 0 for the average of an empty array.',
      filePath: 'src/stats.js',
      broken: 'function average(values) {\n  return values.reduce((total, value) => total + value, 0) / values.length;\n}\n\nmodule.exports = { average };\n',
      wrong: 'function average(values) {\n  if (values.length === 0) return -1;\n  return values.reduce((total, value) => total + value, 0) / values.length;\n}\n\nmodule.exports = { average };\n',
      fixed: 'function average(values) {\n  if (values.length === 0) return 0;\n  return values.reduce((total, value) => total + value, 0) / values.length;\n}\n\nmodule.exports = { average };\n',
      test: "const assert = require('assert');\nconst { average } = require('./src/stats');\nassert.equal(average([2, 4, 6]), 4);\nassert.equal(average([]), 0);\nconsole.log('pass wrong-guard');\n"
    }
  ];
}

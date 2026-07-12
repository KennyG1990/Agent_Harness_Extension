import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Firewall } from './firewall';
import { AgentHarnessLoop } from './loop';
import { Provider } from './provider';
import { VerificationOracles } from './oracles';
import { WorkspaceTools } from './tools';

export interface VerificationFixtureCase {
  id: string;
  description: string;
  expected: boolean;
  actual: boolean;
  output: string;
  fixtureRoot: string;
}

export interface VerificationFixtureMatrixReport {
  passed: boolean;
  generatedAt: string;
  reportPath: string;
  cases: VerificationFixtureCase[];
}

export async function runVerificationFixtureMatrix(reportRoot: string = process.cwd()): Promise<VerificationFixtureMatrixReport> {
  const cases: VerificationFixtureCase[] = [];

  cases.push(await oracleCase('passing-tests', 'Passing test suite is accepted by the test oracle.', true, { test: 'node -e "process.exit(0)"' }, 'test'));
  cases.push(await oracleCase('failing-tests', 'Failing test suite is rejected by the test oracle.', false, { test: 'node -e "process.exit(1)"' }, 'test'));
  cases.push(await oracleCase('missing-test-suite', 'Missing test suite cannot be treated as success.', false, {}, 'test'));
  cases.push(await oracleCase('typecheck-failure', 'Failing typecheck/build oracle is detected.', false, { typecheck: 'node -e "process.exit(1)"', test: 'node -e "process.exit(0)"' }, 'typecheck'));
  cases.push(await oracleCase('lint-failure', 'Failing lint oracle is detected.', false, { lint: 'node -e "process.exit(1)"', test: 'node -e "process.exit(0)"' }, 'lint'));
  cases.push(await oracleCase('build-failure', 'Passing tests cannot mask a failing required build oracle.', false, { build: 'node -e "process.exit(1)"', test: 'node -e "process.exit(0)"' }, 'all'));
  cases.push(await oracleCase('composite-typecheck-failure', 'Passing tests cannot mask a failing required typecheck oracle.', false, { typecheck: 'node -e "process.exit(1)"', test: 'node -e "process.exit(0)"' }, 'all'));

  const firewallRoot = createFixtureRoot('firewall');
  fs.mkdirSync(path.join(firewallRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(firewallRoot, 'src', 'math.js'), 'export const value = 1;\n', 'utf8');
  const firewall = new Firewall(new WorkspaceTools(firewallRoot));
  cases.push(await firewallCase(firewallRoot, 'malformed-patch', 'Malformed patches are rejected before mutation.', false, firewall.validateProposal({ name: 'apply_patch', arguments: { path: 'src/math.js', patchContent: 'not a patch' } })));
  cases.push(await firewallCase(firewallRoot, 'out-of-workspace-path', 'Workspace path escape is rejected.', false, firewall.validateProposal({ name: 'write_file', arguments: { path: '../escape.txt', content: 'bad' } })));
  cases.push(await firewallCase(firewallRoot, 'blocked-command', 'Blocked destructive shell command is rejected.', false, firewall.validateProposal({ name: 'run_command', arguments: { command: 'git reset --hard HEAD~1' } })));
  cases.push(await unsolvableCase());

  const passed = cases.every(item => item.expected === item.actual);
  const forgeDir = path.join(reportRoot, '.forge');
  fs.mkdirSync(forgeDir, { recursive: true });
  const reportPath = path.join(forgeDir, 'verification-fixture-matrix.json');
  const report: VerificationFixtureMatrixReport = {
    passed,
    generatedAt: new Date().toISOString(),
    reportPath,
    cases
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function unsolvableCase(): Promise<VerificationFixtureCase> {
  const fixtureRoot = createFixtureRoot('unsolvable-step-cap');
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' }
  }, null, 2), 'utf8');
  const provider: Provider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => ({
      text: JSON.stringify({
        explanation: 'This proposal should never run because the step cap is exhausted.',
        proposal: { name: 'run_tests', arguments: {} }
      })
    })
  };
  const loop = new AgentHarnessLoop(provider, fixtureRoot);
  const state = await loop.initializeHarness('Unsolvable fixture should give up instead of claiming success.');
  state.maxSteps = 0;
  const terminal = await loop.runStep(state, { code: 'fixture/weak' });
  return {
    id: 'unsolvable-step-cap',
    description: 'Unsolvable exhausted-budget run terminates as gave_up and never claims success.',
    expected: true,
    actual: terminal.status === 'gave_up' && !terminal.evidenceLedger.some(item => item.testResult?.pass === true),
    output: `${terminal.status}: ${terminal.haltReason || ''}`,
    fixtureRoot
  };
}

async function oracleCase(id: string, description: string, expected: boolean, scripts: Record<string, string>, oracle: 'test' | 'typecheck' | 'lint' | 'all'): Promise<VerificationFixtureCase> {
  const fixtureRoot = createFixtureRoot(id);
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ scripts }, null, 2), 'utf8');
  const oracles = new VerificationOracles(fixtureRoot);
  const result = oracle === 'all'
    ? await oracles.runAll()
    : oracle === 'test'
    ? await oracles.runTest()
    : oracle === 'typecheck'
      ? await oracles.runTypecheck()
      : await oracles.runLint();
  return {
    id,
    description,
    expected,
    actual: result.pass,
    output: ('output' in result ? result.output : result.summary).slice(0, 2000),
    fixtureRoot
  };
}

async function firewallCase(fixtureRoot: string, id: string, description: string, expected: boolean, validationPromise: Promise<{ valid: boolean; reason?: string }>): Promise<VerificationFixtureCase> {
  const result = await validationPromise;
  return {
    id,
    description,
    expected,
    actual: result.valid,
    output: result.reason || 'accepted',
    fixtureRoot
  };
}

function createFixtureRoot(id: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-verification-${id}-`));
  return fs.realpathSync(root);
}

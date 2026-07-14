import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessOracleCalibration, AUDITED_ORACLE_MIN_MUTANTS, AUDITED_ORACLE_SENSITIVITY_FLOOR, runOracleCalibration } from '../out/harness/oracleCalibration.js';
import { Firewall } from '../out/harness/firewall.js';
import { WorkspaceTools } from '../out/harness/tools.js';

const roots = [];
const makeRoot = (name) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-calibration-${name}-`));
  roots.push(root);
  return root;
};
const write = (root, relative, content) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};
const digestWorkspace = (root) => {
  const parts = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.forge') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) parts.push(`${path.relative(root, full).replace(/\\/g, '/')}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
    }
  };
  visit(root);
  return crypto.createHash('sha256').update(parts.sort().join('\n')).digest('hex');
};
const nodeFixture = (name, tests) => {
  const root = makeRoot(name);
  write(root, 'package.json', JSON.stringify({ private: true, scripts: { test: 'node tests/run.js' } }, null, 2));
  write(root, 'src/app.js', `
// PRIVATE_CALIBRATION_CANARY must never enter a report.
exports.gate = value => value === true;
exports.neq = value => value !== false;
exports.min = value => value >= 10;
exports.max = value => value <= 20;
exports.both = (a, b) => a && b;
exports.either = (a, b) => a || b;
exports.positive = value => value > 0;
exports.small = value => value < 5;
exports.pattern = /PRIVATE_REGEX_CANARY==true&&false/;
`);
  write(root, 'tests/run.js', tests);
  return root;
};

const strongTests = `
const assert = require('node:assert/strict');
const app = require('../src/app');
assert.equal(app.gate(true), true); assert.equal(app.gate(false), false);
assert.equal(app.neq(true), true); assert.equal(app.neq(false), false);
assert.equal(app.min(10), true); assert.equal(app.min(9), false);
assert.equal(app.max(20), true); assert.equal(app.max(21), false);
assert.equal(app.both(true, true), true); assert.equal(app.both(true, false), false);
assert.equal(app.either(false, true), true); assert.equal(app.either(false, false), false);
assert.equal(app.positive(1), true); assert.equal(app.positive(0), false);
assert.equal(app.small(4), true); assert.equal(app.small(5), false);
console.log('green PRIVATE_TEST_CANARY');
`;

try {
  const strongRoot = nodeFixture('strong', strongTests);
  const strongBefore = digestWorkspace(strongRoot);
  const strong = await runOracleCalibration({ workspaceRoot: strongRoot, maxMutants: 8, sensitivityFloor: 0.01, commandTimeoutMs: 10_000 });
  assert.equal(strong.status, 'pass');
  assert.equal(strong.appliedMutants, 8);
  assert.equal(strong.killedMutants, 8);
  assert.equal(strong.sensitivity, 1);
  assert.equal(strong.floor, AUDITED_ORACLE_SENSITIVITY_FLOOR, 'callers cannot lower the audited floor');
  assert.equal(strong.sourceWorkspaceMutated, false);
  assert.equal(strong.testsMutated, false);
  assert.equal(digestWorkspace(strongRoot), strongBefore, 'active source and tests must remain byte-identical');
  assert.ok(!JSON.stringify(strong).includes('PRIVATE_CALIBRATION_CANARY'));
  assert.ok(!JSON.stringify(strong).includes('PRIVATE_TEST_CANARY'));
  assert.ok(!JSON.stringify(strong).includes('PRIVATE_REGEX_CANARY'));
  assert.equal(assessOracleCalibration(strongRoot).available, true);
  const firewall = new Firewall(new WorkspaceTools(strongRoot));
  const forgedCalibration = await firewall.validateProposal({ name: 'write_file', arguments: { path: '.forge/oracle-calibration.json', content: '{}' } });
  assert.equal(forgedCalibration.valid, false, 'model file tools cannot overwrite host-owned calibration truth');
  assert.match(forgedCalibration.reason, /host-owned proof and control namespace/);

  write(strongRoot, 'src/app.js', `${fs.readFileSync(path.join(strongRoot, 'src/app.js'), 'utf8')}\n// ordinary source evolution\n`);
  assert.equal(assessOracleCalibration(strongRoot).available, true, 'ordinary source edits do not invalidate test-suite calibration');
  write(strongRoot, 'tests/run.js', `${strongTests}\n// test suite changed\n`);
  assert.match(assessOracleCalibration(strongRoot).reason, /test suite or configuration changed/);

  const reportPath = path.join(strongRoot, '.forge', 'oracle-calibration.json');
  const tampered = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  tampered.sensitivity = 1;
  tampered.killedMutants = 999;
  fs.writeFileSync(reportPath, JSON.stringify(tampered, null, 2));
  assert.match(assessOracleCalibration(strongRoot).reason, /digest mismatch/);

  const weakRoot = nodeFixture('weak', `require('../src/app'); console.log('always green');\n`);
  const weak = await runOracleCalibration({ workspaceRoot: weakRoot, maxMutants: 8, commandTimeoutMs: 10_000 });
  assert.equal(weak.status, 'below_floor');
  assert.equal(weak.sensitivity, 0);
  assert.equal(weak.survivedMutants, weak.appliedMutants);
  assert.equal(assessOracleCalibration(weakRoot).available, false);

  const redRoot = nodeFixture('red', `process.exitCode = 1;\n`);
  const red = await runOracleCalibration({ workspaceRoot: redRoot, maxMutants: 5, commandTimeoutMs: 10_000 });
  assert.equal(red.status, 'baseline_red');
  assert.equal(red.appliedMutants, 0);

  const fewRoot = makeRoot('few');
  write(fewRoot, 'package.json', JSON.stringify({ scripts: { test: 'node tests/run.js' } }));
  write(fewRoot, 'src/app.js', 'module.exports = value => value === 1;\n');
  write(fewRoot, 'tests/run.js', `const assert=require('node:assert/strict'); assert.equal(require('../src/app')(1), true);\n`);
  const few = await runOracleCalibration({ workspaceRoot: fewRoot, maxMutants: 5, commandTimeoutMs: 10_000 });
  assert.equal(few.status, 'unsupported');
  assert.ok(few.candidateCount < AUDITED_ORACLE_MIN_MUTANTS);

  const regexRoot = makeRoot('regex');
  write(regexRoot, 'package.json', JSON.stringify({ scripts: { test: 'node tests/run.js' } }));
  write(regexRoot, 'src/app.js', `module.exports = /==true&&false>=<=/; // true === false && ||\n`);
  write(regexRoot, 'tests/run.js', `require('../src/app');\n`);
  const regex = await runOracleCalibration({ workspaceRoot: regexRoot, maxMutants: 5, commandTimeoutMs: 10_000 });
  assert.equal(regex.candidateCount, 0, 'comments, strings, and regex literals are not mutation targets');

  const unsupportedRoot = makeRoot('unsupported');
  write(unsupportedRoot, 'requirements.txt', 'pytest\n');
  write(unsupportedRoot, 'test_should_not_run.py', `raise RuntimeError('must not execute')\n`);
  const unsupported = await runOracleCalibration({ workspaceRoot: unsupportedRoot });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.baselineBefore.durationMs, 0, 'unsupported ecosystems execute no commands');
  assert.equal(assessOracleCalibration(unsupportedRoot).reason, 'calibration status is unsupported');

  console.log(JSON.stringify({
    passed: true,
    strong: { sensitivity: strong.sensitivity, killed: strong.killedMutants, applied: strong.appliedMutants },
    weak: { sensitivity: weak.sensitivity, survived: weak.survivedMutants },
    baselineRedBlocked: true,
    unsupportedNonExecuting: true,
    staleAndTamperRejected: true,
    activeWorkspacePreserved: true,
    lexicalCanariesExcluded: true
    ,hostNamespaceProtected: true
  }, null, 2));
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

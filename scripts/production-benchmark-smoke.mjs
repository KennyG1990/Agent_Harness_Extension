#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const compiled = path.join(process.cwd(), 'out', 'harness', 'productionBenchmark.js');
const benchmark = await import(pathToFileURL(compiled).href);
const tasks = benchmark.productionBenchmarkTasks();
const suite = benchmark.validateProductionSuite(tasks);

assert.equal(tasks.length, 16);
assert.equal(suite.suiteDigest, benchmark.PRODUCTION_SUITE_DIGEST);
assert.equal(new Set(tasks.map(task => task.id)).size, 16);
assert.ok(tasks.every(task => task.heldOutTest && task.files && task.goal));

assert.throws(() => benchmark.normalizeProductionBenchmarkRequest({ model: 'qwen/qwen-2.5-7b-instruct', reportRoot: process.cwd(), confirmLiveSpend: false }), /confirmation/i);
assert.throws(() => benchmark.normalizeProductionBenchmarkRequest({ model: 'anthropic/claude-opus-4', reportRoot: process.cwd(), confirmLiveSpend: true }), /not approved/i);
assert.throws(() => benchmark.normalizeProductionBenchmarkRequest({ model: 'qwen/qwen-2.5-7b-instruct', reportRoot: process.cwd(), confirmLiveSpend: true, taskLimit: 15 }), /exactly 16/i);
assert.throws(() => benchmark.normalizeProductionBenchmarkRequest({ model: 'qwen/qwen-2.5-7b-instruct', reportRoot: process.cwd(), confirmLiveSpend: true, providerCallTimeoutMs: 1000 }), /between 15 and 120/i);

const drifted = tasks.map(task => ({ ...task, files: { ...task.files } }));
drifted[0].files[Object.keys(drifted[0].files)[0]] += '\n// drift';
assert.throws(() => benchmark.validateProductionSuite(drifted), /digest mismatch/i);

function lane(solved, oracleGreen, calls = 2) {
  return { solved, modelDriven: solved, workspaceOracleGreen: oracleGreen, authoredTest: false, providerCalls: calls, providerFailures: 0, steps: 3, cost: 0.001, fixtureRoot: 'disposable-fixture' };
}

function rawReport({ live = true, solvedCount = 8, bareSolvedCount = 0, falseSuccessIndex = -1 } = {}) {
  const results = tasks.map((task, index) => {
    const solved = index < solvedCount;
    const falseSuccess = index === falseSuccessIndex;
    return {
      id: task.id,
      title: task.title,
      kind: task.kind,
      bare: lane(index < bareSolvedCount, index < bareSolvedCount, 1),
      harness: lane(solved, solved || falseSuccess, 2)
    };
  });
  return {
    runId: `production-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt: new Date().toISOString(),
    passed: solvedCount > bareSolvedCount,
    status: solvedCount > bareSolvedCount ? 'uplift_observed' : 'no_uplift_observed',
    partial: false,
    completedTaskCount: 16,
    tier: 91,
    generatedAt: new Date().toISOString(),
    modelId: 'qwen/qwen-2.5-7b-instruct',
    live,
    taskCount: 16,
    bareSolved: bareSolvedCount,
    harnessSolved: solvedCount,
    solveRateDelta: (solvedCount - bareSolvedCount) / 16,
    byKind: {},
    providerCalls: results.reduce((sum, item) => sum + item.bare.providerCalls + item.harness.providerCalls, 0),
    providerFailures: 0,
    cost: results.reduce((sum, item) => sum + item.bare.cost + item.harness.cost, 0),
    reportPath: 'raw-latest.json',
    archivePath: 'raw-progress-archive.json',
    tasks: results
  };
}

const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-production-benchmark-'));
try {
  const raw = rawReport();
  const benchmarkOnly = benchmark.buildProductionBenchmarkReport(raw, reportRoot, 4800);
  assert.equal(benchmarkOnly.benchmarkPassed, false);
  assert.equal(benchmarkOnly.floorResults.immutableArchive, false);
  assert.equal(benchmarkOnly.releaseReady, false);
  assert.equal(benchmarkOnly.harnessModelDrivenSolved, 8);
  assert.equal(benchmarkOnly.falseSuccessCount, 0);
  assert.equal(benchmarkOnly.averageWallClockPerProviderCallMs, 100);
  assert.equal(benchmarkOnly.fallbackSolved, 0);

  const attested = benchmark.buildProductionBenchmarkReport(rawReport(), reportRoot, 4800, {
    extensionVersion: '0.91.0',
    vsixSha256: 'A'.repeat(64),
    vscodeInstalled: true,
    antigravityInstalled: true,
    nativeReportOpened: true
  });
  assert.equal(attested.releaseReady, false);

  const falseSuccess = benchmark.buildProductionBenchmarkReport(rawReport({ solvedCount: 8, falseSuccessIndex: 9 }), reportRoot, 4800);
  assert.equal(falseSuccess.falseSuccessCount, 1);
  assert.equal(falseSuccess.benchmarkPassed, false);

  const noUplift = benchmark.buildProductionBenchmarkReport(rawReport({ solvedCount: 4, bareSolvedCount: 4 }), reportRoot, 4800);
  assert.equal(noUplift.floorResults.uplift, false);
  assert.equal(noUplift.benchmarkPassed, false);

  const scripted = benchmark.buildProductionBenchmarkReport(rawReport({ live: false }), reportRoot, 4800);
  assert.equal(scripted.floorResults.live, false);
  assert.equal(scripted.benchmarkPassed, false);

  const duplicateRaw = rawReport();
  duplicateRaw.tasks[15] = { ...duplicateRaw.tasks[0] };
  assert.throws(() => benchmark.buildProductionBenchmarkReport(duplicateRaw, reportRoot, 4800), /task identities/i);

  const partialRaw = rawReport();
  partialRaw.partial = true;
  assert.throws(() => benchmark.buildProductionBenchmarkReport(partialRaw, reportRoot, 4800), /partial/i);

  const persisted = benchmark.persistProductionBenchmarkReport(benchmarkOnly);
  assert.equal(persisted.benchmarkPassed, true);
  assert.equal(persisted.releaseReady, false);
  const firstBytes = fs.readFileSync(persisted.archivePath, 'utf8');
  assert.throws(() => benchmark.persistProductionBenchmarkReport(persisted), /already exists/i);
  assert.equal(fs.readFileSync(persisted.archivePath, 'utf8'), firstBytes);
  assert.equal(JSON.parse(fs.readFileSync(persisted.reportPath, 'utf8')).archiveImmutable, true);

  console.log(JSON.stringify({
    pass: true,
    taskCount: tasks.length,
    suiteDigest: suite.suiteDigest,
    benchmarkPassedAfterArchive: persisted.benchmarkPassed,
    releaseReadyWithoutInstall: persisted.releaseReady,
    releaseReadyWithInstall: benchmark.persistProductionBenchmarkReport(attested).releaseReady,
    falseSuccessRejected: !falseSuccess.benchmarkPassed,
    scriptedRejected: !scripted.benchmarkPassed,
    immutableArchive: true
  }, null, 2));
} finally {
  fs.rmSync(reportRoot, { recursive: true, force: true });
}

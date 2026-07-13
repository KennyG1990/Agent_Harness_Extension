#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readArgs(argv) {
  const options = { reportRoot: process.cwd(), confirmLiveSpend: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') options.model = argv[++index];
    if (arg === '--live') options.live = true;
    if (arg === '--confirm-credit-spend') options.confirmLiveSpend = true;
    if (arg === '--tasks') options.taskLimit = Number(argv[++index]);
    if (arg === '--max-steps') options.maxHarnessSteps = Number(argv[++index]);
    if (arg === '--call-timeout-ms') options.providerCallTimeoutMs = Number(argv[++index]);
    if (arg === '--keep-fixtures') options.keepFixtures = true;
  }
  if (options.live !== true) throw new Error('Production benchmark is live-only. Pass --live and explicit --confirm-credit-spend when provider spend is authorized.');
  return options;
}

const compiled = path.join(process.cwd(), 'out', 'harness', 'productionBenchmark.js');
const { runProductionBenchmark } = await import(pathToFileURL(compiled).href);
const report = await runProductionBenchmark(readArgs(process.argv.slice(2)));
console.log(JSON.stringify({
  runId: report.runId,
  modelId: report.modelId,
  taskCount: report.taskCount,
  bareSolved: report.bareSolved,
  harnessSolved: report.harnessSolved,
  harnessModelDrivenSolved: report.harnessModelDrivenSolved,
  falseSuccessCount: report.falseSuccessCount,
  providerCalls: report.providerCalls,
  providerFailures: report.providerFailures,
  costUsd: report.costUsd,
  wallClockMs: report.wallClockMs,
  benchmarkPassed: report.benchmarkPassed,
  releaseReady: report.releaseReady,
  reportPath: report.reportPath,
  archivePath: report.archivePath
}, null, 2));

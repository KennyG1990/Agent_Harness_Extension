#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readArgs(argv) {
  const options = { reportRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') options.model = argv[++index];
    if (arg === '--live') options.live = true;
    if (arg === '--tasks') options.taskLimit = Number(argv[++index]);
    if (arg === '--keep-fixtures') options.keepFixtures = true;
  }
  return options;
}

const compiled = path.join(process.cwd(), 'out', 'harness', 'weakEval.js');
const { WeakModelEvalRunner } = await import(pathToFileURL(compiled).href);
const options = readArgs(process.argv.slice(2));
const report = await new WeakModelEvalRunner().run(options);

console.log(JSON.stringify({
  status: report.status,
  modelId: report.modelId,
  live: report.live,
  taskCount: report.taskCount,
  bareSolved: report.bareSolved,
  harnessSolved: report.harnessSolved,
  solveRateDelta: report.solveRateDelta,
  actuallyModelDriven: report.actuallyModelDriven,
  fallbackSolved: report.fallbackSolved,
  providerCalls: report.providerCalls,
  providerFailures: report.providerFailures,
  reportPath: report.reportPath
}, null, 2));

if (!report.reportPath) {
  process.exitCode = 1;
}

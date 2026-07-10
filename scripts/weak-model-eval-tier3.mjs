#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readArgs(argv) {
  const options = { reportRoot: process.cwd(), tier: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') options.model = argv[++index];
    if (arg === '--live') options.live = true;
    if (arg === '--tasks') options.taskLimit = Number(argv[++index]);
    if (arg === '--keep-fixtures') options.keepFixtures = true;
    if (arg === '--max-steps') options.maxHarnessSteps = Number(argv[++index]);
    if (arg === '--call-timeout-ms') options.providerCallTimeoutMs = Number(argv[++index]);
    if (arg === '--swarm') options.includeSwarmLane = true;
    if (arg === '--dispatch') options.dispatch = true;
    if (arg === '--architect') options.includeArchitectLane = true;
    if (arg === '--architect-model') options.architectModel = argv[++index];
  }
  return options;
}

const tier2Compiled = path.join(process.cwd(), 'out', 'harness', 'weakEvalTier2.js');
const tier3Compiled = path.join(process.cwd(), 'out', 'harness', 'weakEvalTier3.js');
const { Tier2EvalRunner } = await import(pathToFileURL(tier2Compiled).href);
const { tier3Tasks, MockTier3Provider } = await import(pathToFileURL(tier3Compiled).href);
const { OpenRouterProvider } = await import(pathToFileURL(path.join(process.cwd(), 'out', 'harness', 'provider.js')).href);

const options = readArgs(process.argv.slice(2));
options.tasks = tier3Tasks();
const runner = new Tier2EvalRunner(live => (live ? new OpenRouterProvider() : new MockTier3Provider()));
const report = await runner.run(options);

console.log(JSON.stringify({
  runId: report.runId,
  status: report.status,
  tier: report.tier,
  modelId: report.modelId,
  live: report.live,
  taskCount: report.taskCount,
  bareSolved: report.bareSolved,
  harnessSolved: report.harnessSolved,
  swarmSolved: report.swarmSolved,
  architectSolved: report.architectSolved,
  dispatchSolved: report.dispatchSolved,
  solveRateDelta: report.solveRateDelta,
  byKind: report.byKind,
  providerCalls: report.providerCalls,
  providerFailures: report.providerFailures,
  partial: report.partial,
  completedTaskCount: report.completedTaskCount,
  reportPath: report.reportPath,
  archivePath: report.archivePath
}, null, 2));

if (!report.reportPath) {
  process.exitCode = 1;
}

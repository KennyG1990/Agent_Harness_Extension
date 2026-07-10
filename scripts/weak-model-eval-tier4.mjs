#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readArgs(argv) {
  const options = { reportRoot: process.cwd(), tier: 4 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') options.model = argv[++index];
    if (arg === '--live') options.live = true;
    if (arg === '--tasks') options.taskLimit = Number(argv[++index]);
    if (arg === '--keep-fixtures') options.keepFixtures = true;
    if (arg === '--max-steps') options.maxHarnessSteps = Number(argv[++index]);
    if (arg === '--call-timeout-ms') options.providerCallTimeoutMs = Number(argv[++index]);
    if (arg === '--swarm') options.includeSwarmLane = true;
    if (arg === '--architect') options.includeArchitectLane = true;
    if (arg === '--architect-model') options.architectModel = argv[++index];
  }
  return options;
}

const out = rel => pathToFileURL(path.join(process.cwd(), 'out', 'harness', rel)).href;
const { Tier2EvalRunner } = await import(out('weakEvalTier2.js'));
const { tier4Tasks, assertNoLeak, proveTier4SuiteSolvable, MockTier4Provider } = await import(out('weakEvalTier4.js'));
const { OpenRouterProvider } = await import(out('provider.js'));

const tasks = tier4Tasks();
for (const task of tasks) assertNoLeak(task); // THE LEAK LAW: refuse to run a leaking suite.
proveTier4SuiteSolvable(tasks); // Refuse unsolvable fixtures; applies PROVEN_EXTRA for coordinated edits.

const options = readArgs(process.argv.slice(2));
options.tasks = tasks;
options.maxHarnessSteps = options.maxHarnessSteps || 10;
if (options.live && !options.providerCallTimeoutMs) {
  options.providerCallTimeoutMs = 90000;
}
const runner = new Tier2EvalRunner(live => (live ? new OpenRouterProvider() : new MockTier4Provider()));
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

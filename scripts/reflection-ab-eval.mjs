#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readArgs(argv) {
  const options = { reportRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tasks') options.taskLimit = Number(argv[++index]);
    if (arg === '--max-steps') options.maxSteps = Number(argv[++index]);
    if (arg === '--keep-fixtures') options.keepFixtures = true;
  }
  return options;
}

const compiled = path.join(process.cwd(), 'out', 'harness', 'reflectionAb.js');
const { runReflectionAbEval } = await import(pathToFileURL(compiled).href);
const options = readArgs(process.argv.slice(2));
const report = await runReflectionAbEval(options);

console.log(JSON.stringify({
  status: report.status,
  passed: report.passed,
  taskCount: report.taskCount,
  reflectionOnSolved: report.reflectionOnSolved,
  reflectionOffSolved: report.reflectionOffSolved,
  solveRateDelta: report.solveRateDelta,
  offLaneHonestHalts: report.offLaneHonestHalts,
  reportPath: report.reportPath
}, null, 2));

if (!report.passed) {
  process.exitCode = 1;
}

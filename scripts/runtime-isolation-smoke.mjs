import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Firewall } from '../out/harness/firewall.js';
import { classifyCommandAuthority, decideRuntimeIsolation, probeRuntimeBackends } from '../out/harness/runtimeIsolation.js';
import { ProcessWorkerExecutor } from '../out/harness/workerExecutor.js';
import { WorkspaceTools } from '../out/harness/tools.js';

const assessmentCases = [
  ['rg -n TODO src', 'read'],
  ['git diff -- src/a.ts', 'read'],
  ['npm run test', 'verify'],
  ['npm install zod', 'network-read'],
  ['git push origin main', 'network-write'],
  ['node -e "require(\'http\').get(\'http://127.0.0.1:9\')"', 'unknown'],
  ['rg TODO src > result.txt', 'unknown'],
  ['Get-Content package.json; curl http://example.com', 'network-read'],
  ['powershell -EncodedCommand ZQBjAGgAbwAgAHgA', 'unknown']
];
for (const [command, expected] of assessmentCases) assert.equal(classifyCommandAuthority(command).authority, expected, command);

const unavailableProbes = [
  { backend: 'node-permission', available: true, filesystemIsolated: true, networkIsolated: false, processLimited: true, reason: 'fixture', probedAt: new Date().toISOString() },
  { backend: 'docker', available: false, filesystemIsolated: false, networkIsolated: false, processLimited: false, reason: 'fixture unavailable', probedAt: new Date().toISOString() }
];
assert.equal(decideRuntimeIsolation('node -e "console.log(1)"', unavailableProbes).allowed, false);
assert.equal(decideRuntimeIsolation('npm install zod', unavailableProbes).grade, 'strict-unavailable');
assert.equal(decideRuntimeIsolation('git push origin main', unavailableProbes).allowed, false);
assert.equal(decideRuntimeIsolation('npm run test', unavailableProbes).allowed, true);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-runtime-isolation-'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
fs.writeFileSync(path.join(root, 'target.txt'), 'before');
const firewall = new Firewall(new WorkspaceTools(root));
assert.equal((await firewall.validateProposal({ name: 'run_command', arguments: { command: 'rg target .' } })).valid, true);
const mismatch = await firewall.validateProposal({ name: 'run_command', arguments: { command: 'rg target .', expectedAuthority: 'workspace-write' } });
assert.equal(mismatch.valid, false);
assert.match(mismatch.reason || '', /command_authority_mismatch/);
const inline = await firewall.validateProposal({ name: 'run_command', arguments: { command: 'node -e "console.log(1)"' } });
assert.equal(inline.valid, false);
assert.match(inline.reason || '', /strict_isolation_unavailable/);

const worker = new ProcessWorkerExecutor();
const write = await worker.dispatch(root, 'Editor', { name: 'write_file', arguments: { path: 'target.txt', content: 'after' } });
assert.equal(write.success, true);
assert.equal(write.worker.isolationGrade, 'node-permission');
assert.equal(write.worker.filesystemRestricted, true);
assert.equal(write.worker.childProcessAllowed, false);
assert.equal(write.worker.memoryLimitMb, 384);
assert.equal(write.worker.outputLimitBytes, 2 * 1024 * 1024);
assert.equal(fs.readFileSync(path.join(root, 'target.txt'), 'utf8'), 'after');

const timeout = await worker.dispatch(root, 'Reviewer', { name: 'run_command', arguments: { command: 'node -e "setTimeout(()=>{},10000)"' } }, 250);
assert.equal(timeout.success, false);
assert.equal(timeout.worker.timedOut, true);
assert.equal(timeout.worker.processTreeTerminated, true);

const probes = probeRuntimeBackends();
assert.ok(probes.some(item => item.backend === 'node-permission'));
assert.ok(probes.every(item => typeof item.reason === 'string' && item.probedAt));
console.log(JSON.stringify({ pass: true, assessments: assessmentCases.length, probes, worker: write.worker, timeout: timeout.worker }, null, 2));

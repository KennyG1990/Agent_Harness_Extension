import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { writeSupportReport } = await import(pathToFileURL(path.resolve('out/harness/supportBundle.js')).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-support-report-'));
fs.mkdirSync(path.join(root, '.forge'), { recursive: true });
fs.writeFileSync(path.join(root, '.forge', 'state.json'), '{}');
const secret = 'sk-or-v1-super-secret-do-not-leak';
const goal = 'private customer goal text must not leak';
const report = writeSupportReport(root, {
  extensionVersion: 'test', ideName: 'Antigravity', ideVersion: 'test', platform: 'win32', architecture: 'x64'
}, {
  ready: false,
  apiKey: secret,
  authentication: { status: 'invalid', authorization: `Bearer ${secret}` },
  catalog: { status: 'live', modelCount: 340 },
  blockers: [{ code: 'credential_invalid', message: `Rejected ${secret}` }]
}, {
  status: 'gave_up', currentStepIndex: 3, maxSteps: 8,
  goalContract: { goal }, files: { 'src/private.ts': 'private source text' },
  firewall: { stage: 'NARRATE', details: `Failure at ${root}` },
  modePolicy: { id: 'custom-safe' },
  oracleStatuses: { tests: 'fail', build: 'pass' },
  runStats: { providerCalls: 4, providerFailures: 1, reflectionAttempts: 2 }
});

const serialized = `${fs.readFileSync(report.jsonPath, 'utf8')}\n${fs.readFileSync(report.markdownPath, 'utf8')}`;
for (const forbidden of [secret, goal, 'private source text', path.resolve(root)]) assert.equal(serialized.includes(forbidden), false, `support report leaked: ${forbidden}`);
assert.equal(report.report.workspace.name, path.basename(root));
assert.equal(report.report.run?.counters.providerCalls, 4);
assert.equal(report.report.provider.blockerCodes[0], 'credential_invalid');
assert.match(serialized, /excludes source code, prompts, chat messages, credentials/i);
const globalStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-support-global-'));
const noWorkspace = writeSupportReport(undefined, {
  extensionVersion: 'test', ideName: 'Antigravity', ideVersion: 'test', platform: 'win32', architecture: 'x64'
}, { ready: false, authentication: { status: 'skipped' }, catalog: { status: 'fallback', modelCount: 0 }, blockers: [{ code: 'workspace_missing' }] }, undefined, globalStorage);
assert.equal(noWorkspace.report.workspace.open, false);
assert.equal(noWorkspace.markdownPath.startsWith(globalStorage), true, 'pre-workspace support report must use extension global storage.');
fs.rmSync(globalStorage, { recursive: true, force: true });
console.log(JSON.stringify({ passed: true, reportId: report.report.reportId, privacy: report.report.privacy }, null, 2));
fs.rmSync(root, { recursive: true, force: true });

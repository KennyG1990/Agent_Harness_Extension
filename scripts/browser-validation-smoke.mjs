import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BrowserValidationRunner, validateBrowserUrl } from '../out/harness/browserValidation.js';
import { Firewall } from '../out/harness/firewall.js';
import { WorkspaceTools } from '../out/harness/tools.js';
import { AgentHarnessLoop } from '../out/harness/loop.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-browser-validation-'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (request.url === '/console-error') {
    response.end('<!doctype html><title>Error page</title><main>Rendered error fixture</main><script>console.error("fixture console failure")</script>');
    return;
  }
  response.end('<!doctype html><title>Forge Browser Proof</title><main><h1>Visible Forge application</h1><button>Run task</button></main>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.equal(typeof address, 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const runner = new BrowserValidationRunner(root);
  const pass = await runner.run({ url: baseUrl, expectedText: 'Visible Forge application' });
  assert.equal(pass.success, true, pass.output);
  assert.equal(pass.evidence.status, 'pass');
  assert.equal(pass.evidence.expectedTextFound, true);
  assert.ok(pass.evidence.screenshotPath && fs.existsSync(path.join(root, pass.evidence.screenshotPath)));

  const missing = await runner.run({ url: baseUrl, expectedText: 'text that is not rendered' });
  assert.equal(missing.success, false);
  assert.match(missing.output, /Expected visible text was not found/);

  const consoleError = await runner.run({ url: `${baseUrl}/console-error`, expectedText: 'Rendered error fixture' });
  assert.equal(consoleError.success, false);
  assert.equal(consoleError.evidence.consoleErrors.some(item => item.includes('fixture console failure')), true);

  const unreachable = await runner.run({ url: 'http://127.0.0.1:1', timeoutMs: 1000 });
  assert.equal(unreachable.success, false);
  assert.match(unreachable.output, /Browser validation failed/);

  assert.equal(validateBrowserUrl('https://example.com').valid, false);
  assert.equal(validateBrowserUrl('file:///tmp/index.html').valid, false);
  assert.equal(validateBrowserUrl('http://user:pass@localhost:3000').valid, false);
  const firewall = new Firewall(new WorkspaceTools(root));
  const remote = await firewall.validateProposal({ name: 'browser_validate', arguments: { url: 'https://example.com' } });
  assert.equal(remote.valid, false);
  assert.match(remote.reason || '', /non-loopback/);

  const provider = {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async () => ({
      text: JSON.stringify({
        explanation: 'Validate the rendered local application before success.',
        confidence: 95,
        materialUncertainty: false,
        uncertainties: [],
        proposal: { name: 'browser_validate', arguments: { url: baseUrl, expectedText: 'Run task' } }
      })
    })
  };
  const loop = new AgentHarnessLoop(provider, root, undefined);
  let state = await loop.initializeHarness('Validate the local application in a real browser.');
  state.taskGraph.tasks = [{ id: 'browser-review', title: 'Browser verification', status: 'running', dependencies: [], blockers: [], owner: 'Reviewer' }];
  for (const stage of state.workflow.stages) stage.status = stage.id === 'verify' ? 'running' : ['review', 'evidence', 'close'].includes(stage.id) ? 'pending' : 'completed';
  state.workflow.currentStage = 'verify';
  state = await loop.runStep(state, { review: 'scripted-browser-reviewer' });
  assert.equal(state.runStats.modelDrivenProposals, 1);
  assert.equal(state.browserValidations.length, 1);
  assert.equal(state.browserValidations[0].status, 'pass');
  assert.equal(state.evidenceLedger.some(item => item.stepTitle.startsWith('Browser validation:')), true);
  assert.equal(state.lastOraclePass, false, 'browser evidence must not impersonate the composite code oracle.');
  assert.notEqual(state.status, 'success', 'browser evidence alone must never terminal success.');

  const latest = path.join(root, '.forge', 'browser-runs', 'latest-browser-validation.json');
  const latestPng = path.join(root, '.forge', 'browser-runs', 'latest-browser-validation.png');
  assert.ok(fs.existsSync(latest));
  assert.ok(fs.existsSync(latestPng));
  const finalEvidence = JSON.parse(fs.readFileSync(latest, 'utf8'));
  console.log(JSON.stringify({ passed: true, root, baseUrl, agentToolStatus: state.browserValidations[0].status, latest, latestPng, finalEvidence }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
}

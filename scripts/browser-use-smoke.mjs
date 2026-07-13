import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BrowserUseRunner } from '../out/harness/browserUse.js';
import { Firewall } from '../out/harness/firewall.js';
import { WorkspaceTools } from '../out/harness/tools.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-browser-use-'));
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Forge Browser Use</title><main>
    <label>Name <input aria-label="Name" /></label>
    <button onclick="document.querySelector('output').textContent='clicked'">Run task</button>
    <output>idle</output>
  </main>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.equal(typeof address, 'object');
const url = `http://127.0.0.1:${address.port}`;

try {
  const runner = new BrowserUseRunner(root);
  const inspected = await runner.inspect({ url, sessionId: 'browser-use-smoke' });
  assert.equal(inspected.success, true, inspected.output);
  assert.equal(inspected.state.status, 'ready');
  assert.ok(fs.existsSync(path.join(root, inspected.state.screenshotPath)));
  const button = inspected.state.targets.find(target => target.role === 'button' && target.name === 'Run task');
  assert.ok(button, 'inspection must return a state-bound button target');

  const forged = await runner.act({ stateId: inspected.state.id, action: 'click', targetId: 'bt-0000000000000000' });
  assert.equal(forged.success, false);
  assert.match(forged.output, /target ID is not present/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, inspected.state.reportPath), 'utf8')).status, 'ready');

  const clicked = await runner.act({ stateId: inspected.state.id, action: 'click', targetId: button.id });
  assert.equal(clicked.success, true, clicked.output);
  assert.match(clicked.state.visibleTextExcerpt, /clicked/);
  assert.equal(clicked.state.previousStateId, inspected.state.id);
  assert.ok(fs.existsSync(path.join(root, clicked.state.screenshotPath)));

  const replay = await runner.act({ stateId: inspected.state.id, action: 'click', targetId: button.id });
  assert.equal(replay.success, false);
  assert.match(replay.output, /missing, stale, or already consumed/);

  const second = await runner.inspect({ url, sessionId: 'browser-use-smoke' });
  const textbox = second.state.targets.find(target => target.role === 'textbox' && target.name === 'Name');
  assert.ok(textbox);
  const filled = await runner.act({ stateId: second.state.id, action: 'fill', targetId: textbox.id, value: 'bounded input' });
  assert.equal(filled.success, true, filled.output);

  const firewall = new Firewall(new WorkspaceTools(root));
  const remote = await firewall.validateProposal({ name: 'browser_inspect', arguments: { url: 'https://example.com' } });
  assert.equal(remote.valid, false);
  const malformed = await firewall.validateProposal({ name: 'browser_action', arguments: { stateId: inspected.state.id, action: 'click', targetId: 'css=.unsafe' } });
  assert.equal(malformed.valid, false);

  console.log(JSON.stringify({ passed: true, root, url, firstState: inspected.state.id, actionState: clicked.state.id, targetCount: inspected.state.targets.length }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { SessionStore } = await import(pathToFileURL(path.resolve('out/harness/sessionStore.js')).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-session-store-'));
const sessionsRoot = path.join(root, '.forge', 'sessions');
fs.mkdirSync(sessionsRoot, { recursive: true });

function create(id, status = 'idle', title = id) {
  const dir = path.join(sessionsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ sessionId: id, status, currentStepIndex: 2, maxSteps: 10, goalContract: { goal: title, spent: 0.25 }, taskGraph: { tasks: [] }, progressEvents: [] }));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ sessionId: id, title, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }));
}

create('forge-1700000000000-healthy', 'paused', 'Healthy resumable run');
create('forge-1700000000001-terminal', 'success', 'Finished run');
create('forge-1700000000003-question', 'awaiting_input', 'Waiting for user answer');
create('forge-1700000000002-mismatch');
const mismatchPath = path.join(sessionsRoot, 'forge-1700000000002-mismatch', 'state.json');
const mismatch = JSON.parse(fs.readFileSync(mismatchPath, 'utf8')); mismatch.sessionId = 'forge-1700000000002-other'; fs.writeFileSync(mismatchPath, JSON.stringify(mismatch));
fs.writeFileSync(path.join(sessionsRoot, 'index.json'), '{broken json');

const store = new SessionStore(root);
const listed = store.list();
assert.equal(listed.sessions.length, 3, 'healthy sessions must survive corrupt index and sibling state.');
assert.equal(listed.corruptCount, 1);
assert.equal(listed.sessions.find(item => item.sessionId.endsWith('healthy')).resumable, true);
assert.equal(listed.sessions.find(item => item.sessionId.endsWith('terminal')).resumable, false);
assert.equal(listed.sessions.find(item => item.sessionId.endsWith('question')).resumable, false, 'clarification sessions must open for an answer, not auto-resume past the ask gate.');
assert.throws(() => store.load('../outside'), /Invalid Forge session ID/);
assert.throws(() => store.load('forge-1700000000009-missing'), error => /does not exist/.test(error.message) && !error.message.includes(root), 'missing-session errors must not leak workspace paths.');
assert.throws(() => store.load('forge-1700000000002-mismatch'), /identity/);

store.saveChat('forge-1700000000000-healthy', [
  { role: 'system', content: 'must be dropped' },
  { role: 'user', content: 'hello', injected: 'drop me' },
  { role: 'assistant', content: 'world', modelId: 'provider/model', arbitrary: { secret: true } }
]);
const loaded = store.load('forge-1700000000000-healthy', true);
assert.deepEqual(loaded.chat, [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'world', modelId: 'provider/model' }]);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.forge', 'state.json'), 'utf8')).sessionId, loaded.state.sessionId);
assert.equal(store.pin(loaded.state.sessionId, true).sessions[0].sessionId, loaded.state.sessionId);
assert.throws(() => store.delete(loaded.state.sessionId, loaded.state.sessionId), /active session/);
assert.equal(store.delete('forge-1700000000001-terminal').sessions.some(item => item.sessionId.endsWith('terminal')), false);
const chatOnly = store.createChat('Explain the repository architecture');
assert.equal(chatOnly.meta.kind, 'chat');
assert.equal(chatOnly.state, undefined);
store.saveChat(chatOnly.meta.sessionId, [{ role: 'user', content: 'Explain the repository architecture' }, { role: 'assistant', content: 'Here is the architecture.' }]);
assert.equal(store.loadActive().meta.sessionId, chatOnly.meta.sessionId, 'chat-only active session must survive panel reload without masquerading as a run.');
assert.equal(store.list().sessions.find(item => item.sessionId === chatOnly.meta.sessionId).resumable, false);

console.log(JSON.stringify({ passed: true, healthy: listed.sessions.length, corrupt: listed.corruptCount, chatMessages: loaded.chat.length }, null, 2));
fs.rmSync(root, { recursive: true, force: true });

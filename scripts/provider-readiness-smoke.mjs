import assert from 'node:assert/strict';
import { migrateLegacyCredential, probeProviderReadiness } from '../out/harness/providerReadiness.js';

const SECRET = 'sk-forge-secret-must-never-appear';
const response = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const validFetch = async url => {
  if (String(url).endsWith('/key')) return response(200, { data: { label: 'Forge test key' } });
  if (String(url).endsWith('/models')) return response(200, { data: Array.from({ length: 340 }, (_, id) => ({ id: `model-${id}` })) });
  throw new Error('unexpected URL');
};
const valid = await probeProviderReadiness({ provider: 'openrouter', workspaceOpen: true, apiKey: SECRET, credentialSource: 'secret-storage', fetchImpl: validFetch });
assert.equal(valid.ready, true);
assert.equal(valid.credential.valid, true);
assert.equal(valid.catalog.status, 'live');
assert.equal(valid.catalog.modelCount, 340);

const invalid = await probeProviderReadiness({
  provider: 'openrouter', workspaceOpen: true, apiKey: SECRET, credentialSource: 'secret-storage',
  fetchImpl: async url => String(url).endsWith('/key') ? response(401, {}) : response(200, { data: [{ id: 'anonymous-model' }] })
});
assert.equal(invalid.ready, false);
assert.equal(invalid.credential.valid, false);
assert.ok(invalid.blockers.some(item => item.code === 'credential_invalid'));
assert.equal(invalid.catalog.status, 'live', 'anonymous catalog availability must remain distinct from credential readiness.');

const unavailable = await probeProviderReadiness({ provider: 'openrouter', workspaceOpen: true, apiKey: SECRET, credentialSource: 'secret-storage', fetchImpl: async () => { throw new Error(`network failed for ${SECRET}`); } });
assert.equal(unavailable.ready, false);
assert.equal(unavailable.catalog.status, 'fallback');
assert.ok(unavailable.blockers.some(item => item.code === 'provider_unreachable'));

const missing = await probeProviderReadiness({ provider: 'openrouter', workspaceOpen: false, fetchImpl: async () => response(200, { data: [{ id: 'public-model' }] }) });
assert.equal(missing.ready, false);
assert.equal(missing.credential.configured, false);
assert.ok(missing.blockers.some(item => item.code === 'workspace_missing'));
assert.ok(missing.blockers.some(item => item.code === 'credential_missing'));

const local = await probeProviderReadiness({ provider: 'openai-compatible', workspaceOpen: true, openAiCompatibleBaseUrl: 'http://localhost:11434/v1', fetchImpl: async () => response(200, { data: [{ id: 'local-model' }] }) });
assert.equal(local.ready, true);
assert.equal(local.credential.required, false);
assert.equal(local.catalog.modelCount, 1);
const localFailure = await probeProviderReadiness({ provider: 'openai-compatible', workspaceOpen: true, fetchImpl: async () => { throw new Error('offline'); } });
assert.equal(localFailure.ready, false);
assert.ok(localFailure.blockers.some(item => item.code === 'provider_unreachable'));

let stored = '';
let cleared = false;
const migrated = await migrateLegacyCredential(SECRET, undefined, async value => { stored = value; }, async () => { cleared = true; });
assert.deepEqual(migrated, { configured: true, migrated: true });
assert.equal(stored, SECRET);
assert.equal(cleared, true);
const preserved = await migrateLegacyCredential(SECRET, 'existing-secret', async () => { throw new Error('must not overwrite existing secret'); }, async () => { cleared = true; });
assert.deepEqual(preserved, { configured: true, migrated: false });

for (const result of [valid, invalid, unavailable, missing, local, localFailure, migrated, preserved]) {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SECRET), false, 'readiness output must not contain submitted credential bytes.');
  assert.equal(/authorization|bearer/i.test(serialized), false, 'readiness output must not expose authorization metadata.');
}
console.log(JSON.stringify({ passed: true, valid: valid.ready, invalidBlockers: invalid.blockers.map(item => item.code), fallback: unavailable.catalog.status, local: local.ready, migration: migrated }, null, 2));

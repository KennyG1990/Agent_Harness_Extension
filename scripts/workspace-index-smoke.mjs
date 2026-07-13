import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceIndexService, MAX_WORKSPACE_INDEX_FILES } from '../out/harness/workspaceIndex.js';
import { WorkspaceTools } from '../out/harness/tools.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-workspace-index-'));
const src = path.join(root, 'src');
fs.mkdirSync(src, { recursive: true });
for (let index = 0; index < 320; index += 1) {
  fs.writeFileSync(path.join(src, `file-${String(index).padStart(4, '0')}.ts`), `export const decoy_${index} = ${index};\n`);
}
const secretBody = 'PRIVATE_SOURCE_BODY_MUST_NOT_ENTER_INDEX';
const targetPath = path.join(src, 'zzzz-target.ts');
fs.writeFileSync(targetPath, `export function HiddenBeyondLegacyCap() { return '${secretBody}'; }\n`);
fs.mkdirSync(path.join(root, 'node_modules', 'hidden'), { recursive: true });
fs.writeFileSync(path.join(root, 'node_modules', 'hidden', 'dependency.ts'), 'export const DependencyLeak = true;\n');
fs.mkdirSync(path.join(root, '.tmp', 'proof-workspace', 'src'), { recursive: true });
fs.writeFileSync(path.join(root, '.tmp', 'proof-workspace', 'src', 'duplicate.ts'), 'export const TemporaryProofLeak = true;\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'generated.ts'), 'export const GeneratedLeak = true;\n');
fs.writeFileSync(path.join(src, 'binary.ts'), Buffer.from([0, 1, 2, 3, 4]));

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-workspace-index-outside-'));
fs.writeFileSync(path.join(outside, 'outside.ts'), 'export const OutsideLeak = true;\n');
fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'junction');

const service = new WorkspaceIndexService(root);
const report = service.build();
assert.equal(report.status, 'ready');
assert.ok(report.fileCount > 300, `expected >300 indexed files, got ${report.fileCount}`);
assert.ok(report.files.some(file => file.path === 'src/zzzz-target.ts'));
assert.equal(report.files.some(file => /node_modules|\.tmp|dist|linked-outside|binary\.ts/.test(file.path)), false);
assert.ok(report.symbolCount >= 321);
const serialized = fs.readFileSync(path.join(root, '.forge', 'workspace-index.json'), 'utf8');
assert.equal(serialized.includes(secretBody), false, 'workspace index must not serialize source bodies');

const tools = new WorkspaceTools(root);
const repoResult = await tools.repoSearch(secretBody);
assert.equal(repoResult.success, true);
assert.match(repoResult.output, /src[\\/]zzzz-target\.ts/);
assert.match(repoResult.output, /workspace-index/);
const symbolResult = await tools.symbolSearch('HiddenBeyondLegacyCap');
assert.equal(symbolResult.success, true);
assert.match(symbolResult.output, /src\/zzzz-target\.ts:1/);
assert.match(symbolResult.output, /workspace-index .*symbols/);

assert.equal(service.status().status, 'ready');
assert.equal(service.markStale('test_change').status, 'stale');
assert.equal(service.load()?.fingerprint, report.fingerprint, 'stale index remains validated and usable');
assert.equal(service.build().status, 'ready');
assert.equal(service.status().status, 'ready');

const crossRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-workspace-index-cross-'));
fs.mkdirSync(path.join(crossRoot, '.forge'), { recursive: true });
fs.copyFileSync(path.join(root, '.forge', 'workspace-index.json'), path.join(crossRoot, '.forge', 'workspace-index.json'));
assert.equal(new WorkspaceIndexService(crossRoot).load(), null, 'cross-workspace index must reject');

const validText = fs.readFileSync(path.join(root, '.forge', 'workspace-index.json'), 'utf8');
fs.writeFileSync(path.join(root, '.forge', 'workspace-index.json'), '{broken', 'utf8');
assert.equal(service.load(), null, 'corrupt index must reject');
fs.writeFileSync(path.join(root, '.forge', 'workspace-index.json'), validText, 'utf8');

const lateDir = path.join(root, 'src', 'late');
fs.mkdirSync(lateDir, { recursive: true });
fs.writeFileSync(path.join(lateDir, 'pivot.ts'), 'export const SafeBeforePivot = true;\n');
service.build();
fs.rmSync(lateDir, { recursive: true, force: true });
const outsidePivot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-workspace-index-pivot-'));
fs.writeFileSync(path.join(outsidePivot, 'pivot.ts'), 'export const EscapedAfterPivot = true;\n');
fs.symlinkSync(outsidePivot, lateDir, 'junction');
assert.equal(service.load(), null, 'post-build junction pivot must invalidate the index');

assert.equal(MAX_WORKSPACE_INDEX_FILES, 5000);
console.log(JSON.stringify({ passed: true, fileCount: report.fileCount, symbolCount: report.symbolCount, beyondLegacyCap: true, sourceBodiesExcluded: true, junctionsRejected: true, staleLifecycle: true, maxFiles: MAX_WORKSPACE_INDEX_FILES }, null, 2));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { ComposerContextService } = await import(pathToFileURL(path.resolve('out/harness/composerContext.js')).href);
const { SessionStore } = await import(pathToFileURL(path.resolve('out/harness/sessionStore.js')).href);
const { AgentHarnessLoop } = await import(pathToFileURL(path.resolve('out/harness/loop.js')).href);
const { WorkspaceIndexService } = await import(pathToFileURL(path.resolve('out/harness/workspaceIndex.js')).href);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-composer-context-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-composer-outside-'));
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'math.ts'), 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
fs.writeFileSync(path.join(root, 'src', 'binary.bin'), Buffer.from([1, 0, 2]));
fs.writeFileSync(path.join(root, 'src', 'large.ts'), 'x'.repeat(64 * 1024 + 1));
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
fs.writeFileSync(path.join(root, 'src', 'diagram.png'), pngBytes);
fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'nested', 'helper.ts'), "import { add } from '../math';\nexport const folderSourceSentinel = add(20, 22);\n");
fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = true;');

const service = new ComposerContextService(root);
const workspaceIndex = new WorkspaceIndexService(root);
const indexReport = workspaceIndex.build();
const mathMentions = workspaceIndex.searchMentions('math');
assert.equal(mathMentions.provenance, 'ready');
assert.equal(mathMentions.candidates[0].path, 'src/math.ts', 'exact basename matches must rank first.');
assert.ok(workspaceIndex.searchMentions('src').candidates.some(item => item.kind === 'folder' && item.path === 'src'), 'indexed paths must derive folder candidates.');
const symbolMention = workspaceIndex.searchMentions('add').candidates.find(item => item.kind === 'symbol' && item.symbolName === 'add');
assert.ok(symbolMention, 'exact indexed symbols must be searchable through the @ mention path.');
assert.equal(symbolMention.path, 'src/math.ts');
assert.ok(workspaceIndex.searchMentions('', 999).candidates.length <= 20, 'mention results must enforce the host cap.');
const file = service.captureFile(path.join(root, 'src', 'math.ts'));
assert.equal(file.path, 'src/math.ts');
assert.match(file.content, /return a \+ b/);
const selection = service.captureSelection(path.join(root, 'src', 'math.ts'), 1, 2, 'function add');
assert.equal(selection.label, 'math.ts:1-2');
const diagnostics = service.captureDiagnostics([
  { path: path.join(root, 'src', 'math.ts'), line: 2, severity: 'Error', message: 'Expected number\nbut got string' },
  { path: path.join(outside, 'secret.ts'), line: 1, severity: 'error', message: 'must be dropped' }
]);
const folder = service.captureFolder('src/nested', indexReport.files.map(item => item.path));
assert.equal(folder.kind, 'folder');
assert.match(folder.content, /src\/nested\/helper\.ts/);
assert.doesNotMatch(folder.content, /folderSourceSentinel/, 'folder context must contain paths, not source bodies.');
const symbol = service.captureSymbol(symbolMention.path, symbolMention.symbolName, symbolMention.line, indexReport.files);
assert.equal(symbol.kind, 'symbol');
assert.match(symbol.content, /Declaration src\/math\.ts:1/);
assert.match(symbol.content, /Exact-name neighbor src\/nested\/helper\.ts:1/);
assert.deepEqual(symbol.neighborPaths, ['src/nested/helper.ts']);
assert.throws(() => service.captureSymbol('src/math.ts', 'add', 99, indexReport.files), /stale/);
assert.throws(() => service.captureSymbol('src/math.ts', '../add', 1, indexReport.files), /invalid/);
const image = service.captureImage('src/diagram.png');
assert.equal(image.kind, 'image');
assert.equal(image.mimeType, 'image/png');
assert.equal(image.byteCount, pngBytes.length);
assert.equal(service.providerImageParts([image])[0].image_url.url.startsWith('data:image/png;base64,'), true);
assert.equal('content' in service.summaries([image])[0], false);
fs.writeFileSync(path.join(root, 'src', 'diagram.png'), Buffer.concat([pngBytes, Buffer.from([1])]));
assert.throws(() => service.providerImageParts([image]), /changed after capture/);
fs.writeFileSync(path.join(root, 'src', 'diagram.png'), pngBytes);
assert.throws(() => service.captureImage('src/math.ts'), /PNG, JPEG, and WebP/);
assert.throws(() => service.captureFolder('../outside', indexReport.files.map(item => item.path)), /inside the open workspace|outside/);
assert.equal(diagnostics.diagnosticCount, 1);
assert.doesNotMatch(diagnostics.content, /secret/);
assert.throws(() => service.captureFile(path.join(outside, 'secret.ts')), /inside the open workspace|outside/);
assert.throws(() => service.captureFile(path.join(root, 'src', 'binary.bin')), /Binary/);
assert.throws(() => service.captureFile(path.join(root, 'src', 'large.ts')), /64 KiB/);
assert.throws(() => service.captureSelection(path.join(root, 'src', 'math.ts'), 1, 1, ''), /non-empty/);

let attachments = service.append([], file);
attachments = service.append(attachments, selection);
attachments = service.append(attachments, diagnostics);
attachments = service.append(attachments, folder);
attachments = service.append(attachments, symbol);
attachments = service.append(attachments, image);
assert.equal(attachments.length, 6);
assert.equal(service.summaries(attachments).some(item => 'content' in item), false, 'webview summaries must not contain source text.');

const store = new SessionStore(root);
const session = store.createChat('Context persistence');
store.saveContext(session.meta.sessionId, attachments);
assert.equal(store.load(session.meta.sessionId).context.length, 6, 'session reload must restore validated context.');
const contextPath = path.join(root, '.forge', 'sessions', session.meta.sessionId, 'context.json');
fs.writeFileSync(contextPath, JSON.stringify([{ ...file, path: '../outside.ts' }]));
assert.equal(store.load(session.meta.sessionId).context.length, 0, 'tampered persisted paths must be dropped.');

const dense = 'z'.repeat(60 * 1024);
let bounded = [];
for (let index = 0; index < 3; index += 1) bounded = service.append(bounded, service.captureSelection(path.join(root, 'src', 'math.ts'), index + 1, index + 1, `${index}${dense}`));
assert.throws(() => service.append(bounded, service.captureSelection(path.join(root, 'src', 'math.ts'), 9, 9, `four${dense}`)), /192 KiB/);

const loop = new AgentHarnessLoop(undefined, root, undefined);
const state = await loop.initializeHarness('Fix the attached function.', {}, {}, { userContext: [file, diagnostics, folder, symbol] });
assert.equal(state.userContext.length, 4);
const prompt = loop.systemPrompt(state, state.taskGraph.tasks[0]);
assert.match(prompt, /User-attached workspace context/);
assert.match(prompt, /src\/math\.ts/);
assert.match(prompt, /return a \+ b/);
assert.match(prompt, /src\/nested\/helper\.ts/);
assert.equal(folder.content.includes('folderSourceSentinel'), false, 'folder attachments remain path-only even when a separate symbol attachment includes a bounded neighbor source window.');
assert.match(prompt, /Exact-name neighbor src\/nested\/helper\.ts:1/);
assert.ok(state.contextBundle.includedSections.includes('user-attached-context'), 'attached context must be a required budgeted prompt section.');

console.log(JSON.stringify({ passed: true, attachments: attachments.length, promptChars: prompt.length, persisted: true, sourceExcludedFromWebview: true }, null, 2));
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });

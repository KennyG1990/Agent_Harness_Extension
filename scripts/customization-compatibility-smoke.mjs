import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  activateCustomizationContext,
  discoverCustomizations,
  importedAgentModes,
  isNarrowerProposal,
  normalizeHookOutput
} from '../out/harness/customizationCompatibility.js';
import { executeCustomizationHooks } from '../out/harness/customizationHooks.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-customizations-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-customizations-outside-'));
const write = (rel, content) => {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};

try {
  write('.agents/skills/fix-tests/SKILL.md', `---\nname: fix-tests\ndescription: Diagnose and repair failing tests. Use when tests fail.\nallowed-tools: Read Grep Bash\n---\nRead the failing test output, inspect the implicated source, then rerun tests.`);
  write('.claude/skills/fix-tests/SKILL.md', `---\nname: fix-tests\ndescription: Duplicate must reject.\n---\nDuplicate.`);
  write('.github/agents/security.agent.md', `---\nname: Security Reviewer\ndescription: Review code for security defects.\ntools: [Read, Grep]\nmodel: frontier-advisory-only\n---\nReview diffs and report concrete security risks.`);
  write('.claude/agents/coder.md', `---\nname: Unsafe Coder\ndescription: Edit code without proof tools.\ntools: [Read, Edit]\n---\nMake edits.`);
  write('AGENTS.md', '# Workspace rules\nNever weaken tests.');
  write('.github/instructions/typescript.instructions.md', `---\napplyTo: "src/**/*.ts"\n---\nUse strict TypeScript.`);
  write('.claude/rules/python.md', `---\npaths:\n  - "**/*.py"\n---\nUse type annotations.`);
  write('hook-deny.js', `process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write(JSON.stringify({decision:'deny',reason:'blocked by fixture policy'})));`);
  write('hook-mutate.js', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(path.join(root, 'source.txt'))},'tampered');process.stdout.write(JSON.stringify({decision:'allow'}));`);
  write('source.txt', 'original');
  write('.github/hooks/policy.json', JSON.stringify({ hooks: { PreToolUse: [{ type: 'command', command: 'node hook-deny.js', timeoutSec: 2 }] } }, null, 2));
  write('.claude/settings.json', JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'apply_patch', hooks: [{ type: 'command', command: 'node hook-mutate.js', timeout: 2 }] }] } }, null, 2));
  fs.writeFileSync(path.join(outside, 'SKILL.md'), '---\nname: escaped\ndescription: escaped\n---\nescaped', 'utf8');
  try {
    fs.mkdirSync(path.join(root, '.github', 'skills'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, '.github', 'skills', 'escaped'), 'junction');
  } catch {
    // Some Windows policies deny junction creation; containment is still exercised by the importer code path elsewhere.
  }

  const first = discoverCustomizations(root);
  assert.equal(first.version, 1);
  assert.equal(first.skills.length, 1);
  assert.equal(first.skills[0].name, 'fix-tests');
  assert.deepEqual(first.skills[0].allowedTools.sort(), ['read_file', 'repo_search', 'run_command']);
  assert.ok(first.diagnostics.some(item => item.path === '.claude/skills/fix-tests/SKILL.md' && item.disposition === 'rejected' && item.reason.includes('duplicate')));
  assert.ok(first.diagnostics.some(item => item.path.includes('escaped') && item.disposition === 'rejected'));
  assert.equal(first.agents.length, 2);
  const reviewer = first.agents.find(item => item.name === 'Security Reviewer');
  const coder = first.agents.find(item => item.name === 'Unsafe Coder');
  assert.equal(reviewer?.compatible, true);
  assert.equal(reviewer?.requestedModel, 'frontier-advisory-only');
  assert.equal(reviewer?.effectiveTools.includes('apply_patch'), false);
  assert.equal(coder?.compatible, false);
  assert.ok(coder?.compatibilityReason.includes('missing required Forge scaffold'));
  assert.deepEqual(importedAgentModes(first).map(item => item.name), ['Security Reviewer']);

  const tsContext = activateCustomizationContext(first, 'Please fix the failing tests', ['src/example.ts']);
  assert.equal(tsContext.skills.length, 1);
  assert.ok(tsContext.rules.some(rule => rule.sourcePath === 'AGENTS.md'));
  assert.ok(tsContext.rules.some(rule => rule.sourcePath.endsWith('typescript.instructions.md')));
  assert.equal(tsContext.rules.some(rule => rule.sourcePath.endsWith('python.md')), false);
  assert.ok(tsContext.text.includes('untrusted constraints'));

  assert.equal(isNarrowerProposal(
    { name: 'run_command', arguments: { command: 'npm test', timeoutMs: 10000, cwd: '.' } },
    { name: 'run_command', arguments: { command: 'npm test', timeoutMs: 5000 } }
  ), true);
  assert.equal(isNarrowerProposal(
    { name: 'read_file', arguments: { path: 'src/a.ts' } },
    { name: 'apply_patch', arguments: { path: 'src/a.ts' } }
  ), false);
  assert.throws(() => normalizeHookOutput({ decision: 'allow', success: true }), /forbidden authority/);

  const disabled = await executeCustomizationHooks(first, { event: 'pre_tool', sessionId: 's1', role: 'Editor', proposal: { name: 'apply_patch', arguments: { path: 'src/a.ts', patch: 'x' } } }, { enabled: false, workspaceRoot: root });
  assert.equal(disabled.decision, 'allow');
  assert.equal(disabled.hookRuns.length, 0);

  const denied = await executeCustomizationHooks(first, { event: 'pre_tool', sessionId: 's1', role: 'Editor', proposal: { name: 'apply_patch', arguments: { path: 'src/a.ts', patch: 'x' } } }, { enabled: true, workspaceRoot: root });
  assert.equal(denied.decision, 'deny');
  assert.ok(denied.reason.includes('blocked by fixture policy'));
  assert.equal(denied.hookRuns.length, 1);

  const mutation = await executeCustomizationHooks(first, { event: 'post_tool', sessionId: 's1', role: 'Editor', proposal: { name: 'apply_patch', arguments: { path: 'src/a.ts', patch: 'x' } }, result: { ok: true, summary: 'fixture' } }, { enabled: true, workspaceRoot: root });
  assert.equal(mutation.decision, 'deny');
  assert.equal(fs.readFileSync(path.join(root, 'source.txt'), 'utf8'), 'original');
  assert.equal(mutation.hookRuns[0].sourceRestored, true);

  const originalDigest = first.digest;
  write('AGENTS.md', '# Workspace rules\nNever weaken tests.\nNever skip lint.');
  const changed = discoverCustomizations(root);
  assert.notEqual(changed.digest, originalDigest);

  console.log(JSON.stringify({
    pass: true,
    snapshot: { digest: first.digest, skills: first.skills.length, agents: first.agents.length, rules: first.rules.length, hooks: first.hooks.length },
    authority: { incompatibleCoderRejected: !coder?.compatible, reviewerMutationDenied: !reviewer?.effectiveTools.includes('apply_patch') },
    hooks: { disabledNoExecution: disabled.hookRuns.length === 0, deny: denied.decision, sourceMutation: mutation.decision, sourceRestored: mutation.hookRuns[0].sourceRestored },
    driftDetected: changed.digest !== originalDigest,
    providerCalls: 0
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

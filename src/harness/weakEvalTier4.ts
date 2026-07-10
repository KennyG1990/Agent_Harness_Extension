import { ChatOptions, ChatUsage, ModelDescriptor, Provider } from './provider';
import { Tier2Task } from './weakEvalTier2';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tier-4 (Phase 57.1): tasks that cannot be pattern-matched.
 * THE LEAK LAW: no goal may contain any identifier that appears near the
 * defect site — enforced by `assertNoLeak` at generation time. Goals describe
 * SYMPTOMS; locating the cause requires tracing, not grepping the goal.
 * Each task carries `provenFix` — used ONLY by validation tooling to prove
 * solvability (pristine fails the judge, proven-fixed passes); it is never
 * shown to any model or prompt.
 */

export interface Tier4Task extends Tier2Task {
  provenFix: { path: string; content: string };
  distractorNote?: string;
}

export interface Tier4SolvabilityProof {
  taskId: string;
  pristineWorkspacePass: boolean;
  pristineHeldOutPass: boolean;
  provenWorkspacePass: boolean;
  provenHeldOutPass: boolean;
  appliedExtraFixes: number;
}

export function assertNoLeak(task: Tier4Task): void {
  const goalTokens = new Set(task.goal.toLowerCase().split(/[^a-z0-9_]+/).filter(token => token.length >= 4));
  const defectContent = task.files[task.provenFix.path];
  const lines = defectContent.split('\n');
  const fixedLines = new Set(task.provenFix.content.split('\n'));
  const defectLineIdx = lines.findIndex(line => line.trim() && !fixedLines.has(line));
  const windowText = lines.slice(Math.max(0, defectLineIdx - 5), defectLineIdx + 6).join(' ');
  const identifiers = new Set(windowText.split(/[^A-Za-z0-9_]+/).filter(id => id.length >= 4).map(id => id.toLowerCase()));
  const generic = new Set(['return', 'function', 'const', 'module', 'exports', 'require', 'true', 'false', 'null', 'this']);
  for (const token of goalTokens) {
    if (identifiers.has(token) && !generic.has(token)) {
      throw new Error(`LEAK LAW VIOLATION in ${task.id}: goal token "${token}" appears within 5 lines of the defect.`);
    }
  }
}

export function tier4Tasks(): Tier4Task[] {
  const tasks: Tier4Task[] = [];

  // T1 — symptom-only, cross-file cause + an innocent-looking distractor.
  tasks.push({
    id: 't4-symptom-pricing',
    title: 'Symptom: totals too high when promotions apply',
    kind: 'multi-file-bug',
    goal: 'Customers report that order totals come out TOO HIGH whenever a promotion is applied at checkout. Orders without promotions are fine. Find the cause and make checkout right.',
    files: {
      'src/promo.js': "function reduction(price, rate) {\n  // portion to subtract for a promotional rate\n  return price * rate * -1;\n}\n\nmodule.exports = { reduction };\n",
      'src/checkout.js': "const { reduction } = require('./promo');\n\nfunction orderSum(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price - reduction(item.price, item.rate || 0);\n  }\n  return sum;\n}\n\nmodule.exports = { orderSum };\n",
      'src/labels.js': "// NOTE: reviewers keep flagging this as a bug. It is intentional:\n// display strings are padded to 12 for the ledger printer.\nfunction pad(text) {\n  return String(text).padEnd(12, ' ');\n}\n\nmodule.exports = { pad };\n"
    },
    workspaceTest: "const assert = require('assert');\nconst { orderSum } = require('./src/checkout');\nassert.equal(orderSum([{ price: 100, rate: 0.1 }]), 90);\nassert.equal(orderSum([{ price: 50 }]), 50);\nconsole.log('pass t4-symptom-pricing');\n",
    heldOutTest: "const assert = require('assert');\nconst { orderSum } = require('./src/checkout');\nassert.equal(orderSum([{ price: 100, rate: 0.1 }]), 90);\nassert.equal(orderSum([{ price: 200, rate: 0.5 }, { price: 10 }]), 110);\nconsole.log('judge pass');\n",
    provenFix: { path: 'src/promo.js', content: "function reduction(price, rate) {\n  // portion to subtract for a promotional rate\n  return price * rate;\n}\n\nmodule.exports = { reduction };\n" },
    distractorNote: 'labels.js carries a reviewer-bait comment; it is correct code.'
  });

  // T2 — symptom-only haystack: pipeline of modules, cause mid-chain.
  const pipeFiles: Record<string, string> = {};
  for (let i = 0; i < 8; i++) {
    pipeFiles[`src/stage${i}.js`] = `function stage${i}(value) {\n  // pipeline stage ${i}: pass-through with bookkeeping\n  return value;\n}\n\nmodule.exports = { stage${i} };\n`;
  }
  pipeFiles['src/stage4.js'] = "function stage4(value) {\n  // pipeline stage 4: pass-through with bookkeeping\n  return String(value).replace('+', '');\n}\n\nmodule.exports = { stage4 };\n";
  pipeFiles['src/pipeline.js'] = "const stages = [0,1,2,3,4,5,6,7].map(n => require(`./stage${n}`)[`stage${n}`]);\n\nfunction process(input) {\n  return stages.reduce((value, fn) => fn(value), input);\n}\n\nmodule.exports = { process };\n";
  tasks.push({
    id: 't4-symptom-pipeline',
    title: 'Symptom: sign-ups with a plus sign fail downstream',
    kind: 'haystack',
    goal: 'Users whose email addresses contain a plus sign report their sign-ups fail verification downstream. Addresses without it work. Somewhere in the processing chain the address is being altered. Find where and stop it.',
    files: pipeFiles,
    workspaceTest: "const assert = require('assert');\nconst { process } = require('./src/pipeline');\nassert.equal(process('a+b@x.co'), 'a+b@x.co');\nconsole.log('pass t4-symptom-pipeline');\n",
    heldOutTest: "const assert = require('assert');\nconst { process } = require('./src/pipeline');\nassert.equal(process('a+b@x.co'), 'a+b@x.co');\nassert.equal(process('plain@x.co'), 'plain@x.co');\nconsole.log('judge pass');\n",
    provenFix: { path: 'src/stage4.js', content: "function stage4(value) {\n  // pipeline stage 4: pass-through with bookkeeping\n  return value;\n}\n\nmodule.exports = { stage4 };\n" }
  });

  // T3 — causal chain: TWO coordinated edits; either alone stays red.
  tasks.push({
    id: 't4-causal-timeout',
    title: 'Causal chain: settings ignored in two places',
    kind: 'multi-file-bug',
    goal: 'Operations can configure the wait limit, but it never takes effect: neither the configured value (which should be 5000) nor per-call overrides change anything. Make both work.',
    files: {
      'src/settings.js': "const WAIT_LIMIT = 250; // ms — placeholder, real value comes from ops\n\nmodule.exports = { WAIT_LIMIT: 250 };\n",
      'src/service.js': "const settings = require('./settings');\n\nfunction waitFor(options) {\n  return 1000;\n}\n\nmodule.exports = { waitFor };\n"
    },
    workspaceTest: "const assert = require('assert');\nconst { waitFor } = require('./src/service');\nassert.equal(waitFor({}), 5000);\nassert.equal(waitFor({ limit: 42 }), 42);\nconsole.log('pass t4-causal-timeout');\n",
    heldOutTest: "const assert = require('assert');\nconst { waitFor } = require('./src/service');\nassert.equal(waitFor({}), 5000);\nassert.equal(waitFor({ limit: 42 }), 42);\nconst settings = require('./src/settings');\nassert.equal(settings.WAIT_LIMIT, 5000);\nconsole.log('judge pass');\n",
    provenFix: { path: 'src/service.js', content: "const settings = require('./settings');\n\nfunction waitFor(options) {\n  return options.limit ?? settings.WAIT_LIMIT;\n}\n\nmodule.exports = { waitFor };\n" }
  });
  // NOTE: t4-causal-timeout requires editing settings.js (WAIT_LIMIT -> 5000) AND service.js; provenFix covers service.js and validation also applies the settings edit (see PROVEN_EXTRA below).

  // T4 — spec-gap: implement per SPEC.md; judge tests an edge the goal never states.
  tasks.push({
    id: 't4-spec-limiter',
    title: 'Spec-gap: build the call limiter per SPEC.md',
    kind: 'feature',
    goal: 'Implement the behavior described in SPEC.md inside src/limiter.js so the whole suite passes. Read the spec carefully; the tests hold it to the letter.',
    files: {
      'SPEC.md': '# Call limiter\nmakeLimiter(max) returns a function wrapping fn. The wrapper forwards calls to fn and returns its result until fn has been invoked max times; every call after that returns null WITHOUT invoking fn. Exactly the max-th call still goes through.\n',
      'src/limiter.js': "function makeLimiter(max) {\n  return function wrap(fn) {\n    return fn; // TODO\n  };\n}\n\nmodule.exports = { makeLimiter };\n"
    },
    workspaceTest: "const assert = require('assert');\nconst { makeLimiter } = require('./src/limiter');\nconst wrap = makeLimiter(2)(x => x * 2);\nassert.equal(wrap(1), 2);\nassert.equal(wrap(2), 4);\nassert.equal(wrap(3), null);\nconsole.log('pass t4-spec-limiter');\n",
    heldOutTest: "const assert = require('assert');\nconst { makeLimiter } = require('./src/limiter');\nlet invoked = 0;\nconst wrap = makeLimiter(1)(x => { invoked += 1; return x; });\nassert.equal(wrap(7), 7);\nassert.equal(wrap(8), null);\nassert.equal(invoked, 1, 'fn must NOT be invoked past the limit');\nconsole.log('judge pass');\n",
    provenFix: { path: 'src/limiter.js', content: "function makeLimiter(max) {\n  return function wrap(fn) {\n    let calls = 0;\n    return function limited(...args) {\n      if (calls >= max) {\n        return null;\n      }\n      calls += 1;\n      return fn(...args);\n    };\n  };\n}\n\nmodule.exports = { makeLimiter };\n" }
  });

  return tasks;
}

/** Extra coordinated edits validation must apply alongside provenFix (causal chains). Never shown to models. */
export const PROVEN_EXTRA: Record<string, Array<{ path: string; content: string }>> = {
  't4-causal-timeout': [
    { path: 'src/settings.js', content: 'const WAIT_LIMIT = 5000; // ms — set by ops\n\nmodule.exports = { WAIT_LIMIT: 5000 };\n' }
  ]
};

export function applyProvenFixes(task: Tier4Task, fixtureRoot: string): void {
  const fixes = [task.provenFix, ...(PROVEN_EXTRA[task.id] || [])];
  for (const fix of fixes) {
    const fullPath = path.join(fixtureRoot, fix.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, fix.content, 'utf8');
  }
}

export function proveTier4TaskSolvable(task: Tier4Task): Tier4SolvabilityProof {
  const pristineRoot = createProofFixture(task, 'pristine');
  const provenRoot = createProofFixture(task, 'proven');
  try {
    const pristineWorkspacePass = runWorkspaceTest(pristineRoot);
    const pristineHeldOutPass = runHeldOut(task, pristineRoot);
    applyProvenFixes(task, provenRoot);
    const provenWorkspacePass = runWorkspaceTest(provenRoot);
    const provenHeldOutPass = runHeldOut(task, provenRoot);
    return {
      taskId: task.id,
      pristineWorkspacePass,
      pristineHeldOutPass,
      provenWorkspacePass,
      provenHeldOutPass,
      appliedExtraFixes: (PROVEN_EXTRA[task.id] || []).length
    };
  } finally {
    fs.rmSync(pristineRoot, { recursive: true, force: true });
    fs.rmSync(provenRoot, { recursive: true, force: true });
  }
}

export function proveTier4SuiteSolvable(tasks: Tier4Task[] = tier4Tasks()): Tier4SolvabilityProof[] {
  const proofs = tasks.map(task => proveTier4TaskSolvable(task));
  const failed = proofs.filter(proof =>
    proof.pristineWorkspacePass ||
    proof.pristineHeldOutPass ||
    !proof.provenWorkspacePass ||
    !proof.provenHeldOutPass
  );
  if (failed.length > 0) {
    throw new Error(`Tier-4 solvability proof failed: ${failed.map(item => item.taskId).join(', ')}`);
  }
  return proofs;
}

function createProofFixture(task: Tier4Task, label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-tier4-proof-${task.id}-${label}-`));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
  for (const [filePath, content] of Object.entries(task.files)) {
    const fullPath = path.join(root, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
  if (task.workspaceTest) {
    fs.writeFileSync(path.join(root, 'test.js'), task.workspaceTest, 'utf8');
  }
  return root;
}

function runWorkspaceTest(fixtureRoot: string): boolean {
  try {
    execFileSync(process.execPath, ['test.js'], { cwd: fixtureRoot, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function runHeldOut(task: Tier4Task, fixtureRoot: string): boolean {
  const judgePath = path.join(fixtureRoot, '.forge-heldout-judge.js');
  try {
    fs.writeFileSync(judgePath, task.heldOutTest, 'utf8');
    execFileSync(process.execPath, [judgePath], { cwd: fixtureRoot, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(judgePath, { force: true });
  }
}

/** Plumbing mock: pattern-finder only. It CANNOT reason from symptoms — by design, its live-vs-mock gap IS the tier-4 measurement. Proves lanes/judges/mechanics run. */
export class MockTier4Provider implements Provider {
  public capabilities() {
    return { structuredOutput: true, toolCalls: false, vision: false, contextLength: 32000 };
  }

  public async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }

  public async generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    const prompt = options.messages.map(message => message.content).join('\n');
    if (prompt.includes('ARCHITECT_PLANNER')) {
      return { text: JSON.stringify({ premiseCheck: 'A file in the workspace causes the described symptom.', targetFile: '', approach: 'Trace the symptom to its cause.', doneWhen: 'Tests pass.' }) };
    }
    if (prompt.includes('EXPLORER_WORKER')) {
      return { text: JSON.stringify({ summary: 'No pattern-matchable defect found; symptom reasoning required.', suspicionScore: 1, keyLines: '' }) };
    }
    return { text: JSON.stringify({ explanation: 'pattern-finder cannot reason from symptoms', proposal: { name: 'apply_patch', arguments: { path: '', patchContent: 'no visible defect pattern' } } }) };
  }
}

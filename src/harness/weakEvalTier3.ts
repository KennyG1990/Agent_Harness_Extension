import { ChatOptions, ChatUsage, ModelDescriptor, Provider } from './provider';
import { Tier2Task } from './weakEvalTier2';

/**
 * Tier-3: large-corpus fixtures where a 32k context stops being free.
 * Fixtures are DETERMINISTICALLY GENERATED (no network): big files built from
 * parameterized utility functions with one seeded defect. Every defect is
 * placed DEEP — beyond the solo lane's per-file truncation horizon — so the
 * information asymmetry is structural: the solo lane cannot see the bug;
 * a swarm explorer, which gets one full file, can. The mock provider is
 * honest by construction: it fixes only what is visible in its prompt.
 */

function makeBigFile(prefix: string, fnCount: number, defectIndex: number | null): string {
  const parts: string[] = [];
  for (let index = 0; index < fnCount; index++) {
    const op = index === defectIndex ? '-' : '+';
    parts.push(`function util_${prefix}_${index}(x) {\n  // utility ${index}: linear offset helper for the ${prefix} module pipeline\n  return x ${op} ${index};\n}\n`);
  }
  const exports = Array.from({ length: fnCount }, (_, index) => `util_${prefix}_${index}`).join(', ');
  parts.push(`module.exports = { ${exports} };\n`);
  return parts.join('\n');
}

export function tier3Tasks(): Tier2Task[] {
  const tasks: Tier2Task[] = [];

  // 1-2: large-file-bug — one big file among two, defect deep in the big one.
  for (const [n, prefix, fnCount, defectIndex] of [[1, 'alpha', 240, 200], [2, 'beta', 260, 230]] as Array<[number, string, number, number]>) {
    tasks.push({
      id: `t3-large-file-${n}`,
      title: `Large file: defect deep in src/${prefix}.js`,
      kind: 'large-file-bug',
      goal: `util_${prefix}_${defectIndex}(10) must return ${10 + defectIndex}. Exactly one utility function in this workspace has the wrong operator. Fix it.`,
      files: {
        [`src/${prefix}.js`]: makeBigFile(prefix, fnCount, defectIndex),
        'src/other.js': makeBigFile('other' + n, 120, null)
      },
      workspaceTest: `const assert = require('assert');\nconst { util_${prefix}_${defectIndex} } = require('./src/${prefix}');\nassert.equal(util_${prefix}_${defectIndex}(10), ${10 + defectIndex});\nconsole.log('pass t3-large-file-${n}');\n`,
      heldOutTest: `const assert = require('assert');\nconst { util_${prefix}_${defectIndex}, util_${prefix}_5 } = require('./src/${prefix}');\nassert.equal(util_${prefix}_${defectIndex}(10), ${10 + defectIndex});\nassert.equal(util_${prefix}_5(1), 6);\nconsole.log('judge pass');\n`
    });
  }

  // 3-4: haystack — defect in one of many medium files, placed deep.
  for (const [n, buggyFile, defectIndex] of [[1, 7, 48], [2, 3, 52]] as Array<[number, number, number]>) {
    const files: Record<string, string> = {};
    for (let f = 0; f < 12; f++) {
      files[`src/mod${f}.js`] = makeBigFile(`h${n}m${f}`, 60, f === buggyFile ? defectIndex : null);
    }
    tasks.push({
      id: `t3-haystack-${n}`,
      title: `Haystack: defect in one of 12 files`,
      kind: 'haystack',
      goal: `util_h${n}m${buggyFile}_${defectIndex}(10) must return ${10 + defectIndex}. Exactly one utility function across these 12 files has the wrong operator. Find and fix it.`,
      files,
      workspaceTest: `const assert = require('assert');\nconst { util_h${n}m${buggyFile}_${defectIndex} } = require('./src/mod${buggyFile}');\nassert.equal(util_h${n}m${buggyFile}_${defectIndex}(10), ${10 + defectIndex});\nconsole.log('pass t3-haystack-${n}');\n`,
      heldOutTest: `const assert = require('assert');\nconst { util_h${n}m${buggyFile}_${defectIndex}, util_h${n}m${buggyFile}_1 } = require('./src/mod${buggyFile}');\nassert.equal(util_h${n}m${buggyFile}_${defectIndex}(10), ${10 + defectIndex});\nassert.equal(util_h${n}m${buggyFile}_1(1), 2);\nconsole.log('judge pass');\n`
    });
  }

  // 5: large-seam — big consumer calls a misnamed symbol from a big producer, deep in the consumer.
  const producer = makeBigFile('prod', 180, null);
  const consumerParts: string[] = [];
  for (let index = 0; index < 150; index++) {
    consumerParts.push(`function wrap_${index}(x) {\n  // wrapper ${index}: delegates to the producer module's matching utility\n  return util_prod_${index}(x);\n}\n`);
  }
  const consumer = [
    "const { " + Array.from({ length: 180 }, (_, i) => `util_prod_${i}`).join(', ') + " } = require('./prod');",
    '',
    ...consumerParts,
    // The seam defect, deep in the file: wrap_130 calls a symbol that does not exist.
    '',
    `module.exports = { ${Array.from({ length: 150 }, (_, i) => `wrap_${i}`).join(', ')} };`,
    ''
  ].join('\n').replace('return util_prod_130(x);', 'return util_prod_130x(x);');
  tasks.push({
    id: 't3-large-seam',
    title: 'Large seam: misnamed call deep in a big consumer',
    kind: 'large-seam',
    goal: 'wrap_130(10) must return 140. One wrapper in src/consumer.js calls a function name that does not exist in src/prod.js. Fix the call.',
    files: { 'src/prod.js': producer, 'src/consumer.js': consumer },
    workspaceTest: "const assert = require('assert');\nconst { wrap_130 } = require('./src/consumer');\nassert.equal(wrap_130(10), 140);\nconsole.log('pass t3-large-seam');\n",
    heldOutTest: "const assert = require('assert');\nconst { wrap_130, wrap_5 } = require('./src/consumer');\nassert.equal(wrap_130(10), 140);\nassert.equal(wrap_5(1), 6);\nconsole.log('judge pass');\n"
  });

  return tasks;
}

/**
 * Honest-by-construction mock: it can only fix defects VISIBLE in its prompt.
 * Solo lanes with truncated context therefore fail structurally; explorers
 * with one full file find the defect; the focused implementer patches it.
 */
export class MockTier3Provider implements Provider {
  public capabilities() {
    return { structuredOutput: true, toolCalls: false, vision: false, contextLength: 32000 };
  }

  public async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }

  public async generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    const prompt = options.messages.map(message => message.content).join('\n');
    const WRONG_OP = /function (util_\w+)\(x\) \{\n(  \/\/[^\n]*\n)  return x - (\d+);\n\}/;
    if (prompt.includes('ARCHITECT_PLANNER')) {
      // Planning is judgment over the goal, not reading: the goal names the
      // defective function; its prefix maps to its file. No corpus scan needed.
      const goalFn = prompt.match(/(?:util_([A-Za-z0-9]+)_\d+|wrap_\d+)\(10\) must return/);
      let targetFile = '';
      if (goalFn && goalFn[1]) {
        const prefix = goalFn[1];
        const hay = prefix.match(/^h\dm(\d+)$/);
        targetFile = hay ? `src/mod${hay[1]}.js` : `src/${prefix}.js`;
      } else if (goalFn) {
        targetFile = 'src/consumer.js';
      }
      return { text: JSON.stringify({ premiseCheck: 'The goal-named function must exist in the target file and currently return the wrong value.', targetFile, approach: 'Locate the named function in the target file; correct its operator or its callee name.', doneWhen: 'Workspace tests pass.' }) };
    }
    if (prompt.includes('EXPLORER_WORKER')) {
      const wrongOp = prompt.match(WRONG_OP);
      const badCall = prompt.match(/return (util_prod_\d+x)\(x\);/);
      const suspicious = Boolean(wrongOp || badCall);
      return { text: JSON.stringify({ summary: suspicious ? 'Found a defect candidate in this file.' : 'Nothing suspicious relative to the goal.', suspicionScore: suspicious ? 9 : 1, keyLines: wrongOp ? wrongOp[0].slice(0, 200) : badCall ? badCall[0] : '' }) };
    }
    // Bare or implementer: fix only what is visible.
    const wrongOp = prompt.match(WRONG_OP);
    if (wrongOp) {
      const patch = `<<<<<<< SEARCH\nfunction ${wrongOp[1]}(x) {\n${wrongOp[2]}  return x - ${wrongOp[3]};\n}\n=======\nfunction ${wrongOp[1]}(x) {\n${wrongOp[2]}  return x + ${wrongOp[3]};\n}\n>>>>>>> REPLACE`;
      return { text: JSON.stringify({ explanation: 'defect visible; patching it', proposal: { name: 'apply_patch', arguments: { path: '', patchContent: patch } } }) };
    }
    const badCall = prompt.match(/return (util_prod_(\d+))x\(x\);/);
    if (badCall) {
      const patch = `<<<<<<< SEARCH\n  return ${badCall[1]}x(x);\n=======\n  return ${badCall[1]}(x);\n>>>>>>> REPLACE`;
      return { text: JSON.stringify({ explanation: 'misnamed call visible; patching it', proposal: { name: 'apply_patch', arguments: { path: '', patchContent: patch } } }) };
    }
    return { text: JSON.stringify({ explanation: 'defect not visible in my context', proposal: { name: 'apply_patch', arguments: { path: '', patchContent: 'cannot see the defect' } } }) };
  }
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const compiled = path.join(process.cwd(), 'out', 'harness', 'modelPromptProfile.js');
const { modelBehaviorPromptProfile } = await import(pathToFileURL(compiled).href);

const fable = modelBehaviorPromptProfile('anthropic/claude-fable-5');
const datedFable = modelBehaviorPromptProfile('anthropic/claude-fable-5-20260701');
const mythos = modelBehaviorPromptProfile('anthropic/claude-mythos-5');
assert.equal(fable?.family, 'claude-fable-5');
assert.equal(datedFable?.family, 'claude-fable-5');
assert.equal(mythos?.family, 'claude-mythos-5');
assert.equal(modelBehaviorPromptProfile('anthropic/claude-opus-4.8'), undefined);
assert.equal(modelBehaviorPromptProfile('qwen/qwen-2.5-7b-instruct'), undefined);

for (const profile of [fable, mythos]) {
  assert.match(profile.prompt, /evidence is sufficient, act/i);
  assert.match(profile.prompt, /Stay inside the requested task/i);
  assert.match(profile.prompt, /tool result from this run/i);
  assert.match(profile.prompt, /genuine user-owned ambiguity/i);
  assert.match(profile.prompt, /Continue reversible authorized work/i);
  assert.match(profile.prompt, /Never reproduce.*hidden reasoning/i);
  assert.doesNotMatch(profile.prompt, /show your work|chain.of.thought|remaining token|context.*count/i);
}

const loopSource = fs.readFileSync(path.join(process.cwd(), 'src', 'harness', 'loop.ts'), 'utf8');
assert.match(loopSource, /modelBehaviorPromptProfile\(modelId\)/);
assert.match(loopSource, /id: 'model-family-behavior'[\s\S]{0,120}required: true/);

console.log(JSON.stringify({ pass: true, families: [fable.family, mythos.family], nonTargetUnchanged: true, requiredSection: true }, null, 2));

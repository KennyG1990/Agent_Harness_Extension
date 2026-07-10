import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { Firewall } from './firewall';
import { VerificationOracles } from './oracles';
import { OpenRouterProvider, Provider, ChatOptions, ChatUsage, ModelDescriptor } from './provider';
import { ToolProposal } from './types';
import { resolvePatchTargetByContent, WorkspaceTools } from './tools';
import { ACTION_SCHEMA, assertModelEndpointsLive, runLiveSchemaCanary } from './weakEval';

/**
 * Tier-2 weak-model eval: multi-file bugs, missing-test tasks (the harness
 * must author its own oracle first), and small features. The judge is HELD
 * OUT: final `solved` is decided by a runner-owned verification test executed
 * after the run — the model cannot grade its own homework. The workspace
 * oracle the model sees is tracked separately as `workspaceOracleGreen`.
 */

export type Tier2TaskKind = 'multi-file-bug' | 'missing-test' | 'feature' | 'large-file-bug' | 'haystack' | 'large-seam';

export interface Tier2Task {
  id: string;
  title: string;
  kind: Tier2TaskKind;
  goal: string;
  files: Record<string, string>;
  /** Written into the fixture when present; absent for missing-test tasks. */
  workspaceTest?: string;
  /** Runner-owned judge, never shown to the model, executed after the run. */
  heldOutTest: string;
}

export interface Tier2LaneResult {
  solved: boolean;
  modelDriven: boolean;
  workspaceOracleGreen: boolean;
  authoredTest: boolean;
  providerCalls: number;
  providerFailures: number;
  steps: number;
  cost: number;
  pathRepairs?: number;
  contentAddressedRepairs?: number;
  wholeFileRecoveries?: number;
  lastValidationError?: string;
  fixtureRoot: string;
  error?: string;
}

export interface ArchitectLaneResult extends Tier2LaneResult {
  architectCalls: number;
  architectCost: number;
  architectModel: string;
  plannedTargetFile: string;
  premiseCheck: string;
  planApproach: string;
  planSubtasks: string[];
  subtaskChecks: Array<{ step: number; subtaskIndex: number; subtask: string; testsPass: boolean; heldOutPass: boolean; output: string }>;
}

export interface SwarmLaneResult extends Tier2LaneResult {
  explorerCalls: number;
  handoffChars: number;
  implementerPromptChars: number;
  soloPromptChars: number;
  suspectRotations: number;
}

export interface Tier2TaskResult {
  id: string;
  title: string;
  kind: Tier2Task['kind'];
  bare: Tier2LaneResult;
  harness?: Tier2LaneResult;
  swarm?: SwarmLaneResult;
  architect?: ArchitectLaneResult;
  dispatchLane?: 'harness' | 'swarm';
}

export interface Tier2EvalReport {
  runId: string;
  startedAt: string;
  passed: boolean;
  status: 'uplift_observed' | 'no_uplift_observed';
  partial?: boolean;
  completedTaskCount?: number;
  lastUpdatedAt?: string;
  tier: number;
  generatedAt: string;
  modelId: string;
  live: boolean;
  taskCount: number;
  bareSolved: number;
  harnessSolved: number;
  swarmSolved?: number;
  architectSolved?: number;
  dispatchSolved?: number;
  solveRateDelta: number;
  byKind: Record<string, { total: number; bareSolved: number; harnessSolved: number; swarmSolved?: number; architectSolved?: number; dispatchSolved?: number }>;
  providerCalls: number;
  providerFailures: number;
  cost: number;
  liveCanary?: { ok: boolean; proposalName: string; argumentKeys: string[]; pathNonEmpty: boolean };
  reportPath?: string;
  archivePath?: string;
  tasks: Tier2TaskResult[];
}

export interface Tier2EvalOptions {
  model?: string;
  live?: boolean;
  taskLimit?: number;
  keepFixtures?: boolean;
  reportRoot?: string;
  maxHarnessSteps?: number;
  includeSwarmLane?: boolean;
  includeArchitectLane?: boolean;
  architectModel?: string;
  providerCallTimeoutMs?: number;
  tier?: number;
  /** Terrain dispatch: route each task to ONE lane by kind. The router is a lookup, not a model. */
  dispatch?: boolean;
  routing?: Partial<Record<Tier2TaskKind, 'harness' | 'swarm'>>;
  /** Inject a different task suite (e.g. tier-3 generated fixtures). Defaults to tier2Tasks(). */
  tasks?: Tier2Task[];
}

/** Data-derived defaults from the 2026-07-08 live A/B; tier-3 kinds default to harness until live data draws their terrain map. */
export const DEFAULT_TERRAIN_ROUTING: Record<Tier2TaskKind, 'harness' | 'swarm'> = {
  'multi-file-bug': 'harness',
  'missing-test': 'swarm',
  'feature': 'harness',
  'large-file-bug': 'harness',
  'haystack': 'harness',
  'large-seam': 'harness'
};

/** Solo-lane prompt budget: beyond this, per-file content truncates with a visible marker. Swarm explorers are unaffected (one full file each). */
export const SOLO_PROMPT_CHAR_BUDGET = 24000;

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['premiseCheck', 'targetFile', 'approach'],
  properties: {
    premiseCheck: { type: 'string' },
    targetFile: { type: 'string' },
    approach: { type: 'string' },
    doneWhen: { type: 'string' },
    subtasks: { type: 'array', items: { type: 'string' } }
  }
};

const WORKER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'suspicionScore'],
  properties: {
    summary: { type: 'string' },
    suspicionScore: { type: 'number' },
    keyLines: { type: 'string' }
  }
};

export interface FileInterlocks {
  /** Workspace-relative paths this file requires. */
  deps: string[];
  /** Workspace-relative paths that require this file. */
  dependents: string[];
  /** Deterministic interface signature: declarations + module.exports lines. */
  signature: string;
}

/**
 * Interlocking arcs: deterministic require-graph + interface signatures so
 * sectors overlap at the seams. Relationship defects (a misnamed import, an
 * unwired export) live BETWEEN files; an explorer that sees only its own arc
 * cannot see them. Zero provider calls — a regex pass, not a model.
 */
export function extractInterlocks(files: Record<string, string>): Record<string, FileInterlocks> {
  const paths = Object.keys(files);
  const resolve = (fromPath: string, spec: string): string | null => {
    if (!spec.startsWith('.')) {
      return null;
    }
    const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    const raw = (fromDir ? fromDir + '/' : '') + spec.replace(/^\.\//, '');
    const parts: string[] = [];
    for (const part of raw.split('/')) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.' && part !== '') {
        parts.push(part);
      }
    }
    const joined = parts.join('/');
    for (const candidate of [joined, `${joined}.js`, `${joined}/index.js`]) {
      if (paths.includes(candidate)) {
        return candidate;
      }
    }
    return null;
  };
  const interlocks: Record<string, FileInterlocks> = {};
  for (const filePath of paths) {
    const signatureLines = files[filePath]
      .split('\n')
      .filter(line => /^(function |const |class |module\.exports)/.test(line.trim()))
      .map(line => line.trim().slice(0, 120));
    interlocks[filePath] = { deps: [], dependents: [], signature: signatureLines.join('\n') };
  }
  for (const filePath of paths) {
    const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = requireRegex.exec(files[filePath])) !== null) {
      const resolved = resolve(filePath, match[1]);
      if (resolved && resolved !== filePath) {
        if (!interlocks[filePath].deps.includes(resolved)) {
          interlocks[filePath].deps.push(resolved);
        }
        if (!interlocks[resolved].dependents.includes(filePath)) {
          interlocks[resolved].dependents.push(filePath);
        }
      }
    }
  }
  return interlocks;
}

export function renderInterlocks(filePath: string, interlocks: Record<string, FileInterlocks>, files: Record<string, string>): string {
  const own = interlocks[filePath];
  if (!own) {
    return '';
  }
  const sections: string[] = [];
  for (const dep of own.deps) {
    sections.push(`It requires ${dep}, whose interface is:\n${interlocks[dep]?.signature || '(no signature found)'}`);
  }
  for (const dependent of own.dependents) {
    const importLines = (files[dependent] || '')
      .split('\n')
      .filter(line => line.includes('require('))
      .map(line => line.trim().slice(0, 120))
      .join('\n');
    sections.push(`It is required by ${dependent}, whose import lines are:\n${importLines || '(none found)'}`);
  }
  return sections.length ? `Interlocking interfaces (seams this file shares with its neighbors):\n${sections.join('\n')}` : '';
}

const PATCH_EXEMPLAR = [
  'apply_patch patchContent MUST use exactly this SEARCH/REPLACE format:',
  '<<<<<<< SEARCH',
  '(exact lines copied from the target file)',
  '=======',
  '(replacement lines)',
  '>>>>>>> REPLACE',
  'write_file takes {"path": "...", "content": "..."} with the COMPLETE file content.'
].join('\n');

export class Tier2EvalRunner {
  constructor(private readonly providerFactory: (live: boolean) => Provider = live => live ? new OpenRouterProvider() : new MockTier2Provider()) {}

  public async run(options: Tier2EvalOptions = {}): Promise<Tier2EvalReport> {
    const live = options.live === true;
    const tier = options.tier || 2;
    const startedAt = new Date().toISOString();
    const runId = createEvalRunId(tier, live, startedAt);
    const provider = options.providerCallTimeoutMs
      ? new TimeoutProvider(this.providerFactory(live), options.providerCallTimeoutMs)
      : this.providerFactory(live);
    const modelId = options.model || 'qwen/qwen-2.5-7b-instruct';
    let liveCanary: Tier2EvalReport['liveCanary'];
    if (live) {
      await assertModelEndpointsLive(modelId);
      liveCanary = await runLiveSchemaCanary(provider, modelId);
      if (!liveCanary.ok) {
        throw new Error(`Live schema canary failed for ${modelId}: arguments keys [${liveCanary.argumentKeys.join(', ')}], pathNonEmpty=${liveCanary.pathNonEmpty}. Aborting before the tier-2 suite.`);
      }
    }
    const suite = options.tasks && options.tasks.length ? options.tasks : tier2Tasks();
    const tasks = suite.slice(0, Math.max(1, options.taskLimit || suite.length));
    const results: Tier2TaskResult[] = [];
    const reportRoot = options.reportRoot || process.cwd();
    const reportPath = path.join(reportRoot, '.forge', 'evals', `latest-weak-model-eval-tier${tier}.json`);
    const archivePath = path.join(reportRoot, '.forge', 'evals', 'runs', `tier-${tier}`, `${runId}.json`);
    for (const task of tasks) {
      const bareRoot = createFixture(task, 'bare');
      const harnessRoot = createFixture(task, 'harness');
      const taskResult: Tier2TaskResult = {
        id: task.id,
        title: task.title,
        kind: task.kind,
        bare: await this.runBareLane(provider, modelId, task, bareRoot)
      };
      let swarmRoot: string | null = null;
      let architectRoot: string | null = null;
      if (options.dispatch === true) {
        const lane = (options.routing?.[task.kind]) || DEFAULT_TERRAIN_ROUTING[task.kind];
        taskResult.dispatchLane = lane;
        if (lane === 'swarm') {
          swarmRoot = createFixture(task, 'swarm');
          taskResult.swarm = await this.runSwarmLane(provider, modelId, task, swarmRoot, options.maxHarnessSteps || 8);
        } else {
          taskResult.harness = await this.runHarnessLane(provider, modelId, task, harnessRoot, options.maxHarnessSteps || 8);
        }
      } else {
        taskResult.harness = await this.runHarnessLane(provider, modelId, task, harnessRoot, options.maxHarnessSteps || 8);
        if (options.includeSwarmLane === true) {
          swarmRoot = createFixture(task, 'swarm');
          taskResult.swarm = await this.runSwarmLane(provider, modelId, task, swarmRoot, options.maxHarnessSteps || 8);
        }
        if (options.includeArchitectLane === true) {
          architectRoot = createFixture(task, 'architect');
          taskResult.architect = await this.runArchitectLane(provider, modelId, options.architectModel || modelId, task, architectRoot, options.maxHarnessSteps || 8);
        }
      }
      results.push(taskResult);
      persistTierReport(buildReport({
        options,
        modelId,
        live,
        liveCanary,
        results,
        totalTaskCount: tasks.length,
        reportPath,
        archivePath,
        runId,
        startedAt,
        partial: results.length < tasks.length
      }));
      if (options.keepFixtures === false) {
        fs.rmSync(bareRoot, { recursive: true, force: true });
        fs.rmSync(harnessRoot, { recursive: true, force: true });
        if (swarmRoot) {
          fs.rmSync(swarmRoot, { recursive: true, force: true });
        }
        if (architectRoot) {
          fs.rmSync(architectRoot, { recursive: true, force: true });
        }
      }
    }
    const report = buildReport({ options, modelId, live, liveCanary, results, totalTaskCount: tasks.length, reportPath, archivePath, runId, startedAt, partial: false });
    persistTierReport(report);
    return report;
  }

  private async runBareLane(provider: Provider, modelId: string, task: Tier2Task, fixtureRoot: string): Promise<Tier2LaneResult> {
    const base = laneBase(fixtureRoot);
    try {
      base.providerCalls += 1;
      const response = await provider.generateChat({
        modelId,
        sessionId: `t2-bare-${task.id}-${Date.now()}`,
        responseFormatSchema: ACTION_SCHEMA,
        messages: [
          { role: 'system', content: 'BARE_BASELINE: Return one JSON action only. No harness scaffolding is available.' },
          { role: 'user', content: taskPrompt(task, fixtureRoot, 'bare') }
        ]
      });
      base.cost += response.usage?.totalCost || 0;
      const proposal = parseProposal(response.text);
      const tools = new WorkspaceTools(fixtureRoot);
      const firewall = new Firewall(tools);
      const protectedTestMutation = rejectProtectedWorkspaceTestMutation(task, proposal);
      const validation = protectedTestMutation
        ? { valid: false, reason: protectedTestMutation }
        : await firewall.validateProposal(proposal);
      if (validation.valid) {
        await tools.dispatch(proposal);
      } else {
        base.lastValidationError = validation.reason;
      }
    } catch (e: any) {
      base.providerFailures += 1;
      base.error = e.message;
    }
    base.steps = 1;
    base.solved = runHeldOutJudge(task, fixtureRoot);
    base.modelDriven = base.solved;
    base.workspaceOracleGreen = await workspaceOracleGreen(fixtureRoot);
    return base;
  }

  private async runHarnessLane(provider: Provider, modelId: string, task: Tier2Task, fixtureRoot: string, maxSteps: number): Promise<Tier2LaneResult> {
    const base = laneBase(fixtureRoot);
    const tools = new WorkspaceTools(fixtureRoot);
    const firewall = new Firewall(tools);
    const oracles = new VerificationOracles(fixtureRoot);
    let lastRejection = '';
    let malformedRejections = 0;
    const singleSourceFile = Object.keys(task.files).length === 1 ? Object.keys(task.files)[0] : null;
    for (let step = 1; step <= maxSteps; step++) {
      base.steps = step;
      try {
        base.providerCalls += 1;
        const testBefore = await oracles.runTest();
        const missingOracle = /no test|missing script|not found|Cannot find/i.test(testBefore.output) && !fs.existsSync(path.join(fixtureRoot, 'test.js'));
        const oracleGuidance = missingOracle
          ? '\nNO TEST SUITE EXISTS in this workspace. FIRST create test.js (write_file) that verifies the goal, THEN fix the code. Success requires your tests to pass.'
          : `\nCurrent test output:\n${testBefore.output.slice(0, 1000)}`;
        const wantWholeFile = malformedRejections >= 2;
        const rejectionFeedback = lastRejection
          ? wantWholeFile
            ? `\nYour previous patches were REJECTED as malformed: ${lastRejection}\nSTOP emitting patches. Emit write_file with the COMPLETE corrected content of the file you need to change.`
            : `\nYour previous proposal was REJECTED by deterministic validation: ${lastRejection}\n${PATCH_EXEMPLAR}`
          : '';
        const response = await provider.generateChat({
          modelId,
          sessionId: `t2-harness-${task.id}-${Date.now()}`,
          responseFormatSchema: ACTION_SCHEMA,
          messages: [
            { role: 'system', content: 'HARNESS_LANE: Propose exactly one tool call per turn. Deterministic validation owns accept/reject. Success requires green tests.' },
            { role: 'user', content: `${taskPrompt(task, fixtureRoot, 'harness')}${oracleGuidance}${rejectionFeedback}` }
          ]
        });
        base.cost += response.usage?.totalCost || 0;
        const proposal = parseProposal(response.text);
        let pathAmbiguityHint = '';
        if ((proposal.name === 'apply_patch' || proposal.name === 'write_file') && !String(proposal.arguments?.path || '').trim()) {
          if (singleSourceFile) {
            proposal.arguments = { ...proposal.arguments, path: singleSourceFile };
            base.pathRepairs = (base.pathRepairs || 0) + 1;
          } else if (proposal.name === 'apply_patch') {
            // Content-addressed repair: the SEARCH blocks identify the target
            // only when they match exactly ONE candidate source file. The
            // model-authored test is never a candidate; ambiguity is refused.
            const candidates = Object.keys(task.files).map(filePath => ({
              path: filePath,
              content: fs.readFileSync(path.join(fixtureRoot, filePath), 'utf8')
            }));
            const resolved = resolvePatchTargetByContent(candidates, String(proposal.arguments?.patchContent || ''));
            if (resolved.path) {
              proposal.arguments = { ...proposal.arguments, path: resolved.path };
              base.pathRepairs = (base.pathRepairs || 0) + 1;
              base.contentAddressedRepairs = (base.contentAddressedRepairs || 0) + 1;
            } else {
              pathAmbiguityHint = ` Your patch omitted "path" and its SEARCH block matched ${resolved.matchCount} candidate files - emit the "path" argument explicitly.`;
            }
          }
        }
        if (proposal.name === 'write_file' && wantWholeFile) {
          base.wholeFileRecoveries = (base.wholeFileRecoveries || 0) + 1;
        }
        const protectedTestMutation = rejectProtectedWorkspaceTestMutation(task, proposal);
        const validation = protectedTestMutation
          ? { valid: false, reason: protectedTestMutation }
          : await firewall.validateProposal(proposal);
        if (!validation.valid) {
          lastRejection = (validation.reason || 'Proposal rejected without a reason.') + pathAmbiguityHint;
          base.lastValidationError = lastRejection;
          if (/Malformed patch/i.test(lastRejection)) {
            malformedRejections += 1;
          }
          continue;
        }
        lastRejection = '';
        await tools.dispatch(proposal);
        if (proposal.name === 'write_file' && String(proposal.arguments?.path || '') === 'test.js') {
          base.authoredTest = true;
        }
        const tests = await oracles.runTest();
        if (tests.pass && runHeldOutJudge(task, fixtureRoot)) {
          base.solved = true;
          base.modelDriven = true;
          base.workspaceOracleGreen = true;
          return base;
        }
      } catch (e: any) {
        base.providerFailures += 1;
        base.error = e.message;
      }
    }
    base.solved = runHeldOutJudge(task, fixtureRoot);
    base.modelDriven = base.solved;
    base.workspaceOracleGreen = await workspaceOracleGreen(fixtureRoot);
    return base;
  }

  /**
   * Architect lane (cookbook "plan big, execute small", firewalled): ONE
   * schema-constrained planning call — judgment over the goal and structure,
   * seeing only the same truncated view the solo lane gets — names the target
   * file and the premise to verify. For coordinated fixes, the plan can carry
   * ordered subtasks; the cheap implementer advances through them one at a
   * time with oracle output after each committed mutation. Architect model and
   * cost are metered separately: the rate split is measured, never assumed.
   */
  private async runArchitectLane(provider: Provider, modelId: string, architectModelId: string, task: Tier2Task, fixtureRoot: string, maxSteps: number): Promise<ArchitectLaneResult> {
    const base: ArchitectLaneResult = { ...laneBase(fixtureRoot), architectCalls: 0, architectCost: 0, architectModel: architectModelId, plannedTargetFile: '', premiseCheck: '', planApproach: '', planSubtasks: [], subtaskChecks: [] };
    const tools = new WorkspaceTools(fixtureRoot);
    const firewall = new Firewall(tools);
    const oracles = new VerificationOracles(fixtureRoot);
    // --- One planning call. The architect reads NOTHING beyond the solo view. ---
    try {
      base.architectCalls += 1;
      base.providerCalls += 1;
      const response = await provider.generateChat({
        modelId: architectModelId,
        sessionId: `t2-architect-${task.id}-${Date.now()}`,
        responseFormatSchema: PLAN_SCHEMA,
        messages: [
          { role: 'system', content: 'ARCHITECT_PLANNER: You plan; a cheaper implementer executes. From the goal and workspace structure, return JSON {premiseCheck, targetFile, approach, doneWhen, subtasks}. Use targetFile for the primary file. If the fix may require multiple coordinated edits, put ordered subtasks in execution order, each naming the exact workspace-relative file path it touches. You cannot edit anything.' },
          { role: 'user', content: taskPrompt(task, fixtureRoot, 'architect-planning') }
        ]
      });
      base.architectCost += response.usage?.totalCost || 0;
      base.cost += response.usage?.totalCost || 0;
      const plan = JSON.parse(response.text);
      base.plannedTargetFile = String(plan.targetFile || '').trim();
      base.premiseCheck = String(plan.premiseCheck || '').slice(0, 300);
      base.planApproach = String(plan.approach || '').slice(0, 300);
      base.planSubtasks = Array.isArray(plan.subtasks)
        ? plan.subtasks.map(normalizePlanSubtask).filter(Boolean).slice(0, 8)
        : [];
    } catch (e: any) {
      base.providerFailures += 1;
      base.error = `architect planning failed: ${e.message}`;
    }
    const targetIsReal = Boolean(base.plannedTargetFile) && Object.keys(task.files).includes(base.plannedTargetFile);
    if (base.planSubtasks.length === 0) {
      base.planSubtasks = [base.planApproach || `Fix ${base.plannedTargetFile || 'the workspace'} until tests pass.`];
    }
    // --- Implementer: standard mini-loop, plan injected, planned target in full. ---
    let lastRejection = '';
    let malformedRejections = 0;
    let subtaskIndex = 0;
    let previousSubtaskFeedback = '';
    for (let step = 1; step <= maxSteps; step++) {
      base.steps = step;
      try {
        base.providerCalls += 1;
        const testBefore = await oracles.runTest();
        const missingOracle = /no test|missing script|not found|Cannot find/i.test(testBefore.output) && !fs.existsSync(path.join(fixtureRoot, 'test.js'));
        const currentSubtask = base.planSubtasks[Math.min(subtaskIndex, base.planSubtasks.length - 1)] || base.planApproach || '';
        const subtaskFiles = extractPlanFiles(currentSubtask, task.files);
        const fallbackTarget = targetIsReal ? base.plannedTargetFile : '';
        const currentRepairTarget = subtaskFiles.length === 1 ? subtaskFiles[0] : fallbackTarget;
        const focusFiles = uniqueStrings([...subtaskFiles, ...(fallbackTarget ? [fallbackTarget] : [])]);
        const targetContent = focusFiles.length
          ? focusFiles.map(filePath => `FOCUS FILE ${filePath} - full current content:\n${fs.readFileSync(path.join(fixtureRoot, filePath), 'utf8')}`).join('\n\n')
          : '';
        const oracleGuidance = missingOracle
          ? '\nNO TEST SUITE EXISTS in this workspace. FIRST create test.js (write_file) that verifies the goal, THEN fix the code.'
          : `\nCurrent test output:\n${testBefore.output.slice(0, 800)}`;
        const wantWholeFile = malformedRejections >= 2;
        const rejectionFeedback = lastRejection
          ? wantWholeFile
            ? `\nYour previous patches were REJECTED as malformed: ${lastRejection}\nSTOP emitting patches. Emit write_file with the COMPLETE corrected content of the file you need to change.`
            : `\nYour previous proposal was REJECTED by deterministic validation: ${lastRejection}\n${PATCH_EXEMPLAR}`
          : '';
        const prompt = [
          `Task id: ${task.id}`,
          `Lane: architect-implementer`,
          `Goal: ${task.goal}`,
          `ARCHITECT PLAN (verify the premise before trusting the plan):`,
          `- Premise to check: ${base.premiseCheck || '(none provided)'}`,
          `- Target file: ${base.plannedTargetFile || '(none provided)'}`,
          `- Approach: ${base.planApproach || '(none provided)'}`,
          `- Ordered subtasks:`,
          ...base.planSubtasks.map((subtask, index) => `  ${index + 1}. ${subtask}`),
          `CURRENT SUBTASK ${Math.min(subtaskIndex + 1, base.planSubtasks.length)}/${base.planSubtasks.length}: ${currentSubtask}`,
          previousSubtaskFeedback ? `Previous subtask oracle feedback:\n${previousSubtaskFeedback}` : '',
          targetContent ? 'Current focus files:' : 'No exact focus file was identified from the plan; inspect the goal and pick the correct file yourself.',
          targetContent,
          PATCH_EXEMPLAR
        ].filter(Boolean).join('\n');
        const response = await provider.generateChat({
          modelId,
          sessionId: `t2-arch-impl-${task.id}-${Date.now()}`,
          responseFormatSchema: ACTION_SCHEMA,
          messages: [
            { role: 'system', content: 'HARNESS_LANE: Propose exactly one tool call per turn. Deterministic validation owns accept/reject. Success requires green tests.' },
            { role: 'user', content: `${prompt}${oracleGuidance}${rejectionFeedback}` }
          ]
        });
        base.cost += response.usage?.totalCost || 0;
        const proposal = parseProposal(response.text);
        if ((proposal.name === 'apply_patch' || proposal.name === 'write_file') && !String(proposal.arguments?.path || '').trim() && currentRepairTarget) {
          proposal.arguments = { ...proposal.arguments, path: currentRepairTarget };
          base.pathRepairs = (base.pathRepairs || 0) + 1;
        }
        if (proposal.name === 'write_file' && wantWholeFile) {
          base.wholeFileRecoveries = (base.wholeFileRecoveries || 0) + 1;
        }
        const protectedTestMutation = rejectProtectedWorkspaceTestMutation(task, proposal);
        const validation = protectedTestMutation
          ? { valid: false, reason: protectedTestMutation }
          : await firewall.validateProposal(proposal);
        if (!validation.valid) {
          lastRejection = validation.reason || 'Proposal rejected without a reason.';
          base.lastValidationError = lastRejection;
          if (/Malformed patch/i.test(lastRejection)) {
            malformedRejections += 1;
          }
          continue;
        }
        lastRejection = '';
        await tools.dispatch(proposal);
        if (proposal.name === 'write_file' && String(proposal.arguments?.path || '') === 'test.js') {
          base.authoredTest = true;
        }
        const tests = await oracles.runTest();
        const heldOutPass = runHeldOutJudge(task, fixtureRoot);
        base.subtaskChecks.push({
          step,
          subtaskIndex,
          subtask: currentSubtask,
          testsPass: tests.pass,
          heldOutPass,
          output: tests.output.slice(0, 800)
        });
        previousSubtaskFeedback = `Subtask ${subtaskIndex + 1} workspace tests ${tests.pass ? 'PASS' : 'FAIL'}; held-out judge ${heldOutPass ? 'PASS' : 'FAIL'}.\n${tests.output.slice(0, 800)}`;
        if (tests.pass && heldOutPass) {
          base.solved = true;
          base.modelDriven = true;
          base.workspaceOracleGreen = true;
          return base;
        }
        if (subtaskIndex < base.planSubtasks.length - 1 && proposal.name !== 'read_file') {
          subtaskIndex += 1;
        }
      } catch (e: any) {
        base.providerFailures += 1;
        base.error = e.message;
      }
    }
    base.solved = runHeldOutJudge(task, fixtureRoot);
    base.modelDriven = base.solved;
    base.workspaceOracleGreen = await workspaceOracleGreen(fixtureRoot);
    return base;
  }

  /**
   * Swarm lane (blueprint Phase 6, depth-1, non-nesting): one explorer worker
   * per source file, each in a fresh session seeing ONLY its file + the goal;
   * their structured findings compile into a compact handoff artifact; a single
   * harnessed implementer works from the handoff — full text of the top
   * suspect only, one-line summaries of the rest. Context multiplication is
   * measured, not assumed: implementer prompt size is recorded against the
   * solo lane's equivalent.
   */
  private async runSwarmLane(provider: Provider, modelId: string, task: Tier2Task, fixtureRoot: string, maxSteps: number): Promise<SwarmLaneResult> {
    const base: SwarmLaneResult = { ...laneBase(fixtureRoot), explorerCalls: 0, handoffChars: 0, implementerPromptChars: 0, soloPromptChars: taskPrompt(task, fixtureRoot, 'harness').length, suspectRotations: 0 };
    const tools = new WorkspaceTools(fixtureRoot);
    const firewall = new Firewall(tools);
    const oracles = new VerificationOracles(fixtureRoot);
    // --- Explorer pass: fresh context per file, workers cannot nest. ---
    const findings: Array<{ path: string; summary: string; suspicionScore: number; keyLines: string }> = [];
    const currentFiles: Record<string, string> = {};
    for (const filePath of Object.keys(task.files)) {
      currentFiles[filePath] = fs.readFileSync(path.join(fixtureRoot, filePath), 'utf8');
    }
    const interlocks = extractInterlocks(currentFiles);
    for (const filePath of Object.keys(task.files)) {
      try {
        base.explorerCalls += 1;
        base.providerCalls += 1;
        const content = currentFiles[filePath];
        const interlockContext = renderInterlocks(filePath, interlocks, currentFiles);
        const response = await provider.generateChat({
          modelId,
          sessionId: `t2-explorer-${task.id}-${filePath.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}`,
          responseFormatSchema: WORKER_SCHEMA,
          messages: [
            { role: 'system', content: 'EXPLORER_WORKER: You see ONE file, its seams with neighbors, and a goal. Return JSON {summary, suspicionScore (0-10: how likely this file must change to meet the goal), keyLines (exact quoted lines that look wrong or relevant)}. Mismatches between this file and its neighbor interfaces are prime suspects. You cannot edit anything.' },
            { role: 'user', content: `Goal: ${task.goal}\nFile: ${filePath}\n${content}${interlockContext ? '\n' + interlockContext : ''}` }
          ]
        });
        base.cost += response.usage?.totalCost || 0;
        const parsed = JSON.parse(response.text);
        findings.push({ path: filePath, summary: String(parsed.summary || '').slice(0, 400), suspicionScore: Number(parsed.suspicionScore) || 0, keyLines: String(parsed.keyLines || '').slice(0, 400) });
      } catch (e: any) {
        base.providerFailures += 1;
        findings.push({ path: filePath, summary: `explorer failed: ${String(e.message).slice(0, 120)}`, suspicionScore: 0, keyLines: '' });
      }
    }
    findings.sort((a, b) => b.suspicionScore - a.suspicionScore);
    const handoff = { generatedAt: new Date().toISOString(), goal: task.goal, findings, interlocks: Object.fromEntries(Object.entries(interlocks).map(([filePath, entry]) => [filePath, { deps: entry.deps, dependents: entry.dependents }])) };
    const handoffJson = JSON.stringify(handoff, null, 2);
    base.handoffChars = handoffJson.length;
    fs.mkdirSync(path.join(fixtureRoot, '.forge'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, '.forge', 'swarm-handoff.json'), handoffJson, 'utf8');
    // --- Implementer: harness mini-loop over the handoff, suspect rotation on failure. ---
    let suspectIndex = 0;
    let lastRejection = '';
    let malformedRejections = 0;
    const singleSourceFile = Object.keys(task.files).length === 1 ? Object.keys(task.files)[0] : null;
    for (let step = 1; step <= maxSteps; step++) {
      base.steps = step;
      try {
        base.providerCalls += 1;
        const testBefore = await oracles.runTest();
        const missingOracle = /no test|missing script|not found|Cannot find/i.test(testBefore.output) && !fs.existsSync(path.join(fixtureRoot, 'test.js'));
        const suspect = findings[Math.min(suspectIndex, findings.length - 1)];
        const freshFiles: Record<string, string> = {};
        for (const filePath of Object.keys(task.files)) {
          freshFiles[filePath] = fs.readFileSync(path.join(fixtureRoot, filePath), 'utf8');
        }
        const freshInterlocks = extractInterlocks(freshFiles);
        const suspectContent = freshFiles[suspect.path];
        const suspectInterlocks = renderInterlocks(suspect.path, freshInterlocks, freshFiles);
        const briefs = findings.filter(finding => finding.path !== suspect.path).map(finding => `- ${finding.path} (suspicion ${finding.suspicionScore}): ${finding.summary.slice(0, 160)}`);
        const oracleGuidance = missingOracle
          ? '\nNO TEST SUITE EXISTS in this workspace. FIRST create test.js (write_file) that verifies the goal, THEN fix the code.'
          : `\nCurrent test output:\n${testBefore.output.slice(0, 800)}`;
        const wantWholeFile = malformedRejections >= 2;
        const rejectionFeedback = lastRejection
          ? wantWholeFile
            ? `\nYour previous patches were REJECTED as malformed: ${lastRejection}\nSTOP emitting patches. Emit write_file with the COMPLETE corrected content of the file you need to change.`
            : `\nYour previous proposal was REJECTED by deterministic validation: ${lastRejection}\n${PATCH_EXEMPLAR}`
          : '';
        const prompt = [
          `Task id: ${task.id}`,
          `Lane: swarm-implementer`,
          `Goal: ${task.goal}`,
          `Team findings (explorer workers, ranked by suspicion):`,
          ...briefs,
          `PRIME SUSPECT ${suspect.path} (suspicion ${suspect.suspicionScore}) - full current content:`,
          suspectContent,
          suspectInterlocks,
          suspect.keyLines ? `Explorer flagged lines:\n${suspect.keyLines}` : '',
          PATCH_EXEMPLAR
        ].filter(Boolean).join('\n');
        base.implementerPromptChars = Math.max(base.implementerPromptChars, prompt.length);
        const response = await provider.generateChat({
          modelId,
          sessionId: `t2-swarm-impl-${task.id}-${Date.now()}`,
          responseFormatSchema: ACTION_SCHEMA,
          messages: [
            { role: 'system', content: 'HARNESS_LANE: Propose exactly one tool call per turn. Deterministic validation owns accept/reject. Success requires green tests.' },
            { role: 'user', content: `${prompt}${oracleGuidance}${rejectionFeedback}` }
          ]
        });
        base.cost += response.usage?.totalCost || 0;
        const proposal = parseProposal(response.text);
        let pathAmbiguityHint = '';
        if ((proposal.name === 'apply_patch' || proposal.name === 'write_file') && !String(proposal.arguments?.path || '').trim()) {
          if (singleSourceFile) {
            proposal.arguments = { ...proposal.arguments, path: singleSourceFile };
            base.pathRepairs = (base.pathRepairs || 0) + 1;
          } else if (proposal.name === 'apply_patch') {
            const candidates = Object.keys(task.files).map(filePath => ({ path: filePath, content: fs.readFileSync(path.join(fixtureRoot, filePath), 'utf8') }));
            const resolved = resolvePatchTargetByContent(candidates, String(proposal.arguments?.patchContent || ''));
            if (resolved.path) {
              proposal.arguments = { ...proposal.arguments, path: resolved.path };
              base.pathRepairs = (base.pathRepairs || 0) + 1;
              base.contentAddressedRepairs = (base.contentAddressedRepairs || 0) + 1;
            } else {
              pathAmbiguityHint = ` Your patch omitted "path" and its SEARCH block matched ${resolved.matchCount} candidate files - emit the "path" argument explicitly.`;
            }
          } else {
            // write_file with empty path in the swarm lane targets the prime suspect.
            proposal.arguments = { ...proposal.arguments, path: suspect.path };
            base.pathRepairs = (base.pathRepairs || 0) + 1;
          }
        }
        if (proposal.name === 'write_file' && wantWholeFile) {
          base.wholeFileRecoveries = (base.wholeFileRecoveries || 0) + 1;
        }
        const protectedTestMutation = rejectProtectedWorkspaceTestMutation(task, proposal);
        const validation = protectedTestMutation
          ? { valid: false, reason: protectedTestMutation }
          : await firewall.validateProposal(proposal);
        if (!validation.valid) {
          lastRejection = (validation.reason || 'Proposal rejected without a reason.') + pathAmbiguityHint;
          base.lastValidationError = lastRejection;
          if (/Malformed patch/i.test(lastRejection)) {
            malformedRejections += 1;
          }
          continue;
        }
        lastRejection = '';
        await tools.dispatch(proposal);
        if (proposal.name === 'write_file' && String(proposal.arguments?.path || '') === 'test.js') {
          base.authoredTest = true;
        }
        const tests = await oracles.runTest();
        if (tests.pass && runHeldOutJudge(task, fixtureRoot)) {
          base.solved = true;
          base.modelDriven = true;
          base.workspaceOracleGreen = true;
          return base;
        }
        // Red oracle after a committed change: rotate to the next suspect.
        if (!tests.pass && suspectIndex < findings.length - 1) {
          suspectIndex += 1;
          base.suspectRotations += 1;
        }
      } catch (e: any) {
        base.providerFailures += 1;
        base.error = e.message;
      }
    }
    base.solved = runHeldOutJudge(task, fixtureRoot);
    base.modelDriven = base.solved;
    base.workspaceOracleGreen = await workspaceOracleGreen(fixtureRoot);
    return base;
  }
}

function laneBase(fixtureRoot: string): Tier2LaneResult {
  return { solved: false, modelDriven: false, workspaceOracleGreen: false, authoredTest: false, providerCalls: 0, providerFailures: 0, steps: 0, cost: 0, fixtureRoot };
}

class TimeoutProvider implements Provider {
  constructor(private readonly inner: Provider, private readonly timeoutMs: number) {}

  public capabilities(modelId: string): ReturnType<Provider['capabilities']> {
    return this.inner.capabilities(modelId);
  }

  public listModels(): Promise<ModelDescriptor[]> {
    return this.inner.listModels();
  }

  public generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    let timeout: NodeJS.Timeout | undefined;
    const timer = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Provider call timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    });
    return Promise.race([this.inner.generateChat(options), timer]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
  }
}

function buildReport(input: {
  options: Tier2EvalOptions;
  modelId: string;
  live: boolean;
  liveCanary: Tier2EvalReport['liveCanary'];
  results: Tier2TaskResult[];
  totalTaskCount: number;
  reportPath: string;
  archivePath: string;
  runId: string;
  startedAt: string;
  partial: boolean;
}): Tier2EvalReport {
  const { options, modelId, live, liveCanary, results, totalTaskCount, reportPath, archivePath, runId, startedAt, partial } = input;
  const routedSolved = (result: Tier2TaskResult) => result.dispatchLane === 'swarm' ? result.swarm?.solved === true : result.harness?.solved === true;
  const byKind: Tier2EvalReport['byKind'] = {};
  for (const result of results) {
    byKind[result.kind] = byKind[result.kind] || {
      total: 0,
      bareSolved: 0,
      harnessSolved: 0,
      ...(options.includeSwarmLane && !options.dispatch ? { swarmSolved: 0 } : {}),
      ...(options.includeArchitectLane && !options.dispatch ? { architectSolved: 0 } : {}),
      ...(options.dispatch ? { dispatchSolved: 0 } : {})
    };
    byKind[result.kind].total += 1;
    byKind[result.kind].bareSolved += result.bare.solved ? 1 : 0;
    byKind[result.kind].harnessSolved += result.harness?.solved ? 1 : 0;
    if (result.swarm && !options.dispatch) {
      byKind[result.kind].swarmSolved = (byKind[result.kind].swarmSolved || 0) + (result.swarm.solved ? 1 : 0);
    }
    if (result.architect && !options.dispatch) {
      byKind[result.kind].architectSolved = (byKind[result.kind].architectSolved || 0) + (result.architect.solved ? 1 : 0);
    }
    if (options.dispatch) {
      byKind[result.kind].dispatchSolved = (byKind[result.kind].dispatchSolved || 0) + (routedSolved(result) ? 1 : 0);
    }
  }
  const bareSolved = results.filter(result => result.bare.solved).length;
  const harnessSolved = results.filter(result => result.harness?.solved).length;
  const swarmSolved = options.includeSwarmLane && !options.dispatch ? results.filter(result => result.swarm?.solved).length : undefined;
  const architectSolved = options.includeArchitectLane && !options.dispatch ? results.filter(result => result.architect?.solved).length : undefined;
  const dispatchSolved = options.dispatch ? results.filter(routedSolved).length : undefined;
  const headline = options.dispatch
    ? (dispatchSolved || 0)
    : Math.max(harnessSolved, swarmSolved || 0, architectSolved || 0);
  return {
    runId,
    startedAt,
    passed: headline > bareSolved,
    status: headline > bareSolved ? 'uplift_observed' : 'no_uplift_observed',
    partial,
    completedTaskCount: results.length,
    lastUpdatedAt: new Date().toISOString(),
    tier: options.tier || 2,
    generatedAt: startedAt,
    modelId,
    live,
    taskCount: totalTaskCount,
    bareSolved,
    harnessSolved,
    swarmSolved,
    architectSolved,
    dispatchSolved,
    solveRateDelta: results.length ? headline / results.length - bareSolved / results.length : 0,
    byKind,
    providerCalls: sum(results, result => result.bare.providerCalls + (result.harness?.providerCalls || 0) + (result.swarm?.providerCalls || 0) + (result.architect?.providerCalls || 0)),
    providerFailures: sum(results, result => result.bare.providerFailures + (result.harness?.providerFailures || 0) + (result.swarm?.providerFailures || 0) + (result.architect?.providerFailures || 0)),
    cost: sum(results, result => result.bare.cost + (result.harness?.cost || 0) + (result.swarm?.cost || 0) + (result.architect?.cost || 0)),
    liveCanary,
    reportPath,
    archivePath,
    tasks: results
  };
}

function persistTierReport(report: Tier2EvalReport): void {
  if (!report.reportPath) {
    return;
  }
  fs.mkdirSync(path.dirname(report.reportPath), { recursive: true });
  const serialized = JSON.stringify(report, null, 2);
  fs.writeFileSync(report.reportPath, serialized, 'utf8');
  if (report.archivePath) {
    fs.mkdirSync(path.dirname(report.archivePath), { recursive: true });
    fs.writeFileSync(report.archivePath, serialized, 'utf8');
  }
}

function createEvalRunId(tier: number, live: boolean, startedAt: string): string {
  const timestamp = startedAt.replace(/[-:.]/g, '');
  return `tier${tier}-${live ? 'live' : 'mock'}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function rejectProtectedWorkspaceTestMutation(task: Tier2Task, proposal: ToolProposal): string {
  if (!task.workspaceTest || task.kind === 'missing-test') {
    return '';
  }
  if (proposal.name !== 'apply_patch' && proposal.name !== 'write_file') {
    return '';
  }
  const target = String(proposal.arguments?.path || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return target === 'test.js'
    ? 'Protected workspace oracle: this task already provides test.js. Fix source files; do not edit the visible test oracle.'
    : '';
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizePlanSubtask(item: unknown): string {
  if (typeof item === 'string') {
    return item.trim();
  }
  if (!item || typeof item !== 'object') {
    return String(item || '').trim();
  }
  const record = item as Record<string, unknown>;
  const pathLike = firstString(record, ['path', 'file', 'targetFile', 'target', 'filename']);
  const actionLike = firstString(record, ['action', 'description', 'instruction', 'instructions', 'task', 'change', 'goal']);
  const parts = [pathLike, actionLike].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(': ').trim();
  }
  try {
    return JSON.stringify(record);
  } catch {
    return '';
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function extractPlanFiles(text: string, files: Record<string, string>): string[] {
  const normalized = text.replace(/\\/g, '/');
  return Object.keys(files).filter(filePath => {
    const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const basename = filePath.includes('/') ? filePath.slice(filePath.lastIndexOf('/') + 1) : filePath;
    const escapedBase = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}([^A-Za-z0-9_./-]|$)`).test(normalized) ||
      new RegExp(`(^|[^A-Za-z0-9_.-])${escapedBase}([^A-Za-z0-9_.-]|$)`).test(normalized);
  });
}

function taskPrompt(task: Tier2Task, fixtureRoot: string, lane: string): string {
  const filePaths = Object.keys(task.files);
  const contents = filePaths.map(filePath => fs.readFileSync(path.join(fixtureRoot, filePath), 'utf8'));
  const totalChars = contents.reduce((total, content) => total + content.length, 0);
  // Honest context overflow: beyond the budget, each file shows only its head
  // plus a visible truncation marker. Swarm explorers are unaffected — they
  // each get one full file. This is the condition tier-3 exists to measure.
  const perFileBudget = totalChars > SOLO_PROMPT_CHAR_BUDGET
    ? Math.max(400, Math.floor(SOLO_PROMPT_CHAR_BUDGET / filePaths.length))
    : Infinity;
  const fileSections = filePaths.map((filePath, index) => {
    const current = contents[index];
    if (current.length <= perFileBudget) {
      return `--- ${filePath} ---\n${current}`;
    }
    return `--- ${filePath} ---\n${current.slice(0, perFileBudget)}\n[TRUNCATED: ${current.length - perFileBudget} of ${current.length} chars not shown]`;
  });
  return [
    `Task id: ${task.id}`,
    `Kind: ${task.kind}`,
    `Lane: ${lane}`,
    `Goal: ${task.goal}`,
    'Workspace files:',
    ...fileSections,
    PATCH_EXEMPLAR
  ].join('\n');
}

function createFixture(task: Tier2Task, lane: string): string {
  const safe = `${task.id}-${lane}`.replace(/[^a-z0-9_.-]+/gi, '_');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-tier2-${safe}-`));
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

/** Runner-owned judge. Written and executed AFTER the run; never visible to the model during it. */
function runHeldOutJudge(task: Tier2Task, fixtureRoot: string): boolean {
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

async function workspaceOracleGreen(fixtureRoot: string): Promise<boolean> {
  try {
    return (await new VerificationOracles(fixtureRoot).runTest()).pass;
  } catch {
    return false;
  }
}

function parseProposal(text: string): ToolProposal {
  const parsed = JSON.parse(text);
  if (!parsed?.proposal?.name || !parsed?.proposal?.arguments) {
    throw new Error('Model response did not contain a proposal.');
  }
  return parsed.proposal;
}

function sum<T>(items: T[], get: (item: T) => number): number {
  return items.reduce((total, item) => total + get(item), 0);
}

export function tier2Tasks(): Tier2Task[] {
  return [
    {
      id: 't2-reexport-bug',
      title: 'Multi-file: bug behind a re-export',
      kind: 'multi-file-bug',
      goal: 'total(cart) must sum item prices. The bug is NOT necessarily in index.js.',
      files: {
        'src/cart.js': 'function total(items) {\n  return items.reduce((sum, item) => sum - item.price, 0);\n}\n\nmodule.exports = { total };\n',
        'index.js': "const { total } = require('./src/cart');\n\nmodule.exports = { total };\n"
      },
      workspaceTest: "const assert = require('assert');\nconst { total } = require('./index');\nassert.equal(total([{ price: 2 }, { price: 3 }]), 5);\nconsole.log('pass t2-reexport-bug');\n",
      heldOutTest: "const assert = require('assert');\nconst { total } = require('./index');\nassert.equal(total([{ price: 2 }, { price: 3 }]), 5);\nassert.equal(total([]), 0);\nconsole.log('judge pass');\n"
    },
    {
      id: 't2-config-default',
      title: 'Multi-file: service ignores config default',
      kind: 'multi-file-bug',
      goal: 'timeoutFor(options) must fall back to config.DEFAULT_TIMEOUT when options.timeout is missing.',
      files: {
        'src/config.js': 'const DEFAULT_TIMEOUT = 5000;\n\nmodule.exports = { DEFAULT_TIMEOUT };\n',
        'src/service.js': "const config = require('./config');\n\nfunction timeoutFor(options) {\n  return options.timeout;\n}\n\nmodule.exports = { timeoutFor };\n",
        'index.js': "const { timeoutFor } = require('./src/service');\n\nmodule.exports = { timeoutFor };\n"
      },
      workspaceTest: "const assert = require('assert');\nconst { timeoutFor } = require('./index');\nassert.equal(timeoutFor({ timeout: 100 }), 100);\nassert.equal(timeoutFor({}), 5000);\nconsole.log('pass t2-config-default');\n",
      heldOutTest: "const assert = require('assert');\nconst { timeoutFor } = require('./index');\nassert.equal(timeoutFor({ timeout: 100 }), 100);\nassert.equal(timeoutFor({}), 5000);\nconsole.log('judge pass');\n"
    },
    {
      id: 't2-broken-import',
      title: 'Multi-file: misnamed import breaks the chain',
      kind: 'multi-file-bug',
      goal: 'index.js must expose a working formatName. One of the files imports the wrong symbol name.',
      files: {
        'src/format.js': 'function formatName(name) {\n  return String(name).trim().toLowerCase();\n}\n\nmodule.exports = { formatName };\n',
        'index.js': "const { formatname } = require('./src/format');\n\nmodule.exports = { formatName: formatname };\n"
      },
      workspaceTest: "const assert = require('assert');\nconst { formatName } = require('./index');\nassert.equal(formatName('  Ada  '), 'ada');\nconsole.log('pass t2-broken-import');\n",
      heldOutTest: "const assert = require('assert');\nconst { formatName } = require('./index');\nassert.equal(formatName('  Ada  '), 'ada');\nconsole.log('judge pass');\n"
    },
    {
      id: 't2-missing-test-clamp',
      title: 'Missing test: clamp bug with no oracle',
      kind: 'missing-test',
      goal: 'clamp(value, min, max) must clamp into [min, max]. No tests exist yet — a correct test suite is part of done.',
      files: {
        'src/clamp.js': 'function clamp(value, min, max) {\n  return value;\n}\n\nmodule.exports = { clamp };\n'
      },
      heldOutTest: "const assert = require('assert');\nconst { clamp } = require('./src/clamp');\nassert.equal(clamp(5, 0, 10), 5);\nassert.equal(clamp(-5, 0, 10), 0);\nassert.equal(clamp(50, 0, 10), 10);\nconsole.log('judge pass');\n"
    },
    {
      id: 't2-missing-test-dedupe',
      title: 'Missing test: dedupe with no oracle',
      kind: 'missing-test',
      goal: 'unique(items) must return unique items preserving first-seen order. No tests exist yet — a correct test suite is part of done.',
      files: {
        'src/dedupe.js': 'function unique(items) {\n  return items;\n}\n\nmodule.exports = { unique };\n'
      },
      heldOutTest: "const assert = require('assert');\nconst { unique } = require('./src/dedupe');\nassert.deepEqual(unique(['a', 'b', 'a']), ['a', 'b']);\nconsole.log('judge pass');\n"
    },
    {
      id: 't2-feature-multiply',
      title: 'Feature: add multiply and wire the export',
      kind: 'feature',
      goal: 'Add multiply(a, b) to src/math.js and export it through index.js alongside add.',
      files: {
        'src/math.js': 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n',
        'index.js': "const { add } = require('./src/math');\n\nmodule.exports = { add };\n"
      },
      workspaceTest: "const assert = require('assert');\nconst { add, multiply } = require('./index');\nassert.equal(add(2, 3), 5);\nassert.equal(multiply(2, 3), 6);\nconsole.log('pass t2-feature-multiply');\n",
      heldOutTest: "const assert = require('assert');\nconst { add, multiply } = require('./index');\nassert.equal(add(2, 3), 5);\nassert.equal(multiply(4, 5), 20);\nconsole.log('judge pass');\n"
    },
    {
      id: 't2-feature-validate',
      title: 'Feature: add isNonEmpty validator and export it',
      kind: 'feature',
      goal: 'Add isNonEmpty(text) (true for non-empty trimmed strings) to src/validators.js and export it through index.js.',
      files: {
        'src/validators.js': "function isValidEmail(email) {\n  if (!email) return false;\n  return String(email).includes('@');\n}\n\nmodule.exports = { isValidEmail };\n",
        'index.js': "const { isValidEmail } = require('./src/validators');\n\nmodule.exports = { isValidEmail };\n"
      },
      workspaceTest: "const assert = require('assert');\nconst { isValidEmail, isNonEmpty } = require('./index');\nassert.equal(isValidEmail('a@b.c'), true);\nassert.equal(isNonEmpty('hi'), true);\nassert.equal(isNonEmpty('   '), false);\nconsole.log('pass t2-feature-validate');\n",
      heldOutTest: "const assert = require('assert');\nconst { isNonEmpty } = require('./index');\nassert.equal(isNonEmpty('x'), true);\nassert.equal(isNonEmpty(''), false);\nassert.equal(isNonEmpty('  '), false);\nconsole.log('judge pass');\n"
    }
  ];
}

/** Deterministic mock proving suite mechanics: solves in the harness lane, fails bare (one blind shot at multi-file work). */
class MockTier2Provider implements Provider {
  private swarmImplementerCalls = new Map<string, number>();

  public capabilities() {
    return { structuredOutput: true, toolCalls: false, vision: false, contextLength: 32000 };
  }

  public async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }

  public async generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    const prompt = options.messages.map(message => message.content).join('\n');
    if (prompt.includes('EXPLORER_WORKER')) {
      const fileMatch = prompt.match(/File: ([^\n]+)/);
      const filePath = fileMatch ? fileMatch[1].trim() : '';
      const goalMatch = prompt.match(/Goal: ([^\n]+)/);
      const task = tier2Tasks().find(candidate => candidate.goal === (goalMatch ? goalMatch[1].trim() : ''));
      const buggy = task ? mockBuggyFile(task) : '';
      return { text: JSON.stringify({ summary: `Role of ${filePath} relative to the goal.`, suspicionScore: filePath === buggy ? 9 : 2, keyLines: filePath === buggy ? 'flagged by explorer' : '' }) };
    }
    const task = tier2Tasks().find(candidate => prompt.includes(`Task id: ${candidate.id}`));
    if (!task) {
      throw new Error('Mock tier-2 provider could not identify task.');
    }
    if (prompt.includes('BARE_BASELINE')) {
      return { text: JSON.stringify({ explanation: 'bare blind shot at the wrong file', proposal: { name: 'apply_patch', arguments: { path: 'index.js', patchContent: 'not a patch' } } }) };
    }
    if (prompt.includes('NO TEST SUITE EXISTS') ) {
      return { text: JSON.stringify({ explanation: 'author the oracle first', proposal: { name: 'write_file', arguments: { path: 'test.js', content: mockWorkspaceTest(task) } } }) };
    }
    if (prompt.includes('Lane: swarm-implementer') && (task.kind === 'feature')) {
      const key = task.id;
      const calls = (this.swarmImplementerCalls.get(key) || 0) + 1;
      this.swarmImplementerCalls.set(key, calls);
      const arguments_ = calls === 1 ? mockFix(task, '') : mockFix(task, 'function multiply function isNonEmpty');
      return { text: JSON.stringify({ explanation: 'swarm implementer step ' + calls, proposal: { name: 'write_file', arguments: arguments_ } }) };
    }
    return { text: JSON.stringify({ explanation: 'fix the right file', proposal: { name: 'write_file', arguments: mockFix(task, prompt) } }) };
  }
}

function mockBuggyFile(task: Tier2Task): string {
  switch (task.id) {
    case 't2-reexport-bug': return 'src/cart.js';
    case 't2-config-default': return 'src/service.js';
    case 't2-broken-import': return 'index.js';
    case 't2-missing-test-clamp': return 'src/clamp.js';
    case 't2-missing-test-dedupe': return 'src/dedupe.js';
    case 't2-feature-multiply': return 'src/math.js';
    default: return 'src/validators.js';
  }
}

function mockWorkspaceTest(task: Tier2Task): string {
  if (task.id === 't2-missing-test-clamp') {
    return "const assert = require('assert');\nconst { clamp } = require('./src/clamp');\nassert.equal(clamp(5, 0, 10), 5);\nassert.equal(clamp(-1, 0, 10), 0);\nassert.equal(clamp(99, 0, 10), 10);\nconsole.log('authored test pass');\n";
  }
  return "const assert = require('assert');\nconst { unique } = require('./src/dedupe');\nassert.deepEqual(unique(['a', 'b', 'a']), ['a', 'b']);\nconsole.log('authored test pass');\n";
}

function mockFix(task: Tier2Task, prompt: string): { path: string; content: string } {
  switch (task.id) {
    case 't2-reexport-bug':
      return { path: 'src/cart.js', content: 'function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n\nmodule.exports = { total };\n' };
    case 't2-config-default':
      return { path: 'src/service.js', content: "const config = require('./config');\n\nfunction timeoutFor(options) {\n  return options.timeout ?? config.DEFAULT_TIMEOUT;\n}\n\nmodule.exports = { timeoutFor };\n" };
    case 't2-broken-import':
      return { path: 'index.js', content: "const { formatName } = require('./src/format');\n\nmodule.exports = { formatName };\n" };
    case 't2-missing-test-clamp':
      return { path: 'src/clamp.js', content: 'function clamp(value, min, max) {\n  return Math.min(max, Math.max(min, value));\n}\n\nmodule.exports = { clamp };\n' };
    case 't2-missing-test-dedupe':
      return { path: 'src/dedupe.js', content: 'function unique(items) {\n  return Array.from(new Set(items));\n}\n\nmodule.exports = { unique };\n' };
    case 't2-feature-multiply':
      // Multi-step feature: create the function first, wire the export second.
      if (!prompt.includes('function multiply')) {
        return { path: 'src/math.js', content: 'function add(a, b) {\n  return a + b;\n}\n\nfunction multiply(a, b) {\n  return a * b;\n}\n\nmodule.exports = { add, multiply };\n' };
      }
      return { path: 'index.js', content: "const { add, multiply } = require('./src/math');\n\nmodule.exports = { add, multiply };\n" };
    default:
      if (!prompt.includes('function isNonEmpty')) {
        return { path: 'src/validators.js', content: "function isValidEmail(email) {\n  if (!email) return false;\n  return String(email).includes('@');\n}\n\nfunction isNonEmpty(text) {\n  return typeof text === 'string' && text.trim().length > 0;\n}\n\nmodule.exports = { isValidEmail, isNonEmpty };\n" };
      }
      return { path: 'index.js', content: "const { isValidEmail, isNonEmpty } = require('./src/validators');\n\nmodule.exports = { isValidEmail, isNonEmpty };\n" };
  }
}

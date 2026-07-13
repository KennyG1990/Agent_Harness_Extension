import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScriptedPlanBigExecuteSmallEval } from '../out/harness/topologyEval.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-topology-report-'));
try {
  const report = await runScriptedPlanBigExecuteSmallEval(root);
  assert.equal(report.rigorMatched, true);
  assert.equal(report.lanes.length, 2);
  assert.equal(report.lanes.every(lane => lane.solved && lane.greenEvidence && lane.diffReviewed), true);
  assert.equal(report.lanes.every(lane => lane.fallbackProposals === 0 && lane.actuallyModelDriven), true);
  assert.ok(report.costDeltaUsd > 0, 'split topology should cost less under scripted usage prices');
  assert.equal(report.upliftObserved, true);
  assert.ok(fs.existsSync(report.reportPath));
  console.log(JSON.stringify({ pass: true, costDeltaUsd: report.costDeltaUsd, lanes: report.lanes.map(lane => ({ lane: lane.lane, solved: lane.solved, calls: lane.providerCalls, costUsd: lane.costUsd, models: lane.roleMetrics.map(item => `${item.role}:${item.modelId}`) })) }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}


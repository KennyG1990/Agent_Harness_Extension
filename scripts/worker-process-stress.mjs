import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessWorkerExecutor } from '../out/harness/workerExecutor.js';

const iterations = Number(process.argv[2] || 100);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-worker-stress-'));
fs.writeFileSync(path.join(root, 'probe.txt'), 'worker-process-stress', 'utf8');
const executor = new ProcessWorkerExecutor();
const pids = [];

try {
  for (let index = 0; index < iterations; index += 1) {
    const result = await executor.dispatch(root, index % 2 ? 'Editor' : 'Explorer', {
      name: 'read_file',
      arguments: { path: 'probe.txt' }
    }, 10_000);
    assert.equal(result.success, true, `worker request ${index} failed: ${result.output}`);
    assert.equal(result.output, 'worker-process-stress');
    assert.ok(result.worker.pid > 0 && result.worker.pid !== process.pid, `worker request ${index} did not return an external PID`);
    assert.equal(isProcessAlive(result.worker.pid), false, `dispatch ${index} resolved before worker PID ${result.worker.pid} exited`);
    pids.push(result.worker.pid);
  }
  assert.equal(pids.length, iterations, 'every request must return one external worker process identity');
  console.log(`worker process stress: PASS ${iterations}/${iterations}; all children exited before dispatch resolved`);
} finally {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (error) {
    console.error(`worker stress cleanup deferred: ${error.message}`);
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

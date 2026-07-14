import * as fs from 'fs';
import * as path from 'path';
import { AgentHarnessLoop } from './loop';
import { createConfiguredProvider, Provider } from './provider';
import { BackgroundSessionStatus, BackgroundSessionStore, changedAgainstBaseline } from './backgroundSessions';

export async function runBackgroundSession(manifestPath: string, provider: Provider = createConfiguredProvider()): Promise<void> {
  const absoluteManifest = path.resolve(String(manifestPath || ''));
  const sessionId = path.basename(path.dirname(absoluteManifest));
  const sourceRoot = path.resolve(path.dirname(absoluteManifest), '..', '..', '..');
  const store = new BackgroundSessionStore(sourceRoot);
  if (store.manifestPath(sessionId) !== absoluteManifest) throw new Error('Background manifest path is not canonical.');
  let manifest = store.load(sessionId);
  if (!fs.existsSync(manifest.isolatedRoot) || !fs.statSync(manifest.isolatedRoot).isDirectory()) throw new Error('Background isolated root is missing.');
  manifest = store.update(sessionId, current => ({ ...current, status: 'running', pid: process.pid, heartbeatAt: new Date().toISOString(), error: undefined }));
  const heartbeat = setInterval(() => {
    try { store.update(sessionId, current => ({ ...current, heartbeatAt: new Date().toISOString(), pid: process.pid })); } catch { /* main loop owns terminal reporting */ }
  }, 2_000);
  heartbeat.unref();
  try {
    const sourceModules = path.join(sourceRoot, 'node_modules');
    if (fs.existsSync(sourceModules)) {
      process.env.PATH = `${path.join(sourceModules, '.bin')}${path.delimiter}${process.env.PATH || ''}`;
      process.env.NODE_PATH = sourceModules;
    }
    const loop = new AgentHarnessLoop(provider, manifest.isolatedRoot, undefined, undefined, ['browser_inspect', 'browser_action', 'computer_inspect', 'computer_action', 'external_tool']);
    let state = await loop.resumeFromDisk({ additionalSteps: 30, allowBudgetHaltResume: true });
    if (!state) throw new Error('Background run state is missing.');
    if (state.sessionId !== manifest.sessionId || state.executionContract.digest !== manifest.executionContract.digest || state.executionContract.revision !== manifest.executionContract.revision || state.executionContract.status !== 'confirmed') {
      throw new Error('Background execution contract identity or confirmation is invalid.');
    }
    while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
      if (store.cancellationRequested(sessionId)) {
        store.update(sessionId, current => ({ ...current, status: 'cancelled', heartbeatAt: new Date().toISOString(), exitCode: 0, pid: undefined }));
        store.releaseWorkspaceLease(sessionId);
        return;
      }
      state = await loop.runStep(state, manifest.modelBindings);
      store.update(sessionId, current => ({ ...current, heartbeatAt: new Date().toISOString(), pid: process.pid }));
    }
    const changedFiles = changedAgainstBaseline(manifest.isolatedRoot, manifest.baseline);
    const status: BackgroundSessionStatus = state.status === 'success'
      ? (changedFiles.length ? 'awaiting_review' : 'completed_no_changes')
      : state.status === 'awaiting_input' ? 'awaiting_input'
        : state.status === 'awaiting_approval' ? 'awaiting_approval'
          : state.status === 'gave_up' ? 'gave_up' : 'failed';
    store.update(sessionId, current => ({ ...current, status, changedFiles, heartbeatAt: new Date().toISOString(), exitCode: 0, pid: undefined, steps: state.currentStepIndex, costUsd: state.goalContract.spent }));
  } catch (error: any) {
    store.update(sessionId, current => ({ ...current, status: 'failed', error: String(error?.message || error).slice(0, 2_000), heartbeatAt: new Date().toISOString(), exitCode: 1, pid: undefined }));
    throw error;
  } finally {
    clearInterval(heartbeat);
    store.releaseWorkspaceLease(sessionId);
  }
}

if (require.main === module) {
  runBackgroundSession(process.argv[2]).then(() => process.exit(0)).catch(error => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
  });
}

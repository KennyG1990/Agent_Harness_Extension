import { ChildProcess, fork } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { ToolResult } from './tools';
import { ToolProposal } from './types';

export interface WorkerProcessMetadata {
  role: string;
  pid: number;
  durationMs: number;
  sanitizedEnv: boolean;
  inheritedEnvKeyCount: number;
  allowedEnvKeys: string[];
  blockedEnvKeys: string[];
}

export interface WorkerToolResult extends ToolResult {
  worker: WorkerProcessMetadata;
}

interface WorkerRequest {
  id: string;
  workspaceRoot: string;
  role: string;
  proposal: ToolProposal;
}

interface WorkerResponse {
  id: string;
  result?: ToolResult;
  error?: string;
}

export class ProcessWorkerExecutor {
  public async dispatch(workspaceRoot: string, role: string, proposal: ToolProposal, timeoutMs = 130_000): Promise<WorkerToolResult> {
    const request: WorkerRequest = {
      id: crypto.randomUUID(),
      workspaceRoot,
      role: role || 'Orchestrator',
      proposal
    };
    const started = Date.now();
    const workerEnv = buildWorkerEnvironment();
    const workerModule = path.join(__dirname, 'workerHost.js');

    return new Promise(resolve => {
      let child: ChildProcess;
      try {
        child = fork(workerModule, [], {
          cwd: workspaceRoot,
          env: workerEnv.env,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
      } catch (error: any) {
        resolve(this.failureResult(request.role, 0, Date.now() - started, workerEnv, `Worker process failed to start: ${error.message}`));
        return;
      }

      let settled = false;
      let pendingResult: ToolResult | undefined;
      let shutdownTimer: NodeJS.Timeout | undefined;
      let stderr = '';
      child.stderr?.on('data', chunk => {
        stderr = `${stderr}${String(chunk)}`.slice(-2000);
      });
      const finish = (result: ToolResult, pid = child.pid || 0) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (shutdownTimer) clearTimeout(shutdownTimer);
        resolve({
          ...result,
          worker: {
            role: request.role,
            pid,
            durationMs: Date.now() - started,
            sanitizedEnv: true,
            inheritedEnvKeyCount: Object.keys(process.env).length,
            allowedEnvKeys: workerEnv.allowedEnvKeys,
            blockedEnvKeys: workerEnv.blockedEnvKeys
          }
        });
      };

      const timer = setTimeout(() => {
        pendingResult = { success: false, output: `Worker process timed out after ${timeoutMs}ms.` };
        child.kill();
        shutdownTimer = setTimeout(() => finish(pendingResult!), 2000);
      }, timeoutMs);

      child.on('message', (message: WorkerResponse) => {
        if (!message || message.id !== request.id) return;
        pendingResult = message.result || { success: false, output: `Worker process failed: ${message.error || 'unknown error'}` };
        if (child.connected) {
          child.disconnect();
        } else {
          child.kill();
        }
        shutdownTimer = setTimeout(() => child.kill(), 2000);
      });
      child.on('error', error => {
        pendingResult = { success: false, output: `Worker process error: ${error.message}` };
        child.kill();
      });
      child.on('exit', (code, signal) => {
        if (settled) return;
        finish(pendingResult || { success: false, output: `Worker process exited before returning a result (code=${code}, signal=${signal || 'none'}).${stderr ? `\n${stderr}` : ''}` });
      });
      child.send(request);
    });
  }

  private failureResult(
    role: string,
    pid: number,
    durationMs: number,
    workerEnv: ReturnType<typeof buildWorkerEnvironment>,
    output: string
  ): WorkerToolResult {
    return {
      success: false,
      output,
      worker: {
        role,
        pid,
        durationMs,
        sanitizedEnv: true,
        inheritedEnvKeyCount: Object.keys(process.env).length,
        allowedEnvKeys: workerEnv.allowedEnvKeys,
        blockedEnvKeys: workerEnv.blockedEnvKeys
      }
    };
  }
}

function buildWorkerEnvironment(): { env: NodeJS.ProcessEnv; allowedEnvKeys: string[]; blockedEnvKeys: string[] } {
  const allowPatterns = [
    /^path$/i,
    /^pathext$/i,
    /^systemroot$/i,
    /^windir$/i,
    /^comspec$/i,
    /^temp$/i,
    /^tmp$/i,
    /^home$/i,
    /^userprofile$/i,
    /^appdata$/i,
    /^localappdata$/i,
    /^programfiles/i,
    /^processor_/i,
    /^number_of_processors$/i,
    /^os$/i,
    /^node_env$/i,
    /^electron_run_as_node$/i
  ];
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  const allowedEnvKeys = ['NODE_ENV'];
  const blockedEnvKeys: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (allowPatterns.some(pattern => pattern.test(key))) {
      if (value !== undefined) env[key] = value;
      if (!allowedEnvKeys.includes(key)) allowedEnvKeys.push(key);
    } else {
      blockedEnvKeys.push(key);
    }
  }
  return {
    env,
    allowedEnvKeys: allowedEnvKeys.sort((a, b) => a.localeCompare(b)),
    blockedEnvKeys: blockedEnvKeys.sort((a, b) => a.localeCompare(b))
  };
}

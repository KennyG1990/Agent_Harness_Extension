import { ChildProcess, execFileSync, fork } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ToolResult } from './tools';
import { ToolProposal } from './types';
import { DEFAULT_RUNTIME_LIMITS, IsolationGrade, supportsNodePermission } from './runtimeIsolation';

export interface WorkerProcessMetadata {
  role: string;
  pid: number;
  durationMs: number;
  sanitizedEnv: boolean;
  inheritedEnvKeyCount: number;
  allowedEnvKeys: string[];
  blockedEnvKeys: string[];
  isolationGrade?: IsolationGrade;
  filesystemRestricted?: boolean;
  childProcessAllowed?: boolean;
  memoryLimitMb?: number;
  outputLimitBytes?: number;
  outputTruncated?: boolean;
  timedOut?: boolean;
  processTreeTerminated?: boolean;
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
    const workerModule = resolveWorkerHostModule();
    const childProcessCapable = ['run_command', 'run_tests', 'browser_validate', 'browser_inspect', 'browser_action', 'computer_inspect', 'computer_action'].includes(request.proposal.name);
    const permissionCapable = supportsNodePermission();
    const runtimeDir = path.dirname(workerModule);
    const extensionRoot = path.dirname(runtimeDir);
    const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect') && !arg.startsWith('--max-old-space-size') && arg !== '--permission');
    execArgv.push(`--max-old-space-size=${DEFAULT_RUNTIME_LIMITS.memoryMb}`);
    if (permissionCapable && !childProcessCapable) {
      execArgv.push(
        '--permission',
        `--allow-fs-read=${workspaceRoot}`,
        `--allow-fs-read=${runtimeDir}`,
        `--allow-fs-read=${path.join(extensionRoot, 'package.json')}`,
        `--allow-fs-read=${path.join(extensionRoot, 'browsers.json')}`,
        `--allow-fs-write=${workspaceRoot}`
      );
    }

    return new Promise(resolve => {
      let child: ChildProcess;
      try {
        child = fork(workerModule, [], {
          cwd: workspaceRoot,
          env: workerEnv.env,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          execArgv,
          detached: process.platform !== 'win32'
        });
      } catch (error: any) {
        resolve(this.failureResult(request.role, 0, Date.now() - started, workerEnv, `Worker process failed to start: ${error.message}`));
        return;
      }

      let settled = false;
      let pendingResult: ToolResult | undefined;
      let shutdownTimer: NodeJS.Timeout | undefined;
      let stderr = '';
      let outputBytes = 0;
      let outputTruncated = false;
      let timedOut = false;
      let processTreeTerminated = false;
      child.stderr?.on('data', chunk => {
        const value = String(chunk);
        outputBytes += Buffer.byteLength(value);
        if (outputBytes > DEFAULT_RUNTIME_LIMITS.outputBytes) outputTruncated = true;
        stderr = `${stderr}${value}`.slice(-2000);
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
            blockedEnvKeys: workerEnv.blockedEnvKeys,
            isolationGrade: permissionCapable && !childProcessCapable ? 'node-permission' : 'process',
            filesystemRestricted: permissionCapable && !childProcessCapable,
            childProcessAllowed: childProcessCapable,
            memoryLimitMb: DEFAULT_RUNTIME_LIMITS.memoryMb,
            outputLimitBytes: DEFAULT_RUNTIME_LIMITS.outputBytes,
            outputTruncated,
            timedOut,
            processTreeTerminated
          }
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        pendingResult = { success: false, output: `Worker process timed out after ${timeoutMs}ms.` };
        processTreeTerminated = terminateProcessTree(child);
        shutdownTimer = setTimeout(() => finish(pendingResult!), 2000);
      }, timeoutMs);

      child.on('message', (message: WorkerResponse) => {
        if (!message || message.id !== request.id) return;
        pendingResult = message.result || { success: false, output: `Worker process failed: ${message.error || 'unknown error'}` };
        if (Buffer.byteLength(pendingResult.output || '') > DEFAULT_RUNTIME_LIMITS.outputBytes) {
          pendingResult.output = `${Buffer.from(pendingResult.output).subarray(0, DEFAULT_RUNTIME_LIMITS.outputBytes).toString('utf8')}\n[output truncated by Forge runtime policy]`;
          outputTruncated = true;
        }
        if (child.connected) {
          child.disconnect();
        } else {
          processTreeTerminated = terminateProcessTree(child);
        }
        shutdownTimer = setTimeout(() => { processTreeTerminated = terminateProcessTree(child) || processTreeTerminated; }, 2000);
      });
      child.on('error', error => {
        pendingResult = { success: false, output: `Worker process error: ${error.message}` };
        processTreeTerminated = terminateProcessTree(child);
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
        ,isolationGrade: 'process'
        ,filesystemRestricted: false
        ,childProcessAllowed: false
        ,memoryLimitMb: DEFAULT_RUNTIME_LIMITS.memoryMb
        ,outputLimitBytes: DEFAULT_RUNTIME_LIMITS.outputBytes
        ,outputTruncated: false
        ,timedOut: false
        ,processTreeTerminated: false
      }
    };
  }
}

function terminateProcessTree(child: ChildProcess): boolean {
  if (!child.pid) return false;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 3000 });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
    return true;
  } catch {
    try { child.kill('SIGKILL'); return true; } catch { return false; }
  }
}

export function resolveWorkerHostModule(baseDir = __dirname): string {
  const candidates = [
    path.join(baseDir, '..', 'workerHost.js'),
    path.join(baseDir, 'workerHost.js'),
    path.join(baseDir, 'harness', 'workerHost.js')
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error(`Forge worker host is missing. Checked: ${candidates.join(', ')}`);
  return resolved;
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

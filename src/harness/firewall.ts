import * as fs from 'fs';
import * as path from 'path';
import { ToolName, ToolProposal } from './types';
import { findLenientMatch, parseSearchReplaceHunks, WorkspaceTools } from './tools';
import { classifyCommandNetworkIntent } from './commandNetwork';
import { validateBrowserUrl } from './browserValidation';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface CheckpointRecord {
  id: string;
  strategy: 'targeted-files' | 'workspace-snapshot';
  proposalName: ToolName;
  protectedPaths: string[];
  manifestPath: string;
  timestamp: string;
}

const CHECKPOINT_EXCLUDED_DIRS = new Set(['node_modules', 'out', 'dist', '.forge', '.git', '.vscode-test', '.tmp', '.next', '.cache', 'coverage', 'target', 'vendor', 'artifacts']);

const MUTATING_TOOLS = new Set<ToolName>(['write_file', 'apply_patch', 'run_command', 'run_tests', 'update_tasks', 'update_plan', 'record_evidence', 'declare_success']);
const TOOL_NAMES: ToolName[] = [
  'repo_search',
  'symbol_search',
  'read_file',
  'read_range',
  'write_file',
  'apply_patch',
  'run_command',
  'run_tests',
  'browser_validate',
  'browser_inspect',
  'browser_action',
  'computer_inspect',
  'computer_action',
  'get_diff',
  'update_tasks',
  'update_plan',
  'record_evidence',
  'ask_user',
  'declare_success'
];

export class Firewall {
  constructor(private readonly tools = new WorkspaceTools()) {}

  public isMutating(proposal: ToolProposal): boolean {
    return MUTATING_TOOLS.has(proposal.name);
  }

  public async validateProposal(proposal: any): Promise<ValidationResult> {
    const schema = this.validateSchema(proposal);
    if (!schema.valid) {
      return schema;
    }

    const typed = proposal as ToolProposal;
    const scope = this.validateScope(typed);
    if (!scope.valid) {
      return scope;
    }

    if (typed.name === 'run_command') {
      const command = String(typed.arguments.command || '');
      const commandPolicy = this.validateCommand(command);
      if (!commandPolicy.valid) {
        return commandPolicy;
      }
    }

    if (typed.name === 'browser_validate' || typed.name === 'browser_inspect') {
      const browserPolicy = validateBrowserUrl(String(typed.arguments.url || ''));
      if (!browserPolicy.valid) return { valid: false, reason: browserPolicy.reason };
      if (typed.arguments.expectedText !== undefined && typeof typed.arguments.expectedText !== 'string') {
        return { valid: false, reason: 'browser_validate expectedText must be a string when provided.' };
      }
      if (typed.arguments.timeoutMs !== undefined && (!Number.isFinite(typed.arguments.timeoutMs) || typed.arguments.timeoutMs < 1000 || typed.arguments.timeoutMs > 30000)) {
        return { valid: false, reason: `${typed.name} timeoutMs must be between 1000 and 30000.` };
      }
    }

    if (typed.name === 'browser_action') {
      const args = typed.arguments;
      if (!/^browser-state-[a-zA-Z0-9-]{8,100}$/.test(String(args.stateId || ''))) return { valid: false, reason: 'browser_action requires a valid inspected stateId.' };
      if (!['click', 'fill', 'press', 'select', 'wait'].includes(String(args.action || ''))) return { valid: false, reason: 'browser_action action must be click, fill, press, select, or wait.' };
      if (args.action !== 'wait' && !/^bt-[a-f0-9]{16}$/.test(String(args.targetId || ''))) return { valid: false, reason: 'browser_action requires a targetId from the inspected state.' };
      if (args.action === 'fill' || args.action === 'select') {
        if (typeof args.value !== 'string' || args.value.length > 2000) return { valid: false, reason: `browser_action ${args.action} requires a string value of at most 2000 characters.` };
      }
      if (args.action === 'press' && (typeof args.key !== 'string' || !/^[a-zA-Z0-9+_-]{1,60}$/.test(args.key))) return { valid: false, reason: 'browser_action press requires a bounded key chord.' };
      if (args.action === 'wait' && args.value !== undefined && (!Number.isFinite(Number(args.value)) || Number(args.value) < 100 || Number(args.value) > 5000)) return { valid: false, reason: 'browser_action wait value must be between 100 and 5000 milliseconds.' };
      if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 30000)) return { valid: false, reason: 'browser_action timeoutMs must be between 1000 and 30000.' };
    }

    if (typed.name === 'computer_inspect') {
      if (typeof typed.arguments.windowTitle !== 'string' || !typed.arguments.windowTitle.trim() || typed.arguments.windowTitle.length > 200) return { valid: false, reason: 'computer_inspect requires a windowTitle of at most 200 characters.' };
    }

    if (typed.name === 'computer_action') {
      const args = typed.arguments;
      if (!/^computer-state-[a-zA-Z0-9-]{8,100}$/.test(String(args.stateId || ''))) return { valid: false, reason: 'computer_action requires a valid inspected stateId.' };
      if (!['invoke', 'set_value', 'focus'].includes(String(args.action || ''))) return { valid: false, reason: 'computer_action action must be invoke, set_value, or focus.' };
      if (!/^ct-[a-f0-9]{16}$/.test(String(args.targetId || ''))) return { valid: false, reason: 'computer_action requires a targetId from the inspected state.' };
      if (args.action === 'set_value' && (typeof args.value !== 'string' || args.value.length > 2000)) return { valid: false, reason: 'computer_action set_value requires a string value of at most 2000 characters.' };
    }

    if (typed.name === 'apply_patch') {
      return this.validatePatchApplicability(String(typed.arguments.path || ''), String(typed.arguments.patchContent || ''));
    }

    if (typed.name === 'write_file' && typeof typed.arguments.content !== 'string') {
      return { valid: false, reason: 'write_file requires string content.' };
    }

    if (typed.name === 'ask_user') {
      if (!String(typed.arguments.question || '').trim() || !String(typed.arguments.uncertainty || '').trim()) {
        return { valid: false, reason: 'ask_user requires non-empty question and uncertainty arguments.' };
      }
      if (typed.arguments.options !== undefined && !Array.isArray(typed.arguments.options)) {
        return { valid: false, reason: 'ask_user options must be an array when provided.' };
      }
    }

    return { valid: true };
  }

  public validateSchema(proposal: any): ValidationResult {
    if (!proposal || typeof proposal !== 'object') {
      return { valid: false, reason: 'Proposal must be an object.' };
    }
    if (!TOOL_NAMES.includes(proposal.name)) {
      return { valid: false, reason: `Unknown tool '${proposal.name}'.` };
    }
    if (!proposal.arguments || typeof proposal.arguments !== 'object' || Array.isArray(proposal.arguments)) {
      return { valid: false, reason: 'Proposal arguments must be an object.' };
    }
    return { valid: true };
  }

  public validateScope(proposal: ToolProposal): ValidationResult {
    const maybePath = proposal.arguments.path;
    if (typeof maybePath !== 'string' || !maybePath) {
      return { valid: true };
    }

    try {
      this.tools.resolveWorkspacePath(maybePath);
      return { valid: true };
    } catch (e: any) {
      return { valid: false, reason: e.message };
    }
  }

  public validateCommand(command: string): ValidationResult {
    const normalized = command.trim().toLowerCase();
    if (!normalized) {
      return { valid: false, reason: 'Command argument is empty.' };
    }

    const blocked = [
      'git reset --hard',
      'git clean',
      'git add',
      'git commit',
      'git checkout',
      'git switch',
      'git branch',
      'git merge',
      'git rebase',
      'git tag',
      'git config',
      'git worktree',
      'git gc',
      'git update-ref',
      'rm -rf /',
      'format ',
      'mkfs',
      'dd ',
      '> /dev/sda',
      ':(){:|:&};:',
      'shred',
      'remove-item -recurse',
      'del /s'
    ];
    const hit = blocked.find(keyword => normalized.includes(keyword));
    if (hit) {
      return { valid: false, reason: `Command policy rejected blocked token '${hit}'.` };
    }
    const network = classifyCommandNetworkIntent(command);
    if (network.decision === 'blocked') {
      return { valid: false, reason: `[network_intent_blocked] ${network.reason}` };
    }
    return { valid: true };
  }

  public validatePatchApplicability(relativePath: string, patchContent: string): ValidationResult {
    try {
      const fullPath = this.tools.resolveWorkspacePath(relativePath);
      if (!fs.existsSync(fullPath)) {
        return { valid: false, reason: `Patch target does not exist: ${relativePath}` };
      }

      const hunks = parseSearchReplaceHunks(patchContent);
      if (!hunks.length) {
        return { valid: false, reason: 'Malformed patch: expected SEARCH/REPLACE hunk.' };
      }

      const content = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
      for (const hunk of hunks) {
        const match = findLenientMatch(content, hunk.search);
        if (match.status === 'ambiguous') {
          return { valid: false, reason: `Edit applicability failed: search block matches ${match.matchCount} locations in ${relativePath}; include more surrounding context.` };
        }
        if (match.status === 'not_found') {
          return { valid: false, reason: `Edit applicability failed: search block not found in ${relativePath} (even with whitespace-lenient matching).` };
        }
      }
      return { valid: true };
    } catch (e: any) {
      return { valid: false, reason: e.message };
    }
  }

  public async createCheckpoint(stepIndex: number, proposal: ToolProposal, strategyOverride?: 'targeted-files' | 'workspace-snapshot'): Promise<CheckpointRecord> {
    const root = this.tools.getWorkspaceRoot();
    const id = `step-${stepIndex}-${Date.now()}`;
    const checkpointDir = path.join(root, '.forge', 'checkpoints', id);
    fs.mkdirSync(checkpointDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const maybePath = typeof proposal.arguments.path === 'string' ? proposal.arguments.path : '';
    const strategy = strategyOverride || (maybePath ? 'targeted-files' : 'workspace-snapshot');
    const record: CheckpointRecord = {
      id,
      strategy,
      proposalName: proposal.name,
      protectedPaths: strategy === 'targeted-files' && maybePath ? [maybePath.replace(/\\/g, '/')] : ['.'],
      manifestPath: path.join('.forge', 'checkpoints', id, 'manifest.json').replace(/\\/g, '/'),
      timestamp
    };

    if (record.strategy === 'targeted-files' && maybePath) {
      await copyTargetSnapshot(root, checkpointDir, this.tools.resolveWorkspacePath(maybePath), maybePath);
    } else {
      await copyWorkspaceSnapshot(root, checkpointDir);
    }

    fs.writeFileSync(path.join(checkpointDir, 'manifest.json'), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  public async revertToCheckpoint(checkpointId: string): Promise<boolean> {
    const root = this.tools.getWorkspaceRoot();
    const checkpointDir = path.join(root, '.forge', 'checkpoints', checkpointId);
    if (!fs.existsSync(checkpointDir)) {
      return false;
    }
    const manifestPath = path.join(checkpointDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CheckpointRecord;
      if (manifest.strategy === 'targeted-files') {
        await restoreTargetSnapshot(root, checkpointDir, manifest.protectedPaths);
        return true;
      }
    }

    await restoreWorkspaceSnapshot(root, checkpointDir);
    return true;
  }
}

async function copyWorkspaceSnapshot(root: string, checkpointDir: string): Promise<void> {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (CHECKPOINT_EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const from = path.join(root, entry.name);
    const to = path.join(checkpointDir, entry.name);
    fs.cpSync(from, to, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  }
}

async function restoreWorkspaceSnapshot(root: string, checkpointDir: string): Promise<void> {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (CHECKPOINT_EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
  for (const entry of fs.readdirSync(checkpointDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') {
      continue;
    }
    const from = path.join(checkpointDir, entry.name);
    const to = path.join(root, entry.name);
    fs.cpSync(from, to, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  }
}

async function copyTargetSnapshot(root: string, checkpointDir: string, fullPath: string, relativePath: string): Promise<void> {
  const normalized = relativePath.replace(/\\/g, '/');
  const metadata = {
    path: normalized,
    existed: fs.existsSync(fullPath)
  };
  fs.writeFileSync(path.join(checkpointDir, 'target.json'), JSON.stringify(metadata, null, 2), 'utf8');
  if (!metadata.existed) {
    return;
  }
  const snapshotPath = path.join(checkpointDir, 'files', normalized);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.cpSync(fullPath, snapshotPath, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
}

async function restoreTargetSnapshot(root: string, checkpointDir: string, protectedPaths: string[]): Promise<void> {
  const targetPath = path.join(checkpointDir, 'target.json');
  const target = fs.existsSync(targetPath)
    ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) as { path: string; existed: boolean }
    : { path: protectedPaths[0], existed: true };
  const workspacePath = path.resolve(root, target.path);
  if (!target.existed) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return;
  }
  const snapshotPath = path.join(checkpointDir, 'files', target.path);
  if (!fs.existsSync(snapshotPath)) {
    return;
  }
  fs.rmSync(workspacePath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  fs.cpSync(snapshotPath, workspacePath, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
}

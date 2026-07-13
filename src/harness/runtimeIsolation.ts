import { spawnSync } from 'child_process';
import { classifyCommandNetworkIntent, CommandNetworkIntent } from './commandNetwork';

export type CommandAuthority = 'read' | 'verify' | 'workspace-write' | 'network-read' | 'network-write' | 'unknown';
export type IsolationGrade = 'process' | 'node-permission' | 'os-sandbox' | 'strict-unavailable';
export type RuntimeBackend = 'node-permission' | 'bubblewrap' | 'docker' | 'podman' | 'none';

export interface RuntimeLimits {
  timeoutMs: number;
  memoryMb: number;
  outputBytes: number;
  processCount: number;
}

export interface CommandAuthorityAssessment {
  authority: CommandAuthority;
  executable: string;
  reason: string;
  network: CommandNetworkIntent;
  composed: boolean;
  redirected: boolean;
  inlineInterpreter: boolean;
}

export interface RuntimeBackendProbe {
  backend: RuntimeBackend;
  available: boolean;
  filesystemIsolated: boolean;
  networkIsolated: boolean;
  processLimited: boolean;
  reason: string;
  probedAt: string;
}

export interface RuntimeIsolationDecision {
  allowed: boolean;
  authority: CommandAuthority;
  grade: IsolationGrade;
  backend: RuntimeBackend;
  reason: string;
  guarantees: {
    filesystem: boolean;
    network: boolean;
    childProcess: boolean;
    resources: boolean;
  };
  limits: RuntimeLimits;
}

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = Object.freeze({
  timeoutMs: 30_000,
  memoryMb: 384,
  outputBytes: 2 * 1024 * 1024,
  processCount: 16
});

const READ_EXECUTABLES = new Set(['rg', 'grep', 'findstr', 'cat', 'type', 'ls', 'dir', 'pwd', 'where', 'which', 'get-content', 'get-childitem', 'select-string']);

export function classifyCommandAuthority(command: string): CommandAuthorityAssessment {
  const trimmed = String(command || '').trim();
  const network = classifyCommandNetworkIntent(trimmed);
  const executable = firstExecutable(trimmed);
  const composed = hasUnquoted(trimmed, /[;&|]/);
  const redirected = hasUnquoted(trimmed, /[<>]/);
  const inlineInterpreter = /\b(?:node|python(?:3)?|ruby|perl|php|powershell|pwsh)\b[^\r\n]*(?:\s-[ec]\b|\s-command\b|\s-encodedcommand\b)/i.test(trimmed);

  if (!trimmed) return assessment('unknown', executable, 'Command is empty.', network, composed, redirected, inlineInterpreter);
  if (network.risk === 'write' || network.risk === 'unknown') {
    return assessment('network-write', executable, network.reason, network, composed, redirected, inlineInterpreter);
  }
  if (network.risk === 'read') {
    return assessment('network-read', executable, network.reason, network, composed, redirected, inlineInterpreter);
  }
  if (composed || redirected || inlineInterpreter || /[`$]\(/.test(trimmed)) {
    return assessment('unknown', executable, 'Shell composition, redirection, command substitution, or inline interpreter code requires strict isolation.', network, composed, redirected, inlineInterpreter);
  }

  const normalized = trimmed.toLowerCase().replace(/\.exe\b/g, '');
  if (READ_EXECUTABLES.has(executable)) {
    return assessment('read', executable, `Host allowlist classifies ${executable} as read-only.`, network, composed, redirected, inlineInterpreter);
  }
  if (/^git\s+(?:status|diff|log|show|rev-parse|ls-files|grep|blame)\b/.test(normalized)) {
    return assessment('read', executable, 'Host allowlist classifies this Git subcommand as read-only.', network, composed, redirected, inlineInterpreter);
  }
  if (/^(?:node|npm|npx|pnpm|yarn|python|python3|pytest|cargo|go|dotnet)\s+(?:--?version|-v)\b/.test(normalized)) {
    return assessment('read', executable, 'Version inspection is read-only.', network, composed, redirected, inlineInterpreter);
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|lint|typecheck|check|build|compile))\b/.test(normalized)
    || /^(?:npx\s+)?(?:tsc|eslint|vitest|jest)\b/.test(normalized)
    || /^(?:python|python3)\s+-m\s+(?:pytest|unittest)\b/.test(normalized)
    || /^(?:pytest|cargo\s+(?:test|check)|go\s+test|dotnet\s+(?:test|build))\b/.test(normalized)) {
    return assessment('verify', executable, 'Host verification allowlist recognizes this project oracle command.', network, composed, redirected, inlineInterpreter);
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:install|add|update|remove|uninstall)\b/.test(normalized)
    || /^(?:npx|npm\s+exec)\b/.test(normalized)
    || /^(?:prettier|eslint)\b[^\r\n]*\s--write\b/.test(normalized)) {
    return assessment('workspace-write', executable, 'Host policy recognizes a workspace-writing command.', network, composed, redirected, inlineInterpreter);
  }
  return assessment('unknown', executable, 'Executable or subcommand is not in a host-owned authority rule.', network, composed, redirected, inlineInterpreter);
}

export function decideRuntimeIsolation(
  command: string,
  probes: RuntimeBackendProbe[] = probeRuntimeBackends(),
  limits: RuntimeLimits = DEFAULT_RUNTIME_LIMITS
): RuntimeIsolationDecision {
  const authority = classifyCommandAuthority(command);
  if (authority.authority === 'network-write') {
    return decision(false, authority.authority, 'strict-unavailable', 'none', authority.reason, false, false, false, true, limits);
  }
  const strict = probes.find(item => item.available && item.filesystemIsolated && item.networkIsolated && item.processLimited);
  if (authority.authority === 'network-read' || authority.authority === 'unknown') {
    if (!strict) {
      return decision(false, authority.authority, 'strict-unavailable', 'none', `Strict OS/socket isolation is unavailable: ${probes.map(item => `${item.backend}=${item.reason}`).join('; ') || 'no backend probed'}`, false, false, false, true, limits);
    }
    return decision(true, authority.authority, 'os-sandbox', strict.backend, strict.reason, true, true, true, true, limits);
  }
  return decision(true, authority.authority, 'process', 'none', 'Local command may execute in the transactional workspace with process/resource ceilings; no socket containment is claimed.', false, false, true, true, limits);
}

export function probeRuntimeBackends(platform = process.platform): RuntimeBackendProbe[] {
  const probedAt = new Date().toISOString();
  const probes: RuntimeBackendProbe[] = [{
    backend: 'node-permission', available: supportsNodePermission(), filesystemIsolated: true,
    networkIsolated: false, processLimited: true,
    reason: supportsNodePermission() ? 'Node permission flags are available; they do not isolate sockets.' : 'Node permission flags are unavailable.', probedAt
  }];
  if (platform === 'linux') probes.push(probeBubblewrap(probedAt));
  probes.push(probeContainer('docker', probedAt), probeContainer('podman', probedAt));
  return probes;
}

export function supportsNodePermission(): boolean {
  const major = Number(process.versions.node.split('.')[0]);
  return Number.isFinite(major) && major >= 20;
}

function probeBubblewrap(probedAt: string): RuntimeBackendProbe {
  const probe = spawnSync('bwrap', ['--unshare-all', '--unshare-net', '--die-with-parent', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', 'true'], { timeout: 2500, stdio: 'ignore' });
  const available = probe.status === 0;
  const failureCode = (probe.error as NodeJS.ErrnoException | undefined)?.code || (probe.status ?? 'unavailable');
  return { backend: 'bubblewrap', available, filesystemIsolated: available, networkIsolated: available, processLimited: available, reason: available ? 'Bubblewrap unshare probe passed.' : `Bubblewrap probe failed (${failureCode}).`, probedAt };
}

function probeContainer(backend: 'docker' | 'podman', probedAt: string): RuntimeBackendProbe {
  const image = String(process.env.FORGE_SANDBOX_IMAGE || '').trim();
  if (!image) return { backend, available: false, filesystemIsolated: false, networkIsolated: false, processLimited: false, reason: 'FORGE_SANDBOX_IMAGE is not configured; no image was pulled automatically.', probedAt };
  const inspect = spawnSync(backend, ['image', 'inspect', image], { timeout: 2500, stdio: 'ignore' });
  const available = inspect.status === 0;
  return { backend, available, filesystemIsolated: available, networkIsolated: available, processLimited: available, reason: available ? `${backend} image inspection passed for the preinstalled sandbox image.` : `${backend} or configured image is unavailable.`, probedAt };
}

function firstExecutable(command: string): string {
  const match = command.trim().match(/^(?:&\s*)?["']?([^\s"']+)/);
  return String(match?.[1] || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
}

function hasUnquoted(command: string, pattern: RegExp): boolean {
  let quote = '';
  for (const char of command) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) { quote = quote ? '' : char; continue; }
    if (!quote && pattern.test(char)) return true;
  }
  return false;
}

function assessment(authority: CommandAuthority, executable: string, reason: string, network: CommandNetworkIntent, composed: boolean, redirected: boolean, inlineInterpreter: boolean): CommandAuthorityAssessment {
  return { authority, executable, reason, network, composed, redirected, inlineInterpreter };
}

function decision(allowed: boolean, authority: CommandAuthority, grade: IsolationGrade, backend: RuntimeBackend, reason: string, filesystem: boolean, network: boolean, childProcess: boolean, resources: boolean, limits: RuntimeLimits): RuntimeIsolationDecision {
  return { allowed, authority, grade, backend, reason, guarantees: { filesystem, network, childProcess, resources }, limits: { ...limits } };
}

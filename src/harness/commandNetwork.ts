export type NetworkRisk = 'none' | 'read' | 'write' | 'unknown';
export type NetworkDecision = 'allowed' | 'blocked';

export interface CommandNetworkIntent {
  detected: boolean;
  risk: NetworkRisk;
  decision: NetworkDecision;
  operations: string[];
  endpoints: string[];
  reason: string;
}

const URL_PATTERN = /\b(?:https?|ssh|git):\/\/[^\s"'`]+/gi;
const SSH_REMOTE_PATTERN = /\b(?:[\w.-]+@)?[\w.-]+:[\w./~-]+\b/g;

/**
 * Classifies explicit network-capable shell commands without executing them.
 * This is command-intent governance, not socket-level process containment.
 */
export function classifyCommandNetworkIntent(command: string): CommandNetworkIntent {
  const normalized = command.trim().toLowerCase();
  const operations = new Set<string>();
  const endpoints = extractEndpoints(command);
  let risk: NetworkRisk = 'none';

  const mark = (operation: string, nextRisk: NetworkRisk) => {
    operations.add(operation);
    if (risk === 'write' || nextRisk === 'none') return;
    if (nextRisk === 'write' || (nextRisk === 'unknown' && risk !== 'read') || risk === 'none') {
      risk = nextRisk;
    }
  };

  if (/\bgit\s+(?:clone|fetch|pull|ls-remote)\b/.test(normalized)) mark('git-read', 'read');
  if (/\bgit\s+(?:push|send-email)\b/.test(normalized)) mark('git-write', 'write');
  if (/\b(?:npm|pnpm|yarn)\s+(?:install|add|update|view|info|audit)\b/.test(normalized)) mark('package-registry-read', 'read');
  if (/\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish|deprecate|dist-tag|owner|access)\b/.test(normalized)) mark('package-registry-write', 'write');
  if (/\b(?:pip|pip3|poetry)\s+(?:install|download|update)\b/.test(normalized)) mark('python-registry-read', 'read');
  if (/\bdocker\s+(?:pull|search|login)\b/.test(normalized)) mark('container-registry-read', 'read');
  if (/\bdocker\s+(?:push|logout)\b/.test(normalized)) mark('container-registry-write', 'write');
  if (/\b(?:scp|sftp|rsync)\b/.test(normalized)) mark('remote-file-transfer', 'write');
  if (/\bssh\b/.test(normalized)) mark('remote-shell', 'unknown');
  if (/\b(?:terraform|tofu)\s+(?:apply|destroy|import)\b/.test(normalized)) mark('remote-infrastructure-write', 'write');
  if (/\bkubectl\s+(?:apply|create|delete|edit|patch|replace|scale|set)\b/.test(normalized)) mark('cluster-write', 'write');
  if (/\bgh\s+(?:repo\s+(?:create|delete|fork)|release\s+(?:create|delete|upload)|pr\s+(?:create|merge|close|comment))\b/.test(normalized)) mark('github-write', 'write');

  const isCurl = /(?:^|[;&|\s])curl(?:\.exe)?(?:\s|$)/.test(normalized);
  const isPowerShellWeb = /\b(?:invoke-webrequest|invoke-restmethod|iwr|irm)\b/.test(normalized);
  const isWget = /(?:^|[;&|\s])wget(?:\.exe)?(?:\s|$)/.test(normalized);
  if (isCurl || isPowerShellWeb || isWget) {
    const explicitWrite = /(?:\s|^)(?:-x|--request|-method)\s*["']?(?:post|put|patch|delete)\b/i.test(command)
      || /(?:\s|^)(?:-d|--data(?:-ascii|-binary|-raw|-urlencode)?|-f|--form|-t|--upload-file|--body)\b/i.test(command);
    mark(isPowerShellWeb ? 'powershell-web-request' : isCurl ? 'curl-request' : 'wget-request', explicitWrite ? 'write' : 'read');
  }

  const detected = operations.size > 0;
  const finalRisk = risk as NetworkRisk;
  const decision: NetworkDecision = finalRisk === 'write' || finalRisk === 'unknown' ? 'blocked' : 'allowed';
  const reason = !detected
    ? 'No explicit network-capable command was detected.'
    : decision === 'blocked'
      ? `Blocked outbound ${finalRisk} intent before execution: ${Array.from(operations).join(', ')}.`
      : `Allowed read-only network intent with audit capture: ${Array.from(operations).join(', ')}.`;

  return { detected, risk: finalRisk, decision, operations: Array.from(operations), endpoints, reason };
}

function extractEndpoints(command: string): string[] {
  const found = new Set<string>();
  for (const match of command.match(URL_PATTERN) || []) {
    found.add(match.replace(/[),.;]+$/, ''));
  }
  if (/\b(?:git|ssh|scp|sftp|rsync)\b/i.test(command)) {
    for (const match of command.match(SSH_REMOTE_PATTERN) || []) {
      if (!/^[a-z]:/i.test(match)) found.add(match.replace(/[),.;]+$/, ''));
    }
  }
  return Array.from(found).slice(0, 12);
}

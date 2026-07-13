import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface SupportEnvironment {
  extensionVersion: string;
  ideName: string;
  ideVersion: string;
  platform: string;
  architecture: string;
}

export interface SupportReport {
  schemaVersion: 1;
  reportId: string;
  generatedAt: string;
  environment: SupportEnvironment;
  workspace: { open: boolean; name?: string; forgeStatePresent: boolean };
  provider: { ready: boolean; authenticationStatus: string; catalogStatus: string; modelCount: number; blockerCodes: string[] };
  run?: {
    status: string;
    phase: string;
    step: number;
    maxSteps: number;
    modeId?: string;
    oracleStatuses: Record<string, string>;
    counters: Record<string, number>;
  };
  privacy: { sourceIncluded: false; promptsIncluded: false; chatIncluded: false; credentialsIncluded: false; fullPathsIncluded: false };
}

export interface SupportReportPaths {
  jsonPath: string;
  markdownPath: string;
  report: SupportReport;
}

const COUNTER_KEYS = [
  'providerCalls', 'providerFailures', 'modelDrivenProposals', 'fallbackActions',
  'validationFailures', 'toolFailures', 'reflectionAttempts', 'clarificationRequests',
  'oracleFailureCaptures', 'oracleFailureResolutions', 'oracleStagnationHalts',
  'reviewerApprovals', 'reviewerCritiques', 'checkpointRestores',
  'checkpointRestoreFailures', 'browserValidations', 'browserValidationFailures'
] as const;

export function writeSupportReport(
  workspaceRoot: string | undefined,
  environment: SupportEnvironment,
  readiness: any,
  state?: any,
  fallbackRoot?: string
): SupportReportPaths {
  const generatedAt = new Date().toISOString();
  const report: SupportReport = {
    schemaVersion: 1,
    reportId: `forge-support-${generatedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
    generatedAt,
    environment,
    workspace: {
      open: Boolean(workspaceRoot),
      ...(workspaceRoot ? { name: path.basename(path.resolve(workspaceRoot)) } : {}),
      forgeStatePresent: Boolean(workspaceRoot && fs.existsSync(path.join(workspaceRoot, '.forge', 'state.json')))
    },
    provider: {
      ready: readiness?.ready === true,
      authenticationStatus: safeEnum(readiness?.authentication?.status),
      catalogStatus: safeEnum(readiness?.catalog?.status),
      modelCount: finiteNumber(readiness?.catalog?.modelCount),
      blockerCodes: Array.isArray(readiness?.blockers) ? readiness.blockers.map((item: any) => safeEnum(item?.code)).filter(Boolean).slice(0, 20) : []
    },
    ...(state ? { run: summarizeRun(state) } : {}),
    privacy: { sourceIncluded: false, promptsIncluded: false, chatIncluded: false, credentialsIncluded: false, fullPathsIncluded: false }
  };

  const baseRoot = workspaceRoot || fallbackRoot || path.join(process.cwd(), '.forge-support');
  const supportDir = path.join(baseRoot, '.forge', 'support');
  fs.mkdirSync(supportDir, { recursive: true });
  const jsonPath = path.join(supportDir, 'latest-support-report.json');
  const markdownPath = path.join(supportDir, 'latest-support-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, renderSupportMarkdown(report), 'utf8');
  return { jsonPath, markdownPath, report };
}

export function renderSupportMarkdown(report: SupportReport): string {
  const run = report.run;
  return [
    '# Forge Agent Support Report',
    '',
    '> Add a short description and reproduction steps above this report before submitting it.',
    '',
    `- Report ID: \`${report.reportId}\``,
    `- Generated: \`${report.generatedAt}\``,
    `- Forge Agent: \`${report.environment.extensionVersion}\``,
    `- IDE: \`${report.environment.ideName} ${report.environment.ideVersion}\``,
    `- Runtime: \`${report.environment.platform}/${report.environment.architecture}\``,
    `- Workspace: \`${report.workspace.open ? report.workspace.name || 'open' : 'not open'}\``,
    `- Provider: \`${report.provider.ready ? 'ready' : 'not ready'}\` (auth=${report.provider.authenticationStatus}, catalog=${report.provider.catalogStatus}, models=${report.provider.modelCount})`,
    `- Provider blockers: \`${report.provider.blockerCodes.join(', ') || 'none'}\``,
    ...(run ? [
      `- Run: \`${run.status}\` phase=\`${run.phase}\` step=\`${run.step}/${run.maxSteps}\` mode=\`${run.modeId || 'none'}\``,
      `- Oracles: \`${Object.entries(run.oracleStatuses).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}\``,
      `- Counters: \`${Object.entries(run.counters).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}\``
    ] : ['- Run: `not initialized`']),
    '',
    '## Privacy',
    '',
    'This report intentionally excludes source code, prompts, chat messages, credentials, command output, goal text, and full filesystem paths.',
    ''
  ].join('\n');
}

function summarizeRun(state: any): SupportReport['run'] {
  const counters: Record<string, number> = {};
  for (const key of COUNTER_KEYS) {
    const value = finiteNumber(state?.runStats?.[key]);
    if (value) counters[key] = value;
  }
  const oracleStatuses: Record<string, string> = {};
  for (const [key, value] of Object.entries(state?.oracleStatuses || {})) oracleStatuses[safeEnum(key)] = safeEnum(value);
  return {
    status: safeEnum(state?.status),
    phase: safeEnum(state?.firewall?.stage),
    step: finiteNumber(state?.currentStepIndex),
    maxSteps: finiteNumber(state?.maxSteps),
    modeId: state?.modePolicy?.id ? safeEnum(state.modePolicy.id) : undefined,
    oracleStatuses,
    counters
  };
}

function safeEnum(value: unknown): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

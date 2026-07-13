import { WorkspaceIndexService } from './workspaceIndex';

function main(): void {
  const root = String(process.argv[2] || '');
  if (!root) throw new Error('Workspace index worker requires a workspace root.');
  const report = new WorkspaceIndexService(root).build();
  process.stdout.write(JSON.stringify({
    generatedAt: report.generatedAt,
    fileCount: report.fileCount,
    symbolCount: report.symbolCount,
    ignoredCount: report.ignoredCount,
    truncated: report.truncated,
    fingerprint: report.fingerprint
  }));
}

try {
  main();
} catch (error: any) {
  process.stderr.write(String(error?.message || error));
  process.exitCode = 1;
}

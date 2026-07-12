import * as fs from 'fs';
import { exec } from 'child_process';
import { AdapterOracleCommand, detectProjectAdapter, OracleKind, ProjectAdapter } from './projectAdapters';

export interface OracleResult {
  kind: OracleKind;
  pass: boolean;
  required: boolean;
  skipped: boolean;
  command?: string;
  source: string;
  output: string;
}

export interface CompositeOracleResult {
  pass: boolean;
  results: Record<OracleKind, OracleResult>;
  summary: string;
}

export class VerificationOracles {
  private readonly root: string;
  private adapter: ProjectAdapter;

  constructor(private readonly workspaceRootOverride?: string) {
    this.root = this.getWorkspaceRoot();
    this.adapter = detectProjectAdapter(this.root);
  }

  public getProjectAdapter(): ProjectAdapter { return this.adapter; }
  public refreshProjectAdapter(): ProjectAdapter {
    this.adapter = detectProjectAdapter(this.root);
    return this.adapter;
  }

  public runTest(): Promise<OracleResult> { return this.run('test'); }
  public runLint(): Promise<OracleResult> { return this.run('lint'); }
  public runTypecheck(): Promise<OracleResult> { return this.run('typecheck'); }
  public runBuild(): Promise<OracleResult> { return this.run('build'); }

  public async runAll(): Promise<CompositeOracleResult> {
    this.refreshProjectAdapter();
    const lint = await this.runLint();
    const typecheck = await this.runTypecheck();
    const build = await this.runBuild();
    const test = await this.runTest();
    const results = { test, lint, typecheck, build };
    const pass = Object.values(results).every(result => !result.required || result.pass);
    const summary = (Object.keys(results) as OracleKind[]).map(kind => {
      const result = results[kind];
      return `${kind}=${result.skipped ? 'skipped' : result.pass ? 'pass' : 'fail'}${result.command ? ` (${result.command})` : ''}`;
    }).join('; ');
    return { pass, results, summary };
  }

  private getWorkspaceRoot(): string {
    if (this.workspaceRootOverride) return fs.realpathSync(this.workspaceRootOverride);
    const vscode = getVscode();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('No active workspace folder.');
    return folders[0].uri.fsPath;
  }

  private async run(kind: OracleKind): Promise<OracleResult> {
    const contract = this.adapter.commands[kind];
    if (!contract.command) {
      return contract.required
        ? result(contract, false, false, `Required ${kind} oracle is not configured for ${this.adapter.ecosystem}.`)
        : result(contract, true, true, `No ${kind} oracle detected; skipped by adapter contract.`);
    }
    return this.execCommand(contract, this.root);
  }

  private execCommand(contract: AdapterOracleCommand, cwd: string): Promise<OracleResult> {
    return new Promise(resolve => {
      exec(String(contract.command), { cwd, timeout: 120_000 }, (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        resolve(result(contract, !error, false, output || (error ? `${contract.kind} command failed.` : `${contract.kind} command passed.`)));
      });
    });
  }
}

function result(contract: AdapterOracleCommand, pass: boolean, skipped: boolean, output: string): OracleResult {
  return { kind: contract.kind, pass, required: contract.required, skipped, command: contract.command, source: contract.source, output };
}

function getVscode(): typeof import('vscode') {
  try { return require('vscode'); } catch { throw new Error('No active workspace folder.'); }
}

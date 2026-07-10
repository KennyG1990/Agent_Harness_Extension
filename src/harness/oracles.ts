import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface OracleResult {
  pass: boolean;
  output: string;
}

export class VerificationOracles {
  constructor(private readonly workspaceRootOverride?: string) {}

  private getWorkspaceRoot(): string {
    if (this.workspaceRootOverride) {
      return fs.realpathSync(this.workspaceRootOverride);
    }
    const vscode = getVscode();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error("No active workspace folder.");
    }
    return folders[0].uri.fsPath;
  }

  public async runTest(): Promise<OracleResult> {
    const root = this.getWorkspaceRoot();
    let testCommand = '';

    if (fs.existsSync(path.join(root, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts.test) {
          testCommand = 'npm run test';
        }
      } catch (e) {}
    } else if (fs.existsSync(path.join(root, 'cargo.toml'))) {
      testCommand = 'cargo test';
    } else if (fs.existsSync(path.join(root, 'go.mod'))) {
      testCommand = 'go test ./...';
    } else if (fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'setup.py'))) {
      testCommand = 'pytest';
    }

    if (!testCommand) {
      return { pass: false, output: "No automated test suite detected. Generate or configure tests before success can be declared." };
    }

    return this.execCommand(testCommand, root);
  }

  public async runTypecheck(): Promise<OracleResult> {
    const root = this.getWorkspaceRoot();
    let command = '';

    if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
      command = 'npx tsc --noEmit';
    } else if (fs.existsSync(path.join(root, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts.typecheck) {
          command = 'npm run typecheck';
        } else if (pkg.scripts && pkg.scripts.build) {
          command = 'npm run build';
        }
      } catch (e) {}
    }

    if (!command) {
      return { pass: true, output: "No typecheck/compilation step detected. Skipping this oracle." };
    }

    return this.execCommand(command, root);
  }

  public async runLint(): Promise<OracleResult> {
    const root = this.getWorkspaceRoot();
    let command = '';

    if (fs.existsSync(path.join(root, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts.lint) {
          command = 'npm run lint';
        }
      } catch (e) {}
    }

    if (!command && (fs.existsSync(path.join(root, '.eslintrc')) || fs.existsSync(path.join(root, '.eslintrc.json')) || fs.existsSync(path.join(root, 'eslint.config.js')))) {
      command = 'npx eslint src';
    }

    if (!command) {
      return { pass: true, output: "No linter detected. Skipping this oracle." };
    }

    return this.execCommand(command, root);
  }

  private execCommand(command: string, cwd: string): Promise<OracleResult> {
    return new Promise((resolve) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
          resolve({ pass: false, output });
        } else {
          resolve({ pass: true, output });
        }
      });
    });
  }
}

function getVscode(): typeof import('vscode') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode');
  } catch {
    throw new Error('No active workspace folder.');
  }
}

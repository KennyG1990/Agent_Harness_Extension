import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type ProjectEcosystem = 'node' | 'python' | 'rust' | 'go' | 'unknown';
export type OracleKind = 'test' | 'lint' | 'typecheck' | 'build';

export interface AdapterOracleCommand {
  kind: OracleKind;
  command?: string;
  required: boolean;
  source: string;
}

export interface ProjectAdapter {
  version: 1;
  id: string;
  ecosystem: ProjectEcosystem;
  manifest?: string;
  packageManager?: string;
  detectedAt: string;
  fingerprint: string;
  evidence: string[];
  commands: Record<OracleKind, AdapterOracleCommand>;
}

export function detectProjectAdapter(workspaceRoot: string): ProjectAdapter {
  const root = fs.realpathSync(workspaceRoot);
  if (exists(root, 'package.json')) return nodeAdapter(root);
  if (exists(root, 'pyproject.toml') || exists(root, 'requirements.txt') || exists(root, 'setup.py')) return pythonAdapter(root);
  if (exists(root, 'Cargo.toml')) return staticAdapter(root, 'rust', 'cargo', 'Cargo.toml', {
    test: command('test', 'cargo test', true, 'Cargo.toml'),
    lint: command('lint', 'cargo clippy --all-targets --all-features -- -D warnings', true, 'Cargo.toml'),
    typecheck: command('typecheck', 'cargo check', true, 'Cargo.toml'),
    build: command('build', 'cargo build', true, 'Cargo.toml')
  });
  if (exists(root, 'go.mod')) return staticAdapter(root, 'go', 'go', 'go.mod', {
    test: command('test', 'go test ./...', true, 'go.mod'),
    lint: command('lint', 'go vet ./...', true, 'go.mod'),
    typecheck: command('typecheck', 'go test ./... -run=^$', true, 'go.mod'),
    build: command('build', 'go build ./...', true, 'go.mod')
  });
  return makeAdapter(root, 'unknown', undefined, undefined, ['No supported root manifest detected.'], {
    test: command('test', undefined, true, 'missing test contract'),
    lint: command('lint', undefined, false, 'not detected'),
    typecheck: command('typecheck', undefined, false, 'not detected'),
    build: command('build', undefined, false, 'not detected')
  });
}

function nodeAdapter(root: string): ProjectAdapter {
  let pkg: any = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* invalid package remains evidence */ }
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const packageManager = exists(root, 'pnpm-lock.yaml') ? 'pnpm' : exists(root, 'yarn.lock') ? 'yarn' : 'npm';
  const run = (name: string): string => packageManager === 'yarn' ? `yarn ${name}` : `${packageManager} run ${name}`;
  const has = (name: string): boolean => typeof scripts[name] === 'string' && scripts[name].trim().length > 0;
  const typecheck = has('typecheck') ? run('typecheck') : exists(root, 'tsconfig.json') ? 'npx tsc --noEmit' : undefined;
  return makeAdapter(root, 'node', packageManager, 'package.json', [`package.json detected.`, `Package manager selected from lockfiles: ${packageManager}.`, `Scripts: ${Object.keys(scripts).sort().join(', ') || 'none'}.`], {
    test: command('test', has('test') ? run('test') : undefined, true, has('test') ? 'package.json#scripts.test' : 'missing scripts.test'),
    lint: command('lint', has('lint') ? run('lint') : undefined, has('lint'), has('lint') ? 'package.json#scripts.lint' : 'not detected'),
    typecheck: command('typecheck', typecheck, Boolean(typecheck), has('typecheck') ? 'package.json#scripts.typecheck' : typecheck ? 'tsconfig.json' : 'not detected'),
    build: command('build', has('build') ? run('build') : undefined, has('build'), has('build') ? 'package.json#scripts.build' : 'not detected')
  });
}

function pythonAdapter(root: string): ProjectAdapter {
  const manifest = exists(root, 'pyproject.toml') ? 'pyproject.toml' : exists(root, 'setup.py') ? 'setup.py' : 'requirements.txt';
  const hasRuff = fileContains(root, 'pyproject.toml', /\[tool\.ruff|ruff/i) || fileContains(root, 'requirements.txt', /^ruff(?:[=<>]|$)/im);
  const hasMypy = fileContains(root, 'pyproject.toml', /\[tool\.mypy/i) || fileContains(root, 'requirements.txt', /^mypy(?:[=<>]|$)/im);
  return makeAdapter(root, 'python', 'python', manifest, [`${manifest} detected.`, `ruff=${hasRuff}; mypy=${hasMypy}.`], {
    test: command('test', 'python -m pytest', true, `${manifest} Python test convention`),
    lint: command('lint', hasRuff ? 'python -m ruff check .' : undefined, hasRuff, hasRuff ? 'ruff configuration/dependency' : 'not detected'),
    typecheck: command('typecheck', hasMypy ? 'python -m mypy .' : undefined, hasMypy, hasMypy ? 'mypy configuration/dependency' : 'not detected'),
    build: command('build', undefined, false, 'No deterministic build command inferred without an explicit project script.')
  });
}

function staticAdapter(root: string, ecosystem: ProjectEcosystem, packageManager: string, manifest: string, commands: Record<OracleKind, AdapterOracleCommand>): ProjectAdapter {
  return makeAdapter(root, ecosystem, packageManager, manifest, [`${manifest} detected.`], commands);
}

function makeAdapter(root: string, ecosystem: ProjectEcosystem, packageManager: string | undefined, manifest: string | undefined, evidence: string[], commands: Record<OracleKind, AdapterOracleCommand>): ProjectAdapter {
  const signature = JSON.stringify({ ecosystem, packageManager, manifest, evidence, commands });
  return { version: 1, id: `${ecosystem}-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 12)}`, ecosystem, packageManager, manifest, detectedAt: new Date().toISOString(), fingerprint: crypto.createHash('sha256').update(signature).digest('hex'), evidence, commands };
}

function command(kind: OracleKind, value: string | undefined, required: boolean, source: string): AdapterOracleCommand {
  return { kind, command: value, required, source };
}

function exists(root: string, file: string): boolean { return fs.existsSync(path.join(root, file)); }
function fileContains(root: string, file: string, pattern: RegExp): boolean {
  try { return pattern.test(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return false; }
}

import fs from 'node:fs';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

const root = process.cwd();
const fixture = path.join(root, '.tmp', 'forge-e2e-fixture');
fs.rmSync(fixture, { recursive: true, force: true });
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
  scripts: { test: 'node test-pass.js' }
}, null, 2));
fs.writeFileSync(path.join(fixture, 'test-pass.js'), 'console.log("fixture tests pass");\n');

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'out', 'test', 'suite'),
  launchArgs: [fixture, '--disable-extensions']
});

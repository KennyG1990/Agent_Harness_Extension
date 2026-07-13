import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assets = [
  [path.join(root, 'node_modules', 'playwright-core', 'browsers.json'), path.join(root, 'browsers.json')]
];

for (const [source, target] of assets) {
  if (!fs.existsSync(source)) throw new Error(`Required runtime asset is missing: ${source}`);
  fs.copyFileSync(source, target);
}

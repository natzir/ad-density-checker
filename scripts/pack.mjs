// Packs the extension for the Chrome Web Store: dist/ad-density-checker-<version>.zip with only the
// files the extension loads (no tests, docs or scripts).
// Usage: npm run pack
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function packFiles() {
  const inDir = (dir, ext) => readdirSync(new URL(dir, `file://${root}`)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);
  return [
    'manifest.json',
    'LICENSE',
    'background.js',
    'sidepanel.html',
    'sidepanel.css',
    'sidepanel.js',
    'tokens.css',
    'welcome.html',
    'welcome.css',
    ...inDir('lib', '.js'),
    'lib/adlists-LICENSE.txt',
    ...inDir('icons', '.png'),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'));
  const zip = `dist/ad-density-checker-${version}.zip`;
  mkdirSync(`${root}dist`, { recursive: true });
  rmSync(`${root}${zip}`, { force: true });
  execFileSync('zip', ['-X', '-q', zip, ...packFiles()], { cwd: root, stdio: 'inherit' });
  console.log(`${zip}: ${packFiles().length} files`);
}

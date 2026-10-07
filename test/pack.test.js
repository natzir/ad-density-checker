import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packFiles } from '../scripts/pack.mjs';
import { WELCOME_PAGE } from '../lib/welcome.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const files = packFiles();

// Every module reachable from `entries` through static imports (the entries included).
function staticImports(entries) {
  const reached = new Set(entries);
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    for (const [, spec] of read(file).matchAll(/from '(\.[^']+)'/g)) {
      const target = new URL(spec, new URL(file, root)).pathname.slice(root.pathname.length);
      if (!reached.has(target)) queue.push(target);
      reached.add(target);
    }
  }
  return reached;
}

test('the package holds every file the extension loads', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const needed = new Set([
    'manifest.json',
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ]);
  // What the panel and the welcome page link, the stylesheets they link load, and what the panel fetches.
  for (const page of [manifest.side_panel.default_path, WELCOME_PAGE]) {
    needed.add(page);
    for (const [, href] of read(page).matchAll(/(?:href|src)="([^":#][^":]*)"/g)) { // files, not URLs or #fragments
      needed.add(href);
      if (href.endsWith('.css')) for (const [, path] of read(href).matchAll(/url\(([^)]+)\)/g)) needed.add(path);
    }
  }
  for (const [, path] of read('sidepanel.js').matchAll(/fetch\('([^']+)'\)/g)) needed.add(path);
  // Every module the scripts import, followed through lib/.
  for (const file of staticImports([...needed].filter((f) => f.endsWith('.js')))) needed.add(file);
  for (const file of needed) assert.ok(files.includes(file), `${file} is missing from the package`);
});

test('the package leaves out what only the repo needs', () => {
  assert.deepEqual(files.filter((f) => /^(test|docs|scripts|store|dist)\/|^(package\.json|README\.md|PRIVACY\.md|\.gitignore)$/.test(f)), []);
});

test('the package ships the extension\'s MIT licence', () => {
  assert.ok(files.includes('LICENSE'));
});

test('the package ships the lists\' licence', () => {
  assert.ok(files.includes('lib/adlists.js'));
  assert.ok(files.includes('lib/adlists-LICENSE.txt'));
});

test('extension code never uses import(), which Chrome forbids in its service worker', () => {
  for (const file of files.filter((f) => f.endsWith('.js') && f !== 'lib/adlists.js')) {
    assert.doesNotMatch(read(file), /\bimport\s*\(/, `${file} uses import()`);
  }
});

test('the side panel doesn\'t load the bundled lists', () => {
  assert.ok(!staticImports(['sidepanel.js']).has('lib/adlists.js'));
});

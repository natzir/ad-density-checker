import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openWelcome, WELCOME_PAGE } from '../lib/welcome.js';

function fakeTabs() {
  const created = [];
  return { created, async create(props) { created.push(props); } };
}

test('opens the welcome page in a new tab when the extension is first installed', async () => {
  const tabs = fakeTabs();
  await openWelcome({ reason: 'install' }, tabs);
  assert.deepEqual(tabs.created, [{ url: WELCOME_PAGE }]);
});

test('doesn\'t open it again when the extension, Chrome or a shared module updates', async () => {
  const tabs = fakeTabs();
  for (const reason of ['update', 'chrome_update', 'shared_module_update']) await openWelcome({ reason }, tabs);
  assert.deepEqual(tabs.created, []);
});

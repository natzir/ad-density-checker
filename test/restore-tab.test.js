import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearRunning, markRunning, restoreInterrupted, restoreTab } from '../lib/restore-tab.js';

function fakeTabs(currentUrl, { closed = [] } = {}) {
  const calls = [];
  return {
    calls,
    async get(tabId) {
      if (closed.includes(tabId)) throw new Error(`No tab with id: ${tabId}.`);
      return { id: tabId, url: currentUrl };
    },
    async reload(tabId) { calls.push(['reload', tabId]); },
    async update(tabId, props) { calls.push(['update', tabId, props]); },
  };
}

test('reloads the tab when it is still on the tested URL', async () => {
  const tabs = fakeTabs('https://news.example/');
  await restoreTab(tabs, 3, 'https://news.example/');
  assert.deepEqual(tabs.calls, [['reload', 3]]);
});

test('a fragment-only change still counts as the same page', async () => {
  const tabs = fakeTabs('https://news.example/#top');
  await restoreTab(tabs, 3, 'https://news.example/');
  assert.deepEqual(tabs.calls, [['reload', 3]]);
});

test('goes back to the tested URL when the page rewrote its URL during the test', async () => {
  const tabs = fakeTabs('https://news.example/sports.html');
  await restoreTab(tabs, 3, 'https://news.example/');
  assert.deepEqual(tabs.calls, [['update', 3, { url: 'https://news.example/' }]]);
});

// chrome.storage.local: get(null) returns everything.
function fakeStorage(items = {}) {
  const data = { ...items };
  return {
    data,
    async get(keys) { return keys === null ? { ...data } : Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const k of [keys].flat()) delete data[k]; },
  };
}

test('a test cut short by an earlier worker (extension reloaded) gets its tab put back', async () => {
  const storage = fakeStorage({ device: 'mobile' });
  await markRunning(storage, 3, 'https://news.example/', 'worker-1');
  const tabs = fakeTabs('https://news.example/');
  await restoreInterrupted(storage, tabs, 'worker-2');
  assert.deepEqual(tabs.calls, [['reload', 3]]);
  assert.deepEqual(storage.data, { device: 'mobile' });
});

test('a test cut short by an earlier worker gets its debugger session closed first, if it is still open', async () => {
  const storage = fakeStorage();
  await markRunning(storage, 3, 'https://news.example/', 'worker-1');
  await markRunning(storage, 4, 'https://news.example/', 'worker-1');
  const tabs = fakeTabs('https://news.example/');
  const detach = async (tabId) => {
    tabs.calls.push(['detach', tabId]);
    if (tabId === 4) throw new Error('Debugger is not attached to the tab with id: 4.');
  };
  await restoreInterrupted(storage, tabs, 'worker-2', detach);
  assert.deepEqual(tabs.calls, [['detach', 3], ['reload', 3], ['detach', 4], ['reload', 4]]);
});

test('a test running in this worker is left alone', async () => {
  const storage = fakeStorage();
  await markRunning(storage, 3, 'https://news.example/', 'worker-2');
  const tabs = fakeTabs('https://news.example/');
  await restoreInterrupted(storage, tabs, 'worker-2');
  assert.deepEqual(tabs.calls, []);
  assert.equal(Object.keys(storage.data).length, 1);
});

test('a test that ended leaves nothing to restore', async () => {
  const storage = fakeStorage();
  await markRunning(storage, 3, 'https://news.example/', 'worker-1');
  await clearRunning(storage, 3);
  const tabs = fakeTabs('https://news.example/');
  await restoreInterrupted(storage, tabs, 'worker-2');
  assert.deepEqual(tabs.calls, []);
});

test('an interrupted test whose tab was closed is dropped and the others restored', async () => {
  const storage = fakeStorage();
  await markRunning(storage, 3, 'https://news.example/', 'worker-1');
  await markRunning(storage, 4, 'https://news.example/', 'worker-1');
  const tabs = fakeTabs('https://news.example/', { closed: [3] });
  await restoreInterrupted(storage, tabs, 'worker-2');
  assert.deepEqual(tabs.calls, [['reload', 4]]);
  assert.deepEqual(storage.data, {});
});

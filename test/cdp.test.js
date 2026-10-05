import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCdp } from '../lib/cdp.js';

function fakeDebugger({ detachFails = false } = {}) {
  const listeners = new Set();
  const calls = [];
  return {
    calls,
    listeners,
    onEvent: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
    async attach(target, version) { calls.push(['attach', target, version]); },
    async sendCommand(target, method, params) { calls.push(['send', target, method, params]); return { echo: method }; },
    async detach(target) {
      calls.push(['detach', target]);
      if (detachFails) throw new Error('Debugger is not attached to the tab');
    },
    emit(source, method, params = {}) { for (const l of listeners) l(source, method, params); },
  };
}

test('attaches with protocol 1.3 and sends to the tab', async () => {
  const api = fakeDebugger();
  const cdp = createCdp(7, api);
  await cdp.attach();
  assert.deepEqual(await cdp.send('Page.enable'), { echo: 'Page.enable' });
  await cdp.send('DOM.resolveNode', { backendNodeId: 5 });
  assert.deepEqual(api.calls, [
    ['attach', { tabId: 7 }, '1.3'],
    ['send', { tabId: 7 }, 'Page.enable', {}],
    ['send', { tabId: 7 }, 'DOM.resolveNode', { backendNodeId: 5 }],
  ]);
});

test('onEvent passes method and params of its tab, until unsubscribed', async () => {
  const api = fakeDebugger();
  const cdp = createCdp(7, api);
  await cdp.attach();
  const seen = [];
  const unsubscribe = cdp.onEvent((method, params) => seen.push([method, params.n]));
  api.emit({ tabId: 7 }, 'Page.frameNavigated', { n: 1 });
  api.emit({ tabId: 8 }, 'Page.frameNavigated', { n: 2 });
  unsubscribe();
  api.emit({ tabId: 7 }, 'Page.frameNavigated', { n: 3 });
  assert.deepEqual(seen, [['Page.frameNavigated', 1]]);
});

test('waitFor resolves true on the event of its own tab only', async () => {
  const api = fakeDebugger();
  const cdp = createCdp(7, api);
  await cdp.attach();
  let settled = false;
  const waiting = cdp.waitFor('Page.loadEventFired', 1000).then((ok) => { settled = true; return ok; });
  api.emit({ tabId: 8 }, 'Page.loadEventFired');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  api.emit({ tabId: 7 }, 'Page.loadEventFired');
  assert.equal(await waiting, true);
});

test('waitFor can filter events by their params', async () => {
  const api = fakeDebugger();
  const cdp = createCdp(7, api);
  await cdp.attach();
  let settled = false;
  const waiting = cdp.waitFor('Page.frameNavigated', 1000, (p) => !p.frame.parentId)
    .then((ok) => { settled = true; return ok; });
  api.emit({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'child', parentId: 'main' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  api.emit({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'main' } });
  assert.equal(await waiting, true);
});

test('waitFor resolves false after the timeout', async () => {
  const cdp = createCdp(7, fakeDebugger());
  await cdp.attach();
  assert.equal(await cdp.waitFor('Page.loadEventFired', 5), false);
});

test('detach removes the event listener and swallows detach errors', async () => {
  const api = fakeDebugger({ detachFails: true });
  const cdp = createCdp(7, api);
  await cdp.attach();
  await cdp.detach();
  assert.equal(api.listeners.size, 0);
});

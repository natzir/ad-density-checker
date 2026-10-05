// Puts the tab back on the page that was tested: a reload if it is still there, or a navigation
// back if the page rewrote its URL while it was being scrolled.
import { stripFragment } from './crux.js';

export async function restoreTab(tabs, tabId, testedUrl) {
  const { url } = await tabs.get(tabId);
  let samePage = false;
  try {
    samePage = stripFragment(url) === stripFragment(testedUrl);
  } catch {
    // Not a URL we can compare: go back to the tested one.
  }
  if (samePage) await tabs.reload(tabId);
  else await tabs.update(tabId, { url: testedUrl });
}

// Running tests are written down, so that a worker started after one was cut short (the extension
// was reloaded mid-test, or the worker crashed) can put its tab back, closing first a debugger
// session that outlived the worker (it would keep the page ignoring input). Each worker passes an
// id of its own.
const PREFIX = 'running-test:';

export async function markRunning(storage, tabId, url, worker) {
  await storage.set({ [PREFIX + tabId]: { url, worker } });
}

export async function clearRunning(storage, tabId) {
  await storage.remove(PREFIX + tabId);
}

export async function restoreInterrupted(storage, tabs, worker, detach = async () => {}) {
  const items = await storage.get(null);
  for (const [key, test] of Object.entries(items)) {
    if (!key.startsWith(PREFIX) || test.worker === worker) continue;
    await storage.remove(key);
    const tabId = Number(key.slice(PREFIX.length));
    await detach(tabId).catch(() => {}); // usually closed already
    await restoreTab(tabs, tabId, test.url).catch(() => {});
  }
}

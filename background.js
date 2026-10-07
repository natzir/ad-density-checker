// Service worker: opens the side panel and runs ad tests for it.
import { createCdp } from './lib/cdp.js';
import { clearRunning, markRunning, restoreInterrupted, restoreTab } from './lib/restore-tab.js';
import { runTest, TestError } from './lib/test-runner.js';
import { bundledRules } from './lib/bundled-rules.js';
import { openWelcome } from './lib/welcome.js';

const CHROME_MAJOR = Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 154);
const running = new Map(); // tabId → AbortController
const WORKER = crypto.randomUUID();

// A test cut short by the extension reloading left its tab emulated and scrolled: put it back.
restoreInterrupted(chrome.storage.local, chrome.tabs, WORKER, (tabId) => chrome.debugger.detach({ tabId })).catch(() => {});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener((details) => openWelcome(details, chrome.tabs).catch(() => {}));

// The user pressed Cancel on the debugging bar, or the tab closed.
chrome.debugger.onDetach.addListener((source, reason) => {
  running.get(source.tabId)?.abort(reason === 'target_closed' ? 'tab-closed' : 'cancelled');
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'test') return;
  let controller = null;
  const post = (message) => {
    try {
      port.postMessage(message);
    } catch {
      // The panel is gone.
    }
  };

  port.onDisconnect.addListener(() => controller?.abort('cancelled'));

  port.onMessage.addListener(async (message) => {
    if (message.type === 'cancel') {
      controller?.abort('cancelled');
      return;
    }
    if (message.type !== 'start' || controller) return;

    const { tabId } = message;
    const device = message.device === 'desktop' ? 'desktop' : 'mobile';
    if (running.has(tabId)) {
      post({ type: 'error', message: 'A test is already running on this tab.' });
      return;
    }
    controller = new AbortController();
    running.set(tabId, controller);
    try {
      const tab = await chrome.tabs.get(tabId);
      await markRunning(chrome.storage.local, tabId, tab.url, WORKER);
      const result = await runTest({
        cdp: createCdp(tabId),
        chromeMajor: CHROME_MAJOR,
        adRules: bundledRules,
        device,
        signal: controller.signal,
        onProgress: (progress) => post({ type: 'progress', ...progress }),
      });
      post({ type: 'result', url: tab.url, testedAt: new Date().toISOString(), ...result });
      // An auto-redirect left the tab on another site (a scam, often): take it back to the article.
      if (result.redirect) await restoreTab(chrome.tabs, tabId, tab.url).catch(() => {});
    } catch (error) {
      post({ type: 'error', message: error instanceof TestError ? error.message : `Unexpected error: ${error.message}` });
    } finally {
      running.delete(tabId);
      controller = null;
      await clearRunning(chrome.storage.local, tabId).catch(() => {});
    }
  });
});

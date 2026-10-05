// Promise wrapper around chrome.debugger for one tab.

export function createCdp(tabId, api = chrome.debugger) {
  const listeners = new Set();
  const onDebuggerEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;
    for (const listener of [...listeners]) listener(method, params);
  };

  const onEvent = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    async attach() {
      await api.attach({ tabId }, '1.3');
      api.onEvent.addListener(onDebuggerEvent);
    },

    send(method, params = {}) {
      return api.sendCommand({ tabId }, method, params);
    },

    onEvent,

    // Resolves true when the tab fires the event (and `accept` takes its params), false on timeout.
    waitFor(method, timeoutMs, accept = () => true) {
      return new Promise((resolve) => {
        const unsubscribe = onEvent((m, params) => {
          if (m !== method || !accept(params)) return;
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        });
        const timer = setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, timeoutMs);
      });
    },

    async detach() {
      api.onEvent.removeListener(onDebuggerEvent);
      listeners.clear();
      await api.detach({ tabId }).catch(() => {});
    },
  };
}

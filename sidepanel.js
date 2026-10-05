// Side panel: CrUX on open, test runs through the service worker; the Better Ads verdict first,
// then the viewport and CrUX figures, then the snapshot.
import { checkKey, cruxVisLink, fetchCrux, isHttpUrl, maskKey, NO_FIELD_DATA, stripFragment } from './lib/crux.js';
import { arrowTarget, comparisonRows, cruxColumnLabel, cruxStatusLine, pageParts, progressAnnouncement, resultAnnouncement, snapshotLabel, sparkline, stopNotice, afterTestNote, testSparkline, verdict, coveredNotice, unseenNote, snapshotMissingNote, gateNotice, viewBetterAds, viewTitle, chromeLine, chromeNotCountedNote, playerNote, redirectNotice } from './lib/format.js';
import { comparisonSize, drawComparison, drawSnapshot, exportSize, pruneSnapshots, snapshotFilename, snapshotLayout, snapshotSummary, stripSize, withImages } from './lib/snapshot.js';
import { canTest } from './lib/test-runner.js';

const $ = (id) => document.getElementById(id);
const state = {
  tab: null,
  apiKey: '',
  crux: null,
  cruxMessage: '',
  running: false,
  progress: null,
  densities: [],
  test: null,
  error: '',
  port: null,
  device: 'mobile',
  view: 'real', // 'real' or 'chrome': which verdict the result shows
  editingKey: false,
  keyMessage: null, // { kind: 'pass' | 'warn' | 'fail' | '', text }
};
// The last test result or error of each tab and device, shown again when the tab is back on that page.
const outcomes = new Map();
const outcomeKey = (tabId, device) => `${tabId}|${device}`;
const KEEP_SNAPSHOTS = 5;
let stripFor = null; // the test result the strip shows or is being drawn for
let stripView = 'real'; // and the view it shows
const opened = { view: null, compare: null }; // the images opened in a tab, by kind
let logo = null;
const formFactor = () => (state.device === 'desktop' ? 'DESKTOP' : 'PHONE');
let cruxRequest = 0;
const deviceButtons = [...document.querySelectorAll('#devices button')];
const viewButtons = [...document.querySelectorAll('#views button')];
// Each check's figures exist once per view, stacked in one grid cell (the markup has the Real one): the
// check is as tall as the taller view in both, so switching views moves nothing. The copy's ids start with "chrome-".
for (const figures of document.querySelectorAll('#better-ads .check-value')) {
  const stack = document.createElement('div');
  stack.className = 'view-notes';
  const real = figures.cloneNode(true);
  const chrome = figures.cloneNode(true);
  for (const el of chrome.querySelectorAll('[id]')) el.id = `chrome-${el.id}`;
  real.classList.add('view-layer');
  real.dataset.view = 'real';
  chrome.classList.add('view-layer');
  chrome.dataset.view = 'chrome';
  stack.append(real, chrome);
  figures.replaceWith(stack);
}
// Screen readers hear the progress at most every 10 s, and the result once.
const ANNOUNCE_EVERY_MS = 10000;
let lastAnnouncedAt = 0;
const announce = (text) => {
  $('announcer').textContent = text;
};
const { id: windowId } = await chrome.windows.getCurrent();

function samePage(a, b) {
  try {
    return stripFragment(a) === stripFragment(b);
  } catch {
    return a === b;
  }
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab ?? null;
}

// While a test runs, the panel stays on the tested tab; while its snapshot or comparison is open in a
// tab, on that result, so Download still works.
async function showTab(tab) {
  if (state.running || Object.values(opened).some((url) => url && [tab?.url, tab?.pendingUrl].includes(url))) return;
  state.tab = tab;
  const saved = tab ? outcomes.get(outcomeKey(tab.id, state.device)) : null;
  const current = saved && samePage(saved.url, tab.url) ? saved : null;
  if (saved?.test !== state.test) state.view = 'real'; // a view belongs to the result it was picked on
  state.test = current?.test ?? null;
  state.error = current?.error ?? '';
  await loadCrux();
}

async function loadCrux() {
  const request = ++cruxRequest;
  const url = state.tab?.url;
  state.crux = null;
  state.cruxMessage = '';
  const { cruxApiKey = '' } = await chrome.storage.local.get('cruxApiKey');
  if (request !== cruxRequest) return;
  state.apiKey = cruxApiKey.trim();
  if (!isHttpUrl(url) || !state.apiKey) {
    render();
    return;
  }
  state.cruxMessage = 'Loading CrUX…';
  render();
  try {
    const crux = await fetchCrux({ apiKey: state.apiKey, url, formFactor: formFactor() });
    if (request !== cruxRequest) return;
    state.crux = crux;
    state.cruxMessage = crux ? '' : NO_FIELD_DATA;
  } catch (error) {
    if (request !== cruxRequest) return;
    state.cruxMessage = error.message;
  }
  render();
}

function startTest() {
  const tested = state.tab;
  const { device } = state;
  Object.assign(state, { running: true, test: null, error: '', progress: null, densities: [] });
  lastAnnouncedAt = 0;
  state.keyMessage = null;
  announce('Test started; it takes up to a minute.');
  const port = chrome.runtime.connect({ name: 'test' });
  state.port = port;
  port.onMessage.addListener((message) => {
    if (message.type === 'progress') {
      state.progress = message;
      if (message.density !== null) state.densities.push(message.density);
      if (message.elapsedMs - lastAnnouncedAt >= ANNOUNCE_EVERY_MS) {
        lastAnnouncedAt = message.elapsedMs;
        announce(progressAnnouncement(message));
      }
      render();
    } else if (message.type === 'result') {
      finish(tested, device, { test: message, error: '' });
    } else if (message.type === 'error') {
      finish(tested, device, { test: null, error: message.message });
    }
  });
  port.onDisconnect.addListener(() => {
    if (state.running) finish(tested, device, { test: null, error: 'The test stopped unexpectedly.' });
  });
  port.postMessage({ type: 'start', tabId: tested.id, device });
  render();
  $('cancel').focus(); // Run is disabled now; keep keyboard users on the control that matters
}

// Stores the outcome for the tested tab, then follows whatever tab is active now.
async function finish(tested, device, outcome) {
  const key = outcomeKey(tested.id, device);
  outcomes.delete(key); // re-inserted last: the Map stays oldest first
  outcomes.set(key, { url: tested.url, ...outcome });
  pruneSnapshots(outcomes, KEEP_SNAPSHOTS);
  state.running = false;
  const port = state.port;
  state.port = null;
  port?.disconnect();
  announce(outcome.test ? resultAnnouncement(outcome.test) : outcome.error); // before CrUX loads
  const focusWasLost = document.activeElement === document.body || $('progress').contains(document.activeElement);
  state.view = 'real';
  await showTab(await currentTab());
  if (focusWasLost && !$('run').disabled) $('run').focus();
}

function cell(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

const decodeImage = async (src) => createImageBitmap(await (await fetch(src)).blob());

function logoImage() {
  logo ??= fetch('icons/natzir-logo.png').then((r) => r.blob()).then((blob) => createImageBitmap(blob)).catch(() => null);
  return logo;
}

// Resolves after the next frame has painted, or after 50 ms: no frames come while the panel isn't on screen.
const afterPaint = () => new Promise((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); setTimeout(resolve, 50); });

async function drawStrip(test, view) {
  stripFor = test;
  stripView = view;
  // The redraw is the slow part of a view switch: it waits a frame so the selector and the figures paint first.
  await afterPaint();
  if (stripFor !== test || stripView !== view) return;
  const plan = snapshotLayout({ snapshot: test.snapshot, betterAds: viewBetterAds(test, view), view });
  await withImages(test.snapshot.tiles, decodeImage, (images) => {
    if (stripFor !== test || stripView !== view) return; // another result is on screen now
    const canvas = $('strip');
    const size = stripSize(plan, $('strip-box').clientWidth, devicePixelRatio);
    canvas.width = size.width;
    canvas.height = size.height;
    drawSnapshot(canvas.getContext('2d'), plan, images, { scale: size.scale, dpr: devicePixelRatio, labels: false });
  });
}

async function exportBlob(test, view) {
  const plan = snapshotLayout({ snapshot: test.snapshot, betterAds: viewBetterAds(test, view), view });
  const size = exportSize(plan);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const logoBitmap = await logoImage();
  return withImages(test.snapshot.tiles, decodeImage, (images) => {
    drawSnapshot(canvas.getContext('2d'), plan, images, { scale: size.scale, summary: snapshotSummary(test, { view }), logo: logoBitmap });
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  });
}

// Both views side by side on one image, the Chrome view first.
async function compareBlob(test) {
  const plans = {
    chrome: snapshotLayout({ snapshot: test.snapshot, betterAds: viewBetterAds(test, 'chrome'), view: 'chrome' }),
    real: snapshotLayout({ snapshot: test.snapshot, betterAds: test.betterAds, view: 'real' }),
  };
  const size = comparisonSize(plans, test.url, new OffscreenCanvas(1, 1).getContext('2d'));
  const canvas = new OffscreenCanvas(size.width, size.height);
  const logoBitmap = await logoImage();
  const summaries = { chrome: snapshotSummary(test, { view: 'chrome' }), real: snapshotSummary(test, { view: 'real' }) };
  return withImages(test.snapshot.tiles, decodeImage, (images) => {
    drawComparison(canvas.getContext('2d'), plans, images, { scale: size.scale, summaries, url: test.url, meta: summaries.real.meta, logo: logoBitmap });
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  });
}

// Writes only what changed: rewriting the same text into a live region makes screen readers
// announce it again.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setPill(el, pass, text) {
  const className = `pill ${pass === null ? 'unknown' : pass ? 'pass' : 'fail'}`;
  if (el.className !== className) el.className = className;
  setText(el, text);
}

const currentView = () => (state.test?.chromeView ? state.view : 'real');

function render() {
  const { tab } = state;
  const web = isHttpUrl(tab?.url);
  const testable = canTest(tab?.url);
  const page = web ? pageParts(tab.url) : null;
  setText($('page-host'), page ? page.host : "This page can't be tested.");
  setText($('page-path'), page ? page.path : '');
  $('page').title = web ? tab.url : '';
  $('run').disabled = !testable || state.running;
  setText($('run'), state.running ? 'Running…' : state.test ? 'Run again' : `Run ${state.device} test`);
  for (const button of deviceButtons) {
    button.setAttribute('aria-checked', String(button.dataset.device === state.device));
    button.tabIndex = button.dataset.device === state.device ? 0 : -1;
    button.disabled = state.running;
  }

  const warnings = [];
  if (web && !testable) warnings.push("Chrome doesn't let extensions test Chrome Web Store pages.");
  if (state.test && !state.test.loadEventReached) {
    warnings.push('The page never fired its load event (30 s); results may be incomplete.');
  }
  if (state.test && state.test.scrollable === false) {
    warnings.push("The page is no taller than the screen, so only the first screen was measured (an overlay may block scrolling, or the page scrolls inside a container).");
  }
  if (state.test?.chrome?.pageTagged) {
    warnings.push("Chrome tags the page itself as an ad here (an ad skin on the page), so Chrome's viewport figures, and likely CrUX's, read close to 100%. Better Ads leaves it out.");
  }
  if (state.test?.betterAds?.covered) warnings.push(coveredNotice(state.test.betterAds));
  if (redirectNotice(state.test)) warnings.push(redirectNotice(state.test));
  if (gateNotice(state.test?.betterAds)) warnings.push(gateNotice(state.test.betterAds));
  const stop = stopNotice(state.test?.stoppedAt);
  if (stop && !stop.info) warnings.push(stop.text);
  if (state.test?.hiddenMs > 0) {
    warnings.push(`The tab was hidden for ${Math.round(state.test.hiddenMs / 1000)} s; that time isn't counted, as in Chrome.`);
  }
  const notice = state.error || warnings.join(' ');
  // Not a live region: the announcer speaks errors and results, once.
  setText($('notice'), notice);
  $('notice').hidden = !notice;
  $('notice').className = `notice ${state.error ? 'fail' : 'warn'}`;
  // An expected stop (the end of the article, the next one of an infinite scroll) informs; it isn't a warning.
  // A video player showing videos left out of the density: its video ads fall under another standard.
  // After an auto-redirect the tab was loaded again as usual: no phone version left to reload.
  const info = [stop?.info && stop.text, playerNote(state.test?.betterAds), state.test && !state.test.redirect && afterTestNote(state.test.device)].filter(Boolean).join(' ');
  setText($('stop-note'), info);
  $('stop-note').hidden = !info;

  $('intro').hidden = state.running || Boolean(state.test) || !testable;

  $('progress').hidden = !state.running;
  if (state.running) {
    const elapsed = Math.round((state.progress?.elapsedMs ?? 0) / 1000);
    const max = Math.round((state.progress?.maxMs ?? 60000) / 1000);
    $('bar-fill').style.width = `${Math.min(100, (elapsed / max) * 100)}%`;
    $('bar').setAttribute('aria-valuenow', String(elapsed));
    $('bar').setAttribute('aria-valuemax', String(max));
    $('bar').setAttribute('aria-valuetext', `${elapsed} s of up to ${max} s`);
    setText($('elapsed'), `${elapsed} s of up to ${max} s`);
    const density = state.progress?.density;
    setText($('now'), density == null ? (state.progress ? 'paused' : '—') : `${density}%`);
    setText($('spark'), sparkline(state.densities));
  }

  $('better-ads').hidden = !state.test;
  if (state.test) {
    const view = currentView();
    $('views').hidden = !state.test.chromeView;
    for (const button of viewButtons) {
      button.setAttribute('aria-checked', String(button.dataset.view === view));
      button.tabIndex = button.dataset.view === view ? 0 : -1;
    }
    const betterAds = viewBetterAds(state.test, view);
    const v = verdict(betterAds);
    setText($('better-title-real'), viewTitle(state.test.device, 'real'));
    setText($('better-title-chrome'), viewTitle(state.test.device, 'chrome'));
    setText($('chrome-line'), chromeLine(state.test));
    setPill($('density-pill'), v.density.pass, v.density.pill);
    $('density-fill').style.width = `${v.density.fill}%`;
    $('density-fill').classList.toggle('fail', v.density.pass === false);
    $('density-limit').style.left = `${v.density.limit}%`;
    $('density-limit-label').style.left = `${v.density.limit}%`;
    setText($('density-limit-label'), `limit ${v.density.limit}%`);
    // Both views' notes are filled and the unselected one hidden by visibility, so the check keeps the
    // taller view's height in both. Without a Chrome view its layer stays empty.
    for (const layer of document.querySelectorAll('#better-ads .view-layer')) layer.toggleAttribute('data-off', layer.dataset.view !== view);
    for (const name of ['real', 'chrome']) {
      const ads = name === 'real' || state.test.chromeView ? viewBetterAds(state.test, name) : null;
      const prefix = name === 'chrome' ? 'chrome-' : '';
      const note = !ads || ads.covered ? null : name === 'chrome' ? chromeNotCountedNote(ads) : unseenNote(ads);
      const own = verdict(viewBetterAds(state.test, name));
      const densityNote = ads ? own.density.note : '';
      setText($(`${prefix}density-value`), own.density.value);
      setText($(`${prefix}density-of`), own.density.of);
      setText($(`${prefix}density-limit-sr`), `, limit ${own.density.limit}%`);
      setText($(`${prefix}sticky-value`), own.largeSticky.value);
      setText($(`${prefix}sticky-detail`), own.largeSticky.detail);
      setText($(`${prefix}interstitial-value`), own.interstitial.value);
      setText($(`${prefix}interstitial-detail`), own.interstitial.detail);
      setText($(`${prefix}density-note`), densityNote);
      $(`${prefix}density-note`).hidden = !densityNote;
      $(`${prefix}unseen`).hidden = !note;
      setText($(`${prefix}unseen-text`), note ?? '');
    }
    setPill($('sticky-pill'), v.largeSticky.pass, v.largeSticky.pill);
    setPill($('interstitial-pill'), v.interstitial.pass, v.interstitial.pill);
  }

  setText($('crux-head'), cruxColumnLabel(state.crux));
  $('metrics').tBodies[0].replaceChildren(
    ...comparisonRows(state.test?.chrome, state.crux).map(([label, test, crux]) => {
      const tr = document.createElement('tr');
      const th = cell('th', label);
      th.scope = 'row';
      tr.append(th, cell('td', test), cell('td', crux));
      return tr;
    }),
  );
  const line = state.test ? testSparkline(state.test.samples.map((s) => s.density)) : null;
  $('test-line').hidden = !line;
  if (line) {
    $('test-spark').replaceChildren(...line.glyphs.map((glyph, i) => {
      const bar = document.createElement('span');
      bar.textContent = glyph;
      if (i === line.peak) bar.className = 'peak-bar';
      return bar;
    }));
    setText($('test-peak'), `peak ${line.value}%`);
    setText($('test-line-sr'), `Ads on screen during the test, peak ${line.value}%`);
  }

  $('crux').hidden = !web;
  const formOpen = web && (!state.apiKey || state.editingKey);
  $('key-form').hidden = !formOpen;
  $('crux-status').hidden = !state.apiKey;
  setText($('crux-status'), state.apiKey ? (state.crux ? cruxStatusLine(state.crux, formFactor()) : state.cruxMessage) : '');
  $('change-key').hidden = !state.apiKey || state.editingKey;
  $('key-edit-actions').hidden = !state.apiKey;
  $('key-intro').hidden = Boolean(state.apiKey);
  $('key-input').placeholder = state.apiKey ? maskKey(state.apiKey) : 'Paste your API key';
  setText($('key-message'), state.keyMessage?.text ?? '');
  const keyClass = `small ${state.keyMessage?.kind ?? ''}`;
  if ($('key-message').className !== keyClass) $('key-message').className = keyClass;
  if (state.keyMessage?.kind === 'fail') $('key-input').setAttribute('aria-invalid', 'true');
  else $('key-input').removeAttribute('aria-invalid');
  if (web) $('crux-vis').href = cruxVisLink(tab.url, state.crux?.level ?? 'origin', formFactor());

  const snapshot = state.test?.snapshot;
  $('snapshot').hidden = !state.test;
  $('strip-box').hidden = !snapshot;
  $('snapshot-actions').hidden = !snapshot;
  $('snapshot-help').hidden = !snapshot;
  $('snapshot-missing').hidden = Boolean(snapshot);
  setText($('snapshot-missing'), snapshotMissingNote(state.test, KEEP_SNAPSHOTS));
  $('strip').setAttribute('aria-label', snapshot ? snapshotLabel({ betterAds: viewBetterAds(state.test, currentView()) }, currentView()) : '');
  $('snapshot-downloads').hidden = !snapshot;
  for (const id of ['open-compare', 'compare-snapshot', 'compare-help', 'compare-download-help']) $(id).hidden = !state.test?.chromeView;
  if (snapshot && (stripFor !== state.test || stripView !== currentView())) drawStrip(state.test, currentView());
  if (!snapshot) stripFor = null;
}

async function selectDevice(device) {
  if (state.running || device === state.device) return;
  state.device = device;
  await chrome.storage.local.set({ device: state.device });
  await showTab(state.tab);
}

$('run').addEventListener('click', startTest);
for (const button of deviceButtons) {
  button.addEventListener('click', () => selectDevice(button.dataset.device));
}
// A radio group: Tab reaches the selected device, the arrow keys change it.
$('devices').addEventListener('keydown', (event) => {
  const target = arrowTarget(deviceButtons.map((b) => b.dataset.device), state.device, event.key);
  if (!target || state.running) return;
  event.preventDefault();
  deviceButtons.find((b) => b.dataset.device === target).focus();
  selectDevice(target);
});
// Paints the buttons' new state at once; the strip redraws after (drawStrip is async).
function selectView(view) {
  if (!state.test?.chromeView || view === state.view) return;
  state.view = view;
  render();
}
for (const button of viewButtons) button.addEventListener('click', () => selectView(button.dataset.view));
// A radio group: Tab reaches the selected view, the arrow keys change it.
$('views').addEventListener('keydown', (event) => {
  const target = arrowTarget(viewButtons.map((b) => b.dataset.view), state.view, event.key);
  if (!target) return;
  event.preventDefault();
  viewButtons.find((b) => b.dataset.view === target).focus();
  selectView(target);
});
$('cancel').addEventListener('click', () => state.port?.postMessage({ type: 'cancel' }));
// The full-size image takes a second or two to draw: made once per result and shared by both
// buttons (a click while it is being made waits for the same one).
let exported = null; // { test, view, blob: Promise<Blob> }
function snapshotBlob(test, view) {
  if (exported?.test !== test || exported.view !== view) {
    const blob = exportBlob(test, view);
    exported = { test, view, blob };
    blob.catch(() => { if (exported?.blob === blob) exported = null; });
  }
  return exported.blob;
}

// While the image is made the pressed control says so at once ("Preparing…", in the same cell as its label,
// so nothing moves) and none of them takes another click (a second click looked needed when nothing
// changed). aria-disabled, not disabled: the control keeps the keyboard focus.
let exporting = false;
const exportControls = () => ['open-snapshot', 'open-compare', 'download-snapshot', 'compare-snapshot'].map((id) => $(id));
async function whileExporting(control, work) {
  if (exporting) return;
  exporting = true;
  for (const c of exportControls()) c.setAttribute('aria-disabled', 'true');
  control.setAttribute('aria-busy', 'true');
  try {
    // Paint the label first.
    await afterPaint();
    await work();
  } finally {
    control.removeAttribute('aria-busy');
    for (const c of exportControls()) c.removeAttribute('aria-disabled');
    exporting = false;
  }
}

// Opens an image in a new tab; the one opened before of the same kind (view or comparison) is let go.
async function openImage(kind, blob) {
  if (opened[kind]) URL.revokeObjectURL(opened[kind]);
  opened[kind] = URL.createObjectURL(blob);
  await chrome.tabs.create({ url: opened[kind] });
}
function saveImage(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

$('open-snapshot').addEventListener('click', (event) => {
  const test = state.test;
  if (!test?.snapshot) return;
  const view = currentView();
  whileExporting(event.currentTarget, async () => openImage('view', await snapshotBlob(test, view)));
});
$('open-compare').addEventListener('click', (event) => {
  const test = state.test;
  if (!test?.snapshot || !test.chromeView) return;
  whileExporting(event.currentTarget, async () => openImage('compare', await compareBlob(test)));
});
$('download-snapshot').addEventListener('click', (event) => {
  const test = state.test;
  if (!test?.snapshot) return;
  const view = currentView();
  whileExporting(event.currentTarget, async () => saveImage(await snapshotBlob(test, view), snapshotFilename(test, view === 'chrome' ? '-chrome' : '')));
});
$('compare-snapshot').addEventListener('click', (event) => {
  const test = state.test;
  if (!test?.snapshot || !test.chromeView) return;
  whileExporting(event.currentTarget, async () => saveImage(await compareBlob(test), snapshotFilename(test, '-chrome-vs-real')));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.running) {
    event.preventDefault();
    state.port?.postMessage({ type: 'cancel' });
  }
});
$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const apiKey = $('key-input').value.trim();
  if (!apiKey) return;
  $('key-save').disabled = true;
  state.keyMessage = { kind: '', text: 'Checking the key…' };
  render();
  const check = await checkKey({ apiKey, url: state.tab?.url, formFactor: formFactor() });
  $('key-save').disabled = false;
  if (check.status === 'rejected') {
    state.keyMessage = { kind: 'fail', text: check.message };
    render();
    $('key-input').focus();
    return;
  }
  $('key-input').value = '';
  state.apiKey = apiKey;
  state.editingKey = false;
  state.keyMessage = check.status === 'unchecked' ? { kind: 'warn', text: check.message } : { kind: 'pass', text: 'Key saved.' };
  render();
  $('change-key').focus();
  // onChanged reloads CrUX; it doesn't fire when the same key is saved again, so load it here too.
  await chrome.storage.local.set({ cruxApiKey: apiKey });
  if (!state.running) loadCrux();
});
$('change-key').addEventListener('click', () => {
  state.editingKey = true;
  state.keyMessage = null;
  render();
  $('key-input').focus();
});
function closeKeyForm() {
  state.editingKey = false;
  state.keyMessage = null;
  $('key-input').value = '';
  render();
  $('change-key').focus();
}
$('key-cancel').addEventListener('click', closeKeyForm);
$('key-form').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.apiKey && state.editingKey) {
    event.preventDefault();
    event.stopPropagation();
    closeKeyForm();
  }
});
$('key-remove').addEventListener('click', async () => {
  state.apiKey = '';
  state.crux = null;
  state.editingKey = false;
  state.keyMessage = { kind: '', text: 'Key removed.' };
  render();
  $('key-input').focus();
  await chrome.storage.local.remove('cruxApiKey');
});

chrome.tabs.onActivated.addListener(async (info) => {
  if (info.windowId === windowId) showTab(await currentTab());
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active && tab.windowId === windowId) showTab(tab);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.cruxApiKey) return;
  if (!state.running) {
    loadCrux();
    return;
  }
  // During a test the panel shows the change now and fetches CrUX when the test ends.
  state.apiKey = (changes.cruxApiKey.newValue ?? '').trim();
  render();
});

state.device = (await chrome.storage.local.get('device')).device === 'desktop' ? 'desktop' : 'mobile';
showTab(await currentTab());

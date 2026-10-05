import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, DEVICES, PAGE_INFO_EXPR, PAGE_STATE_EXPR, SCROLL_EXPR, canTest, desktopUserAgent, mobileUserAgent, runTest, sameSite } from '../lib/test-runner.js';
import { compileRules } from '../lib/adlist.js';
import { fakeCdp, fakeClock } from './fake-cdp.js';

function setup(page, extra = {}) {
  const cdp = fakeCdp(page);
  let reloads = 0;
  const run = () => runTest({
    cdp,
    chromeMajor: 154,
    reloadTab: async () => { reloads += 1; },
    adRules: () => compileRules([]),
    ...fakeClock(),
    ...extra,
  });
  return { cdp, run, reloads: () => reloads };
}

const scrolls = (cdp) =>
  cdp.sent.filter((c) => c.method === 'Runtime.evaluate' && c.params.expression === SCROLL_EXPR).length;
const indexOf = (cdp, method) => cdp.sent.findIndex((c) => c.method === method);

test('PAGE_STATE_EXPR reports scroll, viewport, page height, pixel ratio and whether the tab is hidden', () => {
  const window = { scrollY: 40, innerWidth: 412, innerHeight: 823, devicePixelRatio: 1.75 };
  const document = { documentElement: { scrollHeight: 3000 }, visibilityState: 'hidden' };
  const state = new Function('window', 'document', `return ${PAGE_STATE_EXPR};`)(window, document);
  assert.deepEqual(state, { scrollY: 40, innerWidth: 412, innerHeight: 823, scrollHeight: 3000, dpr: 1.75, hidden: true });
});

test('with the browser zoomed, screenshots are clipped in screen pixels so they match the page', async () => {
  // Desktop at 90 % zoom: the 1350 × 940 screen shows 1500 × 1044 CSS pixels.
  const { cdp, run } = setup({ pageHeight: 6000, viewportWidth: 1500, viewportHeight: 1044, dpr: 0.9 }, { device: 'desktop' });
  await run();
  const [first, second] = cdp.captures.map((c) => c.params.clip);
  const round = (clip) => Object.fromEntries(Object.entries(clip).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  assert.deepEqual(round(first), { x: 0, y: 0, width: 1350, height: 939.6, scale: 1.111 });
  assert.deepEqual(round(second), { x: 0, y: 939.6, width: 1350, height: 939.6, scale: 1.111 }); // scrolled one CSS screen, 1044
});

test('no screenshot while the page reports another pixel ratio than at the start: it would be clipped wrong', async () => {
  // Ideal desktop once came out with its first screen at half scale and the next ones blank: a clip made for
  // devicePixelRatio 2 on a page emulated at 1.
  const plain = setup({ pageHeight: 3000, dpr: 1.75 });
  await plain.run();
  assert.deepEqual(plain.cdp.captures.map((c) => [c.tick, c.scrollY]), [[3, 0], [4, 823], [6, 1646], [8, 2177]]);
  // A blip at one sample: that screen is taken at the next one, still there.
  const blip = setup({ pageHeight: 3000, dpr: 1.75, dprOff: { ticks: [4], value: 3.5 } });
  await blip.run();
  assert.deepEqual(blip.cdp.captures.map((c) => [c.tick, c.scrollY]), [[3, 0], [5, 823], [6, 1646], [8, 2177]]);
  // Longer: the screens the test scrolled past meanwhile are left out (the snapshot says "not captured").
  const off = setup({ pageHeight: 3000, dpr: 1.75, dprOff: { ticks: [4, 5, 6, 7], value: 3.5 } });
  const result = await off.run();
  assert.deepEqual(off.cdp.captures.map((c) => [c.tick, c.scrollY]), [[3, 0], [8, 2177]]);
  assert.ok(off.cdp.captures.every((c) => c.params.clip.scale === 1 / 1.75));
  assert.deepEqual(result.snapshot.tiles.map((t) => t.pageTop), [0, 2177]);
});

test('a zoomed site gets the profile\'s size in CSS pixels: the emulated screen is scaled by the zoom', async () => {
  // Desktop at 90 % zoom would lay the page out 1500 px wide; 1215 × 846 screen pixels are 1350 × 940 CSS px.
  const desktop = setup({ dpr: 0.9 }, { device: 'desktop' });
  await desktop.run();
  const sizes = (cdp) => cdp.sent.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride').map((c) => [c.params.width, c.params.height]);
  assert.deepEqual(sizes(desktop.cdp), [[1350, 940], [1215, 846]]);
  assert.ok(indexOf(desktop.cdp, 'Page.reload') > desktop.cdp.sent.findLastIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride'));
  // Whatever the device: a phone whose page reported 1.575 (1.75 at 90 %) would be scaled too.
  const phone = setup({ dpr: 1.575 });
  await phone.run();
  assert.deepEqual(sizes(phone.cdp), [[412, 823], [371, 741]]);
  // Not zoomed: one override, the profile's.
  const plain = setup({ dpr: 1.75 });
  await plain.run();
  assert.deepEqual(sizes(plain.cdp), [[412, 823]]);
});

test('canTest accepts web pages but not the Chrome Web Store, which extensions may not debug', () => {
  assert.equal(canTest('https://news.example/a'), true);
  assert.equal(canTest('http://news.example/'), true);
  assert.equal(canTest('https://chrome.google.com/'), true);
  assert.equal(canTest('https://chromewebstore.google.com/detail/abc'), false);
  assert.equal(canTest('https://chrome.google.com/webstore/detail/abc'), false);
  assert.equal(canTest('chrome://newtab/'), false);
  assert.equal(canTest(undefined), false);
});

test('desktopUserAgent is Chrome on a Mac with the running major version', () => {
  const ua = desktopUserAgent(154);
  assert.match(ua.userAgent, /Macintosh.*Chrome\/154\.0\.0\.0 Safari/);
  assert.equal(ua.userAgentMetadata.mobile, false);
});

test('mobileUserAgent uses the running Chrome major version', () => {
  const ua = mobileUserAgent(154);
  assert.match(ua.userAgent, /moto g power \(2022\).*Chrome\/154\.0\.0\.0 Mobile Safari/);
  assert.equal(ua.userAgentMetadata.mobile, true);
  assert.equal(ua.userAgentMetadata.platform, 'Android');
});

test('measures a long page with Blink rules, scrolls to the bottom and leaves the tab without reloading it', async () => {
  const { cdp, run, reloads } = setup({
    pageHeight: 3000,
    ads: [
      { id: 11, pageTop: 1000, height: 250 },
      { id: 12, sticky: true, viewportTop: 723, height: 100 },
      { id: 13, pageTop: 0, height: 500, hidden: true },
    ],
  });
  const result = await run();

  assert.deepEqual(cdp.sent[indexOf(cdp, 'Emulation.setDeviceMetricsOverride')].params, DEVICES.mobile.metrics);
  assert.ok(indexOf(cdp, 'Emulation.setUserAgentOverride') < indexOf(cdp, 'Page.reload'));
  assert.equal(scrolls(cdp), 3); // 0 → 823 → 1646 → 2177 (bottom of a 3000 px page)
  // Samples t = 0…9000 s hold 1 s each: 12 % (sticky only) ×8, 42 % (sticky + inline) ×2 → 18 %
  assert.deepEqual(result.chrome, { avgDensity: 18, peakDensity: 42, avgCount: 1.2, cpuMs: null, networkKB: null, pageTagged: false });
  // Better Ads: inline 250 + sticky 100 (once) + the covered ad 500 = 850 of the 3000 px page
  assert.deepEqual(result.betterAds.density, { value: 28.3, over: false, limit: 30, pass: true });
  assert.deepEqual(result.betterAds.largeSticky, { value: 12, limit: 30, pass: true, found: true }); // 41 200 / 339 076
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 3000 });
  assert.equal(result.betterAds.contentDetected, false);
  assert.equal(result.device, 'mobile');
  assert.equal(result.loadEventReached, true);
  assert.equal(cdp.detached, true);
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('only listens to the network (no interception, throttling or blocking) and leaves other targets alone', async () => {
  const { cdp, run } = setup({ ads: [{ id: 11, pageTop: 1000, height: 250 }] }, { adRules: () => compileRules([]) });
  await run();
  assert.deepEqual(cdp.sent.filter((c) => (c.method.startsWith('Network.') && c.method !== 'Network.enable' && c.method !== 'Network.disable') || c.method.startsWith('Target.')), []);
});

test('a page that fits the screen is sampled through the settle time without scrolling', async () => {
  const { cdp, run } = setup({ pageHeight: 800, ads: [] });
  const result = await run();
  assert.equal(scrolls(cdp), 0);
  assert.equal(result.samples.length, 6); // 3 while settling + 3 at the bottom
  assert.deepEqual(result.chrome, { avgDensity: 0, peakDensity: 0, avgCount: 0, cpuMs: null, networkKB: null, pageTagged: false });
  assert.deepEqual(result.betterAds.largeSticky, { value: 0, limit: 30, pass: true, found: false });
});

test('pauses while the tab is hidden and leaves that time out, like Chrome', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 12, sticky: true, viewportTop: 723, height: 100 }], hiddenTicks: [4, 5, 6] });
  const result = await run();
  assert.equal(result.samples.filter((x) => x.density === null).length, 3);
  assert.equal(result.hiddenMs, 3000);
  assert.equal(result.chrome.avgDensity, 12); // only the visible samples (sticky ad: 12 %)
  assert.equal(scrolls(cdp), 3);
  assert.equal(result.durationMs, 12000); // the three scrolls wait for the tab to be visible again
});

test('the minute counts only while the tab is visible: hidden for 40 s, the test still scrolls the whole page', async () => {
  // 14 screens to scroll: about 35 s of a visible tab. Hidden for 40 s near the start, the old clock ran out first.
  const hiddenTicks = Array.from({ length: 40 }, (_, i) => i + 4);
  const progress = [];
  const { run } = setup({ pageHeight: 12000, hiddenTicks }, { onProgress: (p) => progress.push(p) });
  const result = await run();
  assert.equal(result.stoppedAt, null);
  assert.equal(result.hiddenMs, 40000);
  assert.ok(result.durationMs > 60000, `durationMs ${result.durationMs}`);
  // The progress bar stands still while hidden: it shows the visible time only.
  const hidden = progress.filter((p) => p.density === null);
  assert.equal(new Set(hidden.map((p) => p.elapsedMs)).size, 1);
  assert.ok(Math.max(...progress.map((p) => p.elapsedMs)) < 60000);
});

test('a tab hidden for over 2 minutes is an error, not a verdict on the screens seen before', async () => {
  const hiddenTicks = Array.from({ length: 400 }, (_, i) => i + 5);
  const { run } = setup({ pageHeight: 12000, hiddenTicks });
  await assert.rejects(run(), { message: 'The tab was hidden for over 2 minutes, so the test couldn\'t finish. Keep it visible and run again.' });
});

test('a desktop test emulates the Lighthouse desktop profile and judges density against 50 %', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, viewportWidth: 1350, viewportHeight: 940, ads: [{ id: 11, pageTop: 1000, height: 250 }] }, { device: 'desktop' });
  const result = await run();
  assert.deepEqual(cdp.sent[indexOf(cdp, 'Emulation.setDeviceMetricsOverride')].params, { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
  assert.equal(cdp.sent[indexOf(cdp, 'Emulation.setUserAgentOverride')].params.userAgentMetadata.mobile, false);
  assert.deepEqual(cdp.sent[indexOf(cdp, 'Emulation.setTouchEmulationEnabled')].params, { enabled: false });
  assert.equal(result.device, 'desktop');
  assert.equal(result.betterAds.density.limit, 50);
});

test('Better Ads uses the main content the page reports', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }], content: { begin: 500, end: 2500 } });
  const result = await run();
  assert.deepEqual(result.betterAds.content, { begin: 500, end: 2500 });
  assert.equal(result.betterAds.contentDetected, true);
  assert.equal(result.betterAds.density.value, 12.5); // 250 / 2000
});

test('the main content begins where the header ended with the page at the top', async () => {
  // A header that turns fixed reports a different bottom once the page is scrolled.
  const content = (scrollY) => ({ begin: scrollY === 0 ? 100 : 900, end: 2800 });
  const { run } = setup({ pageHeight: 3000, content });
  const result = await run();
  assert.deepEqual(result.betterAds.content, { begin: 100, end: 2800 });
});

test('an implausibly small main content falls back to the whole page', async () => {
  const { run } = setup({ pageHeight: 3000, content: { begin: 0, end: 300 } });
  const result = await run();
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 3000 });
  assert.equal(result.betterAds.contentDetected, false);
});

test('an ad covered at its centre counts for Better Ads but not for the viewport metrics', async () => {
  const { run } = setup({ pageHeight: 1000, ads: [{ id: 31, pageTop: 0, height: 400, hidden: true }] });
  const result = await run();
  assert.equal(result.chrome.peakDensity, 0);
  assert.equal(result.betterAds.density.value, 40);
});

test('when Chrome tags the page itself as an ad, its metrics show it but Better Ads ignores it', async () => {
  const { run } = setup({
    pageHeight: 3000,
    ads: [{ id: 41, pageTop: 0, height: 3000, page: true }, { id: 42, pageTop: 1000, height: 300, nested: false }],
  });
  const result = await run();
  assert.equal(result.chrome.pageTagged, true);
  assert.ok(result.chrome.peakDensity >= 100); // Chrome's own reading
  assert.equal(result.betterAds.density.value, 10); // only the real ad: 300 / 3000
});

test('ads hidden by CSS count for nothing', async () => {
  const { run } = setup({ pageHeight: 1000, ads: [{ id: 32, pageTop: 0, height: 400, cssHidden: true }] });
  const result = await run();
  assert.equal(result.chrome.peakDensity, 0);
  assert.equal(result.betterAds.density.value, 0);
});

test('says whether the page was taller than the screen, so it could be scrolled', async () => {
  const short = await setup({ pageHeight: 800 }).run();
  assert.equal(short.scrollable, false);
  const long = await setup({ pageHeight: 3000 }).run();
  assert.equal(long.scrollable, true);
});

test('turns scroll restoration off before reloading, so the test starts at the top', async () => {
  const { cdp, run } = setup({});
  await run();
  const script = cdp.sent.findIndex((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument' && /scrollRestoration/.test(c.params.source));
  assert.ok(script >= 0 && script < indexOf(cdp, 'Page.reload'));
});

test('scrolling by hand is blocked by Chrome, not by changing the page, from the reload until the test ends', async () => {
  const { cdp, run } = setup({ pageHeight: 3000 });
  await run();
  const ignore = cdp.sent.filter((c) => c.method === 'Input.setIgnoreInputEvents');
  // Lifted only around the reader's one mouse move (the two events between), and at the end.
  assert.deepEqual(ignore.map((c) => c.params.ignore), [true, false, true, false]);
  assert.ok(cdp.sent.indexOf(ignore[0]) < indexOf(cdp, 'Page.reload'));
  assert.deepEqual(cdp.sent.slice(cdp.sent.indexOf(ignore[1]) + 1, cdp.sent.indexOf(ignore[2])).map((c) => c.method), ['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']);
  assert.ok(cdp.sent.indexOf(ignore[3]) > cdp.sent.findLastIndex((c) => c.method === 'Page.captureScreenshot'));
  // Changing the page (overflow, input listeners) changed how sticky ads behave, so it measured wrong:
  // the one script added to the page is the one that turns scroll restoration off.
  assert.equal(cdp.sent.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument').length, 1);
  assert.deepEqual(cdp.sent[indexOf(cdp, 'Emulation.setScrollbarsHidden')].params, { hidden: true });
});

test('gives the content probe the page height from before scrolling', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, growOnScroll: 2000 });
  await run();
  assert.equal(cdp.contentArgs.at(-1), 3000);
});

test('gives the content probe the ads Chrome tagged (an aside an ad fills is its slot)', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 12, pageTop: 2000, height: 250 }] });
  await run();
  assert.deepEqual(cdp.contentAds.at(-1), ['obj-11', 'obj-12']);
  assert.equal(cdp.contentArgs.at(-1), 3000);
});

test('takes the article end with the page at the top, before an infinite scroll grows the article', async () => {
  // The next articles get appended inside the first <article>, so its bottom moves down as the test scrolls.
  const content = (scrollY) => ({ begin: 100, articleEnd: scrollY === 0 ? 2500 : 2500 + scrollY * 3 });
  const { run } = setup({ pageHeight: 3000, growOnScroll: 2000, content });
  const result = await run();
  assert.deepEqual(result.betterAds.content, { begin: 100, end: 2500 });
  assert.equal(result.betterAds.contentDetected, true);
});

test('ads of the next article stay out after the page drops the first one above the screen', async () => {
  // Scrolling into the second article, the page removes the first 2400 px; the second article's ad
  // then sits at 600 px, inside the range the first article had when measured at the top.
  const { run } = setup({
    pageHeight: 6000,
    ads: [{ id: 11, pageTop: 500, height: 250 }, { id: 12, pageTop: 3000, height: 250 }],
    content: { begin: 0, articleEnd: 2000 },
    dropAbove: { atScrollY: 2400, px: 2400 },
  });
  const result = await run();
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 2000 });
  assert.equal(result.betterAds.density.value, 12.5); // only the first article's ad: 250 / 2000
});

test('the main content end found after the page dropped content above is moved back too', async () => {
  // A footer at 5500 px before the drop reports 3100 px after it.
  const content = (scrollY, dropped) => ({ begin: 0, end: 5500 - dropped });
  const { run } = setup({
    pageHeight: 6000,
    ads: [{ id: 11, pageTop: 500, height: 250 }, { id: 12, pageTop: 3000, height: 250 }],
    content,
    dropAbove: { atScrollY: 2400, px: 2400 },
  });
  const result = await run();
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 5500 });
  assert.equal(result.betterAds.density.value, 9.1); // 500 / 5500
});

test('stops at the time limit on pages that keep growing', async () => {
  const { run } = setup({ pageHeight: 3000, growOnScroll: 2000 });
  const result = await run();
  assert.equal(result.durationMs, DEFAULTS.maxMs);
  assert.equal(result.samples.length, DEFAULTS.maxMs / DEFAULTS.sampleMs);
});

test('skips ad elements that disappear between the DOM read and the measurement', async () => {
  const { run } = setup({
    pageHeight: 1000,
    ads: [{ id: 21, pageTop: 0, height: 500 }, { id: 22, pageTop: 600, height: 100 }],
    vanishingAds: [21],
  });
  const result = await run();
  assert.deepEqual(result.betterAds.density, { value: 10, over: false, limit: 30, pass: true }); // only element 22: 100 / 1000
});

test('captures each screen once, from the top, once the page has settled', async () => {
  const { cdp, run } = setup({ pageHeight: 3000 });
  const result = await run();
  assert.deepEqual(result.snapshot.tiles.map((t) => t.pageTop), [0, 823, 1646, 2177]);
  assert.deepEqual(result.snapshot.tiles.map((t) => t.image), [
    'data:image/jpeg;base64,shot-0', 'data:image/jpeg;base64,shot-823', 'data:image/jpeg;base64,shot-1646', 'data:image/jpeg;base64,shot-2177',
  ]);
  assert.deepEqual(result.snapshot.viewport, { width: 412, height: 823 });
  assert.equal(result.snapshot.pageHeight, 3000);
  assert.deepEqual(cdp.captures[0].params, {
    format: 'jpeg', quality: 70, optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: 412, height: 823, scale: 1 / 1.75 },
  });
  assert.deepEqual(cdp.captures.map((c) => c.tick), [3, 4, 6, 8]); // none while settling (ticks 0–2)
});

test('each sample says where on the page the screen was', async () => {
  const result = await setup({ pageHeight: 3000 }).run();
  assert.deepEqual(result.samples.map((s) => s.pageTop), [0, 0, 0, 0, 823, 823, 1646, 1646, 2177, 2177, 2177]);
});

test('takes no screenshot while the tab is hidden', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, hiddenTicks: [3, 4, 5] });
  const result = await run();
  assert.ok(cdp.captures.every((c) => ![3, 4, 5].includes(c.tick)));
  assert.deepEqual(result.snapshot.tiles.map((t) => t.pageTop), [0, 823, 1646, 2177]);
});

test('a screenshot that fails is skipped and the test goes on', async () => {
  const { run } = setup({ pageHeight: 3000, failCaptures: [1] });
  const result = await run();
  assert.deepEqual(result.snapshot.tiles.map((t) => t.pageTop), [0, 1646, 2177]);
  assert.equal(result.samples.length, 11);
});

test('without a snapshot, the result says why no screen was captured', async () => {
  // "No snapshot" came up a few times in sweeps with no clue why: Chrome failing every capture, or every
  // screen skipped for another pixel ratio.
  const failing = setup({ pageHeight: 3000, failCaptures: [0, 1, 2, 3, 4, 5] });
  const failed = await failing.run();
  assert.equal(failed.snapshot, null);
  assert.equal(failed.snapshotIssue, "Chrome couldn't capture the screen 4 times (last: Unable to capture screenshot).");
  const skipping = setup({ pageHeight: 3000, dpr: 1.75, dprOff: { ticks: Array.from({ length: 20 }, (_, i) => i + 1), value: 3.5 } });
  const skipped = await skipping.run();
  assert.equal(skipped.snapshot, null);
  assert.equal(skipped.snapshotIssue, "The page's pixel ratio changed during the test (3.5 instead of 1.75), so its screens couldn't be captured.");
  // With a snapshot: none.
  const { run } = setup({ pageHeight: 3000 });
  assert.equal((await run()).snapshotIssue, null);
});

test('a screenshot that never answers is given up and the test goes on', async () => {
  const { run } = setup({ pageHeight: 3000, hangOn: 'Page.captureScreenshot' }, { config: { ...DEFAULTS, commandTimeoutMs: 20 } });
  const result = await run();
  assert.equal(result.snapshot, null);
  assert.equal(result.samples.length, 11);
});

test('screens keep their first-layout position after the page drops content above', async () => {
  const { run } = setup({ pageHeight: 6000, dropAbove: { atScrollY: 2400, px: 2400 }, ads: [{ id: 11, pageTop: 500, height: 250 }, { id: 12, pageTop: 3000, height: 250 }] });
  const result = await run();
  assert.deepEqual(result.snapshot.tiles.map((t) => t.pageTop), [0, 823, 1646, 2469, 3292, 4115, 4938, 5177]);
  assert.equal(result.snapshot.pageHeight, 6000);
});

test('a page that fits the screen has one screen; a wider mobile layout keeps its width', async () => {
  const short = await setup({ pageHeight: 800 }).run();
  assert.deepEqual(short.snapshot.tiles.map((t) => t.pageTop), [0]);
  const { cdp, run } = setup({ pageHeight: 3000, viewportWidth: 418 });
  const wide = await run();
  assert.equal(wide.snapshot.viewport.width, 418);
  assert.equal(cdp.captures[0].params.clip.width, 418);
});

test('every screenshot hides the site\'s fixed bars an earlier one showed (marking the new ones), never the ads, and shows them again', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }] });
  await run();
  const step = (c) => {
    if (c.method === 'Page.captureScreenshot') return 'capture';
    const code = String(c.params.functionDeclaration ?? c.params.expression ?? '');
    return code.includes('function hideFixedBars') ? 'hide' : code.includes('function showHidden') ? 'show' : null;
  };
  assert.deepEqual(cdp.sent.map(step).filter(Boolean), ['hide', 'capture', 'show', 'hide', 'capture', 'show', 'hide', 'capture', 'show', 'hide', 'capture', 'show']);
  assert.deepEqual(cdp.sent.find((c) => step(c) === 'hide').params.arguments, [{ objectId: 'obj-11' }]);
  assert.equal(cdp.sent.filter((c) => c.method === 'Runtime.releaseObjectGroup').length, 11); // once per sample
});

test('a sticky ad remembers the screenshot it was seen in', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 12, sticky: true, viewportTop: 723, height: 100 }] });
  const result = await run();
  const ad = result.betterAds.ads.find((a) => a.id === '12');
  assert.equal(ad.tile, 0); // the first screenshot, at the top
  assert.equal(ad.top, 723);
});

test('a fixed ad shows in the first screenshot that has it and is hidden from the later ones', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 12, sticky: true, viewportTop: 723, height: 100 }] });
  await run();
  const step = (c) => {
    if (c.method === 'Page.captureScreenshot') return 'capture';
    const code = String(c.params.functionDeclaration ?? c.params.expression ?? '');
    if (code.includes('function hideFixedAds')) return 'fixed';
    return code.includes('function hideFixedBars') ? 'bars' : code.includes('function showHidden') ? 'show' : null;
  };
  assert.deepEqual(cdp.sent.map(step).filter(Boolean), [
    'bars', 'capture', 'show', 'bars', 'fixed', 'capture', 'show', 'bars', 'fixed', 'capture', 'show', 'bars', 'fixed', 'capture', 'show',
  ]);
  assert.ok(cdp.sent.filter((c) => step(c) === 'fixed').every((c) => JSON.stringify(c.params.arguments) === '[{"objectId":"obj-12"}]'));
});

test('an ad gate shows in the first screenshot that has it and is hidden from the later ones, as a fixed ad is', async () => {
  // Vozpópuli: membrana's blurring panel is sticky, not fixed, and stays on screen down the article.
  const { cdp, run } = setup({ pageHeight: 3000, ads: [
    { id: 30, sticky: true, fixed: false, viewportTop: 386, height: 75, width: 300, gate: true, layer: 'gate', layerArea: 320 * 823 },
  ] }, { config: { ...DEFAULTS, dismissAfterSamples: 1000 } });
  await run();
  const hides = cdp.sent.filter((c) => String(c.params?.functionDeclaration ?? '').includes('function hideFixedAds'));
  assert.ok(hides.length > 0);
  assert.ok(hides.every((c) => JSON.stringify(c.params.arguments) === '[{"objectId":"obj-30"}]'));
});

test('a piece of an ad gate that shows up after the gate\'s first screenshot is not placed in the later ones, where its layer is hidden', async () => {
  // Diario de Navarra: membrana's card holds several ads; the larger one loads after the first screenshot that
  // had the gate, and the gate's layer is hidden from the later screenshots, so it is drawn on the first.
  const gate = { sticky: true, fixed: false, width: 300, gate: true, layer: 'gate', layerArea: 320 * 823 };
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 30, viewportTop: 386, height: 75, ...gate },
    { id: 31, viewportTop: 260, height: 200, appearsAt: 6, ...gate },
  ] }, { config: { ...DEFAULTS, dismissAfterSamples: 1000 } });
  const result = await run();
  const popUp = result.betterAds.ads.find((a) => a.kind === 'interstitial');
  assert.equal(popUp.tile, 0);
});

test('a rail ad a sticky box holds on screen shows in the first screenshot that has it and is hidden from the later ones', async () => {
  // CBS desktop: the right rail's 300 x 600 ad stays at 440 px from the top down the article; it came out in every
  // screenshot, as many times as the page has screens.
  const { cdp, run } = setup({ pageHeight: 3000, ads: [
    { id: 40, sticky: true, fixed: false, stuck: true, overlay: false, overContent: false, bottomHit: false, layer: null, viewportTop: 300, height: 250, width: 300 },
  ] });
  const result = await run();
  const hides = cdp.sent.filter((c) => String(c.params?.functionDeclaration ?? '').includes('function hideFixedAds'));
  assert.ok(hides.length > 0);
  assert.ok(hides.every((c) => JSON.stringify(c.params.arguments) === '[{"objectId":"obj-40"}]'));
  assert.equal(result.betterAds.ads.find((a) => a.id === '40').tile, 0);
});

test('a video player floating in a corner while it shows the site\'s video shows in one screenshot, even with its ad pieces under its controls', async () => {
  // The US Sun desktop: the article's Brightcove player floats at the bottom right (div#video_…, position: fixed,
  // 375 x 262) down the whole article; the pieces Chrome tags in it (Google IMA's) lie under the player's
  // controls, so none was ever on top, and the player came out in every screenshot.
  const { cdp, run } = setup({ pageHeight: 3000, ads: [
    { id: 50, sticky: true, viewportTop: 500, height: 262, width: 375, shown: false, overContent: false, player: 'content', playerKey: 'p1' },
  ] });
  await run();
  const hides = cdp.sent.filter((c) => String(c.params?.functionDeclaration ?? '').includes('function hideFixedAds'));
  assert.ok(hides.length > 0);
  assert.ok(hides.every((c) => JSON.stringify(c.params.arguments) === '[{"objectId":"obj-50"}]'));
});

test('a fixed layer on screen in a screenshot is hidden from the later ones even when none of its ads is on top or visible', async () => {
  // The US Sun: during an ad, the floating player's IMA pieces are hidden by CSS and under its controls; the
  // player came out in three screenshots before it showed the site's video.
  const { cdp, run } = setup({ pageHeight: 3000, ads: [
    { id: 52, sticky: true, viewportTop: 500, height: 208, width: 367, shown: false, overContent: false, player: 'ad', playerKey: 'p1', layer: 'float', layerOnScreen: true },
  ] });
  await run();
  const hides = cdp.sent.filter((c) => String(c.params?.functionDeclaration ?? '').includes('function hideFixedAds'));
  assert.ok(hides.length > 0);
  assert.ok(hides.every((c) => JSON.stringify(c.params.arguments) === '[{"objectId":"obj-52"}]'));
});

test('a fixed layer shown in a screenshot is hidden from the later ones even when the ads in it are new ones', async () => {
  // The US Sun: the floating player's IMA pieces are made again for each ad it plays; the player is the same layer.
  // The new pieces come with the ad the player plays, never on top of its controls.
  const piece = { sticky: true, viewportTop: 500, height: 262, width: 375, shown: false, overContent: false, playerKey: 'p1', layer: 'float' };
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 50, goneAt: 4, player: 'content', ...piece }, { id: 51, appearsAt: 4, player: 'ad', ...piece }] });
  await run();
  const hides = cdp.sent.filter((c) => String(c.params?.functionDeclaration ?? '').includes('function hideFixedAds'));
  assert.ok(hides.some((c) => JSON.stringify(c.params.arguments) === '[{"objectId":"obj-51"}]'), JSON.stringify(hides.map((c) => c.params.arguments)));
});

test('a fixed ad hidden from a screenshot is not placed in it, even when it grew there', async () => {
  // Taller from the sixth sample on (the third screenshot), when it is already hidden.
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 12, sticky: true, viewportTop: 723, height: 100, tallerFrom: { tick: 6, height: 150 } }] });
  const result = await run();
  const ad = result.betterAds.ads.find((a) => a.id === '12');
  assert.equal(ad.tile, 0);
  assert.equal(ad.height, 100);
});

// The test's steps around the screenshots, and the closing of an interstitial.
const captureOrDismiss = (c) => {
  if (c.method === 'Page.captureScreenshot') return 'capture';
  return c.method === 'Runtime.callFunctionOn' && c.params.functionDeclaration?.includes('function dismissOverlay') ? 'dismiss' : null;
};

test('an interstitial is closed like a reader would, once, after three samples and a screenshot that holds it; Better Ads still judges it', async () => {
  // Full screen and fixed from the fifth sample on (the second screenshot, a screen down).
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 20, sticky: true, viewportTop: 0, height: 823, appearsAt: 4 }] });
  const result = await run();
  assert.deepEqual(cdp.dismissed, ['obj-20']);
  // Seen in the fifth, sixth and seventh samples: closed in the seventh, after its screenshot.
  assert.deepEqual(cdp.sent.map(captureOrDismiss).filter(Boolean), ['capture', 'capture', 'capture', 'dismiss', 'capture']);
  const dismissal = cdp.sent.find((c) => captureOrDismiss(c) === 'dismiss');
  assert.deepEqual(dismissal.params.arguments, [{ objectId: 'obj-20' }]);
  // Chrome's figures see the page under it once closed.
  const densities = result.samples.map((s) => s.density);
  assert.deepEqual(densities.slice(4, 7), [100, 100, 100]);
  assert.ok(densities.slice(7).every((d) => d < 100), `after closing: ${densities.slice(7)}`);
  assert.deepEqual(result.betterAds.interstitial, { found: true, pass: false, share: 100 });
  const pop = result.betterAds.ads.find((a) => a.id === '20');
  assert.deepEqual([pop.kind, pop.counted, pop.reason, pop.tile], ['interstitial', false, 'interstitial', 1]);
  assert.equal(result.betterAds.density.value, 8.3); // the inline ad only: 250 of 3000
});

test('an interstitial seen before the first screenshot stays until that screenshot holds it', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 20, sticky: true, viewportTop: 0, height: 823 }] });
  const result = await run();
  assert.deepEqual(cdp.dismissed, ['obj-20']);
  assert.deepEqual(cdp.sent.map(captureOrDismiss).filter(Boolean).slice(0, 3), ['capture', 'dismiss', 'capture']);
  assert.equal(result.betterAds.ads.find((a) => a.id === '20').tile, 0);
});

test('an interstitial that appears on a screen already captured is closed after three samples all the same', async () => {
  // A page that fits the screen: one screenshot, at the top, then samples at the bottom.
  const { cdp, run } = setup({ pageHeight: 800, ads: [{ id: 20, sticky: true, viewportTop: 0, height: 823, appearsAt: 4 }] }, { config: { ...DEFAULTS, extraSamplesAtBottom: 5 } });
  const result = await run();
  assert.deepEqual(cdp.dismissed, ['obj-20']);
  assert.deepEqual(cdp.sent.map(captureOrDismiss).filter(Boolean), ['capture', 'dismiss']);
  assert.deepEqual(result.samples.map((s) => s.density), [0, 0, 0, 0, 100, 100, 100, 0, 0]);
  assert.equal(result.betterAds.interstitial.found, true);
});

test('a close that fails leaves the interstitial as it is and the test goes on', async () => {
  // Seen from the sixth sample on: closed in the eighth, a sample that also scrolls.
  const page = { pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 20, sticky: true, viewportTop: 0, height: 823, appearsAt: 5 }] };
  const closed = await setup(page).run();
  const { cdp, run } = setup({ ...page, failDismiss: true });
  const result = await run();
  assert.equal(cdp.sent.filter((c) => captureOrDismiss(c) === 'dismiss').length, 1); // tried once
  assert.deepEqual(cdp.dismissed, []);
  assert.equal(scrolls(cdp), 3);
  assert.equal(result.samples.length, closed.samples.length); // the sample went on and scrolled
  assert.ok(result.samples.slice(5).every((s) => s.density >= 100)); // still there
  assert.equal(result.betterAds.interstitial.found, true);
});

test('a full-screen fixed ad that does not lie over the content (an interscroller) is never closed', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 20, sticky: true, viewportTop: 0, height: 823, overContent: false }] });
  const result = await run();
  assert.deepEqual(cdp.dismissed, []);
  assert.equal(result.betterAds.interstitial.found, false);
});

test('an interscroller the bottom centre\'s hit test never lands on is no large sticky ad', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 20, sticky: true, viewportTop: 0, height: 823, overContent: false, bottomHit: false }] });
  const result = await run();
  assert.deepEqual(result.betterAds.largeSticky, { value: 0, limit: 30, pass: true, found: false });
});

test('a fixed ad the page\'s content scrolls over after it was seen is an interscroller', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 20, sticky: true, viewportTop: 0, height: 823, overContent: false, behindFrom: 6 }] });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '20').kind, 'interscroller');
});

test('a fixed ad seen as a wallpaper is a skin', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 20, sticky: true, viewportTop: 0, height: 823, overContent: false, wallpaper: true, behindFrom: 6 }] });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '20').kind, 'skin');
});

test('the strips of a pop-up, in its own layer, are part of it: no large sticky ad, nothing in the density', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 20, sticky: true, viewportTop: 0, height: 823, layer: 'bwin' },
    { id: 21, sticky: true, viewportTop: 524, height: 299, overContent: false, layer: 'bwin' },
  ] });
  const result = await run();
  assert.equal(result.betterAds.interstitial.found, true);
  assert.deepEqual(result.betterAds.largeSticky, { value: 0, limit: 30, pass: true, found: false });
  assert.equal(result.betterAds.density.value, 0);
});

test('an ad gate is a pop-up: its ads are recorded with the gate and the share of the screen it blurs, and closed like one', async () => {
  // Diario de Navarra's card: a 300 × 75 ad and membrana's text in a layer blurring 320 × 823 of the screen.
  const { cdp, run } = setup({ pageHeight: 3000, ads: [
    { id: 30, sticky: true, viewportTop: 386, height: 75, width: 300, gate: true, layer: 'gate', layerArea: 320 * 823 },
    { id: 31, sticky: true, viewportTop: 260, height: 33, width: 300, gate: true, layer: 'gate', layerArea: 320 * 823 },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.interstitial, { found: true, pass: false, share: 78, gate: true });
  assert.deepEqual(cdp.dismissed, ['obj-30']);
  assert.equal(result.betterAds.density.value, 0);
});

test('a video player is recorded with what it showed and its key: the site\'s own player is not counted', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 40, pageTop: 300, height: 230, video: true, player: 'content', playerKey: 'p1' },
    { id: 41, pageTop: 1200, height: 230, video: true, player: 'ad', playerKey: 'p2' },
  ] });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '40').reason, 'content-video');
  assert.equal(result.betterAds.ads.find((a) => a.id === '41').counted, true);
});

test('a fixed anchor ad is never closed', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 12, sticky: true, viewportTop: 723, height: 100 }] });
  const result = await run();
  assert.deepEqual(cdp.dismissed, []);
  assert.equal(result.betterAds.interstitial.found, false);
});

test('flags a page whose load event never fires and still measures it', async () => {
  const { run } = setup({ loadFires: false });
  const result = await run();
  assert.equal(result.loadEventReached, false);
  assert.ok(result.samples.length > 0);
});

test('reports attach failures and leaves the tab alone', async () => {
  const { run, reloads } = setup({ failAttach: 'Cannot access a chrome:// URL' });
  await assert.rejects(run(), { message: "Can't test this tab: Cannot access a chrome:// URL" });
  assert.equal(reloads(), 0);
});

test('cancelling mid-test rejects, detaches and leaves the tab as it is', async () => {
  const controller = new AbortController();
  let ticks = 0;
  const { cdp, run, reloads } = setup({}, {
    signal: controller.signal,
    onProgress: () => {
      ticks += 1;
      if (ticks === 3) controller.abort('cancelled');
    },
  });
  await assert.rejects(run(), { message: 'Test cancelled.', code: 'cancelled' });
  assert.equal(cdp.detached, true);
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('cancelling while a command hangs detaches and leaves the tab as it is', async () => {
  const controller = new AbortController();
  const { cdp, run, reloads } = setup({ hangOn: 'DOM.getDocument' }, { signal: controller.signal });
  setTimeout(() => controller.abort('cancelled'), 20);
  await assert.rejects(run(), { code: 'cancelled' });
  assert.equal(cdp.detached, true);
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('cancelling while Chrome turns off the page\'s input still turns it back on, then detaches', async () => {
  const controller = new AbortController();
  const { cdp, run } = setup({ hangOn: 'Input.setIgnoreInputEvents' }, { signal: controller.signal });
  setTimeout(() => controller.abort('cancelled'), 20);
  await assert.rejects(run(), { code: 'cancelled' });
  assert.ok(cdp.sent.some((c) => c.method === 'Input.setIgnoreInputEvents' && c.params.ignore === false));
  assert.equal(cdp.detached, true);
});

test('a command that never answers ends the test with an error and leaves the tab as it is', async () => {
  const { cdp, run, reloads } = setup({ hangOn: 'DOM.getDocument' }, { config: { ...DEFAULTS, commandTimeoutMs: 20 } });
  await assert.rejects(run(), { message: /stopped responding/ });
  assert.equal(cdp.detached, true);
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('Cancel on the debugging bar while the test sets up reports a cancelled test', async () => {
  // Chrome fails the pending command first, then says why it detached.
  const controller = new AbortController();
  const { run, reloads } = setup(
    { detachOn: 'Emulation.setDeviceMetricsOverride', afterDetach: () => controller.abort('cancelled') },
    { signal: controller.signal },
  );
  await assert.rejects(run(), { message: 'Test cancelled.', code: 'cancelled' });
  assert.equal(reloads(), 0);
});

test('a closed tab while the test sets up reports the tab-closed code', async () => {
  const controller = new AbortController();
  const { run } = setup(
    { detachOn: 'Page.reload', afterDetach: () => controller.abort('tab-closed') },
    { signal: controller.signal },
  );
  await assert.rejects(run(), { code: 'tab-closed' });
});

test('a detach Chrome gives no reason for still ends the test with its error', async () => {
  const { run } = setup({ detachOn: 'Page.enable' }, { config: { ...DEFAULTS, detachGraceMs: 20 } });
  await assert.rejects(run(), { message: 'Detached while handling command.' });
});

test('a page that goes to another address mid-test stops the test and says where it went', async () => {
  const { run, reloads } = setup({
    events: [{ atTick: 4, method: 'Page.frameNavigated', params: { frame: { id: 'main', url: 'https://news.example/other' } } }],
  });
  await assert.rejects(run(), { code: 'navigated', message: /https:\/\/news\.example\/other/ });
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('an auto-redirect to another site ends the test with what it measured and names where it went, hosts only', async () => {
  // El Independiente, 2026-10-04: an ad's script clicked a link it made, through webtransit.live to a fake
  // McAfee alert whose address carried the reader's city.
  const { run } = setup({
    events: [
      { atTick: 4, method: 'Page.frameRequestedNavigation', params: { frameId: 'main', reason: 'anchorClick', disposition: 'currentTab', url: 'https://webtransit.live/visit.php?pub=news.example' } },
      { atTick: 4, method: 'Page.frameNavigated', params: { frame: { id: 'main', url: 'https://safedevice.click/avs/es/mob/mcafee-2.php?city=Springfield' } } },
    ],
  });
  const result = await run();
  assert.equal(result.stoppedAt, 'redirect');
  assert.equal(result.redirect.to, 'safedevice.click');
  assert.equal(result.redirect.via, 'webtransit.live');
  assert.equal(typeof result.redirect.atMs, 'number');
  assert.ok(!JSON.stringify(result.redirect).includes('Springfield'));
  assert.ok(result.samples.length > 0);
  assert.equal(typeof result.betterAds.density.value, 'number');
});

test('sameSite: the registrable domain, also under a two-part suffix', () => {
  assert.equal(sameSite('https://www.news.example/a', 'https://amp.news.example/b'), true);
  assert.equal(sameSite('https://www.independent.co.uk/', 'https://www.mirror.co.uk/'), false);
  assert.equal(sameSite('https://www.independent.co.uk/', 'https://subs.independent.co.uk/'), true);
  assert.equal(sameSite('https://elindependiente.com/', 'https://safedevice.click/'), false);
});

test('a reload that ends on Chrome\'s network error page stops the test instead of measuring it', async () => {
  const { run, reloads } = setup({
    commitFrame: { id: 'main', url: 'chrome-error://chromewebdata/', unreachableUrl: 'https://news.example/' },
  });
  await assert.rejects(run(), { code: 'load-failed', message: /didn't load/ });
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('a page that reloads itself mid-test says so rather than naming its own address', async () => {
  const { run } = setup({
    events: [{ atTick: 4, method: 'Page.frameNavigated', params: { frame: { id: 'main', url: 'https://news.example/#top' } } }],
  });
  await assert.rejects(run(), { code: 'navigated', message: 'The page reloaded itself during the test, so the test stopped.' });
});

test('an ad frame navigating or the page changing only its query or fragment does not stop the test', async () => {
  const { cdp, run } = setup({
    events: [
      { atTick: 2, method: 'Page.frameNavigated', params: { frame: { id: 'ad', parentId: 'main', url: 'https://ads.example/x' } } },
      { atTick: 3, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/?page=2' } },
      { atTick: 4, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/#comments' } },
    ],
  });
  const result = await run();
  assert.equal(scrolls(cdp), 3); // to the bottom of the 3000 px page, as without those events
  assert.equal(result.stoppedAt, null);
});

test('on an article page the test stops once the screen has passed the end of the article', async () => {
  const { cdp, run } = setup({ pageHeight: 6000, content: { begin: 0, articleEnd: 2000 } });
  const result = await run();
  assert.equal(result.stoppedAt, 'article-end');
  assert.equal(scrolls(cdp), 2); // 0 → 823 → 1646: the screen then reaches 2469, past 2000
  assert.equal(result.samples.length, 9); // and two more samples there, as at the bottom of a page
  assert.deepEqual(result.snapshot.tiles.map((t) => t.pageTop), [0, 823, 1646]);
});

test('an article that grew after its end was measured is followed to its new end', async () => {
  // Measured at the top, the end is at 2000 px, 100 px below the last paragraph; by the time the screen
  // gets there, images and ads above have made the article 600 px longer.
  const { cdp, run } = setup({ pageHeight: 6000, content: { begin: 0, articleEnd: 2000 }, articleGrowth: { gap: 100, endNow: 2600 } });
  const result = await run();
  assert.equal(result.stoppedAt, 'article-end');
  assert.equal(scrolls(cdp), 3); // one more than without the growth: 1646 + 823 = 2469 is short of 2600
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 2600 });
});

test('finding the article\'s end again, the probe gets the ads too (a slot filled late)', async () => {
  const content = (scrollY) => ({ begin: 0, articleEnd: scrollY === 0 ? 2000 : 2100 });
  const { cdp, run } = setup({ pageHeight: 9000, content, articleGrowth: { gap: 100, endNow: 2100 }, ads: [{ id: 11, pageTop: 1000, height: 250 }] });
  await run();
  assert.deepEqual(cdp.endNowCalls.at(-1), [100, 2100]);
  assert.deepEqual(cdp.endNowAds.at(-1), ['obj-11']);
});

test('the content probe gets the ads, not the page tagged as one (a skin)', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 13, pageTop: 0, height: 3000, page: true }] });
  await run();
  assert.deepEqual(cdp.contentAds.at(-1), ['obj-11']);
});

test('the article\'s end is found again with the end measured in the same sample', async () => {
  // 20minutos: at the top the article ends at 2000 px; recommendations that load later push the block
  // that ended it down, and measured again the article ends at 2100 px.
  const content = (scrollY) => ({ begin: 0, articleEnd: scrollY === 0 ? 2000 : 2100 });
  const { cdp, run } = setup({ pageHeight: 9000, content, articleGrowth: { gap: 100, endNow: 2100 } });
  await run();
  assert.ok(cdp.endNowCalls.length > 0);
  assert.deepEqual(cdp.endNowCalls.at(-1), [100, 2100]);
});

test('a page that stops scrolling before its bottom (a paywall holding it) ends the test there, counting only what was seen', async () => {
  // 6000 px tall, but the page won't scroll past 823: the ad at 3000 px was never on screen.
  const { cdp, run } = setup({ pageHeight: 6000, stuckAt: 823, ads: [{ id: 11, pageTop: 500, height: 250 }, { id: 12, pageTop: 3000, height: 250 }] });
  const result = await run();
  assert.equal(result.stoppedAt, 'stuck');
  assert.equal(scrolls(cdp), 4); // one that worked, then three tries that didn't
  assert.ok(result.samples.length < 20, `${result.samples.length} samples`); // not the whole minute
  assert.equal(result.snapshot.pageHeight, 1646);
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 1646 });
  assert.equal(result.betterAds.density.value, 15.2); // 250 / 1646
});

test('a page too long for the minute is measured as far as the test got, not over its whole height', async () => {
  // 60 000 px: the last position sampled in the minute is 23 044 px (the screen's bottom at 23 867).
  const { run } = setup({ pageHeight: 60000, ads: [{ id: 11, pageTop: 500, height: 250 }, { id: 12, pageTop: 50000, height: 250 }] });
  const result = await run();
  assert.equal(result.stoppedAt, 'time');
  assert.equal(result.snapshot.pageHeight, 23867);
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 23867 });
  assert.equal(result.betterAds.density.value, 1); // 250 / 23 867; the ad at 50 000 px was never seen
});

test('the test stops when the page moves on to the next article (its path changes in place)', async () => {
  const { run } = setup({
    pageHeight: 6000,
    content: { begin: 0, articleEnd: 4000 },
    events: [{ atTick: 5, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/next-story' } }],
  });
  const result = await run();
  assert.equal(result.stoppedAt, 'next-article');
  assert.equal(result.samples.length, 6); // the sample that saw the change is the last one
});

test('a path change before the test scrolls (the page tidying its address) becomes the page\'s own path', async () => {
  const { run } = setup({
    pageHeight: 6000,
    content: { begin: 0, articleEnd: 2000 },
    commitFrame: { id: 'main', url: 'https://news.example/story' },
    events: [
      { atTick: 1, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/story/' } },
      { atTick: 5, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/story/?read=50' } },
    ],
  });
  const result = await run();
  assert.equal(result.stoppedAt, 'article-end'); // as without the changes: the screen passed the article's end
  assert.equal(result.samples.length, 9);
});

test('on a page that is not an article, a path change (a list loading /page/2/) does not stop the test', async () => {
  const { cdp, run } = setup({
    pageHeight: 3000,
    events: [{ atTick: 5, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/page/2/' } }],
  });
  const result = await run();
  assert.equal(result.stoppedAt, null);
  assert.equal(scrolls(cdp), 3); // to the bottom, as without the change
});

test('a test stopped before the end of the article counts only the part of the page it saw', async () => {
  // It moves on at the second screen (screen bottom at 1646 px), before the article's end at 4000 px:
  // the ad at 3000 px was never on screen.
  const { run } = setup({
    pageHeight: 6000,
    ads: [{ id: 11, pageTop: 500, height: 250 }, { id: 12, pageTop: 3000, height: 250 }],
    content: { begin: 0, articleEnd: 4000 },
    events: [{ atTick: 4, method: 'Page.navigatedWithinDocument', params: { frameId: 'main', url: 'https://news.example/next-story' } }],
  });
  const result = await run();
  assert.equal(result.stoppedAt, 'next-article');
  assert.deepEqual(result.betterAds.content, { begin: 0, end: 1646 });
  assert.equal(result.betterAds.density.value, 15.2); // 250 / 1646, not 500 / 4000
  assert.equal(result.snapshot.pageHeight, 1646);
});

test('a test whose tab stayed hidden throughout is an error, not a 0 % pass', async () => {
  const hiddenTicks = Array.from({ length: 400 }, (_, i) => i);
  const { run } = setup({ hiddenTicks });
  await assert.rejects(run(), { message: 'The tab was hidden for the whole test. Keep it visible and run again.' });
});

test('a test that could not take a single sample is an error', async () => {
  const { run } = setup({ failEveryState: true });
  await assert.rejects(run(), { message: "Couldn't measure this page." });
});

test('sampling starts only once the reloaded main frame has committed', async () => {
  const { cdp, run } = setup({ holdCommit: true });
  const running = run();
  await new Promise((resolve) => setImmediate(resolve));
  const commitWait = cdp.waits.find((w) => w.method === 'Page.frameNavigated');
  assert.equal(commitWait.predicate({ frame: { id: 'child', parentId: 'main' } }), false);
  assert.equal(commitWait.predicate({ frame: { id: 'main' } }), true);
  const sampled = () => cdp.sent.some((c) => c.method === 'Runtime.evaluate' && c.params.expression === PAGE_STATE_EXPR);
  assert.equal(sampled(), false);
  cdp.commit();
  await running;
  assert.ok(sampled());
});

test('cancelling while the reload commits ends the test at once', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const { cdp, run, reloads } = setup({ holdCommit: true }, { signal: controller.signal });
  setTimeout(() => controller.abort('cancelled'), 20);
  await assert.rejects(run(), { code: 'cancelled' });
  assert.equal(cdp.detached, true);
  assert.equal(reloads(), 0); // the tab is left as the test leaves it: no reload at the end
});

test('a closed tab ends the test with the tab-closed code', async () => {
  const controller = new AbortController();
  const { run } = setup({}, { signal: controller.signal, onProgress: () => controller.abort('tab-closed') });
  await assert.rejects(run(), { code: 'tab-closed' });
});

const ADS_RULES = compileRules(['||ads.example^', '||sun.example/integrations/']);
const script = (url, initiator = {}) => ({ atTick: 0, method: 'Network.requestWillBeSent', params: { request: { url }, type: 'Script', initiator } });

test('counts an ad an EasyList script made that Chrome did not tag, with why; Chrome\'s figures leave it out', async () => {
  const { run } = setup({
    pageHeight: 3000,
    events: [script('https://ads.example/loader.js')],
    ads: [{ id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: 'https://ads.example/loader.js' }],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  const ad = result.betterAds.ads.find((a) => a.id === '21');
  assert.equal(ad.source, 'easylist');
  assert.equal(ad.why, 'EasyList ||ads.example^');
  assert.ok(result.betterAds.density.value > 0);
  assert.equal(result.chrome.avgDensity, 0);
});

test('a script loaded by an ad script inherits its rule (SunMedia\'s SDK)', async () => {
  const { run } = setup({
    pageHeight: 3000,
    events: [
      script('https://sun.example/integrations/a.js'),
      script('https://sun.example/sdks/intext.js', { type: 'script', stack: { callFrames: [{ url: 'https://sun.example/integrations/a.js' }] } }),
    ],
    ads: [{ id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: 'https://sun.example/sdks/intext.js' }],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '21').why, 'EasyList ||sun.example/integrations/ via intext.js');
});

test('asks Chrome who made each element once, at most the budget of new nodes per sample', async () => {
  const ads = Array.from({ length: 5 }, (_, i) => ({ id: 30 + i, pageTop: 300 * i, height: 250, source: 'easylist', createdBy: 'https://ads.example/x.js' }));
  const perSample = [];
  let cdpRef;
  const { cdp, run } = setup({ pageHeight: 3000, events: [script('https://ads.example/x.js')], ads }, { adRules: () => ADS_RULES, config: { ...DEFAULTS, stackBudget: 2 }, onProgress: () => perSample.push(cdpRef.stackCalls) });
  cdpRef = cdp;
  const result = await run();
  assert.equal(cdp.stackCalls, 6); // 5 ads + the page furniture node, each once
  const deltas = perSample.map((n, i) => n - (perSample[i - 1] ?? 0));
  assert.ok(deltas.every((d) => d <= 2), `per-sample asks ${deltas}`);
  assert.ok(deltas.filter((d) => d > 0).length >= 3, 'the remainder is picked up by later samples');
  assert.equal(result.betterAds.ads.filter((a) => a.source === 'easylist').length, 5);
});

test('an element an ad script made that is the page itself does not count', async () => {
  const { run } = setup({ pageHeight: 3000, events: [script('https://ads.example/x.js')], ads: [{ id: 40, pageTop: 0, height: 3000, page: true, source: 'easylist', createdBy: 'https://ads.example/x.js' }] }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.equal(result.betterAds.ads.length, 0);
  assert.equal(result.chrome.pageTagged, false); // only Chrome's own tag says the page is tagged
});

test('an element an ad script made around an ad Chrome tagged stays Chrome\'s', async () => {
  const { cdp, run } = setup({
    pageHeight: 3000,
    events: [script('https://ads.example/gpt.js')],
    ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: 'https://ads.example/gpt.js', wraps: 11 }],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
  assert.equal(cdp.stackCalls, 1); // only the page furniture node is asked about
});

test('an element an ad script made is ignored while it shows nothing', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    pageHeight: 3000,
    events: [script(gpt)],
    ads: [
      { id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: gpt, empty: true }, // Seedtag's empty div
      { id: 22, pageTop: 1600, height: 250, source: 'easylist', createdBy: gpt, emptyUntil: 4 }, // filled in later
    ],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['22', 'easylist']]);
});

test('Chrome\'s ads are kept whatever the empty check says', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250, empty: true }] }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
});

test('an element an ad script made, resolved before it held a Chrome ad, leaves no trace (GPT\'s container)', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    pageHeight: 3000,
    events: [script(gpt)],
    ads: [
      { id: 11, pageTop: 1000, height: 600 },
      { id: 21, pageTop: 1000, height: 100, source: 'easylist', createdBy: gpt, wraps: 11, wrapsFrom: 3 },
    ],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
});

test('an inner element of an ad script, resolved before its wrapper, loses its observations to the wrapper', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    pageHeight: 3000,
    events: [script(gpt)],
    ads: [
      { id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: gpt, appearsAt: 3 },
      { id: 22, pageTop: 1000, height: 250, source: 'easylist', createdBy: gpt, inside: 21 },
    ],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => a.id), ['21']);
});

test('an inner element superseded by its wrapper counts again once the wrapper grows into a frame', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    ...DESKTOP_PAGE,
    events: [script(gpt)],
    ads: [
      { id: 22, pageTop: 1000, height: 250, width: 300, source: 'easylist', createdBy: gpt, inside: 21 },
      { id: 21, pageTop: 1000, height: 600, width: 1335, source: 'easylist', createdBy: gpt, appearsAt: 2, tallerFrom: { tick: 4, height: 9000 } },
    ],
  }, { adRules: () => ADS_RULES, device: 'desktop' });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => a.id), ['22']);
});

test('an ad script\'s ad that disappeared from the page keeps its observations', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    pageHeight: 3000,
    events: [script(gpt)],
    vanishingAds: [],
    ads: [{ id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: gpt }],
    dropAbove: { atScrollY: 800, px: 1200 },
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => a.id), ['21']);
});

test('something above the ads shrinking while the page is still at the top is no content dropped above the screen (Fanpage)', async () => {
  // A 3600 px placeholder collapsing at load: the ads move up a few screens, scrollY stays at 0. Nothing was
  // above the screen to drop, so the ads are where the page now has them.
  const { run } = setup({
    pageHeight: 9000,
    collapseAbove: { atTick: 2, px: 3600 },
    ads: [{ id: 51, pageTop: 5000, height: 250 }, { id: 52, pageTop: 5600, height: 250 }],
  });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '51').top, 1400);
  assert.ok(result.samples.every((s) => s.pageTop == null || s.pageTop <= 5400 - 823)); // never past the shrunk page's last screen
});

test('turns on the network and node stack traces before the reload, and stack traces off at the end', async () => {
  const { cdp, run } = setup({ pageHeight: 3000 }, { adRules: () => ADS_RULES });
  await run();
  const at = (method, params) => cdp.sent.findIndex((c) => c.method === method && (!params || JSON.stringify(c.params) === JSON.stringify(params)));
  assert.ok(at('Network.enable') >= 0 && at('Network.enable') < at('Page.reload'));
  assert.ok(at('DOM.setNodeStackTracesEnabled', { enable: true }) < at('Page.reload'));
  assert.ok(at('DOM.setNodeStackTracesEnabled', { enable: false }) > at('Page.reload'));
});

test('a failed stack lookup is not remembered: the node is asked again on a later sample', async () => {
  const { run } = setup({
    pageHeight: 3000,
    events: [script('https://ads.example/x.js')],
    ads: [{ id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: 'https://ads.example/x.js' }],
    failStackOnce: [21],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '21')?.source, 'easylist');
});

test('switches the stack traces and the network off again after a normal run', async () => {
  const { cdp, run } = setup({ pageHeight: 3000 }, { adRules: () => ADS_RULES });
  await run();
  assert.ok(cdp.sent.some((c) => c.method === 'DOM.setNodeStackTracesEnabled' && c.params.enable === false));
  assert.ok(cdp.sent.some((c) => c.method === 'Network.disable'));
});

test('switches them off when the test fails between the enables and the reload', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, detachOn: 'Page.reload' }, { adRules: () => ADS_RULES });
  await assert.rejects(run());
  assert.ok(cdp.sent.some((c) => c.method === 'DOM.setNodeStackTracesEnabled' && c.params.enable === false));
  assert.ok(cdp.sent.some((c) => c.method === 'Network.disable'));
});

test('asks for the rules of the page\'s language and host, before the reload', async () => {
  const calls = [];
  const { cdp, run } = setup({ lang: 'es-ES', commitFrame: { id: 'main', url: 'https://www.farodevigo.es/a' } }, { adRules: (lang, host) => { calls.push([lang, host]); return compileRules([]); } });
  await run();
  assert.deepEqual(calls, [['es-ES', 'www.farodevigo.es']]);
  const reads = cdp.sent.findIndex((c) => c.method === 'Runtime.evaluate' && c.params.expression === PAGE_INFO_EXPR);
  assert.ok(reads >= 0 && reads < indexOf(cdp, 'Page.reload'));
});

test('the reason names the list the rule comes from', async () => {
  const rules = compileRules(['||ads.example^']);
  rules.listOf = new Map([['||ads.example^', 'EasyList Spanish']]);
  const { run } = setup({
    pageHeight: 3000,
    events: [script('https://ads.example/loader.js')],
    ads: [{ id: 21, pageTop: 1000, height: 250, source: 'easylist', createdBy: 'https://ads.example/loader.js' }],
  }, { adRules: () => rules });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '21').why, 'EasyList Spanish ||ads.example^');
});

const DESKTOP_PAGE = { pageHeight: 12000, viewportWidth: 1350, viewportHeight: 940 };

test('a page-sized layer an ad script made is not one ad; its banner is counted on its own', async () => {
  const wms = 'https://ads.example/skin.js';
  const { run } = setup({
    ...DESKTOP_PAGE,
    events: [script(wms)],
    ads: [
      { id: 21, pageTop: 0, height: 9000, width: 1335, source: 'easylist', createdBy: wms },
      { id: 22, pageTop: 0, height: 250, source: 'easylist', createdBy: wms, inside: 21 },
    ],
  }, { adRules: () => ADS_RULES, device: 'desktop' });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['22', 'easylist']]);
});

test('an element of an ad script that grew into a frame stops being an ad, at every sample', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    ...DESKTOP_PAGE,
    events: [script(gpt)],
    ads: [{ id: 21, pageTop: 1000, height: 600, width: 1335, source: 'easylist', createdBy: gpt, tallerFrom: { tick: 3, height: 9000 } }],
  }, { adRules: () => ADS_RULES, device: 'desktop' });
  const result = await run();
  assert.deepEqual(result.betterAds.ads, []);
});

test('Chrome\'s items with frame-sized boxes are untouched', async () => {
  const { run } = setup({ ...DESKTOP_PAGE, ads: [{ id: 11, pageTop: 1000, height: 9000 }] }, { device: 'desktop' });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
});

test('counts a labelled box Chrome and the lists missed, after both, with why', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 50, pageTop: 1000, height: 300, source: 'label', labelReason: 'labelled "Publicidad" · empty slot' }] }, { adRules: () => ADS_RULES });
  const result = await run();
  const ad = result.betterAds.ads.find((a) => a.id === '50');
  assert.equal(ad.source, 'label');
  assert.equal(ad.why, 'labelled "Publicidad" · empty slot');
  assert.ok(result.betterAds.density.value > 0);
  assert.equal(result.chrome.avgDensity, 0);
});

test('the result has a Chrome view: the Better Ads verdict on Chrome\'s tags only, same main content', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 11, pageTop: 1000, height: 250 },
    { id: 50, pageTop: 2000, height: 300, source: 'label', labelReason: 'labelled "Publicidad" · empty slot' },
  ] }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => a.source).sort(), ['chrome', 'label']);
  assert.deepEqual(result.chromeView.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
  assert.ok(result.chromeView.betterAds.density.value < result.betterAds.density.value);
  assert.deepEqual(result.chromeView.betterAds.content, result.betterAds.content);
  assert.equal(result.chromeView.betterAds.contentDetected, result.betterAds.contentDetected);
});

test('the labels probe gets the ads found before it (an ad found by Chrome inside a labelled box counts once, as Chrome\'s)', async () => {
  const { cdp, run } = setup({
    pageHeight: 3000,
    events: [script('https://ads.example/x.js')],
    ads: [{ id: 11, pageTop: 1000, height: 250 }, { id: 21, pageTop: 2000, height: 250, source: 'easylist', createdBy: 'https://ads.example/x.js' }],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.ok(cdp.labelArgs.some((args) => args.includes('obj-11') && args.includes('obj-21')));
  assert.equal(result.betterAds.ads.filter((a) => a.source === 'label').length, 0);
});

test('an empty labelled slot still counts, and a labelled box that is a page-sized frame does not', async () => {
  const { run } = setup({ pageHeight: 6000, ads: [
    { id: 50, pageTop: 1000, height: 300, empty: true, source: 'label', labelReason: 'labelled "Publicidad"' },
    { id: 51, pageTop: 0, height: 4000, source: 'label', labelReason: 'labelled "Advertisement"' },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['50', 'label']]);
});

test('a labelled box empty in the first samples, then holding a Chrome ad, counts as that ad, not as the box', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 50, pageTop: 1000, height: 318, empty: true, source: 'label', labelReason: 'labelled "Publicidad" · empty slot', heldFrom: 3 },
    { id: 11, pageTop: 1030, height: 250, appearsAt: 3 },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
});

test('covered is about the page, so both views share it: only label ads, all hidden, no Chrome tag', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 50, pageTop: 1000, height: 300, behindFrom: 0, source: 'label', labelReason: 'labelled "Publicidad"' }] }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.equal(result.betterAds.covered, true);
  assert.equal(result.chromeView.betterAds.covered, true);
});

test('a Chrome tag hidden while a label ad is shown: neither view is covered', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 11, pageTop: 1000, height: 250, behindFrom: 0 },
    { id: 50, pageTop: 2000, height: 300, source: 'label', labelReason: 'labelled "Publicidad"' },
  ] }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.equal(result.betterAds.covered, false);
  assert.equal(result.chromeView.betterAds.covered, false);
});

const EMPTY_SLOT = 'labelled "Publicidad" · empty slot';

test('an empty labelled slot the probe stops returning (collapsed or hidden) no longer counts', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 50, pageTop: 1000, height: 600, empty: true, source: 'label', labelReason: EMPTY_SLOT, labelUntil: 3 },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => a.id), []);
});

test('an empty labelled slot returned by the probe again later counts', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 50, pageTop: 1000, height: 600, empty: true, source: 'label', labelReason: EMPTY_SLOT, labelUntil: 3, labelAgainAt: 6 },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['50', 'label']]);
});

test('a labelled box that held something keeps counting when the probe stops returning it', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [
    { id: 50, pageTop: 1000, height: 300, source: 'label', labelReason: 'labelled "Publicidad"', labelUntil: 3 },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['50', 'label']]);
});

test('a vanished empty labelled slot leaves Chrome and EasyList ads untouched', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({ pageHeight: 3000, events: [script(gpt)], ads: [
    { id: 11, pageTop: 1000, height: 250 },
    { id: 21, pageTop: 2000, height: 250, source: 'easylist', createdBy: gpt },
    { id: 50, pageTop: 1500, height: 600, empty: true, source: 'label', labelReason: EMPTY_SLOT, labelUntil: 3 },
  ] }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome'], ['21', 'easylist']]);
});

test('each labelled box keeps its own reason, read from the box, whatever order the DOM lists them in', async () => {
  const { run } = setup({ pageHeight: 3000, labelsReversed: true, ads: [
    { id: 50, pageTop: 600, height: 300, source: 'label', labelReason: 'labelled "Publicidad" · empty slot' },
    { id: 51, pageTop: 1600, height: 300, source: 'label', labelReason: 'labelled "Anuncio"' },
  ] });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.why]), [['50', 'labelled "Publicidad" · empty slot'], ['51', 'labelled "Anuncio"']]);
});

test('an element an ad script made, superseded for holding a Chrome ad, stays superseded once it is seen empty', async () => {
  // GPT's container showed a placeholder, then held Chrome's ad, then was emptied (the slot cleared).
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    pageHeight: 3000,
    events: [script(gpt)],
    ads: [
      { id: 11, pageTop: 1025, height: 250 },
      { id: 21, pageTop: 1000, height: 300, source: 'easylist', createdBy: gpt, wraps: 11, wrapsFrom: 3, wrapsUntil: 6, emptyFrom: 6 },
    ],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome']]);
});

test('an ad script\'s creative beside a Chrome ad, in a wrapper superseded for holding that ad, counts on its own', async () => {
  const gpt = 'https://ads.example/gpt.js';
  const { run } = setup({
    pageHeight: 3000,
    events: [script(gpt)],
    ads: [
      { id: 11, pageTop: 1000, height: 250 },
      { id: 21, pageTop: 1000, height: 600, source: 'easylist', createdBy: gpt, wraps: 11, wrapsFrom: 3 },
      { id: 22, pageTop: 1300, height: 250, source: 'easylist', createdBy: gpt, inside: 21 },
    ],
  }, { adRules: () => ADS_RULES });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['11', 'chrome'], ['22', 'easylist']]);
});

test('an element an ad script made that holds the page\'s content is not one ad, however narrow; its banner counts on its own', async () => {
  // A skin's centred wrapper around the article (800 px of 1350: no frame); Chrome's items are untouched.
  const wms = 'https://ads.example/skin.js';
  const { run } = setup({
    ...DESKTOP_PAGE,
    events: [script(wms)],
    ads: [
      { id: 21, pageTop: 0, height: 6000, width: 800, source: 'easylist', createdBy: wms, holdsContent: true },
      { id: 22, pageTop: 1000, height: 250, width: 300, source: 'easylist', createdBy: wms, inside: 21 },
      { id: 11, pageTop: 7000, height: 250, holdsContent: true },
    ],
  }, { adRules: () => ADS_RULES, device: 'desktop' });
  const result = await run();
  assert.deepEqual(result.betterAds.ads.map((a) => [a.id, a.source]), [['22', 'easylist'], ['11', 'chrome']]);
});

test('once the page has loaded, the test moves the mouse once like a reader (some sites serve ads only then), without clicking or scrolling', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 11, pageTop: 1000, height: 250 }] });
  await run();
  const moves = cdp.sent.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.equal(moves.length, 2);
  assert.ok(moves.every((c) => c.params.type === 'mouseMoved' && c.params.x <= 4));
  const first = cdp.sent.indexOf(moves[0]);
  assert.equal(cdp.sent[first - 1].method, 'Input.setIgnoreInputEvents');
  assert.equal(cdp.sent[first - 1].params.ignore, false);
  const after = cdp.sent.indexOf(moves[1]) + 1;
  assert.equal(cdp.sent[after].method, 'Input.setIgnoreInputEvents');
  assert.equal(cdp.sent[after].params.ignore, true);
  assert.ok(indexOf(cdp, 'Page.reload') < first);
  const firstScroll = cdp.sent.findIndex((c) => c.method === 'Runtime.evaluate' && c.params.expression === SCROLL_EXPR);
  assert.ok(firstScroll === -1 || first < firstScroll);
});

test('an ad frame Chrome tagged inside an iframe the page wrote counts as that iframe (El Independiente\'s fallback sticky ad)', async () => {
  const { cdp, run } = setup({ pageHeight: 3000, ads: [{ id: 61, pageTop: 1000, height: 100, inFrame: true }] });
  const result = await run();
  assert.ok(cdp.sent.some((c) => c.method === 'DOM.getDocument' && c.params.pierce === true));
  const ad = result.betterAds.ads.find((a) => a.id === '61');
  assert.equal(ad?.source, 'chrome');
  assert.equal(ad.counted, true);
});

test('a tagged image inside an iframe the page wrote doesn\'t make the iframe an ad (Chrome counts ad frames)', async () => {
  const { run } = setup({ pageHeight: 3000, ads: [{ id: 62, pageTop: 1000, height: 100, inFrame: true, inFrameTag: 'IMG' }] });
  const result = await run();
  assert.equal(result.betterAds.ads.find((a) => a.id === '62'), undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER, MAX_CANVAS, comparisonSize, drawComparison, drawSnapshot, exportSize, withImages, headerHeight, legendLayout, pruneSnapshots, px, snapshotFilename, snapshotLayout, snapshotSummary, stripSize, wrapText } from '../lib/snapshot.js';

const ad = (id, top, height, extra = {}) =>
  ({ id, top, height, x: 0, width: 412, kind: 'inline', counted: true, countedHeight: height, reason: null, share: null, ...extra });
const tile = (pageTop) => ({ pageTop, image: `img-${pageTop}` });

test('px groups thousands with a space', () => {
  assert.equal(px(85), '85');
  assert.equal(px(15480), '15 480');
  assert.equal(px(1234567.4), '1 234 567');
});

test('snapshotLayout places screens, gaps, the main content and one mark per ad', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 3000, tiles: [tile(0), tile(800), tile(2000)] },
    betterAds: {
      content: { begin: 100, end: 2500 },
      contentDetected: true,
      ads: [
        ad('a', 300, 250),
        ad('s', 700, 100, { kind: 'sticky', share: 12 }),
        ad('side', 1000, 90, { x: -50, width: 300 }), // partly beside the screen
        ad('h', 1200, 250, { x: 206, width: 206, counted: false, countedHeight: 0, reason: 'hidden' }),
        ad('o', 2600, 300, { counted: false, countedHeight: 0, reason: 'outside' }), // runs past the last screen
        ad('far', 2900, 250, { counted: false, countedHeight: 0, reason: 'outside' }), // below the last screen
      ],
    },
  });
  assert.deepEqual(plan, {
    view: 'real',
    width: 412,
    tileHeight: 800,
    height: 2800,
    pageHeight: 3000,
    tiles: [{ y: 0, index: 0 }, { y: 800, index: 1 }, { y: 2000, index: 2 }],
    gaps: [{ top: 1600, bottom: 2000 }],
    dims: [{ top: 0, bottom: 100 }, { top: 2500, bottom: 2800 }],
    cuts: [{ y: 100, label: 'main content starts · 100 px' }, { y: 2500, label: 'main content ends · 2 500 px' }],
    marks: [
      { x: 0, y: 300, w: 412, h: 250, style: 'counted', label: 'ad · 250 px', tile: null },
      { x: 0, y: 700, w: 412, h: 100, style: 'sticky', label: 'sticky · 12% of screen', tile: null },
      { x: 0, y: 1000, w: 250, h: 90, style: 'counted', label: 'ad · 90 px', tile: null },
      { x: 206, y: 1200, w: 206, h: 250, style: 'not-counted', label: 'not counted · behind content', tile: null },
      { x: 0, y: 2600, w: 412, h: 200, style: 'not-counted', label: 'not counted · outside main content', tile: null },
    ],
    note: 'captured 0–2 800 of 3 000 px',
  });
});

test('snapshotLayout sorts screens, lets the later one win where they overlap, and needs no note at the bottom', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(1646), tile(0), tile(823), tile(2177)] },
    betterAds: { content: { begin: 0, end: 3000 }, contentDetected: false, ads: [] },
  });
  assert.deepEqual(plan.tiles, [{ y: 0, index: 1 }, { y: 823, index: 2 }, { y: 1646, index: 0 }, { y: 2177, index: 3 }]);
  assert.deepEqual(plan.gaps, []);
  assert.equal(plan.height, 3000);
  assert.equal(plan.note, null);
});

test('snapshotLayout draws no cuts or dimming when the main content was not found', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 3000 }, contentDetected: false, ads: [ad('skin', 0, 500, { kind: 'skin', width: 150, counted: true, countedHeight: 500, share: 22 }), ad('hid', 100, 90, { counted: false, countedHeight: 0, reason: 'hidden' })] },
  });
  assert.deepEqual(plan.dims, []);
  assert.deepEqual(plan.cuts, []);
  assert.deepEqual(plan.marks.map((m) => m.label), ['sticky skin · 500 px', 'not counted · behind content']);
});

const RESULT = {
  url: 'https://www.lasexta.com/',
  device: 'desktop',
  testedAt: '2026-10-02T09:44:00.000Z',
  samples: new Array(46).fill({}),
  chrome: { avgDensity: 7.6 },
  betterAds: {
    contentDetected: true,
    density: { value: 11, limit: 50, pass: true },
    largeSticky: { value: 5, limit: 30, pass: true, found: true },
    interstitial: { found: false, pass: true, share: null },
  },
  snapshot: { viewport: { width: 1350, height: 940 } },
};
const NO_POP_UP = { found: false, pass: true, share: null };

test('snapshotSummary has the URL, device, time, samples and the four figures', () => {
  assert.deepEqual(snapshotSummary(RESULT, { timeZone: 'UTC' }), {
    title: 'natzir.com · Ad Density Checker',
    url: 'https://www.lasexta.com/',
    meta: 'Desktop 1350 × 940 · 2 Oct 2026, 09:44 · 46 samples',
    notes: ['Real view'],
    figures: [
      { value: '11% ✓', state: 'pass', label: 'Better Ads ≤50%' },
      { value: '5% ✓', state: 'pass', label: 'Large sticky ≤30%' },
      { value: 'none ✓', state: 'pass', label: 'Interstitial' },
      { value: '8%', state: 'info', label: 'Avg viewport' },
    ],
  });
});

test('the export header fails the interstitial figure with the share of the screen it covered', () => {
  const summary = snapshotSummary({ ...RESULT, betterAds: { ...RESULT.betterAds, interstitial: { found: true, pass: false, share: 100 } } });
  assert.deepEqual(summary.figures[2], { value: '100% ✕', state: 'fail', label: 'Interstitial' });
});

test('snapshotSummary marks failures, no sticky ad and a page without main content', () => {
  const summary = snapshotSummary({
    ...RESULT,
    device: 'mobile',
    snapshot: { viewport: { width: 412, height: 823 } },
    betterAds: { contentDetected: false, density: { value: 35.3, limit: 30, pass: false }, largeSticky: { value: 0, limit: 30, pass: true, found: false }, interstitial: NO_POP_UP },
  }, { timeZone: 'UTC' });
  assert.equal(summary.meta, 'Mobile 412 × 823 · 2 Oct 2026, 09:44 · 46 samples');
  assert.deepEqual(summary.notes, ['Real view', 'whole page used']);
  assert.deepEqual(summary.figures.slice(0, 2), [
    { value: '35.3% ✕', state: 'fail', label: 'Better Ads ≤30%' },
    { value: 'none ✓', state: 'pass', label: 'Large sticky ≤30%' },
  ]);
});

test('snapshotFilename names the host, device and local time', () => {
  const testedAt = new Date(2026, 9, 2, 11, 44).toISOString();
  assert.equal(snapshotFilename({ url: 'https://www.lasexta.com/deportes/', device: 'desktop', testedAt }), 'ad-density-www.lasexta.com-desktop-20261002-1144.jpg');
});

test('the export header names its view and takes that view\'s figures', () => {
  const chrome = { ...RESULT.betterAds, density: { value: 4, limit: 50, pass: true } };
  const withView = { ...RESULT, chromeView: { betterAds: chrome } };
  assert.deepEqual(snapshotSummary(withView, { timeZone: 'UTC' }).notes, ['Real view']);
  const summary = snapshotSummary(withView, { timeZone: 'UTC', view: 'chrome' });
  assert.deepEqual(summary.notes, ['Chrome view']);
  assert.deepEqual(summary.figures[0], { value: '4% ✓', state: 'pass', label: 'Better Ads ≤50%' });
});

test('the file name says which image it is', () => {
  const test = { url: 'https://www.lasexta.com/x', device: 'mobile', testedAt: '2026-10-04T10:05:00' };
  assert.equal(snapshotFilename(test), 'ad-density-www.lasexta.com-mobile-20261004-1005.jpg');
  assert.equal(snapshotFilename(test, '-chrome'), 'ad-density-www.lasexta.com-mobile-20261004-1005-chrome.jpg');
  assert.equal(snapshotFilename(test, '-chrome-vs-real'), 'ad-density-www.lasexta.com-mobile-20261004-1005-chrome-vs-real.jpg');
});

test('the header has one legend row on desktop and two or more on mobile', () => {
  assert.equal(headerHeight(1350), HEADER.dark + 30); // one row: dark + pad + 1 row * 22
  const mobileHeight = headerHeight(412);
  assert.ok(mobileHeight > HEADER.dark + 52, `expected > ${HEADER.dark + 52}, got ${mobileHeight}`); // more than 2 rows at 412px
  assert.equal(mobileHeight, HEADER.dark + HEADER.legendPad + legendLayout(412).rows * HEADER.legendRow);
});

test('the legend layout fits all items at widths 412, 700, 900 and 1350, with each item starting a row or ending within the width', () => {
  const widths = [412, 700, 900, 1350];
  for (const width of widths) {
    const layout = legendLayout(width);
    const pad = 16;
    const seenStyles = new Set();
    for (const item of layout.items) {
      // Every item either starts a row or ends within the width
      assert.ok(item.x === pad || item.x + item.width <= width - pad, `at ${width}px: item ${item.style} at ${item.x} width ${item.width} exceeds ${width - pad}`);
      seenStyles.add(item.style);
    }
    // Every LEGEND entry appears exactly once
    assert.equal(seenStyles.size, layout.items.length, `at ${width}px: items not unique`);
  }
});

test('exportSize draws 1:1 and scales down only past Chrome\'s canvas limit', () => {
  assert.deepEqual(exportSize({ width: 1350, height: 28200 }), { width: 1350, height: 28374, scale: 1 });
  const total = 40000 + headerHeight(412); // 40 218 px with the header (three legend rows at 412 px)
  const tall = exportSize({ width: 412, height: 40000 });
  assert.equal(tall.height, MAX_CANVAS);
  assert.equal(tall.width, Math.round(412 * (MAX_CANVAS / total)));
  assert.equal(tall.scale, MAX_CANVAS / total);
});

test('stripSize fits the panel width in device pixels, within the canvas limit', () => {
  assert.deepEqual(stripSize({ width: 1350, height: 28200 }, 280, 2), { width: 560, height: 11698, scale: 560 / 1350 });
  const mobile = stripSize({ width: 412, height: 24700 }, 280, 2); // 560 px wide would be 33 573 px high
  assert.deepEqual(mobile, { width: 547, height: MAX_CANVAS, scale: MAX_CANVAS / 24700 });
});

test('pruneSnapshots keeps the images of the most recent outcomes only', () => {
  const outcomes = new Map();
  for (let i = 1; i <= 7; i++) outcomes.set(`tab${i}`, { url: 'u', test: { snapshot: { tiles: [] }, n: i }, error: '' });
  outcomes.set('failed', { url: 'u', test: null, error: 'Test cancelled.' });
  pruneSnapshots(outcomes, 5);
  const kept = [...outcomes.values()].map((o) => (o.test ? Boolean(o.test.snapshot) : null));
  assert.deepEqual(kept, [false, false, true, true, true, true, true, null]);
  assert.deepEqual(outcomes.get('tab1').test, { snapshot: null, snapshotDropped: true, n: 1 });
});

// A 2D context that records every call and property set; text is 6 px per character.
function recorder() {
  const calls = [];
  const target = { calls, measureText: (text) => ({ width: text.length * 6 }) };
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : (...args) => calls.push([prop, ...args])),
    set: (t, prop, value) => { calls.push(['set', prop, value]); return true; },
  });
}
const PLAN = snapshotLayout({
  snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 3000, tiles: [tile(0), tile(800), tile(2000)] },
  betterAds: { content: { begin: 100, end: 2500 }, contentDetected: true, ads: [ad('a', 300, 250)] },
});
const IMAGES = ['img0', 'img1', 'img2'];

test('drawSnapshot draws each screen at its page position, below the header when there is one', () => {
  const ctx = recorder();
  drawSnapshot(ctx, PLAN, IMAGES, { summary: snapshotSummary({ ...RESULT, snapshot: { viewport: { width: 412, height: 800 } } }), logo: 'logo' });
  assert.ok(ctx.calls.some((c) => c[0] === 'translate' && c[1] === 0 && c[2] === headerHeight(412)));
  assert.deepEqual(ctx.calls.filter((c) => c[0] === 'drawImage' && IMAGES.includes(c[1])), [
    ['drawImage', 'img0', 0, 0, 412, 800],
    ['drawImage', 'img1', 0, 800, 412, 800],
    ['drawImage', 'img2', 0, 2000, 412, 800],
    ['drawImage', 'img0', 0, 0, 412, 800], // drawn again, unveiled, inside the counted ad's box
  ]);
  assert.ok(ctx.calls.some((c) => c[0] === 'drawImage' && c[1] === 'logo'));
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'ad · 250 px'));
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'main content ends · 2 500 px'));
});

test('the panel strip draws the marks without any text, scaled', () => {
  const ctx = recorder();
  drawSnapshot(ctx, PLAN, IMAGES, { scale: 0.5, labels: false });
  assert.deepEqual(ctx.calls.find((c) => c[0] === 'scale'), ['scale', 0.5, 0.5]);
  assert.equal(ctx.calls.filter((c) => c[0] === 'fillText').length, 0);
  assert.ok(ctx.calls.some((c) => c[0] === 'strokeRect'));
});

test('a screen whose image did not load is left as a blank band', () => {
  const ctx = recorder();
  drawSnapshot(ctx, PLAN, ['img0', null, 'img2'], { labels: false });
  assert.deepEqual(ctx.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]), ['img0', 'img2', 'img0']);
});

test('the page is veiled and counted ads are drawn again unveiled; ads not counted stay veiled', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 3000, tiles: [tile(0), tile(800), tile(2000)] },
    betterAds: { content: { begin: 0, end: 3000 }, contentDetected: false, ads: [ad('a', 300, 250), ad('h', 900, 100, { counted: false, countedHeight: 0, reason: 'hidden' })] },
  });
  const ctx = recorder();
  drawSnapshot(ctx, plan, IMAGES, { labels: false });
  const veil = ctx.calls.findIndex((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === 'rgba(255, 255, 255, 0.55)');
  assert.ok(veil > 0);
  assert.deepEqual(ctx.calls[veil + 1], ['fillRect', 0, 0, 412, 2800]);
  const after = ctx.calls.slice(veil);
  assert.deepEqual(after.filter((c) => c[0] === 'rect'), [['rect', 0, 300, 412, 250]]);
  assert.deepEqual(after.filter((c) => c[0] === 'drawImage').map((c) => c[1]), ['img0']);
});

test('a long label wraps inside its box and never runs past the image\'s edge, every character kept', () => {
  const why = 'EasyList ||static.sunmedia.tv/integrations/$third-party,domain=farodevigo.es';
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 800, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 800 }, contentDetected: true, ads: [
      ad('wide', 100, 300, { x: 56, width: 300, source: 'easylist', why }),
      ad('narrow', 500, 34, { x: 370, width: 34, source: 'easylist', why }),
    ] },
  });
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['a']);
  const texts = ctx.calls.filter((c) => c[0] === 'fillText' && c[3] >= 100 && c[3] < 800);
  const wide = texts.filter((c) => c[3] < 500);
  assert.ok(wide.length > 1);
  assert.equal(wide.map((c) => c[1]).join(''), plan.marks[0].label);
  for (const [, text, x] of wide) assert.ok(x >= 60 && x + text.length * 6 <= 56 + 300, `${text} fits the box`);
  const narrow = texts.filter((c) => c[3] >= 500);
  assert.equal(narrow.map((c) => c[1]).join(''), plan.marks[1].label);
  for (const [, text, x] of narrow) assert.ok(x >= 0 && x + text.length * 6 <= 412, `${text} stays in the image`);
});

// The label boxes drawn: white boxes, as tag() fills them.
const labelBoxes = (ctx) => {
  const boxes = [];
  let white = false;
  for (const c of ctx.calls) {
    if (c[0] === 'set' && c[1] === 'fillStyle') white = c[2] === 'rgba(255, 255, 255, 0.92)';
    else if (c[0] === 'fillRect' && white) boxes.push(c.slice(1));
  }
  return boxes;
};

test('labels of marks that meet are stacked, so none covers another', () => {
  // CBS desktop: Infolinks' sticky band and the creative Chrome tags in it, both labelled at the same corner.
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 800, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 800 }, contentDetected: true, ads: [
      ad('band', 300, 56, { x: 20, width: 380, source: 'easylist', why: 'EasyList ||infolinks.com^$third-party' }),
      ad('creative', 296, 50, { x: 24, width: 370 }),
    ] },
  });
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['a']);
  const boxes = labelBoxes(ctx);
  assert.equal(boxes.length, 2);
  const [[x1, y1, w1, h1], [x2, y2, w2, h2]] = boxes;
  assert.ok(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1, `labels overlap: ${JSON.stringify(boxes)}`);
});

test('labels are drawn over every mark, so a later mark doesn\'t tint an earlier label', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 800, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 800 }, contentDetected: true, ads: [ad('first', 100, 300), ad('second', 120, 200, { x: 50, width: 300 })] },
  });
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['a']);
  const lastMark = ctx.calls.findLastIndex((c) => c[0] === 'strokeRect');
  assert.ok(ctx.calls.findIndex((c) => c[0] === 'fillText' && plan.marks[0].label.startsWith(c[1])) > lastMark, 'a label drawn before the last mark');
});

test('a gap too thin for its label is left as a plain band', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(0), tile(825), tile(1648), tile(2177)] },
    betterAds: { content: { begin: 0, end: 3000 }, contentDetected: false, ads: [] },
  });
  assert.deepEqual(plan.gaps, [{ top: 823, bottom: 825 }]); // scroll anchoring moved the second screen 2 px down
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['a', 'b', 'c', 'd']);
  assert.equal(ctx.calls.filter((c) => c[0] === 'fillText' && c[1] === 'not captured').length, 0);
});

test('on a phone-wide export the header keeps every word: the notes get their own line', () => {
  const result = {
    ...RESULT,
    url: 'https://www.marca.com/',
    device: 'mobile',
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 41000, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 41000 }, contentDetected: false, ads: [], density: { value: 30.3, limit: 30, pass: false }, largeSticky: { value: 9, limit: 30, pass: true, found: true }, interstitial: NO_POP_UP },
  };
  const plan = snapshotLayout({ snapshot: result.snapshot, betterAds: result.betterAds });
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['a'], { summary: snapshotSummary(result, { timeZone: 'UTC' }) });
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('Real view · whole page used · captured 0–823 of 41 000 px'));
  assert.deepEqual(texts.filter((t) => t.endsWith('…')), []);
});

test('on a phone-wide Chrome-view export the header keeps every word too', () => {
  const betterAds = { content: { begin: 0, end: 41000 }, contentDetected: false, ads: [], density: { value: 30.3, limit: 30, pass: false }, largeSticky: { value: 9, limit: 30, pass: true, found: true }, interstitial: NO_POP_UP };
  const result = {
    ...RESULT,
    url: 'https://www.marca.com/',
    device: 'mobile',
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 41000, tiles: [tile(0)] },
    betterAds,
    chromeView: { betterAds },
  };
  const plan = snapshotLayout({ view: 'chrome', snapshot: result.snapshot, betterAds });
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['a'], { summary: snapshotSummary(result, { timeZone: 'UTC', view: 'chrome' }) });
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('Chrome view · whole page used · captured 0–823 of 41 000 px'));
  assert.deepEqual(texts.filter((t) => t.endsWith('…')), []);
});

test('a sticky ad is unveiled from the screenshot it was seen in only', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 3000, tiles: [tile(0), tile(800), tile(1600)] },
    betterAds: { content: { begin: 0, end: 3000 }, contentDetected: false, ads: [ad('s', 780, 60, { kind: 'sticky', share: 7, tile: 0 })] },
  });
  assert.equal(plan.marks[0].tile, 0);
  const ctx = recorder();
  drawSnapshot(ctx, plan, IMAGES, { labels: false });
  const veil = ctx.calls.findIndex((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === 'rgba(255, 255, 255, 0.55)');
  assert.deepEqual(ctx.calls.slice(veil).filter((c) => c[0] === 'drawImage').map((c) => c[1]), ['img0']); // not img1, which also overlaps
});

test('withImages frees every decoded screen after drawing, also when drawing fails', async () => {
  const closed = [];
  const decode = async (src) => {
    if (src === 'bad') throw new Error('decode');
    return { src, close: () => closed.push(src) };
  };
  const seen = await withImages([{ image: 'a' }, { image: 'bad' }, { image: 'b' }], decode, (images) => images.map((i) => i?.src ?? null));
  assert.deepEqual(seen, ['a', null, 'b']);
  assert.deepEqual(closed, ['a', 'b']);
  closed.length = 0;
  await assert.rejects(withImages([{ image: 'a' }], decode, () => { throw new Error('draw'); }), /draw/);
  assert.deepEqual(closed, ['a']);
});

test('sticky ads that do not count are not drawn; a skin is, as the sticky ad it is', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(0), tile(823), tile(1646), tile(2177)] },
    betterAds: {
      content: { begin: 0, end: 3000 },
      contentDetected: false,
      ads: [
        ad('skin', 0, 500, { kind: 'skin', width: 150, counted: true, countedHeight: 500, share: 22 }),
        ad('frame', 2900, 90, { kind: 'sticky', counted: false, countedHeight: 0, reason: 'hidden' }), // the frame around a counted anchor
        ad('inner', 750, 60, { kind: 'sticky', counted: false, countedHeight: 0, reason: 'nested' }),
      ],
    },
  });
  assert.deepEqual(plan.marks.map((m) => [m.label, m.style]), [['sticky skin · 500 px', 'sticky']]);
});

test('an ad nested in another is not drawn: the ad around it is', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(0)] },
    betterAds: {
      content: { begin: 0, end: 3000 },
      contentDetected: false,
      ads: [ad('outer', 100, 250), ad('inner', 100, 250, { counted: false, countedHeight: 0, reason: 'nested' })],
    },
  });
  assert.deepEqual(plan.marks.map((m) => m.label), ['ad · 250 px']);
});

test('counted and sticky ads get a darker layer in their border colour, over the unveiled ad', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 3000, tiles: [tile(0), tile(800), tile(1600)] },
    betterAds: { content: { begin: 0, end: 3000 }, contentDetected: false, ads: [ad('a', 300, 250), ad('s', 1700, 90, { kind: 'sticky', share: 5, tile: 2 })] },
  });
  const ctx = recorder();
  drawSnapshot(ctx, plan, IMAGES, { labels: false });
  const layer = (x, y, w, h, colour) => {
    const i = ctx.calls.findIndex((c) => c[0] === 'fillRect' && c[1] === x && c[2] === y && c[3] === w && c[4] === h);
    assert.ok(i > 0, `no layer at ${y}`);
    assert.deepEqual(ctx.calls.slice(i - 2, i), [['set', 'globalCompositeOperation', 'multiply'], ['set', 'fillStyle', colour]]);
  };
  layer(0, 300, 412, 250, 'rgba(245, 158, 11, 0.35)');
  layer(0, 1700, 412, 90, 'rgba(168, 85, 247, 0.35)');
});

test('the snapshot is as wide as the page: no density column', () => {
  assert.equal(PLAN.track, undefined);
  assert.equal(exportSize(PLAN).width, PLAN.width);
});

test('the export header says where a test stopped before the bottom of the page', () => {
  assert.deepEqual(snapshotSummary({ ...RESULT, stoppedAt: 'article-end' }).notes, ['Real view', 'stopped at the end of the article']);
  assert.deepEqual(snapshotSummary({ ...RESULT, stoppedAt: 'next-article' }).notes, ['Real view', 'infinite scroll: stopped before the next article']);
  assert.deepEqual(snapshotSummary({ ...RESULT, stoppedAt: 'stuck' }).notes, ['Real view', 'stopped where the page stopped scrolling']);
  assert.deepEqual(snapshotSummary({ ...RESULT, stoppedAt: 'time' }).notes, ['Real view', 'the minute ran out before the bottom']);
  assert.deepEqual(snapshotSummary({ ...RESULT, stoppedAt: 'redirect', redirect: { to: 'safedevice.click', via: 'webtransit.live', atMs: 32800 } }).notes,
    ['Real view', 'auto-redirect to safedevice.click: stopped there']);
  assert.deepEqual(snapshotSummary({ ...RESULT, betterAds: { ...RESULT.betterAds, covered: true } }).notes, ['Real view', 'no ad could be seen: a dialog may have covered the page']);
});

test('the export header says not measured, not a pass, when no ad could be seen', () => {
  const covered = snapshotSummary({ ...RESULT, betterAds: { ...RESULT.betterAds, covered: true } });
  assert.deepEqual(covered.figures.slice(0, 3), [
    { value: 'not measured', state: 'info', label: 'Better Ads ≤50%' },
    { value: 'not measured', state: 'info', label: 'Large sticky ≤30%' },
    { value: 'not measured', state: 'info', label: 'Interstitial' },
  ]);
});

// A 2D context whose text is 0.65 of its font size a character, an upper bound of system-ui's
// uppercase (the legend's 6.5 px a character at 11 px is 0.59): records each text drawn, its x and font.
const CHAR = 0.65;
const sizeOf = (font) => Number(font.match(/(\d+)px/)[1]);
function fontRecorder() {
  const texts = [];
  let font = '10px sans-serif';
  const target = {
    texts,
    measureText: (text) => ({ width: text.length * CHAR * sizeOf(font) }),
    fillText: (text, x) => texts.push({ text, x, font }),
  };
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : () => {}),
    set: (t, prop, value) => { if (prop === 'font') font = value; return true; },
  });
}

// The export header of a phone test drawn with fontRecorder: each figure's value and label as drawn.
function phoneHeader(betterAds, avgDensity = 8) {
  const result = { ...RESULT, device: 'mobile', chrome: { avgDensity }, betterAds: { ...RESULT.betterAds, ...betterAds, ads: [], content: { begin: 0, end: 823 } }, snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 823, tiles: [tile(0)] } };
  const ctx = fontRecorder();
  drawSnapshot(ctx, snapshotLayout(result), ['a'], { summary: snapshotSummary(result, { timeZone: 'UTC' }) });
  const values = ctx.texts.filter((t) => t.font.startsWith('700'));
  const labels = ctx.texts.filter((t) => t.font.startsWith('10px'));
  return snapshotSummary(result).figures.map((figure, i) => ({ figure, value: values[i], label: labels[i] }));
}
// Every value whole; each value and label ends before the next column starts, the last one before the
// right padding.
function assertColumns(drawn) {
  assert.deepEqual(drawn.map((d) => d.value.text), drawn.map((d) => d.figure.value));
  drawn.forEach(({ figure, value, label }, i) => {
    assert.ok(label.text === figure.label.toUpperCase() || label.text.endsWith('…'), label.text);
    const end = drawn[i + 1]?.value.x ?? 412 - 16;
    for (const t of [value, label]) assert.ok(t.x + t.text.length * CHAR * sizeOf(t.font) <= end + 0.01, `${t.text} ends past ${end}`);
  });
}

test('on a phone-wide export the values keep their size when they fit; labels are cut within their column, none past the padding', () => {
  const drawn = phoneHeader({ density: { value: 28.3, limit: 30, pass: false }, largeSticky: { value: 0, limit: 30, pass: true, found: false }, interstitial: { found: false, pass: true, share: null } }, 88);
  assert.deepEqual(drawn.map((d) => [d.value.text, sizeOf(d.value.font)]), [['28.3% ✕', 20], ['none ✓', 20], ['none ✓', 20], ['88%', 20]]);
  assertColumns(drawn);
});

test('on a phone-wide export the values shrink only when they themselves do not fit the row', () => {
  const failing = phoneHeader({ density: { value: 100, over: true, limit: 30, pass: false }, largeSticky: { value: 100, limit: 30, pass: false, found: true }, interstitial: { found: true, pass: false, share: 100 } });
  assert.ok(failing.every((d) => sizeOf(d.value.font) === 20));
  assertColumns(failing);
  const covered = phoneHeader({ covered: true }); // three "not measured"
  const size = sizeOf(covered[0].value.font);
  assert.ok(size >= 12 && size < 20, `${size}px`);
  assertColumns(covered);
});

test('the export header shows a density over 100 % as 100 %+', () => {
  const over = snapshotSummary({ ...RESULT, betterAds: { ...RESULT.betterAds, density: { value: 100, over: true, limit: 50, pass: false } } });
  assert.equal(over.figures[0].value, '100%+ ✕');
});

test('an interstitial is drawn once, where a screenshot holds it, as a sticky ad with its share of the screen', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(0), tile(823)] },
    betterAds: { contentDetected: false, ads: [
      ad('pop', 823, 823, { kind: 'interstitial', counted: false, countedHeight: 0, reason: 'interstitial', share: 100, tile: 1, source: 'chrome', why: null }),
      ad('list', 0, 600, { kind: 'interstitial', counted: false, countedHeight: 0, reason: 'interstitial', share: 73, tile: 0, source: 'easylist', why: 'EasyList ||pop.example^' }),
    ] },
  });
  assert.deepEqual(plan.marks.map((m) => [m.style, m.label, m.tile]), [
    ['sticky', 'interstitial · 100% of screen', 1],
    ['unseen', 'interstitial · 73% of screen · not seen by Chrome · EasyList ||pop.example^', 0],
  ]);
  const gated = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [tile(0), tile(823)] },
    betterAds: { contentDetected: false, ads: [ad('card', 1200, 75, { kind: 'interstitial', counted: false, countedHeight: 0, reason: 'interstitial', share: 78, gate: true, tile: 1, source: 'chrome', why: null })] },
  });
  assert.equal(gated.marks[0].label, 'ad gate · 78% of screen');
});

test('an ad Chrome does not detect is drawn pink with its reason after the kind', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [{ pageTop: 0 }] },
    betterAds: { contentDetected: false, ads: [
      { id: '1', top: 100, height: 250, x: 0, width: 300, kind: 'inline', counted: true, countedHeight: 250, source: 'easylist', why: 'EasyList ||static.sunmedia.tv/integrations/ via intext.js' },
      { id: '2', top: 500, height: 250, x: 0, width: 300, kind: 'inline', counted: true, countedHeight: 250, source: 'chrome', why: null },
    ] },
  });
  assert.deepEqual(plan.marks.map((m) => [m.style, m.label]), [
    ['unseen', 'ad · 250 px · not seen by Chrome · EasyList ||static.sunmedia.tv/integrations/ via intext.js'],
    ['counted', 'ad · 250 px'],
  ]);
});

test('an interscroller is labelled as one, with its height, in the sticky style', () => {
  const plan = snapshotLayout({
    snapshot: { viewport: { width: 412, height: 823 }, pageHeight: 3000, tiles: [{ pageTop: 0 }, { pageTop: 823 }] },
    betterAds: { contentDetected: false, ads: [{ id: 'i', top: 823, height: 823, x: 0, width: 412, kind: 'interscroller', counted: true, countedHeight: 823, reason: null, share: 100, tile: 1, source: 'chrome', why: null }] },
  });
  assert.deepEqual(plan.marks.map((m) => [m.label, m.style]), [['interscroller · 823 px', 'sticky']]);
});

test('the Chrome view draws Chrome\'s tags only: counted ones as usual, the others blue with why', () => {
  const plan = snapshotLayout({
    view: 'chrome',
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 3000, tiles: [tile(0), tile(800), tile(2000)] },
    betterAds: { content: { begin: 100, end: 2500 }, contentDetected: true, ads: [
      ad('a', 300, 250, { source: 'chrome' }),
      ad('s', 700, 100, { kind: 'sticky', share: 12, source: 'chrome' }),
      ad('h', 1200, 250, { counted: false, countedHeight: 0, reason: 'hidden', source: 'chrome' }),
      ad('o', 2600, 300, { counted: false, countedHeight: 0, reason: 'outside', source: 'chrome' }),
      ad('n', 320, 100, { counted: false, countedHeight: 0, reason: 'nested', source: 'chrome' }),
    ] },
  });
  assert.equal(plan.view, 'chrome');
  assert.deepEqual(plan.marks.map((m) => [m.style, m.label]), [
    ['counted', 'ad · 250 px'],
    ['sticky', 'sticky · 12% of screen'],
    ['chrome-only', 'Chrome tags it · not counted · behind content'],
    ['not-counted', 'not counted · outside main content'],
  ]);
});

test('a content video player is drawn not counted, with why, in both views', () => {
  const layout = (view) => snapshotLayout({
    view,
    snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 800, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 800 }, contentDetected: true, ads: [
      ad('p', 300, 230, { counted: false, countedHeight: 0, reason: 'content-video', source: 'chrome' }),
    ] },
  });
  assert.deepEqual(layout('real').marks.map((m) => [m.style, m.label]), [['not-counted', 'not counted · content video player']]);
  assert.deepEqual(layout('chrome').marks.map((m) => [m.style, m.label]), [['chrome-only', 'Chrome tags it · not counted · content video player']]);
});

test('the pieces of one not-counted player are drawn once: a mark inside another with the same label is left out', () => {
  // Chrome tags each piece of Connatix's player: its video, three ad slots (the same box) and IMA's frame inside.
  const layout = (view) => snapshotLayout({
    view,
    snapshot: { viewport: { width: 1350, height: 940 }, pageHeight: 940, tiles: [tile(0)] },
    betterAds: { content: { begin: 0, end: 940 }, contentDetected: true, ads: [
      ad('v', 300, 413, { x: 143, width: 734, counted: false, countedHeight: 0, reason: 'content-video', source: 'chrome' }),
      ad('s', 300, 413, { x: 143, width: 734, counted: false, countedHeight: 0, reason: 'content-video', source: 'chrome' }),
      ad('f', 427, 156, { x: 357, width: 306, counted: false, countedHeight: 0, reason: 'content-video', source: 'chrome' }),
      ad('h', 427, 156, { x: 357, width: 306, counted: false, countedHeight: 0, reason: 'hidden', source: 'chrome' }),
    ] },
  });
  assert.deepEqual(layout('chrome').marks.map((m) => [m.x, m.w, m.label]), [
    [143, 734, 'Chrome tags it · not counted · content video player'],
    [357, 306, 'Chrome tags it · not counted · behind content'],
  ]);
  assert.equal(layout('real').marks.length, 2);
});

test('a Chrome view with no Chrome tag has no marks', () => {
  const plan = snapshotLayout({ view: 'chrome', snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 800, tiles: [tile(0)] }, betterAds: { contentDetected: false, ads: [] } });
  assert.deepEqual(plan.marks, []);
});

test('each view has its legend, laid out before drawing', () => {
  assert.deepEqual(legendLayout(1350, 'chrome').items.map((i) => i.text), ['Counted ad', 'Sticky (counted once)', 'Chrome tags it, not counted', 'Not counted', 'Outside main content', 'Main content cut']);
  assert.deepEqual(legendLayout(1350).items.map((i) => i.text), legendLayout(1350, 'real').items.map((i) => i.text));
  assert.equal(headerHeight(412, 'chrome'), HEADER.dark + HEADER.legendPad + legendLayout(412, 'chrome').rows * HEADER.legendRow);
});

test('the Chrome view\'s blue marks are dashed and drawn over the veil, like not-counted ones', () => {
  const plan = snapshotLayout({ view: 'chrome', snapshot: { viewport: { width: 412, height: 800 }, pageHeight: 800, tiles: [tile(0)] },
    betterAds: { contentDetected: false, ads: [ad('h', 100, 250, { counted: false, countedHeight: 0, reason: 'hidden', source: 'chrome' })] } });
  const ctx = recorder();
  drawSnapshot(ctx, plan, ['img0']);
  const dashes = ctx.calls.filter((c) => c[0] === 'setLineDash' && c[1].length);
  assert.ok(dashes.length >= 1);
  // The stroke set just before the dash is the chrome-only blue, not just any dashed outline.
  const dashAt = ctx.calls.findIndex((c) => c[0] === 'setLineDash' && c[1].length);
  const stroke = ctx.calls.slice(0, dashAt).reverse().find((c) => c[0] === 'set' && c[1] === 'strokeStyle');
  assert.equal(stroke?.[2], '#2563eb');
  assert.equal(ctx.calls.filter((c) => c[0] === 'drawImage').length, 1); // not drawn again unveiled
});

// A page of `height` px captured screen by screen (800 px each), so the plan is that tall.
const COMPARE_PLAN = (view, height = 800) => snapshotLayout({ view,
  snapshot: { viewport: { width: 412, height: 800 }, pageHeight: height, tiles: Array.from({ length: Math.ceil(height / 800) }, (_, i) => tile(i * 800)) },
  betterAds: { contentDetected: false, ads: [ad('a', 100, 250, { source: 'chrome' })] } });

test('wrapText keeps every character of a long URL over several lines', () => {
  const ctx = recorder(); // 6 px a character
  const url = `https://news.example/${'x'.repeat(300)}`;
  const lines = wrapText(ctx, url, 200);
  assert.equal(lines.join(''), url);
  assert.ok(lines.every((l) => l.length * 6 <= 200));
  assert.deepEqual(wrapText(ctx, 'https://a.example/path/to/story', 120), ['https://a.example/', 'path/to/story']);
});

test('the Chrome vs Real image puts both views side by side under a title, within the canvas limit', () => {
  const plans = { chrome: COMPARE_PLAN('chrome'), real: COMPARE_PLAN('real') };
  const size = comparisonSize(plans, 'https://news.example/a', recorder());
  assert.equal(size.width, 412 * 2 + 16);
  assert.equal(size.height, size.title + Math.max(headerHeight(412, 'chrome'), headerHeight(412, 'real')) + plans.chrome.height);
  assert.equal(size.scale, 1);
  const tall = comparisonSize({ chrome: COMPARE_PLAN('chrome', 40000), real: COMPARE_PLAN('real', 40000) }, 'https://news.example/a', recorder());
  assert.ok(tall.scale < 1);
  assert.ok(tall.height <= MAX_CANVAS);
});

test('drawComparison draws the title, then Chrome on the left and Real on the right, each with its header', () => {
  const plans = { chrome: COMPARE_PLAN('chrome'), real: COMPARE_PLAN('real') };
  const size = comparisonSize(plans, 'https://news.example/a', recorder());
  const ctx = recorder();
  const summaries = { chrome: { ...snapshotSummary(RESULT), notes: ['Chrome view'] }, real: snapshotSummary(RESULT) };
  drawComparison(ctx, plans, ['img0'], { scale: 1, summaries, url: 'https://news.example/a', meta: 'Mobile · 4 Oct 2026' });
  const translates = ctx.calls.filter((c) => c[0] === 'translate');
  // Each column is moved to its place before drawSnapshot moves its page below its own header.
  assert.deepEqual(translates.filter((c) => c[2] === size.title), [['translate', 0, size.title], ['translate', 412 + 16, size.title]]);
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'https://news.example/a'));
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'Chrome view'));
});

test('the title band holds every line of a separator-heavy URL, and each line is drawn', () => {
  const plans = { chrome: COMPARE_PLAN('chrome'), real: COMPARE_PLAN('real') };
  const url = 'https://a.example/' + Array.from({ length: 40 }, (_, i) => `s${i}/x-y?z&w=`).join('');
  const ctx = recorder();
  const size = comparisonSize(plans, url, ctx);
  const lines = wrapText(ctx, url, 2 * 412 + 16 - 32);
  assert.equal(size.title, 16 + lines.length * 20 + 22 + 8);
  const summaries = { chrome: snapshotSummary(RESULT), real: snapshotSummary(RESULT) };
  const drawn = recorder();
  drawComparison(drawn, plans, ['img0'], { scale: 1, summaries, url, meta: 'm' });
  for (const line of lines) assert.ok(drawn.calls.some((c) => c[0] === 'fillText' && c[1] === line));
});

test('drawComparison paints the whole image first and places the columns at a reduced scale', () => {
  const plans = { chrome: COMPARE_PLAN('chrome'), real: COMPARE_PLAN('real') };
  const url = 'https://news.example/a';
  const size = comparisonSize(plans, url, recorder());
  const summaries = { chrome: snapshotSummary(RESULT), real: snapshotSummary(RESULT) };
  const full = recorder();
  drawComparison(full, plans, ['img0'], { scale: 1, summaries, url, meta: 'm' });
  const first = full.calls.find((c) => c[0] === 'fillRect');
  assert.ok(first[1] === 0 && first[2] === 0 && first[3] >= size.width && first[4] >= size.height);
  const ctx = recorder();
  drawComparison(ctx, plans, ['img0'], { scale: 0.5, summaries, url, meta: 'm' });
  const translates = ctx.calls.filter((c) => c[0] === 'translate' && c[2] === size.title * 0.5);
  assert.deepEqual(translates, [['translate', 0, size.title * 0.5], ['translate', (412 + 16) * 0.5, size.title * 0.5]]);
});

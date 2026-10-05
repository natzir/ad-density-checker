import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBetterAds, isSticky } from '../lib/better-ads.js';

const MOBILE = { width: 412, height: 823 }; // area 339 076
// An ad that scrolls with the page.
const inline = (id, scrollY, pageTop, height, extra = {}) =>
  ({ id, scrollY, pageTop, viewportTop: pageTop - scrollY, height, x: 0, width: 412, visibleArea: 412 * height, shown: true, nested: false, video: false, ...extra });
// An ad fixed to the viewport; bottomHit: the hit test at the bottom centre of the screen lands on it
// when it is there (nothing covers it).
const sticky = (id, scrollY, viewportTop, height, extra = {}) =>
  ({ id, scrollY, pageTop: scrollY + viewportTop, viewportTop, height, x: 0, width: 412, visibleArea: 412 * height, shown: true, nested: false, video: false, bottomHit: true, ...extra });
const evaluate = (observations, content, extra = {}) =>
  evaluateBetterAds({ observations, content, pageHeight: 5000, viewport: MOBILE, device: 'mobile', ...extra });

test('ads that were all behind something (a cookie dialog left open) flag the result as covered', () => {
  const covered = evaluate([inline('a', 0, 600, 250, { shown: false }), inline('b', 823, 1200, 250, { shown: false }), inline('out', 0, 4600, 250)], { begin: 0, end: 3000 });
  assert.equal(covered.covered, true);
  assert.equal(covered.density.value, 0);
  // One ad seen is enough: the page wasn't covered.
  assert.equal(evaluate([inline('a', 0, 600, 250, { shown: false }), inline('b', 0, 700, 250)], { begin: 0, end: 3000 }).covered, false);
  // No ads at all, or only ads outside the main content: nothing was covered.
  assert.equal(evaluate([], { begin: 0, end: 3000 }).covered, false);
  assert.equal(evaluate([inline('out', 0, 4600, 250)], { begin: 0, end: 3000 }).covered, false);
});

test('an ad a sticky box holds is placed and counted where a screenshot shows it, not where it last was', () => {
  // The US Sun desktop: Navy Federal's rail ad follows the reader in a sticky box for a while, then stops with
  // its column. It is hidden from the screenshots after the first that has it, so its last place shows nothing.
  const result = evaluate([
    inline('rail', 0, 300, 337, { stuck: true }),
    inline('rail', 823, 900, 337, { stuck: true, tile: 1 }),
    inline('rail', 1646, 2449, 337, { stuck: true }),
  ], { begin: 0, end: 4000 });
  const ad = result.ads.find((a) => a.id === 'rail');
  assert.equal(ad.kind, 'inline');
  assert.equal(ad.top, 900);
  assert.equal(ad.tile, 1);
  assert.equal(ad.countedHeight, 337);
  // An ad that scrolls with the page keeps its last place, captured or not.
  const plain = evaluate([inline('a', 0, 300, 250, { tile: 0 }), inline('a', 823, 310, 250)], { begin: 0, end: 4000 });
  assert.equal(plain.ads.find((a) => a.id === 'a').top, 310);
});

test('isSticky: same screen position after scrolling more than its height', () => {
  assert.equal(isSticky([sticky('s', 0, 723, 100), sticky('s', 823, 723, 100)]), true);
});

test('isSticky: a drift within 20 % of its height still counts', () => {
  assert.equal(isSticky([sticky('s', 0, 723, 100), sticky('s', 823, 740, 100)]), true);
});

test('isSticky: false when the page scrolled less than the ad height', () => {
  assert.equal(isSticky([sticky('s', 0, 723, 100), sticky('s', 90, 723, 100)]), false);
});

test('isSticky: false for an ad that moves with the page', () => {
  assert.equal(isSticky([inline('a', 0, 1000, 250), inline('a', 823, 1000, 250)]), false);
});

test('density is the height of the main content taken by ads', () => {
  const result = evaluate([inline('a', 0, 1000, 250), inline('b', 823, 2000, 600)], { begin: 500, end: 4500 });
  assert.deepEqual(result.density, { value: 21.3, over: false, limit: 30, pass: true }); // 850 / 4000
  assert.deepEqual(result.content, { begin: 500, end: 4500 });
});

test('ads outside the main content do not count, ads across its edges count in part', () => {
  const result = evaluate([inline('a', 0, 300, 300), inline('b', 0, 4400, 300)], { begin: 500, end: 4500 });
  assert.equal(result.density.value, 5); // 100 + 100 of 4000
});

test('a sticky ad adds its height once', () => {
  const result = evaluate(
    [sticky('s', 0, 723, 100), sticky('s', 823, 723, 100), sticky('s', 1646, 723, 100), inline('a', 0, 1000, 250)],
    { begin: 0, end: 3000 },
  );
  assert.equal(result.density.value, 11.7); // (100 + 250) / 3000
});

test('sticky ads stacked at the same place on screen count once', () => {
  const result = evaluate(
    [sticky('a', 0, 733, 90), sticky('a', 900, 733, 90), sticky('b', 0, 733, 90), sticky('b', 900, 733, 90)],
    { begin: 0, end: 900 },
  );
  assert.equal(result.density.value, 10); // 90 / 900, not 180 / 900
});

test('ads that share a stretch of the page count once, stacked or side by side (content and rail)', () => {
  const stacked = evaluate([inline('a', 0, 1000, 300), inline('b', 0, 1000, 300)], { begin: 0, end: 3000 });
  assert.equal(stacked.density.value, 10); // 300 / 3000
  const sideBySide = evaluate(
    [inline('content', 0, 1000, 300, { x: 0, width: 700 }), inline('rail', 0, 1000, 600, { x: 1000, width: 300 })],
    { begin: 0, end: 3000 },
    { viewport: { width: 1350, height: 940 }, device: 'desktop' },
  );
  assert.equal(sideBySide.density.value, 20); // 1000–1600 has ads: 600 / 3000
});

test('an ad skin at the side of the screen counts once in the density, like any sticky ad in the siderails, and is no large sticky ad', () => {
  // betterads.org (desktop): all formats count, siderail ads included, each sticky ad's height once.
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const left = { x: 0, width: 175, visibleArea: 175 * 940 };
  const right = { x: 1175, width: 175, visibleArea: 175 * 940 };
  const result = evaluate(
    [sticky('left', 0, 0, 1000, left), sticky('left', 2100, 0, 1000, left), sticky('right', 0, 0, 1000, right), sticky('right', 2100, 0, 1000, right)],
    { begin: 0, end: 3000 }, desktop,
  );
  assert.equal(result.density.value, 31.3); // the two skins share the same rows, the screen's at most: 940 / 3000
  assert.deepEqual(result.largeSticky, { value: 0, limit: 30, pass: true, found: false });
  assert.deepEqual(result.ads.map((a) => [a.id, a.kind, a.counted, a.countedHeight]), [['left', 'skin', true, 940], ['right', 'skin', true, 940]]);
});

test('a large sticky ad must cover the bottom centre of the screen, like Chrome checks', () => {
  const top = { visibleArea: 412 * 300 };
  const result = evaluate([sticky('t', 0, 0, 300, top), sticky('t', 823, 0, 300, top)], { begin: 0, end: 3000 });
  assert.equal(result.largeSticky.value, 0); // stuck to the top: not a large sticky ad
  assert.equal(result.density.value, 10); // but still an ad in the page: 300 / 3000
});

test('an ad inside another ad counts once', () => {
  const result = evaluate([inline('outer', 0, 1000, 300), inline('inner', 0, 1050, 250, { nested: true })], { begin: 0, end: 3000 });
  assert.equal(result.density.value, 10);
});

test('mobile limit is 30 %: 30 passes, 31 fails', () => {
  assert.deepEqual(evaluate([inline('a', 0, 0, 300)], { begin: 0, end: 1000 }).density, { value: 30, over: false, limit: 30, pass: true });
  assert.deepEqual(evaluate([inline('a', 0, 0, 310)], { begin: 0, end: 1000 }).density, { value: 31, over: false, limit: 30, pass: false });
});

test('desktop limit is 50 %', () => {
  const result = evaluate([inline('a', 0, 0, 400)], { begin: 0, end: 1000 }, { device: 'desktop' });
  assert.deepEqual(result.density, { value: 40, over: false, limit: 50, pass: true });
  assert.equal(result.stickyVideo, false);
});

test('on desktop a sticky video ad lowers the density limit to 30 %', () => {
  const video = { video: true };
  const result = evaluate(
    [sticky('v', 0, 700, 100, video), sticky('v', 900, 700, 100, video), inline('a', 0, 0, 300)],
    { begin: 0, end: 1000 },
    { device: 'desktop' },
  );
  assert.deepEqual(result.density, { value: 40, over: false, limit: 30, pass: false });
  assert.equal(result.stickyVideo, true);
});

test('a video player that showed the site\'s video is not counted (Chrome tags NY Post\'s news clips in Connatix\'s player)', () => {
  const result = evaluate([
    inline('p', 0, 600, 230, { video: true, player: null }), // loading: nothing plays yet
    inline('p', 300, 600, 230, { video: true, player: 'content' }),
    inline('a', 300, 1200, 300),
  ], { begin: 0, end: 3000 });
  const player = result.ads.find((a) => a.id === 'p');
  assert.equal(player.counted, false);
  assert.equal(player.reason, 'content-video');
  assert.equal(player.countedHeight, 0);
  assert.equal(result.density.value, 10);
});

test('the site\'s own video player never counts, even with an ad played in it: its video ads fall under Better Ads\' video standard', () => {
  const result = evaluate([
    inline('p', 0, 600, 230, { video: true, player: 'content', playerKey: 'k' }),
    inline('p', 300, 600, 230, { video: true, player: 'ad', playerKey: 'k' }),
  ], { begin: 0, end: 2300 });
  assert.equal(result.ads[0].reason, 'content-video');
  assert.equal(result.density.value, 0);
});

test('a piece of that player seen only while its ad played (IMA\'s own video) is part of it', () => {
  const result = evaluate([
    inline('p', 0, 600, 230, { video: true, player: 'content', playerKey: 'k' }),
    inline('ima', 300, 600, 230, { video: true, player: 'ad', playerKey: 'k' }),
  ], { begin: 0, end: 2300 });
  assert.equal(result.ads.find((a) => a.id === 'ima').reason, 'content-video');
});

test('a player whose own video was never seen playing, only an ad, counts: it can\'t be told from a unit that is all ad', () => {
  const result = evaluate([inline('p', 300, 600, 230, { video: true, player: 'ad', playerKey: 'k' })], { begin: 0, end: 2300 });
  assert.equal(result.ads[0].counted, true);
  assert.equal(result.density.value, 10);
});

test('a floating player that showed the site\'s video is no sticky ad: no large sticky ad, no sticky video limit', () => {
  const content = { video: true, player: 'content' };
  const result = evaluate(
    [sticky('f', 0, 700, 100, content), sticky('f', 900, 700, 100, content), inline('a', 0, 0, 300)],
    { begin: 0, end: 1000 },
    { device: 'desktop' },
  );
  assert.deepEqual(result.density, { value: 30, over: false, limit: 50, pass: true });
  assert.equal(result.stickyVideo, false);
  assert.equal(result.largeSticky.found, false);
  assert.equal(result.ads.find((a) => a.id === 'f').reason, 'content-video');
});

test('a piece of a player that showed the site\'s video is that, even behind the player\'s own controls or outside the main content', () => {
  // Connatix's <video> sits under its controls layer: hit tests land on the controls, not on an ad.
  const behind = evaluate([inline('p', 0, 600, 230, { video: true, player: 'content', shown: false })], { begin: 0, end: 3000 });
  assert.equal(behind.ads[0].reason, 'content-video');
  const outside = evaluate([inline('p', 0, 3200, 230, { video: true, player: 'content' })], { begin: 0, end: 3000 });
  assert.equal(outside.ads[0].reason, 'content-video');
});

test('a sticky ad covering more than 30 % of the screen fails the large sticky check', () => {
  const result = evaluate([sticky('s', 0, 523, 300), sticky('s', 823, 523, 300)], { begin: 0, end: 3000 });
  assert.deepEqual(result.largeSticky, { value: 36, limit: 30, pass: false, found: true }); // 123 600 / 339 076
});

test('an interscroller (a creative fixed behind a hole in the article) is no large sticky ad: the hit test lands on it only while the hole scrolls by', () => {
  // Its box covers the screen at every sample; the article covers the bottom centre except while the
  // hole passes there (two samples, 400 px of scroll apart: less than its height).
  const creative = (scrollY, bottomHit) => sticky('i', scrollY, 0, 823, { bottomHit });
  const result = evaluate([creative(0, false), creative(800, true), creative(1200, true), creative(1600, false), creative(2400, false)], { begin: 0, end: 5000 });
  assert.deepEqual(result.largeSticky, { value: 0, limit: 30, pass: true, found: false });
});

test('an interscroller (seen through a gap in the article, wholly behind the page\'s content elsewhere) counts its height once and is no sticky ad', () => {
  // Fixed full screen; the page's content covers it (behindPage) except while its gap passes. Even with
  // the bottom centre's hit test held on it, it stays out of the large sticky check.
  const creative = (scrollY, seen) => sticky('i', scrollY, 0, 823, { shown: seen, behindPage: !seen });
  const result = evaluate([creative(0, false), creative(900, true), creative(1800, true), creative(2700, false)], { begin: 0, end: 5000 });
  assert.deepEqual([decided(result, 'i').kind, decided(result, 'i').counted, decided(result, 'i').countedHeight], ['interscroller', true, 823]);
  assert.equal(result.density.value, 16.5); // 823 of 5000
  assert.deepEqual(result.largeSticky, { value: 0, limit: 30, pass: true, found: false });
});

test('a fixed ad taller than the screen counts the screen\'s rows it covers, never more than the screen', () => {
  // HuffPost's 412 × 2118 creative, fixed 59 px above the top of the screen.
  const tall = (scrollY) => sticky('t', scrollY, -59, 2118, { visibleArea: 412 * 823 });
  const result = evaluate([tall(0), tall(1200), tall(2400)], { begin: 0, end: 5000 });
  assert.equal(decided(result, 't').kind, 'sticky');
  assert.equal(decided(result, 't').countedHeight, 823);
  assert.equal(result.density.value, 16.5); // 823 of 5000
});

test('a wallpaper (a fixed ad behind the content, seen beside it) is a skin, though wholly behind the page at times', () => {
  // Vocento's wemass skin: seen above the header and at the sides, then only at the sides.
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const frame = (scrollY, seen) => sticky('w', scrollY, 0, 1000, { x: 0, width: 1350, visibleArea: 1350 * 940, shown: seen, behindPage: true, wallpaper: seen });
  const result = evaluate([frame(0, true), frame(940, false), frame(1880, true)], { begin: 0, end: 4700 }, desktop);
  assert.deepEqual([decided(result, 'w').kind, decided(result, 'w').counted, decided(result, 'w').countedHeight], ['skin', true, 940]);
});

test('a skin\'s side panels (ads against the screen\'s edges, beside the content) are part of it: counted once with its rows', () => {
  // El Correo desktop (2026-10-04): wemass's wallpaper (940 rows) and Chrome's two 120 × 800 rails at the edges,
  // which scroll with the page, are one creative's sides: the rails added 427 px more.
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const frame = (scrollY) => sticky('w', scrollY, 0, 1000, { x: 0, width: 1350, visibleArea: 1350 * 940, wallpaper: true, source: 'easylist', why: 'EasyList Spanish ||wemass.com^' });
  const rail = (id, x) => inline(id, 0, 0, 800, { x, width: 120, visibleArea: 75 * 800 });
  const column = inline('mpu', 0, 847, 600, { x: 928, width: 300, visibleArea: 300 * 93 });
  const content = { begin: 373, end: 7958 };
  const both = evaluate([frame(0), frame(940), frame(1880), rail('left', -45), rail('right', 1275), column], content, desktop);
  const skinOnly = evaluate([frame(0), frame(940), frame(1880), column], content, desktop);
  assert.equal(both.density.value, skinOnly.density.value);
  for (const id of ['left', 'right']) assert.deepEqual([decided(both, id).counted, decided(both, id).reason], [false, 'nested']);
  assert.equal(decided(both, 'mpu').counted, true); // an ad in the content column stays its own
  // Without a skin, side rails are ads of their own.
  const railsOnly = evaluate([rail('left', -45), rail('right', 1275)], content, desktop);
  assert.equal(decided(railsOnly, 'left').counted, true);
});

test('a small floating ad (30 % of the screen or less) the page\'s content covers for a while stays a sticky ad', () => {
  // Clarín's 300 × 250 floating video box (22 % of the screen), under an image of the article now and then.
  const box = (scrollY, seen) => sticky('f', scrollY, 400, 250, { x: 112, width: 300, visibleArea: 300 * 250, shown: seen, behindPage: !seen });
  const result = evaluate([box(0, true), box(823, false), box(1646, true)], { begin: 0, end: 3000 });
  assert.equal(decided(result, 'f').kind, 'sticky');
});

test('a sticky ad covered for a while by something fixed (a dialog), not by the page\'s content, stays a sticky ad', () => {
  const ad = (scrollY, seen) => sticky('s', scrollY, 523, 300, { shown: seen, behindPage: false });
  const result = evaluate([ad(0, false), ad(823, true), ad(1646, true)], { begin: 0, end: 3000 });
  assert.equal(decided(result, 's').kind, 'sticky');
});

test('the large sticky check starts over when the hit test lands elsewhere, as Chrome\'s does', () => {
  // Hit at 0 and at 900 px of scroll (more than its height apart), but not in between.
  const ad = (scrollY, bottomHit) => sticky('s', scrollY, 523, 300, { bottomHit });
  const broken = evaluate([ad(0, true), ad(450, false), ad(900, true)], { begin: 0, end: 3000 });
  assert.deepEqual(broken.largeSticky, { value: 0, limit: 30, pass: true, found: false });
  const held = evaluate([ad(0, true), ad(450, true), ad(900, true)], { begin: 0, end: 3000 });
  assert.deepEqual(held.largeSticky, { value: 36, limit: 30, pass: false, found: true }); // 123 600 / 339 076
});

test('without a detected main content the whole page is used', () => {
  const result = evaluate([inline('a', 0, 0, 500)], null);
  assert.deepEqual(result.content, { begin: 0, end: 5000 });
  assert.equal(result.density.value, 10);
});

test('no ads, or an empty main content, gives zeros and passes', () => {
  const result = evaluateBetterAds({ observations: [], content: { begin: 0, end: 0 }, pageHeight: 0, viewport: { width: 0, height: 0 }, device: 'mobile' });
  assert.deepEqual(result.density, { value: 0, over: false, limit: 30, pass: true });
  assert.deepEqual(result.largeSticky, { value: 0, limit: 30, pass: true, found: false });
});

test('a full-width sticky ad taller than half the screen is a large sticky ad, not a skin', () => {
  const tall = { visibleArea: 412 * 450 };
  const result = evaluate([sticky('a', 0, 373, 450, tall), sticky('a', 900, 373, 450, tall)], { begin: 0, end: 4500 });
  assert.deepEqual(result.largeSticky, { value: 55, limit: 30, pass: false, found: true }); // 185 400 / 339 076
  assert.equal(result.density.value, 10); // 450 / 4500
});

test('a billboard, then content and a rail side by side: each stretch with ads counts once', () => {
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const result = evaluate(
    [
      inline('billboard', 0, 0, 250, { x: 190, width: 970 }),
      inline('content', 0, 1000, 300, { x: 0, width: 700 }),
      inline('rail', 0, 1000, 600, { x: 1000, width: 300 }),
    ],
    { begin: 0, end: 3000 },
    desktop,
  );
  assert.equal(result.density.value, 28.3); // 0–250 and 1000–1600: 850 / 3000
});

test('sticky rails side by side count once', () => {
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const left = { x: 100, width: 300, visibleArea: 300 * 600 };
  const right = { x: 950, width: 300, visibleArea: 300 * 600 };
  const result = evaluate(
    [sticky('l', 0, 100, 600, left), sticky('l', 900, 100, 600, left), sticky('r', 0, 100, 600, right), sticky('r', 900, 100, 600, right)],
    { begin: 0, end: 3000 },
    desktop,
  );
  assert.equal(result.density.value, 20); // the same 600 rows of the screen, of 3000
});

test('the density stops at 100 % and says when the ads would take up more (shown as 100 %+)', () => {
  // A short main content all taken by an ad, plus a sticky anchor: 1090 px of ads for 1000.
  const result = evaluate([inline('a', 0, 0, 1000), sticky('s', 0, 733, 90), sticky('s', 900, 733, 90)], { begin: 0, end: 1000 });
  assert.equal(result.density.value, 100);
  assert.equal(result.density.over, true);
  assert.equal(evaluate([inline('a', 0, 0, 1000)], { begin: 0, end: 1000 }).density.over, false); // exactly all of it
});

test('an ad seen on screen only behind content does not count, even after scrolling past it', () => {
  const result = evaluate(
    [inline('a', 0, 2000, 300, { shown: null }), inline('a', 1800, 2000, 300, { shown: false }), inline('a', 3000, 2000, 300, { shown: null })],
    { begin: 0, end: 4000 },
  );
  assert.equal(result.density.value, 0);
});

test('an ad behind content and outside the main content is listed as outside it', () => {
  const result = evaluate(
    [inline('below', 3000, 4600, 250, { shown: false }), inline('across', 3000, 3900, 250, { shown: false })],
    { begin: 0, end: 4000 },
  );
  assert.deepEqual(result.ads.map((a) => [a.id, a.reason]), [['across', 'hidden'], ['below', 'outside']]);
});

test('an ad never on screen during the test still counts', () => {
  const result = evaluate([inline('a', 0, 2000, 400, { shown: null })], { begin: 0, end: 4000 });
  assert.equal(result.density.value, 10);
});

test('the verdict uses the rounded value it shows', () => {
  const result = evaluate([inline('a', 0, 0, 300.4)], { begin: 0, end: 1000 });
  assert.deepEqual(result.density, { value: 30, over: false, limit: 30, pass: true });
});

test('an anchor ad below Chrome\'s check line reports its share and still passes', () => {
  // 728 × 90 at the bottom of a 940 px desktop screen: below the line at 90 % (846 px).
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const anchor = { x: 311, width: 728, visibleArea: 728 * 90 };
  const result = evaluate([sticky('anchor', 0, 850, 90, anchor), sticky('anchor', 1000, 850, 90, anchor)], { begin: 0, end: 3000 }, desktop);
  assert.deepEqual(result.largeSticky, { value: 5, limit: 30, pass: true, found: true }); // 65 520 / 1 269 000
});

test('lists every ad with what the density made of it', () => {
  const skin = { width: 150, visibleArea: 150 * 500 };
  const result = evaluate(
    [
      inline('a', 0, 400, 250), // across the main content's top: 150 px count
      inline('out', 0, 4600, 250), // below the main content
      inline('hid', 1646, 2000, 250, { shown: false }), // only seen behind content
      sticky('skin', 0, 0, 500, skin), sticky('skin', 823, 0, 500, skin),
      inline('in', 0, 420, 100, { nested: true }),
      sticky('s', 0, 723, 100), sticky('s', 823, 723, 100),
    ],
    { begin: 500, end: 4500 },
  );
  const ad = (id, top, height, x, width, kind, counted, countedHeight, reason, share = null) =>
    ({ id, top, height, x, width, kind, counted, countedHeight, reason, share, source: 'chrome', why: null, tile: null });
  assert.deepEqual(result.ads, [
    ad('skin', 0, 500, 0, 150, 'skin', true, 500, null, 22), // 75 000 / 339 076
    ad('a', 400, 250, 0, 412, 'inline', true, 150, null),
    ad('in', 420, 100, 0, 412, 'inline', false, 0, 'nested'),
    ad('s', 723, 100, 0, 412, 'sticky', true, 100, null, 12), // 41 200 / 339 076
    ad('hid', 2000, 250, 0, 412, 'inline', false, 0, 'hidden'),
    ad('out', 4600, 250, 0, 412, 'inline', false, 0, 'outside'),
  ]);
});

test('each ad keeps where it was found and why', () => {
  const result = evaluate([inline('a', 0, 600, 250, { source: 'easylist', why: 'EasyList ||ads.example^' }), inline('b', 0, 1200, 250)], { begin: 0, end: 3000 });
  assert.deepEqual(result.ads.map((a) => [a.id, a.source, a.why]), [['a', 'easylist', 'EasyList ||ads.example^'], ['b', 'chrome', null]]);
});

test('a sticky ad is placed where a screenshot shows it, not where it was tallest between screenshots', () => {
  const result = evaluate(
    [sticky('s', 0, 723, 120, { visibleArea: 412 * 100 }), sticky('s', 823, 723, 100, { tile: 1 })],
    { begin: 0, end: 3000 },
  );
  assert.deepEqual(result.ads, [
    { id: 's', top: 1546, height: 100, x: 0, width: 412, kind: 'sticky', counted: true, countedHeight: 100, reason: null, share: 12, source: 'chrome', why: null, tile: 1 }, // 120 px from 723: 100 on screen
  ]);
});

// An ad an ad script made, as the runner records it.
const pink = (id, pageTop, height, extra = {}) => inline(id, 0, pageTop, height, { source: 'easylist', why: 'EasyList x', ...extra });
const decided = (result, id) => result.ads.find((a) => a.id === id);
const CONTENT = { begin: 0, end: 3000 };

test('two ads of an ad script with the same box count once: the first stays, the second is nested', () => {
  const both = evaluate([pink('a', 600, 250), pink('b', 600, 250)], CONTENT);
  assert.equal(decided(both, 'a').counted, true);
  assert.deepEqual(['counted', 'reason', 'countedHeight'].map((k) => decided(both, 'b')[k]), [false, 'nested', 0]);
  assert.equal(both.density.value, evaluate([pink('a', 600, 250)], CONTENT).density.value);
});

test('an ad of an ad script inside Chrome\'s ad box is nested; Chrome\'s ad is counted', () => {
  const result = evaluate([pink('p', 650, 100, { width: 300, x: 50 }), inline('c', 0, 600, 250)], CONTENT);
  assert.equal(decided(result, 'p').reason, 'nested');
  assert.equal(decided(result, 'p').counted, false);
  assert.equal(decided(result, 'c').counted, true);
  assert.equal(result.density.value, evaluate([inline('c', 0, 600, 250)], CONTENT).density.value);
});

test('a bigger ad of an ad script around a smaller one nests it, whichever came first', () => {
  const result = evaluate([pink('small', 650, 100), pink('big', 600, 250)], CONTENT);
  assert.equal(decided(result, 'small').reason, 'nested');
  assert.equal(decided(result, 'big').counted, true);
});

test('Chrome\'s ads are never nested by this rule, even with the same box', () => {
  const result = evaluate([inline('c1', 0, 600, 250), inline('c2', 0, 600, 250), pink('p', 600, 250)], CONTENT);
  assert.equal(decided(result, 'c1').counted, true);
  assert.equal(decided(result, 'c2').counted, true);
  assert.equal(decided(result, 'p').reason, 'nested');
  assert.equal(result.density.value, evaluate([inline('c1', 0, 600, 250)], CONTENT).density.value);
});

test('an ad of an ad script that only partly overlaps another ad stays counted', () => {
  const result = evaluate([inline('c', 0, 600, 250), pink('p', 700, 250)], CONTENT);
  assert.equal(decided(result, 'p').counted, true);
  assert.equal(result.density.value, evaluate([inline('c', 0, 600, 250), pink('p', 700, 250)], CONTENT).density.value);
  assert.equal(result.density.value, 11.7); // 350 of 3000
});

test('the box is compared with 2 px of tolerance on each edge', () => {
  const result = evaluate([inline('c', 0, 600, 250), pink('p', 598, 254)], CONTENT);
  assert.equal(decided(result, 'p').reason, 'nested');
  assert.equal(decided(evaluate([inline('c', 0, 600, 250), pink('q', 597, 254)], CONTENT), 'q').counted, true);
});

// A sticky ad an ad script made, seen at two scroll positions (a Chrome one without source).
const stuck = (id, extra = {}) => [sticky(id, 0, 723, 100, extra), sticky(id, 823, 723, 100, extra)];
const pinkStuck = (id) => stuck(id, { source: 'easylist', why: 'EasyList x' });

test('two sticky ads of an ad script in the same box count once, the figures unchanged', () => {
  const one = evaluate(pinkStuck('a'), CONTENT);
  const both = evaluate([...pinkStuck('a'), ...pinkStuck('b')], CONTENT);
  assert.equal(decided(both, 'a').counted, true);
  assert.deepEqual(['counted', 'reason', 'countedHeight'].map((k) => decided(both, 'b')[k]), [false, 'nested', 0]);
  assert.equal(both.density.value, one.density.value);
  assert.deepEqual(both.largeSticky, one.largeSticky);
});

test('a Chrome sticky ad and an ad script\'s in the same box: the Chrome one is counted', () => {
  const result = evaluate([...pinkStuck('p'), ...stuck('c')], CONTENT);
  assert.equal(decided(result, 'p').reason, 'nested');
  assert.equal(decided(result, 'c').counted, true);
  assert.equal(result.density.value, evaluate(stuck('c'), CONTENT).density.value);
});

test('sticky twins are compared on screen: the same screen box placed at different page tops still nests', () => {
  const at = (id, scrollY) => [sticky(id, scrollY, 723, 100, { source: 'easylist', why: 'EasyList x' }), sticky(id, scrollY + 823, 723, 100, { source: 'easylist', why: 'EasyList x' })];
  const both = evaluate([...at('a', 0), ...at('b', 300)], CONTENT);
  assert.notEqual(decided(both, 'a').top, decided(both, 'b').top);
  assert.equal(decided(both, 'a').counted, true);
  assert.deepEqual(['counted', 'reason', 'countedHeight'].map((k) => decided(both, 'b')[k]), [false, 'nested', 0]);
});

// A box labelled as advertising, as the runner records it.
const labelled = (id, pageTop, height, extra = {}) => inline(id, 0, pageTop, height, { source: 'label', why: 'labelled "Publicidad"', ...extra });

test('a labelled box over an ad of the lists counts once, as that ad (SunMedia\'s overlay sits over its slot)', () => {
  const list = pink('s', 2435, 293, { x: 60, width: 293 });
  const box = labelled('l', 2422, 270, { x: 16, width: 380 });
  const result = evaluate([box, list], { begin: 0, end: 5000 });
  assert.deepEqual(['counted', 'reason', 'countedHeight'].map((k) => decided(result, 'l')[k]), [false, 'nested', 0]);
  assert.equal(decided(result, 's').counted, true);
  assert.equal(result.density.value, evaluate([list], { begin: 0, end: 5000 }).density.value);
});

test('a labelled box that overlaps a Chrome ad by less than half of the smaller box stays counted', () => {
  const result = evaluate([labelled('l', 1000, 300), inline('c', 0, 1200, 250)], CONTENT);
  assert.equal(decided(result, 'l').counted, true);
  assert.equal(decided(result, 'c').counted, true);
});

test('labelled boxes never nest each other by the overlap rule (that is nestSameAds\' business)', () => {
  const result = evaluate([labelled('l1', 1000, 300), labelled('l2', 1100, 300)], CONTENT);
  assert.equal(decided(result, 'l1').counted, true);
  assert.equal(decided(result, 'l2').counted, true);
});

test('an ad of the lists inside a labelled box counts as that ad: the box is its slot, never its holder', () => {
  // The overlay sits inside the labelled slot geometrically without being its DOM child.
  const box = labelled('l', 600, 300, { x: 16, width: 380 });
  const list = pink('s', 630, 250, { x: 56, width: 300 });
  for (const order of [[box, list], [list, box]]) {
    const result = evaluate(order, CONTENT);
    assert.equal(decided(result, 's').counted, true);
    assert.deepEqual(['counted', 'reason', 'countedHeight'].map((k) => decided(result, 'l')[k]), [false, 'nested', 0]);
    assert.equal(result.density.value, evaluate([list], CONTENT).density.value); // 250 of 3000, not 300
  }
});

test('a sticky ad of the lists inside a labelled sticky box counts as that ad, compared on screen', () => {
  const at = (id, top, height, extra) => [sticky(id, 0, top, height, extra), sticky(id, 823, top, height, extra)];
  const box = at('l', 500, 300, { x: 16, width: 380, visibleArea: 380 * 300, source: 'label', why: 'labelled "Publicidad"' });
  const list = at('s', 530, 250, { x: 56, width: 300, visibleArea: 300 * 250, source: 'easylist', why: 'EasyList x' });
  const result = evaluate([...box, ...list], CONTENT);
  assert.equal(decided(result, 's').counted, true);
  assert.deepEqual(['counted', 'reason', 'countedHeight'].map((k) => decided(result, 'l')[k]), [false, 'nested', 0]);
  assert.equal(result.density.value, evaluate(list, CONTENT).density.value); // 250 of 3000
});

test('the large sticky check looks only at the sticky ads left counted after nesting', () => {
  // A 120 px labelled fixed bar over a 50 px Chrome anchor: the bar is the anchor's slot.
  const bar = [sticky('l', 0, 703, 120, { source: 'label', why: 'labelled "Publicidad"' }), sticky('l', 823, 703, 120, { source: 'label', why: 'labelled "Publicidad"' })];
  const anchor = [sticky('c', 0, 773, 50), sticky('c', 823, 773, 50)];
  const result = evaluate([...bar, ...anchor], CONTENT);
  assert.equal(decided(result, 'l').reason, 'nested');
  assert.deepEqual(result.largeSticky, evaluate(anchor, CONTENT).largeSticky);
  assert.deepEqual(result.largeSticky, { value: 6, limit: 30, pass: true, found: true }); // 20 600 / 339 076
});

test('a sticky video nested in another sticky ad still sets the desktop video limit; the large sticky figure stays the holder\'s', () => {
  // An ad script's video overlay inside a Chrome sticky box that holds no <video> itself.
  const desktop = { viewport: { width: 1350, height: 940 }, device: 'desktop' };
  const at = (id, top, extra) => [sticky(id, 0, top, extra.height, extra), sticky(id, 900, top, extra.height, extra)];
  const box = at('c', 690, { x: 311, width: 728, height: 250, visibleArea: 728 * 250 });
  const video = at('v', 700, { x: 361, width: 400, height: 225, visibleArea: 400 * 225, video: true, source: 'easylist', why: 'EasyList x' });
  const result = evaluate([...video, ...box], CONTENT, desktop);
  assert.equal(decided(result, 'v').reason, 'nested');
  assert.equal(result.stickyVideo, true);
  assert.equal(result.density.limit, 30);
  assert.deepEqual(result.largeSticky, evaluate(box, CONTENT, desktop).largeSticky);
  assert.deepEqual(result.largeSticky, { value: 14, limit: 30, pass: true, found: true }); // 182 000 / 1 269 000
});

// An ad in a layer fixed to the screen over the page, as the runner records it (overlay: in such a
// layer, not in a fixed wrapper that holds the page's content; overContent: on top of the page's content
// at the screen's centre).
const overlay = (id, scrollY, viewportTop, height, extra = {}) => sticky(id, scrollY, viewportTop, height, { fixed: true, overlay: true, overContent: true, ...extra });

test('a fixed ad covering the whole screen is an interstitial: it fails on its own, outside the density and the large sticky figure', () => {
  const full = { visibleArea: 412 * 823 };
  const result = evaluate(
    [overlay('pop', 0, 0, 823, full), overlay('pop', 0, 0, 823, { ...full, tile: 0 }), overlay('pop', 0, 0, 823, full), inline('a', 823, 1000, 300)],
    CONTENT,
  );
  assert.deepEqual(result.interstitial, { found: true, pass: false, share: 100 });
  assert.deepEqual(decided(result, 'pop'), { id: 'pop', top: 0, height: 823, x: 0, width: 412, kind: 'interstitial', counted: false, countedHeight: 0, reason: 'interstitial', share: 100, tile: 0, source: 'chrome', why: null });
  assert.equal(result.density.value, 10); // the inline ad only: 300 of 3000
  assert.deepEqual(result.largeSticky, { value: 0, limit: 30, pass: true, found: false });
  assert.equal(result.covered, false);
});

test('an ad gate is drawn where the screenshot that holds it shows it, even one taken before it covered the screen\'s centre', () => {
  // Vozpópuli: the screen at 940 shows membrana's card low on screen (not yet over the centre, so not yet a
  // pop-up); from 1880 on the gate is a pop-up but hidden from the screenshots, shown once.
  const gate = { gate: true, layer: 'gate', layerArea: 820 * 940, fixed: false };
  const result = evaluate([
    overlay('g', 940, 660, 127, { ...gate, overContent: false, tile: 1 }),
    overlay('g', 1880, 266, 127, gate),
    overlay('g', 2820, 266, 127, gate),
  ], CONTENT, { viewport: { width: 1350, height: 940 }, device: 'desktop' });
  assert.equal(result.interstitial.found, true);
  const ad = decided(result, 'g');
  assert.equal(ad.tile, 1);
  assert.equal(ad.top, 1600);
});

test('ads in a pop-up\'s own layer are pieces of it (one creative made of several frames): neither in the density nor the large sticky check', () => {
  // Sport's bwin interstitial: a full-screen frame and strips stacked in the same fixed layer; a bottom
  // anchor ad in a layer of its own stays an ad of its own.
  const at = (scrollY) => [
    overlay('pop', scrollY, 0, 823, { visibleArea: 412 * 823, layer: 'bwin' }),
    overlay('top', scrollY, 0, 299, { overContent: false, layer: 'bwin' }),
    overlay('bottom', scrollY, 524, 299, { overContent: false, layer: 'bwin' }),
    overlay('anchor', scrollY, 773, 50, { overContent: false, layer: 'anchor' }),
  ];
  const result = evaluate([...at(0), ...at(823), ...at(1646)], CONTENT);
  assert.deepEqual(result.interstitial, { found: true, pass: false, share: 100 });
  for (const piece of ['top', 'bottom']) {
    assert.deepEqual([decided(result, piece).kind, decided(result, piece).counted, decided(result, piece).reason], ['sticky', false, 'nested']);
  }
  assert.equal(decided(result, 'anchor').counted, true);
  assert.equal(result.density.value, 1.7); // the anchor only: 50 of 3000
  assert.deepEqual(result.largeSticky, { value: 6, limit: 30, pass: true, found: true }); // 20 600 / 339 076
});

test('an ad gate (a layer blurring the article over it, with an ad in it) is a pop-up: it fails, its pieces are part of it, at 10 % of the screen as in Chrome', () => {
  // Diario de Navarra mobile: membrana's card (text + a 300 × 75 ad) sticky in a layer that blurs the rest of
  // the article; the layer's part on screen is what the reader can't read.
  const gate = (scrollY, layerArea) => [
    overlay('ad', scrollY, 386, 75, { gate: true, layer: 'gate', layerArea, visibleArea: 300 * 75 }),
    overlay('text', scrollY, 260, 33, { gate: true, layer: 'gate', layerArea, visibleArea: 300 * 33, source: 'easylist', why: 'EasyList ||membrana.media^$third-party' }),
  ];
  const result = evaluate([...gate(2187, 320 * 823), ...gate(2916, 320 * 823), inline('a', 823, 1000, 300)], CONTENT);
  assert.deepEqual(result.interstitial, { found: true, pass: false, share: 78, gate: true }); // 263 360 / 339 076
  const ad = decided(result, 'ad');
  assert.deepEqual([ad.kind, ad.counted, ad.reason, ad.share, ad.gate], ['interstitial', false, 'interstitial', 78, true]);
  assert.deepEqual([decided(result, 'text').counted, decided(result, 'text').reason], [false, 'nested']);
  assert.equal(result.density.value, 10); // the inline ad only
  assert.deepEqual(result.largeSticky, { value: 0, limit: 30, pass: true, found: false });
  // A blurring layer under 10 % of the screen is no pop-up (Chrome's threshold): its ads are ads as usual.
  const small = evaluate([...gate(2187, 0.08 * 412 * 823), ...gate(2916, 0.08 * 412 * 823)], CONTENT);
  assert.equal(small.interstitial.found, false);
  assert.equal(decided(small, 'ad').counted, true);
});

test('an interstitial keeps where it was found and why, and its largest share of the screen', () => {
  const result = evaluate(
    [overlay('pop', 0, 0, 500, { visibleArea: 412 * 500, source: 'easylist', why: 'EasyList x' }), overlay('pop', 0, 0, 700, { visibleArea: 412 * 700, source: 'easylist', why: 'EasyList x' })],
    CONTENT,
  );
  assert.deepEqual(result.interstitial, { found: true, pass: false, share: 85 }); // 288 400 / 339 076
  assert.deepEqual(['kind', 'source', 'why', 'share'].map((k) => decided(result, 'pop')[k]), ['interstitial', 'easylist', 'EasyList x', 85]);
});

test('an ad seen once covering half the screen while fixed is an interstitial for the whole test', () => {
  const result = evaluate([overlay('pop', 0, 723, 100), overlay('pop', 823, 0, 823, { visibleArea: 412 * 823 }), overlay('pop', 1646, 723, 100)], CONTENT);
  assert.equal(decided(result, 'pop').kind, 'interstitial');
  assert.equal(result.density.value, 0);
});

test('a fixed bottom anchor of 15 % of the screen is no interstitial: a large sticky ad as before', () => {
  const anchor = { visibleArea: 412 * 123 };
  const result = evaluate([overlay('s', 0, 700, 123, anchor), overlay('s', 823, 700, 123, anchor)], CONTENT);
  assert.deepEqual(result.interstitial, { found: false, pass: true, share: null });
  assert.equal(decided(result, 's').kind, 'sticky');
  assert.deepEqual(result.largeSticky, { value: 15, limit: 30, pass: true, found: true }); // 50 676 / 339 076
});

test('a fixed ad covering less than half the screen is no interstitial', () => {
  const area = Math.floor(0.49 * 412 * 823);
  const result = evaluate([overlay('s', 0, 200, 403, { visibleArea: area }), overlay('s', 823, 200, 403, { visibleArea: area })], CONTENT);
  assert.equal(result.interstitial.found, false);
  assert.equal(decided(result, 's').kind, 'sticky');
});

test('an ad covering the screen that scrolls with the page, or is hidden, or is not fixed, is no interstitial', () => {
  const full = { visibleArea: 412 * 823 };
  const scrolling = evaluate([inline('big', 0, 0, 823, full)], CONTENT);
  assert.equal(scrolling.interstitial.found, false);
  assert.equal(decided(scrolling, 'big').kind, 'inline');
  assert.equal(evaluate([overlay('h', 0, 0, 823, { ...full, shown: false }), overlay('h', 823, 0, 823, { ...full, shown: false })], CONTENT).interstitial.found, false);
  assert.equal(evaluate([sticky('n', 0, 0, 823, full), sticky('n', 823, 0, 823, full)], CONTENT).interstitial.found, false);
});

test('a full-screen overlay not lying over the content (a skin behind it, an interscroller) is no interstitial: a sticky ad as before', () => {
  const behind = { visibleArea: 412 * 823, overContent: false };
  const result = evaluate([overlay('skin', 0, 0, 823, behind), overlay('skin', 1646, 0, 823, behind)], CONTENT);
  assert.deepEqual(result.interstitial, { found: false, pass: true, share: null });
  assert.equal(decided(result, 'skin').kind, 'sticky');
  assert.equal(decided(result, 'skin').counted, true);
});

test('a full-screen ad in a fixed wrapper that holds the page (an app shell) is no interstitial', () => {
  const full = { visibleArea: 412 * 823, fixed: true, overlay: false };
  const result = evaluate([sticky('shell', 0, 0, 823, full), sticky('shell', 823, 0, 823, full)], CONTENT);
  assert.equal(result.interstitial.found, false);
  assert.notEqual(decided(result, 'shell').kind, 'interstitial');
});

test('an ad seen only behind an interstitial does not make the result covered: an ad was seen', () => {
  const result = evaluate([overlay('pop', 0, 0, 823, { visibleArea: 412 * 823 }), inline('a', 0, 600, 250, { shown: false })], CONTENT);
  assert.equal(result.covered, false);
  assert.equal(result.interstitial.found, true);
});

test('no interstitial: found false, pass, no share', () => {
  assert.deepEqual(evaluate([], CONTENT).interstitial, { found: false, pass: true, share: null });
});

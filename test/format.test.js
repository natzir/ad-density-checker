import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowTarget, comparisonRows, cruxColumnLabel, cruxStatusLine, pageParts, progressAnnouncement, resultAnnouncement, snapshotLabel, sparkline, stopNotice, afterTestNote, testSparkline, verdict, coveredNotice, unseenNote, snapshotMissingNote, gateNotice, viewBetterAds, viewTitle, chromeLine, chromeNotCountedNote, playerNote, redirectNotice } from '../lib/format.js';

test('comparisonRows shows dashes when nothing is known yet', () => {
  assert.deepEqual(comparisonRows(null, null), [
    ['Avg density', '—', '—'],
    ['Ad count', '—', '—'],
    ['Ad CPU', '—', '—'],
    ['Ad network', '—', '—'],
  ]);
});

test('comparisonRows formats test and CrUX values; the test has no CPU or network', () => {
  const measured = { avgDensity: 18.4, peakDensity: 41, avgCount: 1.62, cpuMs: null, networkKB: null };
  const crux = { density: 24, count: 2.1, cpuMs: 3100, networkKB: 2400 };
  assert.deepEqual(comparisonRows(measured, crux), [
    ['Avg density', '18%', '24%'],
    ['Ad count', '1.62', '2.10'],
    ['Ad CPU', '—', '3100 ms'],
    ['Ad network', '—', '2400 KB'],
  ]);
});

test('cruxStatusLine names the level, the form factor and the last day', () => {
  assert.equal(cruxStatusLine({ level: 'url', lastDate: '2026-09-28' }, 'PHONE'), 'CrUX: URL · phone · 28 days to 2026-09-28');
  assert.equal(cruxStatusLine({ level: 'origin', lastDate: null }, 'DESKTOP'), 'CrUX: origin · desktop');
});

test('cruxColumnLabel says when the CrUX figures are the whole site, not this URL', () => {
  assert.equal(cruxColumnLabel(null), 'CrUX p75');
  assert.equal(cruxColumnLabel({ level: 'url' }), 'CrUX p75');
  assert.equal(cruxColumnLabel({ level: 'origin' }), 'CrUX p75 · site');
});

test('sparkline maps 0–100 % to eight bar heights and keeps the last values', () => {
  assert.equal(sparkline([0, 50, 100]), '▁▅█');
  assert.equal(sparkline([0, 0, 100], 2), '▁█');
});

test('arrowTarget moves a radio group selection with the arrow keys, wrapping at the ends', () => {
  const devices = ['mobile', 'desktop'];
  assert.equal(arrowTarget(devices, 'mobile', 'ArrowRight'), 'desktop');
  assert.equal(arrowTarget(devices, 'mobile', 'ArrowDown'), 'desktop');
  assert.equal(arrowTarget(devices, 'desktop', 'ArrowRight'), 'mobile');
  assert.equal(arrowTarget(devices, 'desktop', 'ArrowLeft'), 'mobile');
  assert.equal(arrowTarget(devices, 'mobile', 'ArrowUp'), 'desktop');
  assert.equal(arrowTarget(['a', 'b', 'c'], 'b', 'ArrowLeft'), 'a');
  assert.equal(arrowTarget(devices, 'mobile', 'Enter'), null);
});

const BETTER = {
  device: 'desktop',
  content: { begin: 85, end: 15636 },
  contentDetected: true,
  stickyVideo: false,
  density: { value: 11, limit: 50, pass: true },
  largeSticky: { value: 5, limit: 30, pass: true, found: true },
  interstitial: { found: false, pass: true, share: null },
  ads: [],
};
const POP_UP = { found: true, pass: false, share: 100 };

test('pageParts shows the host without www and the path with its query', () => {
  assert.deepEqual(pageParts('https://www.lasexta.com/deportes/?a=1#top'), { host: 'lasexta.com', path: '/deportes/?a=1' });
});

test('verdict states each check: value, Pass or Fail in words, the bar and its limit, and only the notes that change the reading', () => {
  assert.deepEqual(verdict(BETTER), {
    // words, not only ✓/✕: screen readers say "multiplication x" for ✕
    density: { value: '11%', of: 'of the main content', pass: true, pill: '✓ Pass', fill: 11, limit: 50, note: '' },
    largeSticky: { value: '5%', pass: true, pill: '✓ Pass', detail: 'of the screen · limit 30%' },
    interstitial: { value: 'none', pass: true, pill: '✓ Pass', detail: 'no ad covered half the screen' },
  });
  const failed = verdict({ ...BETTER, contentDetected: false, stickyVideo: true, density: { value: 100, over: true, limit: 30, pass: false }, largeSticky: { value: 0, limit: 30, pass: true, found: false } });
  assert.deepEqual(failed.density, { value: '100%+', of: 'of the page', pass: false, pill: '✕ Fail', fill: 100, limit: 30, note: 'Main content not found · Sticky video ad: limit 30%' });
  assert.deepEqual(failed.largeSticky, { value: 'none', pass: true, pill: '✓ Pass', detail: 'no sticky ad at the bottom · limit 30%' });
});

test('verdict fails the interstitial check with the share of the screen the pop-up covered', () => {
  assert.deepEqual(verdict({ ...BETTER, interstitial: POP_UP }).interstitial, {
    value: '100% of the screen', pass: false, pill: '✕ Fail', detail: 'an ad covering half the screen or more, closed after 3 s like a reader would',
  });
});

test('verdict and the notes say when the pop-up is an ad gate, which Better Ads doesn\'t name and Chrome misses', () => {
  const gate = { found: true, pass: false, share: 78, gate: true };
  assert.deepEqual(verdict({ ...BETTER, interstitial: gate }).interstitial, {
    value: '78% of the screen', pass: false, pill: '✕ Fail', detail: 'an ad gate: the article is blurred until you get past the ad',
  });
  assert.equal(gateNotice({ interstitial: gate }),
    "Pop-up: an ad gate blurs the article until you get past its ad. Better Ads doesn't name this format, but it blocks the main content, as its pop-ups do; Chrome's check misses it.");
  assert.equal(gateNotice({ interstitial: POP_UP }), null);
  assert.equal(
    resultAnnouncement({ betterAds: { ...BETTER, interstitial: gate } }),
    'Test finished: Better Ads density 11%, pass; large sticky ad 5%, pass; pop-up: an ad gate blurring 78% of the screen, fail.',
  );
});

test('progressAnnouncement tells the time and the ads on screen, or that the test is paused', () => {
  assert.equal(progressAnnouncement({ elapsedMs: 23400, maxMs: 60000, density: 12 }), '23 s of 60 s, 12% ads on screen');
  assert.equal(progressAnnouncement({ elapsedMs: 30000, maxMs: 60000, density: null }), '30 s of 60 s, paused while the tab is hidden');
});

test('resultAnnouncement sums up the two Better Ads checks', () => {
  assert.equal(resultAnnouncement({ betterAds: BETTER }), 'Test finished: Better Ads density 11%, pass; large sticky ad 5%, pass.');
  assert.equal(
    resultAnnouncement({ betterAds: { ...BETTER, density: { value: 31, limit: 30, pass: false }, largeSticky: { value: 0, limit: 30, pass: true, found: false } } }),
    'Test finished: Better Ads density 31%, fail; no large sticky ad.',
  );
  assert.equal(
    resultAnnouncement({ betterAds: { ...BETTER, density: { value: 100, over: true, limit: 50, pass: false } } }),
    'Test finished: Better Ads density over 100%, fail; large sticky ad 5%, pass.',
  );
});

test('resultAnnouncement mentions an interstitial when one was found', () => {
  assert.equal(
    resultAnnouncement({ betterAds: { ...BETTER, interstitial: { found: true, pass: false, share: 87 } } }),
    'Test finished: Better Ads density 11%, pass; large sticky ad 5%, pass; pop-up / interstitial ad covering 87% of the screen, fail.',
  );
});

test('snapshotLabel counts an interstitial, drawn on the snapshot though not counted', () => {
  const ads = [{ kind: 'inline', counted: true, reason: null }, { kind: 'interstitial', counted: false, reason: 'interstitial' }];
  assert.equal(snapshotLabel({ betterAds: { ads } }), 'Snapshot of the page: 1 ad counted, 1 interstitial.');
});

test('snapshotLabel counts the ads drawn on the snapshot', () => {
  const a = (kind, counted, reason = null) => ({ kind, counted, reason });
  const ads = [a('inline', true), a('inline', true), a('sticky', true), a('inline', false, 'hidden'), a('skin', true), a('sticky', false, 'hidden')];
  assert.equal(snapshotLabel({ betterAds: { ads } }), 'Snapshot of the page: 2 ads counted, 2 sticky ads, 1 not counted.');
  assert.equal(snapshotLabel({ betterAds: { ads: [a('inline', true)] } }), 'Snapshot of the page: 1 ad counted.');
  assert.equal(snapshotLabel({ betterAds: { ads: [] } }), 'Snapshot of the page: no ads found.');
  // An ad nested in another isn't drawn: the label doesn't count it either.
  assert.equal(snapshotLabel({ betterAds: { ads: [...ads, a('inline', false, 'nested'), a('sticky', false, 'nested')] } }), 'Snapshot of the page: 2 ads counted, 2 sticky ads, 1 not counted.');
  assert.equal(snapshotLabel({ betterAds: { ads: [a('inline', true), a('inline', false, 'nested')] } }), 'Snapshot of the page: 1 ad counted.');
});

test('testSparkline keeps the whole test in at most width bars, the peak always shown', () => {
  const values = [0, 5, 10, 53, 12, 0, null, 20];
  assert.deepEqual(testSparkline(values, 32), { glyphs: ['▁', '▁', '▁', '▅', '▁', '▁', '▂'], peak: 3, value: 53 });
  const long = Array.from({ length: 60 }, (_, i) => (i === 41 ? 80 : 10));
  const line = testSparkline(long, 20);
  assert.equal(line.glyphs.length, 20);
  assert.equal(line.value, 80);
  assert.equal(line.glyphs[line.peak], '▇');
  assert.equal(testSparkline([null, null]), null);
});

test('stopNotice says why the test stopped before the bottom of the page, and whether that is expected', () => {
  assert.deepEqual(stopNotice('article-end'), { info: true, text: "Stopped at the end of the article. What follows (recommendations, comments, other articles) isn't main content, so Better Ads doesn't count it." });
  assert.deepEqual(stopNotice('next-article'), { info: true, text: "This page loads the next article as you scroll (infinite scroll). The test stopped at the end of this one; the articles after it aren't part of it." });
  assert.deepEqual(stopNotice('stuck'), { info: false, text: "Stopped where the page stopped scrolling (a paywall or an overlay may hold it); what's below wasn't measured." });
  assert.deepEqual(stopNotice('time'), { info: false, text: "The minute ran out before the bottom of the page; what's below wasn't measured." });
  assert.equal(stopNotice(null), null);
});

test('coveredNotice says when every ad found was behind something, likely a dialog left open', () => {
  const ads = (n) => Array.from({ length: n }, () => ({ counted: false, reason: 'hidden' }));
  assert.equal(coveredNotice({ covered: true, ads: ads(17) }), '17 ads were found but none could be seen: a dialog (cookies, sign-in) may have covered the page. Close it and run the test again.');
  assert.equal(coveredNotice({ covered: true, ads: ads(1) }), '1 ad was found but none could be seen: a dialog (cookies, sign-in) may have covered the page. Close it and run the test again.');
  assert.equal(coveredNotice({ covered: false, ads: ads(2) }), null);
  assert.equal(coveredNotice(undefined), null);
});

test('verdict says Not measured, not Pass, when no ad could be seen (a dialog left open)', () => {
  const v = verdict({ ...BETTER, covered: true, density: { value: 0, over: false, limit: 30, pass: true }, largeSticky: { value: 0, limit: 30, pass: true, found: false } });
  assert.deepEqual(v.density, { value: '—', of: 'no ad could be seen', pass: null, pill: 'Not measured', fill: 0, limit: 30, note: '' });
  assert.deepEqual(v.largeSticky, { value: '—', pass: null, pill: 'Not measured', detail: 'no ad could be seen · limit 30%' });
  assert.deepEqual(v.interstitial, { value: '—', pass: null, pill: 'Not measured', detail: 'no ad could be seen' });
});

test('resultAnnouncement says Better Ads was not measured when no ad could be seen', () => {
  assert.equal(resultAnnouncement({ betterAds: { ...BETTER, covered: true } }), 'Test finished: no ad could be seen, so Better Ads was not measured. A dialog may have covered the page.');
});

test('unseenNote counts the ads Chrome does not detect, by source', () => {
  const ad = (source, counted = true) => ({ source, counted });
  assert.equal(unseenNote({ ads: [ad('chrome'), ad('easylist'), ad('label'), ad('label', false)] }), "Includes 2 ads Chrome doesn't detect (1 by EasyList, 1 labelled as an ad).");
  assert.equal(unseenNote({ ads: [ad('easylist'), ad('easylist')] }), "Includes 2 ads Chrome doesn't detect (2 by EasyList).");
  assert.equal(unseenNote({ ads: [ad('label')] }), "Includes 1 ad Chrome doesn't detect (1 labelled as an ad).");
  assert.equal(unseenNote({ ads: [ad('chrome')] }), null);
});

test('afterTestNote tells how to see the page as usual after a phone test', () => {
  assert.equal(afterTestNote('mobile'), "The page still shows its phone version. Reload it to see it as usual.");
  assert.equal(afterTestNote('desktop'), null);
});

test('snapshotLabel names the Chrome view', () => {
  const ads = [{ kind: 'inline', counted: true }];
  assert.equal(snapshotLabel({ betterAds: { ads } }, 'chrome'), 'Snapshot of the page, Chrome view: 1 ad counted.');
  assert.equal(snapshotLabel({ betterAds: { ads: [] } }, 'chrome'), 'Snapshot of the page, Chrome view: no ads found.');
  assert.equal(snapshotLabel({ betterAds: { ads } }, 'real'), 'Snapshot of the page: 1 ad counted.');
});

test('snapshotLabel names interscrollers apart from sticky ads', () => {
  const ads = [
    { kind: 'inline', counted: true, reason: null },
    { kind: 'sticky', counted: true, reason: null },
    { kind: 'interscroller', counted: true, reason: null },
  ];
  assert.equal(snapshotLabel({ betterAds: { ads } }), 'Snapshot of the page: 1 ad counted, 1 sticky ad, 1 interscroller.');
});

test('snapshotMissingNote says why there is no snapshot: dropped to keep the last few, or the test\'s reason', () => {
  assert.equal(snapshotMissingNote({ snapshot: null, snapshotDropped: true }, 5), 'Only the last 5 snapshots are kept; run the test again to see this one.');
  assert.equal(snapshotMissingNote({ snapshot: null, snapshotIssue: "Chrome couldn't capture the screen 4 times (last: Unable to capture screenshot)." }, 5),
    "Snapshot unavailable. Chrome couldn't capture the screen 4 times (last: Unable to capture screenshot).");
  assert.equal(snapshotMissingNote({ snapshot: null }, 5), 'Snapshot unavailable.');
});

test('viewBetterAds picks the view\'s verdict, the Real one for a result made before the Chrome view', () => {
  const chrome = { ...BETTER, density: { value: 4, limit: 50, pass: true } };
  const test = { betterAds: BETTER, chromeView: { betterAds: chrome } };
  assert.equal(viewBetterAds(test, 'real'), BETTER);
  assert.equal(viewBetterAds(test, 'chrome'), chrome);
  assert.equal(viewBetterAds({ betterAds: BETTER }, 'chrome'), BETTER);
  const covered = { ...BETTER, covered: true };
  assert.equal(verdict(viewBetterAds({ betterAds: BETTER, chromeView: { betterAds: covered } }, 'chrome')).density.pill, 'Not measured');
});

test('viewTitle names the device and, in the Chrome view, what it counts', () => {
  assert.equal(viewTitle('mobile', 'real'), 'Better Ads · mobile');
  assert.equal(viewTitle('desktop', 'chrome'), "Better Ads · desktop · with Chrome's tags only");
});

test('chromeLine gives Chrome\'s own figures: its tags and its average share of the screen', () => {
  const ads = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), source: 'chrome' }));
  assert.equal(chromeLine({ chrome: { avgDensity: 17.6 }, betterAds: BETTER, chromeView: { betterAds: { ...BETTER, ads: ads(3) } } }), 'Chrome: 3 ads tagged · 18% of the screen on average');
  assert.equal(chromeLine({ chrome: { avgDensity: 2 }, betterAds: BETTER, chromeView: { betterAds: { ...BETTER, ads: [...ads(2), { id: 'n', source: 'chrome', counted: false, reason: 'nested' }] } } }), 'Chrome: 2 ads tagged · 2% of the screen on average');
  assert.equal(chromeLine({ chrome: { avgDensity: 2 }, betterAds: BETTER, chromeView: { betterAds: { ...BETTER, ads: ads(1) } } }), 'Chrome: 1 ad tagged · 2% of the screen on average');
  assert.equal(chromeLine({ chrome: { avgDensity: 0 }, betterAds: BETTER, chromeView: { betterAds: { ...BETTER, ads: [] } } }), 'Chrome: 0 ads tagged · 0% of the screen on average');
});

test('chromeNotCountedNote lists Chrome\'s tags the tool doesn\'t count and why; outside and nested ones aren\'t disagreements', () => {
  const tag = (reason) => ({ source: 'chrome', counted: false, reason });
  assert.equal(chromeNotCountedNote({ ads: [tag('hidden'), tag('hidden'), tag('outside'), tag('nested'), { source: 'chrome', counted: true }] }),
    "Chrome tags 2 elements that aren't counted: 2 behind the page's content.");
  assert.equal(chromeNotCountedNote({ ads: [tag('outside')] }), null);
});

test('chromeNotCountedNote skips an interstitial, names an unmapped reason, and says "1 element" in the singular', () => {
  const tag = (reason) => ({ source: 'chrome', counted: false, reason });
  assert.equal(chromeNotCountedNote({ ads: [tag('interstitial')] }), null);
  assert.equal(chromeNotCountedNote({ ads: [tag('interstitial'), tag('hidden')] }), "Chrome tags 1 element that isn't counted: 1 behind the page's content.");
  assert.equal(chromeNotCountedNote({ ads: [tag('mystery')] }), "Chrome tags 1 element that isn't counted: 1 for another reason.");
  assert.equal(chromeNotCountedNote({ ads: [tag(undefined)] }), "Chrome tags 1 element that isn't counted: 1 for another reason.");
});

test('chromeNotCountedNote names the pieces of content video players, in the singular and the plural', () => {
  const tag = (reason) => ({ source: 'chrome', counted: false, reason });
  assert.equal(chromeNotCountedNote({ ads: [tag('hidden'), tag('content-video')] }),
    "Chrome tags 2 elements that aren't counted: 1 behind the page's content, 1 piece of a content video player.");
  assert.equal(chromeNotCountedNote({ ads: [tag('content-video'), tag('content-video')] }),
    "Chrome tags 2 elements that aren't counted: 2 pieces of content video players.");
});

test('redirectNotice says where the page sent the reader, with no click or tap, and that the tab went back', () => {
  assert.equal(redirectNotice({ redirect: { to: 'safedevice.click', via: 'webtransit.live', atMs: 32800 } }),
    "Auto-redirect: 33 s into the test, with no click or tap, the page sent the reader to safedevice.click (through webtransit.live). Google counts this as an abusive experience; Better Ads doesn't name it. The test stopped there, with what it had measured, and the tab went back to the article.");
  assert.equal(redirectNotice({ redirect: { to: 'scam.example', via: null, atMs: 5000 } }).startsWith('Auto-redirect: 5 s into the test, with no click or tap, the page sent the reader to scam.example. Google'), true);
  assert.equal(redirectNotice({}), null);
  assert.equal(redirectNotice(undefined), null);
});

test('the result announcement leads with an auto-redirect', () => {
  const said = resultAnnouncement({ betterAds: BETTER, redirect: { to: 'safedevice.click', via: null, atMs: 1000 } });
  assert.ok(said.startsWith('Test stopped: the page sent the reader to safedevice.click with no click or tap.'));
});

test('playerNote says a content video player isn\'t counted and the ads it plays aren\'t measured', () => {
  assert.equal(playerNote({ ads: [{ counted: false, reason: 'content-video' }] }),
    "A video player showing videos, not ads, isn't counted as an ad. The ads it plays (pre-rolls, mid-rolls) fall under Better Ads' short-form video standard, which this test doesn't measure.");
  assert.equal(playerNote({ ads: [{ counted: false, reason: 'hidden' }] }), null);
  assert.equal(playerNote(undefined), null);
});

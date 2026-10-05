// Display helpers for the side panel.

export const DASH = '—';

const pct = (v) => (v == null ? DASH : `${Math.round(v)}%`);
const count = (v) => (v == null ? DASH : Number(v).toFixed(2));
const ms = (v) => (v == null ? DASH : `${Math.round(v)} ms`);
const kb = (v) => (v == null ? DASH : `${Math.round(v)} KB`);

export function comparisonRows(test, crux) {
  return [
    ['Avg density', pct(test?.avgDensity), pct(crux?.density)],
    ['Ad count', count(test?.avgCount), count(crux?.count)],
    ['Ad CPU', ms(test?.cpuMs), ms(crux?.cpuMs)],
    ['Ad network', kb(test?.networkKB), kb(crux?.networkKB)],
  ];
}

// Why the test stopped before the bottom of the page, if it did. info: the stop is expected (past the
// article, nothing below counts for Better Ads); otherwise part of the page may be missing.
export function stopNotice(stoppedAt) {
  if (stoppedAt === 'article-end') return { info: true, text: "Stopped at the end of the article. What follows (recommendations, comments, other articles) isn't main content, so Better Ads doesn't count it." };
  if (stoppedAt === 'next-article') return { info: true, text: "This page loads the next article as you scroll (infinite scroll). The test stopped at the end of this one; the articles after it aren't part of it." };
  if (stoppedAt === 'stuck') return { info: false, text: "Stopped where the page stopped scrolling (a paywall or an overlay may hold it); what's below wasn't measured." };
  if (stoppedAt === 'time') return { info: false, text: "The minute ran out before the bottom of the page; what's below wasn't measured." };
  return null;
}

// After a phone test the tab keeps the phone version the test loaded (it isn't reloaded at the end).
export function afterTestNote(device) {
  return device === 'mobile' ? "The page still shows its phone version. Reload it to see it as usual." : null;
}

// Why the snapshot is missing: dropped to keep only the last few, or what the test said (Chrome failing the
// captures, the page at another pixel ratio).
export function snapshotMissingNote(test, keep) {
  if (test?.snapshotDropped) return `Only the last ${keep} snapshots are kept; run the test again to see this one.`;
  return test?.snapshotIssue ? `Snapshot unavailable. ${test.snapshotIssue}` : 'Snapshot unavailable.';
}

// A video player showing videos (the site's, or news clips a video network supplies) isn't in the density:
// the ads it plays have a standard of their own.
export function playerNote(betterAds) {
  if (!betterAds?.ads?.some((a) => a.reason === 'content-video')) return null;
  return "A video player showing videos, not ads, isn't counted as an ad, nor as a sticky pop-out video ad when it floats: Better Ads leaves out the ads played before or during the site's own videos. Those ads (pre-rolls, mid-rolls) fall under its short-form video standard, which this test doesn't measure.";
}

// The page sent the reader to another site with no click or tap: Google's abusive experience (auto-redirect).
export function redirectNotice(test) {
  const r = test?.redirect;
  if (!r) return null;
  return `Auto-redirect: ${Math.round(r.atMs / 1000)} s into the test, with no click or tap, the page sent the reader to ${r.to}${r.via ? ` (through ${r.via})` : ''}. Google counts this as an abusive experience; Better Ads doesn't name it. The test stopped there, with what it had measured, and the tab went back to the article.`;
}

// An ad gate fails as a pop-up though no standard names it: the panel says why.
export function gateNotice(betterAds) {
  if (!betterAds?.interstitial?.gate) return null;
  return "Pop-up: an ad gate blurs the article until you get past its ad. Better Ads doesn't name this format, but it blocks the main content, as its pop-ups do; Chrome's check misses it.";
}

// When every ad found was behind something: the 0 % reads like a pass but likely isn't one.
export function coveredNotice(betterAds) {
  if (!betterAds?.covered) return null;
  const n = betterAds.ads.length;
  return `${n} ${n === 1 ? 'ad was' : 'ads were'} found but none could be seen: a dialog (cookies, sign-in) may have covered the page. Close it and run the test again.`;
}

// The CrUX column's header: the figures fall back to the whole site when the URL has none.
export function cruxColumnLabel(crux) {
  return crux?.level === 'origin' ? 'CrUX p75 · site' : 'CrUX p75';
}

export function cruxStatusLine(crux, formFactor) {
  const parts = ['CrUX: ' + (crux.level === 'url' ? 'URL' : 'origin'), formFactor.toLowerCase()];
  if (crux.lastDate) parts.push(`28 days to ${crux.lastDate}`);
  return parts.join(' · ');
}

const BARS = '▁▂▃▄▅▆▇█';

// Density samples (0–100) as a text sparkline on a fixed scale.
export function sparkline(values, width = 24) {
  return values
    .slice(-width)
    .map((v) => BARS[Math.min(7, Math.max(0, Math.floor((v / 100) * 8)))])
    .join('');
}


// The value an arrow key selects in a radio group (wrapping at the ends), or null for other keys.
export function arrowTarget(values, current, key) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[key];
  if (!step) return null;
  return values[(values.indexOf(current) + step + values.length) % values.length];
}

// The page line: host without "www." and the path with its query.
export function pageParts(url) {
  const { hostname, pathname, search } = new URL(url);
  return { host: hostname.replace(/^www\./, ''), path: `${pathname}${search}` };
}

const mark = (pass) => (pass ? '✓' : '✕');

// The Better Ads card: each check's value, Pass or Fail, the density bar against its limit, and
// only the notes that change how the figure reads (whole page used, sticky video limit).
export function verdict({ contentDetected, stickyVideo, density, largeSticky, interstitial, covered }) {
  const word = (pass) => `${mark(pass)} ${pass ? 'Pass' : 'Fail'}`;
  // No ad could be seen (a dialog left open): a 0 % would read as a pass it isn't.
  if (covered) {
    return {
      density: { value: '—', of: 'no ad could be seen', pass: null, pill: 'Not measured', fill: 0, limit: density.limit, note: '' },
      largeSticky: { value: '—', pass: null, pill: 'Not measured', detail: `no ad could be seen · limit ${largeSticky.limit}%` },
      interstitial: { value: '—', pass: null, pill: 'Not measured', detail: 'no ad could be seen' },
    };
  }
  const notes = [];
  if (!contentDetected) notes.push('Main content not found');
  if (stickyVideo) notes.push(`Sticky video ad: limit ${density.limit}%`);
  return {
    density: {
      value: density.over ? '100%+' : `${density.value}%`,
      of: contentDetected ? 'of the main content' : 'of the page',
      pass: density.pass,
      pill: word(density.pass),
      fill: Math.min(100, density.value),
      limit: density.limit,
      note: notes.join(' · '),
    },
    largeSticky: {
      value: largeSticky.found ? `${largeSticky.value}%` : 'none',
      pass: largeSticky.pass,
      pill: word(largeSticky.pass),
      detail: `${largeSticky.found ? 'of the screen' : 'no sticky ad at the bottom'} · limit ${largeSticky.limit}%`,
    },
    // A pop-up or prestitial fails on its own, whatever the density.
    interstitial: {
      value: interstitial.found ? `${interstitial.share}% of the screen` : 'none',
      pass: interstitial.pass,
      pill: word(interstitial.pass),
      detail: interstitial.gate ? 'an ad gate: the article is blurred until you get past the ad'
        : interstitial.found ? 'an ad covering half the screen or more, closed after 3 s like a reader would' : 'no ad covered half the screen',
    },
  };
}

export function progressAnnouncement({ elapsedMs, maxMs, density }) {
  const time = `${Math.round(elapsedMs / 1000)} s of ${Math.round(maxMs / 1000)} s`;
  return density == null ? `${time}, paused while the tab is hidden` : `${time}, ${density}% ads on screen`;
}

export function resultAnnouncement({ betterAds: { density, largeSticky, interstitial, covered }, redirect }) {
  const lead = redirect ? `Test stopped: the page sent the reader to ${redirect.to} with no click or tap. Up to then: ` : 'Test finished: ';
  if (covered) return `${lead}no ad could be seen, so Better Ads was not measured. A dialog may have covered the page.`;
  const word = (pass) => (pass ? 'pass' : 'fail');
  const sticky = largeSticky.found ? `large sticky ad ${largeSticky.value}%, ${word(largeSticky.pass)}` : 'no large sticky ad';
  const popUp = interstitial.gate ? `; pop-up: an ad gate blurring ${interstitial.share}% of the screen, ${word(interstitial.pass)}`
    : interstitial.found ? `; pop-up / interstitial ad covering ${interstitial.share}% of the screen, ${word(interstitial.pass)}` : '';
  return `${lead}Better Ads density ${density.over ? 'over 100' : density.value}%, ${word(density.pass)}; ${sticky}${popUp}.`;
}

// The whole test's ads-on-screen line in at most width bars: the samples split evenly, each bar the
// highest value of its part, so the peak always shows; peak is the bar that holds it.
export function testSparkline(values, width = 32) {
  const seen = values.filter((v) => v != null);
  if (!seen.length) return null;
  const parts = Math.min(width, seen.length);
  const bars = Array.from({ length: parts }, (_, i) => Math.max(...seen.slice(Math.floor((i * seen.length) / parts), Math.floor(((i + 1) * seen.length) / parts))));
  const peak = bars.indexOf(Math.max(...bars));
  return { glyphs: bars.map((b) => BARS[Math.min(7, Math.max(0, Math.floor((b / 100) * 8)))]), peak, value: Math.round(bars[peak]) };
}

// What the snapshot strip shows, for screen readers (same ads as the drawn marks); the Chrome view says so.
export function snapshotLabel({ betterAds: { ads } }, view = 'real') {
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const counted = ads.filter((a) => a.counted && a.kind === 'inline').length;
  const sticky = ads.filter((a) => a.counted && a.kind !== 'inline' && a.kind !== 'interscroller').length; // sticky ads and skins
  const interscrollers = ads.filter((a) => a.counted && a.kind === 'interscroller').length;
  const notCounted = ads.filter((a) => !a.counted && a.kind === 'inline' && a.reason !== 'nested').length; // nested: not drawn
  const interstitials = ads.filter((a) => a.kind === 'interstitial').length; // drawn, though not counted
  const parts = [];
  if (counted) parts.push(count(counted, 'ad counted', 'ads counted'));
  if (sticky) parts.push(count(sticky, 'sticky ad', 'sticky ads'));
  if (interscrollers) parts.push(count(interscrollers, 'interscroller', 'interscrollers'));
  if (interstitials) parts.push(count(interstitials, 'interstitial', 'interstitials'));
  if (notCounted) parts.push(`${notCounted} not counted`);
  return `Snapshot of the page${view === 'chrome' ? ', Chrome view' : ''}: ${parts.length ? parts.join(', ') : 'no ads found'}.`;
}

// The ads in the Better Ads figure that Chrome doesn't tag, in words; null when there are none.
export function unseenNote({ ads }) {
  const counted = ads.filter((a) => a.counted && a.source && a.source !== 'chrome');
  if (!counted.length) return null;
  const lists = counted.filter((a) => a.source === 'easylist').length;
  const labels = counted.length - lists;
  const parts = [lists && `${lists} by EasyList`, labels && `${labels} labelled as ${labels === 1 ? 'an ad' : 'ads'}`].filter(Boolean);
  return `Includes ${counted.length} ${counted.length === 1 ? 'ad' : 'ads'} Chrome doesn't detect (${parts.join(', ')}).`;
}

// The verdict a view shows: the Chrome view's when the result has one (results made before it don't).
export function viewBetterAds(test, view) {
  return view === 'chrome' && test.chromeView ? test.chromeView.betterAds : test.betterAds;
}

// The title for a view: device name and, in the Chrome view, what it counts.
export function viewTitle(device, view) {
  return view === 'chrome' ? `Better Ads · ${device} · with Chrome's tags only` : `Better Ads · ${device}`;
}

// Chrome's own figures, the same in both views: how many elements it tagged and its average share of the
// screen (Blink's viewport rules). A tag inside another tag is the same ad, so only the outer ones count.
export function chromeLine(test) {
  const tags = (test.chromeView?.betterAds ?? test.betterAds).ads.filter((a) => (a.source ?? 'chrome') === 'chrome' && a.reason !== 'nested').length;
  return `Chrome: ${tags} ${tags === 1 ? 'ad' : 'ads'} tagged · ${Math.round(test.chrome.avgDensity)}% of the screen on average`;
}

// In the Chrome view, the tags Chrome puts on things the tool doesn't count, by reason. Outside the main
// content no view counts an ad, a tag inside another tag is the same ad, and a pop-up is judged by its own
// check: none of these is a disagreement.
const NOT_COUNTED = { hidden: ["behind the page's content"], 'content-video': ['piece of a content video player', 'pieces of content video players'] };
export function chromeNotCountedNote({ ads }) {
  const tags = ads.filter((a) => (a.source ?? 'chrome') === 'chrome' && !a.counted && !['outside', 'nested', 'interstitial'].includes(a.reason));
  if (!tags.length) return null;
  const byReason = new Map();
  for (const a of tags) byReason.set(a.reason, (byReason.get(a.reason) ?? 0) + 1);
  const parts = [...byReason].map(([reason, n]) => { const [one, many = one] = NOT_COUNTED[reason] ?? ['for another reason']; return `${n} ${n === 1 ? one : many}`; });
  return `Chrome tags ${tags.length} ${tags.length === 1 ? 'element' : 'elements'} that ${tags.length === 1 ? "isn't" : "aren't"} counted: ${parts.join(', ')}.`;
}

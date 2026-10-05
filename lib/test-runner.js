// The ad test: emulate a phone or a desktop, reload, scroll to the bottom while measuring ads
// with Chrome's ad tagging (Blink's density rules for the viewport metrics, Better Ads rules for the page).
import { clipArea, clipToViewport, timeWeightedAverage, viewportStats } from './ad-density.js';
import { evaluateBetterAds, isInterstitial } from './better-ads.js';
import { adScriptTracker, creatorAd, easylistWhy, ruleLabel } from './ad-scripts.js';
import { hostOf, matchAdRule, siteOf } from './adlist.js';
import { adItems, articleEndNow, contentBounds, dismissOverlay, hideFixedAds, hideFixedBars, labelledAdBoxes, markAdCandidates, markArticleEnd, showHidden } from './page-probes.js';
export const DEFAULTS = {
  settleMs: 3000,
  sampleMs: 1000,
  scrollEveryMs: 2000,
  maxMs: 60000, // of the tab visible: the minute stands still while it is hidden
  maxHiddenMs: 120000, // the longest the test waits for a hidden tab, in all (3 minutes with the minute)
  loadTimeoutMs: 30000,
  // A reader starts once the article is there, not when every ad has loaded: the test goes on this long after
  // the document is ready if the load event hasn't come by then (Newsweek's comes at 35 s, with ads loading on).
  readyMs: 5000,
  commandTimeoutMs: 15000,
  detachGraceMs: 1000,
  extraSamplesAtBottom: 2,
  stuckScrolls: 3,
  stackBudget: 150,
  dismissAfterSamples: 3, // an interstitial seen this many samples (about 3 s) is closed, like a reader would
};
export const PAGE_STATE_EXPR =
  '({ scrollY: window.scrollY, innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight, dpr: window.devicePixelRatio, hidden: document.visibilityState === \'hidden\' })';
export const SCROLL_EXPR = 'window.scrollBy(0, window.innerHeight)';
export const PAGE_INFO_EXPR = '({ href: location.href, lang: document.documentElement.lang })';
export const ZOOM_EXPR = 'window.devicePixelRatio';


const MIN_CONTENT_SHARE = 0.2;

// begin as measured with the page at the top; end from the first article on article pages, else
// as measured last. null when nothing was found or the range is implausibly small for the page
// as first loaded (then Better Ads uses the whole page).
function mainContent({ topBegin, last, articleEnd, pageHeight, referenceHeight }) {
  if (!last) return null;
  const begin = topBegin ?? last.begin;
  if (articleEnd && articleEnd > begin) return { begin, end: Math.min(articleEnd, pageHeight) };
  const end = Math.min(last.end, pageHeight);
  const found = begin > 0 || end < pageHeight;
  return found && end - begin >= (referenceHeight || pageHeight) * MIN_CONTENT_SHARE ? { begin, end } : null;
}
// Some pages drop content above the screen as they scroll (an infinite scroll recycling the earlier
// articles); Chrome then lowers scrollY to keep the screen in place, and everything below moves up.
// Returns that move (negative) when most ads seen in both samples moved up by a screen or more, else 0.
// No more can drop than lay above the screen: what was above it at the previous sample, plus the screen the
// test may have scrolled since. A page still at the top drops nothing; there, ads moving up are something
// above them shrinking (Fanpage's 3600 px placeholder collapsing at load), and they are where they now are.
function droppedAbove(previousTops, items, scrollY, viewportHeight, previousScrollY) {
  const moves = items.filter((item) => previousTops.has(item.id)).map((item) => item.y + scrollY - previousTops.get(item.id));
  const dropped = moves.filter((move) => move <= -viewportHeight && -move <= previousScrollY + viewportHeight + 2).sort((a, b) => a - b);
  return dropped.length * 2 > moves.length ? dropped[Math.floor(dropped.length / 2)] : 0;
}
// Chrome restores the scroll position on reload; the test must start at the top.
const SCROLL_RESTORATION_OFF = "try { history.scrollRestoration = 'manual'; } catch (error) {}";
const OBJECT_GROUP = 'ad-density-checker';

export class TestError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.name = 'TestError';
    this.code = code;
  }
}

// Web pages, except the Chrome Web Store: Chrome doesn't let extensions debug it.
export function canTest(url) {
  try {
    const { protocol, hostname, pathname } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return false;
    return hostname !== 'chromewebstore.google.com' && !(hostname === 'chrome.google.com' && pathname.startsWith('/webstore'));
  } catch {
    return false;
  }
}

export function mobileUserAgent(chromeMajor) {
  const v = String(chromeMajor);
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Mobile Safari/537.36`,
    userAgentMetadata: {
      brands: [
        { brand: 'Google Chrome', version: v },
        { brand: 'Chromium', version: v },
        { brand: 'Not=A?Brand', version: '24' },
      ],
      platform: 'Android',
      platformVersion: '11.0.0',
      architecture: '',
      model: 'moto g power (2022)',
      mobile: true,
    },
  };
}

export function desktopUserAgent(chromeMajor) {
  const v = String(chromeMajor);
  return {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
    userAgentMetadata: {
      brands: [
        { brand: 'Google Chrome', version: v },
        { brand: 'Chromium', version: v },
        { brand: 'Not=A?Brand', version: '24' },
      ],
      platform: 'macOS',
      platformVersion: '10.15.7',
      architecture: 'x86',
      model: '',
      mobile: false,
    },
  };
}

// Lighthouse's mobile and desktop profiles.
export const DEVICES = {
  mobile: { metrics: { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true }, userAgent: mobileUserAgent, touch: true },
  desktop: { metrics: { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false }, userAgent: desktopUserAgent, touch: false },
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cancelled(signal) {
  return signal.reason === 'tab-closed'
    ? new TestError('The tested tab was closed or left the page.', 'tab-closed')
    : new TestError('Test cancelled.', 'cancelled');
}

function checkCancelled(signal) {
  if (signal?.aborted) throw cancelled(signal);
}

const untilAborted = (signal) => new Promise((resolve) => {
  if (signal?.aborted) resolve();
  else signal?.addEventListener('abort', resolve, { once: true });
});

const DETACHED = /Detached while handling command|Debugger is not attached/;

// Every command gives up when the test is cancelled or Chrome doesn't answer in time
// (a JavaScript dialog on the page, a hung renderer), so cleanup always runs.
function guarded(cdp, signal, timeoutMs, detachGraceMs) {
  return {
    ...cdp,
    send(method, params) {
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          done();
          reject(cancelled(signal));
        };
        let timer = setTimeout(() => {
          done();
          reject(new TestError('The page stopped responding to the test (is a dialog open?).'));
        }, timeoutMs);
        const done = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        cdp.send(method, params).then(
          (value) => { done(); resolve(value); },
          (error) => {
            if (!DETACHED.test(error?.message)) {
              done();
              reject(error);
              return;
            }
            // Chrome fails pending commands just before it says why it detached (Cancel on the
            // debugging bar, tab closed): wait for that reason, which aborts the test.
            clearTimeout(timer);
            timer = setTimeout(() => { done(); reject(error); }, detachGraceMs);
          },
        );
      });
    },
  };
}

async function pageState(cdp) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: PAGE_STATE_EXPR, returnByValue: true });
  return result.value;
}

const attribute = (node, name) => {
  const a = node.attributes ?? [];
  for (let i = 0; i < a.length; i += 2) if (a[i] === name) return a[i + 1];
  return null;
};

// One read of the DOM: the elements Chrome tagged as ads (backendNodeIds, DOM order), the marked
// candidates outside them, each element's parent, and nodeId → backendNodeId.
async function readDom(cdp) {
  // pierce: the documents of same-origin iframes too. An ad frame Chrome tagged inside an iframe the
  // page's script wrote (a fallback ad written into an empty iframe) makes that iframe, the element
  // on the page, Chrome's ad: Chrome's own metrics count the ad frame.
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const chrome = [];
  const framed = new Set();
  const candidates = [];
  const parentOf = new Map();
  const backendOf = new Map();
  // Returns whether the subtree holds an ad Chrome tagged: a candidate around one (GPT's container
  // around its iframe) is left to Chrome, so the ad stays Chrome's. owner: the page's iframe whose
  // document the walk is in (null in the page itself).
  const walk = (node, parent, inAd, owner) => {
    let inside = inAd;
    let holds = false;
    let candidate = null;
    if (node.nodeType === 1) {
      parentOf.set(node.backendNodeId, parent);
      backendOf.set(node.nodeId, node.backendNodeId);
      if (node.adProvenance && owner == null) {
        chrome.push(node.backendNodeId);
        inside = true;
        holds = true;
      } else if (node.adProvenance && node.nodeName === 'IFRAME') {
        framed.add(owner);
        holds = true;
      } else if (owner == null && !inAd && attribute(node, 'data-adc-cand') !== null) {
        candidate = { nodeId: node.nodeId, backendNodeId: node.backendNodeId, iframeSrc: node.nodeName === 'IFRAME' ? attribute(node, 'src') : null, holdsChromeAd: false };
        candidates.push(candidate);
      }
    }
    const here = node.nodeType === 1 ? node.backendNodeId : parent;
    for (const child of node.children ?? []) holds = walk(child, here, inside, owner) || holds;
    if (node.contentDocument) holds = walk(node.contentDocument, here, inside, owner ?? node.backendNodeId) || holds;
    if (candidate) candidate.holdsChromeAd = holds;
    return holds;
  };
  walk(root, null, false, null);
  for (const id of framed) if (!chrome.includes(id)) chrome.push(id);
  return { root, chrome, candidates, parentOf, backendOf };
}

// The outermost elements ad scripts made (backendNodeId as text → why). checked keeps each node's
// answer (who created a node never changes); at most budget new nodes are asked per sample.
// A node already resolved as an ad that now holds a Chrome ad, or lies inside another ad, is added to
// superseded: the ad around it is the ad, and what was seen of it earlier is not another one. It leaves
// superseded only once measured as an ad again (not empty, not a frame), in the sample.
async function easylistAds(cdp, dom, checked, tracker, matchUrl, budget, superseded, frames) {
  const found = new Map();
  // Inside an element an ad script made that is still an ad: not a frame (its parts count), nor
  // superseded (a wrapper around a Chrome ad: what sits beside that ad is judged on its own).
  const insideAd = (id) => {
    for (let p = dom.parentOf.get(id); p != null; p = dom.parentOf.get(p)) {
      if (checked.get(p) && !frames.has(String(p)) && !superseded.has(String(p))) return true;
    }
    return false;
  };
  let asked = 0;
  for (const c of dom.candidates) {
    if (c.holdsChromeAd || insideAd(c.backendNodeId)) {
      if (checked.get(c.backendNodeId)) superseded.add(String(c.backendNodeId));
      continue;
    }
    if (!checked.has(c.backendNodeId)) {
      const frameRule = c.iframeSrc ? matchUrl(c.iframeSrc, 'subdocument') : null;
      if (frameRule) checked.set(c.backendNodeId, frameRule);
      else {
        if (asked >= budget) continue;
        asked += 1;
        try {
          const { creation } = await cdp.send('DOM.getNodeStackTraces', { nodeId: c.nodeId });
          const ad = creatorAd(creation, tracker);
          checked.set(c.backendNodeId, ad ? easylistWhy(ad) : null);
        } catch {
          // Not remembered: a transient error must not drop a real ad; a later sample asks again.
        }
      }
    }
    if (frames.has(String(c.backendNodeId))) continue;
    const why = checked.get(c.backendNodeId);
    if (why) found.set(String(c.backendNodeId), why);
  }
  return found;
}

// A box as wide as the screen (90 %) and taller than two screens: a page's frame, not an ad.
const isFrame = (box, viewport) => box.w >= viewport.width * 0.9 && box.h > viewport.height * 2;

// One item per ad element (see adItems in page-probes.js), in viewport coordinates, with its id,
// and the ad elements' remote objects (in OBJECT_GROUP, released by the caller once the sample ends):
// all of them, and by item id.
async function measureAds(cdp, ids) {
  const objectIds = [];
  const kept = [];
  for (const backendNodeId of ids) {
    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId, objectGroup: OBJECT_GROUP });
      objectIds.push(object.objectId);
      kept.push(backendNodeId);
    } catch {
      // Removed since the DOM read.
    }
  }
  const objectOf = new Map(kept.map((id, i) => [String(id), objectIds[i]]));
  if (!objectIds.length) return { items: [], objectIds, objectOf };
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objectIds[0],
    functionDeclaration: adItems.toString(),
    arguments: objectIds.map((objectId) => ({ objectId })),
    returnByValue: true,
  });
  return { items: result.value.flatMap((item, i) => (item ? [{ id: String(kept[i]), ...item }] : [])), objectIds, objectOf };
}

// Some sites serve no ads until a person interacts with the page (they sell no impressions to bots).
// Like a reader, the test moves the mouse once the page has loaded: along the screen's left edge, away
// from ads and menus that react to hovering, with no click and no scroll. The test's own ignoring of
// input is lifted for those two events (Chrome ignores the ones sent through CDP too).
async function moveMouseOnce(cdp, viewportHeight) {
  const y = Math.round(viewportHeight / 2);
  await cdp.send('Input.setIgnoreInputEvents', { ignore: false });
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: y + 20 });
  } finally {
    await cdp.send('Input.setIgnoreInputEvents', { ignore: true });
  }
}

// One screen as a JPEG, one image pixel per CSS pixel, for the result snapshot: { image } or, when Chrome
// can't capture it, { error } (the test goes on without that screen). With hideBarsFor (the sample's ad objects),
// the bars stuck to the top or bottom of the screen that hold no ad are hidden for the capture, and so are the
// fixed layers of the ads in hideFixed (already in an earlier screenshot).
async function captureScreen(cdp, state, deviceScaleFactor, hideBarsFor = null, hideFixed = []) {
  try {
    if (hideBarsFor?.length) {
      await cdp.send('Runtime.callFunctionOn', {
        objectId: hideBarsFor[0],
        functionDeclaration: hideFixedBars.toString(),
        arguments: hideBarsFor.map((objectId) => ({ objectId })),
        returnByValue: true,
      });
    } else if (hideBarsFor) {
      await cdp.send('Runtime.evaluate', { expression: `(${hideFixedBars})()`, returnByValue: true });
    }
    if (hideBarsFor && hideFixed.length) {
      await cdp.send('Runtime.callFunctionOn', {
        objectId: hideFixed[0],
        functionDeclaration: hideFixedAds.toString(),
        arguments: hideFixed.map((objectId) => ({ objectId })),
        returnByValue: true,
      });
    }
    // The clip is in screen pixels: with the browser zoomed, a CSS pixel is `zoom` screen pixels.
    const dpr = state.dpr ?? deviceScaleFactor;
    const zoom = dpr / deviceScaleFactor;
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 70,
      optimizeForSpeed: true,
      clip: { x: 0, y: state.scrollY * zoom, width: state.innerWidth * zoom, height: state.innerHeight * zoom, scale: 1 / dpr },
    });
    return { image: `data:image/jpeg;base64,${data}` };
  } catch (error) {
    if (error instanceof TestError && error.code !== 'error') throw error; // cancelled, tab closed
    return { error: error?.message ?? String(error) };
  } finally {
    if (hideBarsFor) await cdp.send('Runtime.evaluate', { expression: `(${showHidden})()` }).catch(() => {});
  }
}

// Two addresses on one site: the same registrable domain (siteOf: co.uk, com.ar and the like count as suffixes).
export function sameSite(a, b) {
  return siteOf(hostOf(a)) === siteOf(hostOf(b));
}

export async function runTest({
  cdp: rawCdp,
  chromeMajor,
  device = 'mobile',
  signal,
  onProgress = () => {},
  sleep = wait,
  now = Date.now,
  config = DEFAULTS,
  adRules,
}) {
  let tracing = false;
  let inputIgnored = false;
  const cdp = guarded(rawCdp, signal, config.commandTimeoutMs, config.detachGraceMs);
  try {
    try {
      await cdp.attach();
    } catch (error) {
      throw new TestError(`Can't test this tab: ${error.message}`);
    }
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    const profile = DEVICES[device];
    await cdp.send('Emulation.setDeviceMetricsOverride', profile.metrics);
    // A site zoomed in Chrome lays out wider or narrower than the profile (desktop at 90 %: 1500 px
    // wide). The screen is scaled by the zoom the page sees, so it gets the profile's CSS size.
    const { result: ratio } = await cdp.send('Runtime.evaluate', { expression: ZOOM_EXPR, returnByValue: true });
    const zoom = ratio.value / profile.metrics.deviceScaleFactor;
    if (zoom > 0 && Math.abs(zoom - 1) > 0.01) {
      const { width, height } = profile.metrics;
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...profile.metrics, width: Math.round(width * zoom), height: Math.round(height * zoom) });
    }
    await cdp.send('Emulation.setUserAgentOverride', profile.userAgent(chromeMajor));
    await cdp.send('Emulation.setTouchEmulationEnabled', profile.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });

    // Ads Chrome's cut-down list misses: scripts the full lists cover (or that such a script
    // loaded) and what they create, recorded from before the reload. The caller supplies the rules
    // for the page's language and host.
    const { result: info } = await cdp.send('Runtime.evaluate', { expression: PAGE_INFO_EXPR, returnByValue: true });
    const pageHost = hostOf(info.value.href);
    const rules = adRules(info.value.lang, pageHost);
    // The reason's text: the list the rule comes from, and the rule.
    const matchUrl = (url, type) => {
      const text = matchAdRule(rules, url, { type, pageHost });
      return text && `${rules.listOf?.get(text) ?? 'EasyList'} ${ruleLabel(text)}`;
    };
    const tracker = adScriptTracker(matchUrl);
    cdp.onEvent((method, params) => {
      if (method === 'Network.requestWillBeSent') tracker.onRequest({ url: params.request.url, type: params.type, initiator: params.initiator });
    });
    tracing = true; // first: a failure or cancel while Chrome applies it must still switch both off
    await cdp.send('Network.enable');
    await cdp.send('DOM.setNodeStackTracesEnabled', { enable: true });
    const checked = new Map(); // backendNodeId → why (an ad script made it) or null

    let loadEventReached = false;
    let loadDoneAt = null;
    let tested = null; // the main frame the reload committed
    const committed = cdp.waitFor('Page.frameNavigated', config.loadTimeoutMs, (p) => {
      if (p.frame.parentId) return false;
      tested = p.frame;
      return true;
    });
    const loaded = cdp.waitFor('Page.loadEventFired', config.loadTimeoutMs);
    const documentReady = cdp.waitFor('Page.domContentEventFired', config.loadTimeoutMs);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SCROLL_RESTORATION_OFF });
    // From the reload on, only the test scrolls: Chrome ignores the user's input on this tab (wheel,
    // trackpad, keys, clicks) without anything changing in the page, and the scrollbar is hidden.
    // Chrome lifts it when the debugger detaches, so a cancelled test never leaves the tab locked.
    inputIgnored = true; // first: a cancel while Chrome applies it must still turn it off
    await cdp.send('Input.setIgnoreInputEvents', { ignore: true });
    await cdp.send('Emulation.setScrollbarsHidden', { hidden: true });
    await cdp.send('Page.reload', { ignoreCache: true });
    // Until the reload commits, the page still shows the old document.
    await Promise.race([committed, untilAborted(signal)]);
    checkCancelled(signal);
    // A failed load commits Chrome's error page, which isn't the page to measure (and reloads itself).
    if (tested?.unreachableUrl || tested?.url?.startsWith('chrome-error:')) {
      throw new TestError("The page didn't load (network error). Check the connection and run the test again.", 'load-failed');
    }
    // Another document in the main frame (a link, a redirect or a reload by the page) ends the test;
    // ad frames navigating and URL changes within the page (an infinite scroll) don't. One on another site
    // is an auto-redirect (the test never clicks or taps): the test ends there with what it measured.
    let leftTo = null;
    let requestedTo = null; // where the page first asked to go off its site (the first hop of a redirect chain)
    let redirect = null;
    // An infinite scroll of articles moves the address to the next one in place (a different path;
    // a new query or fragment doesn't count): on an article page, the test stops there.
    let movedOnTo = null;
    let scrolled = false;
    const pathOf = (url) => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    };
    let basePath = pathOf(tested?.url);
    cdp.onEvent((method, params) => {
      if (method === 'Page.frameNavigated' && !params.frame.parentId) leftTo = params.frame.unreachableUrl ?? params.frame.url;
      if (method === 'Page.frameRequestedNavigation' && params.frameId === tested?.id && !sameSite(params.url, tested?.url)) requestedTo ??= params.url;
      if (method === 'Page.navigatedWithinDocument' && params.frameId === tested?.id) {
        // Before the first scroll it is the page tidying its own address (a trailing slash, a slug).
        if (!scrolled) basePath = pathOf(params.url);
        else if (pathOf(params.url) !== basePath) movedOnTo ??= params.url;
      }
    });
    const withoutFragment = (url) => url?.split('#')[0];
    // True once the page has gone to another site (hosts only are kept: a scam's address may carry the reader's
    // city and carrier); throws if it went elsewhere on its own site.
    const checkStillThere = () => {
      if (!leftTo) return false;
      if (hostOf(leftTo) && !sameSite(leftTo, tested?.url)) {
        const bare = (url) => hostOf(url).replace(/^www\./, '');
        redirect ??= { to: bare(leftTo), via: requestedTo && !sameSite(requestedTo, leftTo) ? bare(requestedTo) : null, atMs: Math.round(visibleMs()) };
        return true;
      }
      throw new TestError(
        withoutFragment(leftTo) === withoutFragment(tested?.url)
          ? 'The page reloaded itself during the test, so the test stopped.'
          : `The page went to ${leftTo} during the test, so the test stopped.`,
        'navigated',
      );
    };
    let readyAt = null;
    documentReady.then((ok) => {
      if (ok) readyAt ??= now();
    });
    loaded.then((ok) => {
      loadEventReached = ok;
      loadDoneAt ??= now();
    });

    const start = now();
    const samples = [];
    const observations = [];
    let pageHeight = 0;
    let viewport = { width: profile.metrics.width, height: profile.metrics.height };
    let pageTagged = false;
    let topBegin = null;
    let referenceHeight = null;
    let articleEnd = null;
    let endGap = null; // how far below the article's last paragraph its end was, at the top
    let grownEnd = null; // the article's end found again near it, when it grew or shrank since
    let lastBounds = null;
    // Page positions are kept in the layout the page had at the top: content dropped above the
    // screen is added back (shift is the total move, negative).
    let shift = 0;
    let previousTops = new Map();
    let previousScrollY = 0; // the page's scrollY at the previous sample: no more than that (and a screen) can drop above
    let lastScrollAt = null;
    let bottomSamples = 0;
    let stoppedAt = null; // 'article-end' | 'next-article' | 'stuck' | 'time' | 'redirect' when the test ends before the page's bottom
    let reachedBottom = false;
    let scrolledFrom = null; // where the page was when the test last scrolled it
    let stuckTries = 0; // scrolls in a row that didn't move the page
    let movedMouse = false; // the reader's one mouse move, once the page has loaded
    const tiles = [];
    const superseded = new Set(); // ad script elements that later turned out to be inside another ad, to hold a Chrome ad or the page's content, or a frame
    const labelSuperseded = new Set(); // labelled boxes that turned out to hold an ad Chrome or the lists found
    const labelReason = new Map(); // each labelled box's latest reason
    const labelGone = new Set(); // empty labelled slots the probe no longer returns: collapsed, hidden or removed
    const frames = new Set(); // ad script elements that are page-sized or hold the page's content: never one ad, their parts count
    const captured = new Set(); // page positions already captured
    const fixedShown = new Set(); // fixed and stuck ads, and ad gates, already in a screenshot
    const shownLayers = new Set(); // the fixed layers they were in: what else comes into one is the same thing
    const interstitialSamples = new Map(); // ad id → samples it was seen as an interstitial
    const dismissed = new Set(); // interstitials the test closed
    const dismissedLayers = new Set(); // the layers it closed them by
    // Why a test may end without a snapshot: Chrome failing the captures, or the page at another pixel ratio.
    let captureFailures = 0;
    let lastCaptureError = null;
    let skippedRatio = null; // the pixel ratio a screen was last skipped at
    // Chrome pauses its ad metrics while the tab is hidden, and the test can't scroll it: the minute is
    // the tab's visible time. A test stopped by a hidden tab would judge the page by its first screens.
    let hiddenTotal = 0; // ms hidden before the current stretch
    let hiddenSince = null; // when the current hidden stretch began
    let hiddenTooLong = false;
    const hiddenSoFar = () => hiddenTotal + (hiddenSince === null ? 0 : now() - hiddenSince);
    const visibleMs = () => now() - start - hiddenSoFar();

    while (visibleMs() < config.maxMs) {
      checkCancelled(signal);
      // The document is ready and the load event is late: go on as a reader would.
      if (loadDoneAt === null && readyAt !== null && now() - readyAt >= config.readyMs) loadDoneAt = now();
      if (checkStillThere()) {
        stoppedAt = 'redirect';
        break;
      }
      if (movedOnTo && articleEnd != null) {
        stoppedAt = 'next-article';
        break;
      }
      try {
        const state = await pageState(cdp);
        if (state.hidden) {
          // Chrome pauses its ad metrics while the page is hidden; so does the test.
          hiddenSince ??= now();
          if (hiddenSoFar() > config.maxHiddenMs) {
            hiddenTooLong = true;
            break;
          }
          samples.push({ t: now() - start, density: null, count: null });
          onProgress({ elapsedMs: visibleMs(), maxMs: config.maxMs, density: null, count: null });
          await sleep(config.sampleMs);
          continue;
        }
        if (hiddenSince !== null) {
          hiddenTotal += now() - hiddenSince;
          hiddenSince = null;
        }
        if (loadDoneAt !== null && !movedMouse) {
          movedMouse = true;
          await moveMouseOnce(cdp, state.innerHeight);
        }
        await cdp.send('Runtime.evaluate', { expression: `(${markAdCandidates})()`, returnByValue: true });
        const dom = await readDom(cdp);
        const easylist = await easylistAds(cdp, dom, checked, tracker, matchUrl, config.stackBudget, superseded, frames);
        const { items: measured, objectIds, objectOf } = await measureAds(cdp, [...dom.chrome, ...[...easylist.keys()].map(Number)]);
        for (const item of measured) {
          item.source = easylist.has(item.id) ? 'easylist' : 'chrome';
          item.why = easylist.get(item.id) ?? null;
        }
        // An ad script's element that shows nothing yet (an empty container) is not an ad yet.
        viewport = { width: state.innerWidth, height: state.innerHeight };
        // A frame (as wide as the screen and over two screens tall) an ad script made is no ad: its
        // parts are. An element marked while small may have grown into one. Nor is one that holds the
        // page's main, article or h1, however narrow (a skin's centred wrapper, an in-image vendor's
        // wrapper around the article).
        for (const item of measured) {
          if (item.source === 'easylist' && (isFrame(item, viewport) || item.holdsContent)) {
            frames.add(item.id);
            superseded.add(item.id);
          }
        }
        const items = measured.filter((item) => !(item.source === 'easylist' && (item.empty || frames.has(item.id))));
        // An ad script's element found again and kept (it shows something) is no longer superseded; one
        // seen empty stays superseded (a container whose Chrome ad left is no ad of its own).
        for (const item of items) if (item.source === 'easylist') superseded.delete(item.id);
        // Boxes labelled as advertising that hold none of those ads: measured on their own, after them.
        // An empty one still counts (a slot labelled as an ad is one); a page-sized frame never does.
        const found = items.filter((item) => !item.page).map((item) => objectOf.get(item.id));
        const { result: labels } = found.length
          ? await cdp.send('Runtime.callFunctionOn', { objectId: found[0], functionDeclaration: labelledAdBoxes.toString(), arguments: found.map((objectId) => ({ objectId })), returnByValue: true })
          : await cdp.send('Runtime.evaluate', { expression: `(${labelledAdBoxes})()`, returnByValue: true });
        if (found.length) {
          // Boxes the probe left to an ad: measured empty earlier, they count as the ad they hold now.
          const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: dom.root.nodeId, selector: '[data-adc-label-ad]' });
          for (const nodeId of nodeIds) {
            const id = dom.backendOf.get(nodeId);
            if (id !== undefined) labelSuperseded.add(String(id));
          }
        }
        const labelledNow = new Set();
        if (labels.value?.length) {
          // Each box's reason is read from the box itself: page scripts may move boxes between the
          // probe and this query, so the two lists' orders can differ.
          const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: dom.root.nodeId, selector: '[data-adc-label]' });
          const why = new Map();
          for (const nodeId of nodeIds) {
            const id = dom.backendOf.get(nodeId);
            if (id === undefined) continue;
            try {
              const reason = attribute(await cdp.send('DOM.getAttributes', { nodeId }), 'data-adc-label');
              if (reason) why.set(String(id), reason);
            } catch (error) {
              if (error instanceof TestError) throw error; // cancelled, tab closed, page not responding
              // Removed since the query.
            }
          }
          for (const [id, reason] of why) {
            labelledNow.add(id);
            labelReason.set(id, reason);
            labelGone.delete(id);
          }
          const labelled = await measureAds(cdp, [...why.keys()].map(Number));
          for (const item of labelled.items) {
            item.source = 'label';
            item.why = why.get(item.id);
            if (!isFrame(item, viewport)) items.push(item);
          }
          objectIds.push(...labelled.objectIds);
          for (const [id, objectId] of labelled.objectOf) objectOf.set(id, objectId);
        }
        // An empty slot counts while it takes room: one the probe no longer returns took none (the
        // article moved up into its place). One that held something stays, like a taken-down ad.
        for (const [id, reason] of labelReason) {
          if (reason.endsWith('· empty slot') && !labelledNow.has(id) && !labelSuperseded.has(id)) labelGone.add(id);
        }
        shift += droppedAbove(previousTops, items, state.scrollY, state.innerHeight, previousScrollY);
        previousTops = new Map(items.map((item) => [item.id, item.y + state.scrollY]));
        previousScrollY = state.scrollY;
        pageHeight = Math.max(pageHeight, state.scrollHeight - shift);
        const { density, count } = viewportStats(items.filter((item) => item.visible && item.source === 'chrome'), viewport);
        pageTagged ||= items.some((item) => item.page && item.source === 'chrome');
        const elapsedMs = now() - start;
        samples.push({ t: elapsedMs, density, count, pageTop: Math.round(state.scrollY - shift) });
        const sampleObservations = observations.length;
        for (const item of items.filter((i) => !i.page)) {
          observations.push({
            id: item.id,
            shown: item.shown,
            behindPage: item.behindPage,
            wallpaper: item.wallpaper,
            scrollY: state.scrollY,
            pageTop: item.y + state.scrollY - shift,
            viewportTop: item.y,
            height: item.h,
            x: item.x,
            width: item.w,
            visibleArea: clipArea(clipToViewport(item, viewport)),
            nested: item.nested,
            video: item.video,
            player: item.player,
            playerKey: item.playerKey,
            overlay: item.overlay,
            overContent: item.overContent,
            bottomHit: item.bottomHit,
            layer: item.layer,
            gate: item.gate,
            stuck: item.stuck,
            layerArea: item.layerArea,
            source: item.source,
            why: item.why,
          });
          const seen = observations[observations.length - 1];
          if (!seen.nested && isInterstitial(seen, viewport)) interstitialSamples.set(item.id, (interstitialSamples.get(item.id) ?? 0) + 1);
        }
        if (state.scrollY === 0) referenceHeight = state.scrollHeight;
        // With every ad element measured, Chrome's and the ad scripts' alike (not the page tagged as
        // one, nor pixels): an aside an ad fills is the ad's slot, not the article's end.
        const adObjects = items.filter((item) => !item.page).map((item) => objectOf.get(item.id));
        const { result: bounds } = adObjects.length
          ? await cdp.send('Runtime.callFunctionOn', {
            objectId: adObjects[0],
            functionDeclaration: contentBounds.toString(),
            arguments: [{ value: referenceHeight ?? 0 }, ...adObjects.map((objectId) => ({ objectId }))],
            returnByValue: true,
          })
          : await cdp.send('Runtime.evaluate', { expression: `(${contentBounds})(${referenceHeight ?? 0})`, returnByValue: true });
        if (bounds.value) {
          // The header stays at the top; the end markers moved up with the dropped content.
          lastBounds = { ...bounds.value, end: bounds.value.end - shift };
          // Taken with the page at the top: an infinite scroll may append the next articles inside
          // the first one, moving its bottom down as the test scrolls.
          if (state.scrollY === 0) {
            topBegin = bounds.value.begin;
            articleEnd = bounds.value.articleEnd;
            if (articleEnd != null) {
              const { result: mark } = await cdp.send('Runtime.evaluate', { expression: `(${markArticleEnd})(${articleEnd})`, returnByValue: true });
              endGap = mark.value ?? null;
            }
          }
        }
        onProgress({ elapsedMs: visibleMs(), maxMs: config.maxMs, density, count });

        // Scroll only once the page has loaded (or timed out) and settled.
        const settled = loadDoneAt !== null && now() - loadDoneAt >= config.settleMs;
        // One screenshot per screen once the page has settled, at its first-layout position.
        const at = Math.round(state.scrollY - shift);
        // The clip is made for the pixel ratio the page had at the start, which the emulated screen was built
        // for: while the page reports another, a screenshot would come out wrong (Ideal desktop once had its
        // first screen at half scale, the next ones blank). That screen waits for a later sample.
        const sameRatio = !(ratio.value > 0 && state.dpr > 0) || Math.abs(state.dpr / ratio.value - 1) <= 0.01;
        if (settled && !captured.has(at) && !sameRatio) skippedRatio = state.dpr;
        if (settled && !captured.has(at) && sameRatio) {
          captured.add(at);
          // The site's fixed bars and boxes (header, subscription…) show in the first screenshot that has
          // them and are hidden from the later ones, as are the fixed ads and ad gates an earlier screenshot
          // has (a gate's panel may be sticky down the article), and the ads a sticky box holds on screen (a rail
          // ad following the reader down its column), so each shows once.
          // A layer already in a screenshot hides whatever is in it now: The US Sun's floating player gets new
          // ad pieces for each ad it plays.
          const repeated = items.filter((item) => (item.fixed || item.gate || item.stuck) && (fixedShown.has(item.id) || shownLayers.has(item.layer))).map((item) => item.id);
          const later = captured.size > 1;
          const { image, error: captureError } = await captureScreen(
            cdp, state, profile.metrics.deviceScaleFactor,
            objectIds, later ? repeated.map((id) => objectOf.get(id)) : [],
          );
          if (!image) {
            captureFailures += 1;
            lastCaptureError = captureError;
          } else {
            // This sample's observations show where each ad sits in this screenshot (hidden ones don't). A layer
            // hidden for one of its ads hides them all: an ad gate's piece that loaded after the gate's first
            // screenshot isn't in this one either.
            const hiddenLayers = new Set(later ? items.filter((item) => item.layer && repeated.includes(item.id)).map((item) => item.layer) : []);
            for (let i = sampleObservations; i < observations.length; i++) {
              const o = observations[i];
              if (!later || (!repeated.includes(o.id) && !hiddenLayers.has(o.layer))) o.tile = tiles.length;
            }
            // Seen: on top, or a video player showing the site's video (its ad pieces lie under its own controls),
            // or in a fixed layer drawn on screen (The US Sun's Brightcove player floats in a corner down the whole
            // article; while it plays an ad, Google IMA's pieces in it are hidden by CSS).
            for (const item of items) {
              if (!(item.fixed || item.gate || item.stuck) || !(item.shown === true || item.player === 'content' || item.layerOnScreen)) continue;
              fixedShown.add(item.id);
              if (item.layer) shownLayers.add(item.layer);
            }
            tiles.push({ pageTop: at, image });
          }
        }
        // A reader closes a pop-up ad after a few seconds: an interstitial seen for that long is hidden
        // for the rest of the test (and never shown again), so Chrome's figures and the page's ads are
        // measured under it; what was seen of it stays for Better Ads. It waits for a screenshot that
        // holds it, unless this screen was captured already (no screenshot of it will come). Once.
        for (const item of items) {
          if (dismissed.has(item.id) || (interstitialSamples.get(item.id) ?? 0) < config.dismissAfterSamples) continue;
          if (!fixedShown.has(item.id) && !captured.has(at)) continue;
          dismissed.add(item.id);
          // One close per layer: the pieces of a pop-up (an ad gate's ads) go with it.
          if (item.layer && dismissedLayers.has(item.layer)) continue;
          if (item.layer) dismissedLayers.add(item.layer);
          try {
            await cdp.send('Runtime.callFunctionOn', {
              objectId: objectOf.get(item.id),
              functionDeclaration: dismissOverlay.toString(),
              arguments: [{ objectId: objectOf.get(item.id) }],
              returnByValue: true,
            });
          } catch (error) {
            if (error instanceof TestError) throw error; // cancelled, tab closed, page not responding
            // The page failed it: the ad stays as it is, and the test goes on.
          }
        }
        const atBottom = state.scrollY + state.innerHeight >= state.scrollHeight - 2;
        // On an article page, the screen past the article's end has seen all of it.
        let pastArticle = articleEnd != null && state.scrollY - shift + state.innerHeight >= articleEnd;
        // The article may have grown since (images and ads filling in above its end): the block that
        // ended it, or its last paragraph, tells where the end is now; blocks loaded since between
        // the text and that block (more recommendations) end it first, as this sample measured.
        if (pastArticle && endGap != null) {
          const measured = bounds.value?.articleEnd ?? null;
          const { result: end } = adObjects.length
            ? await cdp.send('Runtime.callFunctionOn', {
              objectId: adObjects[0],
              functionDeclaration: articleEndNow.toString(),
              arguments: [{ value: endGap }, { value: measured }, ...adObjects.map((objectId) => ({ objectId }))],
              returnByValue: true,
            })
            : await cdp.send('Runtime.evaluate', { expression: `(${articleEndNow})(${endGap}, ${measured})`, returnByValue: true });
          if (end.value != null) {
            grownEnd = end.value - shift;
            pastArticle = state.scrollY + state.innerHeight >= end.value;
          }
        }
        if (settled && (atBottom || pastArticle)) {
          bottomSamples += 1;
          if (bottomSamples > config.extraSamplesAtBottom) {
            if (atBottom) reachedBottom = true;
            else stoppedAt = 'article-end';
            break;
          }
        } else if (settled) {
          bottomSamples = 0;
          if (lastScrollAt === null || now() - lastScrollAt >= config.scrollEveryMs) {
            // A page that no longer moves when scrolled (a paywall sheet or an overlay holding it)
            // has shown all it will: the test stops there instead of waiting the minute out.
            stuckTries = scrolledFrom !== null && at <= scrolledFrom + 2 ? stuckTries + 1 : 0;
            if (stuckTries >= config.stuckScrolls) {
              stoppedAt = 'stuck';
              break;
            }
            scrolledFrom = at;
            await cdp.send('Runtime.evaluate', { expression: SCROLL_EXPR });
            lastScrollAt = now();
            scrolled = true;
          }
        }
      } catch (error) {
        checkCancelled(signal);
        if (error instanceof TestError) throw error;
        // Transient failure while the page navigates: skip this sample.
      } finally {
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => {});
      }
      await sleep(config.sampleMs);
    }

    checkCancelled(signal);
    checkStillThere();
    if (!samples.length) throw new TestError("Couldn't measure this page.");
    if (!reachedBottom && !stoppedAt) stoppedAt = 'time'; // the minute ran out with page still below
    if (samples.every((s) => s.density === null)) {
      throw new TestError('The tab was hidden for the whole test. Keep it visible and run again.');
    }
    if (hiddenTooLong) {
      throw new TestError(`The tab was hidden for over ${Math.round(config.maxHiddenMs / 60000)} minutes, so the test couldn't finish. Keep it visible and run again.`);
    }
    const endT = now() - start;
    // A test that ended before the bottom saw the page down to its lowest screen; what's below wasn't measured.
    const seenBottom = Math.max(...samples.filter((s) => s.pageTop != null).map((s) => s.pageTop + viewport.height));
    const measuredHeight = stoppedAt ? Math.min(pageHeight, seenBottom) : pageHeight;
    const content = mainContent({ topBegin, last: lastBounds, articleEnd: grownEnd ?? articleEnd, pageHeight: measuredHeight, referenceHeight });
    const series = (key) => samples.map((s) => ({ t: s.t, value: s[key] }));
    const hiddenMs = samples.reduce(
      (sum, s, i) => (s.density === null ? sum + ((samples[i + 1]?.t ?? endT) - s.t) : sum),
      0,
    );
    // The observations the verdict judges: superseded ad-script elements and labelled boxes that turned
    // out to hold an ad, or collapsed, are left out.
    const counted = observations.filter((o) => !superseded.has(o.id) && !(o.source === 'label' && (labelSuperseded.has(o.id) || labelGone.has(o.id))));
    const verdictInput = (list) => ({ observations: list, content, pageHeight: measuredHeight, viewport, device });
    const real = evaluateBetterAds(verdictInput(counted));
    return {
      device,
      durationMs: endT,
      // A page no taller than the screen can't be scrolled: a short page, an overlay blocking
      // scrolling, or a page that scrolls inside a container. Only the first screen was seen.
      scrollable: pageHeight > viewport.height + 2,
      hiddenMs,
      loadEventReached,
      documentReady: readyAt !== null,
      chrome: {
        avgDensity: timeWeightedAverage(series('density'), endT),
        peakDensity: samples.reduce((max, s) => Math.max(max, s.density ?? 0), 0),
        avgCount: timeWeightedAverage(series('count'), endT),
        cpuMs: null,
        networkKB: null,
        pageTagged,
      },
      betterAds: { ...real, contentDetected: Boolean(content) },
      // The same test seen as Chrome does: only the ads Chrome tagged, on the same main content. Whether
      // a dialog covered the page is a fact about the page, so both views share it: judged on Chrome's
      // tags alone it would say "covered" whenever only the label ads were shown.
      chromeView: {
        betterAds: { ...evaluateBetterAds(verdictInput(counted.filter((o) => o.source === 'chrome'))), covered: real.covered, contentDetected: Boolean(content) },
      },
      samples,
      stoppedAt,
      ...(redirect && { redirect }),
      snapshot: tiles.length ? { viewport, pageHeight: measuredHeight, tiles } : null,
      snapshotIssue: tiles.length ? null
        : captureFailures ? `Chrome couldn't capture the screen ${captureFailures} times (last: ${lastCaptureError}).`
          : skippedRatio != null ? `The page's pixel ratio changed during the test (${skippedRatio} instead of ${ratio.value}), so its screens couldn't be captured.`
            : 'No screen was captured.',
    };
  } finally {
    // Without waiting long for it: detaching lifts it anyway.
    if (inputIgnored) {
      await Promise.race([rawCdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {}), sleep(config.detachGraceMs)]);
    }
    if (tracing) {
      for (const [method, params] of [['DOM.setNodeStackTracesEnabled', { enable: false }], ['Network.disable', {}]]) {
        await Promise.race([rawCdp.send(method, params).catch(() => {}), sleep(config.detachGraceMs)]);
      }
    }
    // The tab is left as the test leaves it: detaching lifts the emulation, and another load right
    // after the test's own reload (with a different user agent) is what bot protections block.
    await rawCdp.detach();
  }
}

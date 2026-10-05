// A scripted page behind a fake CDP session, for test-runner tests.
import { PAGE_INFO_EXPR, PAGE_STATE_EXPR, SCROLL_EXPR, ZOOM_EXPR } from '../lib/test-runner.js';
import { adItems, articleEndNow, contentBounds, dismissOverlay, labelledAdBoxes, markAdCandidates, markArticleEnd } from '../lib/page-probes.js';

// ads: { id, pageTop, height } scroll with the page; { id, sticky: true, viewportTop, height } don't;
// hidden: true makes the in-page hit test fail (another layer on top); cssHidden: true hides it by CSS;
// nested / video flag an ad inside another ad / containing a <video>; player: what a video player showed
// ('ad', 'content' or null, as the probe says) and playerKey its player; page: the page itself is
// tagged (an ad skin on <body>). Every ad is 412 px wide unless it says width.
// content: the main content the page reports ({ begin, end }, or a function of scrollY and of the
// pixels dropped so far), or null. collapseAbove: { atTick, px } — from the atTick-th page state on, something
// above the ads shrinks by px (a tall placeholder collapsing at load, the page at the top): ads move up, scrollY
// stays. dropAbove: { atScrollY, px } — once a scroll reaches atScrollY, the
// page removes its first px pixels (an infinite scroll recycling earlier articles): ads there leave
// the DOM, everything below moves up, and Chrome lowers scrollY by px to keep the screen in place.
// detachOn: the command Chrome fails because the debugger was detached; afterDetach runs right
// after, as Chrome reports why (Cancel on the debugging bar, tab closed).
// events: [{ atTick, method, params }] fired when the runner reads the page state for the atTick-th time.
// commitFrame: the main frame the reload commits (Page.frameNavigated). lang: the page's <html lang>.
// ads may carry source: 'easylist', createdBy (the script URL its creation stack shows) and wraps (the id
// of a Chrome-tagged ad it contains); stackCalls counts DOM.getNodeStackTraces.
// An ad may also carry empty (it shows nothing), emptyUntil (empty until that sample) or emptyFrom (empty
// from that sample on), appearsAt (not in the page before that sample), goneAt (not in it from that sample on), wrapsFrom / wrapsUntil (the
// Chrome-tagged ad it wraps exists from that sample / until that sample), inside (the id of another
// ad that contains it once that one is in the page) and holdsContent (it holds the page's main, article
// or h1).
// An ad with source: 'label' is a plain box labelled as advertising (labelReason is why; heldFrom: from that
// sample on it holds an ad found by Chrome, so the probe leaves it to that ad); labelArgs records
// the ads each labels probe call was given; labelsReversed: the DOM lists the labelled boxes in the
// reverse of the order the probe gave their reasons (page scripts moved them in between).
// layerOnScreen: its fixed layer is drawn on screen, whatever the ad shows. shown: false says the probe never finds it on top (a player's ad pieces under its controls).
// stuck: a sticky box holds it on screen (a rail ad, position: sticky), with sticky: true, fixed: false and
// overlay: false. failCaptures: indexes of screenshot calls that fail. dismissOverlay on an ad closes it: from then on it
// has no box (adItems gives null), as with display: none; dismissed lists the ad objects it was called on.
// failDismiss: dismissOverlay fails (the page threw), and the ad stays. A sticky ad lies over the page's
// content (overContent) unless it says overContent: false (a skin behind the content, an interscroller),
// and the hit test at the bottom centre lands on it (bottomHit) unless it says bottomHit: false. A sticky
// ad is in a fixed layer of its own unless it names one (layer: ads naming the same one share it).
// behindFrom: from that sample on, the page's content covers the ad (an interscroller once its gap has
// scrolled by): not shown, behindPage. wallpaper: seen beside the page's content until then.
// stuckAt: the page refuses to scroll past this scrollY (a paywall sheet holding the page).
// articleGrowth: { gap, endNow } — the article's last paragraph is gap px above its end, which is at
// endNow px once the screen gets there (the article grew); absent, no paragraph is found.
export function fakeCdp({
  pageHeight = 3000,
  viewportWidth = 412,
  viewportHeight = 823,
  ads = [],
  growOnScroll = 0,
  failAttach = null,
  loadFires = true,
  loadAtTick = null, // the load event fires once the page state has been read this many times (ads loading on)
  vanishingAds = [],
  hiddenTicks = [],
  content = null,
  hangOn = null,
  failStackOnce = [], // ad ids whose first DOM.getNodeStackTraces rejects
  holdCommit = false,
  failEveryState = false,
  dropAbove = null,
  collapseAbove = null,
  detachOn = null,
  afterDetach = () => {},
  events = [],
  commitFrame = { id: 'main', url: 'https://news.example/' },
  lang = '',
  failCaptures = [],
  articleGrowth = null,
  stuckAt = null,
  labelsReversed = false,
  failDismiss = false,
  dpr, // window.devicePixelRatio the page reports (device scale × browser zoom); absent by default
  dprOff = null, // { ticks, value }: at those samples the page reports this devicePixelRatio instead
} = {}) {
  let scrollY = 0;
  let height = pageHeight;
  let dropped = 0;
  const shrunkNow = () => (collapseAbove && stateCalls - 1 >= collapseAbove.atTick ? collapseAbove.px : 0);
  let stateCalls = 0;
  let captureCalls = 0;
  const listeners = new Set();
  // A label ad with heldFrom holds an ad from that sample on: the probe leaves it to that ad.
  const heldNow = (a) => stateCalls - 1 >= (a.heldFrom ?? Infinity);
  // labelUntil: the probe stops returning the box from that sample on (collapsed, hidden); labelAgainAt: returns it again from that sample.
  const labelGoneNow = (a) => stateCalls - 1 >= (a.labelUntil ?? Infinity) && stateCalls - 1 < (a.labelAgainAt ?? Infinity);
  const labelAds = () => ads.filter((a) => a.source === 'label' && !heldNow(a) && !labelGoneNow(a));
  const labelReasons = () => labelAds().map((a) => a.labelReason);

  const cdp = {
    sent: [],
    contentArgs: [],
    contentAds: [],
    endNowCalls: [],
    endNowAds: [],
    captures: [],
    stackCalls: 0,
    labelArgs: [],
    dismissed: [],
    detached: false,
    async attach() {
      if (failAttach) throw new Error(failAttach);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    waits: [],
    waitFor(method, timeoutMs, predicate) {
      cdp.waits.push({ method, predicate });
      if (method === 'Page.frameNavigated' && holdCommit) {
        return new Promise((resolve) => { cdp.commit = () => resolve(true); });
      }
      if (method === 'Page.frameNavigated') predicate?.({ frame: commitFrame });
      if (method === 'Page.loadEventFired' && loadAtTick != null) return new Promise((resolve) => { cdp.fireLoad = () => resolve(true); });
      return Promise.resolve(loadFires);
    },
    async detach() {
      cdp.detached = true;
      listeners.clear();
    },
    async send(method, params = {}) {
      cdp.sent.push({ method, params });
      if (method === hangOn) return new Promise(() => {});
      if (method === detachOn) {
        setTimeout(afterDetach, 0);
        throw new Error('Detached while handling command.');
      }
      switch (method) {
        case 'Runtime.evaluate':
          if (params.expression === SCROLL_EXPR) {
            scrollY = Math.min(scrollY + viewportHeight, Math.max(0, height - shrunkNow() - viewportHeight));
            if (stuckAt != null) scrollY = Math.min(scrollY, stuckAt);
            height += growOnScroll;
            if (dropAbove && !dropped && scrollY >= dropAbove.atScrollY) {
              dropped = dropAbove.px;
              scrollY -= dropped;
              height -= dropped;
            }
            return { result: {} };
          }
          if (params.expression.startsWith(`(${contentBounds})(`)) {
            cdp.contentArgs.push(Number(params.expression.slice(`(${contentBounds})(`.length, -1)));
            const bounds = typeof content === 'function' ? content(scrollY, dropped) : content;
            return { result: { value: { begin: 0, end: height, articleEnd: null, ...bounds } } };
          }
          if (params.expression.startsWith(`(${markArticleEnd})(`)) return { result: { value: articleGrowth?.gap ?? null } };
          if (params.expression.startsWith(`(${articleEndNow})(`)) {
            cdp.endNowCalls.push(JSON.parse(`[${params.expression.slice(`(${articleEndNow})(`.length, -1)}]`));
            return { result: { value: articleGrowth?.endNow ?? null } };
          }
          if (params.expression === `(${labelledAdBoxes})()`) return { result: { value: labelReasons() } };
          if (params.expression === `(${markAdCandidates})()`) return { result: { value: 0 } };
          if (params.expression === PAGE_INFO_EXPR) return { result: { value: { href: commitFrame.url, lang } } };
          if (params.expression === ZOOM_EXPR) return { result: { value: dpr } };
          if (params.expression === PAGE_STATE_EXPR) {
            if (loadAtTick != null && stateCalls >= loadAtTick) cdp.fireLoad?.();
            if (failEveryState) throw new Error('Execution context was destroyed.');
            for (const event of events.filter((e) => e.atTick === stateCalls)) {
              for (const listener of [...listeners]) listener(event.method, event.params);
            }
            const ratio = dprOff?.ticks.includes(stateCalls) ? dprOff.value : dpr;
            const hidden = hiddenTicks.includes(stateCalls++);
            return { result: { value: { scrollY, innerWidth: viewportWidth, innerHeight: viewportHeight, scrollHeight: height - shrunkNow(), dpr: ratio, hidden } } };
          }
          return { result: {} };
        case 'Page.captureScreenshot': {
          const call = captureCalls++;
          cdp.captures.push({ scrollY, tick: stateCalls - 1, params });
          if (failCaptures.includes(call)) throw new Error('Unable to capture screenshot');
          return { data: `shot-${scrollY}` };
        }
        case 'DOM.getDocument': {
          const tick = stateCalls - 1;
          const present = (ad) => (ad.sticky || ad.pageTop >= dropped) && tick >= (ad.appearsAt ?? 0) && tick < (ad.goneAt ?? Infinity);
          const outerOf = (ad) => ads.find((other) => other.id === ad.inside && present(other));
          const build = (ad) => {
            if (ad.source === 'label') return { nodeType: 1, nodeId: 1000 + ad.id, backendNodeId: ad.id, children: [] };
            // inFrame: Chrome tagged an element inside a same-origin iframe the page's script wrote
            // (inFrameTag, IFRAME by default), not the iframe itself.
            if (ad.inFrame) {
              const tagged = { nodeType: 1, nodeName: ad.inFrameTag ?? 'IFRAME', nodeId: 6000 + ad.id, backendNodeId: 5000 + ad.id, adProvenance: {}, children: [] };
              return { nodeType: 1, nodeName: 'IFRAME', nodeId: 1000 + ad.id, backendNodeId: ad.id, children: [], contentDocument: { nodeType: 9, nodeId: 7000 + ad.id, backendNodeId: 8000 + ad.id, children: [tagged] } };
            }
            if (ad.source !== 'easylist') return { nodeType: 1, nodeId: 1000 + ad.id, backendNodeId: ad.id, adProvenance: {}, children: [] };
            const wrapped = ad.wraps && tick >= (ad.wrapsFrom ?? 0) && tick < (ad.wrapsUntil ?? Infinity)
              ? [{ nodeType: 1, nodeId: 1000 + ad.wraps, backendNodeId: ad.wraps, adProvenance: {}, children: [] }]
              : [];
            const inner = ads.filter((other) => other.inside === ad.id && present(other)).map(build);
            return { nodeType: 1, nodeId: 1000 + ad.id, backendNodeId: ad.id, attributes: ['data-adc-cand', ''], children: [...wrapped, ...inner] };
          };
          return {
            root: {
              nodeType: 9,
              nodeId: 1,
              backendNodeId: 1,
              children: [
                { nodeType: 1, nodeId: 2, backendNodeId: 2, attributes: ['data-adc-cand', ''], children: [] }, // page furniture
                ...ads
                  .filter((ad) => present(ad) && !outerOf(ad) && !ads.some((other) => other.wraps === ad.id))
                  .map(build),
              ],
            },
          };
        }
        case 'DOM.querySelectorAll':
          if (params.selector === '[data-adc-label-ad]') return { nodeIds: ads.filter((a) => a.source === 'label' && heldNow(a)).map((a) => 1000 + a.id) };
          if (params.selector !== '[data-adc-label]') return { nodeIds: [] };
          return { nodeIds: (labelsReversed ? [...labelAds()].reverse() : labelAds()).map((a) => 1000 + a.id) };
        case 'DOM.getAttributes': {
          const ad = labelAds().find((a) => 1000 + a.id === params.nodeId);
          return { attributes: ad ? ['data-adc-label', ad.labelReason] : [] };
        }
        case 'DOM.getNodeStackTraces': {
          cdp.stackCalls += 1;
          const flaky = failStackOnce.indexOf(params.nodeId - 1000);
          if (flaky >= 0) {
            failStackOnce.splice(flaky, 1);
            throw new Error('Cannot get stack');
          }
          const ad = ads.find((a) => 1000 + a.id === params.nodeId);
          return { creation: { callFrames: [{ url: ad?.createdBy ?? 'https://news.example/app.js' }] } };
        }
        case 'DOM.resolveNode':
          if (vanishingAds.includes(params.backendNodeId)) throw new Error('No node with given id found');
          return { object: { objectId: `obj-${params.backendNodeId}` } };
        case 'Runtime.callFunctionOn': {
          if (params.functionDeclaration === articleEndNow.toString()) {
            const [gap, measured, ...adArgs] = params.arguments;
            cdp.endNowCalls.push([gap.value, measured.value]);
            cdp.endNowAds.push(adArgs.map((a) => a.objectId));
            return { result: { value: articleGrowth?.endNow ?? null } };
          }
          if (params.functionDeclaration === contentBounds.toString()) {
            const [reference, ...adArgs] = params.arguments;
            cdp.contentArgs.push(reference.value);
            cdp.contentAds.push(adArgs.map((a) => a.objectId));
            const bounds = typeof content === 'function' ? content(scrollY, dropped) : content;
            return { result: { value: { begin: 0, end: height, articleEnd: null, ...bounds } } };
          }
          if (params.functionDeclaration === labelledAdBoxes.toString()) {
            cdp.labelArgs.push(params.arguments.map((a) => a.objectId));
            return { result: { value: labelReasons() } };
          }
          if (params.functionDeclaration === dismissOverlay.toString()) {
            if (failDismiss) throw new Error('Execution context was destroyed.');
            cdp.dismissed.push(...params.arguments.map((a) => a.objectId));
            return { result: { value: true } };
          }
          if (params.functionDeclaration !== adItems.toString()) return { result: {} };
          const value = params.arguments.map(({ objectId }) => {
            const ad = ads.find((a) => `obj-${a.id}` === objectId);
            if (cdp.dismissed.includes(objectId)) return null;
            const y = ad.sticky ? ad.viewportTop : ad.pageTop - dropped - shrunkNow() - scrollY;
            const h = ad.tallerFrom && stateCalls - 1 >= ad.tallerFrom.tick ? ad.tallerFrom.height : ad.height;
            const behind = stateCalls - 1 >= (ad.behindFrom ?? Infinity);
            return {
              x: 0, y, w: ad.width ?? 412, h,
              visible: !ad.hidden && !ad.cssHidden, shown: ad.shown ?? (ad.page ? false : !ad.cssHidden && !behind), nested: Boolean(ad.nested), video: Boolean(ad.video),
              behindPage: behind,
              wallpaper: Boolean(ad.wallpaper) && !behind,
              page: Boolean(ad.page),
              fixed: ad.fixed ?? Boolean(ad.sticky),
              overlay: ad.overlay ?? Boolean(ad.sticky),
              stuck: Boolean(ad.stuck),
              layerOnScreen: Boolean(ad.layerOnScreen),
              overContent: ad.overContent ?? Boolean(ad.sticky),
              bottomHit: ad.bottomHit ?? Boolean(ad.sticky),
              layer: ad.layer ?? (ad.sticky ? `layer-${ad.id}` : null),
              gate: Boolean(ad.gate),
              layerArea: ad.layerArea ?? null,
              player: ad.player ?? null,
              playerKey: ad.playerKey ?? null,
              empty: Boolean(ad.empty) || stateCalls - 1 < (ad.emptyUntil ?? 0) || stateCalls - 1 >= (ad.emptyFrom ?? Infinity),
              holdsContent: Boolean(ad.holdsContent),
            };
          });
          return { result: { value } };
        }
        default:
          return {};
      }
    },
  };
  return cdp;
}

// A clock that only moves when the runner sleeps.
export function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

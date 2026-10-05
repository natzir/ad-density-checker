// Better Ads Standards checks, computed from the ad positions recorded during the test.
// Ad density = share of the main content's height taken by ads ("ads that take up more than 30 % /
// 50 % of the vertical height of a page", betterads.org): every ad format counts, siderails too; a
// stretch of the page with ads counts once, however many ads sit side by side in it; a sticky ad's
// height counts once (several stuck to the same rows of the screen, once together).

export const LIMITS = {
  mobile: { density: 30, largeSticky: 30 },
  desktop: { density: 50, densityWithStickyVideo: 30, largeSticky: 30 },
};
const STICKY_TOLERANCE = 0.2;

// Blink's rule: the page scrolled more than the ad's height while the ad stayed
// within 20 % of its height on screen.
export function isSticky(observations) {
  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const anchor = observations[i];
      const other = observations[j];
      if (
        Math.abs(other.scrollY - anchor.scrollY) > anchor.height &&
        Math.abs(other.viewportTop - anchor.viewportTop) <= anchor.height * STICKY_TOLERANCE
      ) {
        return true;
      }
    }
  }
  return false;
}

const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const oneDecimal = (v) => Math.round(v * 10) / 10;
const tallestOf = (observations) => observations.reduce((a, o) => (o.height > a.height ? o : a));

// A skin: a sticky panel against the left or right edge of the screen, beside its centre and
// taller than half of it, or a wallpaper behind the page's content seen beside it (wallpaper: Vocento's
// wemass frame). A full-width sticky ad touches both edges but covers the centre. It counts like any
// sticky ad in the siderails (its height once); it is told apart for the snapshot.
const isSkin = (o, viewport) =>
  (o.x <= 2 || o.x + o.width >= viewport.width - 2) &&
  (o.x + o.width <= viewport.width / 2 || o.x >= viewport.width / 2) &&
  o.height >= viewport.height / 2;

// An interscroller: a creative fixed behind the article, seen only through a gap in it as the page
// scrolls by (Chrome's "parallax/scroller" ad). Sticky by its box, it is seen in some samples and, in
// others, wholly behind the page's content (behindPage). Its creative fills the screen, or half of it
// (a half-page parallax): larger than 30 % of the screen, Chrome's threshold for a large ad; a small
// floating box the page's content covers now and then stays a sticky ad. It isn't a sticky ad: out of the
// large sticky check; its height counts once in the density, as the gap's.
const isInterscroller = (observations, viewport) =>
  observations.some((o) => o.visibleArea > 0.3 * viewport.width * viewport.height) &&
  observations.some((o) => o.shown === true) && observations.some((o) => o.shown === false && o.behindPage);

// Chrome's large sticky ad check looks at the bottom centre of the screen, at 90 % of its height.
// An anchor ad entirely below that line is reported too: it covers less than 10 % of the screen,
// so it can't change the verdict, but "none" would contradict the ad the user sees.
const atBottomCentre = (o, viewport) =>
  o.x <= viewport.width / 2 && o.x + o.width >= viewport.width / 2 &&
  o.viewportTop + o.height >= viewport.height * 0.9 && o.viewportTop < viewport.height;

// Chrome reports an ad its hit test there keeps landing on while the page scrolls more than the ad's
// height, and starts over when the test lands elsewhere (Blink's StickyAdDetector): an ad that scrolls
// by, like an interscroller (a creative fixed behind a hole in the article), is no sticky ad.
// bottomHit: the probe's hit test landed on it. The observations of the runs that held.
function heldAtBottomCentre(observations, viewport) {
  const runs = [[]];
  for (const o of observations) {
    if (atBottomCentre(o, viewport) && o.bottomHit) runs[runs.length - 1].push(o);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  return runs.filter(isSticky).flat();
}

// A pop-up or prestitial: an ad in a layer fixed over the page (overlay: not a fixed app shell that
// holds the page), shown, covering half the screen or more, and lying over the page's content
// (overContent: not a wallpaper skin behind it, nor an interscroller behind a hole in the article).
// Or an ad in an ad gate (gate: a layer over the article that blurs it until the reader gets past the
// ad), whose part on screen is over 10 % of it — Chrome's threshold for a pop-up; Better Ads' pop-ups
// "block the main content of the page" and "can take up part of the screen". Better Ads fails it on its
// own; it isn't part of the density nor of the large sticky check.
export const isInterstitial = (o, viewport) =>
  Boolean(o.overlay) && Boolean(o.overContent) && o.shown === true &&
  (o.gate ? o.layerArea > 0.1 * viewport.width * viewport.height : o.visibleArea >= 0.5 * viewport.width * viewport.height);

// Counted unless the ad was seen on screen only hidden (behind page content, beside the screen):
// an ad never on screen during the test counts.
const counts = (observations) =>
  observations.some((o) => o.shown === true) || observations.every((o) => o.shown == null);

// Height of the stretches with ads, given as { top, bottom }: ads that share a stretch, stacked or
// side by side (the content column and a rail), count once.
function coveredHeight(ads) {
  let total = 0;
  let reach = -Infinity;
  for (const ad of [...ads].sort((a, b) => a.top - b.top)) {
    const from = Math.max(ad.top, reach);
    if (ad.bottom > from) total += ad.bottom - from;
    reach = Math.max(reach, ad.bottom);
  }
  return total;
}

// An ad inside another ad's box is the same ad (SunMedia's placeholder and its overlay: two trees,
// one box; two elements of one floating video unit). Same for sticky ads and skins.
// Chrome's ads stay as they are; an ad of an ad script is nested in the counted ad that holds its box
// (2 px of tolerance), unless that one is its twin from later in the list. A labelled box holds only
// other labelled boxes: around an ad Chrome or the lists found, it is that ad's slot (nestLabelsOverAds).
const BOX_TOLERANCE = 2;
// Inline entries are compared where the ad sits on the page; sticky ones, where it sits on screen.
const boxOf = (entry) => entry.screen ?? entry.ad;
const within = (inner, outer) =>
  inner.x >= outer.x - BOX_TOLERANCE && inner.x + inner.width <= outer.x + outer.width + BOX_TOLERANCE &&
  inner.top >= outer.top - BOX_TOLERANCE && inner.top + inner.height <= outer.top + outer.height + BOX_TOLERANCE;

function nestSameAds(entries) {
  for (const entry of entries) {
    const { ad } = entry;
    if (ad.source === 'chrome') continue;
    const holder = entries.find((other) => other !== entry && other.ad.counted && within(boxOf(entry), boxOf(other)) &&
      (other.ad.source !== 'label' || ad.source === 'label') &&
      (other.ad.source === 'chrome' || !within(boxOf(other), boxOf(entry)) || entries.indexOf(other) < entries.indexOf(entry)));
    if (!holder) continue;
    ad.counted = false;
    ad.reason = 'nested';
    ad.countedHeight = 0;
  }
  return entries.filter((entry) => entry.ad.counted);
}

// A labelled box over an ad Chrome or the lists found, of the same group, is that ad's slot: the
// slot and its ad are one ad, and SunMedia's overlay sits over its slot without being inside it (so
// containment can't tell). The ad wins; the box doesn't add its padding. Half of the smaller box.
const area = (b) => b.width * b.height;
const overlap = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};
function nestLabelsOverAds(entries) {
  for (const entry of entries) {
    if (entry.ad.source !== 'label' || !entry.ad.counted) continue;
    const mine = boxOf(entry);
    const over = entries.some((other) => other.ad.counted && (other.ad.source === 'chrome' || other.ad.source === 'easylist') &&
      overlap(mine, boxOf(other)) >= Math.min(area(mine), area(boxOf(other))) / 2);
    if (!over) continue;
    entry.ad.counted = false;
    entry.ad.reason = 'nested';
    entry.ad.countedHeight = 0;
  }
  return entries.filter((entry) => entry.ad.counted);
}

// content: { begin, end } in page pixels, or null to use the whole page.
export function evaluateBetterAds({ observations, content, pageHeight, viewport, device }) {
  const limits = LIMITS[device];
  const { begin, end } = content ?? { begin: 0, end: pageHeight };
  const byElement = new Map();
  for (const o of observations) {
    if (!byElement.has(o.id)) byElement.set(o.id, []);
    byElement.get(o.id).push(o);
  }

  // The layers pop-ups were seen in: another ad in one of them is a piece of that pop-up (a creative
  // made of several frames, stacked or side by side), judged with it, not an ad of its own.
  const popUpLayers = new Set(observations.filter((o) => o.layer && !o.nested && isInterstitial(o, viewport)).map((o) => o.layer));
  // An ad gate is one pop-up: the ad in it seen largest stands for it, the others are its pieces.
  const gateLead = new Map(); // gate layer → [id, visible area]
  for (const o of observations) {
    if (!o.gate || o.nested || !isInterstitial(o, viewport)) continue;
    const lead = gateLead.get(o.layer);
    if (!lead || o.visibleArea > lead[1]) gateLead.set(o.layer, [o.id, o.visibleArea]);
  }

  // The video players seen showing the site's own video: their ads (pre-rolls, mid-rolls) fall under Better
  // Ads' short-form video standard, not the page's density, so no piece of them counts, whatever played.
  const contentPlayers = new Set(observations.filter((o) => o.player === 'content' && o.playerKey).map((o) => o.playerKey));

  const inline = [];
  const stickies = []; // in screen coordinates: the rows they cover count once
  const ads = []; // every ad element and what the density made of it (for the snapshot)
  for (const [id, all] of byElement) {
    const decide = (o, kind, countedHeight, reason, adShare = null, tile = null) => {
      const ad = { id, top: o.pageTop, height: o.height, x: o.x, width: o.width, kind, counted: !reason, countedHeight, reason, share: adShare, tile, source: o.source ?? 'chrome', why: o.why ?? null };
      ads.push(ad);
      return ad;
    };
    const elementObservations = all.filter((o) => !o.nested); // the outer ad already covers the rest
    if (!elementObservations.length) {
      decide(all[all.length - 1], 'inline', 0, 'nested');
      continue;
    }
    const popUps = elementObservations.filter((o) => isInterstitial(o, viewport) && (!o.gate || gateLead.get(o.layer)?.[0] === id));
    if (popUps.length) {
      // Placed where a screenshot shows it, like a sticky ad; its share is the largest it covered. That
      // screenshot may predate its covering the screen's centre (Vozpópuli's gate, low on the screen that
      // first had it, then hidden from the later ones): any captured sight of it will do.
      const sightings = popUps.filter((o) => o.tile != null);
      const own = elementObservations.filter((o) => o.tile != null);
      // An ad gate's pieces share its layer: a piece that loaded after the gate's one screenshot is drawn
      // where another piece of it was captured.
      const layer = popUps.find((o) => o.gate)?.layer;
      const pieces = layer ? observations.filter((o) => o.layer === layer && !o.nested && o.tile != null) : [];
      const captured = sightings.length ? sightings : own.length ? own : pieces;
      const placed = tallestOf(captured.length ? captured : popUps);
      const largest = Math.max(...popUps.map((o) => (o.gate ? o.layerArea : o.visibleArea)));
      const ad = decide(placed, 'interstitial', 0, 'interstitial', Math.min(100, Math.round(share(largest, viewport.width * viewport.height))), placed.tile ?? null);
      if (popUps.some((o) => o.gate)) ad.gate = true;
      continue;
    }
    if (elementObservations.some((o) => popUpLayers.has(o.layer))) {
      decide(elementObservations[elementObservations.length - 1], 'sticky', 0, 'nested');
      continue;
    }
    const sticky = isSticky(elementObservations);
    // A piece of a video player that showed the site's video (Chrome tags every piece the ad script made,
    // whatever it plays: NY Post's news clips in Connatix's player) is no ad, wherever it was and whatever
    // covered it (its <video> lies under the player's own controls). A player only ever seen playing an ad
    // can't be told from a unit that is all ad: it counts.
    if (elementObservations.some((o) => o.player === 'content' || contentPlayers.has(o.playerKey))) {
      decide(elementObservations[elementObservations.length - 1], sticky ? 'sticky' : 'inline', 0, 'content-video');
      continue;
    }
    if (!counts(elementObservations)) {
      // Outside the main content it would not count anyway: that is the reason shown.
      const last = elementObservations[elementObservations.length - 1];
      const outside = !sticky && (last.pageTop + last.height <= begin || last.pageTop >= end);
      decide(last, sticky ? 'sticky' : 'inline', 0, outside ? 'outside' : 'hidden');
      continue;
    }
    if (sticky) {
      const tallest = tallestOf(elementObservations);
      const kind = isSkin(tallest, viewport) || elementObservations.some((o) => o.wallpaper) ? 'skin'
        : isInterscroller(elementObservations, viewport) ? 'interscroller' : 'sticky';
      const largest = Math.max(0, ...elementObservations.map((o) => o.visibleArea));
      // Its largest area while at the bottom centre (null: never there), for the large sticky check.
      const atBottom = kind === 'interscroller' ? [] : heldAtBottomCentre(elementObservations, viewport);
      const bottomArea = atBottom.length ? Math.max(...atBottom.map((o) => o.visibleArea)) : null;
      // Placed where a screenshot shows it (the snapshot draws it from that one), else where tallest.
      const captured = elementObservations.filter((o) => o.tile != null);
      const placed = captured.length ? tallestOf(captured) : tallest;
      // The screen's rows it covers where it covered the most (one sliding in, say): never more than the
      // screen, which is all a fixed ad can show (HuffPost's creative is 2118 px tall).
      const rowsOf = (o) => ({ top: Math.max(0, o.viewportTop), bottom: Math.min(viewport.height, o.viewportTop + o.height) });
      const span = (o) => Math.max(0, rowsOf(o).bottom - rowsOf(o).top);
      const rows = rowsOf(elementObservations.reduce((a, o) => (span(o) > span(a) ? o : a)));
      const ad = decide(placed, kind, Math.max(0, rows.bottom - rows.top), null, Math.min(100, Math.round(share(largest, viewport.width * viewport.height))), placed.tile ?? null);
      stickies.push({
        x: tallest.x, width: tallest.width, top: rows.top, bottom: rows.bottom,
        screen: { x: tallest.x, width: tallest.width, top: tallest.viewportTop, height: tallest.height },
        ad, video: elementObservations.some((o) => o.video), bottomArea,
      });
    } else {
      const last = elementObservations[elementObservations.length - 1];
      const top = Math.max(last.pageTop, begin);
      const bottom = Math.min(last.pageTop + last.height, end);
      if (bottom > top) {
        inline.push({ x: last.x, width: last.width, top, bottom, ad: decide(last, 'inline', bottom - top, null) });
      } else {
        decide(last, 'inline', 0, 'outside');
      }
    }
  }

  const countedStickies = nestLabelsOverAds(nestSameAds(stickies));
  // A skin's side panels: with a skin counted, an ad scrolling with the page against the left or right edge
  // of the screen, beside its centre, is that wallpaper's side (El Correo: wemass's canvas and Chrome's two
  // rails at the edges), counted once in the skin's rows.
  const skinCounted = countedStickies.some((s) => s.ad.kind === 'skin');
  const sidePanel = (e) => (e.x <= 2 || e.x + e.width >= viewport.width - 2) && (e.x + e.width <= viewport.width / 2 || e.x >= viewport.width / 2);
  for (const entry of skinCounted ? inline.filter(sidePanel) : []) {
    entry.ad.counted = false;
    entry.ad.reason = 'nested';
    entry.ad.countedHeight = 0;
  }
  const countedInline = inline.filter((entry) => entry.ad.counted);
  const adHeight = coveredHeight(nestLabelsOverAds(nestSameAds(countedInline))) + coveredHeight(countedStickies);
  // A sticky video ad on screen is a fact about the page: any sticky ad, counted or nested in one, says
  // so. The large sticky figure looks only at the sticky ads left counted: a nested one is part of the
  // ad that holds it, and a labelled slot over an ad does not add its padding.
  const stickyVideo = stickies.some((s) => s.video);
  const atBottomCentreAds = countedStickies.filter((s) => s.bottomArea != null);
  const stickyFound = atBottomCentreAds.length > 0;
  const stickyArea = Math.max(0, ...atBottomCentreAds.map((s) => s.bottomArea));
  // Ads can only take up all of the main content (a sticky ad's height comes on top of the stretches):
  // past it, the density reads 100 % and says so (shown as 100 %+).
  const raw = share(adHeight, end - begin);
  const density = Math.min(100, oneDecimal(raw));
  const densityLimit = device === 'desktop' && stickyVideo ? limits.densityWithStickyVideo : limits.density;
  const largeSticky = Math.min(100, Math.round(share(stickyArea, viewport.width * viewport.height)));
  const interstitials = ads.filter((a) => a.kind === 'interstitial');
  return {
    device,
    content: { begin, end },
    stickyVideo,
    density: { value: density, over: raw > 100, limit: densityLimit, pass: density <= densityLimit },
    // Every ad was behind something and none counted: likely a dialog (cookies, sign-in) left open.
    // An interstitial was seen: it is no such case.
    covered: ads.some((a) => a.reason === 'hidden') && !ads.some((a) => a.counted) && !interstitials.length,
    largeSticky: { value: largeSticky, limit: limits.largeSticky, pass: largeSticky <= limits.largeSticky, found: stickyFound },
    interstitial: {
      found: interstitials.length > 0, pass: !interstitials.length, share: interstitials.length ? Math.max(...interstitials.map((a) => a.share)) : null,
      ...(interstitials.some((a) => a.gate) && { gate: true }),
    },
    ads: ads.sort((a, b) => a.top - b.top),
  };
}

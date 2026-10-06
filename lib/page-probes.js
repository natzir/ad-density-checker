// Functions that run inside the tested page. They are sent as source text
// (Function.prototype.toString), so each one must be self-contained: no imports, no outer
// variables, only `window`, `document` and `getComputedStyle`. test/page-probes.test.js runs them
// against a stub DOM.

// One item per ad element, in viewport coordinates; boxes of 1 px or less are null.
// - visible: Blink's check for Chrome's viewport metrics — inside the viewport, a hit test at the
//   centre of its visible part lands on it; anywhere else it counts as visible.
// - shown: what Better Ads counts. null while the ad is above or below the screen (not judged
//   yet), unless fixed to the screen there; false when it is beside the screen, hidden by CSS or behind
//   page content; true when one of five points of its visible part lands on an ad (ads stacked on ads
//   count, a skin behind the content doesn't), or when it is a fixed anchor ad against the top or bottom
//   edge, at most half the screen (many ignore pointer events, so hit tests pass through them).
// - page: the page itself is tagged (<body>, <html>, or a wrapper over half the page, full width,
//   holding the page's main / article / h1), which happens when an ad script styles it as a skin.
//   Chrome's metrics count it; Better Ads doesn't, and it is never "an ad on top" of another.
// - player: what the video player with Google IMA's ad box it is part of showed (Connatix's, El País's): 'ad'
//   while IMA plays an ad in its box (a <video> of its own there), 'content' while only the player's own video
//   plays (the site's clip, which Chrome tags all the same: the ad script made the player), null when nothing
//   plays or there is no IMA box (an outstream unit is all ad). On Android and desktop IMA plays ads in its box;
//   it plays them in the player's video only on iOS. playerKey: that player's key, for judging its pieces together.
// - nested: inside another ad that isn't hidden; video: is or contains a <video>; fixed: in a layer
//   fixed to the screen (an anchor ad); stuck: held on screen by a sticky box that isn't the page's own
//   content (a rail ad that follows the reader down its column); overlay: in a fixed layer over the page — the outermost one
//   that holds none of the page's main, article or h1 (some pages live in a fixed app shell with its
//   own scroll: an ad in that shell is in the page, not over it). dismissOverlay hides that layer.
//   layer: that layer's key (its tag, id and box), the same for every ad in it; null when not in one.
//   layerOnScreen: that fixed layer is drawn on screen, whatever its ads show (a floating player's ad pieces
//   are hidden by CSS while it plays an ad).
// - gate: an ad gate holds it: a layer positioned over the page's content (absolute, fixed or sticky,
//   holding none of its main, article or h1) that blurs what lies under it (backdrop-filter), so the
//   article stays unreadable until the reader gets past the ad (membrana.media's reward modal on Diario de
//   Navarra). Better Ads' pop-up "blocks the main content of the page": the gate is that ad's pop-up layer
//   (overlay; layer: its key; overContent: at the screen's centre, where Chrome looks for pop-ups, it is on
//   top with the page's content under it — a frosted sticky header never is). layerArea: its part on
//   screen, for Chrome's 10 % of the screen.
// - overContent: an ad in an overlay covering half the screen or more lies over the page's content: at
//   the screen's centre it is on top, and under it lies something that is neither the ad, nor inside
//   it, nor around it (html and body are around it). A wallpaper skin behind the content isn't on top;
//   an interscroller (a creative fixed behind a hole in the article) has only its own slot and the
//   article around it underneath. false for any other ad.
// - bottomHit: the hit test of Chrome's large sticky ad check, at the bottom centre of the screen (half
//   its width, 90 % of its height), lands on it; an anchor ad counts as hit (many ignore pointer events).
//   An interscroller is hit only while its hole passes there.
// - behindPage: the page's own content covers an ad fixed to the screen (not an anchor ad): one of the five
//   points lands on something that scrolls with the page (not an ad, nothing fixed or sticky around it,
//   not html or body). An interscroller is covered so outside its gap in the article.
// - wallpaper: a skin behind the page: an ad fixed or sticky to the screen (not an anchor ad; wemass's is
//   sticky) with the page's own content over the centre of its visible part, and none over it at the side
//   of the screen (20 px in from the left or right edge, level with that centre: it is there, under nothing
//   that scrolls with the page and paints there — wemass lays an empty transparent layer as tall as the
//   page over its skin). An interscroller isn't: outside its gap the article covers the sides too, and
//   inside it nothing covers its centre.
// - empty: shows nothing — no media, frame, shadow root, text or background image.
// - holdsContent: holds the page's main, article or h1, however narrow (a skin's centred wrapper, an
//   in-image vendor's wrapper around the article): an ad script's element like that is never one ad.
export function adItems(...elements) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pageHeight = document.documentElement.scrollHeight;
  const boxes = elements.map((el) => el.getBoundingClientRect());
  const isPage = (el, r) =>
    el === document.body || el === document.documentElement ||
    (r.height >= pageHeight * 0.5 && r.width >= vw * 0.9 && Boolean(el.querySelector('main, article, h1')));
  const page = elements.map((el, i) => isPage(el, boxes[i]));
  const ads = new Set(elements.filter((_, i) => !page[i]));
  const withinAd = (node) => {
    for (let n = node; n; n = n.parentElement) if (ads.has(n)) return true;
    return false;
  };
  const isFixed = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  };
  const isAnchor = (el, r) => (r.top <= 2 || r.bottom >= vh - 2) && r.height <= vh / 2 && isFixed(el);
  const holdsPage = (n) => /^(main|article|h1)$/i.test(n.tagName) || Boolean(n.querySelector('main, article, h1'));
  // Held on screen by a sticky box that isn't the page's own content: a rail ad that follows the reader
  // down its column (CBS: div#mpu-plus-top-right-rail, position: sticky; top: 440px).
  const isStuck = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'sticky' && !holdsPage(n)) return true;
    }
    return false;
  };
  const layerOf = (el) => {
    let layer = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed' && !holdsPage(n)) layer = n;
    }
    return layer;
  };
  // A layer drawn on screen: a box there, not hidden by CSS, not transparent (whatever the ads in it show).
  const drawnOnScreen = (n) => {
    const r = n.getBoundingClientRect();
    const st = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw &&
      st.visibility !== 'hidden' && st.display !== 'none' && (st.opacity === '' || Number(st.opacity) > 0);
  };
  const layerKey = (layer) => {
    const r = layer.getBoundingClientRect();
    return `${layer.tagName}#${layer.id}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`;
  };
  const coversHalf = (r) =>
    Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top)) >= (vw * vh) / 2;
  const bottomCentre = document.elementFromPoint(Math.floor(vw / 2), Math.floor(vh * 0.9));
  const blurs = (n) => /blur\(/.test(getComputedStyle(n).backdropFilter || '');
  const positioned = (n) => /^(absolute|fixed|sticky)$/.test(getComputedStyle(n).position);
  const gateOf = (el) => {
    let gate = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (positioned(n) && blurs(n) && !holdsPage(n)) gate = n;
    return gate;
  };
  const onScreen = (r) => ({ x1: Math.max(0, r.left), x2: Math.min(vw, r.right), y1: Math.max(0, r.top), y2: Math.min(vh, r.bottom) });
  const overContent = (el) => {
    const [top, ...under] = document.elementsFromPoint(Math.floor(vw / 2), Math.floor(vh / 2));
    return Boolean(top) && el.contains(top) && under.some((n) => !el.contains(n) && !n.contains(el));
  };
  // Google IMA's ad boxes: the box around the SDK's frame, where it plays the ad in a <video> of its own.
  const imaBoxes = [...document.querySelectorAll('iframe[src*="imasdk.googleapis.com"]')].map((f) => f.parentElement).filter(Boolean);
  const plays = (v) => v.paused === false && !v.ended && v.currentTime > 0 && v.getBoundingClientRect().width > 1 && v.getBoundingClientRect().height > 1;
  const videosIn = (n) => (n.tagName === 'VIDEO' ? [n] : [...n.querySelectorAll('video')]);
  // The players, found from their videos (not IMA's own): from a video up to the outermost ancestor holding
  // an IMA box, at most half again its area (not a column holding another player) and short of the page's
  // content. A player shows an ad while a video in one of its IMA boxes plays, else content while a video
  // of its own plays.
  const area = (n) => { const r = n.getBoundingClientRect(); return r.width * r.height; };
  const players = [];
  for (const video of imaBoxes.length ? document.querySelectorAll('video') : []) {
    if (imaBoxes.some((b) => b.contains(video))) continue;
    let scope = null;
    for (let n = video; n && n !== document.body && !holdsPage(n) && area(n) <= 1.5 * area(video); n = n.parentElement) {
      if (imaBoxes.some((b) => n.contains(b))) scope = n;
    }
    if (!scope || players.some((p) => p.scope === scope)) continue;
    const boxes = imaBoxes.filter((b) => scope.contains(b));
    const shows = boxes.some((b) => videosIn(b).some(plays)) ? 'ad'
      : videosIn(scope).some((v) => plays(v) && !boxes.some((b) => b.contains(v))) ? 'content' : null;
    // Its key, the same from one sample to the next (data-adc-player), so its pieces are judged together.
    let key = scope.getAttribute('data-adc-player');
    if (key === null) {
      key = `p${document.querySelectorAll('[data-adc-player]').length + 1}`;
      scope.setAttribute('data-adc-player', key);
    }
    players.push({ scope, shows, key });
  }
  // Chrome tags each piece an ad script made (Connatix's <video>, its ad slots, its floating close bar, IMA's
  // frames): a piece of a player, or a box around one no more than half again its area, shows what it shows.
  const playerOf = (el) => players.find((p) => p.scope.contains(el)) ?? players.find((p) => el.contains(p.scope) && area(el) <= 1.5 * area(p.scope));

  // Cheap checks first; the shadow root scan walks every element inside.
  const MEDIA = ['iframe', 'img', 'video', 'canvas', 'svg', 'embed', 'object'];
  const isEmpty = (el) => {
    if (MEDIA.includes(el.tagName.toLowerCase()) || el.querySelector(MEDIA.join(','))) return false;
    if ((el.innerText ?? el.textContent ?? '').trim()) return false;
    if (getComputedStyle(el).backgroundImage !== 'none') return false;
    return !(el.shadowRoot || Array.from(el.querySelectorAll('*')).some((n) => n.shadowRoot));
  };

  // Paints nothing of its own at a point inside it: no background, no media, no text of its own (its
  // children, if any lie there, are hit tests of their own).
  const paintsNothing = (node) => {
    const style = getComputedStyle(node);
    return !MEDIA.includes(node.tagName.toLowerCase()) && style.backgroundImage === 'none' &&
      /^(transparent|rgba\(.*,\s*0\))$/.test(style.backgroundColor) &&
      !Array.from(node.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
  };

  const scrollsWithPage = (node) => {
    if (node === document.body || node === document.documentElement) return false;
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      const position = getComputedStyle(n).position;
      if (position === 'fixed' || position === 'sticky') return false;
    }
    return true;
  };

  const status = elements.map((el, i) => {
    const r = boxes[i];
    if (!(r.width > 1 && r.height > 1)) return null;
    if (page[i]) return { visible: true, shown: false, page: true };
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      return { visible: false, shown: false };
    }
    const x1 = Math.max(0, r.left);
    const x2 = Math.min(vw, r.right);
    // Above or below the screen it isn't judged yet, unless it is beside the screen too, or fixed to the
    // screen: scrolling never brings it on (HuffPost keeps two screen-sized tags parked at −412, −823).
    if (!(r.bottom > 0 && r.top < vh)) return { visible: true, shown: x2 > x1 && !isFixed(el) ? null : false };
    if (!(x2 > x1)) return { visible: true, shown: false };
    const y1 = Math.max(0, r.top);
    const y2 = Math.min(vh, r.bottom);
    const at = (fx, fy) => document.elementFromPoint(Math.floor(x1 + (x2 - x1) * fx), Math.floor(y1 + (y2 - y1) * fy));
    const centre = at(0.5, 0.5);
    const points = [centre, at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
    return {
      visible: Boolean(centre) && (centre === el || el.contains(centre)),
      shown: points.some((hit) => hit && withinAd(hit)) || isAnchor(el, r),
      behindPage: isFixed(el) && !isAnchor(el, r) && points.some((hit) => hit && !withinAd(hit) && scrollsWithPage(hit)),
      wallpaper: !scrollsWithPage(el) && !isAnchor(el, r) && Boolean(centre) && !withinAd(centre) && scrollsWithPage(centre) &&
        [20, vw - 21].some((x) => {
          const stack = document.elementsFromPoint(x, Math.floor((y1 + y2) / 2));
          const at = stack.findIndex((n) => el.contains(n));
          return at >= 0 && stack.slice(0, at).every((n) => !scrollsWithPage(n) || paintsNothing(n));
        }),
    };
  });

  const outer = new Set(elements.filter((_, i) => status[i] && status[i].shown !== false));
  const isNested = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) if (outer.has(n)) return true;
    return false;
  };
  return elements.map((el, i) => {
    if (!status[i]) return null;
    const r = boxes[i];
    const layer = layerOf(el);
    const gate = layer ? null : gateOf(el);
    const overlay = Boolean(layer || gate);
    const gateBox = gate ? onScreen(gate.getBoundingClientRect()) : null;
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible: status[i].visible,
      shown: status[i].shown,
      behindPage: Boolean(status[i].behindPage),
      wallpaper: Boolean(status[i].wallpaper),
      page: Boolean(status[i].page),
      nested: isNested(el),
      video: el.tagName === 'VIDEO' || Boolean(el.querySelector('video')),
      player: playerOf(el)?.shows ?? null,
      playerKey: playerOf(el)?.key ?? null,
      fixed: isFixed(el),
      stuck: isStuck(el),
      overlay,
      overContent: gate ? overContent(gate) : overlay && coversHalf(r) && overContent(el),
      gate: Boolean(gate),
      layerArea: gate ? Math.max(0, gateBox.x2 - gateBox.x1) * Math.max(0, gateBox.y2 - gateBox.y1) : null,
      bottomHit: (Boolean(bottomCentre) && el.contains(bottomCentre)) || isAnchor(el, r),
      layer: layer || gate ? layerKey(layer || gate) : null,
      layerOnScreen: Boolean(layer) && drawnOnScreen(layer),
      empty: isEmpty(el),
      holdsContent: Boolean(el.querySelector('main, article, h1')),
    };
  });
}

// The main content in page pixels, as Better Ads defines it: below the site header and navigation,
// above the site footer and the related / recommended blocks (found by markup or by their heading).
// referenceHeight is the page height before scrolling: infinite scroll grows the page, and the
// "lower part of the page" thresholds must not move with it. On a page declared as an article,
// articleEnd is where the article ends: below its text, at the first block that is not main content
// (what Blink's annotated page content calls complementary, navigation or footer; a recommendation
// feed; comments; a list of links to other stories) or the next story's headline. ads are the
// elements Chrome tags as ads: an aside an ad fills is the ad's slot, not complementary content.
export function contentBounds(referenceHeight, ...ads) {
  const sy = window.scrollY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pageHeight = document.documentElement.scrollHeight;
  const reference = referenceHeight || pageHeight;
  const isFixed = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const position = getComputedStyle(n).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };
  // An element with display: contents has no box of its own (El País and 20minutos wrap the article
  // in one): it covers what its children cover.
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    if ((r.width > 0 && r.height > 0) || getComputedStyle(el).display !== 'contents') return r;
    const kids = [...el.children].map(rectOf).filter((k) => k.width > 0 && k.height > 0);
    if (!kids.length) return r;
    const left = Math.min(...kids.map((k) => k.left));
    const top = Math.min(...kids.map((k) => k.top));
    const right = Math.max(...kids.map((k) => k.right));
    const bottom = Math.max(...kids.map((k) => k.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const box = (el) => {
    const r = rectOf(el);
    if (!(r.width > 0 && r.height > 0)) return null;
    const fixed = isFixed(el);
    const top = fixed ? r.top : r.top + sy;
    return { top, bottom: top + r.height, width: r.width, height: r.height, fixed };
  };

  // Anywhere on the first screen: a billboard ad above the header pushes it down.
  let begin = 0;
  for (const el of document.querySelectorAll('header, [role="banner"], nav, #header, .header, #masthead, .site-header, .navbar, .topbar')) {
    if (el.closest('footer, [role="contentinfo"], article, main')) continue;
    const b = box(el);
    if (b && b.top <= vh * 0.6 && b.height < vh * 0.6 && b.width >= vw * 0.5) begin = Math.max(begin, b.bottom);
  }

  // og:type article; JSON-LD Article types only when there is no og:type (homepages often list
  // NewsArticle items). Live blogs are one long article made of <article> posts: all of it counts.
  const ogType = document.querySelector('meta[property="og:type"]')?.content ?? '';
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
  const ldArticle = ld.some((t) => /"@type"\s*:\s*(\[[^\]]*)?"(News|Blog|Report|Opinion|Review|Analysis)?Article"/.test(t));
  const liveBlog = ld.some((t) => /"@type"\s*:\s*(\[[^\]]*)?"LiveBlogPosting"/.test(t));
  const isArticle = /article/i.test(ogType) || (!ogType && ldArticle);
  // The ads in page pixels, a sticky one where it sits now; not fixed ones, nor pixels.
  const adBoxes = ads.map((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return null;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return null;
    return { top: r.top + sy, bottom: r.bottom + sy, height: r.height };
  }).filter(Boolean);
  const holds = (b, a) => a.top >= b.top - 5 && a.bottom <= b.bottom + 5;
  // A block an ad fills is the ad's slot: an aside some sites put their ads in, a single ad unit a
  // feed's widget serves (MGID's).
  const slot = (b) => adBoxes.some((a) => holds(b, a) && a.height >= b.height / 2);
  // An article page whose site header isn't marked up: the article begins at its headline, or at
  // the ads above it.
  if (begin === 0 && isArticle) {
    const headline = [...document.querySelectorAll('h1')].map(box).find((b) => b && !b.fixed && b.width >= vw * 0.4 && b.top < vh * 2);
    if (headline) begin = Math.min(headline.top, ...adBoxes.filter((a) => a.top >= 0 && a.bottom <= headline.top + 5).map((a) => a.top));
  }

  let end = pageHeight;
  const below = (b, from) => b && !b.fixed && b.top > begin && b.top >= reference * from && b.width >= vw * 0.5;
  for (const el of document.querySelectorAll('footer, [role="contentinfo"], #footer, .site-footer')) {
    if (el.closest('article')) continue; // footers of article cards
    const b = box(el);
    if (below(b, 0.5) && b.height >= 100) end = Math.min(end, b.top);
  }
  const FEEDS = '[id*="taboola" i], [class*="taboola" i], [id*="outbrain" i], [class*="outbrain" i], [id*="addoor" i], [class*="addoor" i], [data-type="_mgwidget"]';
  for (const el of document.querySelectorAll(FEEDS)) if (below(box(el), 0.3) && !slot(box(el))) end = Math.min(end, box(el).top);
  // Related / recommended blocks by their whole heading; one repeated three or more times is a
  // section pattern of the page instead.
  const relatedHeading = /^(te puede interesar|tambi[eé]n te puede (interesar|gustar)|te puede gustar|quiz[aá]s te interese|te recomendamos|recomendad[oa]s?|noticias relacionadas|relacionad[oa]s|m[aá]s informaci[oó]n|otras noticias|lo [uú]ltimo|related( articles| stories)?|you may (also )?(like|be interested)|more (stories|news)|m[aá]s noticias|[uú]ltimas noticias|lo m[aá]s (le[ií]do|visto))\s*:?$/i;
  const headings = new Map();
  for (const el of document.querySelectorAll('h2, h3, h4, [class*="title" i], [class*="titulo" i]')) {
    const b = box(el);
    if (!b || b.height > 200) continue; // a container, not a heading: skip its text
    const text = el.textContent.trim().toLowerCase();
    if (text.length > 60 || !relatedHeading.test(text)) continue;
    if (!headings.has(text)) headings.set(text, []);
    headings.get(text).push(b);
  }
  for (const found of headings.values()) {
    if (found.length >= 3) continue;
    for (const b of found) if (below(b, 0.3)) end = Math.min(end, b.top);
  }

  let articleEnd = null;
  if (isArticle && !liveBlog) {
    const norm = (t) => t.replace(/\s+/g, ' ').trim();
    // Text as read: the CSS and scripts some blocks carry inside are not text.
    const textOf = (el) => {
      let text = el.textContent;
      for (const code of el.querySelectorAll('style, script, noscript')) text = text.replace(code.textContent, '');
      return norm(text);
    };
    const linkShare = (el) => {
      const all = textOf(el).length;
      let links = 0;
      for (const a of el.querySelectorAll('a')) links += norm(a.textContent).length;
      return all ? Math.min(1, links / all) : 0;
    };
    // The first article: the smallest of the large ones starting at the top (an outer one may wrap
    // the next articles too).
    const candidates = [...document.querySelectorAll('article, [role="article"], [itemtype*="Article"]')]
      .map((el) => ({ el, b: box(el) }))
      .filter(({ b }) => b && !b.fixed && b.width >= vw * 0.4 && b.height >= vh * 1.5 && b.top < begin + vh * 2);
    const topmost = Math.min(...candidates.map(({ b }) => b.top));
    const first = candidates.filter(({ b }) => b.top <= topmost + 20).sort((x, y) => x.b.height - y.b.height)[0] ?? null;
    // Its text: paragraphs and blocks of their own text across the text column, mostly not links,
    // outside the roles that aren't main content; those in the container holding most of the
    // paragraphs (their parent, and half to their grandparent: a long list doesn't choose it).
    const NON_MAIN = 'aside, nav, footer, header, [role="complementary"], [role="navigation"], [role="contentinfo"], [role="banner"]';
    const ownText = (el) => norm(el.tagName === 'P' ? el.textContent : [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
    const blocks = [...(first?.el ?? document).querySelectorAll('p, div, section, li, blockquote')]
      .filter((el) => ownText(el).length >= (el.tagName === 'P' ? 40 : 80))
      .map((el) => ({ el, b: box(el) }))
      .filter(({ el, b }) => b && !b.fixed && b.width >= vw * 0.4 && b.top > begin && !el.closest(NON_MAIN) && linkShare(el) < 0.5);
    const score = new Map();
    for (const { el } of blocks) {
      if (el.tagName === 'LI' || el.tagName === 'BLOCKQUOTE') continue;
      const chars = norm(el.textContent).length;
      for (const [n, weight] of [[el.parentElement, 1], [el.parentElement?.parentElement, 0.5]]) {
        if (n && (!first || first.el.contains(n))) score.set(n, (score.get(n) ?? 0) + chars * weight);
      }
    }
    let container = null;
    for (const [n, s] of score) if (!container || s > container.s) container = { n, s };
    // The article tested is the one the page had as it loaded: with the page at the top its text
    // container is marked, and once the page has scrolled that one stays the article's text, so the
    // next story an infinite scroll appends (more text, in a container of its own) doesn't take over.
    const pinned = document.querySelector('[data-adc-article-text]');
    if (sy === 0) {
      pinned?.removeAttribute('data-adc-article-text');
      container?.n.setAttribute('data-adc-article-text', '');
    } else if (pinned && score.has(pinned)) container = { n: pinned, s: score.get(pinned) };
    // Inside an <article>, with its siblings holding a fifth of that text or more (a body split
    // around an ad or a box), as Readability does; not the comments. Outside one, a sibling may be
    // the site's footer or the next story.
    const parts = [];
    if (container) {
      // An only child stands for its parent (one more wrapper around each half).
      let node = container.n;
      while (first && node !== first.el && node.parentElement !== first.el && node.parentElement.children.length === 1) node = node.parentElement;
      parts.push(node);
      for (const sibling of first && node !== first.el ? node.parentElement.children : []) {
        const weight = Math.max(score.get(sibling) ?? 0, ...[...sibling.children].map((child) => score.get(child) ?? 0));
        if (sibling !== node && weight >= container.s * 0.2 && !/comment/i.test(`${sibling.id} ${sibling.className}`)) parts.push(sibling);
      }
    }
    const text = blocks.filter(({ el }) => parts.some((n) => n.contains(el)));
    // How far down a block shows: a box around it that cuts off what overflows it (an article
    // collapsed behind "Show full article", a max-height box with overflow hidden) ends it there,
    // though the rest of the text keeps its place in the layout, under what follows the button.
    const shownBottom = (el, b) => {
      let bottom = b.bottom;
      for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const style = getComputedStyle(n);
        if (style.display !== 'contents' && /^(hidden|clip)$/.test(style.overflowY)) bottom = Math.min(bottom, n.getBoundingClientRect().bottom + sy);
      }
      return bottom;
    };
    if (text.length) {
      const lastText = Math.max(...text.map(({ el, b }) => shownBottom(el, b)));
      const after = (b) => b && !b.fixed && b.width >= vw * 0.4 && b.height >= 20 && b.top >= lastText - 5 && b.top > begin;
      const tops = [];
      // The next story's headline, as wide as the text (not an h1 among the paragraphs, nor one for
      // screen readers): an infinite scroll.
      for (const el of document.querySelectorAll('h1')) {
        const b = box(el);
        if (after(b)) tops.push(b.top);
      }
      // A block of them, not a strip (a line of tags or share links).
      for (const el of document.querySelectorAll('aside, nav, footer, [role="complementary"], [role="navigation"], [role="contentinfo"]')) {
        const b = box(el);
        if (after(b) && b.height >= 100 && !slot(b)) tops.push(b.top);
      }
      for (const el of document.querySelectorAll(FEEDS)) {
        const b = box(el);
        if (after(b) && !slot(b)) tops.push(b.top);
      }
      // Comments, not a button to them.
      for (const el of document.querySelectorAll('[id*="comment" i], [class*="comment" i]')) {
        const b = box(el);
        if (after(b) && b.height >= 100 && !el.parentElement?.closest('[id*="comment" i], [class*="comment" i]')) tops.push(b.top);
      }
      // Lists of links to other stories: two or more links of headline length, most of the block's
      // text, no ad inside.
      const linked = new Map();
      for (const a of document.querySelectorAll('a[href]')) {
        if (norm(a.textContent).length < 25) continue;
        for (let n = a.parentElement, depth = 0; n && n !== document.body && depth < 8; n = n.parentElement, depth++) {
          if (!linked.has(n)) linked.set(n, new Set());
          linked.get(n).add(a.getAttribute('href'));
        }
      }
      for (const [el, hrefs] of linked) {
        if (hrefs.size < 2) continue;
        const b = box(el);
        if (after(b) && !adBoxes.some((a) => holds(b, a)) && linkShare(el) >= 0.5) tops.push(b.top);
      }
      // The page-level end (a related heading, a footer known by its id or class) when below the text.
      if (end >= lastText - 5 && end < pageHeight) tops.push(end);
      const found = Math.min(...tops);
      if (Number.isFinite(found)) articleEnd = Math.round(found);
    }
    if (articleEnd == null && first) articleEnd = Math.round(first.b.bottom);
    if (articleEnd != null && articleEnd <= begin) articleEnd = null;
  }
  return { begin: Math.round(begin), end: Math.round(end), articleEnd };
}

// With the page at the top, once the article's end is known: marks the block that starts there
// (the related block, comments, feed… that ends the article) and the article's last paragraph (the
// last block of text across the column above the end), so the test can find the end again after the
// page changed: images and ads filling in above the end, or between the text and that block.
// Returns how far below that paragraph the end is (0 with only the block), or null with neither.
export function markArticleEnd(end) {
  for (const old of document.querySelectorAll('[data-adc-article-end], [data-adc-article-end-block]')) {
    old.removeAttribute('data-adc-article-end');
    old.removeAttribute('data-adc-article-end-block');
  }
  const block = [...document.body.querySelectorAll('*')].find((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width >= window.innerWidth * 0.4 && Math.abs(r.top + window.scrollY - end) <= 1;
  });
  block?.setAttribute('data-adc-article-end-block', '');
  const last = [...document.querySelectorAll('p')]
    .filter((p) => p.textContent.trim().length > 40)
    .map((p) => ({ p, r: p.getBoundingClientRect() }))
    .filter(({ r }) => r.height > 0 && r.width >= window.innerWidth * 0.4 && r.bottom + window.scrollY <= end)
    .sort((a, b) => a.r.bottom - b.r.bottom)
    .at(-1);
  // No paragraph to measure from (the text sits in plain blocks): the block alone tells the end.
  if (!last) return block ? 0 : null;
  last.p.setAttribute('data-adc-article-end', '');
  return Math.round(end - (last.r.bottom + window.scrollY));
}

// Where the article ends now, in page pixels: the top of the block that ends it, else its marked
// last paragraph's bottom plus the gap; null once both are gone. measured is the end found again
// now (contentBounds' articleEnd): blocks that loaded since between the text and that block (a
// feed, more recommendations) push it down, and the end moves up to the first of them, never
// above the article's last paragraph. ads are the elements Chrome tags as ads: a block an ad fills
// since (a slot loaded late) was the ad's slot, and the end measured now holds, below it too.
export function articleEndNow(gap, measured = null, ...ads) {
  const sy = window.scrollY;
  const mark = document.querySelector('[data-adc-article-end]')?.getBoundingClientRect();
  const text = mark && mark.height > 0 ? mark.bottom + sy : null;
  const block = document.querySelector('[data-adc-article-end-block]')?.getBoundingClientRect();
  const blockTop = block && block.height > 0 ? block.top + sy : null;
  const slot = blockTop != null && ads.some((ad) => {
    const r = ad.getBoundingClientRect();
    return r.width > 1 && r.height >= block.height / 2 && r.top + sy >= blockTop - 5 && r.bottom + sy <= blockTop + block.height + 5;
  });
  const fits = measured != null && (text == null || measured >= text - 5);
  if (slot && fits) return Math.round(measured);
  let end = null;
  if (blockTop != null && !slot) end = blockTop;
  else if (text != null) end = text + gap;
  if (end != null && fits && measured < end && text != null) end = measured;
  return end == null ? null : Math.round(end);
}

// Before each screenshot: what the site fixes on screen and isn't an ad — bars at the top or the
// bottom (header, menu, subscription or cookie bars) and fixed boxes (a subscription offer, a
// floating player) — shows in the first screenshot that has it and is hidden from the later ones, so
// the stitched page shows it once. A bar at the top that first shows after the first screenshot is
// another take on the header (a compact one once the page scrolls): it never shows. Never an ad or what holds one, nor a fixed wrapper the size of the
// screen (some pages live in one). Returns how many it hid.
export function hideFixedBars(...ads) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const touchesAd = (el) => ads.some((ad) => el.contains(ad) || ad.contains(el));
  const near = (a, b) => Math.abs(a - b) <= 2;
  // position: fixed inside a transformed (or filtered) element scrolls with the page: it is content.
  const pinned = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none') return false;
    }
    return true;
  };
  const root = document.documentElement;
  const later = root.getAttribute('data-adc-shot') !== null; // not the first screenshot
  root.setAttribute('data-adc-shot', '');
  let hidden = 0;
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (style.position === 'fixed' && !pinned(el)) continue;
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    // A fixed bar may run past the edge; a sticky one is a bar only while stuck there (on its way
    // through the page it is content).
    const fixed = style.position === 'fixed';
    const atTop = fixed ? r.top <= 2 && r.bottom > 0 : near(r.top, parseFloat(style.top));
    const atBottom = fixed ? r.bottom >= vh - 2 && r.top < vh : near(r.bottom, vh - parseFloat(style.bottom));
    // Sizes are of the part on screen: a drawer taller than the screen may show only its top.
    const height = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    const width = Math.min(r.right, vw) - Math.max(r.left, 0);
    const bar = (atTop || atBottom) && height <= vh * 0.4 && width >= vw * 0.5;
    const box = fixed && onScreen && width * height <= vw * vh * 0.6;
    if (touchesAd(el)) continue;
    // Seen once it has been on screen in a screenshot, bar or not yet (a sticky header in the flow).
    const seen = el.getAttribute('data-adc-seen') !== null;
    if (onScreen && style.visibility !== 'hidden') el.setAttribute('data-adc-seen', '');
    const compactHeader = later && bar && atTop;
    // A bar at the bottom of the screen goes from the first screenshot on: stitched, it would sit across the
    // middle of the page (Prensa Ibérica's "Leer · Cerca · Jugar"). The header at the top shows once.
    const bottomBar = bar && atBottom && !atTop;
    if ((!seen && !compactHeader && !bottomBar) || !(bar || box) || el.getAttribute('data-adc-hidden') !== null) continue;
    // Faded out, not visibility: hidden, which a child may undo with a visibility: visible of its own; at
    // once: no transition (a fade is caught half way) and an important opacity (an animation can't undo it).
    // data-adc-hidden keeps the inline values showHidden gives back.
    el.setAttribute('data-adc-hidden', JSON.stringify([el.style.opacity, el.style.getPropertyPriority('opacity'), el.style.transition, el.style.getPropertyPriority('transition')]));
    el.style.setProperty('transition', 'none', 'important');
    el.style.setProperty('opacity', '0', 'important');
    hidden += 1;
  }
  return hidden;
}

// Before a screenshot: hides the layer fixed to the screen that holds each given ad (an anchor ad
// already in an earlier screenshot), or the ad gate's blurring layer that holds it, so the stitched page
// shows it once. Returns how many.
export function hideFixedAds(...ads) {
  let hidden = 0;
  for (const ad of ads) {
    let layer = null;
    for (let n = ad; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') {
        layer = n;
        break;
      }
    }
    // An ad gate's layer is not always fixed (Vozpópuli's membrana panel is sticky in a tall absolute wall):
    // the outermost positioned layer over the page that blurs it, as dismissOverlay closes.
    if (!layer) {
      for (let n = ad; n && n !== document.body; n = n.parentElement) {
        const style = getComputedStyle(n);
        if (/^(absolute|fixed|sticky)$/.test(style.position) && /blur\(/.test(style.backdropFilter || '') && !n.querySelector('main, article, h1')) layer = n;
      }
    }
    // A rail ad held on screen by a sticky box (CBS: position: sticky; top: 440px) follows the reader down its
    // column: the outermost sticky box that holds it and not the page's own content.
    if (!layer) {
      for (let n = ad; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).position === 'sticky' && !/^(main|article|h1)$/i.test(n.tagName) && !n.querySelector('main, article, h1')) layer = n;
      }
    }
    if (!layer || layer.getAttribute('data-adc-hidden') !== null) continue;
    // At once, as hideFixedBars does: Sport's bwin pop-up faded with a transition and came out as a ghost.
    layer.setAttribute('data-adc-hidden', JSON.stringify([layer.style.opacity, layer.style.getPropertyPriority('opacity'), layer.style.transition, layer.style.getPropertyPriority('transition')]));
    layer.style.setProperty('transition', 'none', 'important');
    layer.style.setProperty('opacity', '0', 'important');
    hidden += 1;
  }
  return hidden;
}

// A reader closes a pop-up ad after a few seconds: hides, for the rest of the test, the outermost layer
// fixed to the screen that holds the ad (the ad itself when it is that layer) and marks it
// data-adc-dismissed; showHidden leaves it closed. Never a layer that holds the page's main, article
// or h1 (a fixed app shell): an ad in no other fixed layer is left alone. Returns whether it hid one.
export function dismissOverlay(el) {
  const holdsPage = (n) => /^(main|article|h1)$/i.test(n.tagName) || Boolean(n.querySelector('main, article, h1'));
  let layer = null;
  // What holds the page's content, so does every element around it: the last fixed layer that doesn't
  // is the outermost one over the page.
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed' && !holdsPage(n)) layer = n;
  }
  // Else the outermost ad gate's layer: positioned over the page and blurring it (see adItems).
  if (!layer) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (/^(absolute|fixed|sticky)$/.test(style.position) && /blur\(/.test(style.backdropFilter || '') && !holdsPage(n)) layer = n;
    }
  }
  if (!layer) return false;
  layer.style.setProperty('display', 'none', 'important');
  layer.setAttribute('data-adc-dismissed', '');
  return true;
}

export function showHidden() {
  for (const el of document.querySelectorAll('[data-adc-hidden]')) {
    const [opacity, opacityPriority, transition, transitionPriority] = JSON.parse(el.getAttribute('data-adc-hidden'));
    el.style.setProperty('opacity', opacity, opacityPriority);
    el.style.setProperty('transition', transition, transitionPriority);
    el.removeAttribute('data-adc-hidden');
  }
}

// Marks, once, the elements an ad script may have made: visible by CSS, 30 × 30 px or more. The
// test reads the marks from the DOM and asks Chrome which script created each one. Returns how many
// it marked now.
export function markAdCandidates() {
  let marked = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (el.hasAttribute('data-adc-cand')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 30) continue;
    // A page-sized frame (a skin's layer) is never one ad: its parts are judged on their own.
    if (r.width >= window.innerWidth * 0.9 && r.height > window.innerHeight * 2) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    el.setAttribute('data-adc-cand', '');
    marked += 1;
  }
  return marked;
}

// Boxes labelled as advertising — "Publicidad", "Advertisement", "Anzeige"… as the whole text of an
// element or as CSS ::before / ::after content — that hold none of the ads already found (ads:
// Chrome's and the lists') and sit in none. A CSS label marks its own element; a text label the
// nearest ancestor (up to three levels) whose top edge holds it, else the next element right below
// it. The box must be 50 px tall and 100 px wide or more. Not labels: inside links, buttons, nav,
// header or footer (the site's "Publicidad" link to its advertising page), inside a dialog (a consent
// dialog's "Publicidad" purpose), hidden, or part of a longer text. Marks each box with data-adc-label (its reason, "· empty slot" when it holds no
// creative) and returns the reasons in document order. A box it leaves to an ad (the box is, holds or sits
// inside one of the given ads) gets data-adc-label-ad: the runner drops what it measured of that box
// while it was still empty.
export function labelledAdBoxes(...ads) {
  const WORDS = /^(publicidad|anuncio|patrocinado|contenido patrocinado|advertisement|ad|ads|sponsored|promoted|publicit[ée]|annonce|sponsoris[ée]|anzeige|werbung|pubblicit[àa]|sponsorizzato|publicidade|an[úu]ncio|advertentie|gesponsord|reklama|publicitate)\s*:?$/i;
  const NOT = 'a, button, nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="button"], [role="link"], dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const shown = (el) => typeof el.checkVisibility !== 'function' || el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const SKIP = /^(script|style|noscript|template)$/i;
  const NOISE = /^(script|style|noscript)$/i;
  // Text a person would see: not what scripts, styles or noscript hold.
  const textOf = (n) => (n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !NOISE.test(n.tagName) ? [...n.childNodes].map(textOf).join(' ') : '');
  const big = (r) => r.height >= 50 && r.width >= 100;
  const cssLabel = (el) => {
    for (const part of ['::before', '::after']) {
      const content = getComputedStyle(el, part).content;
      if (!content || content === 'none' || content === 'normal') continue;
      const text = norm(content.replace(/^["']|["']$/g, ''));
      if (WORDS.test(text)) return text;
    }
    return null;
  };
  // A label in a fixed layer covering a quarter of the screen is a popup or modal (a consent dialog
  // without ARIA roles), not an ad slot in the page; anchor bars and sticky ads cover far less.
  const inOverlay = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position !== 'fixed') continue;
      const r = n.getBoundingClientRect();
      if (r.width * r.height >= 0.25 * window.innerWidth * window.innerHeight) return true;
    }
    return false;
  };
  const ownText = (el) => norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
  for (const old of document.querySelectorAll('[data-adc-label]')) old.removeAttribute('data-adc-label');
  for (const old of document.querySelectorAll('[data-adc-label-ad]')) old.removeAttribute('data-adc-label-ad');

  const boxes = new Map(); // box → its label
  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP.test(el.tagName) || el.ownerSVGElement || /^svg$/i.test(el.tagName)) continue;
    const label = el.getBoundingClientRect();
    if (!(label.width > 0 && label.height > 0)) continue;
    const text = ownText(el);
    if (!text || !WORDS.test(text) || norm(el.textContent) !== text) {
      if (!big(label)) continue;
      const css = cssLabel(el);
      if (css && !el.closest(NOT) && shown(el) && !boxes.has(el) && !inOverlay(el)) boxes.set(el, css);
      continue;
    }
    if (el.closest(NOT) || !shown(el) || inOverlay(el)) continue;
    let box = null;
    for (let n = el.parentElement, depth = 0; n && n !== document.body && depth < 3 && !box; n = n.parentElement, depth++) {
      const r = n.getBoundingClientRect();
      if (big(r) && Math.abs(r.top - label.top) <= 20) box = n;
    }
    if (!box) {
      const next = el.nextElementSibling;
      const r = next?.getBoundingClientRect();
      if (next && big(r) && r.top >= label.top && r.top - label.bottom <= 20) box = next;
    }
    if (box && !boxes.has(box)) boxes.set(box, text);
  }

  const touchesAd = (box) => ads.some((ad) => ad === box || box.contains(ad) || ad.contains(box));
  const nested = (box) => [...boxes.keys()].some((other) => other !== box && other.contains(box));
  for (const box of boxes.keys()) if (touchesAd(box)) box.setAttribute('data-adc-label-ad', '');
  const keep = [...boxes.keys()].filter((box) => !touchesAd(box) && !nested(box));
  for (const box of keep) {
    const label = boxes.get(box);
    const creative = box.querySelector('iframe, img, video, canvas, svg, object, embed') || box.shadowRoot ||
      [...box.querySelectorAll('*')].some((e) => e.shadowRoot) || norm(textOf(box)).replace(label, '').trim().length > 0;
    box.setAttribute('data-adc-label', `labelled "${label}"${creative ? '' : ' · empty slot'}`);
  }
  return [...document.querySelectorAll('[data-adc-label]')].map((el) => el.getAttribute('data-adc-label'));
}

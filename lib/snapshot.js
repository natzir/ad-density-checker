// The result snapshot: the tested page stitched from the screens captured during the test, with
// the Better Ads decisions drawn on it (main content cuts, ads counted or not and why).

const REASONS = { outside: 'outside main content', hidden: 'behind content', nested: 'inside another ad', 'content-video': 'content video player' };

// 15480 → '15 480'
export const px = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// The parts of [0, height) that none of the ranges reach.
function uncovered(ranges, height) {
  const gaps = [];
  let reached = 0;
  for (const range of [...ranges].sort((a, b) => a.top - b.top)) {
    if (range.top > reached) gaps.push({ top: reached, bottom: range.top });
    reached = Math.max(reached, range.bottom);
  }
  if (reached < height) gaps.push({ top: reached, bottom: height });
  return gaps;
}

// What to draw, in page pixels. Screens are drawn in page order, so where two overlap (the last
// scroll is usually shorter) the later one wins.
export function snapshotLayout({ snapshot, betterAds, view = 'real' }) {
  const { viewport, pageHeight } = snapshot;
  const tiles = snapshot.tiles.map((tile, index) => ({ y: tile.pageTop, index })).sort((a, b) => a.y - b.y);
  const height = Math.max(...tiles.map((tile) => tile.y + viewport.height));
  const gaps = uncovered(tiles.map((tile) => ({ top: tile.y, bottom: tile.y + viewport.height })), height);

  const dims = [];
  const cuts = [];
  if (betterAds.contentDetected) {
    const { begin, end } = betterAds.content;
    if (begin > 0) dims.push({ top: 0, bottom: Math.min(begin, height) });
    if (end < height) dims.push({ top: Math.max(end, 0), bottom: height });
    if (begin > 0 && begin < height) cuts.push({ y: begin, label: `main content starts · ${px(begin)} px` });
    if (end > 0 && end < height) cuts.push({ y: end, label: `main content ends · ${px(end)} px` });
  }

  const marks = [];
  for (const ad of betterAds.ads) {
    const top = Math.max(ad.top, 0);
    const bottom = Math.min(ad.top + ad.height, height);
    const left = Math.max(ad.x, 0);
    const right = Math.min(ad.x + ad.width, viewport.width);
    if (bottom <= top || right <= left) continue;
    // A sticky ad has no one place in the page; one that doesn't count (the frame around a counted
    // anchor, say) would only repeat it. An ad inside another is the same ad: the one around it is
    // drawn, and the inner one's grey fill would hide that one's colour. An interstitial isn't in the
    // density but fails on its own: drawn once, where a screenshot holds it, like a sticky ad.
    const interstitial = ad.kind === 'interstitial';
    if (ad.reason === 'nested' || (!ad.counted && ad.kind !== 'inline' && !interstitial)) continue;
    const drawnAsAd = ad.counted || interstitial;
    const unseen = drawnAsAd && ad.source && ad.source !== 'chrome';
    // The Chrome view draws Chrome's tags only: a tag its verdict doesn't count (behind the page's content,
    // say) is drawn blue with why, except outside the main content, where no view counts an ad.
    const chromeOnly = view === 'chrome' && !drawnAsAd && ad.reason !== 'outside';
    const style = chromeOnly ? 'chrome-only' : !drawnAsAd ? 'not-counted' : unseen ? 'unseen' : ad.kind === 'inline' ? 'counted' : 'sticky';
    const kindLabel = chromeOnly ? `Chrome tags it · not counted · ${REASONS[ad.reason]}`
      : interstitial ? `${ad.gate ? 'ad gate' : 'interstitial'} · ${ad.share}% of screen`
      : !ad.counted ? `not counted · ${REASONS[ad.reason]}`
        : ad.kind === 'skin' ? `sticky skin · ${px(ad.countedHeight)} px`
          : ad.kind === 'interscroller' ? `interscroller · ${px(ad.countedHeight)} px`
          : ad.kind === 'sticky' ? `sticky · ${ad.share}% of screen` : `ad · ${px(ad.countedHeight)} px`;
    const label = unseen ? `${kindLabel} · not seen by Chrome · ${ad.why}` : kindLabel;
    marks.push({ x: left, y: top, w: right - left, h: bottom - top, style, label, tile: ad.tile ?? null });
  }

  // Not-counted marks inside another with the same label are the same thing told again (the pieces of one
  // video player Chrome tags one by one): drawn once.
  const inside = (m, o) => m.x >= o.x - 2 && m.y >= o.y - 2 && m.x + m.w <= o.x + o.w + 2 && m.y + m.h <= o.y + o.h + 2;
  const drawn = marks.filter((m, i) => !['not-counted', 'chrome-only'].includes(m.style) ||
    !marks.some((o, j) => j !== i && o.label === m.label && inside(m, o) && (!inside(o, m) || j < i)));
  const note = height < pageHeight - 1 ? `captured 0–${px(height)} of ${px(pageHeight)} px` : null;
  return { view, width: viewport.width, tileHeight: viewport.height, height, pageHeight, tiles, gaps, dims, cuts, marks: drawn, note };
}

export const MAX_CANVAS = 32767; // Chrome's largest canvas side
// The export header: a dark band with the summary, then the legend, wrapped into as many rows as the
// image's width needs (legendLayout).
export const HEADER = { dark: 144, legendRow: 22, legendPad: 8 };
export function headerHeight(width, view = 'real') {
  return HEADER.dark + HEADER.legendPad + legendLayout(width, view).rows * HEADER.legendRow;
}

const mark = (pass) => (pass ? '✓' : '✕');

const STOPPED = { 'article-end': 'stopped at the end of the article', 'next-article': 'infinite scroll: stopped before the next article', stuck: 'stopped where the page stopped scrolling', time: 'the minute ran out before the bottom' };

export function snapshotSummary(result, { timeZone, view = 'real' } = {}) {
  const { chrome, device, snapshot } = result;
  // Results made before the Chrome view existed have no chromeView: they are shown as the Real view.
  const betterAds = view === 'chrome' && result.chromeView ? result.chromeView.betterAds : result.betterAds;
  const when = new Date(result.testedAt).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
  });
  const meta = [`${device === 'desktop' ? 'Desktop' : 'Mobile'} ${snapshot.viewport.width} × ${snapshot.viewport.height}`, when, `${result.samples.length} samples`];
  const { density, largeSticky, interstitial } = betterAds;
  return {
    title: 'natzir.com · Ad Density Checker',
    url: result.url,
    meta: meta.join(' · '),
    // Qualifiers that change how the image reads; drawn on a line of their own. The first note names the view; the legend says what it draws.
    notes: [view === 'chrome' ? 'Chrome view' : 'Real view', betterAds.covered && 'no ad could be seen: a dialog may have covered the page', !betterAds.contentDetected && 'whole page used', result.stoppedAt === 'redirect' ? `auto-redirect to ${result.redirect?.to}: stopped there` : STOPPED[result.stoppedAt]].filter(Boolean),
    figures: [
      ...(betterAds.covered
        ? [
          { value: 'not measured', state: 'info', label: `Better Ads ≤${density.limit}%` },
          { value: 'not measured', state: 'info', label: `Large sticky ≤${largeSticky.limit}%` },
          { value: 'not measured', state: 'info', label: 'Interstitial' },
        ]
        : [
          { value: `${density.over ? '100%+' : `${density.value}%`} ${mark(density.pass)}`, state: density.pass ? 'pass' : 'fail', label: `Better Ads ≤${density.limit}%` },
          {
            value: `${largeSticky.found ? `${largeSticky.value}%` : 'none'} ${mark(largeSticky.pass)}`,
            state: largeSticky.pass ? 'pass' : 'fail',
            label: `Large sticky ≤${largeSticky.limit}%`,
          },
          { value: `${interstitial.found ? `${interstitial.share}%` : 'none'} ${mark(interstitial.pass)}`, state: interstitial.pass ? 'pass' : 'fail', label: 'Interstitial' },
        ]),
      { value: `${Math.round(chrome.avgDensity)}%`, state: 'info', label: 'Avg viewport' },
    ],
  };
}

export function snapshotFilename({ url, device, testedAt }, suffix = '') {
  const d = new Date(testedAt);
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  return `ad-density-${new URL(url).hostname}-${device}-${stamp}${suffix}.jpg`;
}

// The export: header + page at 1:1, scaled down to fit Chrome's canvas limit.
const fullWidth = (plan) => plan.width;

export function exportSize(plan) {
  const width = fullWidth(plan);
  const height = headerHeight(width, plan.view) + plan.height;
  const scale = Math.min(1, MAX_CANVAS / height);
  return { width: Math.round(width * scale), height: Math.min(MAX_CANVAS, Math.round(height * scale)), scale };
}

// Text broken into lines no wider than width, every character kept (a URL is evidence): after / - ? & =
// or a space where one is near the end of the line, else anywhere.
export function wrapText(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width <= width || !line) {
      line += ch;
      continue;
    }
    const cut = Math.max(...[...'/-?&= '].map((c) => line.lastIndexOf(c)));
    if (cut > line.length / 2) {
      lines.push(line.slice(0, cut + 1));
      line = line.slice(cut + 1) + ch;
    } else {
      lines.push(line);
      line = ch;
    }
  }
  return line ? [...lines, line] : lines;
}

// The Chrome vs Real image: a title band (the whole URL, wrapped, and the test's line), then the Chrome
// view on the left and the Real view on the right, each with its own header. The title's height comes from
// wrapping the URL with the same measuring context the drawing uses, so no line is ever cut off or overlaps.
const COLUMN_GAP = 16;
const TITLE = { pad: 16, line: 20, meta: 22 };
export function comparisonSize({ chrome, real }, url, ctx) {
  const width = chrome.width + real.width + COLUMN_GAP;
  ctx.font = `600 15px ${FONT}`;
  const lines = Math.max(1, wrapText(ctx, url, width - 2 * TITLE.pad).length);
  const title = TITLE.pad + lines * TITLE.line + TITLE.meta + TITLE.pad / 2;
  const column = Math.max(headerHeight(chrome.width, 'chrome') + chrome.height, headerHeight(real.width, 'real') + real.height);
  const height = title + column;
  const scale = Math.min(1, MAX_CANVAS / height);
  return { width: Math.round(width * scale), height: Math.min(MAX_CANVAS, Math.round(height * scale)), scale, title };
}

export function drawComparison(ctx, { chrome, real }, images, { scale = 1, summaries, url, meta, logo = null }) {
  const size = comparisonSize({ chrome, real }, url, ctx);
  const { title } = size;
  const width = chrome.width + real.width + COLUMN_GAP;
  ctx.save();
  ctx.scale(scale, scale);
  // The gap between the columns and the room under the shorter one are part of the image: paint them
  // first, or a JPEG shows them black.
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, width, Math.ceil(size.height / scale));
  ctx.fillStyle = COLORS.header;
  ctx.fillRect(0, 0, width, title);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.headerText;
  ctx.font = `600 15px ${FONT}`;
  let y = TITLE.pad + 12;
  for (const line of wrapText(ctx, url, width - 2 * TITLE.pad)) {
    ctx.fillText(line, TITLE.pad, y);
    y += TITLE.line;
  }
  ctx.fillStyle = COLORS.headerMuted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(meta, TITLE.pad, y + 2);
  ctx.restore();
  for (const [plan, x, summary] of [[chrome, 0, summaries.chrome], [real, chrome.width + COLUMN_GAP, summaries.real]]) {
    ctx.save();
    ctx.translate(x * scale, title * scale);
    drawSnapshot(ctx, plan, images, { scale, summary, logo });
    ctx.restore();
  }
}

// The panel strip: the page at the strip's width in device pixels, within the canvas limit.
export function stripSize(plan, cssWidth, dpr) {
  const width = fullWidth(plan);
  const scale = Math.min((cssWidth * dpr) / width, MAX_CANVAS / plan.height);
  return { width: Math.round(width * scale), height: Math.min(MAX_CANVAS, Math.round(plan.height * scale)), scale };
}

// Keeps the snapshot images of the `keep` most recent outcomes (a Map, oldest first); older
// outcomes keep their figures.
export function pruneSnapshots(outcomes, keep) {
  let kept = 0;
  for (const [key, outcome] of [...outcomes].reverse()) {
    if (!outcome.test?.snapshot) continue;
    if (kept < keep) {
      kept += 1;
      continue;
    }
    outcomes.set(key, { ...outcome, test: { ...outcome.test, snapshot: null, snapshotDropped: true } });
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const COLORS = {
  header: '#172224',
  headerText: '#e6edf3',
  headerMuted: '#8d96a0',
  pass: '#3fb950',
  fail: '#f85149',
  legend: '#f6f7f9',
  legendText: '#1f2328',
  page: '#ffffff',
  gap: '#e5e7eb',
  gapText: '#6b7280',
  dim: 'rgba(13, 17, 23, 0.45)',
  cut: '#2563eb',
  veil: 'rgba(255, 255, 255, 0.55)',
  // Counted ads get a darker layer in their border's colour (multiplied over the unveiled ad).
  counted: ['rgba(245, 158, 11, 0.35)', '#f59e0b'],
  sticky: ['rgba(168, 85, 247, 0.35)', '#a855f7'],
  'not-counted': ['rgba(107, 114, 128, 0.12)', '#6b7280'],
  // pink: ads Chrome doesn't tag (found by the lists or by their label)
  unseen: ['rgba(236, 72, 153, 0.35)', '#ec4899'],
  // blue, dashed: in the Chrome view, a tag Chrome puts on something the tool doesn't count as an ad
  'chrome-only': ['rgba(37, 99, 235, 0.10)', '#2563eb'],
};
const DASHED = new Set(['not-counted', 'chrome-only']); // outlines only: not drawn again unveiled
const LEGENDS = {
  real: [
    ['counted', 'Counted ad'],
    ['sticky', 'Sticky (counted once)'],
    ['unseen', "Counted · Chrome doesn't detect it"],
    ['not-counted', 'Not counted'],
    ['dim', 'Outside main content'],
    ['cut', 'Main content cut'],
  ],
  chrome: [
    ['counted', 'Counted ad'],
    ['sticky', 'Sticky (counted once)'],
    ['chrome-only', 'Chrome tags it, not counted'],
    ['not-counted', 'Not counted'],
    ['dim', 'Outside main content'],
    ['cut', 'Main content cut'],
  ],
};

// The legend's rows, laid out from an upper bound of each label's width (11px text, at most 6.5 px a
// character), so the header's height is known before anything is drawn.
const LEGEND_CHAR = 6.5;
export function legendLayout(width, view = 'real') {
  const pad = 16;
  const items = [];
  let x = pad;
  let row = 0;
  for (const [style, text] of LEGENDS[view]) {
    const itemWidth = 18 + Math.ceil(text.length * LEGEND_CHAR) + 14;
    if (x + itemWidth > width - pad && x > pad) {
      x = pad;
      row += 1;
    }
    items.push({ style, text, x, row, width: itemWidth });
    x += itemWidth;
  }
  return { items, rows: row + 1 };
}

// Text cut with an ellipsis to fit a width.
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// A label on a filled box, its top left corner at (x, y), wrapped onto as many lines as it takes to stay
// within maxWidth: a label cut at the image's edge can't be read.
function tag(ctx, text, x, y, background, color, maxWidth = Infinity) {
  drawTag(ctx, measureTag(ctx, text, maxWidth), x, y, background, color);
}
// A label's lines and size, before it is placed.
function measureTag(ctx, text, maxWidth = Infinity) {
  ctx.font = `600 12px ${FONT}`;
  const lines = wrapText(ctx, text, maxWidth - 8);
  return { lines, width: Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8, height: 18 + LABEL_LINE * (lines.length - 1) };
}
function drawTag(ctx, { lines, width, height }, x, y, background, color) {
  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = background;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + 4, y + 9 + LABEL_LINE * i));
}
const LABEL_LINE = 14;
// A mark's label keeps within the mark, or within this width on a narrower one, moved left if the image's
// edge is nearer.
const LABEL_MIN = 160;

function swatch(ctx, style, x, y) {
  if (style === 'dim') {
    ctx.fillStyle = COLORS.dim;
    ctx.fillRect(x, y, 12, 12);
    return;
  }
  if (style === 'cut') {
    ctx.strokeStyle = COLORS.cut;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x + 12, y + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const [fill, stroke] = COLORS[style];
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, 12, 12);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(DASHED.has(style) ? [3, 2] : []);
  ctx.strokeRect(x + 0.75, y + 0.75, 10.5, 10.5);
  ctx.setLineDash([]);
}

// The figures share one row, never wider than it: equal columns when each figure fits its share (a
// desktop export); else each column is as wide as its value, and the room left goes to the labels that
// need it (a label still too long is cut with fit). The values shrink from 20 px (to 12 px at least)
// only while the values themselves don't fit the row (a phone-wide export where nothing was measured).
const FIGURE_GAP = 8;
function figureColumns(ctx, figures, width) {
  const sum = (list) => list.reduce((total, n) => total + n, 0);
  let size = 20;
  let values;
  for (; ; size -= 1) {
    ctx.font = `700 ${size}px ${FONT}`;
    values = figures.map((figure) => ctx.measureText(figure.value).width + FIGURE_GAP);
    if (size === 12 || sum(values) <= width) break;
  }
  ctx.font = `10px ${FONT}`;
  const needs = figures.map((figure, i) => Math.max(values[i], ctx.measureText(figure.label.toUpperCase()).width + FIGURE_GAP));
  if (needs.every((need) => need <= width / figures.length)) return { size, widths: needs.map(() => width / figures.length) };
  const room = width - sum(values);
  if (room <= 0) return { size, widths: values.map((value) => (value * width) / sum(values)) };
  const wanted = needs.map((need, i) => need - values[i]);
  const given = Math.min(1, room / (sum(wanted) || 1));
  const spare = (room - sum(wanted) * given) / figures.length;
  return { size, widths: values.map((value, i) => value + wanted[i] * given + spare) };
}

function drawHeader(ctx, plan, summary, logo) {
  const width = fullWidth(plan);
  const pad = 16;
  ctx.fillStyle = COLORS.header;
  ctx.fillRect(0, 0, width, HEADER.dark);
  ctx.textBaseline = 'alphabetic';
  if (logo) ctx.drawImage(logo, pad, 12, 24, 20);
  ctx.fillStyle = COLORS.headerMuted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(summary.title, pad + (logo ? 32 : 0), 27);
  ctx.fillStyle = COLORS.headerText;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(fit(ctx, summary.url, width - 2 * pad), pad, 52);
  ctx.fillStyle = COLORS.headerMuted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(fit(ctx, summary.meta, width - 2 * pad), pad, 72);
  const notes = [...summary.notes, plan.note].filter(Boolean).join(' · ');
  if (notes) {
    ctx.fillStyle = COLORS.headerText;
    ctx.fillText(fit(ctx, notes, width - 2 * pad), pad, 89);
  }
  const { size, widths } = figureColumns(ctx, summary.figures, width - 2 * pad);
  let x = pad;
  summary.figures.forEach((figure, i) => {
    ctx.fillStyle = figure.state === 'pass' ? COLORS.pass : figure.state === 'fail' ? COLORS.fail : COLORS.headerText;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillText(figure.value, x, 118);
    ctx.fillStyle = COLORS.headerMuted;
    ctx.font = `10px ${FONT}`;
    ctx.fillText(fit(ctx, figure.label.toUpperCase(), widths[i] - FIGURE_GAP), x, 134);
    x += widths[i];
  });

  ctx.fillStyle = COLORS.legend;
  ctx.fillRect(0, HEADER.dark, width, headerHeight(width, plan.view) - HEADER.dark);
  ctx.font = `11px ${FONT}`;
  ctx.textBaseline = 'middle';
  for (const { style, text, x, row } of legendLayout(width, plan.view).items) {
    const y = HEADER.dark + 15 + row * HEADER.legendRow;
    swatch(ctx, style, x, y - 6);
    ctx.fillStyle = COLORS.legendText;
    ctx.fillText(text, x + 18, y);
  }
}

// Draws the plan; with a summary, the header first and the page below it.
export function drawSnapshot(ctx, plan, images, { scale = 1, dpr = 1, summary = null, logo = null, labels = true } = {}) {
  const line = Math.max(2, 1.5 / scale); // keeps lines visible when the strip shrinks the page
  ctx.save();
  ctx.scale(scale, scale);
  if (summary) {
    drawHeader(ctx, plan, summary, logo);
    ctx.translate(0, headerHeight(fullWidth(plan), plan.view));
  }
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, plan.width, plan.height);
  for (const tile of plan.tiles) {
    const image = images[tile.index];
    if (image) ctx.drawImage(image, 0, tile.y, plan.width, plan.tileHeight);
  }
  for (const gap of plan.gaps) {
    ctx.fillStyle = COLORS.gap;
    ctx.fillRect(0, gap.top, plan.width, gap.bottom - gap.top);
    if (labels && gap.bottom - gap.top >= 34) tag(ctx, 'not captured', 8, gap.top + 8, COLORS.gap, COLORS.gapText); // room for the tag
  }
  // The page is veiled so the ads stand out: counted and sticky ads are drawn again unveiled.
  ctx.fillStyle = COLORS.veil;
  ctx.fillRect(0, 0, plan.width, plan.height);
  for (const m of plan.marks) {
    if (DASHED.has(m.style)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x, m.y, m.w, m.h);
    ctx.clip();
    // A sticky ad comes from the screenshot it was seen in; other screens may show it elsewhere.
    for (const tile of m.tile != null ? plan.tiles.filter((t) => t.index === m.tile) : plan.tiles) {
      const image = images[tile.index];
      if (image && tile.y < m.y + m.h && tile.y + plan.tileHeight > m.y) ctx.drawImage(image, 0, tile.y, plan.width, plan.tileHeight);
    }
    ctx.restore();
  }
  ctx.fillStyle = COLORS.dim;
  for (const dim of plan.dims) ctx.fillRect(0, dim.top, plan.width, dim.bottom - dim.top);
  for (const m of plan.marks) {
    const [fill, stroke] = COLORS[m.style];
    ctx.save();
    if (!DASHED.has(m.style)) ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = fill;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.restore();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = line;
    ctx.setLineDash(DASHED.has(m.style) ? [3 * line, 2 * line] : []);
    ctx.strokeRect(m.x + line / 2, m.y + line / 2, m.w - line, m.h - line);
    ctx.setLineDash([]);
  }
  // The marks' labels, over every mark (a later mark's fill would tint an earlier label). Marks that meet
  // would have their labels at the same corner (Infolinks' band on CBS and the creative Chrome tags in it):
  // a label that would cover one already placed goes below it.
  if (labels) {
    const placed = [];
    const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const m of plan.marks) {
      const room = Math.min(Math.max(m.w - 8, LABEL_MIN), plan.width - 8);
      const size = measureTag(ctx, m.label, room);
      const box = { x: Math.max(4, Math.min(m.x + 4, plan.width - 4 - room)), y: m.y + 4, width: size.width, height: size.height };
      for (let other = placed.find((p) => meets(p, box)); other; other = placed.find((p) => meets(p, box))) box.y = other.y + other.height + 2;
      placed.push(box);
      drawTag(ctx, size, box.x, box.y, 'rgba(255, 255, 255, 0.92)', COLORS.header);
    }
  }
  for (const cut of plan.cuts) {
    ctx.strokeStyle = COLORS.cut;
    ctx.lineWidth = line;
    ctx.setLineDash([4 * line, 3 * line]);
    ctx.beginPath();
    ctx.moveTo(0, cut.y);
    ctx.lineTo(plan.width, cut.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (labels) {
      ctx.font = `600 12px ${FONT}`;
      const width = ctx.measureText(cut.label).width + 8;
      tag(ctx, cut.label, plan.width - width - 8, cut.y - 20, COLORS.cut, '#ffffff');
    }
  }
  ctx.restore();
}

// Decodes the screenshots, draws with them and frees them: decoded screens take 4 bytes a pixel
// (tens of MB per test), so none are kept. A screen that fails to decode is null.
export async function withImages(tiles, decode, draw) {
  const images = await Promise.all(tiles.map((tile) => decode(tile.image).catch(() => null)));
  try {
    return await draw(images);
  } finally {
    for (const image of images) image?.close?.();
  }
}

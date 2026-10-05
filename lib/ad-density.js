// Blink's viewport ad density and ad count rules (DisplayAdElementMonitor, PageAdDensityTracker),
// recomputed from the ad rects an extension can read.

export const MAX_TRACKED_RECTS = 51;
export const MIN_COUNT_AREA = 10000;

// Total length covered by [start, end] intervals, overlaps counted once.
export function unionLength(intervals) {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = null;
  let end = null;
  for (const [s, e] of sorted) {
    if (end === null || s > end) {
      if (end !== null) total += end - start;
      start = s;
      end = e;
    } else {
      end = Math.max(end, e);
    }
  }
  if (end !== null) total += end - start;
  return total;
}

// Area covered by { x1, y1, x2, y2 } rectangles, overlaps counted once.
export function unionArea(clips) {
  const xs = [...new Set(clips.flatMap((c) => [c.x1, c.x2]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const left = xs[i];
    const right = xs[i + 1];
    const spans = clips.filter((c) => c.x1 <= left && c.x2 >= right).map((c) => [c.y1, c.y2]);
    area += unionLength(spans) * (right - left);
  }
  return area;
}

export function clipToViewport(rect, { width, height }) {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(width, rect.x + rect.w);
  const y2 = Math.min(height, rect.y + rect.h);
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
}

export const clipArea = (clip) => (clip ? (clip.x2 - clip.x1) * (clip.y2 - clip.y1) : 0);

// rects: the visible ad rects of one sample, in DOM order, in viewport coordinates.
export function viewportStats(rects, viewport) {
  if (!(viewport.width > 0 && viewport.height > 0)) return { density: 0, count: 0 };
  const inViewport = rects
    .slice(0, MAX_TRACKED_RECTS)
    .map((rect) => ({ rect, clip: clipToViewport(rect, viewport) }))
    .filter(({ clip }) => clip);
  const covered = unionArea(inViewport.map(({ clip }) => clip));
  return {
    density: Math.floor((covered * 100) / (viewport.width * viewport.height)),
    count: inViewport.filter(({ rect }) => rect.w * rect.h >= MIN_COUNT_AREA).length,
  };
}

// Each sample's value holds until the next sample; the last one until endT.
// Samples without a value (tab hidden) leave their time out.
export function timeWeightedAverage(samples, endT) {
  let weighted = 0;
  let total = 0;
  samples.forEach((sample, i) => {
    if (sample.value == null) return;
    const until = i + 1 < samples.length ? samples[i + 1].t : endT;
    const dt = Math.max(0, until - sample.t);
    weighted += sample.value * dt;
    total += dt;
  });
  if (total > 0) return weighted / total;
  return samples.at(-1)?.value ?? 0;
}

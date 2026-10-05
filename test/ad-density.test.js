import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipArea, clipToViewport, timeWeightedAverage, unionArea, unionLength, viewportStats,
} from '../lib/ad-density.js';

const VIEWPORT = { width: 400, height: 800 }; // area 320 000

test('unionLength counts overlapping intervals once', () => {
  assert.equal(unionLength([[0, 100], [50, 150], [300, 400]]), 250);
  assert.equal(unionLength([[10, 10], [20, 5]]), 0);
  assert.equal(unionLength([]), 0);
});

test('unionArea counts overlapping rectangles once', () => {
  assert.equal(unionArea([{ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 5, y1: 5, x2: 15, y2: 15 }]), 175);
  assert.equal(unionArea([]), 0);
});

test('clipToViewport keeps the visible part only', () => {
  assert.deepEqual(clipToViewport({ x: -10, y: 700, w: 100, h: 200 }, VIEWPORT), { x1: 0, y1: 700, x2: 90, y2: 800 });
  assert.equal(clipToViewport({ x: 0, y: 800, w: 100, h: 100 }, VIEWPORT), null);
  assert.equal(clipArea(null), 0);
});

test('density is the floored share of the viewport covered by ads', () => {
  // 400 × 100 = 40 000 / 320 000 = 12.5 %
  assert.deepEqual(viewportStats([{ x: 0, y: 0, w: 400, h: 100 }], VIEWPORT), { density: 12, count: 1 });
});

test('only the visible part counts for density, the full area for the count threshold', () => {
  // 50 of its 100 rows are visible: 20 000 / 320 000 = 6.25 %; full area 40 000 ≥ 10 000
  assert.deepEqual(viewportStats([{ x: 0, y: -50, w: 400, h: 100 }], VIEWPORT), { density: 6, count: 1 });
});

test('small ads add density but not count', () => {
  assert.deepEqual(viewportStats([{ x: 0, y: 0, w: 320, h: 31 }], VIEWPORT), { density: 3, count: 0 }); // 9 920 px²
});

test('overlapping ads are counted once for density, each for count', () => {
  const rects = [{ x: 0, y: 0, w: 400, h: 100 }, { x: 0, y: 50, w: 400, h: 100 }];
  assert.deepEqual(viewportStats(rects, VIEWPORT), { density: 18, count: 2 }); // 60 000 / 320 000 = 18.75 %
});

test('ads outside the viewport are ignored', () => {
  assert.deepEqual(viewportStats([{ x: 0, y: 900, w: 400, h: 100 }], VIEWPORT), { density: 0, count: 0 });
});

test('only the first 51 tracked rects count, like Blink', () => {
  const tiny = Array.from({ length: 51 }, () => ({ x: 0, y: 0, w: 2, h: 2 }));
  const fullScreen = { x: 0, y: 0, w: 400, h: 800 };
  assert.deepEqual(viewportStats([...tiny, fullScreen], VIEWPORT), { density: 0, count: 0 });
});

test('an empty viewport gives zeros', () => {
  assert.deepEqual(viewportStats([{ x: 0, y: 0, w: 10, h: 10 }], { width: 0, height: 0 }), { density: 0, count: 0 });
});

test('timeWeightedAverage holds each value until the next sample', () => {
  assert.equal(timeWeightedAverage([{ t: 0, value: 0 }, { t: 1000, value: 30 }], 3000), 20);
});

test('timeWeightedAverage with no elapsed time returns the last value, and 0 when empty', () => {
  assert.equal(timeWeightedAverage([{ t: 500, value: 7 }], 500), 7);
  assert.equal(timeWeightedAverage([], 1000), 0);
});

test('timeWeightedAverage leaves out the time of samples without a value (tab hidden)', () => {
  const samples = [{ t: 0, value: 10 }, { t: 1000, value: null }, { t: 3000, value: 30 }];
  assert.equal(timeWeightedAverage(samples, 4000), 20);
});

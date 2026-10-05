import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconPixel } from '../scripts/make-icons.mjs';

test('the icon is a dark teal tile with rounded corners, content bars and an amber ad block', () => {
  assert.equal(iconPixel(0, 0, 128)[3], 0); // outside the rounded corner
  assert.deepEqual(iconPixel(64, 6, 128), [23, 34, 36, 255]); // tile
  assert.deepEqual(iconPixel(64, 76, 128), [245, 158, 11, 255]); // ad block
  assert.deepEqual(iconPixel(40, 27, 128), [236, 237, 237, 255]); // first content bar: white at 92 % over the tile (237.48 rounds down)
  assert.deepEqual(iconPixel(8, 9, 16), [245, 158, 11, 255]); // the ad block still reads at 16 px
});

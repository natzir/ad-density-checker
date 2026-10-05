import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tokens from tokens.css: the dark :root block and the light one inside the media query.
const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const block = (source) => Object.fromEntries([...source.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const lightStart = css.indexOf('@media (prefers-color-scheme: light)');
if (lightStart < 0) throw new Error('tokens.css has no light-theme block'); // else light would be tested as dark
const themes = { dark: block(css.slice(0, lightStart)), light: { ...block(css.slice(0, lightStart)), ...block(css.slice(lightStart)) } };

function rgba(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255).concat(1);
  const fn = value.match(/^rgba?\(([^)]+)\)$/);
  const [r, g, b, a = '1'] = fn[1].split(',').map((s) => s.trim());
  return [r / 255, g / 255, b / 255, Number(a)];
}
const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3])).concat(1);
const luminance = (c) => {
  const [r, g, b] = c.slice(0, 3).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const [name, t] of Object.entries(themes)) {
  test(`${name} theme: text, muted, status and focus colours are readable`, () => {
    const bg = rgba(t.bg);
    const surface = over(rgba(t.surface), bg);
    const pairs = [
      ['text on bg', over(rgba(t.text), bg), bg, 4.5],
      ['text on surface', over(rgba(t.text), surface), surface, 4.5],
      ['muted on bg', over(rgba(t.muted), bg), bg, 4.5],
      ['muted on surface', over(rgba(t.muted), surface), surface, 4.5],
      ['key placeholder (muted) on the input', over(rgba(t.muted), over(rgba(t['input-bg']), surface)), over(rgba(t['input-bg']), surface), 4.5],
      ['pass on its pill', rgba(t.pass), over(rgba(t['pass-bg']), surface), 4.5],
      ['fail on its pill', rgba(t.fail), over(rgba(t['fail-bg']), surface), 4.5],
      ['fail on its notice', rgba(t.fail), over(rgba(t['fail-bg']), bg), 4.5],
      ['warn on its notice', rgba(t.warn), over(rgba(t['warn-bg']), bg), 4.5],
      ['primary button text', rgba(t['primary-fg']), rgba(t['primary-bg']), 4.5],
      ['focus ring on bg', rgba(t.focus), bg, 3],
    ];
    for (const [label, fg, back, min] of pairs) assert.ok(ratio(fg, back) >= min, `${name} ${label}: ${ratio(fg, back).toFixed(2)} < ${min}`);
  });
}

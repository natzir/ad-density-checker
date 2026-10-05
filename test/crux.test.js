import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AD_METRICS, buildRequest, checkKey, cruxVisLink, fetchCrux, isHttpUrl, maskKey, parseRecord } from '../lib/crux.js';

const RECORD = {
  record: {
    metrics: {
      experimental_ad_density: { percentiles: { p75: 24.5 } },
      experimental_ad_count: { percentiles: { p75: '2.10' } },
      experimental_ad_cpu: { percentiles: { p75: 3100 } },
      experimental_ad_kilobytes: { percentiles: { p75: 2400 } },
    },
    collectionPeriod: {
      firstDate: { year: 2026, month: 9, day: 1 },
      lastDate: { year: 2026, month: 9, day: 28 },
    },
  },
};
const NO_AD_METRICS = { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 2000 } } } } };

// Answers each call with the next { status, body } and records what was sent.
function fakeFetch(...responses) {
  const calls = [];
  const impl = async (endpoint, init) => {
    calls.push({ endpoint, body: JSON.parse(init.body) });
    const { status, body } = responses.shift();
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { impl, calls };
}

test('isHttpUrl accepts http(s) only', () => {
  assert.equal(isHttpUrl('https://news.example/a'), true);
  assert.equal(isHttpUrl('http://news.example/'), true);
  assert.equal(isHttpUrl('chrome://newtab/'), false);
  assert.equal(isHttpUrl('file:///Users/me/page.html'), false);
  assert.equal(isHttpUrl('not a url'), false);
  assert.equal(isHttpUrl(undefined), false);
});

test('buildRequest asks for the four ad metrics on PHONE', () => {
  const { endpoint, body } = buildRequest('k e/y', { url: 'https://news.example/' });
  assert.equal(endpoint, 'https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=k%20e%2Fy');
  assert.deepEqual(body, { url: 'https://news.example/', formFactor: 'PHONE', metrics: AD_METRICS });
});

test('buildRequest and fetchCrux ask for DESKTOP when told to', async () => {
  assert.equal(buildRequest('KEY', { url: 'https://news.example/' }, 'DESKTOP').body.formFactor, 'DESKTOP');
  const fetch = fakeFetch({ status: 200, body: RECORD });
  await fetchCrux({ apiKey: 'KEY', url: 'https://news.example/', formFactor: 'DESKTOP', fetchImpl: fetch.impl });
  assert.equal(fetch.calls[0].body.formFactor, 'DESKTOP');
});

test('parseRecord reads p75 values as numbers and the last date', () => {
  assert.deepEqual(parseRecord(RECORD, 'url'), {
    level: 'url', density: 24.5, count: 2.1, cpuMs: 3100, networkKB: 2400, lastDate: '2026-09-28',
  });
});

test('fetchCrux queries the URL without its fragment', async () => {
  const fetch = fakeFetch({ status: 200, body: RECORD });
  const data = await fetchCrux({ apiKey: 'KEY', url: 'https://news.example/a?x=1#top', fetchImpl: fetch.impl });
  assert.equal(fetch.calls[0].body.url, 'https://news.example/a?x=1');
  assert.equal(data.level, 'url');
  assert.equal(data.density, 24.5);
});

test('fetchCrux falls back to the origin on 404', async () => {
  const fetch = fakeFetch({ status: 404, body: {} }, { status: 200, body: RECORD });
  const data = await fetchCrux({ apiKey: 'KEY', url: 'https://news.example/a', fetchImpl: fetch.impl });
  assert.equal(fetch.calls[1].body.origin, 'https://news.example');
  assert.equal(fetch.calls[1].body.url, undefined);
  assert.equal(data.level, 'origin');
});

test('fetchCrux falls back to the origin when the URL record has no ad metrics', async () => {
  const fetch = fakeFetch({ status: 200, body: NO_AD_METRICS }, { status: 200, body: RECORD });
  const data = await fetchCrux({ apiKey: 'KEY', url: 'https://news.example/a', fetchImpl: fetch.impl });
  assert.equal(data.level, 'origin');
});

test('fetchCrux returns null when neither URL nor origin has data', async () => {
  const fetch = fakeFetch({ status: 404, body: {} }, { status: 404, body: {} });
  assert.equal(await fetchCrux({ apiKey: 'KEY', url: 'https://news.example/', fetchImpl: fetch.impl }), null);
});

test('fetchCrux maps HTTP errors to CruxError codes', async () => {
  for (const [status, code] of [[400, 'invalid-key'], [403, 'invalid-key'], [429, 'quota'], [500, 'http']]) {
    const fetch = fakeFetch({ status, body: {} });
    await assert.rejects(fetchCrux({ apiKey: 'KEY', url: 'https://news.example/', fetchImpl: fetch.impl }), { code });
  }
});

test('fetchCrux reports network failures as offline', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchCrux({ apiKey: 'KEY', url: 'https://news.example/', fetchImpl }), { code: 'offline' });
});

test('cruxVisLink at origin level', () => {
  assert.equal(
    cruxVisLink('https://news.example/a/b#top'),
    'https://cruxvis.withgoogle.com/#/?view=ads&url=https%3A%2F%2Fnews.example%2F&identifier=origin&device=PHONE&periodStart=0&periodEnd=-1&display=p75s',
  );
});

test('cruxVisLink for desktop', () => {
  assert.match(cruxVisLink('https://news.example/', 'origin', 'DESKTOP'), /&device=DESKTOP&/);
});

test('cruxVisLink at URL level keeps path and query', () => {
  assert.equal(
    cruxVisLink('https://news.example/a/b?x=1#top', 'url'),
    'https://cruxvis.withgoogle.com/#/?view=ads&url=https%3A%2F%2Fnews.example%2Fa%2Fb%3Fx%3D1&identifier=url&device=PHONE&periodStart=0&periodEnd=-1&display=p75s',
  );
});

const reply = (status, body = {}) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('checkKey: data or "no data" means the key works; 400 and 403 mean rejected', async () => {
  assert.equal((await checkKey({ apiKey: 'k', url: 'https://news.example/', fetchImpl: reply(200, RECORD) })).status, 'valid');
  assert.equal((await checkKey({ apiKey: 'k', url: 'https://news.example/', fetchImpl: reply(404) })).status, 'valid');
  for (const status of [400, 403]) {
    const check = await checkKey({ apiKey: 'k', url: 'https://news.example/', fetchImpl: reply(status) });
    assert.equal(check.status, 'rejected');
    assert.match(check.message, /rejected the key/);
  }
});

test('checkKey: offline or out of quota keeps the key, unchecked', async () => {
  const offline = await checkKey({ apiKey: 'k', url: 'https://news.example/', fetchImpl: async () => { throw new Error('net'); } });
  assert.deepEqual(offline, { status: 'unchecked', message: "Saved, but it couldn't be checked now: Can't reach the CrUX API." });
  assert.equal((await checkKey({ apiKey: 'k', url: 'https://news.example/', fetchImpl: reply(429) })).status, 'unchecked');
});

test('checkKey asks about google.com when the tab is not a web page', async () => {
  const bodies = [];
  await checkKey({ apiKey: 'k', url: 'chrome://newtab/', fetchImpl: async (endpoint, init) => { bodies.push(JSON.parse(init.body)); return { status: 404, ok: false }; } });
  assert.equal(bodies[0].url, 'https://www.google.com/');
});

test('maskKey shows only the last four characters', () => {
  assert.equal(maskKey('AIzaSyD-abc123k3Q9'), '••••k3Q9');
  assert.equal(maskKey('abc'), '••••');
});

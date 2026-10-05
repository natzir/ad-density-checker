// CrUX API client for Chrome's experimental ad metrics (p75, PHONE or DESKTOP).

export const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
export const AD_METRICS = [
  'experimental_ad_density',
  'experimental_ad_count',
  'experimental_ad_cpu',
  'experimental_ad_kilobytes',
];
export const NO_FIELD_DATA =
  'No field data for this URL or origin (CrUX needs an ads.txt with authorized sellers and enough traffic).';

export class CruxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CruxError';
    this.code = code;
  }
}

export function isHttpUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function stripFragment(url) {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

export function buildRequest(apiKey, target, formFactor = 'PHONE') {
  return {
    endpoint: `${CRUX_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
    body: { ...target, formFactor, metrics: AD_METRICS },
  };
}

const pad = (n) => String(n).padStart(2, '0');

export function parseRecord(json, level) {
  const metrics = json?.record?.metrics ?? {};
  const p75 = (name) => {
    const v = metrics[name]?.percentiles?.p75;
    return v == null ? null : Number(v);
  };
  const d = json?.record?.collectionPeriod?.lastDate;
  return {
    level,
    density: p75('experimental_ad_density'),
    count: p75('experimental_ad_count'),
    cpuMs: p75('experimental_ad_cpu'),
    networkKB: p75('experimental_ad_kilobytes'),
    lastDate: d ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : null,
  };
}

const hasData = (r) => [r.density, r.count, r.cpuMs, r.networkKB].some((v) => v !== null);

// Queries the page URL first, then its origin. Returns null when neither has ad data.
export async function fetchCrux({ apiKey, url, formFactor = 'PHONE', fetchImpl = fetch }) {
  const page = stripFragment(url);
  const targets = [
    ['url', { url: page }],
    ['origin', { origin: new URL(page).origin }],
  ];
  for (const [level, target] of targets) {
    const { endpoint, body } = buildRequest(apiKey, target, formFactor);
    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new CruxError('offline', "Can't reach the CrUX API.");
    }
    if (res.status === 404) continue;
    if (res.status === 400 || res.status === 403) {
      throw new CruxError('invalid-key', "The CrUX API rejected the key (invalid, or the API isn't enabled in its Google Cloud project).");
    }
    if (res.status === 429) throw new CruxError('quota', 'CrUX API quota exceeded. Try again in a minute.');
    if (!res.ok) throw new CruxError('http', `CrUX API error ${res.status}.`);
    const record = parseRecord(await res.json(), level);
    if (hasData(record)) return record;
  }
  return null;
}

export function cruxVisLink(url, level = 'origin', formFactor = 'PHONE') {
  const page = stripFragment(url);
  const target = level === 'url' ? page : `${new URL(page).origin}/`;
  const params = new URLSearchParams({
    view: 'ads',
    url: target,
    identifier: level,
    device: formFactor,
    periodStart: '0',
    periodEnd: '-1',
    display: 'p75s',
  });
  return `https://cruxvis.withgoogle.com/#/?${params}`;
}

// Checks a key with one query before it is saved: rejected keys aren't saved; when the API can't
// answer now (offline, quota), the key is kept and the user told it wasn't checked.
export async function checkKey({ apiKey, url, formFactor = 'PHONE', fetchImpl = fetch }) {
  try {
    await fetchCrux({ apiKey, url: isHttpUrl(url) ? url : 'https://www.google.com/', formFactor, fetchImpl });
    return { status: 'valid', message: '' };
  } catch (error) {
    if (error.code === 'invalid-key') return { status: 'rejected', message: error.message };
    return { status: 'unchecked', message: `Saved, but it couldn't be checked now: ${error.message}` };
  }
}

export const maskKey = (key) => `••••${key.length > 4 ? key.slice(-4) : ''}`;

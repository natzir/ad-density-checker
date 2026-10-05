// Network rules in Adblock Plus syntax (EasyList and its regional lists) and a matcher: which rule,
// if any, makes a request an ad request. Cosmetic rules are left out, and so are rules with options
// this matcher doesn't understand (popup, csp, redirect…): skipped, never guessed.

const TYPES = new Set(['script', 'image', 'subdocument', 'xmlhttprequest', 'media', 'object', 'stylesheet', 'font', 'ping', 'other']);
const IGNORED = new Set(['match-case', 'important', 'all']);

// ABP pattern → RegExp: || anchors at a host, | at the start or end, ^ a separator, * anything.
function patternRegExp(body) {
  if (body.length > 2 && body.startsWith('/') && body.endsWith('/')) {
    try { return new RegExp(body.slice(1, -1), 'i'); } catch { return null; }
  }
  let source = body;
  let prefix = '';
  let suffix = '';
  if (source.startsWith('||')) { prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]*\\.)?'; source = source.slice(2); }
  else if (source.startsWith('|')) { prefix = '^'; source = source.slice(1); }
  if (source.endsWith('|')) { suffix = '$'; source = source.slice(0, -1); }
  const escaped = source
    .replace(/[.+?${}()[\]\\|]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\^/g, '(?:[^\\w.%-]|$)');
  return new RegExp(prefix + escaped + suffix, 'i');
}

// One network rule, or null.
export function parseRule(line) {
  const text = line.trim();
  if (!text || text.startsWith('!') || text.startsWith('[') || /#[@?$%]?#|#\+js/.test(text)) return null;
  const exception = text.startsWith('@@');
  let body = exception ? text.slice(2) : text;
  let options = '';
  const isRegExp = body.length > 2 && body.startsWith('/') && body.endsWith('/');
  const dollar = isRegExp ? -1 : body.lastIndexOf('$');
  if (dollar > 0) { options = body.slice(dollar + 1); body = body.slice(0, dollar); }
  const rule = { text, exception, thirdParty: null, types: null, notTypes: null, domains: null, notDomains: null, host: null, anchored: body.startsWith('||'), re: null };
  for (const option of options ? options.split(',') : []) {
    const [name, value] = option.split('=');
    const negated = name.startsWith('~');
    const key = negated ? name.slice(1) : name;
    if (key === 'third-party') rule.thirdParty = !negated;
    else if (key === 'domain' && value) {
      for (const domain of value.split('|')) {
        if (domain.startsWith('~')) (rule.notDomains ??= []).push(domain.slice(1).toLowerCase());
        else (rule.domains ??= []).push(domain.toLowerCase());
      }
    } else if (TYPES.has(key)) (negated ? (rule.notTypes ??= []) : (rule.types ??= [])).push(key);
    else if (!IGNORED.has(key)) return null;
  }
  if (!body) return null;
  rule.re = patternRegExp(body);
  if (!rule.re) return null;
  const host = body.match(/^\|\|([a-z0-9.-]+)\^?$/i);
  if (host) rule.host = host[1].toLowerCase();
  return rule;
}

// Which rules have a say. An exception always does. A blocking rule only when its pattern is anchored
// to a host (||host…): that names an ad company. A URL-shape guess (://ads.$…, /ads/*) matches a
// site's own code just as well (Estadio Deportivo serves its own promotions from ads.meteored.com).
export function decides(rule) {
  return rule.exception || rule.anchored;
}

export function compileRules(lines) {
  const index = { hosts: new Map(), patterns: [], exceptions: [] };
  for (const line of lines) {
    const rule = parseRule(line);
    if (!rule || !decides(rule)) continue;
    if (rule.exception) index.exceptions.push(rule);
    else if (rule.host) {
      if (!index.hosts.has(rule.host)) index.hosts.set(rule.host, []);
      index.hosts.get(rule.host).push(rule);
    } else index.patterns.push(rule);
  }
  return index;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// The site a host belongs to: its last two labels, three under country second levels (co.uk, com.ar).
export function siteOf(host) {
  const labels = host.split('.');
  const country = labels.length >= 3 && labels.at(-1).length === 2 && /^(co|com|org|net|gov|gob|edu|ac|or|ne)$/.test(labels.at(-2));
  return labels.slice(country ? -3 : -2).join('.');
}

const within = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function applies(rule, url, host, { type, pageHost }) {
  if (rule.thirdParty !== null && (siteOf(host) !== siteOf(pageHost)) !== rule.thirdParty) return false;
  if (rule.types && !rule.types.includes(type)) return false;
  if (rule.notTypes?.includes(type)) return false;
  if (rule.domains && !rule.domains.some((d) => within(pageHost, d))) return false;
  if (rule.notDomains?.some((d) => within(pageHost, d))) return false;
  return rule.re.test(url);
}

// The text of the rule that makes url an ad request on pageHost, or null (no rule, or an exception).
export function matchAdRule(index, url, context) {
  const { type, pageHost = '' } = context;
  const ctx = { type, pageHost };
  const host = hostOf(url);
  if (!host) return null;
  let found = null;
  for (let h = host; h && !found; h = h.includes('.') ? h.slice(h.indexOf('.') + 1) : '') {
    found = (index.hosts.get(h) ?? []).find((rule) => applies(rule, url, host, ctx)) ?? null;
  }
  found ??= index.patterns.find((rule) => applies(rule, url, host, ctx)) ?? null;
  if (!found) return null;
  return index.exceptions.some((rule) => applies(rule, url, host, ctx)) ? null : found.text;
}

// The bundled lists, compiled on first use. Only the service worker (background.js) imports this
// module: Chrome forbids dynamic imports there, and the side panel has no use for a few MB of rules.
// An ad blocker's user runs EasyList plus their own language's list, so a page gets those only.
import { compileRules } from './adlist.js';
import { LISTS, RULES } from './adlists.js';

// Languages by country-code TLD, for pages without a lang attribute.
const TLD_LANGUAGE = {
  es: 'es', mx: 'es', ar: 'es', co: 'es', cl: 'es', pe: 'es', ve: 'es', uy: 'es', ec: 'es', bo: 'es', py: 'es',
  cr: 'es', do: 'es', gt: 'es', hn: 'es', ni: 'es', pa: 'es', sv: 'es',
  fr: 'fr', de: 'de', at: 'de', it: 'it', pt: 'pt', br: 'pt', nl: 'nl', pl: 'pl', lt: 'lt', cz: 'cs', sk: 'sk',
  ro: 'ro', md: 'ro', bg: 'bg', ru: 'ru', by: 'ru', kz: 'ru', uz: 'ru', ua: 'uk',
  cn: 'zh', tw: 'zh', hk: 'zh', kr: 'ko', in: 'hi', vn: 'vi', id: 'id', my: 'id',
  sa: 'ar', ae: 'ar', eg: 'ar', ma: 'ar', dz: 'ar', tn: 'ar', iq: 'ar', jo: 'ar', kw: 'ar', qa: 'ar', om: 'ar', bh: 'ar', lb: 'ar',
};

// Subtags that say nothing about the language: undetermined, no linguistic content, multiple, uncoded.
const NO_LANGUAGE = new Set(['und', 'zxx', 'mul', 'mis']);

// The primary language subtag of lang ('es-ES', 'pt_BR'), else the host's country's language, else ''.
export function pageLanguage(lang, host) {
  const subtag = String(lang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (/^[a-z]{2,3}$/.test(subtag) && !NO_LANGUAGE.has(subtag)) return subtag;
  return TLD_LANGUAGE[String(host ?? '').toLowerCase().replace(/\.+$/, '').split('.').pop()] ?? '';
}

// EasyList, then the lists of the page's language.
export function listsFor(lang, host) {
  const language = pageLanguage(lang, host);
  return LISTS.filter((l) => l.langs.includes('*') || (language && l.langs.includes(language))).map((l) => l.name);
}

// Each set compiles EasyList again (tens of MB of heap): only the most recently used one is kept.
let compiled = null; // { key, index }
export function bundledRules(lang = '', host = '') {
  const names = listsFor(lang, host);
  const key = names.join('|');
  if (compiled?.key !== key) {
    const index = compileRules(names.flatMap((name) => RULES[name]));
    // The first list (in LISTS order) holding each rule names it in a reason.
    index.listOf = new Map();
    for (const name of names) for (const text of RULES[name]) if (!index.listOf.has(text)) index.listOf.set(text, name);
    compiled = { key, index };
  }
  return compiled.index;
}

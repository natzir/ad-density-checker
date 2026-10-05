// Ad scripts as Chrome's ad tagging decides them, with the full lists instead of Chrome's cut-down
// one: a script a list rule covers, or one an ad script loaded (it inherits the rule). And whether an
// element was made by one, from its creation stack (DOM.getNodeStackTraces).

import { hostOf, siteOf } from './adlist.js';

// The ad script a stack runs through, or null. Only the first level with script URLs decides (the
// code that ran, not what scheduled it), and only when every frame with a URL in it is an ad script:
// a script that wraps DOM methods sits on the stack of everything the page inserts. Frames without a
// URL (eval) are skipped. The ad is the innermost such frame's.
function stackAd(stack, scriptFor) {
  for (let s = stack; s; s = s.parent) {
    const frames = (s.callFrames ?? []).filter((frame) => frame.url);
    if (!frames.length) continue;
    const ads = frames.map((frame) => scriptFor(frame.url));
    return ads.every(Boolean) ? { ad: ads[0], script: frames[0].url } : null;
  }
  return null;
}

// match(url, type): the rule that covers the request, or null.
export function adScriptTracker(match) {
  const scripts = new Map(); // url → { rule, via }
  const scriptFor = (url) => scripts.get(url) ?? null;
  return {
    onRequest({ url, type, initiator }) {
      if (type !== 'Script' || scripts.has(url)) return;
      const rule = match(url, 'script');
      if (rule) {
        scripts.set(url, { rule, via: null });
        return;
      }
      // Asked for by an ad script: with no stack, the script (or document) named by the initiator.
      // Only one of its own site: ad-security scripts re-insert other parties' scripts (a consent
      // wall, a cookie banner), while an ad company's own scripts share its site.
      const parent = initiator?.stack ? stackAd(initiator.stack, scriptFor) : { ad: scriptFor(initiator?.url), script: initiator?.url };
      if (parent?.ad && siteOf(hostOf(parent.script)) === siteOf(hostOf(url))) scripts.set(url, { rule: parent.ad.rule, via: url });
    },
    scriptFor,
  };
}

// The ad script that made an element, from its creation stack (Runtime.StackTrace), or null.
export function creatorAd(stack, tracker) {
  const found = stackAd(stack, tracker.scriptFor);
  return found ? { rule: found.ad.rule, script: found.script, inherited: found.ad.via != null } : null;
}

// A rule as a reason shows it: a long domain= list cut to its first two, the whole at most 80 characters.
export function ruleLabel(text) {
  const label = text.replace(/(domain=)([^,]*)/, (all, key, list) => {
    const domains = list.split('|');
    return domains.length > 2 ? `${key}${domains.slice(0, 2).join('|')}|…` : all;
  });
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}

// rule is the label the runner's matcher gave: the list's name and the rule.
export function easylistWhy({ rule, script, inherited }) {
  const file = script ? script.split(/[?#]/)[0].split('/').pop() : '';
  return `${rule}${inherited && file ? ` via ${file}` : ''}`;
}

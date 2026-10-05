import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adScriptTracker, creatorAd, easylistWhy, ruleLabel } from '../lib/ad-scripts.js';

const LOADER = 'https://static.sunmedia.tv/integrations/8e63b0ec/8e63b0ec.js';
const SDK = 'https://static.sunmedia.tv/sdks/intext/1.96.0/intext.js';
const match = (url, type) => (type === 'script' && url.includes('static.sunmedia.tv/integrations/') ? '||static.sunmedia.tv/integrations/' : null);

test('a script a rule covers is an ad script; one it loads inherits the rule (SunMedia)', () => {
  const tracker = adScriptTracker(match);
  tracker.onRequest({ url: LOADER, type: 'Script', initiator: { type: 'parser', url: 'https://www.farodevigo.es/x.html' } });
  tracker.onRequest({ url: SDK, type: 'Script', initiator: { type: 'script', stack: { callFrames: [{ url: LOADER }] } } });
  tracker.onRequest({ url: 'https://www.farodevigo.es/app.js', type: 'Script', initiator: { type: 'parser', url: 'https://www.farodevigo.es/x.html' } });
  assert.deepEqual(tracker.scriptFor(LOADER), { rule: '||static.sunmedia.tv/integrations/', via: null });
  assert.deepEqual(tracker.scriptFor(SDK), { rule: '||static.sunmedia.tv/integrations/', via: SDK });
  assert.equal(tracker.scriptFor('https://www.farodevigo.es/app.js'), null);
});

test('the initiator can be an async stack, and only scripts are tracked', () => {
  const tracker = adScriptTracker(match);
  tracker.onRequest({ url: LOADER, type: 'Script', initiator: {} });
  tracker.onRequest({ url: SDK, type: 'Script', initiator: { type: 'script', stack: { callFrames: [], parent: { callFrames: [{ url: LOADER }] } } } });
  tracker.onRequest({ url: 'https://static.sunmedia.tv/integrations/pixel.gif', type: 'Image', initiator: {} });
  assert.ok(tracker.scriptFor(SDK));
  assert.equal(tracker.scriptFor('https://static.sunmedia.tv/integrations/pixel.gif'), null);
});

test('who made an element: the ad script that ran, sync or async', () => {
  const tracker = adScriptTracker(match);
  tracker.onRequest({ url: LOADER, type: 'Script', initiator: {} });
  tracker.onRequest({ url: SDK, type: 'Script', initiator: { stack: { callFrames: [{ url: LOADER }] } } });
  assert.deepEqual(creatorAd({ callFrames: [{ url: SDK }] }, tracker), { rule: '||static.sunmedia.tv/integrations/', script: SDK, inherited: true });
  assert.deepEqual(creatorAd({ callFrames: [], parent: { callFrames: [{ url: LOADER }] } }, tracker), { rule: '||static.sunmedia.tv/integrations/', script: LOADER, inherited: false });
  assert.equal(creatorAd({ callFrames: [{ url: 'https://www.farodevigo.es/app.js' }] }, tracker), null);
  // The page's own code ran, scheduled by an ad script: the page's element.
  assert.equal(creatorAd({ callFrames: [{ url: 'https://www.farodevigo.es/app.js' }], parent: { callFrames: [{ url: LOADER }] } }, tracker), null);
  assert.equal(creatorAd(undefined, tracker), null); // written in the HTML: no creation stack
});

test('the reason is the label, and the file when the script inherited it', () => {
  assert.equal(easylistWhy({ rule: 'EasyList ||x.com^', script: 'https://x.com/a.js', inherited: false }), 'EasyList ||x.com^');
  assert.equal(easylistWhy({ rule: 'EasyList ||static.sunmedia.tv/integrations/', script: `${SDK}?v=2`, inherited: true }), 'EasyList ||static.sunmedia.tv/integrations/ via intext.js');
});

const APP = 'https://www.farodevigo.es/app.js';
const trackerOf = () => {
  const tracker = adScriptTracker(match);
  tracker.onRequest({ url: LOADER, type: 'Script', initiator: {} });
  tracker.onRequest({ url: SDK, type: 'Script', initiator: { stack: { callFrames: [{ url: LOADER }] } } });
  return tracker;
};

test('a script that wraps DOM methods does not make everything the page inserts an ad\'s', () => {
  const tracker = trackerOf();
  // The code that ran is the first level's: a wrapper on top of the page's own insert is not the ad's.
  assert.equal(creatorAd({ callFrames: [{ url: LOADER }, { url: APP }] }, tracker), null);
  assert.equal(creatorAd({ callFrames: [{ url: LOADER }, { url: APP }], parent: { callFrames: [{ url: LOADER }] } }, tracker), null);
  // The ad's own frames, all of them: the innermost decides.
  assert.deepEqual(creatorAd({ callFrames: [{ url: SDK }, { url: SDK }] }, tracker), { rule: '||static.sunmedia.tv/integrations/', script: SDK, inherited: true });
  // Frames without a URL are skipped, and a level without any defers to its parent.
  assert.deepEqual(creatorAd({ callFrames: [{ url: '' }, { url: '' }], parent: { callFrames: [{ url: LOADER }] } }, tracker), { rule: '||static.sunmedia.tv/integrations/', script: LOADER, inherited: false });
  assert.equal(creatorAd({ callFrames: [{ url: '' }], parent: { callFrames: [{ url: APP }], parent: { callFrames: [{ url: LOADER }] } } }, tracker), null);
});

test('a script inherits only when the ad script is what ran, not a hook under the page\'s code', () => {
  const tracker = adScriptTracker(match);
  tracker.onRequest({ url: LOADER, type: 'Script', initiator: {} });
  const comments = 'https://www.farodevigo.es/comments.js';
  tracker.onRequest({ url: comments, type: 'Script', initiator: { stack: { callFrames: [{ url: LOADER }, { url: APP }] } } });
  assert.equal(tracker.scriptFor(comments), null);
  tracker.onRequest({ url: SDK, type: 'Script', initiator: { stack: { callFrames: [{ url: LOADER }] } } });
  assert.deepEqual(tracker.scriptFor(SDK), { rule: '||static.sunmedia.tv/integrations/', via: SDK });
  // No stack: the initiating document or script.
  const other = 'https://static.sunmedia.tv/x.js';
  tracker.onRequest({ url: other, type: 'Script', initiator: { type: 'script', url: LOADER } });
  assert.ok(tracker.scriptFor(other));
});

test('a script inherits only from an ad script of its own site', () => {
  const tracker = adScriptTracker((url, type) => (type === 'script' && /static\.sunmedia\.tv\/integrations\/|webcontentassessor\.com|adlightning\.com/.test(url) ? 'rule' : null));
  tracker.onRequest({ url: LOADER, type: 'Script', initiator: {} });
  tracker.onRequest({ url: SDK, type: 'Script', initiator: { stack: { callFrames: [{ url: 'https://static.sunmedia.tv/integrations/x.js' }] } } });
  assert.equal(tracker.scriptFor(SDK), null); // x.js was never requested: not an ad script
  tracker.onRequest({ url: 'https://static.sunmedia.tv/integrations/x.js', type: 'Script', initiator: {} });
  tracker.onRequest({ url: SDK + '?2', type: 'Script', initiator: { stack: { callFrames: [{ url: 'https://static.sunmedia.tv/integrations/x.js' }] } } });
  assert.equal(tracker.scriptFor(SDK + '?2').via, SDK + '?2');
  const verifier = 'https://cdn.webcontentassessor.com/x.js';
  tracker.onRequest({ url: verifier, type: 'Script', initiator: {} });
  const cmp = 'https://cmp.example-news.com/cmp2ui-en.js';
  tracker.onRequest({ url: cmp, type: 'Script', initiator: { stack: { callFrames: [{ url: verifier }] } } });
  assert.equal(tracker.scriptFor(cmp), null);
  tracker.onRequest({ url: 'https://cdn.adlightning.com/x.js', type: 'Script', initiator: {} });
  const banner = 'https://cdn.cookielaw.org/scripttemplates/otBannerSdk.js';
  tracker.onRequest({ url: banner, type: 'Script', initiator: { url: 'https://cdn.adlightning.com/x.js' } });
  assert.equal(tracker.scriptFor(banner), null);
});

test('a rule label keeps two domains of a long domain= list and is at most 80 characters', () => {
  const rule = `||ads.example^$script,domain=${Array.from({ length: 100 }, (_, i) => `site${i}.com`).join('|')}`;
  const label = ruleLabel(rule);
  assert.ok(label.length <= 80);
  assert.ok(label.startsWith('||ads.example^$script,domain=site0.com|site1.com|'));
  assert.ok(label.endsWith('…'));
  assert.equal(ruleLabel('||x.com^$domain=a.com|b.com'), '||x.com^$domain=a.com|b.com');
  assert.equal(ruleLabel('||x.com^'), '||x.com^');
  const long = `||example.com/${'a'.repeat(200)}`;
  assert.equal(ruleLabel(long).length, 80);
  assert.ok(ruleLabel(long).endsWith('…'));
});

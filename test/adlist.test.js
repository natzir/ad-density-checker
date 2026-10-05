import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, decides, matchAdRule, parseRule, siteOf } from '../lib/adlist.js';
import { bundledRules } from '../lib/bundled-rules.js';

const index = (...lines) => compileRules(lines);
const on = (pageHost, type = 'script') => ({ type, pageHost });

test('a host rule covers the host and its subdomains, not look-alikes', () => {
  const rules = index('||doubleclick.net^');
  assert.equal(matchAdRule(rules, 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', on('news.es')), '||doubleclick.net^');
  assert.equal(matchAdRule(rules, 'https://doubleclick.net/x', on('news.es')), '||doubleclick.net^');
  assert.equal(matchAdRule(rules, 'https://notdoubleclick.net/x', on('news.es')), null);
  assert.equal(matchAdRule(rules, 'https://doubleclick.net.evil.com/x', on('news.es')), null);
});

test('a path rule covers that path only (SunMedia: the loader, not the SDK it loads)', () => {
  const rules = index('||static.sunmedia.tv/integrations/');
  assert.equal(matchAdRule(rules, 'https://static.sunmedia.tv/integrations/8e63b0ec/8e63b0ec.js', on('farodevigo.es')), '||static.sunmedia.tv/integrations/');
  assert.equal(matchAdRule(rules, 'https://static.sunmedia.tv/sdks/intext/1.96.0/intext.js', on('farodevigo.es')), null);
});

test('third-party rules depend on the page\'s site', () => {
  const rules = index('||cdn.example.com^$third-party');
  assert.equal(matchAdRule(rules, 'https://cdn.example.com/a.js', on('www.example.com')), null);
  assert.equal(matchAdRule(rules, 'https://cdn.example.com/a.js', on('news.es')), '||cdn.example.com^$third-party');
});

test('domain= limits a rule to some sites and leaves others out', () => {
  const rules = index('||ads.example^$domain=foo.com|~bar.foo.com');
  assert.equal(matchAdRule(rules, 'https://ads.example/x.js', on('www.foo.com')), '||ads.example^$domain=foo.com|~bar.foo.com');
  assert.equal(matchAdRule(rules, 'https://ads.example/x.js', on('bar.foo.com')), null);
  assert.equal(matchAdRule(rules, 'https://ads.example/x.js', on('other.com')), null);
});

test('resource types: a rule for frames does not cover a script', () => {
  const rules = index('||x.com/adframe.$subdocument');
  assert.equal(matchAdRule(rules, 'https://x.com/adframe.html', on('news.es', 'subdocument')), '||x.com/adframe.$subdocument');
  assert.equal(matchAdRule(rules, 'https://x.com/adframe.js', on('news.es', 'script')), null);
});

test('an exception wins over the rule', () => {
  const rules = index('||example.com/ads/', '@@||example.com/ads/ok.js');
  assert.equal(matchAdRule(rules, 'https://example.com/ads/ok.js', on('news.es')), null);
  assert.equal(matchAdRule(rules, 'https://example.com/ads/banner.js', on('news.es')), '||example.com/ads/');
});

test('end anchors, separators and wildcards', () => {
  const rules = index('||x.com/lib.adserver.js|', '||example.com/banner*/img^');
  assert.equal(matchAdRule(rules, 'https://x.com/lib.adserver.js', on('news.es')), '||x.com/lib.adserver.js|');
  assert.equal(matchAdRule(rules, 'https://x.com/lib.adserver.js?v=1', on('news.es')), null);
  assert.equal(matchAdRule(rules, 'https://example.com/banner-2024/img?a=1', on('news.es')), '||example.com/banner*/img^');
});

test('not network rules: comments, cosmetic rules and options the matcher does not know are skipped', () => {
  for (const line of ['! comment', '[Adblock Plus 2.0]', '##.ad-slot', 'example.com##.ad', 'example.com#@#.ad', '||popup.example^$popup', '||x.example^$csp=script-src', '']) {
    assert.equal(parseRule(line), null, line);
  }
});

test('the site of a host: its last two labels, three under country second levels', () => {
  assert.equal(siteOf('a.b.example.com'), 'example.com');
  assert.equal(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteOf('www.clarin.com.ar'), 'clarin.com.ar');
});

test('a literal | inside a pattern is not regex alternation', () => {
  const rules = index('||q.com/ads/x|y.js');
  assert.equal(matchAdRule(rules, 'https://q.com/ads/x|y.js', on('news.es')), '||q.com/ads/x|y.js');
  assert.equal(matchAdRule(rules, 'https://q.com/ads/y.js', on('news.es')), null);
});

test('missing pageHost does not throw; third-party and domain rules still apply', () => {
  const thirdPartyRules = index('||cdn.example.com^$third-party');
  const domainRules = index('||ads.example^$domain=foo.com');
  // third-party rule with empty pageHost: '' vs 'cdn.example.com' are different sites, so rule applies
  assert.equal(matchAdRule(thirdPartyRules, 'https://cdn.example.com/a.js', { type: 'script' }), '||cdn.example.com^$third-party');
  // domain rule with empty pageHost: '' does not match foo.com, so rule does not apply
  assert.equal(matchAdRule(domainRules, 'https://ads.example/x.js', { type: 'script' }), null);
});

test('regex patterns still parse (their separators and classes), though they do not decide', () => {
  const { re } = parseRule('/\\/ad[0-9]+\\.js$/');
  assert.ok(re.test('https://x.com/ad12.js'));
  assert.ok(!re.test('https://x.com/ad.js'));
});

test('only exceptions and host-anchored rules decide', () => {
  for (const line of ['||sunmedia.tv^$third-party', '||static.sunmedia.tv/integrations/', '@@||example.com/ads.js', '@@/ads/allowed.js']) {
    assert.ok(decides(parseRule(line)), line);
  }
  for (const line of ['://ads.$~image', '/production/ads/*$script', '/^https?:\\/\\/ads\\./', '|https://ads.']) {
    assert.ok(!decides(parseRule(line)), line);
  }
});

test('a URL-shape rule does not match the site\'s own ads host', () => {
  assert.equal(matchAdRule(index('://ads.$~image'), 'https://ads.meteored.com/js/bundle/x.js', on('www.estadiodeportivo.com')), null);
});

test('the bundled lists hold SunMedia\'s loader and Google\'s ad server, and name their sources', async () => {
  const { LISTS, RULES } = await import('../lib/adlists.js');
  assert.ok(LISTS.some((l) => l.name === 'EasyList') && LISTS.some((l) => l.name === 'Liste FR'));
  assert.deepEqual(LISTS.find((l) => l.name === 'EasyList').langs, ['*']);
  assert.ok(RULES['EasyList'].length > 1000);
  const rules = bundledRules('en', 'www.farodevigo.es');
  assert.match(matchAdRule(rules, 'https://static.sunmedia.tv/integrations/8e63b0ec/8e63b0ec.js', on('www.farodevigo.es')) ?? '', /sunmedia\.tv/);
  assert.ok(matchAdRule(rules, 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', on('news.es')));
});

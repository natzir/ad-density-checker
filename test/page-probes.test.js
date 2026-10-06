import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adItems, articleEndNow, contentBounds, dismissOverlay, hideFixedAds, hideFixedBars, labelledAdBoxes, markAdCandidates, markArticleEnd, showHidden } from '../lib/page-probes.js';
import { el, stubPage } from './stub-dom.js';

const MOBILE = { width: 412, height: 823 };

// --- adItems -------------------------------------------------------------------------------

test('an ad below the screen is not judged yet (shown: null)', () => {
  const ad = el('iframe', { box: { x: 46, y: 2000, w: 320, h: 100 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [ad]) });
  const [item] = page.run(adItems, ad);
  assert.equal(item.shown, null);
  assert.equal(item.visible, true); // Chrome counts off-screen ads as visible
});

test('an ad fixed off the screen, above it and beside it, is not shown: it never comes on screen (HuffPost\'s tags at −412, −823)', () => {
  const ad = el('iframe', { box: { x: -412, y: -823, w: 412, h: 823 } });
  const layer = el('div', { position: 'fixed', box: { x: -412, y: -823, w: 412, h: 823 } }, [ad]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [layer]) });
  assert.equal(page.run(adItems, ad)[0].shown, false);
});

test('an ad fixed below the screen is not shown: scrolling never brings it up', () => {
  const ad = el('iframe', { box: { x: 46, y: 900, w: 320, h: 100 } });
  const layer = el('div', { position: 'fixed', box: { x: 46, y: 900, w: 320, h: 100 } }, [ad]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [layer]) });
  assert.equal(page.run(adItems, ad)[0].shown, false);
});

test('an ad beside the screen and below it (a slider\'s slide further down) is not shown', () => {
  const ad = el('iframe', { box: { x: 412, y: 2000, w: 320, h: 250 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [ad]) });
  assert.equal(page.run(adItems, ad)[0].shown, false);
});

test('an ad on screen with content on top is not shown', () => {
  const ad = el('iframe', { box: { x: 46, y: 100, w: 320, h: 250 } });
  const cover = el('div', { box: { x: 0, y: 0, w: 412, h: 800 }, z: 5 });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [ad, cover]) });
  const [item] = page.run(adItems, ad, );
  assert.equal(item.shown, false);
  assert.equal(item.visible, false);
});

test('an ad covered by another ad still counts for Better Ads, not for Chrome', () => {
  const ad = el('iframe', { box: { x: 46, y: 100, w: 320, h: 250 } });
  const other = el('iframe', { box: { x: 46, y: 100, w: 320, h: 250 }, z: 5 });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [ad, other]) });
  const [item] = page.run(adItems, ad, other);
  assert.equal(item.shown, true);
  assert.equal(item.visible, false);
});

test('an ad beside the screen (a slider slide) is not shown', () => {
  const ad = el('iframe', { box: { x: 412, y: 100, w: 320, h: 250 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [ad]) });
  const [item] = page.run(adItems, ad);
  assert.equal(item.shown, false);
});

test('a fixed anchor ad at the bottom edge counts even if it ignores pointer events', () => {
  const ad = el('iframe', { box: { x: 46, y: 723, w: 320, h: 100 }, pointerEvents: 'none' });
  const floor = el('div', { position: 'fixed', box: { x: 0, y: 723, w: 412, h: 100 }, pointerEvents: 'none' }, [ad]);
  const footer = el('div', { box: { x: 0, y: 0, w: 412, h: 3000 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, scrollY: 1000, body: el('body', {}, [footer, floor]) });
  const [item] = page.run(adItems, ad);
  assert.equal(item.shown, true);
});

test('a body tagged as an ad is the page: not an ad for Better Ads, and not a cover for others', () => {
  const ad = el('iframe', { box: { x: 46, y: 100, w: 320, h: 250 } });
  const cover = el('div', { box: { x: 0, y: 0, w: 412, h: 800 }, z: 5 });
  const body = el('body', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [ad, cover]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body });
  const [bodyItem, adItem] = page.run(adItems, body, ad);
  assert.equal(bodyItem.page, true);
  assert.equal(bodyItem.shown, false);
  assert.equal(adItem.shown, false); // behind content: the tagged body doesn't make the hit an ad
  assert.equal(adItem.nested, false);
});

test('a big full-width ad without page content is not mistaken for the page', () => {
  const ad = el('div', { box: { x: 0, y: 0, w: 412, h: 2000 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [ad]) });
  const [item] = page.run(adItems, ad);
  assert.equal(item.page, false);
});

test('an ad inside another shown ad is nested; video ads are flagged', () => {
  const video = el('video', { box: { x: 46, y: 100, w: 320, h: 180 } });
  const inner = el('iframe', { box: { x: 46, y: 100, w: 320, h: 180 } }, [video]);
  const outer = el('div', { box: { x: 46, y: 100, w: 320, h: 200 } }, [inner]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [outer]) });
  const [outerItem, innerItem] = page.run(adItems, outer, inner);
  assert.equal(outerItem.nested, false);
  assert.equal(innerItem.nested, true);
  assert.equal(outerItem.video, true);
});

// A player with Google IMA's ad box (Connatix's on NY Post, El País's): the SDK's frame and the <video> it
// plays the ads in sit in a box of their own beside the player's video (as recorded on both, 2026-10-04).
const imaPlayer = ({ content = false, ad = false } = {}) => {
  const box = { x: 46, y: 100, w: 320, h: 180 };
  const playing = (on) => ({ paused: !on, ended: false, currentTime: on ? 4 : 0 });
  const contentVideo = Object.assign(el('video', { box }), playing(content));
  const adVideo = Object.assign(el('video', { box: ad ? box : null }), playing(ad)); // 0 × 0 between ads
  const frame = el('iframe', { attrs: { src: 'https://imasdk.googleapis.com/js/core/bridge3.html' }, box });
  const closeBar = el('div', { box: { x: 46, y: 80, w: 320, h: 20 } }); // the floating player's close bar, no <video>
  const player = el('div', { box }, [closeBar, contentVideo, el('div', { box }, [adVideo, frame])]);
  return { player, frame, contentVideo, closeBar, body: el('body', {}, [player]) };
};

test('a player showing its own video while its IMA ad box plays nothing shows content', () => {
  const { player, body } = imaPlayer({ content: true });
  const [item] = stubPage({ ...MOBILE, pageHeight: 3000, body }).run(adItems, player);
  assert.equal(item.player, 'content');
});

test('a player whose IMA ad box plays an ad shows an ad', () => {
  const { player, body } = imaPlayer({ ad: true });
  const [item] = stubPage({ ...MOBILE, pageHeight: 3000, body }).run(adItems, player);
  assert.equal(item.player, 'ad');
});

test('the player\'s own <video> tagged on its own (Chrome tags each piece Connatix\'s script made) is judged by its player', () => {
  const content = imaPlayer({ content: true });
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: content.body }).run(adItems, content.contentVideo)[0].player, 'content');
  const ad = imaPlayer({ ad: true });
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: ad.body }).run(adItems, ad.contentVideo)[0].player, 'ad');
});

test('a piece of the player without a video (Connatix\'s floating close bar, an EasyList element) shows what the player shows', () => {
  const content = imaPlayer({ content: true });
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: content.body }).run(adItems, content.closeBar)[0].player, 'content');
  const ad = imaPlayer({ ad: true });
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: ad.body }).run(adItems, ad.closeBar)[0].player, 'ad');
});

test('the pieces of one player share its key, the same from one sample to the next; another player has its own', () => {
  const one = imaPlayer({ content: true });
  const two = imaPlayer({ content: true });
  two.player.box = { x: 46, y: 900, w: 320, h: 180 };
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [one.player, two.player]) });
  const [video, bar] = page.run(adItems, one.contentVideo, one.closeBar);
  assert.ok(video.playerKey);
  assert.equal(bar.playerKey, video.playerKey);
  assert.equal(page.run(adItems, one.frame)[0].playerKey, video.playerKey);
  assert.notEqual(page.run(adItems, two.contentVideo)[0].playerKey, video.playerKey);
});

test('a video is not judged by an IMA box far around it (another player in the same column)', () => {
  const box = { x: 46, y: 100, w: 320, h: 180 };
  const video = Object.assign(el('video', { box }), { paused: false, ended: false, currentTime: 4 });
  const other = imaPlayer({ content: true });
  other.player.box = { x: 46, y: 900, w: 320, h: 180 };
  const column = el('div', { box: { x: 46, y: 100, w: 320, h: 980 } }, [el('div', { box }, [video]), other.player]);
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [column]) }).run(adItems, video)[0].player, null);
});

test('the IMA frame tagged on its own is judged by the player around it', () => {
  const content = imaPlayer({ content: true });
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: content.body }).run(adItems, content.frame)[0].player, 'content');
  const ad = imaPlayer({ ad: true });
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: ad.body }).run(adItems, ad.frame)[0].player, 'ad');
});

test('a player playing nothing, or a video ad without an IMA box (an outstream unit), is not judged', () => {
  const idle = imaPlayer();
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: idle.body }).run(adItems, idle.player)[0].player, null);
  const video = Object.assign(el('video', { box: { x: 46, y: 100, w: 320, h: 180 } }), { paused: false, ended: false, currentTime: 4 });
  const unit = el('div', { box: { x: 46, y: 100, w: 320, h: 180 } }, [video]);
  assert.equal(stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [unit]) }).run(adItems, unit)[0].player, null);
});

test('an ad element shows nothing when it has no media, frame, shadow root, text or background image', () => {
  const box = { x: 0, y: 100, w: 300, h: 250 };
  const empty = el('div', { box });
  const withFrame = el('div', { box }, [el('div', {}, [el('iframe', { box })])]);
  const withImage = el('div', { box }, [el('img', { box })]);
  const withText = el('div', { box }, [el('span', { text: ' Sponsored ' })]);
  const withBlankText = el('div', { box, text: '  ' });
  const withBackground = el('div', { box, backgroundImage: 'url(a.png)' });
  const withShadow = el('div', { box, shadowRoot: true });
  const holdingShadow = el('div', { box }, [el('div', {}, [el('div', { shadowRoot: true })])]);
  const frame = el('iframe', { box });
  const page = stubPage({ width: 412, height: 823, pageHeight: 3000, body: el('body', {}, [empty, withFrame, withImage, withText, withBlankText, withBackground, withShadow, holdingShadow, frame]) });
  const items = page.run(adItems, empty, withFrame, withImage, withText, withBlankText, withBackground, withShadow, holdingShadow, frame);
  assert.deepEqual(items.map((i) => i.empty), [true, false, false, false, true, false, false, false, false]);
});

test('an ad element says whether it holds the page\'s content (main, article or h1), however narrow', () => {
  // A skin's centred wrapper and an in-image vendor's wrapper around the article: narrower than the page guard's 90 %.
  const DESKTOP = { width: 1350, height: 940 };
  const skin = el('div', { box: { x: 275, y: 0, w: 800, h: 5000 } }, [el('main', { box: { x: 275, y: 100, w: 800, h: 4000 } })]);
  const vendor = el('div', { box: { x: 275, y: 100, w: 800, h: 3000 } }, [el('h1', { text: 'La noticia', box: { x: 300, y: 120, w: 700, h: 80 } })]);
  const story = el('div', { box: { x: 275, y: 100, w: 800, h: 3000 } }, [el('article', { box: { x: 275, y: 100, w: 800, h: 3000 } })]);
  const banner = el('div', { box: { x: 525, y: 200, w: 300, h: 250 } }, [el('iframe', { box: { x: 525, y: 200, w: 300, h: 250 } })]);
  const page = stubPage({ ...DESKTOP, pageHeight: 12000, body: el('body', {}, [skin, vendor, story, banner]) });
  const items = page.run(adItems, skin, vendor, story, banner);
  assert.deepEqual(items.map((i) => [i.holdsContent, i.page]), [[true, false], [true, false], [true, false], [false, false]]);
});

test('boxes of one pixel or less are dropped', () => {
  const pixel = el('img', { box: { x: 0, y: 0, w: 1, h: 1 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [pixel]) });
  assert.deepEqual(page.run(adItems, pixel), [null]);
});

// --- contentBounds ---------------------------------------------------------------------------

const header = (h = 80) => el('header', { box: { x: 0, y: 0, w: 412, h } });
// The article's text: paragraphs of 100 characters, 100 px tall, at these tops.
const TEXT = 'El presidente del Gobierno dedicará el fin de semana a decidir si convoca unas elecciones anticipadas.';
const paragraphs = (...tops) => tops.map((y) => el('p', { text: TEXT, box: { x: 16, y, w: 380, h: 100 } }));
// Links to other stories, with headline-length text, 60 px apart from y.
const headlines = (y, n = 2) => [...Array(n)].map((_, i) =>
  el('a', { attrs: { href: `/otra-noticia-${y}-${i}` }, text: 'Otra noticia del día con un titular bastante largo', box: { x: 16, y: y + i * 60, w: 380, h: 50 } }));
const articleMeta = () => el('meta', { attrs: { property: 'og:type', content: 'article' } });

test('the main content begins below the site header, even with a billboard above it', () => {
  const billboard = el('div', { box: { x: 0, y: 0, w: 412, h: 250 } });
  const siteHeader = el('header', { box: { x: 0, y: 250, w: 412, h: 80 } });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [billboard, siteHeader]) });
  assert.equal(page.run(contentBounds, 0).begin, 330);
});

test('on an article page whose header is not marked up, the main content begins at the headline or the ad above it', () => {
  // Europa Press, La Voz de Galicia: the site header is a plain <div>.
  const ad = el('iframe', { box: { x: 46, y: 360, w: 320, h: 90 } });
  const page = (...extra) => stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(),
      el('div', { box: { x: 0, y: 0, w: 412, h: 350 } }),
      ...extra,
      el('h1', { text: 'La noticia', box: { x: 16, y: 470, w: 380, h: 100 } }),
      el('div', { box: { x: 0, y: 600, w: 412, h: 2400 } }, paragraphs(600, 800, 2900)),
    ]),
  });
  assert.equal(page(ad).run(contentBounds, 0, ad).begin, 360);
  assert.equal(page().run(contentBounds, 0).begin, 470);
});

test('only an ad above the headline moves the beginning up: not a tagged wrapper around it, nor a pixel', () => {
  const skin = el('div', { box: { x: 0, y: 0, w: 412, h: 7000 } }); // a skin: the page tagged as an ad
  const pixel = el('iframe', { box: { x: -1000, y: -1000, w: 1, h: 1 } });
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), skin, pixel,
      el('div', { box: { x: 0, y: 0, w: 412, h: 350 } }),
      el('h1', { text: 'La noticia', box: { x: 16, y: 470, w: 380, h: 100 } }),
      el('div', { box: { x: 0, y: 600, w: 412, h: 2400 } }, paragraphs(600, 800, 2900)),
    ]),
  });
  assert.equal(page.run(contentBounds, 0, skin, pixel).begin, 470);
});

test('headers inside an article are not the site header', () => {
  const article = el('article', { box: { x: 0, y: 80, w: 412, h: 300 } }, [el('header', { box: { x: 0, y: 80, w: 412, h: 200 } })]);
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [header(), article]) });
  assert.equal(page.run(contentBounds, 0).begin, 80);
});

test('the site footer ends the main content; footers of article cards do not', () => {
  const card = el('article', { box: { x: 0, y: 1000, w: 412, h: 300 } }, [el('footer', { box: { x: 0, y: 1250, w: 412, h: 50 } })]);
  const siteFooter = el('footer', { box: { x: 0, y: 4500, w: 412, h: 500 } });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [header(), card, siteFooter]) });
  assert.equal(page.run(contentBounds, 0).end, 4500);
});

test('a related-block heading ends the main content only when it is the whole heading', () => {
  const related = el('h2', { text: 'Te puede interesar', box: { x: 0, y: 3000, w: 412, h: 40 } });
  const headline = el('h2', { text: 'Más información sobre el temporal', box: { x: 0, y: 2000, w: 412, h: 40 } });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [header(), headline, related]) });
  assert.equal(page.run(contentBounds, 0).end, 3000);
});

test('a heading repeated three times is a section pattern, not the related block', () => {
  const headings = [2000, 3000, 4000].map((y) => el('h3', { text: 'Más noticias', box: { x: 0, y, w: 412, h: 40 } }));
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [header(), ...headings]) });
  assert.equal(page.run(contentBounds, 0).end, 5000);
});

test('thresholds use the page height before scrolling, not the grown infinite page', () => {
  const related = el('h2', { text: 'Te recomendamos', box: { x: 0, y: 5000, w: 412, h: 40 } });
  const page = stubPage({ ...MOBILE, pageHeight: 25000, body: el('body', {}, [header(), related]) });
  assert.equal(page.run(contentBounds, 0).end, 25000); // 5000 is 20 % of the grown page: ignored
  assert.equal(page.run(contentBounds, 8000).end, 5000); // but 62 % of the page as it first loaded
});

test('on a page declared as an article, the main content ends with the first article', () => {
  const meta = el('meta', { attrs: { property: 'og:type', content: 'article' } });
  const first = el('article', { box: { x: 0, y: 100, w: 412, h: 4000 } });
  const next = el('article', { box: { x: 0, y: 4200, w: 412, h: 4000 } });
  const wrapper = el('div', {}, [first, next]);
  const page = stubPage({ ...MOBILE, pageHeight: 9000, body: el('body', {}, [meta, header(), wrapper]) });
  assert.equal(page.run(contentBounds, 0).articleEnd, 4100);
});

test('an outer article wrapping the infinite scroll loses to the first article inside', () => {
  const meta = el('meta', { attrs: { property: 'og:type', content: 'article' } });
  const first = el('article', { box: { x: 0, y: 100, w: 412, h: 4000 } });
  const outer = el('article', { box: { x: 0, y: 100, w: 412, h: 12000 } }, [first]);
  const page = stubPage({ ...MOBILE, pageHeight: 13000, body: el('body', {}, [meta, header(), outer]) });
  assert.equal(page.run(contentBounds, 0).articleEnd, 4100);
});


test('an article ends at the first block below its text that is not main content: an aside', () => {
  // Blink's annotated page content gives <aside> / role=complementary the complementary role.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300, 500, 2900),
      el('aside', { box: { x: 16, y: 3100, w: 380, h: 300 } }),
      el('div', { id: 'taboola-below', box: { x: 0, y: 3500, w: 412, h: 2000 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('a list of links to other stories below the text ends the article, heading or not', () => {
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300, 500, 2900),
      el('div', { box: { x: 16, y: 3100, w: 380, h: 120 } }, headlines(3100)),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('an article body split in two around an ad keeps both halves (Readability takes in the siblings)', () => {
  // Two sibling text blocks of the same size: a list of related links sits between them.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      el('div', { box: { x: 0, y: 300, w: 412, h: 700 } }, paragraphs(300, 500, 800)),
      el('div', { box: { x: 16, y: 1000, w: 380, h: 120 } }, headlines(1000)),
      el('iframe', { box: { x: 46, y: 1150, w: 300, h: 250 } }),
      el('div', { box: { x: 0, y: 1450, w: 412, h: 1550 } }, paragraphs(1450, 1650, 2900)),
      el('aside', { box: { x: 16, y: 3100, w: 380, h: 300 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('below the text, the page-level ends still count: a related heading, a footer by its id', () => {
  // "Lo más leído" as image cards with short link text, then a site footer that is a plain <div>.
  const card = (y) => el('a', { attrs: { href: `/nota-${y}` }, text: 'Breve', box: { x: 16, y, w: 380, h: 200 } });
  const page = stubPage({
    ...MOBILE,
    pageHeight: 6000,
    body: el('body', {}, [articleMeta(), header(),
      el('article', { box: { x: 0, y: 100, w: 412, h: 2900 } }, paragraphs(300, 500, 2800)),
      el('div', { box: { x: 0, y: 3000, w: 412, h: 2000 } }, [el('h2', { text: 'Lo más leído', box: { x: 16, y: 3000, w: 380, h: 40 } }), card(3050), card(3300)]),
      el('div', { id: 'footer', box: { x: 0, y: 5000, w: 412, h: 600 } }, [el('nav', { box: { x: 0, y: 5200, w: 412, h: 150 } })]),
    ]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3000);
});

test('a body split in two keeps both halves also one wrapper deeper (the container is an only child)', () => {
  const half = (y, h, ...tops) => el('div', { box: { x: 0, y, w: 412, h } }, [el('div', { box: { x: 0, y, w: 412, h } }, paragraphs(...tops))]);
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      half(300, 900, 300, 500, 800, 1000),
      el('div', { box: { x: 16, y: 1250, w: 380, h: 120 } }, headlines(1250)),
      half(1450, 1550, 1450, 1650, 2900),
      el('aside', { box: { x: 16, y: 3100, w: 380, h: 300 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('a list of links that carries its own <style> is still a list of links: CSS is not text', () => {
  // Libertad Digital's Outbrain block: no "outbrain" in its classes, a <style> block inside.
  const css = el('style', { text: '.AR_1.ob-widget .ob-rec-image-container .ob-rec-logo-container { position: absolute; right: 0; bottom: 0; }'.repeat(4) });
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300, 500, 2900),
      el('section', { box: { x: 16, y: 3100, w: 380, h: 300 } }, [css, ...headlines(3150, 3)]),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('nothing above the last of the article text ends it (a feed or related box between paragraphs)', () => {
  // Express marks its in-article ad slots "taboola"; Europa Press has a Taboola widget mid-article;
  // antena3 and 20minutos put related boxes before the last paragraph.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300),
      el('div', { className: 'ad-wrapper--taboola', box: { x: 0, y: 450, w: 412, h: 300 } }),
      el('div', { box: { x: 16, y: 800, w: 380, h: 120 } }, headlines(800)),
      el('aside', { box: { x: 16, y: 1000, w: 380, h: 200 } }),
      ...paragraphs(1300, 2900),
      el('aside', { box: { x: 16, y: 3200, w: 380, h: 300 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3200);
});

test('text cut off by a collapsed box ("Show full article") does not stretch the article over what follows the button', () => {
  // NDTV on a phone: the body sits in a 500 px box with overflow hidden; its paragraphs keep their
  // place in the layout down to 4600 px, under the related stories and sponsored cards below the button.
  const collapsed = el('div', { overflowY: 'hidden', box: { x: 0, y: 300, w: 412, h: 500 } }, paragraphs(300, 500, 700, 900, 1500, 2500, 3500, 4500));
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      collapsed,
      el('div', { box: { x: 16, y: 820, w: 380, h: 120 } }, headlines(820)),
      el('aside', { box: { x: 16, y: 5000, w: 380, h: 300 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 820);
});

test('a box with overflow hidden that holds all its text (a float clearfix) cuts nothing', () => {
  const wrapper = el('div', { overflowY: 'hidden', box: { x: 0, y: 300, w: 412, h: 2800 } }, paragraphs(300, 500, 2900));
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      wrapper,
      el('div', { box: { x: 16, y: 1000, w: 380, h: 120 } }, headlines(1000)),
      el('aside', { box: { x: 16, y: 3100, w: 380, h: 300 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('an aside that holds an ad is the ad\'s slot, not the end of the article', () => {
  // Sport and Levante-EMV put their ads in <aside>; Chrome tags the ad inside.
  const ad = el('iframe', { box: { x: 46, y: 3060, w: 300, h: 250 } });
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300, 2900),
      el('aside', { box: { x: 16, y: 3050, w: 380, h: 270 } }, [ad]),
      el('div', { id: 'taboola-below', box: { x: 0, y: 3400, w: 412, h: 2000 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0, ad).articleEnd, 3400);
  assert.equal(page.run(contentBounds, 0).articleEnd, 3050); // without knowing the ad
});

test('a strip of tags in an aside does not end the article above the ad slot that follows it', () => {
  // Estadio Deportivo: <aside class="tags"> (28 px), then the end-of-article ad in an <aside>.
  const ad = el('iframe', { box: { x: 46, y: 3060, w: 300, h: 250 } });
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300, 2900),
      el('aside', { box: { x: 16, y: 3010, w: 380, h: 28 } }),
      el('aside', { box: { x: 16, y: 3050, w: 380, h: 270 } }, [ad]),
      el('div', { id: 'taboola-below', box: { x: 0, y: 3400, w: 412, h: 2000 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0, ad).articleEnd, 3400);
});

test('scrolled, an ad held by a sticky wrapper still marks its aside as its slot', () => {
  // The runner measures the end again in later samples: the ad and the aside must be in the same
  // page coordinates though the wrapper is sticky.
  const ad = el('iframe', { box: { x: 46, y: 3060, w: 300, h: 250 } });
  const page = stubPage({
    ...MOBILE,
    scrollY: 2650,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      ...paragraphs(300, 2900),
      el('aside', { box: { x: 16, y: 3050, w: 380, h: 270 } }, [el('div', { position: 'sticky', box: { x: 16, y: 3055, w: 380, h: 260 } }, [ad])]),
      el('div', { id: 'taboola-below', box: { x: 0, y: 3400, w: 412, h: 2000 } }),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0, ad).articleEnd, 3400);
});

test('the article text is the container with most of its paragraphs: a long list inside does not pick it', () => {
  // Heraldo: a list of 600 towns, then a related box, then the last paragraph.
  const town = 'Abanto. 20 de enero y 3 de agosto. San Sebastián y Virgen de los Santos, fiestas locales de 2026.';
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(), el('article', { box: { x: 0, y: 100, w: 412, h: 6000 } }, [
      el('div', { box: { x: 16, y: 300, w: 380, h: 2700 } }, [
        ...paragraphs(300, 500),
        el('ul', { box: { x: 16, y: 700, w: 380, h: 2000 } }, [...Array(20)].map((_, i) => el('li', { text: town, box: { x: 16, y: 700 + i * 100, w: 380, h: 100 } }))),
        el('div', { box: { x: 16, y: 2720, w: 380, h: 120 } }, headlines(2720)),
        ...paragraphs(2900),
      ]),
      el('div', { box: { x: 16, y: 3200, w: 380, h: 300 } }, headlines(3200, 3)),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3200);
});

test('an article page without an <article> element ends after its text container', () => {
  // Europa Press: no <article>; the site's footer text sits in plain <div>s.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(),
      el('h1', { text: 'Sánchez decidirá el fin de semana', box: { x: 16, y: 100, w: 380, h: 100 } }),
      el('div', { box: { x: 0, y: 300, w: 412, h: 2700 } }, paragraphs(300, 500, 700, 2900)),
      el('div', { box: { x: 16, y: 3100, w: 380, h: 120 } }, headlines(3100)),
      el('div', { box: { x: 0, y: 3500, w: 412, h: 300 } }, paragraphs(3500)),
    ]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('ads below the <article> and above the first block that is not main content stay in it', () => {
  // People: a billboard between the end of the <article> and the comments.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(),
      el('article', { box: { x: 0, y: 100, w: 412, h: 2900 } }, paragraphs(300, 500, 2800)),
      el('iframe', { box: { x: 46, y: 3050, w: 300, h: 250 } }),
      el('div', { className: 'comments', box: { x: 0, y: 3400, w: 412, h: 500 } }),
    ]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3400);
});

test('a comment button is not the comments: it does not end the article above an ad', () => {
  // People: "click to comment" (48 px) right below the text, then a billboard, then the comments.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), header(),
      el('article', { box: { x: 0, y: 100, w: 412, h: 2900 } }, [...paragraphs(300, 500, 2800), el('div', { id: 'click-to-comment', box: { x: 16, y: 2920, w: 380, h: 48 } })]),
      el('iframe', { box: { x: 46, y: 3050, w: 300, h: 250 } }),
      el('div', { className: 'comments', box: { x: 0, y: 3400, w: 412, h: 500 } }),
    ]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3400);
});

test('the next story\'s headline caps the article when nothing else ends it (infinite scroll)', () => {
  const page = stubPage({
    ...MOBILE,
    pageHeight: 9000,
    body: el('body', {}, [articleMeta(), header(),
      el('h1', { text: 'Primera noticia', box: { x: 16, y: 100, w: 380, h: 100 } }),
      el('div', { box: { x: 0, y: 300, w: 412, h: 2700 } }, paragraphs(300, 500, 2900)),
      el('h1', { text: 'Segunda noticia', box: { x: 16, y: 3200, w: 380, h: 100 } }),
      el('div', { box: { x: 0, y: 3400, w: 412, h: 700 } }, paragraphs(3400, 3600)),
    ]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3200);
});

test('an h1 within the article\'s text (a subheading, a one-pixel heading for screen readers) does not cap it', () => {
  // La Tercera: headings for screen readers among the paragraphs; Observador: h1 subheadings.
  const page = stubPage({
    ...MOBILE,
    pageHeight: 9000,
    body: el('body', {}, [articleMeta(), header(),
      el('h1', { text: 'La noticia', box: { x: 16, y: 100, w: 380, h: 100 } }),
      el('div', { box: { x: 0, y: 300, w: 412, h: 2700 } }, [
        ...paragraphs(300, 500),
        el('h1', { text: 'Un apartado', box: { x: 16, y: 1200, w: 380, h: 60 } }),
        el('h1', { text: 'Para lectores de pantalla', box: { x: 16, y: 1500, w: 1, h: 1 } }),
        ...paragraphs(1300, 1600, 2900),
      ]),
      el('div', { box: { x: 16, y: 3100, w: 380, h: 120 } }, headlines(3100)),
    ]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 3100);
});

test('laSexta: "Más Noticias" and the Taboola feed sit in asides inside the <article>', () => {
  const DESKTOP = { width: 1350, height: 940 };
  const page = stubPage({
    ...DESKTOP,
    pageHeight: 7000,
    body: el('body', {}, [articleMeta(), el('header', { box: { x: 0, y: 0, w: 1350, h: 85 } }), el('article', { box: { x: 250, y: 435, w: 852, h: 5100 } }, [
      el('div', { box: { x: 250, y: 600, w: 633, h: 2200 } }, paragraphs(600, 800, 2700).map((p) => Object.assign(p, { box: { ...p.box, x: 250, w: 633 } }))),
      el('aside', { box: { x: 250, y: 2884, w: 633, h: 400 } }, [el('h2', { text: 'Más Noticias', box: { x: 250, y: 2884, w: 633, h: 32 } }), ...headlines(2930, 4)]),
      el('aside', { box: { x: 940, y: 435, w: 300, h: 600 } }), // the side rail
      el('aside', { box: { x: 250, y: 4038, w: 552, h: 1497 } }, [el('div', { id: 'taboola-feed', box: { x: 250, y: 4038, w: 552, h: 1497 } })]),
    ])]),
  });
  assert.equal(page.run(contentBounds, 0).articleEnd, 2884);
});

test('live blogs keep all their posts', () => {
  const meta = el('meta', { attrs: { property: 'og:type', content: 'article' } });
  const ld = el('script', { attrs: { type: 'application/ld+json' }, text: '{"@type": "LiveBlogPosting"}' });
  const post = el('article', { box: { x: 0, y: 100, w: 412, h: 1500 } });
  const page = stubPage({ ...MOBILE, pageHeight: 9000, body: el('body', {}, [meta, ld, header(), post]) });
  assert.equal(page.run(contentBounds, 0).articleEnd, null);
});

test('an article with display: contents (no box of its own) is measured by what it holds', () => {
  // El País and 20minutos: the <article> lays out its children as if it weren't there.
  const meta = el('meta', { attrs: { property: 'og:type', content: 'article' } });
  const story = el('article', { display: 'contents' }, [
    el('h1', { box: { x: 16, y: 100, w: 380, h: 120 } }),
    el('div', { display: 'contents' }, [el('p', { box: { x: 16, y: 240, w: 380, h: 2500 } })]),
    el('span'), // nothing to lay out
  ]);
  const page = stubPage({ ...MOBILE, pageHeight: 6000, body: el('body', {}, [meta, header(), story]) });
  assert.equal(page.run(contentBounds, 0).articleEnd, 2740);
});

test('JSON-LD articles count only when the page has no og:type (homepages list articles)', () => {
  const ld = el('script', { attrs: { type: 'application/ld+json' }, text: '{"@type": "ItemList", "itemListElement": [{"@type": "NewsArticle"}]}' });
  const og = el('meta', { attrs: { property: 'og:type', content: 'website' } });
  const story = el('article', { box: { x: 0, y: 100, w: 412, h: 2000 } });
  const homepage = stubPage({ ...MOBILE, pageHeight: 9000, body: el('body', {}, [og, ld, header(), story]) });
  assert.equal(homepage.run(contentBounds, 0).articleEnd, null);
  const bare = stubPage({ ...MOBILE, pageHeight: 9000, body: el('body', {}, [ld, header(), story]) });
  assert.equal(bare.run(contentBounds, 0).articleEnd, 2100);
});

test('hideFixedBars hides the fixed bars and boxes that are not ads, but not an ad, a bar holding an ad, a sticky side rail or a full-screen wrapper, and showHidden undoes it', () => {
  const ad = el('div', { box: { x: 0, y: 763, w: 412, h: 60 } });
  const header = el('header', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 60 } });
  const subscribe = el('div', { position: 'fixed', box: { x: 0, y: 623, w: 412, h: 200 } }); // a subscription bar at the bottom
  const anchor = el('div', { position: 'fixed', box: { x: 0, y: 763, w: 412, h: 60 } }, [ad]);
  const rail = el('aside', { position: 'sticky', box: { x: 300, y: 1000, w: 112, h: 200 } });
  const promo = el('div', { position: 'fixed', box: { x: 50, y: 300, w: 300, h: 200 } }); // a subscription box mid-screen
  const wrapper = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }); // a page living in a fixed wrapper
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [header, subscribe, anchor, rail, promo, wrapper]) });
  assert.equal(page.run(hideFixedBars, ad), 1); // the first screenshot that has them shows them, but a bar at the bottom
  assert.equal(page.run(hideFixedBars, ad), 2);
  assert.deepEqual([header, subscribe, anchor, rail, promo, wrapper].map((n) => n.style.opacity), ['0', '0', '', '', '0', '']);
  page.run(showHidden);
  assert.deepEqual([header, subscribe].map((n) => n.style.opacity), ['', '']);
  assert.equal(header.getAttribute('data-adc-hidden'), null);
});

test('hideFixedBars shows a fixed bar or box in the first screenshot that has it, even one that appears late, and hides it from the later ones', () => {
  const header = el('header', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 60 } });
  const player = el('div', { position: 'fixed' }); // a floating video player, not there yet
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [header, player]) });
  assert.equal(page.run(hideFixedBars), 0);
  player.box = { x: 212, y: 600, w: 200, h: 113 }; // it shows up mid-test
  assert.equal(page.run(hideFixedBars), 1);
  assert.deepEqual([header, player].map((n) => n.style.opacity), ['0', '']);
  page.run(showHidden);
  assert.equal(page.run(hideFixedBars), 2);
  assert.deepEqual([header, player].map((n) => n.style.opacity), ['0', '0']);
});

test('hideFixedBars hides a bar at the bottom of the screen from the first screenshot too: stitched, it would sit mid-page', () => {
  // Prensa Ibérica's "Leer · Cerca · Jugar" bar, 47 px at the bottom; the header at the top still shows once.
  const header = el('header', { position: 'fixed', box: { x: 0, y: 0, w: 1350, h: 60 } });
  const bottomBar = el('nav', { position: 'fixed', box: { x: 0, y: 893, w: 1350, h: 47 } });
  const page = stubPage({ width: 1350, height: 940, scrollY: 0, pageHeight: 8000, body: el('body', {}, [header, bottomBar]) });
  assert.equal(page.run(hideFixedBars), 1);
  assert.deepEqual([header, bottomBar].map((n) => n.style.opacity), ['', '0']);
});

test('hideFixedBars leaves a sticky block that is only passing an edge of the screen, and hides one stuck there', () => {
  // Section bars sticky at top: 0. One is still in the flow at 1700 px, running past the bottom of the
  // screen; the other is stuck at the top. A footer bar is stuck at the bottom (bottom: 0).
  const passing = el('div', { position: 'sticky', top: '0px', box: { x: 0, y: 1700, w: 412, h: 300 } });
  const stuck = el('nav', { position: 'sticky', top: '0px', box: { x: 0, y: 1000, w: 412, h: 50 } });
  const footer = el('div', { position: 'sticky', bottom: '0px', box: { x: 0, y: 1773, w: 412, h: 50 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [passing, stuck, footer]) });
  assert.equal(page.run(hideFixedBars), 1); // the footer, at the bottom, from the first screenshot on
  assert.equal(page.run(hideFixedBars), 1);
  assert.deepEqual([passing, stuck, footer].map((n) => n.style.opacity), ['', '0', '0']);
});

test('hideFixedBars judges a fixed layer by its part on screen: a drawer taller than the screen, mostly below it, is a bar', () => {
  // A recommendations drawer 823 px tall, moved down so only its top 257 px show.
  const drawer = el('div', { position: 'fixed', box: { x: 0, y: 566, w: 412, h: 823 } });
  const wrapper = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }); // the size of the screen: left alone
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [drawer, wrapper]) });
  assert.equal(page.run(hideFixedBars), 1); // at the bottom: hidden from the first screenshot on
  assert.deepEqual([drawer, wrapper].map((n) => n.style.opacity), ['0', '']);
});

test('hideFixedBars hides a sticky header from later screenshots even when the first one showed it in the flow, not stuck yet', () => {
  // Below a 32 px bar at the top of the page; stuck to the top of the screen once the page scrolls.
  const header = el('header', { position: 'sticky', top: '0px', box: { x: 0, y: 32, w: 412, h: 40 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [header]) });
  assert.equal(page.run(hideFixedBars), 0);
  page.window.scrollY = 823;
  header.box = { x: 0, y: 823, w: 412, h: 40 };
  assert.equal(page.run(hideFixedBars), 1);
  assert.equal(header.style.opacity, '0');
});

test('hideFixedBars leaves alone what is already hidden, so a missed showHidden cannot keep it hidden', () => {
  const header = el('header', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 60 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [header]) });
  page.run(hideFixedBars);
  page.run(hideFixedBars);
  page.run(hideFixedBars); // the last screenshot didn't show it again
  page.run(showHidden);
  assert.equal(header.style.opacity, '');
});

test('markArticleEnd marks the last paragraph above the article\'s end, and articleEndNow finds the end again after the article grew', () => {
  const text = 'x'.repeat(60);
  const intro = el('p', { text, box: { x: 16, y: 300, w: 380, h: 80 } });
  const last = el('p', { text, box: { x: 16, y: 1800, w: 380, h: 100 } }); // bottom at 1900
  const aside = el('p', { text, box: { x: 300, y: 1850, w: 100, h: 60 } }); // a narrow side note, lower: not the article's
  const share = el('p', { text: 'Share', box: { x: 16, y: 1950, w: 380, h: 20 } }); // too little text
  const comment = el('p', { text, box: { x: 16, y: 2100, w: 380, h: 80 } }); // below the end
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [intro, last, aside, share, comment]) });
  assert.equal(page.run(markArticleEnd, 2000), 100); // the end is 100 px below the last paragraph
  assert.equal(page.run(articleEndNow, 100), 2000);
  last.box = { x: 16, y: 2100, w: 380, h: 100 }; // images above it loaded: 300 px longer
  page.window.scrollY = 1500;
  assert.equal(page.run(articleEndNow, 100), 2300);
  delete last.attrs['data-adc-article-end']; // the page replaced it
  assert.equal(page.run(articleEndNow, 100), null);
});

test('the article\'s end follows the block that ends it, also when an ad loads above that block', () => {
  // People: the end measured at the top is the related block; a billboard then loads between the
  // last paragraph and it.
  const text = 'x'.repeat(60);
  const last = el('p', { text, box: { x: 16, y: 1800, w: 380, h: 100 } }); // bottom at 1900
  const related = el('aside', { box: { x: 16, y: 2000, w: 380, h: 400 } }, [el('h2', { text: 'Related', box: { x: 16, y: 2000, w: 380, h: 30 } })]);
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [last, related]) });
  assert.equal(page.run(markArticleEnd, 2000), 100);
  related.box = { x: 16, y: 2250, w: 380, h: 400 }; // a 250 px ad loaded above it
  related.children[0].box = { x: 16, y: 2250, w: 380, h: 30 };
  page.window.scrollY = 1500;
  assert.equal(page.run(articleEndNow, 100), 2250);
  delete related.attrs['data-adc-article-end-block']; // the page replaced it: back to the last paragraph
  assert.equal(page.run(articleEndNow, 100), 2000);
});

test('a block that ended the article but an ad fills since was the ad\'s slot: the end measured now holds', () => {
  // A lazily loaded slot in an aside, its height reserved: empty at the top, an ad later.
  const text = 'x'.repeat(60);
  const last = el('p', { text, box: { x: 16, y: 2800, w: 380, h: 100 } }); // bottom at 2900
  const slot = el('aside', { box: { x: 16, y: 3050, w: 380, h: 270 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 7000, body: el('body', {}, [last, slot]) });
  const gap = page.run(markArticleEnd, 3050);
  const ad = el('iframe', { box: { x: 46, y: 3060, w: 300, h: 250 } });
  slot.children.push(ad);
  ad.parentElement = slot;
  const loaded = stubPage({ width: 412, height: 823, scrollY: 2650, pageHeight: 7000, body: el('body', {}, [last, slot]) });
  assert.equal(loaded.run(articleEndNow, gap, 3400, ad), 3400);
  assert.equal(loaded.run(articleEndNow, gap, 3400), 3050); // without the ads, the block holds
});

test('with the text in plain blocks rather than paragraphs, the end still follows the block that ends it', () => {
  const textBlock = el('div', { text: 'y'.repeat(120), box: { x: 16, y: 1800, w: 380, h: 100 } });
  const related = el('aside', { box: { x: 16, y: 2000, w: 380, h: 400 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [textBlock, related]) });
  const gap = page.run(markArticleEnd, 2000);
  assert.equal(gap, 0); // no paragraph to measure from, but a block to follow
  related.box = { x: 16, y: 2250, w: 380, h: 400 };
  assert.equal(page.run(articleEndNow, gap), 2250);
});

test('the article\'s end moves up to a block that loaded between its text and the block it followed', () => {
  // 20minutos: Marfeel's "Y además" ended the article at the top; 11,000 px of recommendations then
  // loaded above it. Measured again by then, the article ends at the first of them.
  const text = 'x'.repeat(60);
  const last = el('p', { text, box: { x: 16, y: 1800, w: 380, h: 100 } }); // bottom at 1900
  const more = el('section', { box: { x: 16, y: 2000, w: 380, h: 400 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 15000, body: el('body', {}, [last, more]) });
  assert.equal(page.run(markArticleEnd, 2000), 100);
  more.box = { x: 16, y: 13000, w: 380, h: 400 };
  page.window.scrollY = 1500;
  assert.equal(page.run(articleEndNow, 100, 2050), 2050); // the end measured now
  assert.equal(page.run(articleEndNow, 100, 1500), 13000); // above the article's text: not its end
  assert.equal(page.run(articleEndNow, 100, null), 13000);
});

test('hideFixedBars leaves a fixed box inside a transformed element: it scrolls with the page, so it is content', () => {
  const card = el('div', { position: 'fixed', box: { x: 50, y: 300, w: 300, h: 200 } });
  const carousel = el('div', { transform: 'matrix(1, 0, 0, 1, 0, 0)', box: { x: 0, y: 0, w: 412, h: 5000 } }, [card]);
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [carousel]) });
  page.run(hideFixedBars);
  assert.equal(page.run(hideFixedBars), 0);
  assert.equal(card.style.opacity, '');
});

test('hideFixedBars never shows a bar at the top that first appears after the first screenshot (a compact header)', () => {
  const header = el('header', { box: { x: 0, y: 98, w: 412, h: 56 } }); // in the page, below an ad
  const compact = el('div', { position: 'fixed' }); // shown once the page scrolls
  const footer = el('div', { position: 'fixed' }); // a bar at the bottom that also appears later
  const page = stubPage({ width: 412, height: 823, scrollY: 0, pageHeight: 5000, body: el('body', {}, [header, compact, footer]) });
  assert.equal(page.run(hideFixedBars), 0); // the first screenshot
  page.window.scrollY = 823;
  compact.box = { x: 0, y: 0, w: 412, h: 56 };
  footer.box = { x: 0, y: 763, w: 412, h: 60 };
  assert.equal(page.run(hideFixedBars), 2);
  assert.deepEqual([compact, footer].map((n) => n.style.opacity), ['0', '0']); // a bar at the bottom never shows
});

test('hiding a bar also hides its children that set visibility: visible themselves (CNN\'s nav links), and showHidden restores it', () => {
  const link = el('a', { visibility: 'visible', box: { x: 10, y: 10, w: 100, h: 30 } });
  const nav = el('nav', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 50 } }, [link]);
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [nav]) });
  page.run(hideFixedBars);
  assert.equal(page.run(hideFixedBars), 1);
  // visibility is inherited and a child can override it; opacity can't be overridden from inside.
  assert.equal(nav.style.opacity, '0');
  page.run(showHidden);
  assert.equal(nav.style.opacity, '');
});

test('adItems says which ads sit in a layer fixed to the screen', () => {
  const anchor = el('div', { box: { x: 0, y: 763, w: 412, h: 60 } });
  const inline = el('div', { box: { x: 0, y: 1200, w: 412, h: 250 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [el('div', { position: 'fixed', box: { x: 0, y: 763, w: 412, h: 60 } }, [anchor]), inline]) });
  assert.deepEqual(page.run(adItems, anchor, inline).map((item) => item.fixed), [true, false]);
});

test('adItems says when an ad\'s fixed layer is drawn on screen, whatever its pieces show (a floating player during an ad)', () => {
  // The US Sun desktop: while the floating Brightcove player plays an ad, Google IMA's pieces in it are hidden by
  // CSS; the player itself is on screen.
  const piece = el('iframe', { visibility: 'hidden', box: { x: 776, y: 666, w: 367, h: 208 } });
  const player = el('div', { id: 'video_1', position: 'fixed', box: { x: 772, y: 662, w: 375, h: 262 } }, [piece]);
  const below = el('iframe', { box: { x: 772, y: 1000, w: 375, h: 262 } });
  const offScreen = el('div', { position: 'fixed', box: { x: 772, y: 1000, w: 375, h: 262 } }, [below]);
  const faded = el('iframe', { box: { x: 0, y: 880, w: 1350, h: 60 } });
  const fadedLayer = el('div', { position: 'fixed', box: { x: 0, y: 880, w: 1350, h: 60 } }, [faded]);
  fadedLayer.style.opacity = '0';
  const inline = el('div', { box: { x: 100, y: 2300, w: 300, h: 250 } });
  const page = stubPage({ width: 1350, height: 940, scrollY: 2000, pageHeight: 8000, body: el('body', {}, [player, offScreen, fadedLayer, inline]) });
  assert.deepEqual(page.run(adItems, piece, below, faded, inline).map((item) => item?.layerOnScreen), [true, false, false, false]);
});

test('adItems says which ads a sticky box holds on screen, never the page\'s own content', () => {
  // CBS desktop: the right rail's ad sits in div#mpu-plus-top-right-rail, position: sticky; top: 440px.
  const rail = el('iframe', { box: { x: 963, y: 440, w: 300, h: 600 } });
  const inline = el('div', { box: { x: 100, y: 300, w: 300, h: 250 } });
  const inArticle = el('div', { box: { x: 100, y: 700, w: 300, h: 250 } });
  const article = el('article', { position: 'sticky', box: { x: 80, y: 0, w: 640, h: 5000 } }, [inArticle]);
  const page = stubPage({ width: 1350, height: 940, scrollY: 1200, pageHeight: 5000, body: el('body', {}, [
    el('div', { position: 'sticky', box: { x: 963, y: 440, w: 300, h: 600 } }, [rail]), inline, article,
  ]) });
  assert.deepEqual(page.run(adItems, rail, inline, inArticle).map((item) => [item.fixed, item.stuck]), [[false, true], [false, false], [false, false]]);
});

test('hideFixedAds hides the sticky box that holds a rail ad on screen (CBS desktop), not the page\'s content', () => {
  const ad = el('iframe', { box: { x: 963, y: 440, w: 300, h: 600 } });
  const box = el('div', { position: 'sticky', box: { x: 963, y: 440, w: 300, h: 600 } }, [ad]);
  const rail = el('div', { box: { x: 940, y: -1200, w: 340, h: 5000 } }, [box]);
  const inArticle = el('div', { box: { x: 100, y: 700, w: 300, h: 250 } });
  const article = el('article', { position: 'sticky', box: { x: 80, y: 0, w: 640, h: 5000 } }, [inArticle]);
  const page = stubPage({ width: 1350, height: 940, scrollY: 1200, pageHeight: 5000, body: el('body', {}, [rail, article]) });
  assert.equal(page.run(hideFixedAds, ad, inArticle), 1);
  assert.deepEqual([rail, box, ad, article].map((n) => n.style.opacity), ['', '0', '', '']);
  page.run(showHidden);
  assert.equal(box.style.opacity, '');
});

test('hideFixedAds hides an ad gate\'s blurring layer as it would a fixed one (Vozpópuli: a sticky panel in a tall absolute wall)', () => {
  const ad = el('iframe', { box: { x: 244, y: 2300, w: 430, h: 127 } });
  const modal = el('div', { position: 'sticky', box: { x: 244, y: 2250, w: 500, h: 380 } }, [ad]);
  const blur = el('div', { position: 'sticky', backdropFilter: 'blur(6px)', box: { x: 84, y: 2000, w: 820, h: 940 } }, [modal]);
  const wall = el('div', { position: 'absolute', box: { x: 84, y: 1448, w: 820, h: 5679 } }, [blur]);
  const page = stubPage({ width: 1350, height: 940, scrollY: 2000, pageHeight: 8000, body: el('body', {}, [wall]) });
  assert.equal(page.run(hideFixedAds, ad), 1);
  assert.deepEqual([wall, blur, modal].map((n) => n.style.opacity), ['', '0', '']);
  page.run(showHidden);
  assert.equal(blur.style.opacity, '');
});

test('hideFixedAds hides the fixed layer holding each given ad, and showHidden brings it back', () => {
  const creative = el('div', { box: { x: 0, y: 763, w: 412, h: 60 } });
  const layer = el('div', { position: 'fixed', box: { x: 0, y: 763, w: 412, h: 60 } }, [creative]);
  const inline = el('div', { box: { x: 0, y: 1200, w: 412, h: 250 } });
  const page = stubPage({ width: 412, height: 823, scrollY: 1000, pageHeight: 5000, body: el('body', {}, [layer, inline]) });
  assert.equal(page.run(hideFixedAds, creative, inline), 1);
  assert.deepEqual([layer.style.opacity, creative.style.opacity, inline.style.opacity], ['0', '', '']);
  page.run(showHidden);
  assert.equal(layer.style.opacity, '');
});

test('hidden for a screenshot, a layer fades at once: no transition and an important opacity (an animation can\'t undo it); showHidden gives both back', () => {
  // Sport's bwin pop-up came out as a ghost over the article in the next screenshot: its layer fades with a
  // CSS transition, so opacity 0 was caught half way.
  const ad = el('iframe', { box: { x: 0, y: 0, w: 412, h: 823 } });
  const modal = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [ad]);
  modal.style.setProperty('transition', 'opacity .3s');
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [modal]) });
  assert.equal(page.run(hideFixedAds, ad), 1);
  assert.deepEqual([modal.style.opacity, modal.style.getPropertyPriority('opacity')], ['0', 'important']);
  assert.deepEqual([modal.style.transition, modal.style.getPropertyPriority('transition')], ['none', 'important']);
  page.run(showHidden);
  assert.deepEqual([modal.style.opacity, modal.style.getPropertyPriority('opacity')], ['', '']);
  assert.deepEqual([modal.style.transition, modal.style.getPropertyPriority('transition')], ['opacity .3s', '']);
  // The site's bars too.
  const bar = el('header', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 60 } }, [el('p', { text: 'Menu', box: { x: 0, y: 0, w: 412, h: 60 } })]);
  bar.style.setProperty('transition', 'opacity 1s');
  const site = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [bar]) });
  site.run(hideFixedBars);
  assert.equal(site.run(hideFixedBars), 1);
  assert.deepEqual([bar.style.opacity, bar.style.getPropertyPriority('opacity'), bar.style.transition], ['0', 'important', 'none']);
  site.run(showHidden);
  assert.deepEqual([bar.style.opacity, bar.style.transition], ['', 'opacity 1s']);
});

test('dismissOverlay hides, for good, the outermost fixed layer that holds the ad, and marks it', () => {
  const creative = el('iframe', { box: { x: 0, y: 0, w: 412, h: 823 } });
  const inner = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [creative]);
  const backdrop = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [el('div', {}, [inner])]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [backdrop]) });
  assert.equal(page.run(dismissOverlay, creative), true);
  assert.equal(backdrop.style.display, 'none');
  assert.equal(backdrop.style.getPropertyPriority('display'), 'important');
  assert.ok('data-adc-dismissed' in backdrop.attrs);
  assert.deepEqual([inner.style.display, creative.style.display], ['block', 'block']);
  page.run(showHidden); // the screenshots' restore leaves it closed
  assert.equal(backdrop.style.display, 'none');
});

test('adItems: an ad in a fixed layer is in an overlay; one in a fixed wrapper that holds the article (an app shell) is not', () => {
  const pop = el('iframe', { box: { x: 0, y: 0, w: 412, h: 823 } });
  const layer = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [pop])]) });
  assert.deepEqual(['fixed', 'overlay'].map((k) => layer.run(adItems, pop)[0][k]), [true, true]);

  const big = el('iframe', { box: { x: 0, y: 900, w: 412, h: 700 } });
  const shell = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [el('article', { box: { x: 0, y: 0, w: 412, h: 800 } }), big]);
  const app = stubPage({ ...MOBILE, scrollY: 800, pageHeight: 3000, body: el('body', {}, [shell]) });
  assert.deepEqual(['fixed', 'overlay'].map((k) => app.run(adItems, big)[0][k]), [true, false]);
  assert.equal(app.run(dismissOverlay, big), false);
  assert.equal(shell.style.display, 'block');
  assert.ok(!('data-adc-dismissed' in shell.attrs));

  const inline = el('iframe', { box: { x: 0, y: 100, w: 412, h: 700 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [inline]) });
  assert.equal(page.run(adItems, inline)[0].overlay, false);
});

test('dismissOverlay hides an ad gate\'s blurring layer when no fixed layer holds the ad, as a reader past the ad would see', () => {
  const ad = el('iframe', { box: { x: 30, y: 2500, w: 300, h: 75 } });
  const card = el('div', { position: 'sticky', box: { x: 20, y: 2400, w: 320, h: 340 } }, [ad]);
  const gate = el('div', { position: 'absolute', backdropFilter: 'blur(3px)', box: { x: 20, y: 2063, w: 320, h: 7618 } }, [card]);
  const article = el('article', { box: { x: 0, y: 0, w: 412, h: 10000 } }, [gate]);
  const page = stubPage({ ...MOBILE, scrollY: 2187, pageHeight: 10000, body: el('body', {}, [article]) });
  assert.equal(page.run(dismissOverlay, ad), true);
  assert.equal(gate.style.display, 'none');
  assert.equal(article.style.display, 'block');
});

test('a pop-up fixed inside a fixed app shell is an overlay: dismissOverlay hides the pop-up\'s layer, never the shell', () => {
  const pop = el('iframe', { box: { x: 0, y: 0, w: 412, h: 823 } });
  const layer = el('div', { position: 'fixed', z: 10, box: { x: 0, y: 0, w: 412, h: 823 } }, [pop]);
  const shell = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [el('main', { box: { x: 0, y: 0, w: 412, h: 800 } }), layer]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [shell]) });
  assert.equal(page.run(adItems, pop)[0].overlay, true);
  assert.equal(page.run(dismissOverlay, pop), true);
  assert.deepEqual([layer.style.display, shell.style.display], ['none', 'block']);
});

test('adItems: a pop-up in an overlay over the article lies over the content', () => {
  const pop = el('iframe', { box: { x: 0, y: 0, w: 412, h: 823 } });
  const article = el('article', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [el('p', { box: { x: 16, y: 100, w: 380, h: 700 }, text: 'The story goes on under the pop-up.' })]);
  const layer = el('div', { position: 'fixed', z: 10, box: { x: 0, y: 0, w: 412, h: 823 } }, [pop]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [article, layer]) });
  assert.deepEqual(['overlay', 'shown', 'overContent'].map((k) => page.run(adItems, pop)[0][k]), [true, true, true]);
});

test('adItems: an interscroller (a fixed creative behind a hole in the article) has only its own slot and the article under it: not over the content', () => {
  // Scrolled so the in-flow slot is across the screen's centre; the creative is fixed full screen inside it.
  const creative = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 }, backgroundImage: 'url(ad.jpg)' });
  const slot = el('div', { box: { x: 0, y: 1200, w: 412, h: 800 } }, [creative]);
  const article = el('article', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [
    el('p', { box: { x: 16, y: 100, w: 380, h: 900 }, text: 'Text above the hole.' }), slot, el('p', { box: { x: 16, y: 2100, w: 380, h: 800 }, text: 'Text below the hole.' }),
  ]);
  const page = stubPage({ ...MOBILE, scrollY: 1000, pageHeight: 3000, body: el('body', {}, [article]) });
  assert.deepEqual(['overlay', 'shown', 'overContent'].map((k) => page.run(adItems, creative)[0][k]), [true, true, false]);
});

test('adItems: bottomHit — the hit test at the bottom centre of the screen (half its width, 90 % of its height) lands on the ad', () => {
  // An interscroller: while its hole is at the bottom centre the creative is hit there; once the text
  // below the hole covers that point, it isn't.
  const page = (scrollY) => {
    const creative = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 }, backgroundImage: 'url(ad.jpg)' });
    const article = el('article', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [
      el('p', { box: { x: 0, y: 100, w: 412, h: 1100 }, text: 'Text above the hole.' }),
      el('div', { box: { x: 0, y: 1200, w: 412, h: 800 } }, [creative]),
      el('p', { box: { x: 0, y: 2000, w: 412, h: 1000 }, text: 'Text below the hole.' }),
    ]);
    return { creative, page: stubPage({ ...MOBILE, scrollY, pageHeight: 3000, body: el('body', {}, [article]) }) };
  };
  const passing = page(1000); // bottom centre at 1740 px of the page: in the hole
  assert.equal(passing.page.run(adItems, passing.creative)[0].bottomHit, true);
  const gone = page(1500); // bottom centre at 2240 px: on the text below the hole
  assert.equal(gone.page.run(adItems, gone.creative)[0].bottomHit, false);
});

test('adItems: behindPage — the page\'s own content covers a fixed ad (an interscroller outside its gap in the article)', () => {
  const page = (scrollY, extra = []) => {
    const creative = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 }, backgroundImage: 'url(ad.jpg)' });
    const article = el('article', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [
      el('p', { box: { x: 0, y: 100, w: 412, h: 1100 }, text: 'Text above the gap.' }),
      el('div', { box: { x: 0, y: 1200, w: 412, h: 800 } }, [creative]),
      el('p', { box: { x: 0, y: 2000, w: 412, h: 1000 }, text: 'Text below the gap.' }),
    ]);
    return { creative, page: stubPage({ ...MOBILE, scrollY, pageHeight: 3000, body: el('body', {}, [article, ...extra]) }) };
  };
  const partly = page(1500); // the text below the gap covers the lower part of the screen
  assert.equal(partly.page.run(adItems, partly.creative)[0].behindPage, true);
  const inGap = page(1200); // the gap fills the screen down to 800 px: the ad is on top at all its points
  assert.equal(inGap.page.run(adItems, inGap.creative)[0].behindPage, false);
  // Covered by a fixed cookie banner, not by the page's content.
  const banner = el('div', { position: 'fixed', z: 10, box: { x: 0, y: 400, w: 412, h: 423 }, text: 'We value your privacy' });
  const dialog = page(1200, [banner]);
  assert.equal(dialog.page.run(adItems, dialog.creative)[0].behindPage, false);
});

test('adItems: wallpaper — a fixed ad behind the page\'s content at its centre, seen at the side of the screen', () => {
  const desktop = { width: 1350, height: 940 };
  // Vocento's wemass skin: a fixed frame over the whole screen, behind a centred content column.
  const frame = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 1350, h: 1000 }, backgroundImage: 'url(skin.jpg)' });
  const column = el('main', { z: 1, box: { x: 77, y: 300, w: 1196, h: 5000 } }, [el('p', { box: { x: 77, y: 300, w: 1196, h: 5000 }, text: 'The article.' })]);
  const page = stubPage({ ...desktop, scrollY: 1000, pageHeight: 6000, body: el('body', {}, [frame, column]) });
  assert.equal(page.run(adItems, frame)[0].wallpaper, true);
  // wemass lays a transparent layer of its own (div.wms-cc) over the skin: still a wallpaper, as no page
  // content lies over the skin at the side.
  const skin = el('canvas', { box: { x: 0, y: 0, w: 1350, h: 1000 } });
  const root = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 1350, h: 1000 } }, [
    el('div', { className: 'wms-centerContents', box: { x: 0, y: 0, w: 1350, h: 1000 } }, [skin]),
    el('div', { className: 'wms-cc', box: { x: 0, y: 0, w: 1350, h: 1000 } }),
  ]);
  const layered = stubPage({ ...desktop, scrollY: 1000, pageHeight: 6000, body: el('body', {}, [root, column]) });
  const ad = root.children[0];
  assert.equal(layered.run(adItems, ad)[0].wallpaper, true);
  // Page content over the sides (a full-width wrapper of the page with a background) hides it there: no
  // wallpaper. Without a background it is see-through (the wemass test below).
  const wrapper = el('div', { z: 1, backgroundColor: 'rgb(255, 255, 255)', box: { x: 0, y: 0, w: 1350, h: 6000 } }, [column]);
  const wrapped = stubPage({ ...desktop, scrollY: 1000, pageHeight: 6000, body: el('body', {}, [frame, wrapper]) });
  assert.equal(wrapped.run(adItems, frame)[0].wallpaper, false);
  // A full-width anchor on top of the page is no wallpaper (nothing covers its centre).
  const anchor = el('iframe', { position: 'fixed', box: { x: 0, y: 840, w: 1350, h: 100 } });
  const withAnchor = stubPage({ ...desktop, scrollY: 1000, pageHeight: 6000, body: el('body', {}, [column, anchor]) });
  assert.equal(withAnchor.run(adItems, anchor)[0].wallpaper, false);
});

test('adItems: wallpaper — wemass\'s skin: sticky, under an empty transparent layer that scrolls with the page', () => {
  const desktop = { width: 1350, height: 940 };
  // As found on El Correo and El Norte de Castilla (2026-10-04): the creative (div.wms-centerContents) is
  // absolute in a sticky div (top: 0) in a full-page wrapper; over it lies an empty, transparent layer as
  // tall as the page (div.wms-cc), and a white strip behind the content column (div.wms-siteBgHelper).
  const column = () => el('main', { z: 1, backgroundColor: 'rgb(255, 255, 255)', box: { x: 77, y: 300, w: 1196, h: 5000 } }, [
    el('p', { box: { x: 77, y: 300, w: 1196, h: 5000 }, text: 'The article.' }),
  ]);
  const skin = (...over) => {
    // Boxes in page pixels: scrolled 1000 px, the sticky div holds the creative at the top of the screen.
    const ad = el('div', { className: 'wms-centerContents', position: 'absolute', box: { x: 0, y: 1000, w: 1350, h: 1000 } }, [
      el('canvas', { box: { x: 0, y: 1000, w: 1350, h: 1000 } }),
    ]);
    const wrapper = el('div', { className: 'wms-full-bg', position: 'absolute', box: { x: 0, y: 0, w: 1350, h: 6000 } }, [
      el('div', { className: 'wms-stickyWrapper', box: { x: 0, y: 0, w: 1350, h: 6000 } }, [
        el('div', { className: 'wms-sticky', position: 'sticky', top: '0px', box: { x: 0, y: 1000, w: 1350, h: 0 } }, [ad]),
        ...over,
        el('div', { className: 'wms-siteBgHelper', position: 'absolute', backgroundColor: 'rgb(255, 255, 255)', box: { x: 77, y: 250, w: 1196, h: 5750 } }),
      ]),
    ]);
    return { ad, wrapper };
  };
  const run = (...over) => {
    const { ad, wrapper } = skin(...over);
    return stubPage({ ...desktop, scrollY: 1000, pageHeight: 6000, body: el('body', {}, [wrapper, column()]) }).run(adItems, ad)[0].wallpaper;
  };
  // Sticky, it stays on the screen like a fixed one.
  assert.equal(run(), true);
  // The empty transparent layer over it paints nothing: the skin is still seen beside the content.
  assert.equal(run(el('div', { className: 'wms-cc', position: 'absolute', box: { x: 0, y: 0, w: 1350, h: 6000 } })), true);
  // A layer that paints (a background, text, an image) hides it there: no wallpaper.
  const painting = [
    el('div', { position: 'absolute', backgroundColor: 'rgb(255, 255, 255)', box: { x: 0, y: 0, w: 1350, h: 6000 } }),
    el('div', { position: 'absolute', backgroundImage: 'url(texture.png)', box: { x: 0, y: 0, w: 1350, h: 6000 } }),
    el('div', { position: 'absolute', text: 'Menu', box: { x: 0, y: 0, w: 1350, h: 6000 } }),
    el('img', { position: 'absolute', box: { x: 0, y: 0, w: 1350, h: 6000 } }),
  ];
  for (const layer of painting) assert.equal(run(layer), false, layer.tagName + ' ' + JSON.stringify(layer.style.backgroundColor));
});

test('adItems: wallpaper — an interscroller is none: outside its gap the article covers the sides too', () => {
  const creative = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 }, backgroundImage: 'url(ad.jpg)' });
  const article = el('article', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [
    el('p', { box: { x: 0, y: 100, w: 412, h: 1100 }, text: 'Text above the gap.' }),
    el('div', { box: { x: 0, y: 1200, w: 412, h: 800 } }, [creative]),
    el('p', { box: { x: 0, y: 2000, w: 412, h: 1000 }, text: 'Text below the gap.' }),
  ]);
  for (const scrollY of [0, 1500, 1900]) {
    const page = stubPage({ ...MOBILE, scrollY, pageHeight: 3000, body: el('body', {}, [article]) });
    assert.equal(page.run(adItems, creative)[0].wallpaper, false, `at ${scrollY}`);
  }
});

test('adItems: an ad in a layer that blurs the article over it is in an ad gate: a pop-up layer of its own', () => {
  // Diario de Navarra mobile (membrana.media, 2026-10-04): a transparent layer with backdrop-filter: blur, as
  // tall as the rest of the article and over it, holds a sticky white card ("El artículo se mostrará
  // inmediatamente después de la publicidad · Continuar") with a 300 × 75 ad in it.
  const page = (blur, textZ = 0) => {
    const ad = el('iframe', { box: { x: 30, y: 2500, w: 300, h: 75 } });
    const card = el('div', { position: 'sticky', backgroundColor: 'rgb(255, 255, 255)', box: { x: 20, y: 2400, w: 320, h: 340 } }, [
      el('div', { box: { x: 30, y: 2410, w: 300, h: 33 }, text: 'Estimado lector' }), ad,
    ]);
    const gate = el('div', { position: 'absolute', z: 9, backdropFilter: blur, box: { x: 20, y: 2063, w: 320, h: 7618 } }, [card]);
    const article = el('article', { box: { x: 0, y: 0, w: 412, h: 10000 } }, [
      el('p', { z: textZ, box: { x: 20, y: 300, w: 320, h: 9600 }, text: 'The article.' }), gate,
    ]);
    return { ad, gate, run: stubPage({ ...MOBILE, scrollY: 2187, pageHeight: 10000, body: el('body', {}, [article]) }).run };
  };
  const gated = page('blur(3px)');
  const [item] = gated.run(adItems, gated.ad);
  assert.equal(item.gate, true);
  assert.equal(item.overlay, true);
  assert.equal(item.overContent, true);
  assert.match(item.layer, /^DIV#@20,/);
  assert.equal(item.layerArea, 320 * 823); // the layer's part on screen
  // No blur: a card in the page, not a gate.
  const plain = page('none');
  const [card] = plain.run(adItems, plain.ad);
  assert.equal(card.gate, false);
  assert.equal(card.overlay, false);
  // A blurring layer under the article is not over it.
  const under = page('blur(3px)', 20);
  const [below] = under.run(adItems, under.ad);
  assert.equal(below.overContent, false);
  // A frosted sticky header (blurring what scrolls under it) with an ad in it never covers the screen's
  // centre, where Chrome looks for pop-ups: no gate over the content.
  const slot = el('iframe', { box: { x: 40, y: 10, w: 320, h: 50 } });
  const header = el('header', { position: 'sticky', z: 5, backdropFilter: 'blur(10px)', box: { x: 0, y: 0, w: 412, h: 120 } }, [slot]);
  const text = el('main', { box: { x: 0, y: 0, w: 412, h: 5000 } }, [el('p', { box: { x: 20, y: 0, w: 372, h: 5000 }, text: 'The article.' })]);
  const frosted = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [header, text]) });
  assert.equal(frosted.run(adItems, slot)[0].overContent, false);
});

test('adItems: behindPage — never for an anchor ad or an ad in the page', () => {
  const anchor = el('iframe', { position: 'fixed', box: { x: 0, y: 773, w: 412, h: 50 } });
  const inline = el('iframe', { box: { x: 0, y: 100, w: 412, h: 300 } });
  const text = el('p', { z: 1, box: { x: 0, y: 0, w: 412, h: 3000 }, text: 'Text over everything.' });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [inline, anchor, text]) });
  assert.deepEqual(page.run(adItems, anchor, inline).map((item) => item.behindPage), [false, false]);
});

test('adItems: bottomHit — an anchor ad counts as hit though it ignores pointer events; an ad elsewhere is not hit', () => {
  const anchor = el('iframe', { position: 'fixed', pointerEvents: 'none', box: { x: 0, y: 773, w: 412, h: 50 } });
  const inline = el('iframe', { box: { x: 0, y: 100, w: 412, h: 300 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [el('p', { box: { x: 0, y: 0, w: 412, h: 3000 }, text: 'Text.' }), inline, anchor]) });
  assert.deepEqual(page.run(adItems, anchor, inline).map((item) => item.bottomHit), [true, false]);
});

test('adItems: layer — ads in the same fixed layer over the page share its key; one in another layer or in the page has its own or none', () => {
  const strip = el('iframe', { box: { x: 0, y: 0, w: 412, h: 299 } });
  const frame = el('iframe', { box: { x: 0, y: 0, w: 412, h: 823 } });
  const popUp = el('div', { id: 'bwin', position: 'fixed', z: 10, box: { x: 0, y: 0, w: 412, h: 823 } }, [frame, el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 299 } }, [strip])]);
  const anchor = el('iframe', { box: { x: 0, y: 773, w: 412, h: 50 } });
  const bar = el('div', { position: 'fixed', box: { x: 0, y: 773, w: 412, h: 50 } }, [anchor]);
  const inline = el('iframe', { box: { x: 0, y: 1200, w: 412, h: 250 } });
  // A fixed app shell holding the page: the layer is the pop-up's, as dismissOverlay picks it, not the shell.
  const shell = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [el('main', { box: { x: 0, y: 0, w: 412, h: 3000 } }, [inline]), popUp, bar]);
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [shell]) });
  const [f, s, a, i] = page.run(adItems, frame, strip, anchor, inline).map((item) => item.layer);
  assert.equal(f, s);
  assert.match(f, /bwin/);
  assert.notEqual(a, f);
  assert.equal(typeof a, 'string');
  assert.equal(i, null);
});

test('adItems: a wallpaper skin behind the content column is not over the content, though seen at the sides', () => {
  const desktop = { width: 1350, height: 940 };
  const skin = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 1350, h: 940 }, backgroundImage: 'url(skin.jpg)' });
  const column = el('main', { z: 1, box: { x: 500, y: 0, w: 350, h: 5000 } }, [el('p', { box: { x: 500, y: 200, w: 350, h: 600 }, text: 'The article, in a narrow column.' })]);
  const page = stubPage({ ...desktop, pageHeight: 5000, body: el('body', {}, [skin, column]) });
  assert.deepEqual(['overlay', 'shown', 'overContent'].map((k) => page.run(adItems, skin)[0][k]), [true, true, false]);
});

test('adItems: an ad in the page, or a fixed anchor ad, is not judged over the content', () => {
  const inline = el('iframe', { box: { x: 0, y: 100, w: 412, h: 700 } });
  const anchor = el('iframe', { position: 'fixed', box: { x: 0, y: 723, w: 412, h: 100 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [el('p', { box: { x: 0, y: 0, w: 412, h: 3000 }, text: 'Text.' }), inline, anchor]) });
  assert.deepEqual(page.run(adItems, inline, anchor).map((item) => item.overContent), [false, false]);
});

test('dismissOverlay hides a fixed ad with no fixed ancestor itself, and leaves an ad in the page alone', () => {
  const fixed = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } });
  const inline = el('div', { box: { x: 0, y: 1200, w: 412, h: 823 } });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [fixed, inline]) });
  assert.equal(page.run(dismissOverlay, fixed), true);
  assert.equal(fixed.style.display, 'none');
  assert.ok('data-adc-dismissed' in fixed.attrs);
  assert.equal(page.run(dismissOverlay, inline), false);
  assert.equal(inline.style.display, 'block');
  assert.ok(!('data-adc-dismissed' in inline.attrs));
});

test('markAdCandidates marks, once, the visible elements of 30 × 30 px or more', () => {
  const big = el('div', { box: { x: 0, y: 100, w: 300, h: 250 } });
  const small = el('div', { box: { x: 0, y: 400, w: 20, h: 20 } });
  const hidden = el('div', { box: { x: 0, y: 500, w: 300, h: 250 }, visible: false });
  const page = stubPage({ ...MOBILE, pageHeight: 3000, body: el('body', {}, [big, small, hidden]) });
  assert.equal(page.run(markAdCandidates), 1);
  assert.ok('data-adc-cand' in big.attrs);
  assert.ok(!('data-adc-cand' in small.attrs) && !('data-adc-cand' in hidden.attrs));
  assert.equal(page.run(markAdCandidates), 0); // already marked
});

test('markAdCandidates leaves a frame alone: a box 90 % of the screen wide and over two screens tall', () => {
  const desktop = { width: 1350, height: 940 };
  const frame = el('div', { box: { x: 0, y: 0, w: 1350, h: 9000 } });
  const section = el('div', { box: { x: 0, y: 0, w: 1350, h: 1800 } });
  const rail = el('div', { box: { x: 0, y: 0, w: 300, h: 9000 } });
  const page = stubPage({ ...desktop, pageHeight: 9000, body: el('body', {}, [frame, section, rail]) });
  assert.equal(page.run(markAdCandidates), 2);
  assert.ok(!('data-adc-cand' in frame.attrs));
  assert.ok('data-adc-cand' in section.attrs && 'data-adc-cand' in rail.attrs);
});

const slot = (y, h = 300, extra = {}, children = []) => el('aside', { box: { x: 16, y, w: 380, h }, ...extra }, children);

test('a box labelled by CSS (::before "Publicidad", Faro de Vigo) is marked; empty, it says so', () => {
  const empty = slot(1000, 318, { before: '"Publicidad"' });
  const filled = slot(2000, 318, { before: '"Publicidad"' }, [el('img', { box: { x: 46, y: 2030, w: 300, h: 250 } })]);
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [empty, filled]) });
  assert.deepEqual(page.run(labelledAdBoxes), ['labelled "Publicidad" · empty slot', 'labelled "Publicidad"']);
  assert.equal(empty.attrs['data-adc-label'], 'labelled "Publicidad" · empty slot');
});

test('a text label marks the box whose top holds it, or the box right below it', () => {
  const wrapped = el('div', { box: { x: 16, y: 1000, w: 380, h: 300 } }, [el('span', { text: 'PUBLICIDAD', box: { x: 16, y: 1000, w: 380, h: 20 } }), el('div', { shadowRoot: true, box: { x: 46, y: 1030, w: 300, h: 250 } })]);
  const label = el('p', { text: 'Anzeige', box: { x: 16, y: 2000, w: 380, h: 20 } });
  const below = el('div', { box: { x: 16, y: 2025, w: 380, h: 250 } }, [el('iframe', { box: { x: 46, y: 2025, w: 300, h: 250 } })]);
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [wrapped, el('section', { box: { x: 0, y: 1900, w: 412, h: 1000 } }, [label, below, el('p', { text: 'x'.repeat(200), box: { x: 16, y: 2400, w: 380, h: 400 } })])]) });
  assert.deepEqual(page.run(labelledAdBoxes), ['labelled "PUBLICIDAD"', 'labelled "Anzeige"']);
  assert.ok('data-adc-label' in wrapped.attrs && 'data-adc-label' in below.attrs);
});

test('not labels: links, menus, footers, sentences, hidden or small boxes', () => {
  const footer = el('footer', { box: { x: 0, y: 4000, w: 412, h: 300 } }, [el('div', { box: { x: 0, y: 4000, w: 412, h: 200 } }, [el('a', { text: 'Publicidad', box: { x: 16, y: 4000, w: 100, h: 20 } })])]);
  const menu = el('nav', { box: { x: 0, y: 0, w: 412, h: 300 } }, [el('div', { box: { x: 0, y: 0, w: 412, h: 200 } }, [el('span', { text: 'Advertisement', box: { x: 0, y: 0, w: 100, h: 20 } })])]);
  const sentence = el('div', { box: { x: 16, y: 1000, w: 380, h: 300 } }, [el('p', { text: 'La publicidad online crece', box: { x: 16, y: 1000, w: 380, h: 20 } })]);
  const hidden = slot(1500, 300, { before: '"Publicidad"', visible: false });
  const small = slot(2000, 40, { before: '"Publicidad"' });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [footer, menu, sentence, hidden, small]) });
  assert.deepEqual(page.run(labelledAdBoxes), []);
});

test('a labelled box holding an ad already found, or inside one, is left to that ad', () => {
  const ad = el('iframe', { box: { x: 46, y: 1030, w: 300, h: 250 } });
  const holding = slot(1000, 318, { before: '"Publicidad"' }, [ad]);
  const outer = el('div', { box: { x: 0, y: 2000, w: 412, h: 400 } }, [slot(2050, 318, { before: '"Publicidad"' })]);
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [holding, outer]) });
  assert.deepEqual(page.run(labelledAdBoxes, ad, outer), []);
});

test('labels in other languages: Advertisement, Pubblicità, Sponsored', () => {
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [slot(500, 300, { before: '"Advertisement"' }), slot(1000, 300, { after: '"Pubblicità"' }), slot(1500, 300, { before: '"Sponsored:"' })]) });
  assert.deepEqual(page.run(labelledAdBoxes), ['labelled "Advertisement" · empty slot', 'labelled "Pubblicità" · empty slot', 'labelled "Sponsored:" · empty slot']);
});

test('a labelled slot holding only its ad script is still an empty slot', () => {
  const box = slot(1000, 318, { before: '"Publicidad"' }, [el('script', { text: 'googletag.cmd.push(function(){googletag.display("a")})' })]);
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [box]) });
  assert.deepEqual(page.run(labelledAdBoxes), ['labelled "Publicidad" · empty slot']);
});

test('a link or button by ARIA role is not a label', () => {
  const link = el('div', { attrs: { role: 'link' }, text: 'Publicidad', box: { x: 16, y: 1000, w: 380, h: 20 } });
  const button = el('div', { attrs: { role: 'button' }, text: 'Advertisement', box: { x: 16, y: 2000, w: 380, h: 20 } });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [link, el('div', { box: { x: 16, y: 1025, w: 380, h: 250 } }), button, el('div', { box: { x: 16, y: 2025, w: 380, h: 250 } })]) });
  assert.deepEqual(page.run(labelledAdBoxes), []);
});

test('a labelled box left to an ad it holds, is, or sits inside gets data-adc-label-ad, and is not counted', () => {
  const ad = el('iframe', { box: { x: 46, y: 1030, w: 300, h: 250 } });
  const holding = slot(1000, 318, { before: '"Publicidad"' }, [ad]);
  const free = slot(3000, 318, { before: '"Publicidad"' });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [holding, free]) });
  assert.deepEqual(page.run(labelledAdBoxes, ad), ['labelled "Publicidad" · empty slot']);
  assert.ok('data-adc-label-ad' in holding.attrs && !('data-adc-label' in holding.attrs));
  assert.ok(!('data-adc-label-ad' in free.attrs));
  // Cleared on the next run, when the box no longer holds the ad.
  assert.deepEqual(page.run(labelledAdBoxes), ['labelled "Publicidad"', 'labelled "Publicidad" · empty slot']);
  assert.ok(!('data-adc-label-ad' in holding.attrs));
});

test('a label inside a dialog is part of the dialog, not an ad label', () => {
  const dialog = el('div', { attrs: { role: 'dialog' }, box: { x: 0, y: 100, w: 412, h: 600 } }, [
    el('h3', { text: 'Publicidad', box: { x: 16, y: 120, w: 380, h: 20 } }),
    el('div', { box: { x: 16, y: 145, w: 300, h: 250 } }),
  ]);
  const modal = el('section', { attrs: { 'aria-modal': 'true' }, box: { x: 0, y: 800, w: 412, h: 300 } }, [el('h3', { text: 'Publicidad', box: { x: 16, y: 800, w: 380, h: 20 } }), el('div', { box: { x: 16, y: 825, w: 300, h: 250 } })]);
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [dialog, modal]) });
  assert.deepEqual(page.run(labelledAdBoxes), []);
});

test('a label inside a full-screen fixed overlay (a consent popup with no role) is not an ad label; in an anchor bar it is', () => {
  const layer = el('div', { position: 'fixed', box: { x: 0, y: 0, w: 412, h: 823 } }, [
    el('h3', { text: 'Publicidad', box: { x: 16, y: 20, w: 380, h: 20 } }),
    el('div', { box: { x: 16, y: 45, w: 300, h: 250 } }),
  ]);
  const overlay = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [layer]) });
  assert.deepEqual(overlay.run(labelledAdBoxes), []);
  const bar = el('div', { position: 'fixed', box: { x: 0, y: 723, w: 412, h: 100 } }, [
    el('h3', { text: 'Publicidad', box: { x: 16, y: 723, w: 380, h: 20 } }),
    el('div', { box: { x: 16, y: 745, w: 300, h: 70 } }),
  ]);
  const anchor = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [bar]) });
  assert.equal(anchor.run(labelledAdBoxes).length, 1);
});

test('a CSS-labelled box that is itself a large fixed layer is not an ad label', () => {
  const layer = el('aside', { position: 'fixed', before: '"Publicidad"', box: { x: 16, y: 100, w: 380, h: 600 } });
  const page = stubPage({ ...MOBILE, pageHeight: 5000, body: el('body', {}, [layer]) });
  assert.deepEqual(page.run(labelledAdBoxes), []);
});

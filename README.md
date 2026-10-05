# Ad Density Checker

A Chrome extension that measures how much of the screen and of the page ads take up, on mobile and desktop, using Chrome's own ad detection. It shows the result next to real-user data from the Chrome UX Report (CrUX) and checks the Better Ads Standards density limits.

## What it shows

The panel leads with the Better Ads verdict, then the viewport figures next to CrUX, then the snapshot. It follows the system's light or dark mode, works with the keyboard alone, and tells screen readers how the test is going and how it ended.

| Block | Source | Verdict |
|---|---|---|
| **Test** | A scripted run on the current tab, as a phone or as a desktop (switch in the panel). Ads are what Chrome tags, plus the ads its cut-down list misses (found with EasyList and the page language's regional list); viewport density and count follow Chrome's own rules | None: Chrome sets no thresholds |
| **CrUX p75** | Real Chrome users over the last 28 days, phone or desktop, for the URL or else its origin: ad density, ad count, ad CPU and ad network | None |
| **Better Ads** | Ad positions recorded during the test | ✓/✕ against the official limits |

### The test

1. Emulates a phone (412 × 823, DPR 1.75) or a desktop (1350 × 940), Lighthouse's profiles, and reloads the page.
2. Waits for the load event, moves the mouse once like a reader (along the screen's left edge, no click, no scroll: some sites serve no ads until a person interacts with the page, so as not to sell impressions to bots), waits 3 s more, then scrolls one screen every 2 s until the bottom (60 s max). On an article it stops once the whole article has been on screen, or when the page moves on to the next article (an infinite scroll changing the address), so the next articles aren't measured.
3. Every second it finds the elements Chrome tagged as ads and measures the visible ones the way Chrome does: an ad counts only if it is on top at the centre of its visible part; density is the share of the screen covered by ads; ads of 10 000 px² or more count towards the ad count.
4. Closes a pop-up ad like a reader would: an interstitial (see below) is closed after about 3 s (once a screenshot of it is taken, when one still can be) and stays hidden for the rest of the test, so the viewport figures and the page's ads are measured under it, as after a reader closes it.
5. Reports average and peak viewport ad density and the average ad count. Time with the tab hidden is left out, as Chrome does.
6. Removes the emulation and leaves the tab as it is (no reload: a second load right after the test's, with another user agent, is what bot protections block). After a phone test the page keeps its phone version until you reload it.

Chrome's DevTools (Application → Ads) computes the same metrics internally, but extensions can't read those numbers, so the extension recomputes them. Checked against Chrome's own numbers on the same page loads of ad-heavy news sites, the average density was within 2 points and the ad count within 0.1. Most of the gap comes from timing: Chrome rechecks whether an ad is covered at most once per second, so right after a scroll it can briefly keep an ad as visible (or hidden) while the extension already sees the new state.

Ad CPU time and ad network bytes come from CrUX only: an extension can't read CPU per ad, and its own network count drifted too far from Chrome's on pages with video ads.

While it runs, the page ignores your input: scrolling by hand (wheel, trackpad, touch, keys), clicks and typing are blocked and the scrollbar is hidden, so only the test moves the page. Chrome also shows a yellow "started debugging this browser" bar. That is the `debugger` permission at work; pressing **Cancel** on it stops the test.

### Better Ads checks

Ad density follows the [Better Ads definition](https://www.betterads.org/mobile-ad-density-higher-than-30/) ("ads that take up more than 30 % of the vertical height of a page", 50 % on desktop): the height of the main content taken by ads, divided by the height of the main content. Every ad format counts, a sticky ad's height once; an ad inside another ad counts once. A stretch of the page with ads counts once however many ads sit side by side in it.

**Why the panel can show 100 %+.** The standard doesn't say what to do with ads side by side. Its title speaks of ads that "take up more than 50 % of the vertical height of a page", which can't pass 100 %; its method says "summing the heights of all ads", which, read literally, adds up ads side by side (content column, side rails, skins) and can pass 100 % on a page with tall rails and little content. The extension takes the first reading, the one a reviewer marking where a page has ads would follow: each stretch counts once. Sticky ads have no place in the page, so their height comes on top of those stretches; when the ads would take up more than the whole main content, the panel and the export show **100 %+** instead of a figure past 100. Either way such a page fails the limit.

| | Mobile | Desktop |
|---|---|---|
| Ad density | ≤ 30 % | ≤ 50 % |
| Ad density with a sticky video ad | — | ≤ 30 % |
| Large sticky ad (share of the screen) | ≤ 30 % | ≤ 30 % |
| Pop-up / interstitial ad | fails | fails |

- **Main content** is found automatically: below the site header and navigation (even when a billboard ad sits above the header; on an article page whose header isn't marked up as one, from the headline or the ads above it), above the site footer and the related / recommended blocks (found by their heading, such as "Te puede interesar", "Más información" or "Related", and by Taboola, Outbrain or Addoor widgets). On a page that declares itself an article (`og:type` article or a `NewsArticle` in JSON-LD), the main content ends with the article: below its text (the container holding most of its paragraphs), at the first block that is not main content — what Chrome's own page-content annotation calls complementary, navigation or footer (`<aside>`, `<nav>`, `<footer>` and their ARIA roles), a Taboola, Outbrain or Addoor feed, the comments, a list of links to other stories — or at the next story's headline. Nothing above the last of the article's text ends it, so related boxes and widgets between paragraphs don't; an aside an ad fills (as Chrome tags it) is the ad's slot, not the end; ads between the text and that block stay in. Recommendation grids, comments and the next articles of an infinite scroll are left out, also when the page drops earlier articles while scrolling. The panel shows the range used; if nothing sensible is found, the whole page is used and the panel says so. A human reviewer may draw these limits differently.
- **Which ads count:** every ad Chrome tags, plus the ads its cut-down list misses, drawn in pink on the snapshot with the reason (the list and rule, or the label). Chrome's own figures (viewport density, ad count, the comparison with CrUX) keep Chrome's tags only; the panel says "Includes N ads Chrome doesn't detect (…)", with a "Why?". The extra ads are of two kinds:
  - elements made by an ad script: a script that EasyList, or the regional list for the page's language (EasyList Spanish on a Spanish page, Liste FR on a French one…), names by its host (rules naming a host only, not generic URL patterns), or a script such a script loaded from the same site (the ad company's own code, so ad-security scripts that re-insert other scripts don't make them ads). An element counts only when the script made it end to end (a script that merely wraps DOM methods doesn't), only while it shows something, and once (an ad drawn in two places, a page-sized frame around a skin, or a wrapper around the article, isn't counted twice or as one huge ad);
  - boxes labelled as advertising ("Publicidad", "Advertisement", "Anzeige"…), by text or by CSS, empty or not. A labelled box that holds (or sits over) an ad already found counts as that ad, and labels inside dialogs (consent) or in a fixed layer covering a quarter of the screen or more (a pop-up, a modal) don't count.
  - All of them count when visible by CSS and not hidden behind page content, including ads stacked under other ads and anchor ads at the top or bottom edge. Ads in the siderails count, as the standard says; ads that share a stretch of the page, stacked or side by side (content column and side rail), count once. A sticky ad counts the screen's rows it covers, never more than the screen (some creatives fixed behind the page are taller than it). Ad skins (tall sticky panels against the left or right edge, or a wallpaper fixed or sticky behind the page's content and seen beside it, through any layer that paints nothing there) count like any sticky ad, their height once; skins on both sides share the same rows of the screen, so they count once together.
- **Large sticky ad:** a sticky ad at the bottom centre of the screen: where Chrome checks it (90 % of the screen height) or, for a thin anchor ad below that line, at the bottom edge. Such an anchor covers less than 10 % of the screen, so it never fails the 30 % limit, but the panel shows its share instead of "none". As in Chrome's check, the ad must stay on top there while the page scrolls more than its height: an interscroller, on top there only while its gap in the article scrolls by, isn't one.
- **Interscroller:** a creative fixed behind the article and seen through a gap in it as the page scrolls by (Chrome's detectors call them parallax or scroller ads). The test tells one from a sticky ad by what covers it: seen at some moments, wholly behind the page's own content at others, and larger than 30 % of the screen (a small floating box the page covers now and then stays a sticky ad). It counts in the density with its height once, as the gap's, and isn't a sticky ad, so it's out of the large sticky check. The snapshot labels it "interscroller · N px".
- **Pop-up / interstitial:** an ad (Chrome's, the lists' or a labelled box) in a layer fixed over the page, shown, that covers half of the screen or more at some point of the test and lies over the page's content: at the centre of the screen the ad is on top, with the page's content under it. A wallpaper skin behind the content isn't one (the content is on top), nor is an interscroller (a creative fixed behind a gap in the article, revealed as you scroll past it: there is no content where it shows); the skin counts as a sticky ad, the interscroller as below. A fixed wrapper that holds the page's own content (an app shell some sites scroll inside) is the page, not a layer over it: its ads are judged as usual. Better Ads judges pop-up ads and prestitials on their own: one fails the check whatever the density, and it isn't counted in the density nor in the large sticky check. Neither are the other ads in its layer: some pop-ups are one creative made of several frames, stacked or side by side, and each frame is a piece of the pop-up, not an ad of its own. Real readers close it in seconds, so the test closes it too after about 3 s (once a screenshot of it is taken, when one still can be): left open for the whole test, it would push Chrome's viewport average far above CrUX's. Smaller pop-ups (a 300 × 250 box over a dimmed page) count as sticky ads. An **ad gate** is a pop-up too: a layer over the article that blurs it (backdrop-filter) until the reader gets past the ad it holds (Diario de Navarra's "the article will show right after the ad · Continue"), on top at the screen's centre, where Chrome looks for pop-ups, and blurring over 10 % of the screen, Chrome's threshold for one. Better Ads doesn't name this format, but its pop-ups are ads that "block the main content of the page" and "can take up part of the screen"; Chrome's check misses it (what lies at the centre is the gate's small text, not tagged as an ad, and the gate follows the scroll). The panel says so. The ads in the gate are pieces of it, and the test closes it after about 3 s like the other pop-ups.
- **Auto-redirect:** if, during the test, the tab leaves for another site, it wasn't the reader: the test never clicks or taps. That is an abusive experience for Google (an auto-redirect; Better Ads doesn't name it), often malvertising: on El Independiente an ad bought at auction clicked a link it made and sent the reader to a fake McAfee alert. The test stops there and keeps what it had measured, the panel says where the page went (the site only: a scam's address may carry the reader's city and carrier), and the tab goes back to the article. Leaving for another address on the same site still stops the test with an error.
- **Live blogs** (`LiveBlogPosting`) keep all their posts as main content.
- **When Chrome tags the page itself as an ad** (an ad skin styling `<body>`), Chrome's viewport figures read close to 100 % — the panel says so — and Better Ads leaves that element out.
- **Sticky video ad:** a sticky ad that is or contains a `<video>` in the page itself; video players inside cross-origin ad iframes can't be seen.
- **Video players showing videos:** Chrome tags a whole video player when an ad script made it, whatever it plays (Connatix's player on NY Post plays the site's own news clips; EX.CO's on El Economista, news clips of its own network). A player with Google IMA's ad box that is seen playing its own video isn't counted, labelled "not counted · content video player", wherever it was and whatever covered it, nor does it set the sticky video limit. The space is the video's, like an article's; the ads it plays (pre-rolls, mid-rolls) fall under Better Ads' short-form video standard (videos of 8 minutes or less: no mid-rolls, no pre-rolls over 31 s that can't be skipped in 5 s, no overlays over the middle third or 20 % of the video), which the test doesn't measure; the panel says so. Every piece of the player goes with it: Chrome tags each one the ad script made (its video, ad slots, IMA's frames) and EasyList adds others (Connatix's floating close bar). A player only ever seen playing an ad can't be told from a unit that is all ad (an outstream unit), and counts, as do labelled slots, filled or not: that space is the ads'. Ads inserted into the video stream on the server (Google DAI) can't be told from the content.
- **Not measured:** native ads that Chrome doesn't tag as ads, autoplay video with sound, flashing ads, the ads inside a video player showing videos (Better Ads' short-form video standard). Other native ad grids placed inside the article element count as part of the main content.

### Real and Chrome views

One test, two views of its result, switched with **Real · Chrome** above the verdict:

- **Real** counts what a reviewer would: Chrome's tagged ads, the ads the full lists find (pink) and slots labelled as advertising.
- **Chrome** shows Chrome's ad tags only, with the same three checks computed on them. A tag the tool doesn't count (behind the page's content, say) is drawn blue, dashed, with why; tags outside the main content stay grey, as in the Real view. Labelled slots are pink like the lists' ads.

Chrome's own figures (its tags, its average share of the screen) are the same in both views.

Both views come from the same page load, so they compare the same ads. **Open full size** shows the view on screen in a new tab and **Download** saves it (its header says which); **Download Chrome vs Real** saves both side by side under the page's whole URL. A "What do these give you?" note under the buttons says the same.

### Snapshot

When a test ends, the panel shows the tested page stitched from the screens captured during the test (one per scroll), with the Better Ads decisions drawn on it:

- the page is lightened so the ads stand out: counted ads keep their colours, with an orange border and the height they add; sticky ads get a violet border, once, with their share of the screen;
- ads not counted stay lightened, with a grey dashed border and the reason: behind page content, ad skin, inside another ad, outside the main content;
- an interstitial is drawn once, in the screen that captured it, like a sticky ad, with its share of the screen;
- ads Chrome doesn't detect are drawn in pink with the reason (the list and rule, or the label);
- the main content: what lies outside it is dimmed, and the two cuts are labelled with their position.

The site's fixed bars at the top (the header) show once, in the first screen; those at the bottom (a subscription, cookie or navigation bar) don't show, since in the stitched page they would sit across its middle; each anchor ad shows once, in the first screen that had it (they are hidden while the later screens are captured). Grey bands mark parts of the page no screenshot covered. The snapshot has no density column; the panel keeps the test's ads-on-screen line, with its peak in amber and its value.

**Open full size** opens the whole image in a tab; **Download** saves it as a JPEG with a summary on top (URL, device, date, the Better Ads figures — density, large sticky ad, interstitial — and the average viewport density). The panel keeps the snapshots of the last 5 tests.

### Filter lists

Network rules from EasyList and its regional lists (Liste FR, EasyList Spanish, Germany, Italy, …). Only network rules naming a host, and the exception rules whose options the extension reads, are bundled, per list, in `lib/adlists.js` (`npm run adlists` refreshes them). EasyList © The EasyList authors; regional lists by their maintainers — each list's licence and attribution in `lib/adlists-LICENSE.txt`.

## Limitations

- **The page loads again:** the test reloads it at the start, so anything typed into the page is lost and the site counts an extra visit. It isn't reloaded at the end.
- **Stay on the tab.** While it's hidden (another tab or window in front), the test pauses and so does its minute, as Chrome pauses its ad metrics; it goes on when you're back. A test whose tab stayed hidden throughout, or for over 2 minutes in all, gives no result rather than a verdict on the first screens.
- **Accept the cookie banner first, and turn off ad blockers.** The test doesn't answer consent banners, and many sites hold their ads until you do; an ad blocker leaves nothing to measure.
- **One page, one document.** If the page goes to another address or reloads itself during the test (a link, a redirect), the test stops and says so; so does a page that fails to load. Ads inside an iframe that Chrome doesn't tag as an ad (an embedded widget, for instance) aren't seen.
- **What loads in 60 s:** pages that keep growing (infinite scroll) are measured as far as the test got in that time.
- **Pages that can't be scrolled** (an overlay locks scrolling, or the page scrolls inside a container) are flagged: only the first screen was measured. A page that stops scrolling partway (a paywall sheet holding it) ends the test there, and only what was seen is measured.
- **Chrome Web Store and `chrome://` pages** can't be tested: Chrome doesn't let extensions debug them.

## Install

The extension isn't on the Chrome Web Store. Load it from this repo:

1. Download the repo (Code → Download ZIP, then unzip) or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the repo folder.
4. Pin the extension and click its icon to open the side panel.

Needs Chrome 154 or later. To update, download or `git pull` again and click the reload icon on `chrome://extensions`.

## CrUX API key (optional)

Without a key the panel still runs tests and links to CrUX Vis. With one, CrUX numbers appear next to the test.

1. Create a key as described in [Using the CrUX API](https://developer.chrome.com/docs/crux/api#APIKey) (free, 150 queries per minute).
2. Paste it in the CrUX part of the panel and press **Save**. The panel checks it with one CrUX query and says so if the API rejects it. **Change key** replaces or removes it.

The key stays in your browser and is only sent to `chromeuxreport.googleapis.com`.

CrUX only has ad data for sites whose `ads.txt` lists at least one authorized seller, and with enough Chrome traffic.

## Privacy

Nothing is collected. The only network request the extension makes is the CrUX query (page URL or origin + your key) to Google's CrUX API, and only once you add a key. Full details in [PRIVACY.md](PRIVACY.md).

## Development

```bash
npm test          # unit tests (Node 22, no dependencies)
npm run icons     # regenerate icons/
npm run pack      # dist/ad-density-checker-<version>.zip for the Chrome Web Store
```

The store listing texts, permission justifications and privacy answers are in [store/listing.md](store/listing.md).

## References

- [Chrome ad metrics](https://developer.chrome.com/docs/ads) and [methodology](https://developer.chrome.com/docs/ads/methodology)
- [CrUX API](https://developer.chrome.com/docs/crux/api)
- [Better Ads Standards](https://www.betterads.org/standards/)

## License

MIT (`LICENSE`). The filter rules bundled in `lib/adlists.js` are not covered by it: each list keeps its own licence and attribution, in `lib/adlists-LICENSE.txt`.

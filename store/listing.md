# Chrome Web Store listing

Everything the Developer Dashboard asks for, ready to paste.

Package: `npm run pack` → `dist/ad-density-checker-<version>.zip` (only the files the extension loads).

## Store listing

**Name:** Ad Density Checker by Natzir

**Summary** (132 characters max):

> Check ad density like a Better Ads reviewer, and see which ads Chrome counts in its CrUX ad metrics and which it misses.

**Category:** Developer Tools

**Language:** English

**Description:**

```
Ad Density Checker measures how much of a page ads take up, on mobile and desktop, the way a Better Ads reviewer would, and shows which of those ads Chrome itself sees.

Open the side panel, pick Mobile or Desktop and run the test. The extension reloads the page as a phone or a desktop, scrolls through it like a reader for up to a minute, and shows:

• Better Ads verdict: ad density against the Coalition for Better Ads limits (30 % on mobile, 50 % on desktop), the large sticky ad check (30 % of the screen) and pop-ups, ad gates included (a layer that blurs the article until the reader goes through an ad).
• Two views of the same test. Real counts every ad a reviewer would; Chrome keeps only the ads Chrome tags, the ones behind its CrUX ad metrics. Switch between them to see which ads Chrome misses, and what it tags that isn't an ad, such as the site's own video player.
• Viewport figures by Chrome's rules: average and peak share of the screen covered by ads, and the ad count, next to real-user data from the Chrome UX Report (CrUX) once you add a free API key.
• A snapshot of the tested page, stitched from the screens of the test, with every ad marked as counted, sticky or not counted (and why), the ads Chrome misses in their own colour, and the main content limits. Open or download either view as a JPEG, or both side by side as a Chrome vs Real image.
• What a reviewer would flag besides: if the page sends the reader to another site on its own (an automatic redirect, often to a scam), the test stops there, says where it went and brings the tab back.

For SEO, publishers and ad-ops teams who want to check pages before Google's ad experience review or Chrome's ad filtering does.

HOW IT MEASURES
• Ads are what Chrome tags, plus the ads its cut-down filter list misses (found with EasyList and the page language's regional list, bundled) and boxes labelled as advertising. The Chrome view and Chrome's own figures keep Chrome's tags only.
• Viewport density and ad count follow Chrome's own rules.
• Better Ads density is the share of the main content's height taken by ads. Headers, footers, navigation and related articles are left out automatically. Ads in the side rails and ad skins count; a stretch of the page with ads counts once. A video player showing the site's own videos isn't counted as an ad.
• Pop-ups are closed after three seconds, as a reader would, so the rest of the page can be measured. After the page loads, the test moves the mouse pointer once, because some sites serve no ads until they see movement.
• The test stops where the page does, and says so: at the end of an article, when an infinite scroll moves on to the next article, at a paywall, or after a minute. If a dialog (cookies, sign-in) hides every ad, it reports the page as not measured instead of a pass.

WHY IT NEEDS THE DEBUGGER
Chrome only gives extensions its ad tagging, screen emulation and page screenshots through the debugger, and with them the page's network events (which scripts load) and the DOM's stack traces (which script created each element), which the test compares with the bundled filter lists in your browser; nothing is sent. While a test runs, Chrome shows a "started debugging this browser" bar and the page ignores your scrolling and clicks. The test only touches the tab you test. When it ends the debugger is detached and the tab stays where the test left it, unless the page sent it to another site: then it is taken back to the tested page.

PRIVACY
No accounts, no analytics, no tracking. Everything is measured in your browser. The only data that leaves it is the page address sent to Google's CrUX API, and only if you add your own API key.

ACCESSIBLE
Works with the keyboard alone, tells screen readers how the test is going and how it ended, and follows light and dark mode.

Made by natzir.com. Source code (MIT): https://github.com/natzir/ad-density-checker
```

## Privacy practices

**Single purpose:**

> Measure how much of a web page is taken up by ads, by Chrome's ad detection plus EasyList and the page language's regional list, check it against the Better Ads Standards, and show which of those ads Chrome's own ad tagging sees.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `debugger` | Measures ads the way Chrome does: reads which page elements Chrome tags as ads, which scripts the page loads and which script created each element (compared with the bundled filter lists), emulates a phone or desktop screen, reloads the tested page, moves the mouse pointer once along its edge (some sites serve no ads until they see movement) and scrolls it, watches where the page navigates to detect an automatic redirect to another site, captures its screens for the result snapshot, and ignores the user's input while the test runs. Attached only to the tab the user tests, only during the test, and detached when it ends. |
| `sidePanel` | The extension's interface is a side panel next to the tested page. |
| `storage` | Remembers the chosen device and the user's optional CrUX API key, and notes a running test so its tab can be restored if the extension restarts mid-test. |
| `tabs` | Reads the active tab's address to show which page will be tested and whether it can be, follows tab switches so the panel shows the right result, and takes a tested tab back to the tested page when the page redirected it to another site during the test, or when the test was cut short by an extension restart. |
| Host `https://chromeuxreport.googleapis.com/*` | Fetches Chrome UX Report field data for the tested page with the user's own API key. |

**Remote code:** No, I am not using remote code.

**Data usage** (what to tick):

- **Web history**: yes. When the user adds a CrUX API key, the address of the page shown in the panel is sent to Google's CrUX API to fetch its field data. Nothing else is collected.
- Everything else: no.
- Certify all three: not sold to third parties; not used or transferred for purposes unrelated to the item's single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL:** https://github.com/natzir/ad-density-checker/blob/main/PRIVACY.md

## Assets

| Asset | Size | Status |
|---|---|---|
| Store icon | 128 × 128 | `icons/128.png` |
| Screenshots | 1280 × 800 | `store/screenshots/1-real-view.png`, `2-chrome-view.png`, `3-chrome-vs-real.png`, `4-desktop.png`, in that order (real tests; the sites' logos and addresses blurred) |
| Small promo tile | 440 × 280 | `store/promo-440x280.png` |

## Before submitting

- The repository must be public, so the privacy policy URL opens for the reviewers.

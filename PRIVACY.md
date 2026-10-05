# Ad Density Checker · Privacy policy

Last updated: 5 October 2026

Ad Density Checker is a Chrome extension by natzir.com that measures how much of a web page ads take up. It has no accounts, no analytics, no ads and no server of its own. This page lists everything it reads, keeps and sends.

## What it reads

When you run a test on a tab, and only then, the extension attaches Chrome's debugger to that tab to:

- read which elements of the page Chrome tags as ads, and where they sit on the screen;
- read which scripts the page loads (their addresses, from the debugger's network events) and which script created each element (the debugger's DOM stack traces), and compare those addresses with filter lists bundled in the extension; nothing is sent anywhere;
- emulate a phone or a desktop screen, reload the page, move the mouse pointer once along its left edge (some sites serve no ads until they see movement) and scroll through it;
- watch where the page navigates, to tell when it sends the tab to another site on its own (an automatic redirect);
- capture the screens of the page for the result snapshot.

All of it is processed inside your browser. When the test ends the debugger is detached; the tab isn't reloaded, unless the page sent it to another site during the test: then it is taken back to the page you tested.

The side panel also reads the address of the active tab, to show which page will be tested.

## What it keeps

In `chrome.storage.local`, in this browser only:

- the device you picked (mobile or desktop);
- your CrUX API key, if you add one (you can remove it from the panel at any time);
- while a test runs, the tab and page address being tested, so the tab can be put back if the extension restarts mid-test. It is deleted when the test ends.

Test results and snapshots are kept in the side panel's memory while it is open (the last five), and are gone when you close it. A snapshot is saved to your computer only when you click **Download**.

## What it sends

- **To Google's Chrome UX Report API** (`chromeuxreport.googleapis.com`), only if you add your own CrUX API key: the address of the page shown in the panel (without the part after `#`), or its origin when the page has no data of its own, the device type, and your key. This fetches the page's real-user ad metrics. Google's [privacy policy](https://policies.google.com/privacy) applies to that request.
- Nothing else. The links in the panel (CrUX Vis, how to get a key, natzir.com) open a page only when you click them; **Open in CrUX Vis** passes the page's address to that Google tool.

The extension doesn't sell, share or use any data for anything other than the measurement you ask for, and doesn't load code from outside the extension.

## Contact

Questions about this policy: [hola@natzir.com](mailto:hola@natzir.com)

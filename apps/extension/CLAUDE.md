# Scia — Extension CLAUDE.md (`apps/extension`)

Loaded when working under `apps/extension/`. **Extends** the root `CLAUDE.md`.

A Manifest V3 extension for Chromium browsers. It hands the desktop app links and the media a page loaded. The app does the downloading.

- **It observes; it never alters.** `webRequest` listeners read response headers and return nothing. No request is blocked, redirected or rewritten.
- **It sends only to the app on this computer** (`http://127.0.0.1:<port>`), with the app's pairing token, which the person copies into its options ([ADR 0002](../../docs/adr/0002-browser-extension-pairing.md)). No other host is ever contacted; nothing is collected.
- **What it sends is a link and the page it was on.** Cookies and session headers are not sent. Sending them is on the roadmap as an explicit, per-site choice of the person — never a default.
- **The browser's own download is stopped only after Scia took the link**, and only when the person turned interception on. A closed Scia loses nothing.
- **Adaptive streams are left alone** (`capturableMediaKind` in `@scia/core`): the popup offers what Scia can actually download.
- **The service worker forgets**: it is stopped and restarted at the browser's will. State lives in `chrome.storage` (`storage.ts`), never in a module variable that matters.
- **Logic is pure and tested** (`media.ts`, `scia-client.ts`, with an injected `fetch`); `background.ts`, `popup.ts` and `options.ts` are thin wiring over `chrome.*`.
- **A new permission in `static/manifest.json` needs a line in the ADR**: what it is for, and what it lets the extension see.

## Trying it

`npm run build -w @scia/extension`, then in `chrome://extensions` turn on developer mode and "Load unpacked" → `apps/extension/dist`. Settings does not offer the pairing token until the extension is published (the owner, #152): pair it with the file `engine/extension-token` of the profile the app runs on.

# ADR 0002 — The browser extension reaches the app over localhost, with a pairing token

- **Status**: accepted
- **Date**: 2026-11-19

## Context

The extension must hand links to the desktop app. The app listens on `127.0.0.1`, where every program and every web page on the computer can send requests. A page must not be able to make Scia download a file, read the list of downloads, or change settings.

## Decision

1. **The engine listens on a fixed port, 47821** (`DEFAULT_API_PORT`), so the extension finds it without a search. `--port` overrides it for runs that are not the installed app.
2. **Every route but `/health` needs a bearer token.** Two exist:
   - the **app token**, random at every launch, given to the page by the preload: every route;
   - the **extension token**, random once, kept in the engine's data folder, shown in the app's settings for the person to copy into the extension: `POST /downloads` and `GET /extension/check`, nothing else (`EXTENSION_ROUTES`).
3. **Only the engine's own host name is answered** (`127.0.0.1:<port>`, `localhost:<port>`): a page that points a domain of its own at 127.0.0.1 (DNS rebinding) gets a 403.
4. **No CORS header is ever sent.** A web page cannot read an answer, and a request with an `Authorization` header from a page dies at its preflight. The extension is not subject to CORS for hosts in its `host_permissions`.
5. **The extension sends a link and the page it was on.** No cookies, no session headers.

## Permissions of the extension

| Permission                  | For                                                           | Lets it see                       |
| --------------------------- | ------------------------------------------------------------- | --------------------------------- |
| `webRequest` + `<all_urls>` | Noticing the video and audio files a page loads               | Response headers of every request |
| `contextMenus`              | «Scarica con Scia» on a link, a video, an audio, an image     | The link that was clicked         |
| `downloads`                 | Passing the browser's downloads to Scia, when the person asks | The browser's download list       |
| `storage`                   | The pairing token, the port, the per-tab list of media        | —                                 |

## Alternatives considered

- **Native messaging.** No open port at all. Rejected for now: a manifest to register per browser and per platform (the registry on Windows), a host executable to ship, and an installer step that can fail silently. Worth revisiting when the extension is published.
- **No token, origin check only.** Rejected: any local program can forge an `Origin` header.
- **One token for everything.** Rejected: the extension's token lives in the browser's storage, a weaker place than the app's memory; it must open as little as possible.

## Consequences

- If another program holds port 47821 the engine does not start, and the app says so. A fallback port with discovery by the extension is on the roadmap.
- Re-pairing is deleting `extension-token` from the engine's data folder: the engine makes a new one at its next start.
- Downloads behind a login fail when sent from the extension, because Scia does not have the session. Forwarding cookies is a separate, explicit, per-site decision of the person, to be designed with its own ADR.

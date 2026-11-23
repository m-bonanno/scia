# ADR 0013 — The key of a service can also arrive by a code the person confirms on its site

- **Status**: accepted; point 3 amended below, "Amendment — a code confirmed after Settings closed" (#146)
- **Date**: 2026-11-21

## Context

[ADR 0004](./0004-the-key-of-a-service.md) has the person paste the key of their AllDebrid account into Settings. Among its alternatives it named AllDebrid's PIN flow: the person confirms a code on AllDebrid's site and the application receives a key. It was left for later ("Not now: #7 asks for the key, and the flow needs main to open a browser on an address and to poll").

On 21 November 2026 the owner asked for it, from the "API" entry of AllDebrid's tools page, and decided how it sits (#136):

- it goes **beside** the pasted key, not in its place;
- "Connect with a code" is the **main** way in Settings, and pasting a key is the other one.

AllDebrid's documentation (https://docs.alldebrid.com, "Pin auth", read on 21 November 2026) describes the flow:

- `GET /v4.1/pin/get`, sent with no key, answers four things: a `pin`, a `check` token, `expires_in` (600 seconds) and `user_url`, the page where the person confirms the code.
- `POST /v4/pin/check` is sent with `pin` and `check`. It answers `activated: false` until the code is confirmed, then `activated: true` with the `apikey`.
- It is asked every five seconds or more, for ten minutes at most. Its refusals are `PIN_EXPIRED` and `PIN_INVALID`.

AllDebrid's tools page also offers an OpenAPI specification (https://docs.alldebrid.com/swagger/alldebrid.json). It is older than the documentation: version 4.0.0, last changed in February 2022, and it has no route for the PIN. The client follows the documentation.

## Decision

1. **The engine asks for the code and waits for it.** It is the only process that speaks to the service, as for every other request (ADR 0004, point 1).
   - `POST /api/v1/integrations/:id/code` asks AllDebrid for a code. While a service is connected it gives none (`409 CONFLICT`): a confirmed code would replace that key, perhaps with another account's. It answers what the person needs (`IntegrationCode` in `@scia/contracts`): the code, the page where it is confirmed, when it expires, and what became of it (`waiting`, `connected` or `failed`, with the failure).
   - From then on, the engine asks the service every five seconds whether the code was confirmed, for as long as the service says the code lasts, and ten minutes at most: a lifetime from outside becomes a date.
   - `GET /api/v1/integrations/:id/code` says what became of the code given last. The page reads it every two seconds while it shows a code.
   - `DELETE /api/v1/integrations/:id/code` ends the wait.
   - These routes take the app's token only (ADR 0002).
2. **The key a confirmed code gives is a pasted key.** It goes through `Integrations.connect`'s own step: the service is asked whose account it is, the key is kept sealed by main (ADR 0004, point 2), and connecting happens one at a time with disconnecting. A key the service refuses, or the system will not keep, connects nothing, and the code says why. The `check` token gives the key: it stays in the engine's memory, never in an answer, a log or `state.json`. The key itself crosses no route.
3. **Only one code waits at a time.** Each of these ends the wait for the code before it: a new code, a pasted key — when it is sent, and again once it is kept, so that a code given while the key was checked is not kept beside it — Cancel, and Settings closing. Each moves the wait on a turn, in the engine and in the page: a code the service gives after its wait was ended — while it was being asked for — is not kept, its request answers `409 CONFLICT`, and the page shows nothing of it and tells the engine to forget the code it brought, by name: `DELETE …/code?code=<code>` forgets that code only, so a late cancel never ends a newer one.
   - A code whose time has run out, or that the service no longer knows, is `CODE_EXPIRED` (`CodeFailure` in `@scia/core`): "Get a new code" asks again.
   - A service that cannot be asked for a moment does not end the wait. The next turn asks again, until the code expires.
   - The wait's timer does not keep the engine running (`ref: false`) — read in the code, held by no spec.
4. **Main opens the page; the page names only the service.** `window.scia.openCodePage(id)` is a member of the bridge. Main asks the engine for the code's page (`engine/integration-code.ts`) and opens it with `shell.openExternal`. It never opens an address that comes from the page (`apps/desktop/CLAUDE.md`), and it hands the system the address as a browser writes it (`new URL(url).href`), not the text as it came.
5. **A page is opened only on the service's own site.** The page must be on `alldebrid.com` or one of its names, over https, with no one before the host and no port after it (`isServiceSite` in `@scia/contracts`). The engine refuses a code whose page is elsewhere as an answer it does not understand. Main checks again before it opens anything: an address the engine was brought is not opened as it stands.
6. **The page says where the code is confirmed.** It shows the site and the page as a person would type them (`alldebrid.com/pin`), and how long the code works. So the code can also be confirmed on another device, and in a plain browser during development, where there is no main to open anything.

## Alternatives considered

- **The page polls the service itself, or main does.** Rejected: the engine is the one process that speaks to a service (ADR 0004). A page that receives the key would hold the secret ADR 0004 keeps out of it.
- **One request that waits until the code is confirmed** (a long poll). Rejected: a request held open for up to ten minutes, cut by anything that ends a request — the page reloading, the engine started again — with nothing to say what became of the code.
- **The page opens the address as a link** (`target="_blank"`, let through `setWindowOpenHandler`). Rejected: main would take an address from the page, against `apps/desktop/CLAUDE.md`.
- **The code in place of the pasted key.** The owner chose both (#136): a key from AllDebrid's page of keys stays possible, for a person who keeps their keys there.

## Consequences

- With a code shown in Settings, Scia asks AllDebrid about it every five seconds, for ten minutes at most, with no key. The page asks the engine every two seconds.
- The bridge gains a member, `openCodePage`.
- A code is in the engine's memory only. An engine started again has none, and the page says the code is no longer valid.
- AllDebrid's documentation does not say whether a key made through a code also brings AllDebrid's email about a new sign-in, as a pasted key's first use usually does (AllDebrid's help, "API keys"). If it does, the service refuses the key as blocked, and the code says to confirm that email and get a new code.
- The flow is proven against the simulated service only. AllDebrid's real page, and a real account, are the owner's to try.

## Amendment — a code confirmed after Settings closed (2026-11-23, #146, #286)

The owner decided, on #146:

- (21 November 2026) With Settings closed before the code is confirmed, Scia keeps waiting for the code's ten minutes and connects when it is confirmed, saying so with a notification. `v1.0.0` waits for it.
- (23 November 2026, on the review of #288) "AllDebrid is connected" is notified every time AllDebrid connects while Scia's window is not the one in use — a code confirmed in the browser with Settings open too, not only a code left waiting when Settings closed.
- (23 November 2026, on the review of #288) A code confirmed while Settings is closed whose key then fails — refused, blocked, not kept — is said by a notification of its own, "AllDebrid could not be connected" with the reason, under the same rule as the notification of a connection.

Point 3 is amended: **Settings closing no longer ends the wait for a code that is shown.** A new code, a pasted key, Cancel and "Use an API key" still end it, as before.

How, the team's within the owner's decisions:

- **A code shown and waiting when Settings closes is left to the engine**, which asks the service about it at its pace, for as long as it works, as it does with Settings open. The page stops reading it. Its timer still does not keep the engine running.
- **A code still being asked for when Settings closes is forgotten**, as before: nobody has seen it, so nobody can confirm it. The page tells the engine at once, and again by name once the code arrives. So is a code shown that had already failed.
- **Settings opened again draws at once what it drew last**: the last list of services, kept also while the engine does not answer, and the code a row left waiting, while its time has not run out by the clock — the code, its page, and how long it has left, a minute at least. Nothing appears late and nothing moves. The row asks the engine at once what became of that code, then every two seconds: connected, it says whose account it is; failed, it says why and offers "Get a new code" — "This code is no longer valid" for one the engine no longer has. The page remembers only a code it left waiting itself.
- **The engine's events say which services are connected** (`connectedServices` in `Snapshot`, from `Integrations.connected()`; `Integrations.onChange` wakes the stream), **and the last confirmed code whose key connected nothing** (`codeConnectFailed`: the service, why — the service's refusal of the key or `KEY_NOT_KEPT` — and when). A code that expired unconfirmed, or whose wait was ended, is not one.
- **Main says both with a notification of the system** (`engine/connected-services.ts`), under the rules of a download that ends: only while the window is put away, minimised or not the window in use, which Windows is asked ([ADR 0020](./0020-the-window-in-use-asked-of-windows.md)). "AllDebrid is connected", and that links of file hosts and magnets now go through the account; "AllDebrid could not be connected", and why, with its remedy. A click opens the window. What main first heard of the engine is not said: a key read back at a start, a failure from before. A failure is told from the next by its moment, so the same refusal twice is said twice.
- **Main cannot tell whether Settings is open**: the page says nothing to main unasked (`apps/desktop/CLAUDE.md`). A confirmed code that fails with Settings open, while another window is in use, is said by the system as well as by Settings — the same rule as a connection, which the owner chose for every connection.
- **A person looking at the window** sees the account's button appear in the title bar: the page asks again whether AllDebrid is connected when the events say the services changed — a third moment beside the two of [ADR 0016](./0016-the-magnets-of-the-account.md), point 6.

Consequences, beside those above:

- A code left waiting is asked about every five seconds with Settings closed, for ten minutes at most, as it was with Settings open. Nothing else is asked.
- A code that expires unconfirmed is said by no notification: the person left it. Settings opened again within its time says it is no longer valid; after it, shows none.
- An engine started again has no code: Settings opened again says the code it left is no longer valid.
- A page that reloads forgets which code it left: Settings shows none, and the engine still waits for it and connects it when it is confirmed.

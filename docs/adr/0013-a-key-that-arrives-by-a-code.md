# ADR 0013 — The key of a service can also arrive by a code the person confirms on its site

- **Status**: accepted
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
3. **Only one code waits at a time.** Each of these ends the wait for the code before it: a new code, a pasted key, Cancel, and Settings closing. Each moves the wait on a turn, in the engine and in the page: a code the service gives after its wait was ended — while it was being asked for — is not kept, its request answers `409 CONFLICT`, and the page shows nothing of it and tells the engine to forget whatever it brought.
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

# ADR 0016 — The magnets of the account are read while their panel is open

- **Status**: accepted
- **Date**: 2026-11-21

## Context

[ADR 0014](./0014-magnets-through-a-service.md) has Scia watch the magnets pasted into it, and nothing else of the account. On 21 November 2026 the owner asked to see the magnets of the AllDebrid account in Scia, and decided how (#138):

- a side panel that folds away, there only while AllDebrid is connected, closed by default; the list of downloads stays the one main screen;
- it lists every magnet of the account, also those added on AllDebrid's site or by other applications, with where AllDebrid is with each.

The issue also asks that the account be asked only while the panel is open, at a pace far below AllDebrid's limits (12 requests a second, 600 a minute), and not at all while the window is hidden. It asks that a ready magnet added elsewhere can be downloaded as a pasted one is.

AllDebrid's documentation ("Get Status", read on 21 November 2026) answers every magnet of the account in one `POST /v4.1/magnet/status`, with when it was added (`uploadDate`). The same request offers a "live mode" (`session`, `counter`), which answers only what changed since the last answer of that session.

The issue asked that ADR 0014 gain these reads. An ADR is never rewritten, and this one decides what 0014 does not: a read of the whole account that the page asks for, and a magnet in Scia's list with no magnet link. So it is an ADR of its own, which 0014 stands beside.

## Decision

1. **The page asks, the engine answers.** `GET /magnets/account` (the app's token alone) asks AllDebrid once and answers each magnet of the account (`accountMagnetSchema` in `@scia/contracts`):
   - its id on AllDebrid, its name, where AllDebrid is with it (`fetching`, `ready`, `failed`);
   - what AllDebrid has of it and how fast, when it was added — a date no calendar holds is no date, and never makes the entry unreadable;
   - whether it is in Scia's list (`inScia`).
   - A magnet whose entry Scia cannot read is left out. The magnet link itself is in no answer, as in ADR 0014.
2. **Asked while the panel is shown, and only then.** The panel asks when it opens and every five seconds after (`ACCOUNT_POLL_MS`, in `apps/renderer`):
   - one request at a time, also across the ask a Settings closing makes: it waits for the one on its way, and only the newer answer is drawn;
   - none while the window is hidden (`document.visibilityState`); shown again, it asks at once only when the last answer is five seconds old, else when it will be;
   - nothing once it is closed;
   - after a refusal mended in Settings — the key refused, no service connected — nothing more until Settings closes, which makes it ask at once, or the panel opens again; one mended outside Scia — the key blocked until a sign-in is confirmed, the account banned or not premium, the network refused — keeps the pace, so that the next answer shows it mended.
   - The engine keeps nothing of these answers: it has no timer of its own for the account. ADR 0014's watch goes on asking about Scia's own magnets as before.
3. **A plain read, not the live mode.** One request answers the whole account, and the panel is open only while a person looks at it. The live mode would keep a session and a counter for each panel, for an answer of a few kilobytes every five seconds.
4. **A ready magnet of the account becomes a magnet of Scia's list.** `POST /magnets/account/:id` (digits only):
   - asks AllDebrid once where that magnet is, and refuses one the account does not have (`404`) or that is not ready (`409`);
   - refuses one already in Scia's list (`409`), checked after AllDebrid answered, so two presses at once take it once;
   - adds it to Scia's list with its id on AllDebrid and no magnet link (`magnet: null` in `state.json`). ADR 0014's watch then collects its files into the download folder / its name / its folders, as for a pasted one.
   - Nothing is sent to AllDebrid, which has the magnet already. Retry of one that failed asks about it again instead of sending it.
5. **One row of Scia's list for one magnet of the service.** A pasted magnet and a taken one are known by two names — the torrent's hash for the first, AllDebrid's id for the second — and AllDebrid gives the same id for a torrent it already holds. When it gives a sent magnet the id another row of the list already has, in whichever order they came, the sent one is let go: its files are downloaded once.
6. **No service connected** answers `409 SERVICE_NEEDED` on both routes, and an account that is not premium `422 NOT_PREMIUM`. The page offers the panel only while it last learned that AllDebrid is connected: when the engine is reached, and whenever Settings closes.

## Alternatives considered

- **The engine reads the account on a timer, and its stream of changes carries the list.** Rejected: every client of the stream would make the account be asked, also with the window hidden and the panel closed, which the issue rules out.
- **The live mode** (point 3). Not now: it saves bytes, not requests. It is the next step if an account's list becomes large (#150).
- **A ready magnet's files downloaded at once from the panel, without a magnet in Scia's list.** Rejected: the files would arrive with no row saying where AllDebrid is with them, and a failure, such as a file list Scia cannot read, would have nowhere to be said or tried again.
- **The panel over the list at a narrow window** (the product designer, #158). Rejected: a row cut off by it would run into it in the same tone, and it would need its own ways to close. The panel is beside the list at every width, which narrows; one press of its button gives the width back.
- **Deleting or restarting a magnet on AllDebrid from the panel.** Out of #138's scope; Remove in Scia frees nothing on AllDebrid (ADR 0014, point 5).

## Consequences

- With the panel open, the page asks AllDebrid about the account once every five seconds, and once more each time Settings closes; beside it, ADR 0014's watch asks once every five seconds while a magnet of Scia's waits. Both are far below AllDebrid's limits.
- A magnet of the account taken into Scia's list is a row of the main list until its files are downloads, like a pasted one.
- A magnet taken from the account a second time, after its files arrived, downloads them again under free names, as a pasted one does (#150).
- Untried against the real AllDebrid: the order and the dates it lists magnets with, and an account with many magnets. These are the owner's to try. A hidden window was tried in the real app started by Electron itself (playwright-core keeps a page `visible`): minimised or hidden, the page was `hidden` and asked nothing for twelve seconds, and asked once within two seconds of being shown.

## Amendment — learned also when the engine's events say the services changed (2026-11-23, #146, #286)

Point 6 is amended: the page also learns whether AllDebrid is connected **when the engine's events say the connected services changed** (`connectedServices`), beside when the engine is reached and whenever Settings closes. A code confirmed once Settings closed connects AllDebrid with nobody in Settings ([ADR 0013](./0013-a-key-that-arrives-by-a-code.md), amendment of #146), and the panel's button appears then.

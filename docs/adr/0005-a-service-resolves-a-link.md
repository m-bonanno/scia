# ADR 0005 — A debrid service plugs in as a link resolver, at the start of a download

- **Status**: accepted; its last consequence — a hoster's link with no service connected — amended by [ADR 0006](./0006-a-file-host-without-a-service.md); its consequence on a direct link that has expired, by [ADR 0022](./0022-a-direct-link-that-expires.md); a Bunkr link is read by Scia's own reader before any service is asked: [ADR 0024](./0024-a-bunkr-album-read-by-scia.md), point 6
- **Date**: 2026-11-20

## Context

A hoster's link is not the address of a file: fetched as it stands it gives the hoster's page. A debrid service the person has connected ([ADR 0004](./0004-the-key-of-a-service.md)) turns it into a direct link, which Scia then downloads as any other (#7; "Respect the hosts" in `CLAUDE.md`).

[ADR 0001](./0001-electron-and-a-local-engine.md) foresaw this as "a step that turns a hoster link into direct links before the queue, plus possibly a `RemoteSource` decorator that re-resolves an expired link". This ADR records where the step is now that it exists, and what it keeps.

## Decision

1. **A port, `LinkResolver`** (`apps/server/src/link-resolver.ts`): `serviceFor(url)` — the connected service that takes a link, or none — and `unlock(service, url)` — the direct link the service gives for it. `Integrations` is its adapter, over AllDebrid's client. A manager without a resolver fetches every link as it stands, which is how the downloader's own specs run.
2. **The step is at the start of each run of a download, not when a link is added.** Two hundred links pasted together would be two hundred requests to the service at once, and their direct links would age in the queue. A link is unlocked when its turn comes, at most as many at a time as downloads run.
3. **A download is known by the link that was added** (`url`). It also records the service it goes through (`via`, shown on its row) and the direct link the service gave (`unlockedUrl`, in `state.json`). The direct link is asked for once and used again after a pause or a restart: asking again can count against what the account is allowed of a host. It is never in an answer of the API and never in a log.
4. **After a failure the next attempt asks the service again.** A direct link does not last, and the person who presses "Retry" expects a new try, not the same dead address.
5. **A link is recognised by its host name**, against the domains the service lists for the account (`GET /v4.1/user/hosts`), read when first needed and again every six hours. **The last list read is kept between runs** (`alldebrid-hosts.json` in the engine's data), and a run in which the service does not answer goes by it — the owner's decision of 20 November 2026 (#7); after a reading that fails, the kept list is used a minute before the service is asked again, and it is forgotten when another account, or none, is connected. A reading belongs to the key it was asked with: an answer about a key that is no longer the one is nobody's list. A subdomain of a listed domain is that host's; a domain that only contains its name is not.
6. **While a connected service has never said which links are its own, no link is started on a guess**: the download fails with what the service said, and "Retry" asks again — a direct link too, whatever stopped the service from answering: a key it refuses, a network it does not serve, the service down. The alternative is to fetch a hoster's page and call it the file. With a kept list (point 5) this is the first run after connecting, and no other.
7. **A link that was a service's stays that service's.** It is never fetched as it stands — also once the service is disconnected: it fails saying so.
8. **The page a link was on is not said to the host a service sent Scia to.** The referrer is for the host of the link that was added.
9. **What the service calls the file is a name from a host**, as hostile as any (`fileNameFromHost`), and comes second to the name the direct link's own host gives.
10. **A service's refusals are reasons a download stopped**: codes of the domain (`ServiceFailure`, `UnlockFailure` in `@scia/core`), part of `DownloadFailure`, turned into words by the renderer. A code of the service that Scia does not know means the service cannot be asked right now — nothing is said of a link that the service did not say.
11. **A link the service is still preparing is waited for 30 minutes at most** — the owner's decision of 20 November 2026 (#7) — and then fails with a sentence that says so; "Retry" starts again. A pause or a removal ends the wait sooner.
12. **The direct link is a host like any other, and not always a right one.** In the runs against the real AllDebrid (#65) it answered ranges with **204 No Content**, and once answered the first byte with a **200 that carried only that byte** — most likely while the service was still fetching the file from its hoster; minutes later it answered everything, 32 ranges at once included, as a host should. `HttpSource` retries a 204 as it retries a busy host, and does not take a 200 that carries only the byte asked for the whole file: it asks the length again without a range, and downloads on one connection.

## Alternatives considered

- **Inside `RemoteSource`, as a decorator that unlocks in `probe`.** Rejected for this step: the manager has to know that a link went through a service — to say so on the row, to keep the direct link, to drop the referrer, to choose the name — and a decorator would hide exactly that. A decorator that unlocks again when a direct link expires in the middle of a download is the next item's to decide.
- **Unlocking when the link is added.** Rejected: point 2.
- **Recognising links with the regular expressions the service publishes for each host.** Rejected for now: they are written for another engine, and a pattern that comes from outside would run on the engine's one thread against whatever is pasted. The host name is coarser — a hoster's home page is taken for a file and refused by the service, in words — and cannot hang the engine.
- **Not keeping the direct link.** Rejected: every pause and every restart would ask the service again, against the account's allowance. A direct link opens one file for a while; the key of the account is what is kept sealed.
- **Falling back to the link as it stands when the service refuses it.** Rejected: the person would get the hoster's page saved under the file's name, and no word of why.

## Consequences

- With a service connected, a download waits for the service's list of hosts when the kept one is old; when the service does not answer, it goes by the kept list. Only the first run after connecting has none to go by: there, a service that cannot be asked fails every link, direct ones included (point 6).
- A request to unlock a link that got no answer in time is sent again, up to three times: the service may have carried out the first, and counted it against what the account is allowed of that host.
- A state written by a later version, naming a service this one does not know, is read with no service (`via` null): its link is then fetched as it stands, against point 7. It is the price of a state that always loads (`apps/server/CLAUDE.md`).
- A link that was downloaded on one connection because its host answered the first byte wrongly starts again from its first byte after a pause.
- A direct link that has expired when a paused download is resumed fails with what its host answers; "Retry" asks the service for another, and the bytes are kept only if the new link is the same file (same size, same validator). Asking again by itself, without losing the bytes, is the next item of the roadmap.
- Not handled: a link that unlocks into several files, a link that needs a password, a host that offers several qualities of a stream, a redirector, magnets. Each fails in words, or is a later item of the roadmap.
- A second service would make `Integrations` choose among several; the port already names the service in `unlock`.
- A hoster's link added while no service is connected is still fetched as it stands (#49).

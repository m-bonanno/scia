# ADR 0005 — A debrid service plugs in as a link resolver, at the start of a download

- **Status**: accepted
- **Date**: 2026-11-20

## Context

A hoster's link is not the address of a file: fetched as it stands it gives the hoster's page. A debrid service the person has connected ([ADR 0004](./0004-the-key-of-a-service.md)) turns it into a direct link, which Scia then downloads as any other (#7; "Respect the hosts" in `CLAUDE.md`).

[ADR 0001](./0001-electron-and-a-local-engine.md) foresaw this as "a step that turns a hoster link into direct links before the queue, plus possibly a `RemoteSource` decorator that re-resolves an expired link". This ADR records where the step is now that it exists, and what it keeps.

## Decision

1. **A port, `LinkResolver`** (`apps/server/src/link-resolver.ts`): `serviceFor(url)` — the connected service that takes a link, or none — and `unlock(service, url)` — the direct link the service gives for it. `Integrations` is its adapter, over AllDebrid's client. A manager without a resolver fetches every link as it stands, which is how the downloader's own specs run.
2. **The step is at the start of each run of a download, not when a link is added.** Two hundred links pasted together would be two hundred requests to the service at once, and their direct links would age in the queue. A link is unlocked when its turn comes, at most as many at a time as downloads run.
3. **A download is known by the link that was added** (`url`). It also records the service it goes through (`via`, shown on its row) and the direct link the service gave (`unlockedUrl`, in `state.json`). The direct link is asked for once and used again after a pause or a restart: asking again can count against what the account is allowed of a host. It is never in an answer of the API and never in a log.
4. **After a failure the next attempt asks the service again.** A direct link does not last, and the person who presses "Retry" expects a new try, not the same dead address.
5. **A link is recognised by its host name**, against the domains the service lists for the account (`GET /v4.1/user/hosts`), read when first needed and again every six hours; a list that cannot be read again is still the list. A subdomain of a listed domain is that host's; a domain that only contains its name is not.
6. **While a connected service cannot say which links are its own, no link is started on a guess**: the download fails with what the service said, and "Retry" asks again. The alternative is to fetch a hoster's page and call it the file.
7. **A link that was a service's stays that service's.** It is never fetched as it stands — also once the service is disconnected: it fails saying so.
8. **The page a link was on is not said to the host a service sent Scia to.** The referrer is for the host of the link that was added.
9. **What the service calls the file is a name from a host**, as hostile as any (`fileNameFromHost`), and comes second to the name the direct link's own host gives.
10. **A service's refusals are reasons a download stopped**: codes of the domain (`ServiceFailure`, `UnlockFailure` in `@scia/core`), part of `DownloadFailure`, turned into words by the renderer. A code of the service that Scia does not know means the service cannot be asked right now — nothing is said of a link that the service did not say.

## Alternatives considered

- **Inside `RemoteSource`, as a decorator that unlocks in `probe`.** Rejected for this step: the manager has to know that a link went through a service — to say so on the row, to keep the direct link, to drop the referrer, to choose the name — and a decorator would hide exactly that. A decorator that unlocks again when a direct link expires in the middle of a download is the next item's to decide.
- **Unlocking when the link is added.** Rejected: point 2.
- **Recognising links with the regular expressions the service publishes for each host.** Rejected for now: they are written for another engine, and a pattern that comes from outside would run on the engine's one thread against whatever is pasted. The host name is coarser — a hoster's home page is taken for a file and refused by the service, in words — and cannot hang the engine.
- **Not keeping the direct link.** Rejected: every pause and every restart would ask the service again, against the account's allowance. A direct link opens one file for a while; the key of the account is what is kept sealed.
- **Falling back to the link as it stands when the service refuses it.** Rejected: the person would get the hoster's page saved under the file's name, and no word of why.

## Consequences

- With a service connected, the first download of a run waits for the service's list of hosts, and fails if the service cannot be asked — a direct link too, since Scia cannot tell yet that it is one. The list is not kept between two runs.
- A direct link that has expired when a paused download is resumed fails with what its host answers; "Retry" asks the service for another, and the bytes are kept only if the new link is the same file (same size, same validator). Asking again by itself, without losing the bytes, is the next item of the roadmap.
- A link the service needs time to prepare is waited for as long as the service says it is preparing it; a pause or a removal ends the wait.
- Not handled: a link that unlocks into several files, a link that needs a password, a host that offers several qualities of a stream, a redirector, magnets. Each fails in words, or is a later item of the roadmap.
- A second service would make `Integrations` choose among several; the port already names the service in `unlock`.
- A hoster's link added while no service is connected is still fetched as it stands (#49).

# ADR 0022 — A direct link that expires is asked for again by the manager, keeping the bytes

- **Status**: accepted
- **Date**: 2026-11-23

## Context

A direct link a debrid service gives does not last ([ADR 0005](./0005-a-service-resolves-a-link.md), point 4). The link is kept and used again after a pause or a restart, so that the service is asked once; a long download, or one paused for long enough, outlives it. Until now its host's refusal failed the download, and "Retry" asked for a new link, keeping the bytes only if the new link was the same file. #7 asks for more: a link that expires during a long download is unlocked again without losing the bytes on the disk (#180).

ADR 0001 foresaw "a `RemoteSource` decorator that re-resolves an expired link"; ADR 0005 left to this item where the step goes. AllDebrid's documentation says neither how long a direct link lasts nor how its host answers once it has expired.

## Decision

1. **The manager asks again, not a decorator of `RemoteSource`.** The new link has to be kept in the record (`unlockedUrl`), and the new file compared with the one the bytes on the disk are of — what ADR 0005 already gives the manager for the first link (point 3, Alternatives). `DownloadManager.#runFile` runs a file's task; when the task fails because its link expired, the manager keeps its progress, asks the service again through the same step (`#address`), asks the new link's host what the file is, and runs a new task on it from the segments kept. A link kept from before the run — a pause, a restart — that answers as expired when it is first asked (`#locate`) is asked for again the same way.
2. **Expired is a 403 or a 410 from the host of a direct link a service gave** (`EXPIRED`), and only of such a link: a direct link pasted as it stands still fails at once on a 403, as every host does (`apps/server/CLAUDE.md`, "Retry what can heal"). The service is not asked what it thinks of the old link: it is simply asked for a new one, and its refusal then — the file gone from the hoster, an account no longer premium — fails the download in its words, as at the first unlock.
3. **Once for each link that brought bytes.** A link that expires after bytes came through it is asked for again; a link that is refused before its first byte — the new one included — fails the download with what its host answered. Each request can count against what the account is allowed of a host, and a service whose links are refused at once would otherwise be asked without end. "Retry" asks again, as before.
4. **The new link is checked to be the same file**, as any host's file is checked between two runs (`#adopt`): the same size, and the same validator where both answers carry one. A different file is a changed file, as it is today: the bytes on the disk are of another file, and the download starts again from the first byte of the new one.
5. **The log says that a link was asked for again** (`link_unlocked_again`, with the download's id) — never the link.

## Alternatives considered

- **A `RemoteSource` decorator that unlocks again inside `open`.** Rejected: it would hide from the manager the link it has to keep in the state, and a different file could not be started again from inside a task whose segments were planned for the old one. Its one advantage — the connections of a task going on without stopping — is worth less than a pause of a second at each expiry.
- **Asking the service again at every refusal of the direct link.** Rejected: point 3. A 404 or a 5xx of a direct link is not taken for an expiry either: the first says the file is not there, which a new link of the same service would most likely say too; the second heals by itself, and is retried as every host's.
- **Asking again on a timer, before the link expires.** Rejected: the service does not say how long a link lasts, and every request may count against the account.
- **Failing a different file instead of starting it again.** Rejected: "Retry" would start it again all the same, and that is what a changed file does today. The person loses the bytes either way; a failure would only add a press.

## Consequences

- A long download through a service goes on by itself after its link expires, with the bytes it had; the person sees a pause of the speed, and no failure.
- A different file behind the new link starts again from its first byte without a word on the row; the log says the link was asked for again.
- What a real AllDebrid host answers once a link has expired is not known: the specs hold the two statuses the issue names (#180). A host that answers otherwise — a 404, a page — fails the download as before, and "Retry" asks for a new link.
- A host whose two links of one file carry different validators (two servers of the service, each with its own ETag) is taken for a different file, and the download starts again.
- A download on one connection — a host that does not serve ranges — starts again from its first byte on the new link, as it does after any cut.

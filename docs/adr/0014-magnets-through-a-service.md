# ADR 0014 — A magnet goes to the connected service, and comes back as downloads in its folders

- **Status**: accepted
- **Date**: 2026-11-21

## Context

Scia is not a torrent client. A magnet arrives only through a debrid service that turns it into links ([`vision.md`](../product/vision.md)).

On 21 November 2026 the owner asked for this, and decided how it works (#137):

- a magnet pasted into Scia goes to AllDebrid at once, with nothing else to press;
- once AllDebrid has the files, Scia downloads all of them by itself, in a folder named after the magnet, with the magnet's sub-folders rebuilt — the way JDownloader rebuilds them from what AllDebrid gives.

AllDebrid's documentation (https://docs.alldebrid.com, "Magnet", read on 21 November 2026) describes three endpoints.

- `POST /v4/magnet/upload` takes `magnets[]` and answers each magnet on its own: its `id`, `name`, `size` and whether it is `ready`, or a refusal of its own.
- `POST /v4.1/magnet/status` answers where every magnet of the account is:
  - a `statusCode`: 0 to 3 while AllDebrid fetches the magnet, 4 when it is ready, 5 and above when it failed;
  - what AllDebrid has of it so far, and how fast it is fetching.
- `POST /v4/magnet/files` takes `id[]` and answers a ready magnet's files as a tree:
  - a folder is `{ n, e }`;
  - a file is `{ n, s, l }` — its name, size and link;
  - the link is one of AllDebrid's own (`alldebrid.com/f/…`), unlocked like any hoster's link.

The documentation says this tree "keeps the original magnet folder tree".

AllDebrid's help page on magnet folders (https://faq.alldebrid.com/en/tools/magnet-folder-structure/) says something more. When AllDebrid processes a magnet, some of its files may be packed into a `.rar` while others stay apart. JDownloader keeps the original folders by reading the magnet's "external download" link (`https://alldebrid.com/getMagnet/…`).

## Decision

1. **A magnet is not a download.** It is an entry of its own: `Snapshot.magnets` (`magnetSchema` in `@scia/contracts`), kept in `state.json` as `magnets`.
   - An older state loads with none.
   - A state whose magnets a later version cannot read loses its magnets, never its downloads.
   - The queue, the download task and the statuses of a download are untouched.
   - A magnet's entry says three things:
     - its name: the service's name for it, or the name the magnet carries, or its hash;
     - where it is: `sending`, `fetching` or `failed`;
     - what the service has of it, and how fast.
   - The magnet link itself crosses no answer of the API, and no log.
2. **The engine watches magnets at one pace** (`MagnetWatch`, `apps/server/src/magnet-watch.ts`), through a port, `MagnetService` (`magnet-service.ts`). `Integrations` is its adapter, with the key of the connected service.
   - Magnets pasted together are sent in one request.
   - While any magnet waits, one request every five seconds asks where all of them are. That is far below AllDebrid's limits of 12 requests a second and 600 a minute.
   - A magnet pasted while a turn runs is sent as soon as that turn ends, not a whole pace later.
   - Nothing is asked while no magnet waits, and nothing at all once the engine stops.
   - The service's id for a magnet is kept the moment the service gives it. So a restart goes on waiting for a magnet it had sent, and never sends that magnet again.
3. **A ready magnet becomes downloads.**
   - The trees of every magnet ready in a turn are read in one request to `/v4/magnet/files`, and each file becomes a download:
     - `via: alldebrid` is set from the start, so its link is unlocked through the service like any hoster's link, and is never fetched as it stands;
     - its folder is the download folder of the moment the magnet was pasted, then the magnet's name, then the folders the tree puts it in (`magnetFolders` in `@scia/core`);
     - when a file, not a folder, already stands under the magnet's name, the magnet's folder is the first free name beside it; a folder of that name is shared, as its files take free names inside it;
     - its name is the tree's (`nameKept`), not the one its link's host gives.
   - Every folder and file name is a name from a host: it goes through `sanitizeFileName`. So `..`, a slash, a drive or a device name cannot climb out of the magnet's folder or name anything else.
   - The magnet then leaves the list.
4. **Scia reads the tree of `/v4/magnet/files`, not `getMagnet`.** The tree is the API's own answer, documented, and carries each file's folders. `getMagnet` is a page of AllDebrid's site, made for JDownloader, with no documentation. A file that AllDebrid packed into an archive arrives as that archive; unpacking it is M4's.
   - The tree is held to bounds: 32 folders deep, 100,000 files at most, and every link an http address. A tree beyond them, or one Scia cannot read, fails its magnet `MAGNET_UNREADABLE`; an empty tree fails it `MAGNET_FAILED`.
5. **A magnet that cannot go anywhere says so.**
   - With no service connected, a magnet fails `SERVICE_NEEDED`, and its sentence names AllDebrid and where to connect it.
   - The service's refusals have codes of their own (`MagnetFailure` in `@scia/core`):
     - a magnet it does not take (`MAGNET_INVALID`);
     - too many magnets for the account (`MAGNET_LIMIT`);
     - too large (`MAGNET_TOO_LARGE`);
     - one it could not fetch, or no longer has (`MAGNET_FAILED`) — also each end the documentation lists for a magnet it took and could not finish: not started in 20 minutes, more than 72 hours, removed from the hoster, processing or upload failed, an internal error;
     - one whose files it lists in a way Scia cannot read (`MAGNET_UNREADABLE`).
   - It also takes the refusals a key or a network meets, as a link does.
   - A service that cannot be asked for a moment does not fail a magnet: the row says Scia could not ask, and the next turn asks again.
   - A code Scia does not know, said of one magnet — at its upload or of its files — fails that magnet `SERVICE_UNAVAILABLE`, and so does a magnet the service leaves out of its answer, or whose state it writes in a way Scia cannot read: an answer Scia does not understand would be asked again for ever.
   - Retry sends a failed magnet again. Remove stops Scia waiting for it; the service keeps it, as it keeps anything the account added elsewhere.
6. **The routes are for the app's token alone** (ADR 0002): `POST /magnets` with `{ magnets }`, `POST /magnets/:id/retry` and `DELETE /magnets/:id`.
   - The page finds magnets in what is pasted or typed (`extractMagnets` in `@scia/contracts/links`).
   - What main reads on the clipboard is unchanged: #139 is to change that.

## Alternatives considered

- **A magnet as a download record.** Rejected: it would add a status the queue must skip, a row with no part file, and a pause that means nothing. Its files are the downloads.
- **The magnet's `getMagnet` link, read as JDownloader reads it.** Rejected for point 4.
- **Asking about each magnet by its id.** Rejected: one request for all of them is one request however many are pasted.
- **Deleting the magnet on AllDebrid when its files are downloaded, or when it is removed.** Not now (#137, "Out of scope"): the account's magnets are the person's. The side panel of #138 lists them.

## Consequences

- With a magnet waiting, Scia asks AllDebrid about the account's magnets every five seconds. The answer lists every magnet of the account; Scia keeps only its own.
- A magnet that AllDebrid has already fetched is ready at once: its files are downloads within one turn.
- A magnet's files are as many downloads as it has files, queued like any others under the limit of downloads at once.
- A magnet pasted again while it is in the list is not added twice. One whose files are already downloads is sent again: the service has it, and its files arrive again under free names beside the ones already there.
- The real service is the owner's to try: the simulated one (`apps/server/src/testing/alldebrid-server.ts`) answers as the documentation says. Two things are unproven against AllDebrid itself: that its `alldebrid.com/f/…` links unlock as the documentation's integrations say they do, and that a file it packed into an archive is listed as that archive.

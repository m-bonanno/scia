# ADR 0024 — A Bunkr album is read by a reader of Scia's own, and its files go into a folder of its own

- **Status**: accepted
- **Date**: 2026-11-23

## Context

Bunkr is a host of files that anyone can open: an album (`https://bunkr.cr/a/<id>`) is a page that lists files, each behind a page of its own (`/f/<slug>`). The owner asked, on 22 November 2026, that an album link pasted into Scia download every file of the album into a folder named after it, as a magnet's files go into a folder of their own ([ADR 0014](./0014-magnets-through-a-service.md)) (#228).

Scia reads pages with yt-dlp only ([ADR 0009](./0009-the-video-of-a-page.md)), one video per page; yt-dlp does not read a Bunkr album as a list. The owner decided on 23 November 2026, on #228:

- the issue is in the gate of `v1.0.0`;
- **the reader is Scia's own**: a small reader of Bunkr's album and file pages, written for that host, with its domains kept as data in one list. No second program is shipped. When Bunkr changes its pages, Scia is updated;
- undoing the XOR Bunkr puts on the link its API answers is within "Respect the hosts" (point 4).

#214 (the files of one paste as one row that expands) is still open: here, as for a magnet, the album's files are separate downloads in the album's folder.

### What Bunkr's pages are, and where that was learned

Nothing here was read from Bunkr itself: no request was made to it to learn its pages. (During the fixes of round 1, a mutant took away the local address of Bunkr's API, and the specs that ran under it may have posted made-up ids to the real `apidl.bunkr.ru` from the owner's machine before the run was stopped. The run kept no output that says whether a request left the machine, and nothing the API may have answered was read.) What Scia reads is what gallery-dl's reader of Bunkr reads, in its public source (`gallery_dl/extractor/bunkr.py`, `lolisafe.py` and `decrypt_xor` in `util.py`, https://github.com/mikf/gallery-dl, branch `master`, last changed on 19 February 2026, read on 23 November 2026). yt-dlp's repository has no reader of Bunkr on `master` the same day.

- **The album page**, `https://<domain>/a/<id>?advanced=1`: its title in `<meta property="og:title" content="…">`, escaped twice as HTML (gallery-dl unescapes it twice); its files in a script, `window.albumFiles = [ … ]`, one object per file with one field a line — `id: …,`, `name: "…",` (the stored name), `original: "…",` (the name it was uploaded with, a JSON string in which `\'` stands for `'`), `slug: "…",`, `size: …`.
- **A file page**, `https://<domain>/f/<slug>` (gallery-dl also takes `/v/`, `/i/`, `/d/`): its file's id in `data-file-id="…"`, its name in the first `<h1>`.
- **The file's link** is asked of Bunkr's API: `POST https://apidl.bunkr.ru/api/_001_v2` with `{"id": "<id>"}`, sent with `Referer: https://get.bunkrr.su/file/<id>` and `Origin: https://get.bunkrr.su` — the page of Bunkr's that offers the file's download. It answers `{ "encrypted": true, "timestamp": <seconds>, "url": "<base64>" }`: the address, each byte XOR'd with the bytes of `SECRET_KEY_<timestamp ÷ 3600, rounded down>`, in base64 — or `{ "encrypted": false, "url": "<address>" }`. A 400 from the API is gallery-dl's sign of an album deleted. The file is fetched with the same `Referer`.
- **A file server in maintenance** redirects the file's link to `/maint.mp4` or `/maintenance-vid.mp4`.
- **The domains** Bunkr has used: `bunkr.ac`, `.ci`, `.cr`, `.fi`, `.ph`, `.pk`, `.ps`, `.si`, `.sk`, `.ws`, `.black`, `.red`, `.media`, `.site`, and those gallery-dl calls old: `bunkr.ax`, `.cat`, `.ru`, `.su`, `.la`, `.is`, `.to`, `bunkrr.ru`, `bunkrr.su`; each also under `app.`.
- **A Cloudflare challenge** answers 403; gallery-dl then tries another of Bunkr's domains at random.

## Decision

1. **A Bunkr link is told by its host and the shape of its path, never by a name somewhere in the address.** Its host is one of the domains of `BUNKR_DOMAINS` (`apps/server/src/bunkr-pages.ts`, the one list: gallery-dl's, old ones included), or that domain under `app.`; its path is `/a/<id>` — an album — or `/f/`, `/v/`, `/i/`, `/d/` and a slug — a file. Any other link of those hosts is fetched as it stands, as before. When Bunkr moves to a new domain, the list gains it in a release of Scia.
2. **An album becomes downloads at the start of its run** (`DownloadManager.#openAlbum`, the reader `Bunkr` in `apps/server/src/bunkr.ts`). The album's link is added as any link, and is a row while its page is read; once read, the row leaves the list and its files take its place in the queue, in the album's order, each queued:
   - each file is a download of its own page (`https://<the album's host>/f/<slug>`, the slug written into the address with `encodeURIComponent`) — resumable, under the speed limit and the connections of Settings, paused and removed one by one. A slug the address parser makes into another path (`.` and `..`: `/f/..` is `/`) makes the album `ALBUM_UNREADABLE`: its row would leave Bunkr's road, be asked of a service and save a page as the file;
   - **in a folder named after the album**: the download folder the album was added with, then the album's title through `sanitizeFileName`, or the album's id when it has none. When a file, not a folder, stands under that name, the folder is the first free name beside it; a folder of that name is shared, and the files take free names inside it — ADR 0014's rule for a magnet;
   - **each file named as the album names it** (`original`, else `name`), through `fileNameFromHost` — a name from a host: no path, no `..`, no device name climbs out of the folder — and kept (`nameKept`), made free against the folder and the downloads on their way there when the file starts (`isNameTaken`, its working names reserved).
     The log says how many files an album gave, never the album.
3. **A file of Bunkr is read again at every run** (`DownloadManager.#locate`, before any service is asked): its page for its id, then the API for its link, which is fetched with the `Referer` of Bunkr's page of the file. Nothing of it is kept in `state.json`: after a pause, a restart or a failure, the page and the API are asked again — two small requests to Bunkr each time — and the bytes kept go on when the host says the file is the same (size and validator, `#adopt`). A file link pasted by itself takes the same road and is named after its page's `<h1>`, through `fileNameFromHost`.
4. **What is fetched, and what is not** ("Respect the hosts"):
   - only what Bunkr's pages give anyone, with no account: there is no cookie, no login, no key;
   - the address the API gives is undone of its XOR with the key the same answer dates — **within "Respect the hosts", the owner's decision of 23 November 2026, on #228**. Bunkr's own download page does the same in every visitor's browser before the download starts, with no account, payment, region or check behind it: it is no access control, and the file is the public file the page offers. A file the page does not offer is not asked for;
   - **a refusal is final**: a 4xx — Cloudflare's 403 challenge among them — is not solved, waited out or tried on another domain: the row says so, and "Retry" is the person's;
   - **what can heal is asked again, as the engine's rule says** ("Retry what can heal", `apps/server/CLAUDE.md`): a 5xx, a 429, a dropped connection and no answer in time, three times more at most, after a wait of 1, 2 and 4 s — or the site's own `Retry-After` (seconds or a date) when it asks longer. A site that asks for more than a minute is not asked again: the row says it is busy. That works around nothing: it waits for what the host asks;
   - Scia's own user agent, the one of its downloads, never a browser's;
   - pages are read with a bound: 16 MB for an album page, 2 MB for a file page, 64 KB for the API's answer, 30 s for each request; a redirect is followed five times at most, and only to a host of the list (a file page, an album page) — the API's redirect is not followed;
   - **pages are read in time that grows with their length, never with its square**: no regular expression that backtracks reads what a host wrote (a field is read by its first `:`, a heading's attributes cannot pass a `<`). The engine has one thread: a page that made a reader backtrack would stop every download and the API while it ran;
   - the files themselves go through the one speed limit and the connections of Settings, as every download.
5. **What fails, and with which code** (`AlbumFailure` in `@scia/core`, one sentence each in the row, true of an album and of a file page alike):
   - the page or the API says the album or file is not there (404, 410, the API's 400 — read as gallery-dl reads it, not seen from Bunkr): `ALBUM_GONE`;
   - it refuses Scia (401, 403): `ALBUM_REFUSED`;
   - a page or an answer Scia cannot read — no list of files; a list not written one field a line (every file on one line, a field twice in one file, a line that is no field); a file with no slug, or a slug that is no path of its own; a file page with no id; an answer that is not JSON, or whose address is not http(s); a page past its bound; a redirect off the list, or a sixth one: `ALBUM_UNREADABLE`;
   - an album with no file: `ALBUM_EMPTY`;
   - a site still busy after its last retry — 5xx, 429, no answer in 30 s — or one that asks for a wait longer than a minute, or a file server in maintenance (a link that lands on `maint.mp4` or `maintenance-vid.mp4`): `PAGE_SITE_BUSY`, as a page's site ([ADR 0009](./0009-the-video-of-a-page.md));
   - a host that cannot be reached after the last retry: `NETWORK`; another status of the pages or the API: `HTTP_STATUS` with it;
   - **the link the API gave stops working** — refused for good at its probe or partway (a 4xx, with its status), or a web page where the file was (with none): `ALBUM_LINK_FAILED`. A busy file server (a 5xx, a 429, a 408, a 425, a 204: what can heal) and one that stopped serving ranges (a 200) are no dead link: their rows say what they say of any link (`HTTP_STATUS` with the status). The row says that the link the site gave no longer works, and that "Retry" asks the site for a new one, which goes on from the bytes kept. Never a page saved as the file, and never the sentence of a link the person pasted.
6. **A connected service is not asked about a Bunkr link, and neither is AllDebrid's public list.** AllDebrid's public list of hosts, read with no key on 23 November 2026 (`GET /v4/hosts/domains`: 108 under `hosts`, 2,055 under `streams`, 44 under `redirectors`), has none of Bunkr's domains — `crowdbunker.com`, a site of videos, is the one name near it. An album is a list, which no service unlocks, and a file of Bunkr is public, which a service would only count against the account. So Bunkr's reader decides before `LinkResolver` ([ADR 0005](./0005-a-service-resolves-a-link.md)) and before [ADR 0006](./0006-a-file-host-without-a-service.md)'s list: a Bunkr link never fails `SERVICE_NEEDED`, and is never sent to a service — also if AllDebrid lists Bunkr one day. The address the API gives is fetched as it stands.

## Alternatives considered

- **gallery-dl, shipped beside yt-dlp** as a second reader: it knows many such hosts. Not chosen by the owner: a second program to ship, pin by checksum and keep up to date ([ADR 0011](./0011-yt-dlp-kept-up-to-date.md)) for one host.
- **Keeping each file's link from the API in `state.json`**, as a service's link is kept (ADR 0005): one request fewer at a resume, a field more in the state, and a link that may have expired by then. Bunkr counts nothing against an account, so the page and the API are asked again (point 3).
- **Each file downloaded from the link the API gives, read once with the album**: no request per file at its start, but nothing to ask again when the link no longer works — and a file pasted by itself would need a road of its own.
- **Another domain tried at a 403**, as gallery-dl does: working around a check the host put there.
- **An album as an entry of its own, like a magnet**: a new kind of row, new routes and a new part of `state.json` for something that lasts one reading. The row of #214 is the place for the album as a whole.

## Consequences

- Pasting an album makes one request to Bunkr for its page, then two for each file when it starts — its page and the API — before its bytes.
- An album added before a restart is read at the next start, as a queued download; its files, once there, are ordinary downloads in `state.json`.
- What Scia reads of Bunkr is held by specs against a local host that answers as gallery-dl's source says Bunkr does (`testing/bunkr-server.ts`), and by the E2E suite on the built app pointed at that host: `--bunkr=<address>`, an address on this computer only (`SCIA_BUNKR`; the engine does not start with any other), which reads Bunkr's links at that host's name and its API at the same path there. It is **not held against Bunkr itself**: no run against the real site has been made (#266). When Bunkr changes its pages, the rows say `ALBUM_UNREADABLE`, and a release of Scia follows.
- A file whose link expires partway is not asked again on the way, as a service's link is (ADR 0022): the download fails `ALBUM_LINK_FAILED`, and "Retry" reads the page and the API again, keeping the bytes when the host says the file is the same.
- A Bunkr link copied to the clipboard is still put to `LinkResolver.serviceFor` by the offer of a copied link, unless the last name of its path is a file's ([ADR 0012](./0012-links-taken-from-the-clipboard.md)): a list of hosts is looked at — read first, when none is in hand — and nothing of the link is sent. Point 6 holds for a download, not for that look.
- An old domain is read at itself, not at a current one as gallery-dl reads it: a domain that no longer answers fails `NETWORK`.
- A pause, a removal or a shutdown while an album's page is read stops the read, and adds no file; the album is read again when it is resumed or at the next start.
- An album link copied to the clipboard is not offered ([ADR 0012](./0012-links-taken-from-the-clipboard.md)): `offeredAs` knows files and videos' pages, not lists.
- #214 makes the album one row.

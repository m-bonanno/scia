# ADR 0025 — A link that opens into several files waits in the list for the person to choose its files

- **Status**: accepted
- **Date**: 2026-11-23

## Context

#7 asks that a link that unlocks into several files show its list before anything is downloaded (#181). The owner decided on 21 November 2026 how the list is shown: a list to tick, every file ticked; the person unticks what they do not want, and starts.

AllDebrid's documentation (https://docs.alldebrid.com, read on 23 November 2026) has no such answer where #181 looked for it:

- `POST /v4/link/unlock` always answers one link. Its `streams` are other qualities of one video, not other files.
- Several links come back only from `POST /v4/link/redirector`, "to retrieve links protected by a redirector or link protector". It takes `link` and answers `links`: encrypted `redirect.alldebrid.com` links, which "only work with `/link/unlock` and `/link/infos`". It gives no name or size; its refusals are `REDIRECTOR_NOT_SUPPORTED` and `REDIRECTOR_ERROR`.
- `POST /v4/link/infos` takes `link[]` and answers each link on its own, in `infos`: its `filename` and `size`, or an `error` of its own. The documentation gives no limit on how many.
- The sites the redirector opens are listed to anyone, under `redirectors` of `GET /v4/hosts/domains`: 44 entries that day. Among them are file hosts that are also under `hosts` — 1fichier, mega, mediafire, rapidgator, turbobit, uploaded — protectors of links such as filecrypt.cc and the dl-protect domains, and shorteners such as bit.ly and adf.ly. `/v4.1/user/hosts`, which Scia reads for the account, has not listed them since January 2025.

So a file host's folder is most likely opened by the redirector. The documentation never says it, and nobody has seen how the real service answers a folder. The owner decided the rest on 23 November 2026, as three questions (#181).

## Decision

1. **Which links: a file host's folder, and the links of the protectors and shorteners the redirector opens.** The owner chose this knowing that a protector puts a captcha in front of its links, which AllDebrid gets past on its own servers. Under "Respect the hosts" that is the service's doing, as a hoster's wait is (#7): Scia sends the link it was given, and downloads the links the service gives back.

2. **Scia knows such a link by data it keeps, in one list** (`BUNDLE_SITES`, `apps/server/src/bundle-links.ts`): never by asking AllDebrid first about every link.
   - A file host's folder is known by its domain, or its `www.`, and the beginning of its path, as each host writes its folders: `1fichier.com/dir/`, `mega.nz/folder/`, `mediafire.com/folder/`, `rapidgator.net/folder/`, `turbobit.net/download/folder/`, `uploaded.net/f/`.
   - A protector's or a shortener's domain is taken whole.
   - The list is drawn from `redirectors` as read that day. Left out: a site that lists one file on several hosts (multiup.org, whose links would be offered as several files when they are one); sites of pages of links; and names that are no site of their own (google.com, example.com).

3. **A folder with no service connected needs one.** It is the link of a file host, like any other (ADR 0006): its row fails `SERVICE_NEEDED`. A protector's or a shortener's link with no service connected is fetched as it stands, as it was before this decision, since ADR 0006 keeps `redirectors` out. A manager with no resolver fetches every link as it stands.

4. **Such a link is not a download.** It is an entry of its own (`Snapshot.bundles`, `bundleSchema` in `@scia/contracts`), kept in `state.json` as `bundles` (an older state loads with none), as a magnet is (ADR 0014).
   - `POST /downloads` takes it, from the page and from the extension alike, and answers the downloads it added alone.
   - The entry says its name, where it is (`opening`, `choosing` or `failed`), the files the service listed (each a name and a size), and how many it could say nothing of.
   - The link and the service's links to its files are in no answer of the API and no log. The page names a file by its place in the list.

5. **It is opened at once, one link at a time.** The redirector is asked for its links, then the infos of those links, a hundred to a request.
   - A link given twice is one file.
   - A file the service says nothing of — an `error` in its infos, a link that is not an http address — is counted (`unavailable`), not listed.
   - Nothing listed is `BUNDLE_EMPTY`. More than 1,000 files (`LINK_FILES_AT_MOST`) is `BUNDLE_TOO_MANY`, and their infos are not asked.
   - The redirector's two refusals, and any other refusal of a link, are `BUNDLE_REFUSED`.
   - The refusals of a key, a network or an account are said as for any link. A service that cannot be asked is asked again a few times, then the row fails `SERVICE_UNAVAILABLE`.
   - Retry asks again. A restart asks again about a link that was being opened, and keeps the files of one that waits for a choice without asking.

6. **The person chooses on its row** (`BundleRow` in the renderer): every file is ticked, beside "All files", and "Download N files" sends the places of the files left ticked (`POST /bundles/:id/start`, `{ files }`).
   - The chosen files become downloads through the service (`via: alldebrid`), each under the name the service gave it, passed through `fileNameFromHost`.
   - They go into a folder named after the link. The service names neither the folder nor the link, so the name is the last part of the link's path, as the link writes it, without the extension of a page (`.html`), else the link's host — through `sanitizeFileName` (`bundleName`). When a file of that name stands there, the folder is the first free name beside it, as a magnet's is.
   - The link then leaves the list.
   - A link that opens into one file, with nothing it could not get, is downloaded at once into the download folder, with no list and no folder, as a magnet of one file is (#150).

7. **The routes are for the app's token alone** (ADR 0002): `POST /bundles/:id/start` (`400` for no file or one it does not list, `409` for a link that is not waiting for a choice), `POST /bundles/:id/retry`, `DELETE /bundles/:id`. Remove stops a question on its way.

8. **The step is beside `LinkResolver.unlock`** (ADR 0005): the port gains `open(service, url)` and `hasService()`, and `Integrations` is their adapter over `AllDebrid.openLink`.

9. **A link copied to the clipboard that opens into several files is left out** of the links taken from it: the service would be asked about a copy, which ADR 0012 never does for a link.

## Alternatives considered

- **All the files at once into a folder of their own, as a magnet's** — the other answer of #181's question. Not chosen by the owner.
- **The list shown at the paste, before a row exists.** Not chosen by the owner: a row of its own waits for the choice, and survives a restart.
- **The service's regular expressions** (from `/v4/hosts`). Rejected for ADR 0005's reason: a pattern from outside would run on the engine's one thread against whatever is pasted.
- **Asking the redirector first about every link of a domain it lists.** Rejected by the owner: one more request for every file link of 1fichier, mega or rapidgator, and an answer to a file link that the documentation does not give.
- **Folder names from the infos.** They name files, not the folder; and the redirector names nothing.

## Consequences

- **The service is simulated from its documentation, and the real service's answer to a folder is not seen.** `testing/alldebrid-server.ts` answers `/v4/link/redirector` and `/v4/link/infos` as the documentation's examples do. Whether AllDebrid opens a 1fichier or mega folder through its redirector, what it answers for a folder it cannot open, and whether the infos of an encrypted link carry a name, are the owner's to see with a real key (#7).
- A path shape a host changes, or a folder whose address Scia does not know, is unlocked as one link and fails in AllDebrid's words, as before this decision. The list is data: a PR adds a shape.
- A shortener's link that leads to a direct file, with a service connected, goes through the redirector. If the service does not open it, its row fails `BUNDLE_REFUSED`, where before it downloaded as it stands; Remove, and the link pasted again with no service connected, are the way around.
- A file that turns out not to be there when it is unlocked fails on its own row as any service's link does.
- A folder of more than 1,000 files is refused whole; a person who wants it pastes its parts.
- Scia sends AllDebrid each such link with the key of the account, and then the links the redirector gave back to ask their infos — "It collects nothing" in `vision.md` says so.

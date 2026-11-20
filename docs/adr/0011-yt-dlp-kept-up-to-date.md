# ADR 0011 — yt-dlp kept up to date by the engine, from its signed releases

- **Status**: accepted
- **Date**: 2026-11-20

## Context

Scia ships yt-dlp, fixed by version and checksum, to read the page of a video ([ADR 0009](./0009-the-video-of-a-page.md)). Sites change faster than Scia is released: a reader of a site that yt-dlp mends in a week stays broken in Scia until the next release of Scia, and until the person installs it. #89 asked for the shipped yt-dlp to be brought up to date by Scia itself, at most once a day, from yt-dlp's own releases, checked against the checksums they publish (the owner, 20 November 2026). This is its fourth piece, #100.

What a release of yt-dlp carries, read on 20 November 2026 in its release `2026.10.26`: a build for each system (`yt-dlp.exe`, 23.6 MB; `yt-dlp_linux`, 41 MB), `SHA2-256SUMS` — one line `<sha256>  <name>` per file — and `SHA2-256SUMS.sig`, a detached OpenPGP signature of those sums made with an RSA key of 4096 bits and SHA-512, by the key yt-dlp publishes as `public.key` in its repository (fingerprint `AC0CBBE6848D6A873464AF4E57CF65933B5A7581`, "yt-dlp signing key"). The signature of each of its twelve latest releases, this one included, was made on the day the release is named after, or the day after. yt-dlp's own updater (`yt-dlp -U`) checks the checksums and not the signature. Its `_update_spec` holds builds back on Windows 7 and 8 and on old Pythons, none of which Scia runs on: Electron needs Windows 10.

The owner decided, on 20 November 2026, on #100:

1. **The engine owns it**, not main.
2. **The new build lives under the profile**; the shipped one is never changed.
3. **A check once the engine has started and every 24 hours, at most once a day across restarts; an hour later after a check that failed. The build is downloaded only while no download runs or waits, and given up when one starts.** A read under way finishes with its build; the next one uses the new one.
4. **The signature is checked too**, not only the checksums.
5. **Nothing is shown**, and there is no switch.

## Decision

1. **The engine owns the update** (`YtDlpUpdates`, `apps/server/src/yt-dlp-updates.ts`). It runs yt-dlp and knows when a page is being read, so a new build is taken between two reads without a channel to main and without restarting anything: `YtDlp` asks for the program at each read (`command` is a function), and a read under way keeps the one it started. It also knows when a download runs or waits (`DownloadManager.isBusy`, `onBusyChange`), without main.
2. **Main says what it shipped.** The version, each system's build name in a release and its checksum are written in one place, `YT_DLP_OF_PLATFORM` and `YT_DLP_VERSION` in `apps/desktop/src/engine/runtime-layout.ts`, which `scripts/fetch-tools.ts` fetches by. Main hands the engine the path, the version and the build's name (`SCIA_YT_DLP`, `SCIA_YT_DLP_VERSION`, `SCIA_YT_DLP_ASSET`). An engine told no version — plain Node, `npm run dev` — never updates.
3. **Where the builds are.** A build taken is kept in `<profile>/engine/yt-dlp/<version>/` beside `state.json`, which holds when the last check ended and which build was taken with its sha256. The shipped build in `resources/tools/` is never written to: it is used while no newer build is kept, and again when an update of Scia ships a yt-dlp as new as the one kept or newer, which is then removed. At every start the engine reads the kept build's bytes against the sha256 it kept, and goes back to the shipped one when they differ; it removes whatever else is in the folder — an older build, the part of a fetch that never ended. A build that a read may still be running is never removed under it: on Windows a running program cannot be deleted, so the build before the last update goes at the next start.
4. **Where the releases are read**: `https://github.com/yt-dlp/yt-dlp`, its public pages and files, not GitHub's API and its limit of requests. The latest release is where `/releases/latest` redirects (`/releases/tag/<tag>`), read without following the redirect; a name that is not a release of yt-dlp — its date, and a number for a second release that day — is refused. Its files come from `/releases/download/<tag>/<name>`, which github.com redirects to the host of its files. The address is replaced only by one on this computer (`SCIA_YT_DLP_RELEASES`, from main's `--yt-dlp-releases=`), for the specs and the runs: the engine does not start with any other, as with AllDebrid.
5. **When.** The first check comes once the engine listens — nothing in its start waits on it — when the last one is a day old or more, or at once the first time; then a day after each check that ended. A check that could not reach the releases, or a file of them, is tried again an hour later and not written as a check. The time of the last check is the system's clock, kept between runs; a last check the clock puts in the future does not hold a check back.
6. **What a build must be before it is used** — the order is the order of the checks, and the first that fails ends it:
   - the release is newer than the build in use;
   - `SHA2-256SUMS.sig` is a good signature of `SHA2-256SUMS` by yt-dlp's key, which Scia carries (`yt-dlp-signing-key.ts`) and reads by its fingerprint: an OpenPGP signature of version 4 of a binary document, made with RSA and SHA-256, -384 or -512, which says when it was made and carries no condition marked critical that Scia does not read. It is read with `node:crypto` (`openpgp.ts`); no library is added;
   - the signature was made no earlier than the day the release is named after: the sums of an older release, signed when it was, are not taken under a newer name;
   - the sums list this system's build once;
   - the build's bytes, fetched whole, have that sha256.

   Then it is renamed into place from its part file, executable on Linux, `state.json` is written, and only then do the reads after it use it. A refusal — a signature, a date, a build not listed, a checksum — is final for that release until the next day's check: the build is not fetched again every hour.

7. **The build is fetched only while no download of the person's runs or waits.** With one running, the engine waits until none does; a download that starts while the build is coming ends that fetch, its part removed, and the build is fetched again whole once none runs. It is fetched outside the speed limit, as an update of Scia is (ADR 0007): it is never fetched beside a download of the person's. The sums and their signature, a few kilobytes, are read before the wait.
8. **Bounds.** A host silent for 30 s is given up; the sums may be 1 MB, the signature 64 KB, a build 512 MB. What was fetched is never read as anything but bytes to hash and, once it matches, a program to run.
9. **Nothing is shown, and nothing can be turned off** (the owner's decision 5). The log says the build in use at every start (`yt_dlp_in_use`), each check (`yt_dlp_checked`), each update (`yt_dlp_updated`), a refusal and its reason (`yt_dlp_refused`), and a check that failed (`yt_dlp_check_failed`).

## Alternatives considered

- **Main owns it**, beside Scia's own updater: main already hears whether the engine is idle, but the engine would have to be told of every new build — a new channel, or a restart of the engine and of whatever it was downloading.
- **Checksums alone** (as #100 was written, and as `yt-dlp -U` does): the sums come from the same release, over the same connection, as the build. They prove the build arrived whole; they prove nothing of who published it. Whoever could publish a release of yt-dlp would have a program run on every Scia within a day. The signature needs that person to hold yt-dlp's key too.
- **openpgp.js, or gpg**: openpgp.js is a dependency of hundreds of kilobytes for one signature of one kind, under the LGPL; gpg is not on Windows. The part of OpenPGP a signature of yt-dlp uses is a hundred lines over `node:crypto`, held by a spec that reads a real release of yt-dlp.
- **`yt-dlp -U`**: it would write beside the executable (`resources/tools/`, which an update of Scia replaces, and which may not be writable), check no signature, follow no speed rule of Scia's, and be a black box to the engine.
- **Run the new build once (`--version`) before using it**: it would show that the build starts, at the cost of a start (2 to 5 s, and 30 MB unpacked) per update. A build signed by yt-dlp and whole is the build yt-dlp released for this system; the signature's date already refuses an older release under a newer name.
- **A line in Settings with the version, or a switch**: not chosen (the owner's decision 5). An out-of-date yt-dlp is what breaks sites; turning the update off helps no one.

## Consequences

- **Scia speaks to GitHub for yt-dlp too**: once a day, `github.com/yt-dlp/yt-dlp/releases/latest`; when a newer release is out, its sums and signature, and its build from GitHub's host of release files — about 24 MB on Windows, once per release of yt-dlp, every few weeks. GitHub sees the computer's address and Scia's user agent (`Scia/<version>`); nothing of the person's is sent. The README and `docs/product/vision.md` say so.
- **Trust moves from the release of Scia to yt-dlp's key.** Until now a person ran the yt-dlp the owner fixed in a release of Scia. Now they run any build yt-dlp's key signs, a day after it is released, without a release of Scia between. A build yt-dlp signs and that breaks pages breaks them in Scia the next day; the next release of yt-dlp mends it in the same way.
- **A new key of yt-dlp's stops the updates**, quietly, at a `signature` refusal in the log: the build in use goes on reading pages, and a release of Scia carries the new key. Scia does not follow a key the signature does not vouch for.
- **A build taken is not marked as coming from the network** (ADR 0003 marks what the person downloads), as an update of Scia is not: Scia fetched and checked it itself.
- **The disk holds two builds for a while**: the shipped one, and the one taken — 24 MB on Windows, three at most until the next start after a second update in one run.
- **The E2E suite and every run of the real app name a local host of releases** (`--yt-dlp-releases=`), as they name a simulated AllDebrid: no spec reaches GitHub. CI's E2E job fetches the shipped yt-dlp, which a spec publishes again from such a host under a newer name, with the real sums and signature of its release.
- **Linux**: the build taken is `yt-dlp_linux`, made executable; untried, like everything on Linux (#13).

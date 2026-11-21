# Scia — vision

Scia is a download manager for people who want to paste a link and forget about it.

## Who it is for

People who download big files, or many: ISO images, videos, archives, programs. Today they use the browser (slow, fragile) or tools that are powerful but heavy and full of options.

## What it promises

1. **Fast.** Several connections per file, redistributed while the download runs; no pointless waiting.
2. **Reliable.** A dropped connection is not a lost download. Closing the app does not lose the bytes already fetched. A file already on disk is never overwritten.
3. **Any link.** Direct links today; the media of a page through the extension; hoster links through a debrid service (AllDebrid first): once the service is connected, a hoster link pasted into Scia is unlocked and downloaded with nothing else to do. Adaptive streams when Scia can assemble them; whole pages, playlists, channels or profiles expanded into their videos — the public ones, and, with the session handed over by the extension from the person's own browser, the ones only their account shows.
4. **Minimal.** One window, one field, one list. Every extra feature has to earn its place.

## What it is not

- It does not circumvent protections: no DRM, and no evasion of a site's access controls, such as a paywall, a login the person does not have, or a geographic restriction. Inside that line Scia fetches what the person can already reach — also where a site's terms forbid downloading what it lets them play: the owner's decision of 19 November 2026 (#8). The principle, whole, is "Respect the hosts" in `CLAUDE.md`.
- It is not a torrent client. Magnets arrive only through a debrid service that turns them into links ([ADR 0014](../adr/0014-magnets-through-a-service.md)).
- It collects nothing: the app talks to the servers it downloads from and, once the person has connected one, to that service — with the key of their account, about their account and their links; to connect a service by a code, it asks AllDebrid for that code and whether it was confirmed, with no key and nothing of the person's links ([ADR 0013](../adr/0013-a-key-that-arrives-by-a-code.md)); with no service connected, it asks AllDebrid for the public list of the file hosts it supports, with no key and nothing of the person's links, so that a file host's link can say it needs a service ([ADR 0006](../adr/0006-a-file-host-without-a-service.md)); to read the page of a pasted link that is a site yt-dlp knows, yt-dlp, shipped with Scia, asks that site — and whatever the site's reader asks in turn to find the video, which can be hosts the person never named — with nothing of the person's: no cookie, no key, no other link ([ADR 0009](../adr/0009-the-video-of-a-page.md)); it asks GitHub for yt-dlp's latest release once a day (an hour after a check that failed), and fetches it when it is newer, to bring that yt-dlp up to date, with nothing of the person's ([ADR 0011](../adr/0011-yt-dlp-kept-up-to-date.md)); on Windows it asks GitHub for the releases of Scia, to update itself — once it starts, then every six hours (an hour after a check that failed), with nothing of the person's ([ADR 0007](../adr/0007-automatic-updates.md)); the extension talks only to the app. With "Take links from the clipboard" on (off by default), the app reads the text copied on the person's computer, once a second, and keeps no copy of it — only a digest of the last text, which tells one copy from the next — but for the links of files and videos it takes, and writes no link in a log; a magnet copied goes, at once, to the service connected — nowhere with none — and into no log ([ADR 0017](../adr/0017-a-magnet-taken-from-the-clipboard.md)); with no service connected, a copied address that is neither a file nor a known video's page can be the first thing in a run that asks AllDebrid for its public list ([ADR 0012](../adr/0012-links-taken-from-the-clipboard.md)).

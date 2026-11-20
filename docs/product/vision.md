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
- It is not a torrent client. Magnets will arrive only through a debrid service that turns them into links.
- It collects nothing: the app talks to the servers it downloads from and, once the person has connected one, to that service — with the key of their account, about their account and their links; with no service connected, it asks AllDebrid for the public list of the file hosts it supports, with no key and nothing of the person's links, so that a file host's link can say it needs a service ([ADR 0006](../adr/0006-a-file-host-without-a-service.md)); the extension talks only to the app.

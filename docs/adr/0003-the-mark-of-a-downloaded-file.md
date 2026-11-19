# ADR 0003 — A file Scia downloads carries its system's mark of what came from the network

- **Status**: accepted
- **Date**: 2026-11-19

## Context

A browser marks every file it downloads, and Windows leans on that mark: the "Open File — Security Warning", SmartScreen for a program nobody knows, Office's protected view. Scia wrote none. A run of the real app showed it (#22): a script downloaded by Scia had no `Zone.Identifier` stream, and "Open" ran it with no word from Windows.

The mark is something Scia leaves on the person's disk, on every file, for ever. What it says, and what it does not say, is a decision.

## Decision

1. **On Windows, a finished file carries the `Zone.Identifier` stream with the zone and nothing else**: `[ZoneTransfer]`, `ZoneId=3` (the Internet). The owner's decision of 19 November 2026.
2. **The address the file came from is not written.** A browser writes it (`HostUrl`, `ReferrerUrl`); whoever is later handed the file can read it. A link unlocked by a debrid service, or any link with a token in it, can carry something of the person's.
3. **The engine writes it, on the part file, before the rename** (`apps/server/src/origin-mark.ts`, called by `DownloadManager`): the file never stands under its name without its mark.
4. **A disk that refuses the stream gets its file all the same.** FAT, exFAT and some network shares have no streams: the download completes, and the engine's log says `mark_refused`. A download does not fail for a mark.
5. **Every file is marked, whatever its kind and wherever it came from** — also from a host on the local network. Windows decides what to do with the mark, per kind of file; Scia does not second-guess it.
6. **The interface asks once more before running a program** (`ConfirmButton` in the renderer), whatever the system then does: the mark is the system's defence, the second press is Scia's — and the only one on a disk that takes no mark. What a program is, is read from the name as the system reads it: the last extension, against a list drawn from what Windows runs at a press (`fileKindOfName` in `packages/core`).

## Alternatives

- **Write the address too, as browsers do.** Rejected by the owner: the zone is what Windows acts on, and the address is what leaks.
- **Mark only programs.** Rejected: a document with macros and an archive are opened under the same mark, and the list of what is dangerous is the system's to keep, not Scia's.
- **Let main write it, through Electron.** Rejected: the engine is the one that puts the file in place, and it runs without Electron in tests and in development.
- **Fail the download when the mark cannot be written.** Rejected: on a disk without streams no file could ever be downloaded.

## Consequences

- Windows is expected to treat such a file as one saved by a browser: its warning before a program is run, Office's protected view for a document. Seen in the real app for a script only — Windows asked, and did not run it. Removing the mark is the person's ("Unblock" in the file's properties).
- A file on a disk without streams carries no mark, and nothing in the interface says so: only the log does.
- **Linux has no mark Scia writes.** There is no equivalent the desktops act on (`user.xdg.origin.url` records an address, which point 2 forbids), and a downloaded file is not executable there. Decided again when Linux is tried.
- The mark is written with the bytes Scia fetched; a file the person moves to another disk keeps or loses it as that disk allows.

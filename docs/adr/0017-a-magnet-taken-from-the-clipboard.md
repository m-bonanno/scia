# ADR 0017 — A magnet copied to the clipboard goes to the connected service at once

- **Status**: accepted
- **Date**: 2026-11-21
- **Amends**: [ADR 0012](./0012-links-taken-from-the-clipboard.md), point 4 — what of a copied text leaves main

## Context

[ADR 0012](./0012-links-taken-from-the-clipboard.md) has main read the clipboard while "Take links from the clipboard" is on, and hand the engine only the http(s) links of a copied text: "a password copied goes nowhere". [ADR 0014](./0014-magnets-through-a-service.md) sends a magnet pasted into Scia to the connected AllDebrid.

On 21 November 2026 the owner asked that a magnet copied to the clipboard be added to AllDebrid too, and decided how (#139):

- **uploaded at once**, as a pasted magnet is — not a "Ready" row waiting for Start, as the other copied links. A magnet copied by mistake holds one of AllDebrid's 30 active places until it is removed;
- only while the switch is on and AllDebrid is connected.

## Decision

1. **Of a copied text, its http(s) links and its magnets leave main — nothing else of it.** Main finds the magnets as the page does (`extractMagnets` in `@scia/contracts/links`, a magnet of the contract's shape); a tracker's address inside a magnet is no link of its own (`extractLinks` reads the text without its magnets). A password copied still goes nowhere.
2. **The engine decides, as for links.** Main hands the magnets of a copy, in one request, to `POST /api/v1/magnets/offered`, with main's token (the extension's does not open it, ADR 0002), after the copy's links:
   - with a service connected, the engine adds them as pasted ones (`DownloadManager.offerMagnets` → `addMagnets`): sent at once, their files downloaded in their folders (ADR 0014);
   - with none connected, it leaves them out and says so in its log (`clipboard_magnets_left_out`, a count): a copy is not a request to connect a service, and a failed row for every magnet copied would be noise. `MagnetService.hasService()` says it;
   - a magnet already in the list — the same torrent, however written — is not added twice; one AllDebrid already holds is one row of the list, as ADR 0016 point 5 has it.
3. **The answer is a count**: main says, when the window is not in front, "Sent N magnets to AllDebrid" — a notification of its own beside the links' "Added N links, ready to start", because a magnet does not wait for a Start. Main's log has counts, never a magnet.

## Alternatives considered

- **A copied magnet as a "Ready" row, sent at its Start**, as the other copied links. The owner chose at once: a magnet is the person's choice of a torrent, and waiting adds a press for nothing.
- **A failed row "Connect AllDebrid" for a magnet copied with no service.** Rejected: copying a magnet is often done for something else, and the switch takes links, not magnets alone; the row would ask the person to connect a service they may not want.
- **Main deciding whether a service is connected.** Main does not hold the services' state; the engine does.

## Consequences

- With the switch on and AllDebrid connected, every magnet copied is sent to AllDebrid within a second, and holds one of the account's active places until the files arrive or it is removed there.
- Copying the same magnet again, after its files arrived, sends it again, as pasting it does (#150).
- The real clipboard is tried by a person on a build they start: a process under a job that limits the desktop cannot open it (ADR 0012). The E2E suite answers the clipboard in main.

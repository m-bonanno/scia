# ADR 0013 — A restart the person asks for, to install an update

- **Status**: accepted
- **Date**: 2026-11-21
- **Amends**: [ADR 0007](./0007-automatic-updates.md), decision 4 ("after the install at quit, Scia stays closed"), for a restart the person asks for. Everything else of ADR 0007 holds.

## Context

Scia downloads an update by itself and installs it only at a quit the person asks for (ADR 0007). A Scia left in the tray can keep an update for days, and the window named no version at all: whoever uses it could not tell which one they run, nor that an update was waiting.

The owner decided (21 November 2026, #133):

1. **The version beside the name**, top left, small: the whole version, e.g. "1.0.0-beta.17".
2. **When an update has been downloaded, it becomes a button**: "Update to 1.0.0-beta.18".
3. **A press asks, in a small popover under the button**, "Restart now to install 1.0.0-beta.18?", with "Restart now" and "Later". **That is possible only while nothing is downloading**; otherwise the popover says that the update installs when Scia is quit, with only "Close".
4. **After "Restart now", Scia opens again by itself**, as the new version. A quit from the tray still leaves Scia closed after installing, as ADR 0007 says.

The owner's earlier rule holds: an update never installs with a download running.

## Decision

1. **Main decides what is offered, and the page asks.** `Updates.offered()` (`apps/desktop/src/engine/updates.ts`) is the version the next quit the person asks for would install: downloaded and checked, and a beta only while the betas switch is on — asked of the engine within `ENGINE_ANSWER_LIMIT_MS`, as at the quit. None once the quit has begun, while a newer version replaces the one downloaded, or when the engine does not say. The page asks through the bridge (`updateOffered()`) when it loads, whenever it learns the settings, and whenever main says that what it may offer changed.
2. **Main tells the page that something changed, with nothing in it** (`onUpdateChanged(listener)`, the channel `updates.changed`, sent by `MainWindow.tell` to the app's own page only). It is the first message main sends the page unasked. It carries no version: the page asks, so that one answer, checked like any answer, says what is offered.
3. **A restart is asked, never ordered** (`restartToUpdate()`, answered with an `UpdateRestart` of `@scia/contracts/bridge`). Main checks again what is offered, and asks the engine what it is doing — now, within its bound, not from the last list it heard. It answers `busy` when a download runs or waits, or when the engine does not say; `nothing` when no update is offered any more; and `restarting` otherwise, and only then quits as the person asks for a quit (`quitAsAsked`). The page says what the answer means; it decides nothing.
4. **The restart goes the way of every quit the person asks for** (ADR 0007, point 6): the window hides, `atQuit` decides while the engine still runs (a beta only if the switch is still on), the engine stops and writes its state, and only then the installer starts — silent, detached, and with Scia started again after it (`INSTALL_AND_RESTART`: electron-updater passes `--force-run`). A quit from the tray or a close with nothing left still installs with no start after it (`INSTALL_AT_QUIT`).

## Alternatives considered

- **`quitAndInstall()` of electron-updater from the button**: it quits by its own road, which does not stop the engine before the installer ends Scia's processes (ADR 0007, point 6).
- **The page decides from the list it shows that nothing is downloading**: the list can be a quarter of a second old, and a page is not where a rule about the person's downloads is kept. The page uses its list only to choose what the popover says first; main's answer is what counts.
- **Main sends the version with its notice**: a second road for the same fact, with its own checks. The page asks one question, the answer of which it already checks.
- **A restart over running downloads, which resume after it**: the owner's rule is that an update never installs with a download running.

## Consequences

- **The bridge grows by three named members**: `updateOffered()`, `onUpdateChanged(listener)` and `restartToUpdate()` — never a generic invoke (`apps/desktop/CLAUDE.md`).
- **After "Restart now" the installed Scia starts on its own profile** — the one of the shortcut, with no arguments. A Scia started with `--user-data-dir` (a scratch run) restarts as the installed app on the person's own profile; only a scratch run is ever started that way.
- **A build that does not update itself** — not packaged, or at `0.0.0`, or on a system with no installer — offers nothing and answers `nothing` to a restart: it shows only its version.
- **What the popover says when main refuses is true of both causes**: "Scia could not restart now. … installs when you quit Scia." — a download began meanwhile, or the engine did not say.

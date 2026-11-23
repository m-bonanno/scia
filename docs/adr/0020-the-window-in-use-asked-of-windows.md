# ADR 0020 — Which window is in use is asked of Windows

- **Status**: accepted
- **Date**: 2026-11-23

## Context

Scia notifies a download that ends, or links taken from the clipboard, when its window is not the one in use (#45, #128). It decided that from what the window says of itself: shown, not minimised, focused. On Windows, Electron's `isFocused()` is what the window believes, not what the system says. A window shown while the system kept another one in use can believe it is focused, and then every notification is silent until the person clicks into Scia and away. The plain case is a start during which the person goes back to their work (#62). Electron has no call that asks the system, and the review of #51 found no truer answer inside it.

The owner decided (21 November 2026, on #62) that the first stable release waits for the fix, by asking the system which window is in use. The product prefers a notification too many over one that never comes.

## Decision

1. **On Windows, main asks the system which window is in use** (`GetForegroundWindow`) when a notification is about to be decided, and compares it with Scia's own window handle (`getNativeWindowHandle`). "Shown" and "not minimised" still come first. The system's answer replaces the window's `focused`.
2. **koffi asks it: the one native module of the app.** `koffi` (MIT, version pinned) calls `GetForegroundWindow` in `user32.dll` directly: microseconds a question, no process beside Scia. It is loaded on Windows only, at boot, with a dynamic import that main's bundle leaves outside (`build.mjs`). electron-builder packs it: its JavaScript in the asar, its native build (`@koromix/koffi-win32-x64`, an optional dependency npm installs for the system only) in `app.asar.unpacked`, as Electron loads a `.node` file. Its own install script is not needed and not run: the prebuilt build is the optional dependency.
3. **When the system does not answer** (koffi not loaded, a call that throws), Scia counts the window as not in use and notifies. Each decision logs what the system said: `asked: answered`, `unanswered` or `not asked` (off Windows).
4. **It is asked only at the moment of deciding**: once per batch of ended downloads (they share one notification), once per offer from the clipboard. Never on a timer.
5. **Elsewhere** (Linux, untried), the window's `focused` decides, as before.
6. **The decision is pure** (`engine/foreground.ts`, `windowInUse`): no answer is another window in use. The call is the adapter (`foreground-window.ts`).

## Rejected

- **PowerShell with `Add-Type`** (round 1 and 2 of #235): no native module, but starting it and compiling the declaration took more than 5 s a question on CI's Windows runner, and 47 s for the first answer of a PowerShell kept from boot. A Scia just started, the moment #62 is about, could not tell whether it was looked at.
- **Another rule for when to notify**, one that does not depend on the window in use: it changes the owner's decision of #45.

## Consequences

- Scia ships one native module. Its version and its prebuilt builds change together, and the installer's smoke test, which starts the installed app, proves the module loads.
- A Windows where koffi cannot load gets every notification while Scia is shown, including those it does not need. That is the side the owner chose.
- What the system shows is still seen only by a person (#13's checklist): a start, back to another window with no click into Scia, then a download that ends. The E2E suite checks that Windows answers inside the built app (`asked: 'answered'`).

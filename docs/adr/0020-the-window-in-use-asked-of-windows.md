# ADR 0020 — Which window is in use is asked of Windows

- **Status**: accepted
- **Date**: 2026-11-23

## Context

Scia notifies a download that ends, or links taken from the clipboard, when its window is not the one in use (#45, #128). It decided that from what the window says of itself: shown, not minimised, focused. On Windows, Electron's `isFocused()` is what the window believes, not what the system says. A window shown while the system kept another one in use can believe it is focused, and then every notification is silent until the person clicks into Scia and away. The plain case is a start during which the person goes back to their work (#62). Electron has no call that asks the system, and the review of #51 found no truer answer inside it.

The owner decided (21 November 2026, on #62) that the first stable release waits for the fix, by asking the system which window is in use. The product prefers a notification too many over one that never comes.

## Decision

1. **On Windows, main asks the system which window is in use** (`GetForegroundWindow`) when a notification is about to be decided, and compares it with Scia's own window handle (`getNativeWindowHandle`). "Shown" and "not minimised" still come first. The system's answer replaces the window's `focused`.
2. **PowerShell asks it, not a native module.** `apps/desktop/src/foreground-window.ts` runs the system's own `powershell.exe` (`%SystemRoot%\System32\WindowsPowerShell\v1.0`). The script declares `GetForegroundWindow` with `Add-Type` and prints the handle. The child gets an environment of `SystemRoot` alone, and a limit of five seconds. Nothing is added to the package. A native module would need its own build for each Electron version and system, and an ADR of its own.
3. **When the system does not answer** (no PowerShell, a refusal, a timeout, an answer that is not a number), Scia counts the window as not in use and notifies.
4. **It is asked only at the moment of deciding**: once per batch of ended downloads (they share one notification), once per offer from the clipboard. Never on a timer.
5. **Elsewhere** (Linux, untried), the window's `focused` decides, as before.

## Consequences

- A notification is decided a few hundred milliseconds later: PowerShell takes that long to start. A batch already waits up to two seconds, and the person sees nothing of it.
- A Windows without PowerShell, or with it blocked by policy, gets every notification while Scia is shown, including those it does not need. That is the side the owner chose.
- `MainWindow.isInFront()` is asynchronous. Its callers wait for it.
- What the system shows is still seen only by a person (#13's checklist): a start, back to another window with no click into Scia, then a download that ends.

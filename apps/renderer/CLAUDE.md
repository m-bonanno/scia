# Scia — Renderer CLAUDE.md (`apps/renderer`)

Loaded when working under `apps/renderer/`. **Extends** the root `CLAUDE.md`; wins for frontend work.

## Who uses this screen

Anyone who downloads files: they paste a link and want to forget about it. The window is often small and in a corner. **Minimal is the product**: one screen, one field, one list. A feature that needs a second screen has to earn it.

## Design canon

| Source                                 | What we take                                                      |
| -------------------------------------- | ----------------------------------------------------------------- |
| **Don't Make Me Think** (Krug)         | Self-evident controls; no manual                                  |
| **The Design of Everyday Things**      | Feedback for every action, constraints over error messages        |
| **[Laws of UX](https://lawsofux.com)** | Fitts, Hick (few choices), Doherty (< 400 ms to visible feedback) |
| **WCAG 2.2 AA**                        | Contrast, visible focus, labels, status messages                  |

### Hard visual rules

- **Tokens, never raw colours.** Colours come from the CSS variables in `src/styles.css` (`bg-surface`, `text-muted-foreground`, …). No hex in components, no `dark:` variant: a colour that changes with the theme is a token, defined in both themes. `--background`, `--foreground` and `--muted-foreground` are mirrored by `WINDOW_COLOURS` in `@scia/contracts/theme` — a test fails when they drift.
- **One accent**, for progress and the primary action. Failure is `destructive`; a paused download is muted, not coloured.
- **Two levels told apart by tone**: the background and the surface on it. No shadows, no decorative borders. A line survives only where it carries meaning: the focus outline, a field's boundary.
- **The segment bar is the signature**: each connection fills its own stretch of the file where that stretch is. Do not replace it with a plain bar.
- **Numbers are `tabular-nums`** and go through `lib/format.ts` (the one `LOCALE` of `@scia/contracts/locale`, a non-breaking space before the unit). Never `toFixed`, never string concatenation of amounts.
- **Icons: `lucide-react` only.** No emoji. Icon-only buttons are `IconButton`, which requires a label — or `ConfirmButton`, which is one until it asks (both wear `components/button-styles.ts`).
- **Visible focus always**: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Never a box-shadow ring, never `outline-none` without a replacement.
- **Motion says something or is not there**: a row arriving, a bar filling. `prefers-reduced-motion` turns it off.

## Behaviour

- **Every data view has its states**: connecting (nothing drawn, no flash), empty (says what is missing and what to do), engine unreachable (says so, keeps the last list), data.
- **Forgiving.** A finished download leaves the list at one press (the file stays). Unfinished bytes are thrown away only after a second press in place, and a downloaded program is run only after a second press too (`components/confirm-button.tsx`). The button turns, in place, into the word of what it is about to do, and stays one element, so the focus stays on it. A press is one press however it is repeated: while the button asks, no later click of a burst is the answer, and neither are the repeats of Enter held down — of Enter alone, a held Tab walks on. When it has nothing to ask, a later click is refused only by the button that saw the one before it, so quick presses clear a list. A failed add never clears what was typed.
- **Keyboard-complete.** Paste anywhere adds the links; everything pressable is a `button`. A shortcut of the pointer (a double click on a finished row is one press of its "Open": it opens a file, and makes a program's button ask — it moves the focus there, and never answers the question) only repeats a button that is there.
- **A capture in `docs/design/` shows the app as it is**: the PR that changes what one shows retakes it, from the real app (`docs/design/README.md`).
- **The page never names a path.** It names a download by id; main asks the engine where the file is (`lib/bridge.ts`). It names no folder either: to change where downloads go it asks main, which shows the system's dialog and tells the engine, and then it reads the settings again.

## Copy

- **English, sentence case.** Buttons start with a verb (_Download_, _Resume_); headings are nouns.
- **Errors: the fact, then the remedy where there is one.** _The file is no longer at this address._ No blame, no _Oops_.
- API errors arrive as `error.code`; the text lives in `lib/messages.ts`. A download's failure is a `DownloadFailure` code, turned into text in `features/downloads/status-line.ts`.

## Code

- `features/<name>/` for a screen's parts, `lib/` for what several features share, `components/` for generic controls.
- The live list comes from `lib/live.ts` (server-sent events into `useSyncExternalStore`); commands go through `lib/api.ts`, which checks every answer with the contract's Zod schema.
- No `node:*`, no import of engine code (types are fine). The renderer is a web page.
- Component specs use Testing Library and query by role and name, as a person would find the control.

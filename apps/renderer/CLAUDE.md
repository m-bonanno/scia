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
- **Icons: `lucide-react` only.** No emoji. Icon-only buttons are `IconButton`, which requires a label.
- **Visible focus always**: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Never a box-shadow ring, never `outline-none` without a replacement.
- **Motion says something or is not there**: a row arriving, a bar filling. `prefers-reduced-motion` turns it off.

## Behaviour

- **Every data view has its states**: connecting (nothing drawn, no flash), empty (says what is missing and what to do), engine unreachable (says so, keeps the last list), data.
- **Forgiving.** A finished download leaves the list at one press (the file stays). Unfinished bytes are thrown away only after a second press in place. A failed add never clears what was typed.
- **Keyboard-complete.** Paste anywhere adds the links; everything pressable is a `button`. A shortcut of the pointer (a double click on a finished row opens its file) only repeats a button that is there.
- **The page never names a path.** It names a download by id; main asks the engine where the file is (`lib/bridge.ts`).

## Copy

- **English, sentence case.** Buttons start with a verb (_Download_, _Resume_); headings are nouns.
- **Errors: the fact, then the remedy where there is one.** _The file is no longer at this address._ No blame, no _Oops_.
- API errors arrive as `error.code`; the text lives in `lib/messages.ts`. A download's failure is a `DownloadFailure` code, turned into text in `features/downloads/status-line.ts`.

## Code

- `features/<name>/` for a screen's parts, `lib/` for what several features share, `components/` for generic controls.
- The live list comes from `lib/live.ts` (server-sent events into `useSyncExternalStore`); commands go through `lib/api.ts`, which checks every answer with the contract's Zod schema.
- No `node:*`, no import of engine code (types are fine). The renderer is a web page.
- Component specs use Testing Library and query by role and name, as a person would find the control.

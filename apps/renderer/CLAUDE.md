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

- **Tokens, never raw colours.** Colours come from the CSS variables of `src/themes.css`, named for Tailwind in `src/styles.css` (`bg-surface`, `text-muted-foreground`, …). No hex in components, no `dark:` variant, no class that names a theme: a colour that changes is a token, defined by every theme in its dark and in its light variant.
- **A theme is a whole set of tokens, twice** ([`docs/design/themes.md`](../../docs/design/themes.md)). A person chooses the theme in Settings (`Theme` in `@scia/contracts/theme`; the engine keeps it); the system chooses the variant. The page wears the theme named on `<html>` — the engine writes it into the page it serves, `lib/theme.ts` changes it — and the default one when none is named. A spec (`apps/desktop/src/theme-colours.test.ts`) holds every theme and variant to the same tokens, every pair of text and ground the page uses to WCAG 2.2 AA (4.5:1 for text, 3:1 for a bar, an icon, the focus outline), `--background`, `--foreground` and `--muted-foreground` to `WINDOW_COLOURS`, which main paints the window with, and the extension's stylesheet to the default theme. A new token, or a new pairing of two tokens in a component, is added to that spec's list of pairs — and a pairing is counted in every state: the focus outline on each ground a focusable thing can sit on, and selected text, which is `accent-foreground` on `accent` (`::selection` in `styles.css`), never a tint under the text's own colour.
- **One accent**, for progress and the primary action. Failure is `destructive`; a paused download is muted, not coloured.
- **Two levels told apart by tone**: the background and the surface on it. No shadows, no decorative borders. A line survives only where it carries meaning: the focus outline, a field's boundary.
- **The segment bar is the signature**: each connection fills its own stretch of the file where that stretch is. Do not replace it with a plain bar.
- **Numbers are `tabular-nums`** and go through `lib/format.ts` (the one `LOCALE` of `@scia/contracts/locale`, a non-breaking space before the unit). Never `toFixed`, never string concatenation of amounts.
- **Icons: `lucide-react` only.** No emoji. Icon-only buttons are `IconButton`, which requires a label — or `ConfirmButton`, which is one until it asks (both wear `components/button-styles.ts`).
- **Visible focus always**: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Never a box-shadow ring, never `outline-none` without a replacement.
- **Motion says something or is not there**: a row arriving, a bar filling. `prefers-reduced-motion` turns it off.

## Behaviour

- **Every data view has its states**: connecting (nothing drawn, no flash), empty (says what is missing and what to do), engine unreachable (says so, keeps the last list), data.
- **Forgiving.** A finished download leaves the list at one press (the file stays), and so does a ready one, taken from the clipboard, which has nothing on the disk; it starts at its "Start", and "Start all" is beside the filters while any row is ready. Unfinished bytes are thrown away only after a second press in place, and a downloaded program is run only after a second press too (`components/confirm-button.tsx`). The button turns, in place, into the word of what it is about to do, and stays one element, so the focus stays on it. A press is one press however it is repeated: while the button asks, no later click of a burst is the answer, and neither are the repeats of Enter held down — of Enter alone, a held Tab walks on. When it has nothing to ask, a later click is refused only by the button that saw the one before it, so quick presses clear a list. A failed add never clears what was typed.
- **Keyboard-complete.** Paste anywhere adds the links; everything pressable is a `button`. A shortcut of the pointer (a double click on a finished row is one press of its "Open": it opens a file, and makes a program's button ask — it moves the focus there, and never answers the question) only repeats a button that is there.
- **A key is typed once and kept nowhere in the page** (`features/settings/integrations.tsx`). Its field hides it; the engine checks it and keeps it ([ADR 0004](../../docs/adr/0004-the-key-of-a-service.md)); the page forgets it when it is taken, at Cancel and when Settings closes, and no answer of the API carries it back. What the service or the system said of it is told by the field — which is marked invalid and described by it — each sentence true of every cause its code covers (`connectFailureMessage`), and never clears what was typed. While the key is being checked "Cancel" does nothing, and says so (`aria-disabled`): the check cannot be taken back, and a way back that is not one is not offered.
- **A code to confirm on the service's site is the main way to connect a service, a key the other** (the owner, #136; [ADR 0013](../../docs/adr/0013-a-key-that-arrives-by-a-code.md)). "Connect with a code" shows the code, where it is confirmed as a person would type it (`alldebrid.com/pin`) and how long it works — said once, not ticking — and "Open AllDebrid", which asks main to open that page; with no main, in a plain browser, the place is enough. The page reads what became of the code every two seconds while it waits, and stops when it connected or failed; a code that connected nothing says why and offers "Get a new code". Cancel, and Settings closing, tell the engine to forget it. Nothing of the key reaches the page.
- **When a control leaves the page under the focus, the focus goes to what takes its place**: from the key's field, or from the code, to "Disconnect" once connected; from the code to "Open AllDebrid" when it arrives, and to "Get a new code" when it fails; to "Use an API key" after the key's Cancel, to "Connect with a code" after the code's Cancel and after disconnecting. A focus left on nothing starts again from the top of the dialog. Only a focus that was on what left is handed on: one that went elsewhere meanwhile stays where it is.
- **A capture in `docs/design/` shows the app as it is**: the PR that changes what one shows retakes it, from the real app (`docs/design/README.md`).
- **The page never names a path.** It names a download by id; main asks the engine where the file is (`lib/bridge.ts`). It names no folder either: to change where downloads go it asks main, which shows the system's dialog and tells the engine, and then it reads the settings again — whatever main answered, and also when main failed. An answer from main is checked like any answer from outside (`isFolderChange`).
- **What the engine keeps is learned from the last ask.** Settings reads at every opening, at every change, and after a folder was chosen; an answer is kept only when nothing was asked after it (`learn` in `features/settings/settings-dialog.tsx`), so a read asked before a change never undoes it on screen.

## Copy

- **English, sentence case.** Buttons start with a verb (_Download_, _Resume_); headings are nouns.
- **Errors: the fact, then the remedy where there is one.** _The file is no longer at this address._ No blame, no _Oops_. A sentence that names a cause is shown for that cause alone: the caller is told which it was, as data.
- API errors arrive as `error.code`; the text lives in `lib/messages.ts`. A download's failure is a `DownloadFailure` code, turned into text in `features/downloads/status-line.ts`.

## Code

- `features/<name>/` for a screen's parts, `lib/` for what several features share, `components/` for generic controls.
- The live list comes from `lib/live.ts` (server-sent events into `useSyncExternalStore`); commands go through `lib/api.ts`, which checks every answer with the contract's Zod schema.
- No `node:*`, no import of engine code (types are fine). The renderer is a web page.
- Component specs use Testing Library and query by role and name, as a person would find the control.

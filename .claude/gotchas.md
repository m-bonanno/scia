# Gotchas — mistakes already paid for

Read the groups your change touches before a push. Add a `→` entry in the same PR when a mistake of that kind bites again.

## Tooling

- → `npm install` can leave `node_modules/electron/dist` empty while exiting 0. Symptom: `electron.exe` missing. Fix: `node node_modules/electron/install.js`.
- → `erasableSyntaxOnly`: no `enum`, no parameter properties, no namespaces. Use `as const` objects and plain fields.
- → Node runs the workspaces' TypeScript directly: imports carry the `.ts` extension, and a package's `exports` point at `src/`.
- → `@typescript-eslint/no-unnecessary-condition` reads a flag changed in a callback, or re-read after an `await`, as constant. Read it through a function (`#isStopping()`, `stopped()`), do not disable the rule.
- → `@typescript-eslint/unbound-method` fires on `expect(object.method)` when the interface declares a method. Declare callbacks as properties (`readonly pause: (id) => void`).

## Formatting numbers

- → Grouping depends on the locale's CLDR data, not on intuition: `en-US` writes `1,000`, while `it-IT` leaves a four-digit number ungrouped (`1000`). A spec expects what `Intl` says for the `LOCALE` of `@scia/contracts/locale`.
- → The unit is tied to its number with a non-breaking space, written as the escape `\u00a0`, never as the invisible character itself.
- → Testing Library normalises the white space of the text it reads, the non-breaking space included, but not of the string it is asked for: a spec finds a formatted amount with a regular expression (`/^10\.0\sMB\/s$/`), not with the string.

## Copy

- → A change of wording or of language is finished when a search of the whole tree for the old words finds nothing (`git grep -nE "[àèéìòù]"` caught what reading the diff did not), and every dialog was opened in the real app: a screen nobody opened is a screen nobody read.

## Specs

- → A fix found while proving something else in the real app is still a rule without a spec: the run shows it once, and nothing holds it afterwards. Its spec is written, and seen failing against the old code, before the PR is opened: the message for a file that does not open went to review held only by a harness (#21).

## Docs and runbooks

- → Where a document of state — the roadmap, the README, a runbook's "Not there yet" — names what vouches for something (an ADR, a spec, a run, a record), the present is for what exists: "the ADR records it", "a spec holds that" for one still to write is a "done" nobody did. Write "has to" (#29, twice in one PR, the second time in the commit that fixed the first). A bare participle does the same: "Built and proven against a simulated service" reads as done beside lines where "Written, covered by specs" means it (#31). A planned item written in the present ("Choosing the folder") is not this.
- → A rule added to a process is checked against every other rule that decides the same thing: size was added to how the roles of a review are chosen, and the rule on a commit pushed after the approval still chose them by area alone (#27 — the slip of #17, a second time). Search the runbook for the thing decided ("role", "reviews again"), not for the words of the new rule. The roadmap is no different: "Linux comes after the first stable release" was added above a line that still listed Linux among what that release waits for (#31).
- → "No code changed" is not a reason to skip a gate: the five are run on every head, and the PR body carries their numbers (#27).

## Engine

- → A vitest `?raw` import of a `.css` file comes back empty. A spec that needs the stylesheet's text reads it with `node:fs`, from a workspace that has Node types.
- → Two downloads added together race for the plain file name: a spec must not assume which one gets `name.ext` and which `name (1).ext`.
- → `IncomingMessage` must be destroyed, or drained, on every path that does not read it to the end: a redirect, a refused status. Otherwise the socket stays busy.

## Electron

- → A page's `window.close()` destroys the window at once: Electron does not emit a preventable `close` for it. A harness that wants what the X does follows `docs/development/testing.md`, "Proving the real app".
- → A debugging port answers before the window has a page: a harness waits for a `page` target, not just for the port.
- → A very long profile path breaks Chromium's GPU cache (`The filename or extension is too long`). Harmless in a scratch folder; a sign to shorten the path, not a bug of the app.
- → Over the DevTools protocol, Enter presses a focused button only when its `keyDown` carries `text: '\r'`: without it the key arrives and nothing is pressed, and the harness proves nothing while looking as if it had.

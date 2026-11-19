# Gotchas — mistakes already paid for

Read the groups your change touches before a push. Add a `→` entry in the same PR when a mistake of that kind bites again.

## Tooling

- → `npm install` can leave `node_modules/electron/dist` empty while exiting 0. Symptom: `electron.exe` missing. Fix: `node node_modules/electron/install.js`.
- → `erasableSyntaxOnly`: no `enum`, no parameter properties, no namespaces. Use `as const` objects and plain fields.
- → Node runs the workspaces' TypeScript directly: imports carry the `.ts` extension, and a package's `exports` point at `src/`.
- → `@typescript-eslint/no-unnecessary-condition` reads a flag changed in a callback, or re-read after an `await`, as constant. Read it through a function (`#isStopping()`, `stopped()`), do not disable the rule.
- → `@typescript-eslint/unbound-method` fires on `expect(object.method)` when the interface declares a method. Declare callbacks as properties (`readonly pause: (id) => void`).

## Formatting numbers

- → Grouping depends on the locale's CLDR data, not on intuition: `en-US` writes `1,000`, while `it-IT` leaves a four-digit number ungrouped (`1000`). A spec expects what `Intl` says for the locale in `lib/format.ts`.
- → The unit is tied to its number with a non-breaking space, written as the escape `\u00a0`, never as the invisible character itself.

## Copy

- → A change of wording or of language is finished when a search of the whole tree for the old words finds nothing (`git grep -nE "[àèéìòù]"` caught what reading the diff did not), and every dialog was opened in the real app: a screen nobody opened is a screen nobody read.

## Engine

- → A vitest `?raw` import of a `.css` file comes back empty. A spec that needs the stylesheet's text reads it with `node:fs`, from a workspace that has Node types.
- → Two downloads added together race for the plain file name: a spec must not assume which one gets `name.ext` and which `name (1).ext`.
- → `IncomingMessage` must be destroyed, or drained, on every path that does not read it to the end: a redirect, a refused status. Otherwise the socket stays busy.

## Electron

- → A page's `window.close()` destroys the window at once: Electron does not emit a preventable `close` for it. A harness that wants what the X does follows `docs/development/testing.md`, "Proving the real app".
- → A debugging port answers before the window has a page: a harness waits for a `page` target, not just for the port.
- → A very long profile path breaks Chromium's GPU cache (`The filename or extension is too long`). Harmless in a scratch folder; a sign to shorten the path, not a bug of the app.

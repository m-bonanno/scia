# Gotchas — mistakes already paid for

Read the groups your change touches before a push. Add a `→` entry in the same PR when a mistake of that kind bites again.

## Tooling

- → `npm install` can leave `node_modules/electron/dist` empty while exiting 0. Symptom: `electron.exe` missing. Fix: `node node_modules/electron/install.js`.
- → `erasableSyntaxOnly`: no `enum`, no parameter properties, no namespaces. Use `as const` objects and plain fields.
- → Node runs the workspaces' TypeScript directly: imports carry the `.ts` extension, and a package's `exports` point at `src/`.
- → `@typescript-eslint/no-unnecessary-condition` reads a flag changed in a callback, or re-read after an `await`, as constant. Read it through a function (`#isStopping()`, `stopped()`), do not disable the rule.
- → `@typescript-eslint/unbound-method` fires on `expect(object.method)` when the interface declares a method. Declare callbacks as properties (`readonly pause: (id) => void`).

## Formatting numbers

- → `Intl.NumberFormat('it-IT')` does not group a four-digit number: `1000`, not `1.000`; grouping starts at `10.000`. Specs expect what CLDR says.

## Engine

- → A vitest `?raw` import of a `.css` file comes back empty. A spec that needs the stylesheet's text reads it with `node:fs`, from a workspace that has Node types.
- → Two downloads added together race for the plain file name: a spec must not assume which one gets `name.ext` and which `name (1).ext`.
- → `IncomingMessage` must be destroyed, or drained, on every path that does not read it to the end: a redirect, a refused status. Otherwise the socket stays busy.

## Electron

- → A debugging port answers before the window has a page: a harness waits for a `page` target, not just for the port.
- → A very long profile path breaks Chromium's GPU cache (`The filename or extension is too long`). Harmless in a scratch folder; a sign to shorten the path, not a bug of the app.

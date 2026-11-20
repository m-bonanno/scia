# Scia — Core CLAUDE.md (`packages/core`)

Loaded when working under `packages/core/`. **Extends** the root `CLAUDE.md`.

The domain: how a file is split into segments and split again while it downloads, what the queue starts next, how fast a transfer is and how it is held under a limit, what a file may be called on Windows and Linux, what kind of file it is. **Pure TypeScript.**

- **No IO, no frameworks, no runtime.** No `node:*`, no `electron`, no `zod`, no `fetch`, no `URL`, no DOM. ESLint enforces it. The same code runs in the engine, in the page and in the extension's service worker.
- **No clock.** A function that needs the time takes it as an argument (`SpeedMeter.record(bytes, atMs)`). `new Date()` and `Date.now()` are lint errors here.
- **Enums are `as const` objects** with a type of the same name (`DownloadStatus`, `FileKind`): `erasableSyntaxOnly` forbids `enum`, and the values cross the wire as strings.
- **Immutable values.** A `Segment` is replaced, never mutated; a function returns a new array.
- **Every exported function has a spec** that reads as the rule it implements, edge cases included (the empty file, the size that does not divide, the reserved device name).
- **A name from a host that decides something is read as the system will read it.** `fileKindOfName` takes the last extension, whatever stands before it, and a list that is a safety rule — what counts as a program — is drawn from the system (`PATHEXT`, what its shell runs), not from memory.
- A concept used by two apps belongs here; a concept used by one stays in that app until a second caller exists.

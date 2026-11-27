# Gotchas — mistakes already paid for

Before a push, read the general entries below and the file of every area your change touches. An entry is one or two sentences: the rule, and the issues it was paid for in, where its story stays. When a mistake of that kind bites again, add a `→` entry to the file of its area in the same PR, or the new issue's number to the entry that already says it. What a tool can check is not an entry: lint holds it (`eslint.config.js`, each rule held by `scripts/lint-rules.test.mjs`).

## Areas

| File                                           | Read for a change to                                                                                                                                | Was the group      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`gotchas/tooling.md`](./gotchas/tooling.md)   | `scripts/`, `.github/`, `.husky/`, `package.json` and its lock, the root's configs; a merge, a release                                              | Tooling            |
| [`gotchas/specs.md`](./gotchas/specs.md)       | a spec of any layer, a `testing/` folder, `apps/desktop/e2e/`, a mutation run, a probe                                                              | Specs              |
| [`gotchas/engine.md`](./gotchas/engine.md)     | `apps/server/`, `packages/core/`, `packages/contracts/`                                                                                             | Engine             |
| [`gotchas/desktop.md`](./gotchas/desktop.md)   | `apps/desktop/`, a harness that drives the real app                                                                                                 | Electron           |
| [`gotchas/renderer.md`](./gotchas/renderer.md) | `apps/renderer/`, `apps/extension/`                                                                                                                 | Formatting numbers |
| [`gotchas/copy.md`](./gotchas/copy.md)         | a sentence a person reads — `lib/messages.ts`, a status line, the extension's pages, main's notifications and dialogs — and a code that chooses one | Copy               |
| [`gotchas/docs.md`](./gotchas/docs.md)         | `docs/`, a `CLAUDE.md`, `.claude/`, `README.md`, a PR's body or title, an issue                                                                     | Docs and runbooks  |

A reference written before the split names a group (`.claude/gotchas.md`, "Specs"): the table gives its file. The split also moved some entries to the area they are about, such as the page's entries of "Specs" to `renderer.md`; a reference that names an issue (`.claude/gotchas.md`, #246) finds its entry by that number: `git grep -nw '#246' .claude/gotchas.md .claude/gotchas/`.

## General

- → `erasableSyntaxOnly`: no `enum`, no parameter properties, no namespaces. Use `as const` objects and plain fields.
- → A session's scratchpad folder can be shared with sessions that work at the same time, and a commit went in under another session's message (#182). Write such a file in a folder named for the branch, and read the commit back (`git log -1`) before going on.
- → Node runs the workspaces' TypeScript directly: imports carry the `.ts` extension, and a package's `exports` point at `src/`.
- → `@typescript-eslint/no-unnecessary-condition` reads a flag changed in a callback, or re-read after an `await`, as constant. Read it through a function (`#isStopping()`, `stopped()`); do not disable the rule.
- → `@typescript-eslint/unbound-method` fires on `expect(object.method)` when the interface declares a method. Declare callbacks as properties (`readonly pause: (id) => void`).
- → The editing tools of a session turn the escape of an invisible character, written in their text, into the character itself: a no-break space landed in a spec, a component and the engine, a soft hyphen in a `CLAUDE.md` (#101, #172, #228). In code use `NBSP` from `lib/format.ts`, in a spec an escape a script builds, and search the whole diff before a commit: `git diff | grep -nP '\x{00A0}|\x{00AD}'`.
- → A word given a new meaning is searched for in its old one in the whole tree, not only in the files the change touched: "both themes" stayed in the PR template, a role file and the roadmap once "theme" meant the palette (#52). Search with a pattern of every form (`git grep -nIiE "(dark|light|either|both) themes?"`).
- → A guard put in a shared component, or a shared handler, reaches every user of it: one meant for a button that asks swallowed the quick presses of a list being cleared (#32), and an API's one error handler gave a link's refusal the wrong status (#138). Ask what each user does with it, and keep a mapping with the routes it is for.
- → Two asks of the same thing answer in the order they like: a read of Settings answered after a change and undid it on screen (#52), and an older answer of the account was drawn over a newer one (#138). Keep an answer only when nothing was asked after it, and hold the late answer back by hand in its spec.
- → Backslashes written through a script's string, a heredoc or `sed` are lost, and `String.replace`'s `` $` `` inserts text: runbooks, specs, regular expressions and this file lost theirs (#111, #100, #136, #157, #246). Write a Windows path or a regular expression with the editor, and read the diff back — its line count too.
- → An exception to a rule of a `CLAUDE.md` is the owner's to make, never the author's: #228's ADR wrote one against "Retry what can heal" and edited the rule's file to match. Quote the rule the change departs from in the PR body as a question for the owner, or keep it.
- → A guard read before an `await` is a guard of the moment before it: a key, a field (`this.#seen ||= await look()`), an index and a progress read before a wait were all stale after it (#136, #245, #302, #347). Read after the wait whatever decides after it, write only what the answer itself says, and give the spec an older answer that comes last.
- → Nothing that paces or times out runs on `Date.now()`, which steps with the system's clock: use `performance.now()` (#44).
- → `pgrep -f <text>` lists every process whose command line holds the text, a shell that waits on the same check included, and two roles waiting on each other never started (#410). Bracket one character, `pgrep -f 'scripts/[m]utate[.]mjs'`, and leave out `-l`: on macOS it printed a renamed Node process's environment, tokens included (#410).
- → A screen is read only once nothing secret is on it: reading a terminal tab showed a key the owner had typed (#65). A key goes into a shell from the clipboard (`$env:… = Get-Clipboard`), and a run's outcome is pasted by the person, not read off their screen.

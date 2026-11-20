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

- → A sentence that names a cause is shown for that cause alone. One `catch` around a call that rejects in five ways said "choose a folder Scia can write to" to someone whose engine was restarting and who had chosen nothing: try a `catch` against every way the call rejects, and have the callee say which it was, as data (#38).

## Specs

- → What a component that stays mounted remembers is still there when it is shown again: Settings is never unmounted, and a refusal said in one visit greeted the next. Clear it when it opens, with a spec that closes and opens (#38).
- → A fix found while proving something else in the real app is still a rule without a spec: the run shows it once, and nothing holds it afterwards. Its spec is written, and seen failing against the old code, before the PR is opened: the message for a file that does not open went to review held only by a harness (#21).

- → `userEvent.dblClick` on a button that its first press replaces sends the second press to the element that is gone: the spec passes whatever the code does. In a browser the second press lands on the replacement, as a click whose `detail` is 2 — fire that (`fireEvent.click(button, { detail: 2 })`), and say what a harness proves: one that sends `clickCount: 2` over the DevTools protocol proves what the page does with a second press, not that a hand produces one (#32: a double click on the cross deleted unfinished bytes, and its spec would have been green).
- → A guard written for the pointer is tried on the keyboard's twin: a key held down repeats the press, as clicks whose `detail` is 0, and one gesture asks and answers itself. `userEvent.keyboard('{Enter>5/}')` is the spec; `event.repeat` is the guard, for the key that presses and no other: refusing every repeat stopped a held Tab on the first such button of the list (#32: a held Enter ran "Run" and deleted unfinished bytes; then its fix broke Tab).
- → A guard put in a shared component reaches every user of it: "ignore the second click of a double click", right for a button that asks, swallowed the quick presses of someone clearing finished rows, each landing on the cross that slid under the pointer (#32). Ask what each user of the component does with the gesture.
- → A spec is seen failing against the code it replaces, also when the code came first: the order "mark, then look at the name" was fixed in one round and claimed "by specs" with none; the spec written in the next was run against the old order before it was believed (#32).
- → "By specs" in a test plan is checked by deleting what the line claims is held: with `autoFocus` removed, the suite was still green (#32).

- → A control that changes size or place when it is pressed is tried with the pointer where the control will be, not only where it was: "Run" is wider than "Open", grew under a double click made beside it, and the next click of that burst answered it (#32).

- → A bound in a timing spec is set against what the code does without the thing held, not against what it does with it: "a pause under a limit takes less than a second" passed with the wait deaf to the pause, because one read at the floor is a second and the unguarded pause took 980 ms. Make what is owed several times the bound, and see the spec fail with the guard taken out (#44).
- → A spec written after its code is seen failing by taking the code's line away, one at a time — also the ones that "obviously" hold: a read made "when the engine is reached, and again when it comes back" stayed green with the read made at mount only, because the spec's connection never changed (#44; #51, again). A spec whose comment names two things has a case that fails for each: "emoji where the beginning is cut, and where the end that is kept begins" held the beginning only, because in every name ten units from the end fell between two characters (#51, a third time).
- → A number in a spec's comment, and in the PR body that quotes it, is counted from the run, not from the setting: eight connections were configured, and a file of four megabytes made four (#44).

## Docs and runbooks

- → Where a document of state — the roadmap, the README, a runbook's "Not there yet" — names what vouches for something (an ADR, a spec, a run, a record), the present is for what exists: "the ADR records it", "a spec holds that" for one still to write is a "done" nobody did. Write "has to" (#29, twice in one PR, the second time in the commit that fixed the first). A bare participle does the same: "Built and proven against a simulated service" reads as done beside lines where "Written, covered by specs" means it (#31). A planned item written in the present ("Choosing the folder") is not this.
- → A rule added to a process is checked against every other rule that decides the same thing: size was added to how the roles of a review are chosen, and the rule on a commit pushed after the approval still chose them by area alone (#27 — the slip of #17, a second time). Search the runbook for the thing decided ("role", "reviews again"), not for the words of the new rule. The roadmap is no different: "Linux comes after the first stable release" was added above a line that still listed Linux among what that release waits for (#31). And the "so that" of a decision is a statement of its own: "public shortly before the release, so that automatic updates are proven on a beta with installers" stood above a line that still called the stable release the first run of the installers job (#36). Search for when and where the thing happens, not for the words of the decision.
- → "No code changed" is not a reason to skip a gate: the five are run on every head, and the PR body carries their numbers (#27).
- → What a PR body gives to a follow-up issue is in that issue before the body is posted: "not verified (#43)" named, twice in one review, something #43 did not carry — the open list of a menu, then HTTPS — and a body stops being read the day its PR merges (#44; #51, again).

## Engine

- → A question to the system is tried for its "no", on the system it will run on: `access(folder, W_OK)` has none on Windows, where it says yes for every folder that exists — read-only attribute, denying access list, `C:\Program Files`. What has to be possible is proven by doing it: make a file, remove it (#38).
- → A name from a host that decides something is read as the system reads it, not as Scia numbers a copy: `setup.tar.exe` and a bare `.cmd` were not programs to a function that took `.tar.exe` as one extension and a leading dot as none. And a list that is a safety rule is drawn from the system (`PATHEXT`, `assoc`/`ftype`), not from memory: `vbs`, `js`, `hta`, `pif`, `lnk` run at a press (#32).
- → A vitest `?raw` import of a `.css` file comes back empty. A spec that needs the stylesheet's text reads it with `node:fs`, from a workspace that has Node types.
- → Two downloads added together race for the plain file name: a spec must not assume which one gets `name.ext` and which `name (1).ext`.
- → `IncomingMessage` must be destroyed, or drained, on every path that does not read it to the end: a redirect, a refused status. Otherwise the socket stays busy.

- → A wait added inside a loop is tried against every timer that already watches that loop, at the largest numbers the settings allow. A connection that waits its turn under a speed limit is silent to its socket: the 30 s idle timeout cut it and asked the host again, for every read, from 160 connections at 256 KB/s — and no spec with one download could see it (#44).
- → A limit is paid before the read, not after it, and a read is made only against room that covers it. Paid after, a loop that books past its "is this the end?" never booked the last read — a file that arrives in one read was not limited at all — and, once that was mended, every connection still took its first read unpaid and left it owed when its download was removed: 10 MB at once and then 40 s without a byte, at the most Settings allows. Paid before, but only when nothing was left of the last booking, the couple of hundred bytes an answer's headers leave let a whole read through: twice the limit while connections opened (#44).
- → A rate is proven against a host that sends as fast as it is read, and counted in bytes the engine took — not in bytes written, which lag, and not in the speed shown. A test host that pauses between pieces hid a limit passed twofold, in the specs and in the real app (#44).
- → A list of values is tried at both ends, and over the transport people use. Every run of the speed limit sat between 256 KB/s and 2 MB/s, over plain http; at 25 MB/s a read's turn is two milliseconds, a timer under sixteen takes sixteen on Windows, and a wait that ended late was lost for good: a download got a third of its limit, on every head of the PR, and less over HTTPS, where a read is a quarter the size — until the third round measured it (#44).
- → A guard that is taken away is searched for everything else it was guarding. The idle timer that left the socket was also what ended a redirect's drain and an answer nobody read (#44).
- → Nothing that paces or times out runs on `Date.now()`: the system's clock steps. `performance.now()` does not (#44).

## Electron

- → A page's `window.close()` destroys the window at once: Electron does not emit a preventable `close` for it. A harness that wants what the X does follows `docs/development/testing.md`, "Proving the real app".
- → A debugging port answers before the window has a page: a harness waits for a `page` target, not just for the port.
- → Node's `fetch` ends an answer whose body says nothing for 300 s, and a run shorter than the longest timer under a thing cannot show it: main's stream from an idle engine was cut every five minutes, and every run of the PR lasted one. A thing that lasts as long as the app is left alone for longer than every timer under it (#51).
- → A holder made for something shown once does not fit something shown many times: one variable kept the last notification, and by the comment beside it a notification nobody holds is collected with its click. Every one that can still be clicked is held (#51).
- → An end told from the one before only by a list in between is not told when the list does not come: a download that failed, was tried again and failed again within the quarter of a second between two lists failed once, to main. Say the limit, or have the source say when it happened (#51, #55).
- → `BrowserWindow.isVisible()` is false for a minimised window on Windows: "hidden in the tray" is not shown _and_ not minimised. A notification told a person whose window was on the taskbar that Scia was in the system tray; the run in the real app showed it, no spec could (#45).
- → `BrowserWindow.isFocused()` is what the window believes, not what the system says: on Windows a window shown while another is in use believes it is focused until it has really been used once and left. A notification meant for "not in front" stayed silent for a Scia that opened behind someone's work. A harness that wants a window in front, or not, reads the system's foreground window; it does not assume its own request worked — the author's could not take the focus from Scia in three ways, and reported the case as held elsewhere (#51, #62).
- → A fake answer in a spec does not end when its request is aborted, as a real one does: a reader that waits on a stream is closed by whoever reads it (`reader.cancel()`), not left to the request's signal. The specs of main's ear on the engine hung until it did (#45).
- → A very long profile path breaks Chromium's GPU cache (`The filename or extension is too long`). Harmless in a scratch folder; a sign to shorten the path, not a bug of the app.
- → Over the DevTools protocol, Enter presses a focused button only when its `keyDown` carries `text: '\r'`: without it the key arrives and nothing is pressed, and the harness proves nothing while looking as if it had.
- → A real double click over the DevTools protocol is two `mousePressed`/`mouseReleased` pairs at the same point with `clickCount` 1, then 2: `element.click()` from the page arrives with `detail` 0 and takes the roads a pointer never takes.

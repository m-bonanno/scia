# Gotchas — copy

For a change to a sentence a person reads — `apps/renderer/src/lib/messages.ts`, a status line, the extension's pages, main's notifications and dialogs — and to a code that chooses one. Read with the general entries of [`.claude/gotchas.md`](../gotchas.md); each entry's story is in the issues it names.

- → A change of wording or of language is finished when a search of the whole tree, the other apps included, finds nothing of the old words or of a section removed (`git grep -nE "[àèéìòù]"`), and every dialog was opened in the real app (#152).
- → A sentence that names a cause is shown for that cause alone: one `catch` around a call that rejects in five ways blamed a folder nobody had chosen (#38). Try a `catch` against every way the call rejects, and have the callee say which it was, as data.
- → A sentence written for a code is checked against everything the code covers, and a code that wraps another is mapped by what the wrapped one says of the cause (`retryable`, the status), never by the code alone (#38, #53, #65, #138, #228). A count that chooses a sentence counts what the sentence says (#303).

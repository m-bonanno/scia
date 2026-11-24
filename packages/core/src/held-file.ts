// On Windows a rename onto a file another process holds open fails, for as long as it holds it:
// an antivirus scanning it, the indexer, a backup (#151, #307). Every file Scia writes beside and
// renames into place waits for it, a while — the engine's and main's alike.
const HELD = new Set(['EPERM', 'EACCES', 'EBUSY']);
const TRIES = 40;
const WAIT_MS = 50;

function isHeld(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return typeof code === 'string' && HELD.has(code);
}

// The rename and the wait are handed in: the engine and main each do their own IO, and a spec its
// own clock. A refusal past the last try, or one waiting does not heal, is thrown as it came.
export async function renameWhenFree(
  rename: () => Promise<void>,
  wait: (ms: number) => Promise<unknown>,
): Promise<void> {
  for (let tries = 1; ; tries += 1) {
    try {
      await rename();
      return;
    } catch (error) {
      if (!isHeld(error) || tries >= TRIES) throw error;
      await wait(WAIT_MS);
    }
  }
}

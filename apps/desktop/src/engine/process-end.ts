export type Output = NodeJS.ReadableStream | null | undefined;

function ended(output: Output): Promise<void> {
  if (!output) return Promise.resolve();
  return new Promise((resolve) => {
    output.once('end', resolve);
    output.once('close', resolve);
  });
}

// The end of a child process as main sees it: its exit, and the last of what it wrote read from
// its outputs. Electron hears a utility process's exit on another channel than its pipes, so the
// exit can come before the last chunks are read — the engine's `stopped`, `shutdown_failed` or
// `state_not_saved` (#273). An output that a process of the child's own still holds open ends
// later, or never: given up on `limitMs` after the exit, answering false. Called as the process
// starts, before anything of its outputs can have ended.
export function endOfProcess(
  exited: Promise<number>,
  outputs: readonly Output[],
  limitMs: number,
): Promise<boolean> {
  const read = Promise.all(outputs.map(ended));
  return exited.then(
    () =>
      new Promise<boolean>((resolve) => {
        const limit = setTimeout(() => {
          resolve(false);
        }, limitMs);
        void read.then(() => {
          clearTimeout(limit);
          resolve(true);
        });
      }),
  );
}

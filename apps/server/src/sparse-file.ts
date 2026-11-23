import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Makes a new, empty part file sparse before its size is set (docs/adr/0026).
export type MarkSparse = (path: string) => Promise<void>;

export interface RunOptions {
  readonly timeout: number;
  readonly windowsHide: boolean;
  readonly env: Record<string, string>;
}

// Runs a program to its end; rejects when it fails, or when it is ended at its `timeout`.
export type RunProgram = (
  file: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<unknown>;

const execFileAsync = promisify(execFile);
export const runProgram: RunProgram = (file, args, options) =>
  execFileAsync(file, [...args], options);

// fsutil answers in tens of milliseconds; one that does not answer in this long is ended, and
// the file stays dense.
export const SPARSE_LIMIT_MS = 5000;

// On NTFS a file whose size is set ahead of its bytes is filled with zeros up to wherever a
// write lands, while that write waits: a write far into a large file waited half a minute
// (#182). A sparse file is not filled. Node has no call for the flag, so the system's own fsutil
// sets it — by its full path, with an environment built from nothing: the engine's has no PATH,
// and holds the API's token. Elsewhere a size set with `truncate` is a hole already, and nothing
// is asked.
export function sparseMarkerFor(
  platform: NodeJS.Platform,
  { run = runProgram, limitMs = SPARSE_LIMIT_MS }: { run?: RunProgram; limitMs?: number } = {},
): MarkSparse {
  if (platform !== 'win32') return () => Promise.resolve();
  return async (path) => {
    const systemRoot = process.env.SystemRoot;
    const fsutil =
      systemRoot === undefined ? 'fsutil.exe' : join(systemRoot, 'System32', 'fsutil.exe');
    await run(fsutil, ['sparse', 'setflag', path], {
      timeout: limitMs,
      windowsHide: true,
      env: systemRoot === undefined ? {} : { SystemRoot: systemRoot },
    });
  };
}

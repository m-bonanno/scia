import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Makes a new, empty part file sparse before its size is set (docs/adr/0026).
export type MarkSparse = (path: string) => Promise<void>;

// fsutil answers in tens of milliseconds; one that does not answer in this long is ended, and
// the file stays dense.
export const SPARSE_LIMIT_MS = 5000;

const run = promisify(execFile);

// On NTFS a file whose size is set ahead of its bytes is filled with zeros up to wherever a
// write lands, while that write waits: a write far into a large file waited half a minute
// (#182). A sparse file is not filled. Node has no call for the flag, so the system's own fsutil
// sets it — by its full path, with an environment built from nothing: the engine's has no PATH.
// Elsewhere a size set with `truncate` is a hole already, and nothing is asked.
export function sparseMarkerFor(platform: NodeJS.Platform, limitMs = SPARSE_LIMIT_MS): MarkSparse {
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

import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '../logger.ts';

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export async function scratchFolder(): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'scia-test-'));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

// Makes an existing folder refuse new files, as a read-only share or a system folder does;
// the function it answers gives the folder back, so that it can be removed. On Windows the
// refusal is an entry of the folder's access list (for everyone: no name of this computer's
// user is needed), elsewhere its permission bits.
export async function refusingFiles(folder: string): Promise<() => Promise<void>> {
  if (process.platform === 'win32') {
    const everyone = '*S-1-1-0';
    execFileSync('icacls', [folder, '/deny', `${everyone}:(WD,AD)`], { stdio: 'ignore' });
    return () => {
      execFileSync('icacls', [folder, '/remove:d', everyone], { stdio: 'ignore' });
      return Promise.resolve();
    };
  }
  await chmod(folder, 0o500);
  return () => chmod(folder, 0o700);
}

// Waits for something a download does in its own time, without a fixed sleep.
export async function until(condition: () => boolean, limitMs = 10_000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await sleep(10);
  }
}

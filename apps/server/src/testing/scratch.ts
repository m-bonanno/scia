import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
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

// Keeps every line logged, each as the JSON object a line of the engine's log is.
export function recordingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const log = (level: string) => (event: string, details?: object) => {
    lines.push(JSON.stringify({ level, event, ...details }));
  };
  return { lines, info: log('info'), warn: log('warn'), error: log('error') };
}

export async function scratchFolder(): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'scia-test-'));
  // Tried again a while: on Windows a process a spec just ended may let go of it a moment late.
  return {
    path,
    remove: () => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
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

// Keeps a folder from being removed, as a program still running from it does; the function it
// answers lets it go. On Windows a process working in the folder holds it; elsewhere nothing a
// process does stops a removal, and a folder that cannot be written stands in for it.
export async function holdingFolder(folder: string): Promise<() => Promise<void>> {
  if (process.platform === 'win32') {
    // Started is not yet in its folder: it says so once it runs, and then it holds the folder.
    const holder = spawn(
      process.execPath,
      ['-e', "process.stdout.write('held'); setTimeout(() => undefined, 30_000)"],
      { cwd: folder, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await once(holder.stdout, 'data');
    return async () => {
      if (holder.exitCode !== null || holder.signalCode !== null) return;
      const exited = once(holder, 'exit');
      holder.kill();
      await exited;
    };
  }
  await chmod(folder, 0o555);
  return () => chmod(folder, 0o755);
}

// What Windows' fsutil says of a file's sparse flag, in the system's words: a spec tells one
// file's answer from another's, never reads it for English.
export function sparseFlagOf(path: string): string {
  const fsutil = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'fsutil.exe');
  return execFileSync(fsutil, ['sparse', 'queryflag', path], { encoding: 'utf8' });
}

// Waits for something a download does in its own time, without a fixed sleep.
// The condition may have to ask something to know. On `performance.now()`: the system's clock
// steps (.claude/gotchas.md, #44).
export async function until(
  condition: () => boolean | Promise<boolean>,
  limitMs = 10_000,
): Promise<void> {
  const deadline = performance.now() + limitMs;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error('The condition never held.');
    await sleep(10);
  }
}

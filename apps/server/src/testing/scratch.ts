import { mkdtemp, rm } from 'node:fs/promises';
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

// Waits for something a download does in its own time, without a fixed sleep.
export async function until(condition: () => boolean, limitMs = 10_000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await sleep(10);
  }
}

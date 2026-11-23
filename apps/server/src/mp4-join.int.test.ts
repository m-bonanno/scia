import { copyFile, readFile, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageError } from './media-choice.ts';
import { joinIntoMp4 } from './mp4-join.ts';
import { scratchFolder } from './testing/scratch.ts';

const FIXTURES = join(import.meta.dirname, 'testing', 'pair');

describe('joinIntoMp4', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  const at = (name: string) => join(folder.path, name);

  beforeEach(async () => {
    folder = await scratchFolder();
    await copyFile(join(FIXTURES, 'picture.mp4'), at('picture'));
    await copyFile(join(FIXTURES, 'sound.m4a'), at('sound'));
  });
  afterEach(async () => {
    await folder.remove();
  });

  const failureOf = (attempt: Promise<unknown>) =>
    attempt.then(
      () => undefined,
      (error: unknown) => (error instanceof PageError ? error.failure : error),
    );

  it('writes the joined mp4 anew, whatever stood at its path', async () => {
    await writeFile(at('joined'), Buffer.alloc(1024 * 1024, 7));

    await joinIntoMp4(at('picture'), at('sound'), at('joined'), new AbortController().signal);

    const joined = await readFile(at('joined'));
    expect(joined.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(joined.byteLength).toBeLessThan(
      (await readFile(at('picture'))).byteLength + (await readFile(at('sound'))).byteLength,
    );
  });

  it('stops when it is told to', async () => {
    const stopped = new AbortController();
    stopped.abort(new Error('paused'));

    await expect(
      joinIntoMp4(at('picture'), at('sound'), at('joined'), stopped.signal),
    ).rejects.toThrow('paused');
  });

  it('refuses a file cut short as unreadable, and two of one kind as a format it does not join', async () => {
    const { size } = await stat(at('sound'));
    await truncate(at('sound'), size - 100);
    expect(
      await failureOf(
        joinIntoMp4(at('picture'), at('sound'), at('joined'), new AbortController().signal),
      ),
    ).toBe(PageFailure.Unreadable);

    expect(
      await failureOf(
        joinIntoMp4(at('picture'), at('picture'), at('joined'), new AbortController().signal),
      ),
    ).toBe(PageFailure.FormatUnsupported);
  });
});

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

  it('refuses fragmented files that keep samples in their movie, rather than join them without those samples', async () => {
    await copyFile(join(FIXTURES, 'picture-movie-samples.mp4'), at('picture'));
    await copyFile(join(FIXTURES, 'sound-movie-samples.m4a'), at('sound'));

    expect(
      await failureOf(
        joinIntoMp4(at('picture'), at('sound'), at('joined'), new AbortController().signal),
      ),
    ).toBe(PageFailure.FormatUnsupported);
  });

  it('refuses to hold more of a file in memory than its limits: a box, and all of them', async () => {
    // A plain sound's movie is over 100 bytes.
    expect(
      await failureOf(
        joinIntoMp4(at('picture'), at('sound'), at('joined'), new AbortController().signal, {
          mostReadBytes: 100,
          mostReadInAll: 1024 * 1024,
        }),
      ),
    ).toBe(PageFailure.FormatUnsupported);

    // Every box of a fragmented picture within the first, and all of them past the second.
    await copyFile(join(FIXTURES, 'picture-fragmented.mp4'), at('picture'));
    await copyFile(join(FIXTURES, 'sound-fragmented.m4a'), at('sound'));
    const limits = { mostReadBytes: 1024 * 1024, mostReadInAll: 1000 };
    expect(
      await failureOf(
        joinIntoMp4(at('picture'), at('sound'), at('joined'), new AbortController().signal, limits),
      ),
    ).toBe(PageFailure.FormatUnsupported);
    await joinIntoMp4(at('picture'), at('sound'), at('joined'), new AbortController().signal, {
      ...limits,
      mostReadInAll: 1024 * 1024,
    });
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

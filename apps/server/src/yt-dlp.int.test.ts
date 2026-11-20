import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageError } from './media-choice.ts';
import { scratchFolder } from './testing/scratch.ts';
import { YtDlp } from './yt-dlp.ts';

const FAKE = join(import.meta.dirname, 'testing', 'fake-yt-dlp.mjs');

describe('YtDlp against a process that answers as yt-dlp does', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let givenFile: string;
  const never = new AbortController().signal;

  beforeEach(async () => {
    folder = await scratchFolder();
    givenFile = join(folder.path, 'given.json');
  });
  afterEach(async () => {
    await folder.remove();
  });

  const reader = (timeoutMs = 10_000) =>
    new YtDlp({
      command: process.execPath,
      prefix: [FAKE, givenFile],
      timeoutMs,
      tempDir: join(folder.path, 'temp'),
    });
  const given = () =>
    JSON.parse(readFileSync(givenFile, 'utf8')) as {
      args: string[];
      env: Record<string, string>;
    };
  const failureOf = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (error: unknown) => (error instanceof PageError ? error.failure : error),
    );

  it('reads the formats of a page, with what the site calls the video', async () => {
    const media = await reader().read('https://site.example/video/1', never);

    expect(media?.title).toBe('A video');
    expect(media?.formats.map((format) => [format.url, format.height, format.protocol])).toEqual([
      ['https://cdn.example/low.mp4', 360, 'https'],
      ['https://cdn.example/high.mp4', 1080, 'https'],
    ]);
    expect(media?.formats[1]?.headers).toEqual({
      'User-Agent': 'Agent/1',
      Referer: 'https://site.example/',
    });
    expect(media?.formats[1]?.hasDrm).toBe(false);
  });

  it('takes a page whose one video has no list of formats as that one format', async () => {
    const media = await reader().read('https://site.example/one-url', never);

    expect(media?.formats).toEqual([
      expect.objectContaining({ url: 'https://cdn.example/one.webm', ext: 'webm', height: 480 }),
    ]);
  });

  it('never lets a site be guessed, a restriction be got around, a cookie or a setting of this computer be read', async () => {
    await reader().read('https://site.example/video/1', never);

    const { args } = given();
    const valueOf = (option: string) => args[args.indexOf(option) + 1];
    expect(args).toEqual(
      expect.arrayContaining([
        '--dump-single-json',
        '--no-playlist',
        '--ignore-config',
        '--no-cache-dir',
        '--no-cookies',
        '--no-cookies-from-browser',
      ]),
    );
    expect(valueOf('--use-extractors')).toBe('default,-generic');
    expect(valueOf('--xff')).toBe('never');
    expect(
      args.some((arg) => arg.startsWith('--cookies') && arg !== '--no-cookies-from-browser'),
    ).toBe(false);
    // The address last, after "--": an address that begins with a dash is not an option.
    expect(args.slice(-2)).toEqual(['--', 'https://site.example/video/1']);
  });

  it('hands yt-dlp nothing of the engine’s environment — not its token — but a folder for its temporary files', async () => {
    process.env.SCIA_API_TOKEN = 'the-engine-token-0000';
    try {
      await reader().read('https://site.example/video/1', never);
    } finally {
      delete process.env.SCIA_API_TOKEN;
    }

    const { env } = given();
    expect(JSON.stringify(env)).not.toContain('the-engine-token-0000');
    expect(Object.keys(env).filter((name) => name.startsWith('SCIA_'))).toEqual([]);
    // Each system's name for it: yt-dlp's builds unpack themselves there before they start.
    expect(env.TEMP).toBe(join(folder.path, 'temp'));
    expect(env.TMP).toBe(join(folder.path, 'temp'));
    expect(env.TMPDIR).toBe(join(folder.path, 'temp'));
  });

  it('answers nothing for a page of a site it does not know, so that the page is fetched as it stands', async () => {
    expect(await reader().read('https://other.example/unknown', never)).toBeUndefined();
    expect(await reader().read('https://other.example/unsupported', never)).toBeUndefined();
  });

  it('says why a video of a site it knows is not downloaded', async () => {
    expect(await failureOf(reader().read('https://site.example/drm', never))).toBe(PageFailure.Drm);
    for (const path of ['private', 'removed', 'geo']) {
      expect(await failureOf(reader().read(`https://site.example/${path}`, never)), path).toBe(
        PageFailure.VideoUnavailable,
      );
    }
    expect(await failureOf(reader().read('https://site.example/playlist', never))).toBe(
      PageFailure.Playlist,
    );
    expect(await failureOf(reader().read('https://site.example/other', never))).toBe(
      PageFailure.Unreadable,
    );
    expect(await failureOf(reader().read('https://site.example/garbage', never))).toBe(
      PageFailure.Unreadable,
    );
  });

  it('gives up a reader that says nothing in time, and one that cannot be started', async () => {
    const startedAt = Date.now();
    expect(await failureOf(reader(300).read('https://site.example/slow', never))).toBe(
      PageFailure.Unreadable,
    );
    expect(Date.now() - startedAt).toBeLessThan(5000);

    const missing = new YtDlp({
      command: join(folder.path, 'no-such-program.exe'),
      timeoutMs: 5000,
      tempDir: folder.path,
    });
    expect(await failureOf(missing.read('https://site.example/video/1', never))).toBe(
      PageFailure.Unreadable,
    );
  });

  it('stops reading when it is told to, with the reason it was given', async () => {
    const stopped = new AbortController();
    const reading = reader().read('https://site.example/slow', stopped.signal);
    setTimeout(() => {
      stopped.abort(new Error('paused'));
    }, 200);

    const startedAt = Date.now();
    await expect(reading).rejects.toThrow('paused');
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

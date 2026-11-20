import { existsSync, readFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageError } from './media-choice.ts';
import { scratchFolder, until } from './testing/scratch.ts';
import { YtDlp, type YtDlpOptions } from './yt-dlp.ts';

const FAKE = join(import.meta.dirname, 'testing', 'fake-yt-dlp.mjs');

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('YtDlp against a process that answers as yt-dlp does', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let givenFile: string;
  let tempDir: string;
  const never = new AbortController().signal;

  beforeEach(async () => {
    folder = await scratchFolder();
    givenFile = join(folder.path, 'given.json');
    tempDir = join(folder.path, 'temp');
  });
  afterEach(async () => {
    await folder.remove();
  });

  const reader = (options: Partial<YtDlpOptions> = {}) =>
    new YtDlp({
      command: process.execPath,
      prefix: [FAKE, givenFile],
      timeoutMs: 10_000,
      tempDir,
      ...options,
    });
  const given = () =>
    JSON.parse(readFileSync(givenFile, 'utf8')) as {
      args: string[];
      env: Record<string, string>;
      pid: number;
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

  it('takes from a site only what a format of a video is: a count of lines, a container of a video, the headers that are the site’s', async () => {
    const media = await reader().read('https://site.example/odd', never);
    const byUrl = new Map(media?.formats.map((format) => [format.url, format]));

    expect(byUrl.get('https://cdn.example/negative.mp4')?.height).toBeNull();
    expect(byUrl.get('https://cdn.example/half.mp4')?.height).toBeNull();
    expect(byUrl.get('https://cdn.example/huge.mp4')?.height).toBeNull();
    expect(byUrl.has('https://cdn.example/setup.exe')).toBe(false);
    // yt-dlp's "maybe": it cannot tell, and a video that may be protected is not taken.
    expect(byUrl.get('https://cdn.example/maybe.mp4')?.hasDrm).toBe(true);
    expect(byUrl.get('https://cdn.example/headers.mp4')?.headers).toEqual({
      'User-Agent': 'Agent/1',
    });
  });

  it('never lets a site be guessed, a restriction be got around, a cookie, a plugin or a setting of this computer be read', async () => {
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
        '--no-plugin-dirs',
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

  it('hands yt-dlp nothing of the engine’s environment — not its token — but a folder of its own for its temporary files', async () => {
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
    expect(env.TEMP?.startsWith(join(tempDir, 'scia-yt-dlp-'))).toBe(true);
    expect(env.TMP).toBe(env.TEMP);
    expect(env.TMPDIR).toBe(env.TEMP);
  });

  it('removes what yt-dlp unpacked, whether it ended by itself, was stopped or was given up', async () => {
    await reader().read('https://site.example/video/1', never);
    expect(await readdir(tempDir)).toEqual([]);

    await failureOf(reader({ timeoutMs: 300 }).read('https://site.example/slow', never));
    expect(await readdir(tempDir)).toEqual([]);

    await rm(givenFile);
    const stopped = new AbortController();
    const reading = reader().read('https://site.example/slow', stopped.signal);
    // Stopped once it has unpacked itself, as a pause in the middle of a read is.
    await until(() => existsSync(givenFile));
    stopped.abort(new Error('paused'));
    await expect(reading).rejects.toThrow('paused');
    expect(await readdir(tempDir)).toEqual([]);
  }, 20_000);

  it('answers nothing for a page of a site it does not know, so that the page is fetched as it stands', async () => {
    expect(await reader().read('https://other.example/unknown', never)).toBeUndefined();
    expect(await reader().read('https://other.example/unsupported', never)).toBeUndefined();
  });

  it('answers nothing for a page of a site it knows that plays no video, in yt-dlp’s own words, so that it is fetched as it stands', async () => {
    expect(await reader().read('https://archive.example/book', never)).toBeUndefined();
    expect(await reader().read('https://site.example/no-formats', never)).toBeUndefined();
    expect(await reader().read('https://site.example/audio', never)).toBeUndefined();
    expect(await reader().read('https://site.example/sound-only', never)).toBeUndefined();
  });

  it('takes a container of sound whose codec of picture the site names for a video, not for sound alone', async () => {
    expect(await failureOf(reader().read('https://site.example/picture-in-sound', never))).toBe(
      PageFailure.FormatUnsupported,
    );
  });

  it('reads a container however the site spells it', async () => {
    const media = await reader().read('https://site.example/capitals', never);
    expect(media?.formats.map((format) => format.ext)).toEqual(['mp4']);
    expect(await reader().read('https://site.example/mp3-in-capitals', never)).toBeUndefined();
  });

  it('never takes a video it cannot name the container of for a page with no video', async () => {
    expect(await failureOf(reader().read('https://site.example/other-container', never))).toBe(
      PageFailure.FormatUnsupported,
    );
    expect(await failureOf(reader().read('https://site.example/no-format-at-all', never))).toBe(
      PageFailure.Unreadable,
    );
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
    expect(await failureOf(reader().read('https://site.example/crash', never))).toBe(
      PageFailure.Unreadable,
    );
  });

  it('tells a site that is busy from a video that cannot be played', async () => {
    for (const path of ['busy', 'too-many']) {
      expect(await failureOf(reader().read(`https://site.example/${path}`, never)), path).toBe(
        PageFailure.SiteBusy,
      );
    }
  });

  it('reads the error yt-dlp stopped with, not its warnings', async () => {
    expect(await failureOf(reader().read('https://site.example/warned', never))).toBe(
      PageFailure.Unreadable,
    );
  });

  it('gives up, and ends, a reader that says nothing in time', async () => {
    const startedAt = Date.now();
    expect(
      await failureOf(reader({ timeoutMs: 300 }).read('https://site.example/slow', never)),
    ).toBe(PageFailure.SiteBusy);
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(isRunning(given().pid)).toBe(false);
  });

  it('gives up, and ends, a reader that says far too much', async () => {
    expect(
      await failureOf(reader({ mostOutputBytes: 1000 }).read('https://site.example/flood', never)),
    ).toBe(PageFailure.Unreadable);
    expect(isRunning(given().pid)).toBe(false);
  });

  it('stops a read told to stop before its reader has started', async () => {
    const stopped = new AbortController();
    const reading = reader().read('https://site.example/slow', stopped.signal);
    stopped.abort(new Error('paused'));

    const startedAt = Date.now();
    await expect(reading).rejects.toThrow('paused');
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('says a reader that cannot be started could not read the page', async () => {
    const missing = new YtDlp({
      command: join(folder.path, 'no-such-program.exe'),
      timeoutMs: 5000,
      tempDir,
    });
    expect(await failureOf(missing.read('https://site.example/video/1', never))).toBe(
      PageFailure.Unreadable,
    );
  });

  it('stops reading when it is told to, with the reason it was given, and ends the reader', async () => {
    const stopped = new AbortController();
    const reading = reader().read('https://site.example/slow', stopped.signal);
    await until(() => existsSync(givenFile));
    stopped.abort(new Error('paused'));

    const startedAt = Date.now();
    await expect(reading).rejects.toThrow('paused');
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(isRunning(given().pid)).toBe(false);
  });
});

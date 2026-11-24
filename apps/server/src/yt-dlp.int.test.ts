import type * as ChildProcesses from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PageFailure, TITLE_MOST_CHARS } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageError } from './media-choice.ts';
import { scratchFolder, until } from './testing/scratch.ts';
import { YtDlp, type YtDlpOptions } from './yt-dlp.ts';

// Every program the adapter starts runs as it would; a spec reads what it was given.
const spawned = vi.hoisted(() => [] as { command: string; env: NodeJS.ProcessEnv | undefined }[]);
vi.mock('node:child_process', async (original) => {
  const real = await original<typeof ChildProcesses>();
  const spawn = ((
    command: string,
    args: readonly string[],
    options: ChildProcesses.SpawnOptions,
  ) => {
    spawned.push({ command, env: options.env });
    return real.spawn(command, args, options);
  }) as typeof real.spawn;
  return { ...real, spawn };
});

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
  // What a read given up at its limit failed with, the limit on the spec's clock (#165): the
  // adapter's own timers move only once the reader has started, so a loaded machine slower to
  // start it than the limit never ends it before it wrote what it was given. The process, its
  // pipes and the spec's waits run as they do.
  async function givenUpAt(
    limitMs: number,
    read: () => Promise<unknown>,
    started: () => Promise<void> = () => until(() => existsSync(givenFile)),
  ): Promise<unknown> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled = false;
      // Set by the read as it settles, while the spec waits.
      const hasSettled = () => settled;
      const failure = failureOf(read()).finally(() => {
        settled = true;
      });
      await started();
      vi.advanceTimersByTime(limitMs);
      // The grace of a reader's output once it is ended, and no more: two seconds of the
      // adapter's time at most, far inside a longer limit.
      for (let step = 0; step < 40 && !hasSettled(); step += 1) {
        vi.advanceTimersByTime(50);
        await sleep(50);
      }
      await until(hasSettled);
      return await failure;
    } finally {
      vi.useRealTimers();
    }
  }

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

  it('reads a sound offered apart from its picture, in a container of sound, with its bitrate and the preference of its language', async () => {
    const media = await reader().read('https://site.example/apart', never);
    const byUrl = new Map(media?.formats.map((format) => [format.url, format]));

    expect(byUrl.get('https://cdn.example/sound.m4a')).toMatchObject({
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      bitrate: 129.5,
      languagePreference: 10,
    });
    expect(byUrl.get('https://cdn.example/total.m4a')?.bitrate).toBe(48);
    // What no bitrate or preference is, is none.
    expect(byUrl.get('https://cdn.example/odd.m4a')).toMatchObject({
      bitrate: null,
      languagePreference: null,
    });
    // A sound in what is no container of sound is no format.
    expect(byUrl.has('https://cdn.example/sound.exe')).toBe(false);
    expect(byUrl.get('https://cdn.example/picture.mp4')).toMatchObject({
      ext: 'mp4',
      acodec: 'none',
      bitrate: null,
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

    await rm(givenFile);
    await givenUpAt(300, () => reader({ timeoutMs: 300 }).read('https://site.example/slow', never));
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
    expect(
      await givenUpAt(300, () =>
        reader({ timeoutMs: 300 }).read('https://site.example/slow', never),
      ),
    ).toBe(PageFailure.SiteBusy);
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

  it('runs at each read the program named then: a build taken meanwhile reads the next page', async () => {
    let command = process.execPath;
    const updated = reader({ command: () => command });
    expect((await updated.read('https://site.example/video/1', never))?.title).toBe('A video');

    command = join(folder.path, 'the-build-taken-since.exe');
    expect(await failureOf(updated.read('https://site.example/video/1', never))).toBe(
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

  describe('the title of a page alone, for a ready row (#285)', () => {
    it('asks yt-dlp for the title alone, with everything it is always told and nothing of the engine’s', async () => {
      vi.stubEnv('SCIA_API_TOKEN', 'the-engine-token-0000');
      try {
        expect(await reader().readTitle('https://site.example/video/1', never)).toBe('A video');
      } finally {
        vi.unstubAllEnvs();
      }

      const { args, env } = given();
      const valueOf = (option: string) => args[args.indexOf(option) + 1];
      expect(args).toEqual(
        expect.arrayContaining([
          '--no-playlist',
          '--flat-playlist',
          '--ignore-config',
          '--no-cache-dir',
          '--no-cookies',
          '--no-cookies-from-browser',
          '--no-plugin-dirs',
        ]),
      );
      // Printed, not dumped: the title on a line, and none of the page's formats.
      expect(valueOf('--print')).toBe('%(title)j');
      expect(args).not.toContain('--dump-single-json');
      expect(valueOf('--use-extractors')).toBe('default,-generic');
      expect(valueOf('--xff')).toBe('never');
      expect(
        args.some((arg) => arg.startsWith('--cookies') && arg !== '--no-cookies-from-browser'),
      ).toBe(false);
      expect(args.slice(-2)).toEqual(['--', 'https://site.example/video/1']);
      expect(JSON.stringify(env)).not.toContain('the-engine-token-0000');
      expect(env.TEMP?.startsWith(join(tempDir, 'scia-yt-dlp-'))).toBe(true);
      expect(await readdir(tempDir)).toEqual([]);
    });

    it('reads a title past ASCII as yt-dlp escapes it', async () => {
      expect(await reader().readTitle('https://site.example/far-title', never)).toBe(
        String.fromCodePoint(0xc9, 0x20, 0x6771, 0x4eac, 0x20, 0x1f3ac),
      );
    });

    it('makes a title one line of text, cut to the most a row shows', async () => {
      const title = await reader().readTitle('https://site.example/long-title', never);

      expect(title).toHaveLength(TITLE_MOST_CHARS);
      expect(title?.startsWith('<b>Long</b> trip trip')).toBe(true);
      // No line break, no control character: one line of text.
      expect(title).not.toMatch(/[\r\n]/);
      expect(title).not.toContain(String.fromCharCode(7));
    });

    it('takes the title yt-dlp makes for a video its site names not', async () => {
      expect(await reader().readTitle('https://site.example/no-title', never)).toBe(
        'example video #v1',
      );
    });

    it('answers no title for a page of a site it does not know, a page that says nothing, or a list', async () => {
      expect(await reader().readTitle('https://other.example/unknown', never)).toBeUndefined();
      expect(await reader().readTitle('https://site.example/says-nothing', never)).toBeUndefined();
      expect(await failureOf(reader().readTitle('https://site.example/playlist', never))).toBe(
        PageFailure.Playlist,
      );
    });

    it('says why a site would not give the title', async () => {
      expect(await failureOf(reader().readTitle('https://site.example/private', never))).toBe(
        PageFailure.VideoUnavailable,
      );
      expect(await failureOf(reader().readTitle('https://site.example/garbage', never))).toBe(
        PageFailure.Unreadable,
      );
      expect(await failureOf(reader().readTitle('https://site.example/number-title', never))).toBe(
        PageFailure.Unreadable,
      );
    });

    it('gives a title thirty seconds when it is told no other time', async () => {
      // Only the adapter's own timers are the spec's: the process, its pipes and the waits of the
      // spec run as they do.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        let outcome: unknown = 'reading';
        const reading = reader({ timeoutMs: 1000 })
          .readTitle('https://site.example/slow', never)
          .then(
            () => 'answered',
            (error: unknown) => (error instanceof PageError ? error.failure : error),
          )
          .then((settled) => {
            outcome = settled;
          });
        await until(() => existsSync(givenFile));

        vi.advanceTimersByTime(29_999);
        await until(() => isRunning(given().pid));
        expect(outcome).toBe('reading');

        vi.advanceTimersByTime(1);
        // The grace of a reader's output once it is ended, and no more: two seconds of the
        // adapter's time at most, far inside a longer limit.
        for (let step = 0; step < 40 && outcome === 'reading'; step += 1) {
          vi.advanceTimersByTime(50);
          await sleep(100);
        }
        expect(outcome).toBe(PageFailure.SiteBusy);
        await reading;
      } finally {
        vi.useRealTimers();
      }
    }, 20_000);

    it('gives up, and ends, a reader that says nothing in its own time, not the time of a whole read', async () => {
      expect(
        await givenUpAt(300, () =>
          reader({ timeoutMs: 60_000, titleTimeoutMs: 300 }).readTitle(
            'https://site.example/slow',
            never,
          ),
        ),
      ).toBe(PageFailure.SiteBusy);
      expect(isRunning(given().pid)).toBe(false);
    });

    it('gives up, and ends, a reader whose title runs on past what a title can be', async () => {
      expect(await failureOf(reader().readTitle('https://site.example/title-flood', never))).toBe(
        PageFailure.Unreadable,
      );
      expect(isRunning(given().pid)).toBe(false);
    });

    it('stops reading the title when it is told to, and ends the reader', async () => {
      const stopped = new AbortController();
      const reading = reader().readTitle('https://site.example/slow', stopped.signal);
      await until(() => existsSync(givenFile));
      stopped.abort(new Error('started'));

      await expect(reading).rejects.toThrow('started');
      expect(isRunning(given().pid)).toBe(false);
      expect(await readdir(tempDir)).toEqual([]);
    });
  });

  describe('a reader whose second process holds its output, as yt-dlp’s Windows build runs (#170)', () => {
    const holderPid = () => Number(readFileSync(`${givenFile}.holder`, 'utf8'));
    let holders: number[] = [];
    afterEach(() => {
      vi.unstubAllEnvs();
      for (const pid of holders) {
        if (isRunning(pid)) process.kill(pid);
      }
      holders = [];
    });
    const started = async () => {
      await until(() => existsSync(`${givenFile}.holder`));
      holders.push(holderPid());
    };

    it('stops when told to, and ends the second process with the first', async () => {
      const stopped = new AbortController();
      const reading = reader().read('https://site.example/two-processes', stopped.signal);
      await started();
      stopped.abort(new Error('paused'));

      const startedAt = Date.now();
      await expect(reading).rejects.toThrow('paused');
      expect(Date.now() - startedAt).toBeLessThan(5000);
      expect(isRunning(given().pid)).toBe(false);
      await until(() => !isRunning(holderPid()));
      expect(await readdir(tempDir)).toEqual([]);
    });

    it('gives up in time, and ends the second process with the first', async () => {
      expect(
        await givenUpAt(
          1000,
          () => reader({ timeoutMs: 1000 }).read('https://site.example/two-processes', never),
          started,
        ),
      ).toBe(PageFailure.SiteBusy);
      await until(() => !isRunning(holderPid()));
    });

    it('stops when told to also while a process it cannot reach still holds its output', async () => {
      const stopped = new AbortController();
      const reading = reader().read('https://site.example/orphaned-holder', stopped.signal);
      await started();
      stopped.abort(new Error('paused'));

      const startedAt = Date.now();
      await expect(reading).rejects.toThrow('paused');
      expect(Date.now() - startedAt).toBeLessThan(5000);
      expect(await readdir(tempDir)).toEqual([]);
    });

    it.runIf(process.platform === 'win32')(
      'hands taskkill nothing of the engine’s environment — not its token',
      async () => {
        const stopped = new AbortController();
        spawned.length = 0;
        vi.stubEnv('SCIA_API_TOKEN', 'the-engine-token-0000');
        const reading = reader().read('https://site.example/two-processes', stopped.signal);
        await started();
        stopped.abort(new Error('paused'));
        await expect(reading).rejects.toThrow('paused');

        const taskkill = spawned.filter(({ command }) => /taskkill\.exe$/i.test(command));
        expect(taskkill).toHaveLength(1);
        expect(JSON.stringify(taskkill[0]?.env)).not.toContain('the-engine-token-0000');
        expect(Object.keys(taskkill[0]?.env ?? {})).toEqual(['SystemRoot']);
      },
    );

    it.runIf(process.platform === 'win32')(
      'stops the reader as it can when taskkill cannot be started',
      async () => {
        const stopped = new AbortController();
        const reading = reader().read('https://site.example/two-processes', stopped.signal);
        await started();
        // Only now, after yt-dlp started with its own: taskkill is looked for at the stop.
        vi.stubEnv('SystemRoot', join(folder.path, 'no-windows-here'));
        stopped.abort(new Error('paused'));

        const startedAt = Date.now();
        await expect(reading).rejects.toThrow('paused');
        expect(Date.now() - startedAt).toBeLessThan(5000);
        expect(isRunning(given().pid)).toBe(false);
      },
    );

    it('gives up in time a reader whose first process ended by itself and left the second holding its output', async () => {
      const firstGone = async () => {
        await started();
        await until(() => !isRunning(given().pid));
      };
      expect(
        await givenUpAt(
          1000,
          () => reader({ timeoutMs: 1000 }).read('https://site.example/first-gone', never),
          firstGone,
        ),
      ).toBe(PageFailure.SiteBusy);
    });
  });
});

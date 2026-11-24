import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../scripts/captures/decode-png.ts';
import { encodeGif, type Frame } from '../scripts/captures/gif.ts';
import {
  allCompleted,
  drawnCompleted,
  paste,
  rowOf,
  until,
  useRun,
  type Run,
  type Scia,
} from './scia.ts';
import { captureTo, scrollsAround } from './under-notices.ts';

const MIB = 1024 * 1024;
// The loop's page: as wide as the README's column on GitHub, which then draws it at its size, and
// tall enough for three rows in progress and the room under the list: at 450 a scrollbar came and
// went beside them.
const WIDTH = 760;
const HEIGHT = 480;
// Frames closer than this are not told apart by a viewer, and each one makes the file larger.
const FRAME_MS = 100;
// How long the loop holds its first picture, the empty list, and its last, every file done.
const OPENING_MS = 1_000;
const CLOSING_MS = 2_000;
// The length #310 asks of the loop.
const SHORTEST_LOOP_MS = 5_000;
const LONGEST_LOOP_MS = 10_000;
// The owner's choice on #313: the loop plays two or three times, then stays on its last frame, the
// three files completed. Twice: a reader who arrives during the first play sees the second whole.
const PLAYS = 2;
// Text drawn in greys, as on a screen without ClearType: a GIF holds 256 colours a frame, and
// ClearType's coloured edges are thousands.
const GREY_TEXT = '--disable-lcd-text';

interface Shot {
  readonly png: Buffer;
  readonly at: number;
}

interface PublicFile {
  readonly name: string;
  readonly url: string;
}

// A file named after a public one and about its size, served by a host of this computer: fast
// enough for the loop to last seconds and slow enough for its connections to be seen filling the
// bar. Its link ends in its name, as a public file's does: a row is named from the link until the
// host answers, and a loop CI took opened on three rows of the test host's own path.
async function publicFile(run: Run, name: string, sizeMiB: number): Promise<PublicFile> {
  const host = run.keep(
    await startRangeServer({
      body: randomBytes(sizeMiB * MIB),
      fileName: name,
      chunkBytes: 96 * 1024,
      chunkDelayMs: 50,
    }),
  );
  return { name, url: new URL(encodeURIComponent(name), host.url).href };
}

// The page captured again and again, each capture timed when it was asked for, from the page
// before anything moves until the spec stops it; then once more, so that the last picture is the
// page the spec saw settled. A screencast of the DevTools protocol drops the frames still on their
// way when it is stopped: a loop CI took that way ended on a download at 94%.
async function filmOf(page: Page) {
  const shots: Shot[] = [];
  let filming = true;
  const stillFilming = () => filming;
  const shoot = async () => {
    const at = performance.now();
    shots.push({ png: await page.screenshot(), at });
  };
  await shoot();
  const film = (async () => {
    while (stillFilming()) await shoot();
  })();
  // Heard here, so that a spec that fails before it stops the film leaves no rejection unheard;
  // `stop` still says a capture that failed.
  film.catch(() => undefined);
  return {
    stop: async (): Promise<Shot[]> => {
      filming = false;
      await film;
      await shoot();
      return shots;
    },
    // Ends the film whatever became of it, before the app is closed under it.
    halt: async (): Promise<void> => {
      filming = false;
      await film.catch(() => undefined);
    },
  };
}

// The frames a viewer is shown: one every FRAME_MS at most, each for as long as the page kept it.
// The last capture, the page settled, takes the place of a frame kept less than FRAME_MS before it.
function paced(shots: readonly Shot[]): Frame[] {
  const spaced: Shot[] = [];
  for (const shot of shots) {
    const last = spaced.at(-1);
    if (last === undefined || shot.at - last.at >= FRAME_MS) spaced.push(shot);
  }
  const settled = shots.at(-1);
  if (settled !== undefined && spaced.at(-1) !== settled) {
    if (spaced.length > 1) spaced.pop();
    spaced.push(settled);
  }
  return spaced.map((shot, index) => {
    const next = spaced[index + 1];
    const shown = next === undefined ? CLOSING_MS : next.at - shot.at;
    return { picture: decodePng(shot.png), ms: index === 0 ? Math.max(shown, OPENING_MS) : shown };
  });
}

// The window itself sized, not the page's viewport: the title bar is laid out by the window's own
// width, and a viewport narrower than the window left Settings and the speed outside the loop.
async function windowOf(scia: Scia, width: number, height: number): Promise<void> {
  await scia.app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(w, h);
    },
    [width, height] as const,
  );
  await until(() =>
    scia.page.evaluate(([w, h]) => window.innerWidth === w && window.innerHeight === h, [
      width,
      height,
    ] as const),
  );
}

// Nothing under the pointer, the variant asked for drawn, and nothing moving but bars filling.
async function settled(page: Page, variant: 'dark' | 'light'): Promise<void> {
  await page.mouse.move(1, 1);
  await until(() =>
    page.evaluate(
      (scheme) =>
        matchMedia(`(prefers-color-scheme: ${scheme})`).matches &&
        document
          .getAnimations()
          .every(
            (animation) =>
              animation instanceof CSSTransition && animation.transitionProperty === 'width',
          ),
      variant,
    ),
  );
}

describe('Scia at work, the loop of the README', () => {
  const run = useRun();

  // Files named after public ones, never a streaming site's video: the front window respects the
  // hosts too.
  it.each(['dark', 'light'] as const)(
    'takes the loop of three files pasted and downloaded, in the %s variant',
    async (variant) => {
      const profile = await run.profile();
      const files = [
        await publicFile(run, 'TinyCore-current.iso', 25),
        await publicFile(run, 'vlc-3.0.21-win64.exe', 42),
        await publicFile(run, 'BigBuckBunny_320x180.mp4', 62),
      ];
      const scia = await run.launch(profile, { args: [GREY_TEXT] });
      const { page } = scia;
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await windowOf(scia, WIDTH, HEIGHT);
      await settled(page, variant);
      // The whole title bar is in the loop, and nothing of the page lies beside it.
      const settings = await page.getByRole('button', { name: 'Settings' }).boundingBox();
      expect(settings).not.toBeNull();
      expect((settings?.x ?? WIDTH) + (settings?.width ?? 0)).toBeLessThanOrEqual(WIDTH);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(WIDTH);

      const film = await filmOf(page);
      let shots: Shot[];
      try {
        await paste(page, ...files.map((file) => file.url));
        // The rows are named after their files from the first list the page draws.
        await until(async () => (await page.getByRole('main').getByRole('listitem').count()) > 0);
        for (const { name } of files) expect(await rowOf(page, name).count()).toBe(1);
        // The rows in progress, the tallest they are, fit the page: no scrollbar comes and goes.
        expect(await scrollsAround(page.getByRole('main').getByRole('list'))).toBe(false);
        await until(() => allCompleted(page), 60_000);
        await until(async () => (await drawnCompleted(page)) === files.length);
        await settled(page, variant);
        shots = await film.stop();
      } finally {
        await film.halt();
      }
      const frames = paced(shots);

      expect(frames.length).toBeGreaterThan(10);
      for (const { picture } of frames)
        expect([picture.width, picture.height]).toEqual([WIDTH, HEIGHT]);
      const length = frames.reduce((sum, frame) => sum + frame.ms, 0);
      expect(length).toBeGreaterThanOrEqual(SHORTEST_LOOP_MS);
      expect(length).toBeLessThanOrEqual(LONGEST_LOOP_MS);
      const name = variant === 'dark' ? 'scia-at-work.gif' : 'scia-at-work-light.gif';
      await writeFile(await captureTo(name), encodeGif(frames, { plays: PLAYS }));
    },
  );
});

import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { decodePng, encodeApng, type Frame } from '../scripts/captures/apng.ts';
import { allCompleted, drawnCompleted, paste, until, useRun, type Run } from './scia.ts';
import { captureTo, viewportOf } from './under-notices.ts';

const MIB = 1024 * 1024;
// The loop's page: wide enough for a row's name, bar and speed, short enough for three rows.
const WIDTH = 1040;
const HEIGHT = 520;
// Frames closer than this are not told apart by a viewer, and each one makes the file larger.
const FRAME_MS = 100;
// How long the loop holds its first picture, the empty list, and its last, every file done.
const OPENING_MS = 1_500;
const CLOSING_MS = 3_000;

interface Shot {
  readonly png: Buffer;
  readonly at: number;
}

// A public file served by a host of this computer, fast enough for the loop to last seconds and
// slow enough for its connections to be seen filling the bar.
async function publicFile(run: Run, fileName: string, sizeMiB: number) {
  return run.keep(
    await startRangeServer({
      body: randomBytes(sizeMiB * MIB),
      fileName,
      chunkBytes: 96 * 1024,
      chunkDelayMs: 100,
    }),
  );
}

// The page as Chromium draws it, over the DevTools protocol: a frame each time it changes, timed
// when it arrives. The first picture is the page before anything moves.
async function filmOf(page: Page) {
  const shots: Shot[] = [{ png: await page.screenshot(), at: performance.now() }];
  const protocol = await page.context().newCDPSession(page);
  protocol.on('Page.screencastFrame', ({ data, sessionId }) => {
    shots.push({ png: Buffer.from(data, 'base64'), at: performance.now() });
    void protocol.send('Page.screencastFrameAck', { sessionId });
  });
  await protocol.send('Page.startScreencast', {
    format: 'png',
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
  });
  return async (): Promise<Shot[]> => {
    await protocol.send('Page.stopScreencast');
    await protocol.detach();
    return shots;
  };
}

// The frames a viewer is shown: one every FRAME_MS at most, each for as long as the page kept it.
function paced(shots: readonly Shot[]): Frame[] {
  const spaced: Shot[] = [];
  for (const [index, shot] of shots.entries()) {
    const last = spaced.at(-1);
    if (last === undefined || index === shots.length - 1 || shot.at - last.at >= FRAME_MS)
      spaced.push(shot);
  }
  return spaced.map((shot, index) => {
    const next = spaced[index + 1];
    const shown = next === undefined ? CLOSING_MS : next.at - shot.at;
    return { picture: decodePng(shot.png), ms: index === 0 ? Math.max(shown, OPENING_MS) : shown };
  });
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

  // Public files only, named as their sites name them: the front window respects the hosts too.
  it.each(['dark', 'light'] as const)(
    'takes the loop of three files pasted and downloaded, in the %s variant',
    async (variant) => {
      const profile = await run.profile();
      const files = [
        await publicFile(run, 'ubuntu-26.04-desktop-amd64.iso', 48),
        await publicFile(run, 'LibreOffice_26.2_Win_x86-64.msi', 24),
        await publicFile(run, 'Big Buck Bunny 1080p.mkv', 36),
      ];
      const scia = await run.launch(profile);
      const { page } = scia;
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await viewportOf(page, WIDTH, HEIGHT);
      await settled(page, variant);

      const stop = await filmOf(page);
      await paste(page, ...files.map((file) => file.url));
      await until(() => allCompleted(page), 60_000);
      await until(async () => (await drawnCompleted(page)) === files.length);
      await settled(page, variant);
      const frames = paced(await stop());

      expect(frames.length).toBeGreaterThan(10);
      for (const { picture } of frames)
        expect([picture.width, picture.height]).toEqual([WIDTH, HEIGHT]);
      const name = variant === 'dark' ? 'scia-at-work.png' : 'scia-at-work-light.png';
      await writeFile(await captureTo(name), encodeApng(frames));
    },
  );
});

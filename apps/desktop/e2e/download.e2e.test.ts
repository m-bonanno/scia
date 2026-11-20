import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type RangeServer, startRangeServer } from '@scia/server/testing/range-server.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { launchScia, paste, type Profile, rowOf, type Scia, scratchProfile } from './scia.ts';

describe('the real app downloads', () => {
  let profile: Profile;
  let scia: Scia | undefined;
  let host: RangeServer | undefined;

  afterEach(async () => {
    await scia?.app.close().catch(() => undefined);
    await host?.close();
    await profile.remove();
    scia = undefined;
    host = undefined;
  });

  it('starts, and its engine serves the page on the port it took', async () => {
    profile = await scratchProfile();

    scia = await launchScia(profile);

    const log = await profile.log();
    expect(log).toContain('engine_ready');
    expect(log).not.toMatch(/\[error\]/);
    expect(scia.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('fetches a pasted link over several connections, byte for byte', async () => {
    profile = await scratchProfile();
    const body = randomBytes(8 * 1024 * 1024);
    host = await startRangeServer({ body, fileName: 'sample.bin' });
    scia = await launchScia(profile);

    await paste(scia.page, host.url);

    await rowOf(scia.page, 'sample.bin')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 30_000 });
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
    expect(
      host.ranges.filter((range) => range !== undefined && range !== 'bytes=0-0').length,
    ).toBeGreaterThan(1);
  });
});

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { describe, expect, it } from 'vitest';
import { paste, rowOf, useRun } from './scia.ts';

describe('the real app downloads', () => {
  const run = useRun();

  it('starts, and its engine serves the page on the port it took', async () => {
    const profile = await run.profile();

    const scia = await run.launch(profile);

    const log = await profile.log();
    expect(log).toContain('engine_ready');
    expect(log).not.toMatch(/\[error\]/);
    expect(scia.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('fetches a pasted link over several connections, byte for byte', async () => {
    const profile = await run.profile();
    const body = randomBytes(8 * 1024 * 1024);
    const host = run.keep(await startRangeServer({ body, fileName: 'sample.bin' }));
    const scia = await run.launch(profile);

    await paste(scia.page, host.url);

    await rowOf(scia.page, 'sample.bin')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 30_000 });
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
    // Besides the probe of the first byte, the host was asked for more than one range.
    const ranges = host.ranges.filter((range) => range !== undefined && range !== 'bytes=0-0');
    expect(ranges.length).toBeGreaterThan(1);
  });
});

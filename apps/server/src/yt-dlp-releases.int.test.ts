import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchFolder } from './testing/scratch.ts';
import { type ReleasesServer, startReleasesServer } from './testing/yt-dlp-releases-server.ts';
import { ReleaseError, YtDlpReleases } from './yt-dlp-releases.ts';

describe('YtDlpReleases against a host that answers as github.com does', () => {
  let host: ReleasesServer;
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  const never = new AbortController().signal;
  const build = Buffer.alloc(300 * 1024, 7);

  beforeEach(async () => {
    host = await startReleasesServer();
    folder = await scratchFolder();
    host.latest = '2026.11.18';
    host.releases.set('2026.11.18', { 'yt-dlp.exe': build, 'SHA2-256SUMS': Buffer.from('sums') });
  });
  afterEach(async () => {
    await host.close();
    await folder.remove();
  });

  const releases = (silenceMs = 5_000) =>
    new YtDlpReleases({ address: host.address, userAgent: 'Scia/test', silenceMs });

  it('reads the latest release from where its redirect points, without following it', async () => {
    await expect(releases().latest(never)).resolves.toBe('2026.11.18');
    expect(host.asked).toEqual(['/releases/latest']);
  });

  it('refuses a latest release whose name is not one of yt-dlp', async () => {
    host.latest = '..%2F..%2Fevil';
    await expect(releases().latest(never)).rejects.toBeInstanceOf(ReleaseError);
    host.latest = undefined;
    await expect(releases().latest(never)).rejects.toBeInstanceOf(ReleaseError);
    host.latest = '2026.11.18';
    host.misbehave = 'no-redirect';
    await expect(releases().latest(never)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('fails, and does not wait for ever, on a host that is busy or silent', async () => {
    host.misbehave = 'busy';
    await expect(releases().latest(never)).rejects.toBeInstanceOf(ReleaseError);
    host.misbehave = 'silent';
    await expect(releases(200).latest(never)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('reads a small file of a release, following the redirect to its bytes', async () => {
    await expect(releases().file('2026.11.18', 'SHA2-256SUMS', 1024, never)).resolves.toEqual(
      Buffer.from('sums'),
    );
  });

  it('refuses a small file larger than it may be, and one the release does not have', async () => {
    await expect(releases().file('2026.11.18', 'SHA2-256SUMS', 3, never)).rejects.toBeInstanceOf(
      ReleaseError,
    );
    await expect(releases().file('2026.11.18', 'nothing', 1024, never)).rejects.toBeInstanceOf(
      ReleaseError,
    );
  });

  it('saves a build to a file and says the checksum of what it wrote', async () => {
    const path = join(folder.path, 'yt-dlp.exe.part');
    const sum = await releases().save('2026.11.18', 'yt-dlp.exe', path, 1024 * 1024, never);
    expect(sum).toBe(createHash('sha256').update(build).digest('hex'));
    expect(await readFile(path)).toEqual(build);
  });

  it('stops saving a build larger than it may be, and removes what it wrote', async () => {
    const path = join(folder.path, 'yt-dlp.exe.part');
    await expect(
      releases().save('2026.11.18', 'yt-dlp.exe', path, 100 * 1024, never),
    ).rejects.toBeInstanceOf(ReleaseError);
    expect(existsSync(path)).toBe(false);
  });

  it('stops when told to, midway through a build, and removes what it wrote', async () => {
    host.pieceDelayMs = 50;
    const path = join(folder.path, 'yt-dlp.exe.part');
    const stop = new AbortController();
    const saving = releases().save('2026.11.18', 'yt-dlp.exe', path, 1024 * 1024, stop.signal);
    setTimeout(() => {
      stop.abort();
    }, 60);
    await expect(saving).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it('waits on a host as long as it keeps sending, however long the whole takes', async () => {
    host.pieceDelayMs = 100;
    const path = join(folder.path, 'yt-dlp.exe.part');
    const sum = await releases(400).save('2026.11.18', 'yt-dlp.exe', path, 1024 * 1024, never);
    expect(sum).toBe(createHash('sha256').update(build).digest('hex'));
  });

  it('gives a build up when its host goes silent midway', async () => {
    host.pieceDelayMs = 1_000;
    const path = join(folder.path, 'yt-dlp.exe.part');
    await expect(
      releases(200).save('2026.11.18', 'yt-dlp.exe', path, 1024 * 1024, never),
    ).rejects.toBeInstanceOf(ReleaseError);
    expect(existsSync(path)).toBe(false);
  });

  it('sends its own user agent and asks for no compressed body', async () => {
    const seen: Record<string, string | undefined>[] = [];
    const { createServer } = await import('node:http');
    const server = createServer((request, response) => {
      seen.push({ ua: request.headers['user-agent'], enc: request.headers['accept-encoding'] });
      response.writeHead(302, { location: '/releases/tag/2026.11.18' }).end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const where = server.address();
    const port = typeof where === 'object' && where !== null ? where.port : 0;
    const client = new YtDlpReleases({
      address: `http://127.0.0.1:${String(port)}`,
      userAgent: 'Scia/1.2.3',
    });
    await client.latest(never);
    server.close();
    expect(seen).toEqual([{ ua: 'Scia/1.2.3', enc: 'identity' }]);
  });
});

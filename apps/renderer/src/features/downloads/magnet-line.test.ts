import type { Magnet } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { magnetLine } from './magnet-line.ts';

const fetching: Magnet = {
  id: 'm1',
  name: 'Holiday films',
  status: 'fetching',
  totalBytes: 4 * 1024 * 1024,
  downloadedBytes: 1024 * 1024,
  bytesPerSecond: 512 * 1024,
  failure: null,
  createdAt: '2026-11-21T12:00:00.000Z',
};

describe('magnetLine', () => {
  it('says the magnet is on its way to the service, before the service says what it has', () => {
    expect(magnetLine({ ...fetching, status: 'sending', totalBytes: null })).toBe(
      'Sending to AllDebrid…',
    );
  });

  it('says the service is fetching it, and no size, before the service has read the torrent', () => {
    expect(magnetLine({ ...fetching, totalBytes: null, downloadedBytes: 0 })).toBe(
      'AllDebrid is fetching it',
    );
  });

  it('says how far the service is with it, and how fast', () => {
    expect(magnetLine(fetching)).toMatch(
      /^AllDebrid is fetching it · 25\s?% · 1\.0\sMB of 4\.0\sMB · 512\sKB\/s$/,
    );
  });

  it('says the service is not answering while Scia keeps asking, and why one failed', () => {
    expect(magnetLine({ ...fetching, failure: 'SERVICE_UNAVAILABLE' })).toBe(
      'Scia could not ask AllDebrid about this magnet just now. It asks again in a moment.',
    );
    expect(magnetLine({ ...fetching, status: 'failed', failure: 'SERVICE_NEEDED' })).toBe(
      'This is a magnet: Scia downloads magnets through AllDebrid. Connect AllDebrid in Settings, then try again.',
    );
    expect(magnetLine({ ...fetching, status: 'failed', failure: 'MAGNET_FAILED' })).toBe(
      'AllDebrid could not fetch this magnet. Try again later.',
    );
  });
});

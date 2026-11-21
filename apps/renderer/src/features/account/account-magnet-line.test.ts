import type { AccountMagnet } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { accountMagnetLine } from './account-magnet-line.ts';

const MIB = 1024 * 1024;
const ready: AccountMagnet = {
  id: 7,
  name: 'Holiday films',
  stage: 'ready',
  totalBytes: 24 * MIB,
  downloadedBytes: 24 * MIB,
  bytesPerSecond: 0,
  addedAt: '2026-11-21T12:00:00.000Z',
  inScia: false,
};

describe('accountMagnetLine', () => {
  it('says a magnet is ready, and how large', () => {
    expect(accountMagnetLine(ready)).toMatch(/^Ready · 24\.0\sMB$/);
  });

  it('says how far AllDebrid is with one it fetches, and how fast; no size before it knows one', () => {
    expect(
      accountMagnetLine({
        ...ready,
        stage: 'fetching',
        downloadedBytes: 12 * MIB,
        bytesPerSecond: MIB,
      }),
    ).toMatch(/^Fetching · 50\s?% · 12\.0\sMB of 24\.0\sMB · 1\.0\sMB\/s$/);
    expect(
      accountMagnetLine({ ...ready, stage: 'fetching', totalBytes: null, downloadedBytes: 0 }),
    ).toBe('Fetching');
  });

  it('says AllDebrid gave no files for one that failed there, as a failed pasted magnet says', () => {
    expect(accountMagnetLine({ ...ready, stage: 'failed' })).toBe('AllDebrid gave no files for it');
  });

  it("says one is in Scia's list, on its way to being downloads", () => {
    expect(accountMagnetLine({ ...ready, inScia: true })).toMatch(
      /^Ready · 24\.0\sMB · In Scia’s list$/,
    );
  });
});

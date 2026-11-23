import type { Bundle } from '@scia/contracts';
import { BundleFailure, BundleStatus } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { NBSP } from '@/lib/format.ts';
import { bundleLine } from './bundle-line.ts';

const choosing: Bundle = {
  id: 'b1',
  name: 'Holiday films',
  status: BundleStatus.Choosing,
  failure: null,
  files: [
    { name: 'Day 1.mkv', size: 1024 * 1024 },
    { name: 'Day 2.mkv', size: 2 * 1024 * 1024 },
  ],
  unavailable: 0,
  createdAt: '2026-11-23T12:00:00.000Z',
};

describe('bundleLine', () => {
  it('says the service is being asked what is behind the link', () => {
    expect(bundleLine({ ...choosing, status: BundleStatus.Opening, files: [] })).toBe(
      'Opening through AllDebrid…',
    );
  });

  it('says how many files it lists, and how much they weigh', () => {
    expect(bundleLine(choosing)).toBe(`2 files · 3.0${NBSP}MB`);
    expect(bundleLine({ ...choosing, files: [{ name: 'a', size: 1024 }] })).toBe(
      `1 file · 1${NBSP}KB`,
    );
  });

  it('says how many files behind the link the service cannot get', () => {
    expect(bundleLine({ ...choosing, unavailable: 3 })).toBe(
      `2 files · 3.0${NBSP}MB · 3 more AllDebrid cannot get`,
    );
  });

  it('says why the service gave no files to choose from', () => {
    expect(
      bundleLine({ ...choosing, status: BundleStatus.Failed, failure: BundleFailure.Empty }),
    ).toBe('AllDebrid found no file it can get behind this link.');
  });
});

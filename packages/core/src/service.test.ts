import { describe, expect, it } from 'vitest';
import { DownloadFailure } from './download.ts';
import {
  isServiceFailure,
  PREPARE_LIMIT_SECONDS,
  ServiceFailure,
  UnlockFailure,
} from './service.ts';

describe('PREPARE_LIMIT_SECONDS', () => {
  it('waits thirty minutes at most for a link being prepared, as the owner decided', () => {
    expect(PREPARE_LIMIT_SECONDS).toBe(30 * 60);
  });
});

describe('isServiceFailure', () => {
  it('knows what a service says of a key or of itself from what it says of a link', () => {
    for (const failure of Object.values(ServiceFailure)) {
      expect(isServiceFailure(failure), failure).toBe(true);
    }
    for (const other of [...Object.values(UnlockFailure), DownloadFailure.Network, null, 7]) {
      expect(isServiceFailure(other), String(other)).toBe(false);
    }
  });
});

describe('DownloadFailure', () => {
  it('has every refusal of a service among the reasons a download stopped, each under its own code', () => {
    const codes = Object.values(DownloadFailure);

    for (const failure of [...Object.values(ServiceFailure), ...Object.values(UnlockFailure)]) {
      expect(codes, failure).toContain(failure);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });
});

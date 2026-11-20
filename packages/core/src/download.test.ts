import { describe, expect, it } from 'vitest';
import { canPause, canResume, DownloadFailure, DownloadStatus } from './download.ts';
import { PageFailure } from './page.ts';
import { ServiceFailure, UnlockFailure } from './service.ts';

describe('download status', () => {
  it('pauses what waits or runs', () => {
    expect(canPause(DownloadStatus.Queued)).toBe(true);
    expect(canPause(DownloadStatus.Downloading)).toBe(true);
    expect(canPause(DownloadStatus.Completed)).toBe(false);
    expect(canPause(DownloadStatus.Paused)).toBe(false);
  });

  it('resumes what was paused or failed, never what is finished', () => {
    expect(canResume(DownloadStatus.Paused)).toBe(true);
    expect(canResume(DownloadStatus.Failed)).toBe(true);
    expect(canResume(DownloadStatus.Completed)).toBe(false);
    expect(canResume(DownloadStatus.Downloading)).toBe(false);
  });
});

describe('DownloadFailure', () => {
  it('keeps every code of every family it gathers: no two families share a name', () => {
    const families = [ServiceFailure, UnlockFailure, PageFailure];
    for (const family of families) {
      for (const code of Object.values(family)) {
        expect(Object.values(DownloadFailure), code).toContain(code);
      }
    }
  });
});

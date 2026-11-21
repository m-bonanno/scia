import { describe, expect, it } from 'vitest';
import {
  canPause,
  canResume,
  canStart,
  DownloadFailure,
  DownloadStatus,
  isUnderWay,
} from './download.ts';
import { PageFailure } from './page.ts';
import { ServiceFailure, UnlockFailure } from './service.ts';

describe('download status', () => {
  it('is under way while it runs or waits for its turn, and not when ready, paused or ended', () => {
    expect(isUnderWay(DownloadStatus.Downloading)).toBe(true);
    expect(isUnderWay(DownloadStatus.Queued)).toBe(true);
    for (const status of [
      DownloadStatus.Ready,
      DownloadStatus.Paused,
      DownloadStatus.Completed,
      DownloadStatus.Failed,
    ]) {
      expect(isUnderWay(status)).toBe(false);
    }
  });

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
    expect(canResume(DownloadStatus.Ready)).toBe(false);
  });

  it('starts what is ready, and pauses nothing that was never started', () => {
    expect(canStart(DownloadStatus.Ready)).toBe(true);
    for (const status of Object.values(DownloadStatus).filter((s) => s !== DownloadStatus.Ready)) {
      expect(canStart(status), status).toBe(false);
    }
    expect(canPause(DownloadStatus.Ready)).toBe(false);
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

import { describe, expect, it } from 'vitest';
import { canPause, canResume, DownloadStatus } from './download.ts';

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

import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { aDownload } from '@/test/a-download.ts';
import { statusLine } from './status-line.ts';

const MIB = 1024 * 1024;

describe('statusLine', () => {
  it('says how far, how fast and how long for a running download', () => {
    expect(statusLine(aDownload())).toBe(
      '42% · 420\u00a0MB of 1,000\u00a0MB · 10.0\u00a0MB/s · 58\u00a0s left',
    );
  });

  it('leaves out what it does not know', () => {
    expect(
      statusLine(aDownload({ totalBytes: null, etaSeconds: null, downloadedBytes: 5 * MIB })),
    ).toBe('5.0\u00a0MB · 10.0\u00a0MB/s');
    expect(statusLine(aDownload({ totalBytes: null, downloadedBytes: 0 }))).toBe('Connecting…');
  });

  it('says a download waits its turn', () => {
    expect(statusLine(aDownload({ status: DownloadStatus.Queued }))).toBe('Queued');
  });

  it('warns that a pause will cost the bytes when the host cannot resume', () => {
    expect(statusLine(aDownload({ status: DownloadStatus.Paused }))).toBe(
      'Paused · 420\u00a0MB of 1,000\u00a0MB',
    );
    expect(statusLine(aDownload({ status: DownloadStatus.Paused, resumable: false }))).toBe(
      'Paused · 420\u00a0MB of 1,000\u00a0MB · will restart from the beginning',
    );
  });

  it('gives the size of a finished file', () => {
    expect(
      statusLine(aDownload({ status: DownloadStatus.Completed, downloadedBytes: 1000 * MIB })),
    ).toBe('1,000\u00a0MB · Completed');
  });

  it('says what went wrong, then what to do where something can be done', () => {
    const failed = (overrides: Partial<Download>) =>
      statusLine(aDownload({ status: DownloadStatus.Failed, ...overrides }));
    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 404 })).toBe(
      'The file is no longer at this address.',
    );
    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 503 })).toBe(
      'The server answered with an error (503). Try again later.',
    );
    expect(failed({ failure: DownloadFailure.Network })).toBe('Connection interrupted. Try again.');
    expect(failed({ failure: DownloadFailure.Disk })).toContain('free space');
  });
});

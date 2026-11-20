import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { EndedDownloads, Ending } from './ended-downloads.ts';

function aDownload(id: string, status: DownloadStatus, fileName = `${id}.bin`): Download {
  return {
    id,
    url: 'https://example.com/file.bin',
    fileName,
    directory: 'downloads',
    kind: 'other',
    status,
    totalBytes: 10,
    downloadedBytes: 5,
    bytesPerSecond: 0,
    etaSeconds: null,
    resumable: true,
    segments: [],
    failure: null,
    failureStatus: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    completedAt: null,
  };
}

describe('EndedDownloads', () => {
  it('says nothing of what had already ended when it first looked', () => {
    const ended = new EndedDownloads();

    expect(
      ended.seen([
        aDownload('a', DownloadStatus.Completed),
        aDownload('b', DownloadStatus.Failed),
        aDownload('c', DownloadStatus.Downloading),
      ]),
    ).toEqual([]);
  });

  it('names a download when it completes, and when it fails, once', () => {
    const ended = new EndedDownloads();
    ended.seen([
      aDownload('a', DownloadStatus.Downloading, 'Film.mkv'),
      aDownload('b', DownloadStatus.Downloading, 'setup.exe'),
    ]);

    const next = [
      aDownload('a', DownloadStatus.Completed, 'Film.mkv'),
      aDownload('b', DownloadStatus.Failed, 'setup.exe'),
    ];
    expect(ended.seen(next)).toEqual([
      { id: 'a', fileName: 'Film.mkv', ending: Ending.Completed },
      { id: 'b', fileName: 'setup.exe', ending: Ending.Failed },
    ]);
    expect(ended.seen(next)).toEqual([]);
  });

  it('does not take a pause, a wait in the queue or a removal for an end', () => {
    const ended = new EndedDownloads();
    ended.seen([
      aDownload('a', DownloadStatus.Downloading),
      aDownload('b', DownloadStatus.Downloading),
      aDownload('c', DownloadStatus.Downloading),
    ]);

    expect(
      ended.seen([aDownload('a', DownloadStatus.Paused), aDownload('b', DownloadStatus.Queued)]),
    ).toEqual([]);
  });

  it('names a download that was added and ended between two looks', () => {
    const ended = new EndedDownloads();
    ended.seen([]);

    expect(ended.seen([aDownload('a', DownloadStatus.Completed, 'cover.jpg')])).toEqual([
      { id: 'a', fileName: 'cover.jpg', ending: Ending.Completed },
    ]);
  });

  it('names again a download that failed, was tried again, and ended again', () => {
    const ended = new EndedDownloads();
    ended.seen([aDownload('a', DownloadStatus.Failed)]);
    ended.seen([aDownload('a', DownloadStatus.Downloading)]);

    expect(ended.seen([aDownload('a', DownloadStatus.Completed)])).toEqual([
      { id: 'a', fileName: 'a.bin', ending: Ending.Completed },
    ]);
  });
});

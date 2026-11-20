import type { Download } from '@scia/contracts';
import { DownloadStatus, FileKind } from '@scia/core';

const MIB = 1024 * 1024;

// A download halfway there, for the specs to bend into the case they need.
export function aDownload(overrides: Partial<Download> = {}): Download {
  return {
    id: 'd1',
    url: 'https://example.com/film.mkv',
    fileName: 'film.mkv',
    directory: '/downloads',
    kind: FileKind.Video,
    status: DownloadStatus.Downloading,
    totalBytes: 1000 * MIB,
    downloadedBytes: 420 * MIB,
    bytesPerSecond: 10 * MIB,
    etaSeconds: 58,
    resumable: true,
    segments: [],
    failure: null,
    failureStatus: null,
    via: null,
    media: null,
    timeline: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

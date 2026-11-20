import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatSpeed,
  SEPARATOR,
} from '@/lib/format.ts';

// The fact, then the remedy where there is one: trying again does not bring back a deleted file.
function failureText(download: Download): string {
  switch (download.failure) {
    case DownloadFailure.HttpStatus:
      if (download.failureStatus === 404) return 'The file is no longer at this address.';
      if (download.failureStatus === 401 || download.failureStatus === 403) {
        return 'The server denies access to this file.';
      }
      return download.failureStatus === null
        ? 'The server refused the request. Try again later.'
        : `The server answered with an error (${String(download.failureStatus)}). Try again later.`;
    case DownloadFailure.Disk:
      return 'The file could not be written. Check the free space and the folder, then try again.';
    case DownloadFailure.Incomplete:
      return 'The server closed the transfer before the end. Try again.';
    case DownloadFailure.Network:
    case null:
      return 'Connection interrupted. Try again.';
  }
}

function progressText(download: Download): string {
  const done = formatBytes(download.downloadedBytes);
  return download.totalBytes === null ? done : `${done} of ${formatBytes(download.totalBytes)}`;
}

// The one line under a file's name: where it is, how fast, how long. Facts first.
export function statusLine(download: Download): string {
  switch (download.status) {
    case DownloadStatus.Queued:
      return 'Queued';
    case DownloadStatus.Completed:
      return [formatBytes(download.totalBytes ?? download.downloadedBytes), 'Completed'].join(
        SEPARATOR,
      );
    case DownloadStatus.Failed:
      return failureText(download);
    case DownloadStatus.Paused:
      return [
        'Paused',
        progressText(download),
        ...(download.resumable || download.downloadedBytes === 0
          ? []
          : ['will restart from the beginning']),
      ].join(SEPARATOR);
    case DownloadStatus.Downloading: {
      if (download.totalBytes === null && download.downloadedBytes === 0) return 'Connecting…';
      return [
        ...(download.totalBytes === null
          ? []
          : [formatPercent(download.downloadedBytes, download.totalBytes)]),
        progressText(download),
        formatSpeed(download.bytesPerSecond),
        ...(download.etaSeconds === null ? [] : [`${formatDuration(download.etaSeconds)} left`]),
      ].join(SEPARATOR);
    }
  }
}

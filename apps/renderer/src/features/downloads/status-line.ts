import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatSpeed,
  SEPARATOR,
} from '@/lib/format.ts';
import { directLinkFailedMessage, linkNotUnlockedMessage, SERVICE_NAME } from '@/lib/messages.ts';

// The fact, then the remedy where there is one: trying again does not bring back a deleted file.
function failureText(download: Download): string {
  // The host a service sent Scia to: the address is the service's, and so is the remedy.
  const { via } = download;
  if (
    via !== null &&
    (download.failure === DownloadFailure.HttpStatus ||
      download.failure === DownloadFailure.Network ||
      download.failure === DownloadFailure.Incomplete)
  ) {
    return directLinkFailedMessage(
      download.failure === DownloadFailure.HttpStatus ? download.failureStatus : null,
      via,
    );
  }
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
  // What is left is a service's: it did not give a link for this one.
  return linkNotUnlockedMessage(download.failure, download.via);
}

function progressText(download: Download): string {
  const done = formatBytes(download.downloadedBytes);
  return download.totalBytes === null ? done : `${done} of ${formatBytes(download.totalBytes)}`;
}

// The one line under a file's name: where it is, how fast, how long. Facts first; that it
// goes through a service comes last, and stays when the file is there.
export function statusLine(download: Download): string {
  const service = download.via === null ? undefined : SERVICE_NAME[download.via];
  const via = service === undefined ? [] : [`via ${service}`];
  switch (download.status) {
    case DownloadStatus.Queued:
      return 'Queued';
    case DownloadStatus.Completed:
      return [
        formatBytes(download.totalBytes ?? download.downloadedBytes),
        'Completed',
        ...via,
      ].join(SEPARATOR);
    case DownloadStatus.Failed:
      return failureText(download);
    case DownloadStatus.Paused:
      return [
        'Paused',
        progressText(download),
        ...(download.resumable || download.downloadedBytes === 0
          ? []
          : ['will restart from the beginning']),
        ...via,
      ].join(SEPARATOR);
    case DownloadStatus.Downloading: {
      if (download.totalBytes === null && download.downloadedBytes === 0) {
        // Before a byte, a link that goes through a service is waiting for that service.
        return service === undefined ? 'Connecting…' : `Unlocking through ${service}…`;
      }
      return [
        ...(download.totalBytes === null
          ? []
          : [formatPercent(download.downloadedBytes, download.totalBytes)]),
        progressText(download),
        formatSpeed(download.bytesPerSecond),
        ...(download.etaSeconds === null ? [] : [`${formatDuration(download.etaSeconds)} left`]),
        ...via,
      ].join(SEPARATOR);
    }
  }
}

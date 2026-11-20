import { PageFailure } from './page.ts';
import { ServiceFailure, UnlockFailure } from './service.ts';

export const DownloadStatus = {
  Queued: 'queued',
  Downloading: 'downloading',
  Paused: 'paused',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type DownloadStatus = (typeof DownloadStatus)[keyof typeof DownloadStatus];

// Why a download stopped on its own. The person reads the text the renderer maps the code to.
export const DownloadFailure = {
  // The connection dropped or the host never answered, after every retry.
  Network: 'NETWORK',
  // The host answered with a refusal (403, 404, 5xx).
  HttpStatus: 'HTTP_STATUS',
  // The file could not be written: disk full, folder gone, no permission.
  Disk: 'DISK',
  // The host closed the transfer before the announced size.
  Incomplete: 'INCOMPLETE',
  // The link goes through a service, and the service refused or did not answer (service.ts).
  ...ServiceFailure,
  ...UnlockFailure,
  // The link is a page, and the video in it was not downloaded (page.ts).
  ...PageFailure,
} as const;
export type DownloadFailure = (typeof DownloadFailure)[keyof typeof DownloadFailure];

export function canPause(status: DownloadStatus): boolean {
  return status === DownloadStatus.Queued || status === DownloadStatus.Downloading;
}

export function canResume(status: DownloadStatus): boolean {
  return status === DownloadStatus.Paused || status === DownloadStatus.Failed;
}

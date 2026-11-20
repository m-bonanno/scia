import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus, PageFailure } from '@scia/core';
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatSpeed,
  NBSP,
  SEPARATOR,
} from '@/lib/format.ts';
import { directLinkFailedMessage, linkNotUnlockedMessage, SERVICE_NAME } from '@/lib/messages.ts';

// Said of a link that was a page, when its site's video was not downloaded. Each sentence is
// true of every cause its code covers: "cannot be played" is a private, removed, sign-in or
// country-limited video alike.
const PAGE_NOT_DOWNLOADED: Readonly<Record<PageFailure, string>> = {
  [PageFailure.Drm]:
    'The video on this page is protected. Scia does not download protected videos.',
  [PageFailure.VideoUnavailable]:
    'The site says this video cannot be played. It may be private, removed, or not available in your country.',
  // DASH, picture and sound as two files, or a stream that changes partway — the page may offer
  // another form beside it: the sentence is true of all of them.
  [PageFailure.FormatUnsupported]: 'The site offers this video in a form Scia cannot download yet.',
  // A list of videos, of tracks, of episodes: the sentence names none of them.
  [PageFailure.Playlist]:
    'This page lists several items, not one video. Add the link of one of them.',
  // Recording a live stream comes later (#121).
  [PageFailure.Live]: 'This video is a live stream. Scia does not record live streams yet.',
  // Busy, in maintenance, too many requests, or no answer in time: waiting mends all of them.
  [PageFailure.SiteBusy]: 'The site did not answer properly. Try again later.',
  // An error Scia does not know, a reader that could not start or said nothing it understands:
  // none is mended by waiting, so no remedy is offered.
  [PageFailure.Unreadable]: 'Scia could not read the video on this page.',
};

// The address a page's site gave for its video does not last: trying again reads the page for a
// new one (docs/adr/0009-the-video-of-a-page.md, point 6).
function videoAddressFailedMessage(status: number | null): string {
  const code = status === null ? '' : ` (${String(status)})`;
  return `The address the site gave for this video no longer works${code}. Try again: Scia reads the page for a new one.`;
}

function isPageFailure(failure: DownloadFailure): failure is PageFailure {
  return Object.hasOwn(PAGE_NOT_DOWNLOADED, failure);
}

// "MP4 1080p": the container, then the lines of picture when the site says them.
function mediaText(media: NonNullable<Download['media']>): string {
  const container = media.ext.toUpperCase();
  // Held together: "MP4" alone at the end of a line and "1080p" at the start of the next say less.
  return media.height === null ? container : `${container}${NBSP}${String(media.height)}p`;
}

// The fact, then the remedy where there is one: trying again does not bring back a deleted file.
function failureText(download: Download): string {
  // The host a service or a page's site sent Scia to: the address is theirs, and so is the
  // remedy.
  const { via } = download;
  const atAnAddressGiven =
    download.failure === DownloadFailure.HttpStatus ||
    download.failure === DownloadFailure.Network ||
    download.failure === DownloadFailure.Incomplete;
  const status = download.failure === DownloadFailure.HttpStatus ? download.failureStatus : null;
  if (atAnAddressGiven && via !== null) return directLinkFailedMessage(status, via);
  if (atAnAddressGiven && download.media !== null) return videoAddressFailedMessage(status);
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
  if (isPageFailure(download.failure)) return PAGE_NOT_DOWNLOADED[download.failure];
  // What is left is a service's: it did not give a link for this one.
  return linkNotUnlockedMessage(download.failure, download.via);
}

// How far it is: by its bytes, or — a stream, whose size is not known before — by its pieces.
function percentText(download: Download): string[] {
  const { timeline } = download;
  if (timeline !== null) {
    const doneMs = timeline.segments.reduce((sum, piece) => sum + piece.downloaded, 0);
    return [formatPercent(doneMs, timeline.totalMs)];
  }
  return download.totalBytes === null
    ? []
    : [formatPercent(download.downloadedBytes, download.totalBytes)];
}

function progressText(download: Download): string {
  const done = formatBytes(download.downloadedBytes);
  return download.totalBytes === null ? done : `${done} of ${formatBytes(download.totalBytes)}`;
}

// The one line under a file's name: where it is, how fast, how long. Facts first; that it
// goes through a service comes last, and stays when the file is there.
export function statusLine(download: Download): string {
  const service = download.via === null ? undefined : SERVICE_NAME[download.via];
  // Which video of a page, then the service: both say where the bytes come from.
  const origin = [
    ...(download.media === null ? [] : [mediaText(download.media)]),
    ...(service === undefined ? [] : [`via ${service}`]),
  ];
  switch (download.status) {
    case DownloadStatus.Queued:
      return 'Queued';
    case DownloadStatus.Completed:
      return [
        formatBytes(download.totalBytes ?? download.downloadedBytes),
        'Completed',
        ...origin,
      ].join(SEPARATOR);
    case DownloadStatus.Failed:
      return failureText(download);
    case DownloadStatus.Paused:
      return [
        'Paused',
        ...(download.timeline === null ? [] : percentText(download)),
        progressText(download),
        ...(download.resumable || download.downloadedBytes === 0
          ? []
          : ['will restart from the beginning']),
        ...origin,
      ].join(SEPARATOR);
    case DownloadStatus.Downloading: {
      if (download.totalBytes === null && download.downloadedBytes === 0) {
        // Before a byte, a link that goes through a service is waiting for that service.
        return service === undefined ? 'Connecting…' : `Unlocking through ${service}…`;
      }
      return [
        ...percentText(download),
        progressText(download),
        formatSpeed(download.bytesPerSecond),
        ...(download.etaSeconds === null ? [] : [`${formatDuration(download.etaSeconds)} left`]),
        ...origin,
      ].join(SEPARATOR);
    }
  }
}

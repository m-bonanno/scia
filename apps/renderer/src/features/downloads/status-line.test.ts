import type { Download } from '@scia/contracts';
import {
  DownloadFailure,
  DownloadStatus,
  PageFailure,
  ServiceFailure,
  UnlockFailure,
} from '@scia/core';
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

  it('says last that a download goes through a service, while it runs, when paused and when it is there', () => {
    const through = (overrides: Partial<Download>) =>
      statusLine(aDownload({ via: 'alldebrid', ...overrides }));

    expect(through({})).toBe(
      '42% · 420\u00a0MB of 1,000\u00a0MB · 10.0\u00a0MB/s · 58\u00a0s left · via AllDebrid',
    );
    expect(through({ status: DownloadStatus.Paused })).toBe(
      'Paused · 420\u00a0MB of 1,000\u00a0MB · via AllDebrid',
    );
    expect(through({ status: DownloadStatus.Completed, downloadedBytes: 1000 * MIB })).toBe(
      '1,000\u00a0MB · Completed · via AllDebrid',
    );
  });

  it('says a link is being unlocked while its service has not given a byte yet', () => {
    expect(statusLine(aDownload({ via: 'alldebrid', totalBytes: null, downloadedBytes: 0 }))).toBe(
      'Unlocking through AllDebrid…',
    );
  });

  it.each([
    [
      ServiceFailure.KeyRefused,
      'AllDebrid no longer accepts the key. In Settings, disconnect it and connect a new key, then try again.',
    ],
    [
      ServiceFailure.KeyBlocked,
      'AllDebrid is blocking the key from here. If AllDebrid emailed you about a new sign-in, confirm it; otherwise check your network, then try again.',
    ],
    [ServiceFailure.AccountBanned, 'AllDebrid says the account is banned.'],
    [
      ServiceFailure.NetworkRefused,
      'AllDebrid does not serve this network: it refuses servers and some VPNs. Try again from another network.',
    ],
    [
      ServiceFailure.Unavailable,
      'AllDebrid could not be asked about this link. Try again in a moment.',
    ],
    [UnlockFailure.NotPremium, 'AllDebrid unlocks this link for premium accounts only.'],
    [UnlockFailure.LinkDown, 'AllDebrid says the file is no longer on its host.'],
    [
      UnlockFailure.LinkPassword,
      'AllDebrid says the link asks for a password, which Scia cannot give yet.',
    ],
    [
      UnlockFailure.HostUnavailable,
      'AllDebrid cannot get this file from its host right now. Try again later.',
    ],
    [
      UnlockFailure.HostLimit,
      'AllDebrid says the account has reached its limit for this host. Try again later.',
    ],
    [UnlockFailure.LinkRefused, 'AllDebrid could not unlock this link.'],
    [
      UnlockFailure.NotReady,
      'AllDebrid was still preparing this link after 30\u00a0min. Try again later.',
    ],
    [
      UnlockFailure.NotConnected,
      'AllDebrid is no longer connected. Connect it in Settings, then try again.',
    ],
  ] as const)('says in words what the service said when it answered %s', (failure, text) => {
    expect(
      statusLine(aDownload({ status: DownloadStatus.Failed, failure, via: 'alldebrid' })),
    ).toBe(text);
  });

  it("says a file host's link needs a service, and which one to connect, when none is", () => {
    expect(
      statusLine(
        aDownload({
          status: DownloadStatus.Failed,
          failure: UnlockFailure.NeedsService,
          via: null,
        }),
      ),
    ).toBe(
      'This link is on a file host: Scia downloads links like this through AllDebrid. Connect AllDebrid in Settings, then try again.',
    );
  });

  it('says the link a service gave stopped working, and that trying again asks for another', () => {
    const failed = (overrides: Partial<Download>) =>
      statusLine(aDownload({ status: DownloadStatus.Failed, via: 'alldebrid', ...overrides }));

    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 404 })).toBe(
      'The link AllDebrid gave no longer works (404). Try again: AllDebrid gives a new one.',
    );
    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 204 })).toBe(
      'The link AllDebrid gave no longer works (204). Try again: AllDebrid gives a new one.',
    );
    expect(failed({ failure: DownloadFailure.Network })).toBe(
      'The link AllDebrid gave no longer works. Try again: AllDebrid gives a new one.',
    );
    expect(failed({ failure: DownloadFailure.Incomplete })).toBe(
      'The link AllDebrid gave no longer works. Try again: AllDebrid gives a new one.',
    );
    // The disk is the disk, whoever gave the link.
    expect(failed({ failure: DownloadFailure.Disk })).toContain('free space');
  });

  it('says which video of a page it fetches, while it runs, when paused and when it is there', () => {
    const video = (overrides: Partial<Download>) =>
      statusLine(aDownload({ media: { ext: 'mp4', height: 1080 }, ...overrides }));

    expect(video({})).toBe(
      '42% · 420\u00a0MB of 1,000\u00a0MB · 10.0\u00a0MB/s · 58\u00a0s left · MP4\u00a01080p',
    );
    expect(video({ status: DownloadStatus.Paused })).toBe(
      'Paused · 420\u00a0MB of 1,000\u00a0MB · MP4\u00a01080p',
    );
    expect(video({ status: DownloadStatus.Completed, downloadedBytes: 1000 * MIB })).toBe(
      '1,000\u00a0MB · Completed · MP4\u00a01080p',
    );
    expect(
      statusLine(
        aDownload({
          status: DownloadStatus.Completed,
          downloadedBytes: 1000 * MIB,
          media: { ext: 'webm', height: null },
        }),
      ),
    ).toBe('1,000\u00a0MB · Completed · WEBM');
  });

  it('says the address the site gave for a video stopped working, and that trying again reads the page for a new one', () => {
    const failed = (overrides: Partial<Download>) =>
      statusLine(
        aDownload({
          status: DownloadStatus.Failed,
          media: { ext: 'mp4', height: 1080 },
          ...overrides,
        }),
      );
    const again = 'Try again: Scia reads the page for a new one.';

    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 403 })).toBe(
      `The address the site gave for this video no longer works (403). ${again}`,
    );
    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 404 })).toBe(
      `The address the site gave for this video no longer works (404). ${again}`,
    );
    expect(failed({ failure: DownloadFailure.Network })).toBe(
      `The address the site gave for this video no longer works. ${again}`,
    );
    expect(failed({ failure: DownloadFailure.Incomplete })).toBe(
      `The address the site gave for this video no longer works. ${again}`,
    );
    // The disk is the disk, whoever gave the address.
    expect(failed({ failure: DownloadFailure.Disk })).toContain('free space');
  });

  it.each([
    [
      PageFailure.Drm,
      'The video on this page is protected. Scia does not download protected videos.',
    ],
    [PageFailure.SiteBusy, 'The site did not answer properly. Try again later.'],
    [
      PageFailure.VideoUnavailable,
      'The site says this video cannot be played. It may be private, removed, or not available in your country.',
    ],
    [
      PageFailure.FormatUnsupported,
      'The site offers this video only in a form Scia cannot download yet.',
    ],
    [
      PageFailure.Playlist,
      'This page lists several items, not one video. Add the link of one of them.',
    ],
    [PageFailure.Unreadable, 'Scia could not read the video on this page.'],
  ] as const)('says why the video of a page was not downloaded when it was %s', (failure, text) => {
    expect(statusLine(aDownload({ status: DownloadStatus.Failed, failure }))).toBe(text);
  });

  it('names no service for a link that was never known to be one', () => {
    expect(
      statusLine(aDownload({ status: DownloadStatus.Failed, failure: ServiceFailure.Unavailable })),
    ).toBe('The connected service could not be asked about this link. Try again in a moment.');
  });
});

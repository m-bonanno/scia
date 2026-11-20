import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus, ServiceFailure, UnlockFailure } from '@scia/core';
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
      'AllDebrid no longer accepts the key. Connect it again in Settings, then retry.',
    ],
    [
      ServiceFailure.KeyBlocked,
      'AllDebrid refuses the key from this network. Check your account with it, then retry.',
    ],
    [ServiceFailure.AccountBanned, 'AllDebrid says the account is banned.'],
    [
      ServiceFailure.NetworkRefused,
      'AllDebrid does not serve this network: it refuses servers and some VPNs.',
    ],
    [ServiceFailure.Unavailable, 'AllDebrid is not answering. Try again in a moment.'],
    [UnlockFailure.NotPremium, 'AllDebrid unlocks this link for premium accounts only.'],
    [UnlockFailure.LinkDown, 'AllDebrid says the file is no longer on its host.'],
    [
      UnlockFailure.LinkPassword,
      'AllDebrid says the link asks for a password, which Scia cannot give yet.',
    ],
    [UnlockFailure.HostUnavailable, 'AllDebrid cannot reach this host right now. Try again later.'],
    [
      UnlockFailure.HostLimit,
      'AllDebrid says the account has reached its limit for this host. Try again later.',
    ],
    [UnlockFailure.LinkRefused, 'AllDebrid could not unlock this link.'],
    [
      UnlockFailure.NotConnected,
      'AllDebrid is no longer connected. Connect it in Settings, then retry.',
    ],
  ] as const)('says in words what the service said when it answered %s', (failure, text) => {
    expect(
      statusLine(aDownload({ status: DownloadStatus.Failed, failure, via: 'alldebrid' })),
    ).toBe(text);
  });

  it('names no service for a link that was never known to be one', () => {
    expect(
      statusLine(aDownload({ status: DownloadStatus.Failed, failure: ServiceFailure.Unavailable })),
    ).toBe('The connected service is not answering. Try again in a moment.');
  });
});

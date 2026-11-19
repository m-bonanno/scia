import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { aDownload } from '@/test/a-download.ts';
import { statusLine } from './status-line.ts';

const MIB = 1024 * 1024;

describe('statusLine', () => {
  it('says how far, how fast and how long for a running download', () => {
    expect(statusLine(aDownload())).toBe(
      '42% · 420\u00a0MB di 1000\u00a0MB · 10,0\u00a0MB/s · ancora 58\u00a0s',
    );
  });

  it('leaves out what it does not know', () => {
    expect(
      statusLine(aDownload({ totalBytes: null, etaSeconds: null, downloadedBytes: 5 * MIB })),
    ).toBe('5,0\u00a0MB · 10,0\u00a0MB/s');
    expect(statusLine(aDownload({ totalBytes: null, downloadedBytes: 0 }))).toBe('Connessione…');
  });

  it('says a download waits its turn', () => {
    expect(statusLine(aDownload({ status: DownloadStatus.Queued }))).toBe('In coda');
  });

  it('warns that a pause will cost the bytes when the host cannot resume', () => {
    expect(statusLine(aDownload({ status: DownloadStatus.Paused }))).toBe(
      'In pausa · 420\u00a0MB di 1000\u00a0MB',
    );
    expect(statusLine(aDownload({ status: DownloadStatus.Paused, resumable: false }))).toBe(
      'In pausa · 420\u00a0MB di 1000\u00a0MB · ripartirà dall’inizio',
    );
  });

  it('gives the size of a finished file', () => {
    expect(
      statusLine(aDownload({ status: DownloadStatus.Completed, downloadedBytes: 1000 * MIB })),
    ).toBe('1000\u00a0MB · Completato');
  });

  it('says what went wrong, then what to do', () => {
    const failed = (overrides: Partial<Download>) =>
      statusLine(aDownload({ status: DownloadStatus.Failed, ...overrides }));
    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 404 })).toBe(
      'Il file non esiste più a questo indirizzo.',
    );
    expect(failed({ failure: DownloadFailure.HttpStatus, failureStatus: 503 })).toBe(
      'Il server ha risposto con un errore (503). Riprova più tardi.',
    );
    expect(failed({ failure: DownloadFailure.Network })).toBe('Connessione interrotta. Riprova.');
    expect(failed({ failure: DownloadFailure.Disk })).toContain('spazio libero');
  });
});

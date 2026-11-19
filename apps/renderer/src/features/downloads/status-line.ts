import type { Download } from '@scia/contracts';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { formatBytes, formatDuration, formatPercent, formatSpeed } from '@/lib/format.ts';

const SEPARATOR = ' · ';

// The fact, then the remedy where there is one: trying again does not bring back a deleted file.
function failureText(download: Download): string {
  switch (download.failure) {
    case DownloadFailure.HttpStatus:
      if (download.failureStatus === 404) return 'Il file non esiste più a questo indirizzo.';
      if (download.failureStatus === 401 || download.failureStatus === 403) {
        return 'Il server rifiuta l’accesso a questo file.';
      }
      return download.failureStatus === null
        ? 'Il server ha rifiutato la richiesta. Riprova più tardi.'
        : `Il server ha risposto con un errore (${String(download.failureStatus)}). Riprova più tardi.`;
    case DownloadFailure.Disk:
      return 'Impossibile scrivere il file. Controlla lo spazio libero e la cartella, poi riprova.';
    case DownloadFailure.Incomplete:
      return 'Il server ha chiuso il trasferimento prima della fine. Riprova.';
    case DownloadFailure.Network:
    case null:
      return 'Connessione interrotta. Riprova.';
  }
}

function progressText(download: Download): string {
  const done = formatBytes(download.downloadedBytes);
  return download.totalBytes === null ? done : `${done} di ${formatBytes(download.totalBytes)}`;
}

// The one line under a file's name: where it is, how fast, how long. Facts first.
export function statusLine(download: Download): string {
  switch (download.status) {
    case DownloadStatus.Queued:
      return 'In coda';
    case DownloadStatus.Completed:
      return [formatBytes(download.totalBytes ?? download.downloadedBytes), 'Completato'].join(
        SEPARATOR,
      );
    case DownloadStatus.Failed:
      return failureText(download);
    case DownloadStatus.Paused:
      return [
        'In pausa',
        progressText(download),
        ...(download.resumable || download.downloadedBytes === 0 ? [] : ['ripartirà dall’inizio']),
      ].join(SEPARATOR);
    case DownloadStatus.Downloading: {
      if (download.totalBytes === null && download.downloadedBytes === 0) return 'Connessione…';
      return [
        ...(download.totalBytes === null
          ? []
          : [formatPercent(download.downloadedBytes, download.totalBytes)]),
        progressText(download),
        formatSpeed(download.bytesPerSecond),
        ...(download.etaSeconds === null ? [] : [`ancora ${formatDuration(download.etaSeconds)}`]),
      ].join(SEPARATOR);
    }
  }
}

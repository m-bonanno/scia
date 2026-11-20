import { DownloadFailure } from '@scia/core';
import { RemoteError, type RemoteSource } from '../remote-source.ts';

// No network in the feature layer: every host stays silent until the download is stopped, so a
// download that was added is still running when the next request arrives.
export const silentSource: RemoteSource = {
  probe: (_url, _headers, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new RemoteError(DownloadFailure.Network, false, 'stopped'));
      });
    }),
  open: () => Promise.reject(new RemoteError(DownloadFailure.Network, false, 'offline')),
};

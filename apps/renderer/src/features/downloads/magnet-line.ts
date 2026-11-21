import type { Magnet } from '@scia/contracts';
import { MagnetFailure, MagnetStatus } from '@scia/core';
import { formatBytes, formatPercent, formatSpeed, SEPARATOR } from '@/lib/format.ts';
import { magnetFailureMessage, SERVICE_NAME } from '@/lib/messages.ts';

// The service magnets go through: there is one (#137).
const SERVICE = SERVICE_NAME.alldebrid;

// What the row says of a magnet: where the service is with it, or why it gave nothing.
export function magnetLine(magnet: Magnet): string {
  if (magnet.status === MagnetStatus.Failed) {
    return magnetFailureMessage(magnet.failure ?? MagnetFailure.Unavailable);
  }
  // Not answering, under maintenance, answering what Scia does not understand: true of all of
  // them is that it could not ask, and that it asks again.
  if (magnet.failure === MagnetFailure.Unavailable) {
    return `Scia could not ask ${SERVICE} about this magnet just now. It asks again in a moment.`;
  }
  if (magnet.status === MagnetStatus.Sending) return `Sending to ${SERVICE}…`;
  // Before the service has read the torrent, it knows no size.
  if (magnet.totalBytes === null) return `${SERVICE} is fetching it`;
  const { totalBytes, downloadedBytes } = magnet;
  return [
    `${SERVICE} is fetching it`,
    ...(totalBytes > 0 ? [formatPercent(downloadedBytes, totalBytes)] : []),
    `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`,
    formatSpeed(magnet.bytesPerSecond),
  ].join(SEPARATOR);
}

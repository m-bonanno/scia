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
  // A service that does not answer for a moment: the magnet still waits, and Scia asks again.
  if (magnet.failure === MagnetFailure.Unavailable) {
    return `${SERVICE} is not answering. Scia keeps asking.`;
  }
  if (magnet.status === MagnetStatus.Sending || magnet.totalBytes === null) {
    return `Sending to ${SERVICE}…`;
  }
  const { totalBytes, downloadedBytes } = magnet;
  return [
    `${SERVICE} is fetching it`,
    ...(totalBytes > 0 ? [formatPercent(downloadedBytes, totalBytes)] : []),
    `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`,
    formatSpeed(magnet.bytesPerSecond),
  ].join(SEPARATOR);
}

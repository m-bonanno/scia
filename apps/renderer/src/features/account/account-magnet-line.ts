import type { AccountMagnet } from '@scia/contracts';
import { MagnetStage } from '@scia/core';
import { formatBytes, formatPercent, formatSpeed, SEPARATOR } from '@/lib/format.ts';
import { SERVICE_NAME } from '@/lib/messages.ts';

// What the panel says of a magnet of the account (#138): where the service is with it, and
// whether Scia already has it.
export function accountMagnetLine(magnet: AccountMagnet): string {
  const parts = [...stageOf(magnet)];
  if (magnet.inScia) parts.push('In Scia’s list');
  return parts.join(SEPARATOR);
}

function stageOf(magnet: AccountMagnet): string[] {
  const { totalBytes, downloadedBytes } = magnet;
  if (magnet.stage === MagnetStage.Failed) {
    return [`${SERVICE_NAME.alldebrid} could not fetch it`];
  }
  if (magnet.stage === MagnetStage.Ready) {
    return ['Ready', ...(totalBytes === null ? [] : [formatBytes(totalBytes)])];
  }
  if (totalBytes === null) return ['Fetching'];
  return [
    'Fetching',
    formatPercent(downloadedBytes, totalBytes),
    `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`,
    formatSpeed(magnet.bytesPerSecond),
  ];
}

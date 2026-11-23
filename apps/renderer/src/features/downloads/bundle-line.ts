import type { Bundle } from '@scia/contracts';
import { BundleFailure, BundleStatus } from '@scia/core';
import { formatBytes, formatCount, SEPARATOR } from '@/lib/format.ts';
import { bundleFailureMessage, SERVICE_NAME } from '@/lib/messages.ts';

// The service links like this go through: there is one (#181).
const SERVICE = SERVICE_NAME.alldebrid;

export function filesCount(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'file' : 'files'}`;
}

// What the row says of a link that opens into several files: that the service is asked, what it
// listed and what it did not — files it cannot get, files past the most Scia lists — or why it
// listed nothing.
export function bundleLine(bundle: Bundle): string {
  if (bundle.status === BundleStatus.Failed) {
    return bundleFailureMessage(bundle.failure ?? BundleFailure.Unavailable);
  }
  if (bundle.status === BundleStatus.Opening) return `Opening through ${SERVICE}…`;
  const total = bundle.files.reduce((sum, file) => sum + file.size, 0);
  return [
    filesCount(bundle.files.length),
    formatBytes(total),
    ...(bundle.unavailable > 0
      ? [`${formatCount(bundle.unavailable)} more ${SERVICE} cannot get`]
      : []),
    ...(bundle.leftOut > 0 ? [`${formatCount(bundle.leftOut)} more left out of the list`] : []),
  ].join(SEPARATOR);
}

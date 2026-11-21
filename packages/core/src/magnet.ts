import { sanitizeFileName } from './file-name.ts';
import { ServiceFailure, UnlockFailure } from './service.ts';

// Where the service is with a magnet of its account: fetching it, ready, or failed (#138).
export const MagnetStage = { Fetching: 'fetching', Ready: 'ready', Failed: 'failed' } as const;
export type MagnetStage = (typeof MagnetStage)[keyof typeof MagnetStage];

// Where a magnet is, from the moment it is pasted to the moment its files are downloads (#137).
export const MagnetStatus = {
  // Not yet given to the service, or being given.
  Sending: 'sending',
  // The service has it, and is fetching it.
  Fetching: 'fetching',
  Failed: 'failed',
} as const;
export type MagnetStatus = (typeof MagnetStatus)[keyof typeof MagnetStatus];

// Why a magnet gave no files. The person reads the text the renderer maps the code to.
export const MagnetFailure = {
  // The service does not take it as a magnet.
  Invalid: 'MAGNET_INVALID',
  // The account has as many magnets as the service allows, active or kept.
  Limit: 'MAGNET_LIMIT',
  // Larger than the service takes.
  TooLarge: 'MAGNET_TOO_LARGE',
  // The service could not fetch it: no peer, too slow, an error of its own, or it is gone.
  Failed: 'MAGNET_FAILED',
  // The service listed its files in a way Scia does not take: too many, too deep, or not links.
  // Asking again would bring the same list.
  Unreadable: 'MAGNET_UNREADABLE',
  // A key it refuses, a network it does not serve, an account that is not premium, no service
  // connected, a service that cannot be asked.
  ...ServiceFailure,
  NotPremium: UnlockFailure.NotPremium,
  NeedsService: UnlockFailure.NeedsService,
} as const;
export type MagnetFailure = (typeof MagnetFailure)[keyof typeof MagnetFailure];

// The torrent a magnet names, however it was written: the same hash is the same magnet.
export function hashOfMagnet(magnet: string): string {
  return /xt=urn:btih:([0-9a-z]+)/i.exec(magnet)?.[1]?.toLowerCase() ?? magnet;
}

// The folders a magnet's file lands in, under the download folder: the magnet's own, then the
// ones the magnet puts it in — each a name from a host, made safe for the disk, so that none climbs
// out of the magnet's folder or names a device.
export function magnetFolders(magnetName: string, folders: readonly string[]): string[] {
  return [magnetName, ...folders].map((name) => sanitizeFileName(name));
}

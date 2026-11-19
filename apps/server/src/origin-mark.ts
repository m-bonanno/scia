import { writeFile } from 'node:fs/promises';

// Leaves on a file the mark its system keeps for what came from the network.
export type MarkDownloaded = (path: string) => Promise<void>;

// Windows keeps it in a stream beside the file's bytes, and asks before running or opening
// what carries it. Zone 3 is the Internet. Nothing else is written: not the address the file
// came from, which whoever is handed the file could read (the owner's decision, #22).
const ZONE_STREAM = ':Zone.Identifier';
const INTERNET_ZONE = '[ZoneTransfer]\r\nZoneId=3\r\n';

export function markerFor(platform: NodeJS.Platform): MarkDownloaded {
  if (platform !== 'win32') return () => Promise.resolve();
  return (path) => writeFile(`${path}${ZONE_STREAM}`, INTERNET_ZONE);
}

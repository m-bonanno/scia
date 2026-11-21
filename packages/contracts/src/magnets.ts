import { MagnetFailure, MagnetStatus } from '@scia/core';
import { z } from 'zod';

const byteCount = z.number().int().nonnegative();

// A magnet in the list (#137), from the moment it is pasted to the moment its files are
// downloads: then it leaves the list, and its files are there instead. The magnet itself is in no
// answer: it names the person's torrent, and is theirs.
export const magnetSchema = z.object({
  id: z.string(),
  // What the service calls it, or the name the magnet carries, or its hash.
  name: z.string(),
  status: z.enum(MagnetStatus),
  // What the service has of it, and how fast it fetches it; nothing before it says.
  totalBytes: byteCount.nullable(),
  downloadedBytes: byteCount,
  bytesPerSecond: byteCount,
  failure: z.enum(MagnetFailure).nullable(),
  createdAt: z.iso.datetime(),
});
export type Magnet = z.infer<typeof magnetSchema>;

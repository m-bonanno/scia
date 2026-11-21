import { MagnetFailure, MagnetStage, MagnetStatus } from '@scia/core';
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

// A magnet of the connected service's account, as the service lists it (#138): also one added on
// its site or by another application. Its id is the service's.
export const accountMagnetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  stage: z.enum(MagnetStage),
  // What the service has of it, and how fast it fetches it; no size before it has read it.
  totalBytes: byteCount.nullable(),
  downloadedBytes: byteCount,
  bytesPerSecond: byteCount,
  // When it was added to the account, when the service says.
  addedAt: z.iso.datetime().nullable(),
  // It is in Scia's list: on its way to being downloads.
  inScia: z.boolean(),
});
export type AccountMagnet = z.infer<typeof accountMagnetSchema>;

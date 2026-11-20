import { DownloadFailure, DownloadStatus, FileKind, ServiceFailure } from '@scia/core';
import { z } from 'zod';
import { Theme } from './theme.ts';

export { API_PREFIX, DEFAULT_API_PORT } from './endpoint.ts';
export * from './integrations.ts';

export const ApiErrorCode = {
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  InvalidRequest: 'INVALID_REQUEST',
  Conflict: 'CONFLICT',
  InternalError: 'INTERNAL_ERROR',
  // A service refused the key it was given, or did not answer.
  ...ServiceFailure,
  // The system would not keep the key of a service: nothing was connected.
  KeyNotKept: 'KEY_NOT_KEPT',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const byteCount = z.number().int().nonnegative();
const httpUrl = z.url({ protocol: /^https?$/ });

export const segmentSchema = z.object({ start: byteCount, end: byteCount, downloaded: byteCount });

export const downloadSchema = z.object({
  id: z.string(),
  url: z.string(),
  fileName: z.string(),
  directory: z.string(),
  kind: z.enum(FileKind),
  status: z.enum(DownloadStatus),
  // Null while the host has not said, or never says, how big the file is.
  totalBytes: byteCount.nullable(),
  downloadedBytes: byteCount,
  bytesPerSecond: byteCount,
  etaSeconds: z.number().nonnegative().nullable(),
  // False when a pause means starting again from the first byte.
  resumable: z.boolean(),
  segments: z.array(segmentSchema),
  failure: z.enum(DownloadFailure).nullable(),
  // The host's answer behind an HTTP_STATUS failure.
  failureStatus: z.number().int().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type Download = z.infer<typeof downloadSchema>;

export const MAX_URLS_PER_REQUEST = 200;

export const addDownloadsSchema = z.object({
  urls: z.array(httpUrl).min(1).max(MAX_URLS_PER_REQUEST),
  // The page the links were on: some hosts serve a file only to who comes from their page.
  referrer: httpUrl.optional(),
});
export type AddDownloads = z.infer<typeof addDownloadsSchema>;

export const snapshotSchema = z.object({ downloads: z.array(downloadSchema) });
export type Snapshot = z.infer<typeof snapshotSchema>;

// The event the engine sends on GET /events, its data a Snapshot.
export const SNAPSHOT_EVENT = 'snapshot';

export const SETTINGS_LIMITS = {
  maxConcurrentDownloads: { min: 1, max: 10 },
  connectionsPerDownload: { min: 1, max: 16 },
  // One read from a host — up to 64 KB — a second. It is the rate of all connections together:
  // each of them is read from more slowly than this, the more of them there are.
  speedLimitBytesPerSecond: { min: 64 * 1024 },
} as const;

export const settingsSchema = z.object({
  maxConcurrentDownloads: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.maxConcurrentDownloads.min)
    .max(SETTINGS_LIMITS.maxConcurrentDownloads.max),
  connectionsPerDownload: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.connectionsPerDownload.min)
    .max(SETTINGS_LIMITS.connectionsPerDownload.max),
  downloadDirectory: z.string().min(1),
  // For all downloads together; null for no limit.
  speedLimitBytesPerSecond: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.speedLimitBytesPerSecond.min)
    .nullable(),
  // Of the interface: the engine keeps it, and writes it into the page it serves.
  theme: z.enum(Theme),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = settingsSchema
  .pick({
    maxConcurrentDownloads: true,
    connectionsPerDownload: true,
    speedLimitBytesPerSecond: true,
    theme: true,
  })
  .partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

// The folder new downloads go to. Main names it, on a route of its own: the settings the
// page patches have no path in them, so no type lets the page send one.
export const downloadFolderSchema = z.object({ directory: z.string().min(1) });
export type DownloadFolder = z.infer<typeof downloadFolderSchema>;

// What the person copies into the browser extension to pair it with this app.
export const pairingSchema = z.object({ token: z.string(), port: z.number().int() });
export type Pairing = z.infer<typeof pairingSchema>;

export const healthSchema = z.object({ name: z.literal('scia'), version: z.string() });
export type Health = z.infer<typeof healthSchema>;

import {
  DownloadFailure,
  DownloadStatus,
  FileKind,
  ServiceFailure,
  VIDEO_CONTAINERS,
} from '@scia/core';
import { z } from 'zod';
import { IntegrationCodeFailure, IntegrationId } from './integrations.ts';
import { httpUrl, magnetUri } from './links.ts';
import { magnetSchema } from './magnets.ts';
import { Theme } from './theme.ts';

export { API_PREFIX, DEFAULT_API_PORT } from './endpoint.ts';
export * from './integrations.ts';
export * from './magnets.ts';

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
  KeyNotKept: IntegrationCodeFailure.KeyNotKept,
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const byteCount = z.number().int().nonnegative();

export const segmentSchema = z.object({ start: byteCount, end: byteCount, downloaded: byteCount });

// The container of a video and its lines of picture, when the site says them.
export const mediaSchema = z.object({
  // It ends the name of the file.
  ext: z.enum(VIDEO_CONTAINERS),
  height: z.number().int().positive().nullable(),
});

const milliseconds = z.number().int().nonnegative();

// The pieces of a stream on a line of time, in milliseconds.
export const timelineSchema = z.object({
  totalMs: milliseconds,
  segments: z.array(z.object({ start: milliseconds, end: milliseconds, downloaded: milliseconds })),
});

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
  // The service the link goes through, or went through: it was not fetched as it stands.
  via: z.enum(IntegrationId).nullable(),
  // The video of a page, as the site offers it: the link was a page, and this is what is
  // fetched instead. Null for a link that is fetched as it stands.
  media: mediaSchema.nullable(),
  // A video fetched as the pieces of a stream: how long it lasts and how far it is, in
  // milliseconds, each piece a segment of that line — its size in bytes is not known before.
  timeline: timelineSchema.nullable(),
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

// Magnets pasted into the page, for the connected service to fetch (#137).
export const addMagnetsSchema = z.object({
  magnets: z.array(magnetUri).min(1).max(MAX_URLS_PER_REQUEST),
});
export type AddMagnets = z.infer<typeof addMagnetsSchema>;

// The links main read on the clipboard (docs/adr/0012-links-taken-from-the-clipboard.md). The
// engine keeps those that are files or videos it knows, and adds them ready, not started.
export const offerLinksSchema = z.object({
  urls: z.array(httpUrl).min(1).max(MAX_URLS_PER_REQUEST),
});
export type OfferLinks = z.infer<typeof offerLinksSchema>;

export const snapshotSchema = z.object({
  downloads: z.array(downloadSchema),
  // The magnets the service is fetching, or could not (#137).
  magnets: z.array(magnetSchema),
  // Whether main reads the clipboard: main follows the engine's events, and hears the switch
  // there the moment it changes, whoever changed it.
  watchClipboard: z.boolean(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

// The event the engine sends on GET /events, its data a Snapshot.
export const SNAPSHOT_EVENT = 'snapshot';
// How long the engine lets GET /events stay silent: with nothing to send it writes a comment,
// which a reader of events passes over. Whoever listens tells an engine with nothing to say
// from one that has stopped talking — and a client that ends an answer after minutes without
// a byte, as Node's does after five, never meets one.
export const EVENTS_KEEP_ALIVE_MS = 15_000;

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
  // Whether an installed Scia updates itself to the betas too, not only to the stables (#82). Main
  // reads it; the page switches it.
  betaUpdates: z.boolean(),
  // Whether main takes the links copied to the clipboard (#128). Off by default.
  watchClipboard: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = settingsSchema
  .pick({
    maxConcurrentDownloads: true,
    connectionsPerDownload: true,
    speedLimitBytesPerSecond: true,
    theme: true,
    betaUpdates: true,
    watchClipboard: true,
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

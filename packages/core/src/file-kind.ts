import { fileNameFromUrl } from './file-name.ts';

export const FileKind = {
  Video: 'video',
  Audio: 'audio',
  Image: 'image',
  Archive: 'archive',
  Document: 'document',
  Program: 'program',
  Other: 'other',
} as const;
export type FileKind = (typeof FileKind)[keyof typeof FileKind];

const EXTENSIONS: Readonly<Record<Exclude<FileKind, 'other'>, readonly string[]>> = {
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp'],
  audio: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'tiff'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'tgz', 'iso'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'epub'],
  // What a system runs, installs, or lets change it, at a press: the interface asks once more
  // before opening one. Drawn from what Windows hands to a program of its own without asking
  // (PATHEXT, and the kinds its shell runs: scripts, shortcuts, installers, registry files,
  // what a program of its own opens and runs code from),
  // plus the packages of the other systems. A document that can carry macros is not here: its
  // program asks, and the system's mark makes it.
  program: [
    ...['exe', 'com', 'scr', 'pif', 'cpl', 'msc'],
    ...['bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta'],
    ...['msi', 'msp', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller'],
    ...['lnk', 'url', 'scf', 'reg', 'inf'],
    ...['chm', 'application', 'appref-ms', 'msu', 'diagcab', 'wsc', 'sct', 'xll'],
    ...['sh', 'deb', 'rpm', 'appimage', 'apk', 'dmg', 'pkg', 'jar'],
  ],
};

const KIND_OF_EXTENSION = new Map<string, FileKind>(
  Object.entries(EXTENSIONS).flatMap(([kind, extensions]) =>
    extensions.map((extension) => [extension, kind as FileKind] as const),
  ),
);

// A system decides what to do with a file from its last extension, whatever stands before it
// ("holiday.jpg.scr", "setup.tar.exe", a bare ".cmd"), and Windows first drops the dots and
// spaces a name ends with. A host chooses the name: the kind is read as the system will.
function lastExtension(name: string): string {
  const read = name.replace(/[. ]+$/, '');
  const dot = read.lastIndexOf('.');
  return dot < 0 ? '' : read.slice(dot + 1).toLowerCase();
}

export function fileKindOfName(name: string): FileKind {
  return KIND_OF_EXTENSION.get(lastExtension(name)) ?? FileKind.Other;
}

// What the browser extension saw of a response while a page loaded.
export interface ObservedResponse {
  readonly url: string;
  readonly contentType: string | null;
  readonly contentLength: number | null;
}

export type MediaKind = typeof FileKind.Video | typeof FileKind.Audio;

// Below this a media response is an interface sound or a preview, not something to keep.
export const MIN_MEDIA_BYTES = 512 * 1024;

// The pieces of an adaptive stream (HLS, DASH): thousands per film, none a file on its own.
const STREAM_FRAGMENT = /\.(ts|m4s|m4f|cmfv|cmfa)$/i;
const STREAM_TYPES = ['mpegurl', 'dash+xml', 'mp2t'];
const UNTYPED = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function isMedia(kind: FileKind): kind is MediaKind {
  return kind === FileKind.Video || kind === FileKind.Audio;
}

// A response worth offering as "media of this page": a whole video or audio file. Adaptive
// streams are told apart and left out until Scia can assemble them (docs/product/roadmap.md).
export function capturableMediaKind(response: ObservedResponse): MediaKind | undefined {
  const type = mediaType(response.contentType);
  if (STREAM_TYPES.some((stream) => type.includes(stream))) return undefined;
  const name = fileNameFromUrl(response.url);
  if (STREAM_FRAGMENT.test(name)) return undefined;
  if (response.contentLength !== null && response.contentLength < MIN_MEDIA_BYTES) {
    return undefined;
  }
  if (type.startsWith('video/')) return FileKind.Video;
  if (type.startsWith('audio/')) return FileKind.Audio;
  if (!UNTYPED.has(type)) return undefined;
  const kind = fileKindOfName(name);
  return isMedia(kind) ? kind : undefined;
}

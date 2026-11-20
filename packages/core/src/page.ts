// Why the video of a page was not downloaded. A page is read by a reader of sites (yt-dlp), and
// what it says is turned into these codes; the person reads the text the renderer maps them to.
export const PageFailure = {
  // The video is protected (DRM): Scia does not get around a protection (CLAUDE.md, "Respect the
  // hosts").
  Drm: 'PAGE_DRM',
  // The site says the video cannot be played from here: removed, private, behind a login the
  // person has not handed over, or not in this country. Scia does not get around any of them.
  VideoUnavailable: 'PAGE_UNAVAILABLE',
  // The site offers the video only in forms Scia does not download yet: a stream, or picture and
  // sound as two files (#89).
  FormatUnsupported: 'PAGE_FORMAT_UNSUPPORTED',
  // The page lists several items — a playlist, a channel, an album — which Scia does not expand
  // yet (#8).
  Playlist: 'PAGE_PLAYLIST',
  // The site did not answer properly — busy, in maintenance, too many requests — or not in time:
  // what waiting can mend.
  SiteBusy: 'PAGE_SITE_BUSY',
  // The reader of pages itself failed: it could not be started, or said something Scia does not
  // understand.
  Unreadable: 'PAGE_UNREADABLE',
} as const;
export type PageFailure = (typeof PageFailure)[keyof typeof PageFailure];

// The containers of a video a page's file may be, which end its name. What a site says beyond them
// — an audio file, a document, a program — is not the video of the page.
export const VIDEO_CONTAINERS = [
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'ogv',
  'flv',
  '3gp',
  'avi',
  'wmv',
] as const;
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

// What was taken from a page: the kind of file, and how many lines of picture it has when the
// site says. The row names it ("MP4 1080p").
export interface MediaInfo {
  readonly ext: VideoContainer;
  readonly height: number | null;
}

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
  // The page lists several videos — a playlist, a channel, a profile — which Scia does not
  // expand yet (#8).
  Playlist: 'PAGE_PLAYLIST',
  // The page could not be read: the reader failed, said nothing in time, or said something Scia
  // does not understand.
  Unreadable: 'PAGE_UNREADABLE',
} as const;
export type PageFailure = (typeof PageFailure)[keyof typeof PageFailure];

// What was taken from a page: the kind of file, and how many lines of picture it has when the
// site says. The row names it ("MP4 1080p").
export interface MediaInfo {
  readonly ext: string;
  readonly height: number | null;
}

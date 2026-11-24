import { FileKind, fileKindOfName } from '@scia/core';

// What a link copied to the clipboard is, among those Scia takes (#128). A file host's link is
// the third kind, and the connected service, or AllDebrid's public list, decides it
// (`LinkResolver.serviceFor`, in `DownloadManager`).
export const Offered = { File: 'file', VideoPage: 'video-page' } as const;
export type Offered = (typeof Offered)[keyof typeof Offered];

// The kinds of file a person copies a link to in order to have it. An image is left out: images'
// addresses are copied to share them (the owner, #128).
const KEPT_KINDS: ReadonlySet<FileKind> = new Set([
  FileKind.Video,
  FileKind.Audio,
  FileKind.Archive,
  FileKind.Document,
  FileKind.Program,
]);

interface VideoSite {
  // The site's domain: the address's host is it, or one of its names (`www.`, `m.`, `player.`).
  readonly domain: string;
  // What the path and query of one video's page look like on it. A home page, a channel, a list
  // or a search is not one video: yt-dlp would refuse a list, and the rest would fill the list
  // with pages.
  readonly video: RegExp;
}

// Sites yt-dlp reads, among the most used for video (the owner, #128, #325): recognised by their
// address alone, with nothing asked of the network when a link is copied. A site not here is
// still read when its link is pasted.
const VIDEO_SITES: readonly VideoSite[] = [
  { domain: 'youtube.com', video: /^\/(watch\?(.*&)?v=[\w-]+|shorts\/[\w-]+|live\/[\w-]+)/ },
  { domain: 'youtu.be', video: /^\/[\w-]{6,}/ },
  { domain: 'youtube-nocookie.com', video: /^\/embed\/[\w-]+/ },
  { domain: 'vimeo.com', video: /^\/(video\/)?\d+(\/|\?|$)/ },
  { domain: 'dailymotion.com', video: /^\/video\/\w+/ },
  { domain: 'dai.ly', video: /^\/\w+/ },
  { domain: 'twitch.tv', video: /^\/(videos\/\d+|[\w-]+\/clip\/[\w-]+)/ },
  { domain: 'clips.twitch.tv', video: /^\/[\w-]+$/ },
  { domain: 'tiktok.com', video: /^\/@[^/]+\/video\/\d+/ },
  { domain: 'vm.tiktok.com', video: /^\/\w+/ },
  { domain: 'facebook.com', video: /^\/(watch\/?\?(.*&)?v=\d+|[^/]+\/videos\/\d+|reel\/\d+)/ },
  { domain: 'fb.watch', video: /^\/[\w-]+/ },
  { domain: 'instagram.com', video: /^\/(reels?|tv)\/[\w-]+/ },
  { domain: 'archive.org', video: /^\/details\/[^/?]+/ },
  { domain: 'bilibili.com', video: /^\/video\/\w+/ },
  { domain: 'nicovideo.jp', video: /^\/watch\/\w+/ },
  { domain: 'rumble.com', video: /^\/v[\w-]+\.html/ },
  { domain: 'streamable.com', video: /^\/\w+$/ },
  { domain: 'ted.com', video: /^\/talks\/\w+/ },
  { domain: 'bitchute.com', video: /^\/video\/[\w-]+/ },
  { domain: 'odysee.com', video: /^\/@[^/]+\/[^/]+/ },
  // One video's page has its key first in the query: another parameter before it is a list to yt-dlp.
  { domain: 'pornhub.com', video: /^\/(view_video\.php\?viewkey=[\da-z]+|embed\/[\da-z]+)/ },
];

function isVideoPage(address: URL): boolean {
  const host = address.hostname.toLowerCase();
  const rest = `${address.pathname}${address.search}`;
  return VIDEO_SITES.some(
    (site) => (host === site.domain || host.endsWith(`.${site.domain}`)) && site.video.test(rest),
  );
}

// The name a link ends with, as its path says it: a query or a fragment names no file.
function lastName(address: URL): string {
  const name = address.pathname.slice(address.pathname.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function offeredAs(url: string): Offered | undefined {
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return undefined;
  }
  if (address.protocol !== 'http:' && address.protocol !== 'https:') return undefined;
  if (isVideoPage(address)) return Offered.VideoPage;
  return KEPT_KINDS.has(fileKindOfName(lastName(address))) ? Offered.File : undefined;
}

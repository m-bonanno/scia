// A stand-in for yt-dlp in the specs of its adapter: it answers by the address it is given. Its
// first argument is a file it writes what it was given into — its arguments, its environment and
// its process id — since the adapter hands it no environment of the spec's. Like yt-dlp's builds,
// it unpacks itself into its TEMP first, and leaves that there when it is stopped.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [given, ...args] = process.argv.slice(2);
if (process.env.TEMP) {
  mkdirSync(join(process.env.TEMP, '_MEI1'), { recursive: true });
  writeFileSync(join(process.env.TEMP, '_MEI1', 'python.dll'), 'unpacked');
}
writeFileSync(given, JSON.stringify({ args, env: process.env, pid: process.pid }));
const url = args.at(-1) ?? '';
const fail = (message) => {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
};
const hang = () => setTimeout(() => undefined, 60_000);

const format = (overrides) => ({
  format_id: 'f',
  url: 'https://cdn.example/f.mp4',
  protocol: 'https',
  ext: 'mp4',
  vcodec: 'avc1',
  acodec: 'mp4a',
  height: 720,
  ...overrides,
});

const video = {
  _type: 'video',
  id: 'v1',
  title: 'A video',
  extractor: 'example',
  extractor_key: 'Example',
  formats: [
    format({
      format_id: 'low',
      url: 'https://cdn.example/low.mp4',
      height: 360,
      http_headers: { 'User-Agent': 'Agent/1' },
    }),
    format({
      format_id: 'high',
      url: 'https://cdn.example/high.mp4',
      height: 1080,
      http_headers: { 'User-Agent': 'Agent/1', Referer: 'https://site.example/' },
    }),
  ],
};

if (url.includes('/video')) process.stdout.write(JSON.stringify(video));
else if (url.includes('/one-url')) {
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'One',
      url: 'https://cdn.example/one.webm',
      ext: 'webm',
      protocol: 'https',
      height: 480,
    }),
  );
} else if (url.includes('/odd')) {
  // What a site may say that no format of a video is.
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'Odd',
      formats: [
        format({ url: 'https://cdn.example/negative.mp4', height: -1 }),
        format({ url: 'https://cdn.example/half.mp4', height: 720.5 }),
        format({ url: 'https://cdn.example/huge.mp4', height: 1e300 }),
        format({ url: 'https://cdn.example/setup.exe', ext: 'exe' }),
        format({ url: 'https://cdn.example/maybe.mp4', has_drm: 'maybe' }),
        format({
          url: 'https://cdn.example/headers.mp4',
          http_headers: {
            'User-Agent': 'Agent/1',
            Range: 'bytes=0-1',
            Cookie: 'session=1',
            'Accept-Encoding': 'gzip',
            Host: 'elsewhere.example',
          },
        }),
      ],
    }),
  );
} else if (url.includes('/audio')) {
  // What the shipped build gives for an archive.org audio item: one mp3, its codecs not named.
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'A track',
      formats: [
        { format_id: 'mp3', url: 'https://cdn.example/a.mp3', ext: 'mp3', protocol: 'https' },
      ],
    }),
  );
} else if (url.includes('/sound-only')) {
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'A track',
      formats: [format({ url: 'https://cdn.example/a.mp4', vcodec: 'none', height: null })],
    }),
  );
} else if (url.includes('/other-container')) {
  // Picture, in containers Scia does not list.
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'Elsewhere',
      formats: [
        format({ url: 'https://cdn.example/v.bin', ext: 'unknown_video' }),
        format({ url: 'https://cdn.example/v.ts', ext: 'ts' }),
      ],
    }),
  );
} else if (url.includes('/picture-in-sound')) {
  // A container of sound whose codec of picture the site names: a video, not sound alone.
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'Theora',
      formats: [format({ url: 'https://cdn.example/v.ogg', ext: 'ogg', vcodec: 'theora' })],
    }),
  );
} else if (url.includes('/capitals')) {
  // Containers as a site may spell them.
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'Capitals',
      formats: [format({ url: 'https://cdn.example/v.MP4', ext: 'MP4' })],
    }),
  );
} else if (url.includes('/mp3-in-capitals')) {
  process.stdout.write(
    JSON.stringify({
      _type: 'video',
      title: 'A track',
      formats: [
        { format_id: 'mp3', url: 'https://cdn.example/a.MP3', ext: 'MP3', protocol: 'https' },
      ],
    }),
  );
} else if (url.includes('/no-format-at-all')) {
  process.stdout.write(JSON.stringify({ _type: 'video', title: 'Empty', formats: [] }));
} else if (url.includes('/playlist'))
  process.stdout.write(JSON.stringify({ _type: 'playlist', title: 'Many', entries: [] }));
else if (url.includes('/unknown')) fail(`No suitable extractor found for URL ${url}`);
else if (url.includes('/unsupported')) fail(`Unsupported URL: ${url}`);
// The words of the shipped build on an archive.org book and collection.
else if (url.includes('/book')) fail('opening play-av tag not found');
else if (url.includes('/no-formats')) fail('[Example] v1: No video formats found!');
else if (url.includes('/drm')) fail('[Example] v1: This video is DRM protected');
else if (url.includes('/private'))
  fail('[Example] v1: Private video. Sign in if you have been granted access');
else if (url.includes('/removed'))
  fail('[Example] v1: Video unavailable. This video has been removed');
else if (url.includes('/geo'))
  fail('[Example] v1: The uploader has not made this video available in your country');
else if (url.includes('/busy'))
  fail(
    '[Example] v1: Unable to download webpage: HTTP Error 503: Service Unavailable (caused by <HTTPError 503: Service Unavailable>)',
  );
else if (url.includes('/too-many'))
  fail('[Example] v1: Unable to download webpage: HTTP Error 429: Too Many Requests');
else if (url.includes('/warned')) {
  // A warning that names a cause, before an error that names another.
  process.stderr.write('WARNING: [Example] v1: some formats are DRM protected and not available\n');
  fail('[Example] v1: something no rule knows');
} else if (url.includes('/crash')) {
  // Not yt-dlp's own words: its build stopped before it ran.
  process.stderr.write('[PYI-1:ERROR] Could not create temporary directory!\n');
  process.exit(1);
} else if (url.includes('/garbage')) process.stdout.write('not json at all');
else if (url.includes('/flood')) {
  process.stdout.write('x'.repeat(5000));
  hang();
} else if (url.includes('/slow')) hang();
else fail('[Example] v1: something no rule knows');

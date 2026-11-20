// A stand-in for yt-dlp in the specs of its adapter: it answers by the address it is given, and
// writes the arguments it was given where SCIA_FAKE_YT_DLP_ARGS says.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.SCIA_FAKE_YT_DLP_ARGS)
  writeFileSync(process.env.SCIA_FAKE_YT_DLP_ARGS, JSON.stringify(args));
const url = args.at(-1) ?? '';
const fail = (message) => {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
};

const video = {
  _type: 'video',
  id: 'v1',
  title: 'A video',
  extractor: 'example',
  extractor_key: 'Example',
  formats: [
    {
      format_id: 'low',
      url: 'https://cdn.example/low.mp4',
      protocol: 'https',
      ext: 'mp4',
      vcodec: 'avc1',
      acodec: 'mp4a',
      height: 360,
      http_headers: { 'User-Agent': 'Agent/1' },
    },
    {
      format_id: 'high',
      url: 'https://cdn.example/high.mp4',
      protocol: 'https',
      ext: 'mp4',
      vcodec: 'avc1',
      acodec: 'mp4a',
      height: 1080,
      http_headers: { 'User-Agent': 'Agent/1', Referer: 'https://site.example/' },
    },
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
} else if (url.includes('/playlist'))
  process.stdout.write(JSON.stringify({ _type: 'playlist', title: 'Many', entries: [] }));
else if (url.includes('/unknown')) fail(`No suitable extractor found for URL ${url}`);
else if (url.includes('/unsupported')) fail(`Unsupported URL: ${url}`);
else if (url.includes('/drm')) fail('[Example] v1: This video is DRM protected');
else if (url.includes('/private'))
  fail('[Example] v1: Private video. Sign in if you have been granted access');
else if (url.includes('/removed'))
  fail('[Example] v1: Video unavailable. This video has been removed');
else if (url.includes('/geo'))
  fail('[Example] v1: The uploader has not made this video available in your country');
else if (url.includes('/garbage')) process.stdout.write('not json at all');
else if (url.includes('/slow'))
  setTimeout(() => process.stdout.write(JSON.stringify(video)), 60_000);
else fail('[Example] v1: something no rule knows');

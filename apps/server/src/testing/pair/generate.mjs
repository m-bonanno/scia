// Makes the pictures and sounds the specs of #99 join: three seconds of a synthetic test pattern,
// and of a tone, each in a file of its own, as a site of videos offers its best quality. Made here
// and committed, so that no spec needs a real site. Run by hand, never by a gate:
// `node apps/server/src/testing/pair/generate.mjs`, with ffmpeg on the PATH (a tool of the person
// who regenerates them; Scia neither ships nor runs it).
//
// Two of each: a plain mp4, its movie before its media, and a fragmented one as a DASH site gives
// it — one file, a `sidx`, then a fragment a second.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const picture = [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=96x64:rate=10:duration=3',
  '-an',
  '-c:v',
  'libx264',
  '-profile:v',
  'baseline',
  '-pix_fmt',
  'yuv420p',
  '-g',
  '10',
  '-crf',
  '40',
];
const sound = [
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=22050:duration=3',
  '-vn',
  '-c:a',
  'aac',
  '-ac',
  '1',
  '-b:a',
  '24k',
];
// ffmpeg writes a DASH file to the folder it runs in, not beside its manifest.
const ffmpegIn = (cwd, ...args) =>
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { cwd });
const ffmpeg = (...args) => ffmpegIn(here, ...args);

ffmpeg(...picture, '-movflags', '+faststart', join(here, 'picture.mp4'));
ffmpeg(...sound, '-movflags', '+faststart', join(here, 'sound.m4a'));

for (const [name, source] of [
  ['picture-fragmented.mp4', picture],
  ['sound-fragmented.m4a', sound],
]) {
  const work = mkdtempSync(join(tmpdir(), 'scia-pair-'));
  ffmpegIn(
    work,
    ...source,
    '-f',
    'dash',
    '-single_file',
    '1',
    '-single_file_name',
    'stream.mp4',
    '-seg_duration',
    '1',
    'manifest.mpd',
  );
  renameSync(join(work, 'stream.mp4'), join(here, name));
  rmSync(work, { recursive: true, force: true });
}

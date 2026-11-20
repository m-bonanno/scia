// Makes the HLS streams the specs of #98 read: three seconds of a synthetic test pattern and a
// tone, made here and committed, so that no spec needs a real site. Run by hand, never by a gate:
// `node apps/server/src/testing/hls/generate.mjs`, with ffmpeg on the PATH (a tool of the person
// who regenerates them; Scia neither ships nor runs it).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=96x64:rate=10:duration=3',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=22050:duration=3',
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
  '-c:a',
  'aac',
  '-ac',
  '1',
  '-b:a',
  '24k',
  '-f',
  'hls',
  '-hls_time',
  '1',
  '-hls_playlist_type',
  'vod',
  '-hls_list_size',
  '0',
];

function make(name, extra) {
  const folder = join(here, name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...source, ...extra(folder)], {
    cwd: folder,
    stdio: 'inherit',
  });
}

// MPEG-TS segments, as most sites give them. Not named .ts, which is TypeScript's.
make('ts', () => ['-hls_segment_filename', 'segment%d.mpegts', 'index.m3u8']);
// Fragmented mp4 segments behind an init segment (EXT-X-MAP).
make('fmp4', () => [
  '-hls_segment_type',
  'fmp4',
  '-hls_fmp4_init_filename',
  'init.mp4',
  '-hls_segment_filename',
  'segment%d.m4s',
  'index.m3u8',
]);
// TS segments encrypted with AES-128, the key served beside them: a key fixed here, for specs only.
make('aes', (folder) => {
  writeFileSync(join(folder, 'key.bin'), Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  writeFileSync(join(folder, 'keyinfo'), 'key.bin\nkey.bin\n');
  return [
    '-hls_key_info_file',
    'keyinfo',
    '-hls_segment_filename',
    'segment%d.mpegts',
    'index.m3u8',
  ];
});
rmSync(join(here, 'aes', 'keyinfo'));
console.warn('HLS fixtures written under', here);

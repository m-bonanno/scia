import { describe, expect, it } from 'vitest';
import { capturableMediaKind, FileKind, fileKindOfName, MIN_MEDIA_BYTES } from './file-kind.ts';

describe('fileKindOfName', () => {
  it('tells the kind from the extension, whatever its case', () => {
    expect(fileKindOfName('Film.MKV')).toBe(FileKind.Video);
    expect(fileKindOfName('song.flac')).toBe(FileKind.Audio);
    expect(fileKindOfName('setup.exe')).toBe(FileKind.Program);
    expect(fileKindOfName('backup.tar.gz')).toBe(FileKind.Archive);
    expect(fileKindOfName('manual.pdf')).toBe(FileKind.Document);
    expect(fileKindOfName('photo.webp')).toBe(FileKind.Image);
  });

  it('answers "other" for what it does not know', () => {
    expect(fileKindOfName('README')).toBe(FileKind.Other);
    expect(fileKindOfName('data.xyz')).toBe(FileKind.Other);
  });
});

describe('capturableMediaKind', () => {
  const big = MIN_MEDIA_BYTES * 10;

  it('offers a whole video or audio file by its content type', () => {
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/v?id=1',
        contentType: 'video/mp4',
        contentLength: big,
      }),
    ).toBe(FileKind.Video);
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/a',
        contentType: 'audio/mpeg; charset=binary',
        contentLength: null,
      }),
    ).toBe(FileKind.Audio);
  });

  it('falls back to the extension when the host does not say what it serves', () => {
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/film.mkv?x=1',
        contentType: 'application/octet-stream',
        contentLength: big,
      }),
    ).toBe(FileKind.Video);
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/app.exe',
        contentType: null,
        contentLength: big,
      }),
    ).toBeUndefined();
  });

  it('leaves out interface sounds and previews', () => {
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/click.mp3',
        contentType: 'audio/mpeg',
        contentLength: 2048,
      }),
    ).toBeUndefined();
  });

  it('leaves out the playlists and the fragments of an adaptive stream', () => {
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/master.m3u8',
        contentType: 'application/vnd.apple.mpegurl',
        contentLength: null,
      }),
    ).toBeUndefined();
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/seg-12.ts',
        contentType: 'video/mp2t',
        contentLength: big,
      }),
    ).toBeUndefined();
    expect(
      capturableMediaKind({
        url: 'https://cdn.test/chunk-3.m4s',
        contentType: 'video/mp4',
        contentLength: big,
      }),
    ).toBeUndefined();
  });

  it('ignores what is not media', () => {
    expect(
      capturableMediaKind({
        url: 'https://site.test/app.js',
        contentType: 'text/javascript',
        contentLength: big,
      }),
    ).toBeUndefined();
  });
});

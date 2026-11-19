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

  it('counts as a program what a system runs, installs or lets change it at a press', () => {
    const extensions = [
      // Windows: programs and what is run as one
      ...['exe', 'com', 'scr', 'pif', 'cpl', 'msc'],
      // Windows: scripts, by its own hosts
      ...['bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta'],
      // Windows: installers and packages
      ...['msi', 'msp', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller'],
      // Windows: a shortcut runs what it points at, a registry file changes the system
      ...['lnk', 'reg'],
      // Other systems, and what runs wherever its runtime is
      ...['sh', 'deb', 'rpm', 'appimage', 'apk', 'dmg', 'pkg', 'jar'],
    ];

    for (const extension of extensions) {
      expect(fileKindOfName(`file.${extension}`), extension).toBe(FileKind.Program);
    }
  });

  it('reads the kind as the system does: from the last extension, whatever stands before it', () => {
    expect(fileKindOfName('setup.tar.exe')).toBe(FileKind.Program);
    expect(fileKindOfName('holiday.jpg.scr')).toBe(FileKind.Program);
    expect(fileKindOfName('.cmd')).toBe(FileKind.Program);
    expect(fileKindOfName('SETUP.EXE')).toBe(FileKind.Program);
    // Windows drops the dots and spaces a name ends with before it reads the extension.
    expect(fileKindOfName('setup.exe. .')).toBe(FileKind.Program);
    expect(fileKindOfName('backup.tar.xz')).toBe(FileKind.Archive);
    expect(fileKindOfName('a-very-long-extension.exeexeexeexe')).toBe(FileKind.Other);
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

import { describe, expect, it } from 'vitest';
import {
  FALLBACK_FILE_NAME,
  fileNameFromContentDisposition,
  fileNameFromHost,
  fileNameFromUrl,
  sanitizeFileName,
  isNameTaken,
  uniqueFileName,
} from './file-name.ts';

describe('sanitizeFileName', () => {
  it('replaces what Windows refuses in a name', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j.txt')).toBe('a_b_c_d_e_f_g_h_i_j.txt');
  });

  it('drops the trailing dots and spaces Windows would silently remove', () => {
    expect(sanitizeFileName('  report .  ')).toBe('report');
  });

  it('keeps a reserved device name from being one', () => {
    expect(sanitizeFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFileName('nul')).toBe('_nul');
  });

  it('shortens an endless name without losing its extension', () => {
    const name = sanitizeFileName(`${'x'.repeat(400)}.mkv`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.mkv')).toBe(true);
  });

  it('falls back when nothing is left', () => {
    expect(sanitizeFileName(' .. ')).toBe(FALLBACK_FILE_NAME);
  });
});

describe('fileNameFromUrl', () => {
  it('takes the last path segment, decoded, without the query', () => {
    expect(fileNameFromUrl('https://example.com/files/My%20Film%20(2024).mkv?token=1#t')).toBe(
      'My Film (2024).mkv',
    );
  });

  it('ignores a trailing slash', () => {
    expect(fileNameFromUrl('https://example.com/releases/v2/')).toBe('v2');
  });

  it('never lets an encoded separator leave the folder', () => {
    expect(fileNameFromUrl('https://example.com/a/..%2F..%2Fevil.exe')).toBe('evil.exe');
  });

  it('falls back for a bare host or an address that is not one', () => {
    expect(fileNameFromUrl('https://example.com')).toBe(FALLBACK_FILE_NAME);
    expect(fileNameFromUrl('not a url')).toBe(FALLBACK_FILE_NAME);
  });

  it('keeps a segment whose percent signs are not an encoding', () => {
    expect(fileNameFromUrl('https://example.com/100%.txt')).toBe('100%.txt');
  });
});

describe('fileNameFromContentDisposition', () => {
  it('reads a quoted name', () => {
    expect(fileNameFromContentDisposition('attachment; filename="setup v2.exe"')).toBe(
      'setup v2.exe',
    );
  });

  it('reads a bare name', () => {
    expect(fileNameFromContentDisposition('attachment; filename=archive.zip')).toBe('archive.zip');
  });

  it('prefers the encoded name of RFC 6266', () => {
    expect(
      fileNameFromContentDisposition(
        'attachment; filename="citta.pdf"; filename*=UTF-8\'\'citt%C3%A0.pdf',
      ),
    ).toBe('città.pdf');
  });

  it('keeps only the name of a path a host should never have sent', () => {
    expect(fileNameFromContentDisposition('attachment; filename="..\\..\\boot.ini"')).toBe(
      'boot.ini',
    );
  });

  it('answers nothing when the header names no file', () => {
    expect(fileNameFromContentDisposition('inline')).toBeUndefined();
    expect(fileNameFromContentDisposition('attachment; filename=""')).toBeUndefined();
  });
});

describe('fileNameFromHost', () => {
  it('keeps a plain name as it is', () => {
    expect(fileNameFromHost('Film (2026).mkv')).toBe('Film (2026).mkv');
  });

  it('keeps only the name of a path, whichever way its slashes lean', () => {
    expect(fileNameFromHost('../../etc/passwd')).toBe('passwd');
    expect(fileNameFromHost('..\\..\\Start Menu\\run.exe')).toBe('run.exe');
    expect(fileNameFromHost('C:\\Windows/system.ini')).toBe('system.ini');
  });

  it('makes the name one the disk takes', () => {
    expect(fileNameFromHost('what: a "file"?.txt')).toBe('what_ a _file__.txt');
    expect(fileNameFromHost('con.txt')).toBe('_con.txt');
  });

  it('answers nothing when there is no name', () => {
    expect(fileNameFromHost('')).toBeUndefined();
    expect(fileNameFromHost('   ')).toBeUndefined();
    expect(fileNameFromHost('folder/')).toBeUndefined();
    expect(fileNameFromHost('..')).toBeUndefined();
    expect(fileNameFromHost('a/..')).toBeUndefined();
    expect(fileNameFromHost('.')).toBeUndefined();
  });
});

describe('uniqueFileName', () => {
  it('keeps a free name', () => {
    expect(uniqueFileName('film.mkv', () => false)).toBe('film.mkv');
  });

  it('numbers a copy before the extension', () => {
    const taken = new Set(['film.mkv', 'film (1).mkv']);
    expect(uniqueFileName('film.mkv', (name) => taken.has(name))).toBe('film (2).mkv');
  });

  it('treats a double archive extension as one', () => {
    expect(uniqueFileName('data.tar.gz', (name) => name === 'data.tar.gz')).toBe('data (1).tar.gz');
  });

  it('numbers a name without extension at its end', () => {
    expect(uniqueFileName('LICENSE', (name) => name === 'LICENSE')).toBe('LICENSE (1)');
  });
});

describe('isNameTaken', () => {
  // What a download keeps beside its name while it runs, as the engine names them.
  const WORKING = ['.scia', '.scia.pieces', '.scia.picture', '.scia.sound'];
  const folder = (inList: readonly string[], onDisk: readonly string[]) => ({
    inList: new Set(inList.map((name) => name.toLowerCase())),
    onDisk: (name: string) => onDisk.includes(name),
  });

  it('takes a name in the list or on disk, whatever its case in the list', () => {
    expect(isNameTaken('clip.mp4', folder(['Clip.MP4'], []), WORKING)).toBe(true);
    expect(isNameTaken('clip.mp4', folder([], ['clip.mp4']), WORKING)).toBe(true);
    expect(isNameTaken('clip.mp4', folder(['other.mp4'], ['other.mp4']), WORKING)).toBe(false);
  });

  it.each(WORKING)(
    'takes a name whose working name %s is on disk, or is a name in the list',
    (suffix) => {
      expect(isNameTaken('clip.mp4', folder([], [`clip.mp4${suffix}`]), WORKING)).toBe(true);
      expect(isNameTaken('clip.mp4', folder([`clip.mp4${suffix}`], []), WORKING)).toBe(true);
    },
  );

  it.each(WORKING)(
    'takes a name that is the working name %s of a download in the list, never of a file alone',
    (suffix) => {
      expect(isNameTaken(`clip.mp4${suffix}`, folder(['clip.mp4'], []), WORKING)).toBe(true);
      expect(
        isNameTaken(`CLIP.MP4${suffix.toUpperCase()}`, folder(['clip.mp4'], []), WORKING),
      ).toBe(true);
      // A finished file has nothing beside it: a name ending as a working name is free then.
      expect(isNameTaken(`clip.mp4${suffix}`, folder([], ['clip.mp4']), WORKING)).toBe(false);
    },
  );

  it('gives uniqueFileName a name it can always number past', () => {
    const used = folder(['x'], []);
    expect(uniqueFileName('x.scia', (name) => isNameTaken(name, used, WORKING))).toBe('x (1).scia');
  });
});

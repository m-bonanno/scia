import { describe, expect, it } from 'vitest';
import { checksumIn, dayOf, isNewer, isRelease } from './yt-dlp-releases.ts';

describe('the name of a release of yt-dlp', () => {
  it('is its date, and a number after it for a second release that day', () => {
    expect(isRelease('2026.10.26')).toBe(true);
    expect(isRelease('2023.03.04.1')).toBe(true);
  });

  it('is nothing else: a nightly, a path, a word', () => {
    for (const tag of [
      '2026.10.26.232845.nightly',
      'v2026.10.26',
      '2026.10',
      '../2026.10.26',
      'latest',
      '',
    ]) {
      expect(isRelease(tag)).toBe(false);
    }
  });

  it('is newer by its date, then by its number, never by its letters', () => {
    expect(isNewer('2026.11.02', '2026.10.26')).toBe(true);
    expect(isNewer('2026.10.26.1', '2026.10.26')).toBe(true);
    expect(isNewer('2026.10.26.10', '2026.10.26.9')).toBe(true);
    expect(isNewer('2027.01.01', '2026.12.31')).toBe(true);
    expect(isNewer('2026.10.26', '2026.10.26')).toBe(false);
    expect(isNewer('2026.10.21', '2026.10.26')).toBe(false);
    expect(isNewer('2026.10.26', '2026.10.26.1')).toBe(false);
  });

  it('gives the day it was made, in UTC', () => {
    expect(dayOf('2026.10.26.1').toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('the checksum of a build in SHA2-256SUMS', () => {
  const sums = [
    'e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3  yt-dlp',
    'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d  yt-dlp.exe',
    '0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98  yt-dlp_arm64.exe',
    '',
  ].join('\n');

  it('is the one on the line of its name, and of no name that begins like it', () => {
    expect(checksumIn(sums, 'yt-dlp.exe')).toBe(
      'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
    );
    expect(checksumIn(sums, 'yt-dlp')).toBe(
      'e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3',
    );
  });

  it('is none for a build the release does not list', () => {
    expect(checksumIn(sums, 'yt-dlp_linux')).toBeUndefined();
  });

  it('is none when its build is listed twice, with two checksums', () => {
    const twice = `${sums}${'0'.repeat(64)}  yt-dlp.exe\n`;
    expect(checksumIn(twice, 'yt-dlp.exe')).toBeUndefined();
  });

  it('is read on a line that ends with a carriage return, or names its build in binary mode', () => {
    expect(checksumIn(`${'a'.repeat(64)} *yt-dlp.exe\r\n`, 'yt-dlp.exe')).toBe('a'.repeat(64));
  });

  it('is none when it is no checksum of 64 hexadecimal digits', () => {
    expect(checksumIn(`${'g'.repeat(64)}  yt-dlp.exe\n`, 'yt-dlp.exe')).toBeUndefined();
    expect(checksumIn(`${'a'.repeat(40)}  yt-dlp.exe\n`, 'yt-dlp.exe')).toBeUndefined();
  });
});

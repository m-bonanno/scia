import { describe, expect, it } from 'vitest';
import { BUNDLE_SITES, BundleKind, bundleKindOf, bundleName } from './bundle-links.ts';

describe('bundleKindOf', () => {
  it("takes a file host's folder by the shape of its path", () => {
    expect(bundleKindOf('https://1fichier.com/dir/AbCdEf')).toBe(BundleKind.Folder);
    expect(bundleKindOf('https://mega.nz/folder/AbC123#key-of-the-folder')).toBe(BundleKind.Folder);
    expect(bundleKindOf('https://www.mediafire.com/folder/abc123/Holiday')).toBe(BundleKind.Folder);
    expect(bundleKindOf('https://rapidgator.net/folder/123/holiday.html')).toBe(BundleKind.Folder);
    expect(bundleKindOf('https://turbobit.net/download/folder/123')).toBe(BundleKind.Folder);
    expect(bundleKindOf('https://uploaded.net/f/abc123')).toBe(BundleKind.Folder);
  });

  it("leaves a file host's file to be unlocked as one link", () => {
    expect(bundleKindOf('https://1fichier.com/?abcdef')).toBeUndefined();
    expect(bundleKindOf('https://mega.nz/file/AbC123#key')).toBeUndefined();
    expect(bundleKindOf('https://rapidgator.net/file/123/film.mkv.html')).toBeUndefined();
    // A path that only has the word somewhere else is not a folder.
    expect(bundleKindOf('https://1fichier.com/file/dir/abc')).toBeUndefined();
  });

  it("takes a protector's or a shortener's domain whole", () => {
    expect(bundleKindOf('https://filecrypt.cc/Container/ABCDEF.html')).toBe(BundleKind.Opener);
    expect(bundleKindOf('https://www.filecrypt.cc/Container/ABCDEF.html')).toBe(BundleKind.Opener);
    expect(bundleKindOf('https://bit.ly/3abcXYZ')).toBe(BundleKind.Opener);
    expect(bundleKindOf('https://adf.ly/abc')).toBe(BundleKind.Opener);
  });

  it('reads the host name, never a name somewhere else in the address', () => {
    expect(bundleKindOf('https://example.com/bit.ly/abc')).toBeUndefined();
    expect(bundleKindOf('https://example.com/?u=https://filecrypt.cc/Container/A.html')).toBe(
      undefined,
    );
    expect(bundleKindOf('https://bit.ly.example.com/abc')).toBeUndefined();
    expect(bundleKindOf('https://notbit.ly/abc')).toBeUndefined();
    // A subdomain other than www is another site.
    expect(bundleKindOf('https://files.filecrypt.cc/Container/A.html')).toBeUndefined();
  });

  it('reads the host name and the path in any case', () => {
    expect(bundleKindOf('HTTPS://1FICHIER.COM/DIR/AbCdEf')).toBe(BundleKind.Folder);
  });

  it('takes nothing that is not an http address', () => {
    expect(bundleKindOf('not a link')).toBeUndefined();
    expect(bundleKindOf('ftp://bit.ly/abc')).toBeUndefined();
  });

  it('lists each domain once, in lower case', () => {
    const domains = BUNDLE_SITES.map((site) => site.domain);
    expect(new Set(domains).size).toBe(domains.length);
    expect(domains.every((domain) => domain === domain.toLowerCase())).toBe(true);
  });
});

describe('bundleName', () => {
  it('names the folder after the last part of the path, as the link writes it', () => {
    expect(bundleName('https://www.mediafire.com/folder/abc123/Holiday%20films')).toBe(
      'Holiday films',
    );
    expect(bundleName('https://1fichier.com/dir/AbCdEf')).toBe('AbCdEf');
    expect(bundleName('https://mega.nz/folder/AbC123#key-of-the-folder')).toBe('AbC123');
  });

  it("drops the page's extension a protector's or a host's address ends with", () => {
    expect(bundleName('https://filecrypt.cc/Container/ABCDEF.html')).toBe('ABCDEF');
    expect(bundleName('https://rapidgator.net/folder/123/holiday.htm')).toBe('holiday');
  });

  it('names it after the host when the path says nothing', () => {
    expect(bundleName('https://bit.ly/')).toBe('bit.ly');
    expect(bundleName('https://www.mediafire.com/folder/abc/')).toBe('abc');
  });

  it('makes a name of the path that no path can climb out of', () => {
    expect(bundleName('https://bit.ly/..%2F..%2Fwindows')).toBe('.._.._windows');
    expect(bundleName('https://bit.ly/CON')).toBe('_CON');
    // Not encoded as the web encodes: kept as written.
    expect(bundleName('https://bit.ly/100%')).toBe('100%');
  });
});

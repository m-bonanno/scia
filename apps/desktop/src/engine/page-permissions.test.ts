import { describe, expect, it } from 'vitest';
import { grantsPermission } from './page-permissions.ts';

const APP = 'http://127.0.0.1:47821';

describe('grantsPermission', () => {
  // The one thing the page asked for was to write the extension's pairing code on the clipboard,
  // and Settings no longer offers it until the extension is published (#152).
  it('refuses everything, the app’s own page included', () => {
    for (const permission of [
      'clipboard-sanitized-write',
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
    ]) {
      expect(grantsPermission({ permission, asker: `${APP}/` }, APP)).toBe(false);
    }
  });

  it('refuses any other origin, and an ask that names none', () => {
    const permission = 'clipboard-sanitized-write';
    expect(grantsPermission({ permission, asker: 'https://example.com/' }, APP)).toBe(false);
    expect(grantsPermission({ permission, asker: undefined }, APP)).toBe(false);
  });
});

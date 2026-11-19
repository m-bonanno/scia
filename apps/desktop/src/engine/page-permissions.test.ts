import { describe, expect, it } from 'vitest';
import { grantsPermission } from './page-permissions.ts';

const APP = 'http://127.0.0.1:47821';

describe('grantsPermission', () => {
  it('lets the app’s own page write text on the clipboard', () => {
    expect(
      grantsPermission({ permission: 'clipboard-sanitized-write', asker: `${APP}/` }, APP),
    ).toBe(true);
  });

  it('refuses everything else, whoever asks', () => {
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      expect(grantsPermission({ permission, asker: `${APP}/` }, APP)).toBe(false);
    }
  });

  it('refuses any other origin, and an ask that names none', () => {
    const permission = 'clipboard-sanitized-write';
    expect(grantsPermission({ permission, asker: 'https://example.com/' }, APP)).toBe(false);
    expect(grantsPermission({ permission, asker: 'http://127.0.0.1:9999/' }, APP)).toBe(false);
    expect(grantsPermission({ permission, asker: undefined }, APP)).toBe(false);
    expect(grantsPermission({ permission, asker: 'not a url' }, APP)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { grantsPermission, guardPermissions, PAGE_PERMISSIONS } from './page-permissions.ts';

const APP = 'http://127.0.0.1:47821';
const CLIPBOARD = 'clipboard-sanitized-write';

describe('grantsPermission', () => {
  // The one thing the page asked for was to write the extension's pairing code on the clipboard,
  // and Settings no longer offers it until the extension is published (#152).
  it('refuses everything, the app’s own page included', () => {
    for (const permission of [CLIPBOARD, 'media', 'geolocation', 'notifications']) {
      expect(grantsPermission({ permission, asker: `${APP}/` }, APP, PAGE_PERMISSIONS)).toBe(false);
    }
  });

  // What a later page asks for again is granted to the app's own origin, and to no other.
  describe('given a permission to grant', () => {
    const granted = new Set([CLIPBOARD]);

    it('lets the app’s own page have it, and nothing else', () => {
      expect(grantsPermission({ permission: CLIPBOARD, asker: `${APP}/` }, APP, granted)).toBe(
        true,
      );
      expect(grantsPermission({ permission: 'media', asker: `${APP}/` }, APP, granted)).toBe(false);
    });

    it('refuses any other origin, and an ask that names none', () => {
      for (const asker of [
        'https://example.com/',
        'http://127.0.0.1:9999/',
        undefined,
        'not a url',
      ]) {
        expect(grantsPermission({ permission: CLIPBOARD, asker }, APP, granted)).toBe(false);
      }
    });
  });
});

// The two handlers the session is given: both ask with what the page is granted today.
describe('guardPermissions', () => {
  it('has the session refuse the clipboard to the app’s own page, asked and checked', () => {
    const answers: boolean[] = [];
    guardPermissions(
      {
        setPermissionRequestHandler: (handler) => {
          handler(undefined, CLIPBOARD, (granted) => answers.push(granted), {
            requestingUrl: `${APP}/`,
          });
        },
        setPermissionCheckHandler: (handler) => {
          answers.push(handler(undefined, CLIPBOARD, APP));
        },
      },
      () => APP,
    );

    expect(answers).toEqual([false, false]);
  });
});

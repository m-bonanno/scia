import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ID } from './app-identity.ts';

// electron-builder reads its own file and cannot import this constant: the two are kept equal
// by this spec, since Windows drops, without a word, the notifications of an app whose installed
// id and running id differ.
const builderConfig = readFileSync(
  join(import.meta.dirname, '..', '..', 'electron-builder.yml'),
  'utf8',
);

describe('the app’s identity', () => {
  it('is the same for the installer and for the running app', () => {
    expect(/^appId:\s*(\S+)\s*$/m.exec(builderConfig)?.[1]).toBe(APP_ID);
  });
});

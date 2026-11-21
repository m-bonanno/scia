import { describe, expect, it } from 'vitest';
import { sharedNumbers } from './adr-numbers.mjs';

describe('sharedNumbers', () => {
  it('finds nothing when every record has a number of its own', () => {
    expect(
      sharedNumbers(['0001-electron.md', '0002-pairing.md', 'README.md', 'template.md']),
    ).toEqual([]);
  });

  it('names a number two records share, with both files', () => {
    expect(
      sharedNumbers([
        '0015-a-restart.md',
        '0016-the-magnets-of-the-account.md',
        '0016-the-installer-refuses-an-older-version.md',
        '0017-a-magnet.md',
      ]),
    ).toEqual([
      {
        number: '0016',
        files: [
          '0016-the-installer-refuses-an-older-version.md',
          '0016-the-magnets-of-the-account.md',
        ],
      },
    ]);
  });
});

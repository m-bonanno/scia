import { describe, expect, it } from 'vitest';
import { withoutTrailing } from './text.ts';

describe('withoutTrailing', () => {
  it('drops the run of the given characters a text ends with, in any order', () => {
    expect(withoutTrailing('report. . ', '. ')).toBe('report');
    expect(withoutTrailing('see (https://example.com/a.zip).', '.)')).toBe(
      'see (https://example.com/a.zip',
    );
  });

  it('keeps those characters anywhere but at the end', () => {
    expect(withoutTrailing('.a.b c', '. ')).toBe('.a.b c');
  });

  it('leaves nothing of a text made of them alone, and an empty text empty', () => {
    expect(withoutTrailing(' .. ', '. ')).toBe('');
    expect(withoutTrailing('', '. ')).toBe('');
  });
});

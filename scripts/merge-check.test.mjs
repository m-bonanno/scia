import { describe, expect, it } from 'vitest';
import { exitCodeOf, messageOf } from './merge-check.mjs';

const shas = {
  merge: 'a54e8b3c0ffee5e1a54e8b3c0ffee5e1a54e8b3c',
  head: '946f90f6a2b0f6d71a9b65dfc9803ad4fe8381a4',
  develop: '8ba7cedf20e38e85c4eb38a6c4b53840b64e7a5e',
};

describe('messageOf', () => {
  it('says the verdict on the head holds for the merge, and that CI decides, only when it carries', () => {
    expect(messageOf({ ...shas, outcome: 'carries', files: [] })).toBe(
      "a54e8b3 brought in 8ba7ced and changed nothing of the branch's own diff: the verdict on " +
        '946f90f holds for a54e8b3, and CI on it decides (docs/development/review-flow.md, "Rules").',
    );
  });

  it("sends a merge that changed the branch's own diff to a read of what it brought into those files", () => {
    const line = messageOf({ ...shas, outcome: 'changed', files: ['docs/product/decisions.md'] });

    expect(line).toBe(
      "a54e8b3 changed the branch's own diff in docs/product/decisions.md. Read what the merge " +
        'brought there for a line left twice, `git diff 946f90f a54e8b3 -- docs/product/decisions.md`; ' +
        'after an approval, the tech lead does (docs/development/review-flow.md, "Rules").',
    );
    expect(line).not.toContain('holds');
  });

  it("sends a merge git would not make by itself to a read of the hand's work", () => {
    const line = messageOf({ ...shas, outcome: 'by-hand', files: [] });

    expect(line).toBe(
      'a54e8b3 is not the merge git makes by itself: a conflict resolved by hand, or a merge ' +
        "edited. Read the hand's work, `git show --remerge-diff a54e8b3`; after an approval, the " +
        'tech lead does (docs/development/review-flow.md, "Rules").',
    );
    expect(line).not.toContain('holds');
  });
});

describe('exitCodeOf', () => {
  it('exits 0 only for a merge that keeps the verdict', () => {
    expect(exitCodeOf({ ...shas, outcome: 'carries' })).toBe(0);
    expect(exitCodeOf({ ...shas, outcome: 'changed' })).toBe(1);
    expect(exitCodeOf({ ...shas, outcome: 'by-hand' })).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { checkLinkedIssue, closingIssueNumbers, isExempt } from './linked-issue.mjs';

const fromTheRepository = {
  author: 'someone',
  headRepo: 'm-bonanno/scia',
  baseRepo: 'm-bonanno/scia',
};

describe('closingIssueNumbers', () => {
  it('reads every keyword GitHub closes an issue with, in any case', () => {
    const body = [
      'close #1',
      'Closes #2',
      'closed #3',
      'fix #4',
      'Fixes #5',
      'FIXED #6',
      'resolve #7',
      'Resolves: #8',
      'resolved #9',
    ].join('\n');

    expect(closingIssueNumbers(body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reads the template’s sentence and its References line once each', () => {
    expect(closingIssueNumbers('## What\n\nCloses #28. Some text.\n\n- Closes #28')).toEqual([28]);
  });

  it('ignores a number that is only mentioned', () => {
    expect(closingIssueNumbers('See #12, related to #13, as in PR #14.')).toEqual([]);
  });

  it('ignores the placeholder of the template', () => {
    expect(closingIssueNumbers('Closes #N. _One paragraph._')).toEqual([]);
  });

  it('ignores a keyword glued to a longer word', () => {
    expect(closingIssueNumbers('prefixes #3 and unclosed #4')).toEqual([]);
  });

  it('ignores a number with no # before it', () => {
    expect(closingIssueNumbers('Closes 12')).toEqual([]);
  });

  it('ignores an issue of another repository', () => {
    expect(closingIssueNumbers('Closes other/repo#5')).toEqual([]);
  });

  it('reads nothing from an empty body', () => {
    expect(closingIssueNumbers(null)).toEqual([]);
    expect(closingIssueNumbers('')).toEqual([]);
  });
});

describe('isExempt', () => {
  it('exempts a release, develop into main, from the repository itself', () => {
    expect(isExempt({ ...fromTheRepository, headRef: 'develop', baseRef: 'main' })).toBe(true);
  });

  it('exempts the back-merge of a release, main into develop', () => {
    expect(isExempt({ ...fromTheRepository, headRef: 'main', baseRef: 'develop' })).toBe(true);
  });

  it('does not exempt a branch of a fork that is called main', () => {
    expect(
      isExempt({
        ...fromTheRepository,
        headRepo: 'a-contributor/scia',
        headRef: 'main',
        baseRef: 'develop',
      }),
    ).toBe(false);
  });

  it('does not exempt a work branch', () => {
    expect(isExempt({ ...fromTheRepository, headRef: 'chore/28-public', baseRef: 'develop' })).toBe(
      false,
    );
  });

  it('exempts Dependabot, which no person opens', () => {
    expect(
      isExempt({
        ...fromTheRepository,
        author: 'dependabot[bot]',
        headRef: 'dependabot/npm_and_yarn/x-1.2.3',
        baseRef: 'develop',
      }),
    ).toBe(true);
  });
});

describe('checkLinkedIssue', () => {
  const pr = (body) => ({
    ...fromTheRepository,
    headRef: 'fix/9-something',
    baseRef: 'develop',
    body,
  });
  const kinds = { 9: 'issue', 10: 'pull request' };
  const kindOf = async (number) => kinds[number] ?? 'missing';

  it('passes a PR that closes an issue', async () => {
    expect(await checkLinkedIssue(pr('Closes #9.'), kindOf)).toEqual({ ok: true, issues: [9] });
  });

  it('fails a PR that names no issue', async () => {
    const result = await checkLinkedIssue(pr('A fix.'), kindOf);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Closes #/);
  });

  it('fails a PR whose number is a pull request, not an issue', async () => {
    const result = await checkLinkedIssue(pr('Closes #10'), kindOf);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/#10 is a pull request/);
  });

  it('fails a PR whose number does not exist', async () => {
    const result = await checkLinkedIssue(pr('Closes #99'), kindOf);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/#99 does not exist/);
  });

  it('passes when one of several numbers is an issue', async () => {
    expect(await checkLinkedIssue(pr('Closes #10, closes #9'), kindOf)).toEqual({
      ok: true,
      issues: [9],
    });
  });

  it('passes an exempt PR without asking anything', async () => {
    const asked = [];
    const result = await checkLinkedIssue(
      { ...fromTheRepository, headRef: 'develop', baseRef: 'main', body: 'release' },
      async (number) => {
        asked.push(number);
        return 'missing';
      },
    );

    expect(result).toEqual({ ok: true, issues: [], exempt: true });
    expect(asked).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { MARKER, TITLE, bodyOf, issueStep, listingIssue } from './code-scanning-issue.mjs';

const alert = (number, rule, path, line, severity = 'high') => ({
  number,
  html_url: `https://github.com/o/r/security/code-scanning/${number}`,
  rule: { id: rule, security_severity_level: severity, severity: 'warning' },
  most_recent_instance: { location: { path, start_line: line } },
});

const redos = alert(1, 'js/polynomial-redos', 'packages/core/src/hls.ts', 70);
const hash = alert(5, 'js/insufficient-password-hash', 'apps/server/src/app.ts', 81);
const workflow = alert(7, 'actions/untrusted-checkout', '.github/workflows/gates.yml', 12, null);

const scan = 'the scan of 2026-11-30 on `abc1234`';
const step = (alerts, issue) => issueStep({ alerts, issue, owner: 'owner', scan });

describe('issueStep', () => {
  it('opens the issue when develop has alerts and no issue lists them', () => {
    expect(step([hash, redos])).toEqual({
      kind: 'open',
      title: TITLE,
      body: bodyOf([redos, hash]),
      labels: ['bug', 'area:engine', 'status:triage'],
      assignees: ['owner'],
    });
  });

  it('lists the alerts by number, each with its rule, its severity and where it is', () => {
    const body = bodyOf([workflow, hash, redos]);

    expect(body.startsWith(MARKER)).toBe(true);
    expect(body.split('\n').filter((line) => line.startsWith('| ['))).toEqual([
      '| [#1](https://github.com/o/r/security/code-scanning/1) | `js/polynomial-redos` | high | `packages/core/src/hls.ts:70` |',
      '| [#5](https://github.com/o/r/security/code-scanning/5) | `js/insufficient-password-hash` | high | `apps/server/src/app.ts:81` |',
      '| [#7](https://github.com/o/r/security/code-scanning/7) | `actions/untrusted-checkout` | warning | `.github/workflows/gates.yml:12` |',
    ]);
  });

  it('does nothing when develop has no alert and no issue is open', () => {
    expect(step([])).toEqual({ kind: 'none' });
  });

  it('leaves the issue alone while its alerts stay the same, whatever line ends GitHub kept', () => {
    const issue = { number: 400, body: bodyOf([redos, hash]).replaceAll('\n', '\r\n') };

    expect(step([hash, redos], issue)).toEqual({ kind: 'none' });
  });

  it('edits the issue when the alerts change, and says in a comment which came and which went', () => {
    const issue = { number: 400, body: bodyOf([redos, hash]) };

    expect(step([hash, workflow], issue)).toEqual({
      kind: 'edit',
      number: 400,
      body: bodyOf([hash, workflow]),
      labels: ['bug', 'area:engine', 'area:ci'],
      comment: `The alerts changed with ${scan}. New: #7. No longer open: #1.`,
    });
  });

  it('says only what came, or only what went', () => {
    const issue = { number: 400, body: bodyOf([redos]) };

    expect(step([redos, hash], issue)).toMatchObject({
      comment: `The alerts changed with ${scan}. New: #5.`,
    });
    expect(step([redos], { number: 400, body: bodyOf([redos, hash]) })).toMatchObject({
      comment: `The alerts changed with ${scan}. No longer open: #5.`,
    });
  });

  it('rewrites the list without a comment when only where an alert stands has changed', () => {
    const moved = alert(1, 'js/polynomial-redos', 'packages/core/src/hls.ts', 74);

    expect(step([moved, hash], { number: 400, body: bodyOf([redos, hash]) })).toEqual({
      kind: 'edit',
      number: 400,
      body: bodyOf([moved, hash]),
      labels: ['bug', 'area:engine'],
      comment: undefined,
    });
  });

  it('closes the issue once no alert is left', () => {
    expect(step([], { number: 400, body: bodyOf([redos]) })).toEqual({
      kind: 'close',
      number: 400,
      comment: `No code-scanning alert is open on \`develop\` any more, as of ${scan}.`,
    });
  });
});

describe('listingIssue', () => {
  const bot = { login: 'github-actions[bot]' };

  it('finds the open issue this workflow opened, by its mark', () => {
    const issues = [
      { number: 383, user: { login: 'owner' }, body: `the issue that asked for it: ${MARKER}` },
      { number: 390, user: bot, body: 'another workflow’s issue' },
      { number: 400, user: bot, body: bodyOf([redos]) },
    ];

    expect(listingIssue(issues)).toEqual({ number: 400, body: bodyOf([redos]) });
  });

  it('keeps to the oldest when two were opened, and finds none among no issues', () => {
    const issues = [
      { number: 402, user: bot, body: bodyOf([hash]) },
      { number: 400, user: bot, body: bodyOf([redos]) },
    ];

    expect(listingIssue(issues)).toEqual({ number: 400, body: bodyOf([redos]) });
    expect(listingIssue([])).toBeUndefined();
  });
});

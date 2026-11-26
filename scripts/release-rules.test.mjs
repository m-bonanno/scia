import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { describe, expect, it, vi } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const releaserc = JSON.parse(
  await readFile(new URL('../.releaserc.json', import.meta.url), 'utf8'),
);
const logger = { log: vi.fn() };

// semantic-release hands each plugin its options merged over the file's top level, so an option
// such as `preset` reaches every plugin that does not set its own.
function optionsOf(name) {
  const entry = releaserc.plugins.find((plugin) => [plugin].flat()[0] === name);
  if (!entry) throw new Error(`.releaserc.json runs no ${name}`);
  return { ...releaserc, ...([entry].flat()[1] ?? {}) };
}

const commitOf = (message, index = 0) => ({ hash: `${index}`.repeat(40), message });

const releaseOf = (message) =>
  analyzeCommits(optionsOf('@semantic-release/commit-analyzer'), {
    commits: [commitOf(message)],
    logger,
    cwd,
  });

const notesOf = (messages) =>
  generateNotes(optionsOf('@semantic-release/release-notes-generator'), {
    commits: messages.map(commitOf),
    lastRelease: { gitTag: 'v1.2.3', version: '1.2.3' },
    nextRelease: { gitTag: 'v2.0.0', version: '2.0.0' },
    options: { repositoryUrl: 'https://github.com/m-bonanno/scia.git' },
    cwd,
    logger,
  });

// The table of docs/development/release-flow.md, each commit as a squash merge writes it: the PR's
// title, then the body `gh pr merge --body` gives it.
const RELEASES = [
  ['fix: keep the part file\n\nCloses #1', 'patch'],
  ['perf: read the state once\n\nCloses #1', 'patch'],
  ['hotfix: keep the part file\n\nCloses #1', 'patch'],
  ['revert: keep the part file\n\nThis reverts commit 6f7ff42.\n\nCloses #1', 'patch'],
  ['feat: pause every download\n\nCloses #1', 'minor'],
  ['feat: read a new state\n\nCloses #1\n\nBREAKING CHANGE: a state of 1.x is not read.', 'major'],
  ['feat: read a new state\n\nCloses #1\n\nBREAKING-CHANGE: a state of 1.x is not read.', 'major'],
  ['feat!: read a new state\n\nCloses #1', 'major'],
  ['fix(engine)!: keep the part file elsewhere\n\nCloses #1', 'major'],
  ['refactor!: name the settings anew\n\nCloses #1', 'major'],
  ...['chore', 'docs', 'ci', 'test', 'refactor', 'style', 'build'].map((type) => [
    `${type}: tidy the engine\n\nCloses #1`,
    null,
  ]),
  ['release: v1.2.4', null],
  ['revert: keep the part file\n\nCloses #1', null],
  ['revert: keep the part file\n\nThis reverts commit 6f7ff42\n\nCloses #1', null],
  ['revert(engine): keep the part file\n\nThis reverts commit 6f7ff42.\n\nCloses #1', null],
];

describe('the release a squash merge makes', () => {
  it.each(RELEASES)('%j releases %s', async (message, release) => {
    expect(await releaseOf(message)).toBe(release);
  });
});

describe('the release notes', () => {
  it('list a breaking change by its footer, or by its title when the ! stands alone', async () => {
    const notes = await notesOf([
      'feat!: read a new state\n\nCloses #1',
      'fix: keep the part file\n\nCloses #2\n\nBREAKING CHANGE: the part file is kept elsewhere.',
    ]);

    expect(notes).toContain(
      '### ⚠ BREAKING CHANGES\n\n* read a new state\n* the part file is kept elsewhere.\n',
    );
    expect(notes).toMatch(/### Features\n\n\* read a new state /);
    expect(notes).toMatch(/### Bug Fixes\n\n\* keep the part file /);
  });
});

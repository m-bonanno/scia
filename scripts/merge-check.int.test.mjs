import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMerge } from './merge-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const GOTCHAS = '.claude/gotchas.md';
const DECISIONS = 'docs/product/decisions.md';
const CODE = 'scripts/tool.mjs';
const LOG =
  '# Decisions\n\n## 25 November 2026\n\n- #1: one.\n- #2: two.\n\n## Undated\n\n- Undated.\n';

let box;
let repo;

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const read = (file) => readFileSync(path.join(repo, file), 'utf8');
const write = (file, text) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
};
const edit = (file, from, to) => {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file} holds no ${from}`);
  write(file, text.replace(from, to));
};
const commit = (message) => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
};

function mergeDevelop() {
  try {
    git('merge', '-q', '--no-edit', 'develop');
    return true;
  } catch {
    return false;
  }
}

// A repository of its own under the repository's real .gitattributes, with none of the person's
// own git configuration: their ignore file can hold `.claude/`.
beforeEach(() => {
  box = mkdtempSync(path.join(tmpdir(), 'scia-merge-check-'));
  repo = path.join(box, 'repo');
  mkdirSync(path.join(box, 'xdg'));
  mkdirSync(repo);
  writeFileSync(path.join(box, 'gitconfig'), '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(box, 'gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', path.join(box, 'xdg'));
  for (const who of ['AUTHOR', 'COMMITTER']) {
    vi.stubEnv(`GIT_${who}_NAME`, 'Spec');
    vi.stubEnv(`GIT_${who}_EMAIL`, 'spec@scia.invalid');
  }

  git('init', '-q', '-b', 'develop');
  copyFileSync(path.join(root, '.gitattributes'), path.join(repo, '.gitattributes'));
  write(GOTCHAS, '# Gotchas\n\n## Tooling\n\n- → First.\n- → Second.\n\n## Specs\n\n- → Third.\n');
  write(DECISIONS, LOG);
  write(CODE, 'export const a = 1;\nexport const b = 1;\n');
  commit('base');
  git('checkout', '-q', '-b', 'feature');
});

afterEach(() => {
  rmSync(box, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function onBothSides(feature, develop) {
  feature();
  commit('feature');
  git('checkout', '-q', 'develop');
  develop();
  commit('develop');
  git('checkout', '-q', 'feature');
}

describe('checkMerge', () => {
  it(`merges two branches that both add an entry to ${DECISIONS} without a conflict, and keeps the verdict`, () => {
    onBothSides(
      () => {
        edit(DECISIONS, '- #2: two.\n', '- #2: two.\n- #3: the branch’s.\n');
        edit(CODE, 'a = 1', 'a = 2');
      },
      () => edit(DECISIONS, '- #2: two.\n', '- #2: two.\n- #4: develop’s.\n'),
    );

    expect(mergeDevelop()).toBe(true);
    expect(read(DECISIONS)).toContain(
      '- #2: two.\n- #3: the branch’s.\n- #4: develop’s.\n\n## Undated',
    );
    expect(checkMerge(repo)).toMatchObject({ outcome: 'carries' });
  });

  it(`merges two branches that both open the same day in ${DECISIONS} under one heading`, () => {
    const day = (entry) => () =>
      edit(DECISIONS, '## Undated\n', `## 26 November 2026\n\n- ${entry}\n\n## Undated\n`);
    onBothSides(day('#3: the branch’s.'), day('#4: develop’s.'));

    expect(mergeDevelop()).toBe(true);
    expect(read(DECISIONS)).toBe(
      '# Decisions\n\n## 25 November 2026\n\n- #1: one.\n- #2: two.\n\n## 26 November 2026\n\n' +
        '- #3: the branch’s.\n- #4: develop’s.\n\n## Undated\n\n- Undated.\n',
    );
    // The day's heading is develop's now, no longer the branch's.
    expect(checkMerge(repo)).toMatchObject({ outcome: 'changed' });
  });

  it(`answers changed when ${DECISIONS}' driver leaves an entry twice: a note added where develop appended`, () => {
    onBothSides(
      () => edit(DECISIONS, '- #2: two.\n', '- #2: two. Changed on 27 November 2026 (#5).\n'),
      () => edit(DECISIONS, '- #2: two.\n', '- #2: two.\n- #4: develop’s.\n'),
    );

    expect(mergeDevelop()).toBe(true);
    expect(read(DECISIONS)).toContain('- #2: two. Changed on 27 November 2026 (#5).\n- #2: two.\n');
    expect(checkMerge(repo)).toMatchObject({ outcome: 'changed' });
  });

  it(`leaves ${GOTCHAS} to conflict, and sends the conflict resolved by hand to the tech lead`, () => {
    onBothSides(
      () => edit(GOTCHAS, '- → Second.\n', '- → Second.\n- → The branch’s own.\n'),
      () => edit(GOTCHAS, '- → Second.\n', '- → Second.\n- → Develop’s own.\n'),
    );

    expect(mergeDevelop()).toBe(false);
    write(
      GOTCHAS,
      '# Gotchas\n\n## Tooling\n\n- → First.\n- → Second.\n- → The branch’s own.\n- → Develop’s own.\n\n## Specs\n\n- → Third.\n',
    );
    git('add', '-A');
    git('commit', '-q', '--no-edit');

    expect(checkMerge(repo)).toMatchObject({ outcome: 'by-hand' });
  });

  it("sends to the tech lead a conflict resolved by hand, even one that keeps the branch's own diff", () => {
    onBothSides(
      () => edit(CODE, 'a = 1', 'a = 2'),
      () => edit(CODE, 'b = 1', 'b = 2'),
    );

    expect(mergeDevelop()).toBe(false);
    write(CODE, 'export const a = 2;\nexport const b = 2;\n');
    git('add', CODE);
    git('commit', '-q', '--no-edit');

    expect(checkMerge(repo)).toMatchObject({ outcome: 'by-hand' });
  });

  it('sends to the tech lead a merge edited after git made it, even by spaces a diff’s id does not see', () => {
    onBothSides(
      () => edit(CODE, 'a = 1', 'a = 2'),
      () => edit(GOTCHAS, '- → Third.\n', '- → Third.\n- → Develop’s own.\n'),
    );

    expect(mergeDevelop()).toBe(true);
    edit(CODE, 'a = 2', 'a  =  2');
    git('commit', '-q', '-a', '--amend', '--no-edit');

    expect(checkMerge(repo)).toMatchObject({ outcome: 'by-hand' });
  });

  it("reads the merge under the branch's own attributes, as git made it: a branch older than the union driver", () => {
    const withUnion = read('.gitattributes');
    git('checkout', '-q', 'develop');
    write('.gitattributes', withUnion.replace(/^.*merge=union\n/gm, ''));
    commit('before the union driver');
    git('checkout', '-q', '-B', 'feature', 'develop');
    onBothSides(
      () => edit(DECISIONS, '- #2: two.\n', '- #2: two.\n- #3: the branch’s.\n'),
      () => {
        write('.gitattributes', withUnion);
        edit(DECISIONS, '- #2: two.\n', '- #2: two.\n- #4: develop’s.\n');
      },
    );

    expect(mergeDevelop()).toBe(false);
    write(
      DECISIONS,
      LOG.replace('- #2: two.\n', '- #2: two.\n- #3: the branch’s.\n- #4: develop’s.\n'),
    );
    git('add', '-A');
    git('commit', '-q', '--no-edit');

    expect(checkMerge(repo)).toMatchObject({ outcome: 'by-hand' });
  });

  it('names the merge, the head it was made on and the develop it brought in', () => {
    onBothSides(
      () => edit(CODE, 'a = 1', 'a = 2'),
      () => edit(GOTCHAS, '- → Third.\n', '- → Third.\n- → Develop’s own.\n'),
    );
    const head = git('rev-parse', 'feature');
    const develop = git('rev-parse', 'develop');
    mergeDevelop();

    expect(checkMerge(repo)).toEqual({
      outcome: 'carries',
      merge: git('rev-parse', 'HEAD'),
      head,
      develop,
    });
  });

  it("reads the diffs as git writes them, whatever the person's colours or diff tool", () => {
    onBothSides(
      () => edit(DECISIONS, '- #2: two.\n', '- #2: two. Changed on 27 November 2026 (#5).\n'),
      () => edit(DECISIONS, '- #2: two.\n', '- #2: two.\n- #4: develop’s.\n'),
    );
    mergeDevelop();
    writeFileSync(
      path.join(box, 'gitconfig'),
      '[color]\n\tui = always\n\tdiff = always\n[diff]\n\texternal = false\n',
    );

    expect(checkMerge(repo)).toMatchObject({ outcome: 'changed' });
  });

  it('refuses a merge of more than two commits', () => {
    git('checkout', '-q', '-b', 'other', 'develop');
    edit(GOTCHAS, '- → Third.\n', '- → Third.\n- → Other’s own.\n');
    commit('other');
    git('checkout', '-q', 'develop');
    edit(GOTCHAS, '- → First.\n', '- → First.\n- → Develop’s own.\n');
    commit('develop');
    git('checkout', '-q', 'feature');
    edit(CODE, 'a = 1', 'a = 2');
    commit('feature');
    git('merge', '-q', '--no-edit', 'develop', 'other');

    expect(() => checkMerge(repo)).toThrow(/not a merge of two commits/);
  });

  it('refuses a commit that is not a merge', () => {
    edit(CODE, 'a = 1', 'a = 2');
    commit('feature');

    expect(() => checkMerge(repo)).toThrow(/not a merge/);
  });
});

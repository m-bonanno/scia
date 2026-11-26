import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { changesSince, STRYKER } from './mutate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const folders = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// A repository of its own, with nothing of the person's git configuration that would change a
// commit: no signing, no hooks, a branch named here.
function repository() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'scia-mutate-'));
  folders.push(cwd);
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Scia',
          GIT_AUTHOR_EMAIL: 'scia@example.invalid',
          GIT_COMMITTER_NAME: 'Scia',
          GIT_COMMITTER_EMAIL: 'scia@example.invalid',
        },
      },
    );
  const write = (file, lines) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), `${lines.join('\n')}\n`);
  };
  git('init', '--quiet', '--initial-branch=develop');
  return { cwd, git, write };
}

const tenLines = Array.from(
  { length: 10 },
  (_, at) => `const line${String(at + 1)} = ${String(at)};`,
);

describe('changesSince', () => {
  it("reads what the branch changed since it left the base: its commits, the tree's changes and its new files", () => {
    const { cwd, git, write } = repository();
    write('apps/server/src/a.ts', tenLines);
    write('apps/server/src/gone.ts', tenLines);
    git('add', '--all');
    git('commit', '--quiet', '--message', 'base');

    git('switch', '--quiet', '--create', 'work');
    write(
      'apps/server/src/a.ts',
      tenLines.map((line, at) => (at === 2 ? `${line} // third` : line)),
    );
    write('apps/server/src/b.ts', [
      'export const b = 1;',
      'export const c = 2;',
      'export const d = 3;',
    ]);
    git('rm', '--quiet', 'apps/server/src/gone.ts');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'work');

    // The base moves on after the branch left it: what it gained is not the branch's.
    git('switch', '--quiet', 'develop');
    write('apps/server/src/d.ts', ['export const f = 5;']);
    git('add', '--all');
    git('commit', '--quiet', '--message', 'develop moves on');
    git('switch', '--quiet', 'work');

    write(
      'apps/server/src/a.ts',
      tenLines.map((line, at) =>
        at === 2 ? `${line} // third` : at === 7 ? `${line} // eighth` : line,
      ),
    );
    write('apps/server/src/c.ts', ['export const e = 4;']);

    expect(changesSince('develop', { cwd })).toEqual([
      {
        file: 'apps/server/src/a.ts',
        lines: [
          [3, 3],
          [8, 8],
        ],
      },
      { file: 'apps/server/src/b.ts', lines: [[1, 3]] },
      { file: 'apps/server/src/c.ts', lines: undefined },
    ]);
  });

  it('says which ref it could not compare with', () => {
    const { cwd, git, write } = repository();
    write('a.ts', ['export const a = 1;']);
    git('add', '--all');
    git('commit', '--quiet', '--message', 'base');

    const failure = (() => {
      try {
        changesSince('origin/nowhere', { cwd });
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(failure?.message).toBe('git could not compare the branch with origin/nowhere');
    expect(String(failure?.cause?.stderr)).toMatch(/origin\/nowhere/);
  });
});

it("runs Stryker's own command", () => {
  const version = spawnSync(process.execPath, [path.join(root, STRYKER), '--version'], {
    encoding: 'utf8',
  });

  expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
});

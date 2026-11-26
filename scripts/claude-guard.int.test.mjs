import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentBranch, readText } from './claude-guard.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const guard = path.join(root, 'scripts', 'claude-guard.mjs');

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

// The guard as Claude Code runs it: the hook's input on stdin, its answer on stdout.
function hook(command, { cwd = repo, input } = {}) {
  const run = spawnSync(process.execPath, [guard], {
    input:
      input ??
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        cwd,
      }),
    encoding: 'utf8',
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.trim() === '' ? null : JSON.parse(run.stdout).hookSpecificOutput;
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'scia-guard-'));
  git('init', '-q', '-b', 'develop');
  git(
    '-c',
    'user.name=Scia',
    '-c',
    'user.email=scia@example.invalid',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'x',
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('what the guard reads on the disk', () => {
  it("reads a repository's branch, and nothing where there is no repository", () => {
    expect(currentBranch(repo)).toBe('develop');
    git('checkout', '-q', '-b', 'chore/1-work');
    expect(currentBranch(repo)).toBe('chore/1-work');
    expect(currentBranch(path.join(repo, 'missing'))).toBe('');
  });

  it("reads a file's text, and nothing where there is no file", () => {
    writeFileSync(path.join(repo, 'body.md'), 'A body.\n');
    expect(readText(path.join(repo, 'body.md'))).toBe('A body.\n');
    expect(readText(path.join(repo, 'missing.md'))).toBeNull();
  });
});

describe("the guard, as Claude Code's hook", () => {
  it('reads the branch of the real repository a command runs in', () => {
    expect(hook('git commit -m "chore: x"')).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
    expect(hook('git commit -m "chore: x"').permissionDecisionReason).toMatch(
      /^Scia's guard \(protected-branch\)/,
    );

    git('checkout', '-q', '-b', 'chore/1-work');
    expect(hook('git commit -m "chore: x"')).toBeNull();
  });

  it('reads a body from its file, relative to the directory the command runs in', () => {
    git('checkout', '-q', '-b', 'chore/1-work');
    const trailer = ['Co-Authored-By', ': Claude <noreply@anthropic.com>'].join('');
    writeFileSync(path.join(repo, 'body.md'), `## What\n\nA change.\n\n${trailer}\n`);
    expect(hook('gh pr edit 1 --body-file body.md')?.permissionDecisionReason).toMatch(
      /\(attribution\)/,
    );

    writeFileSync(path.join(repo, 'body.md'), '## What\n\nA change.\n');
    expect(hook('gh pr edit 1 --body-file body.md')).toBeNull();
  });

  it('asks the owner for what is theirs', () => {
    expect(hook('gh pr merge 2 --merge --match-head-commit abc1234')).toMatchObject({
      permissionDecision: 'ask',
    });
  });

  it('lets a command through when its input is not a hook input', () => {
    expect(hook('', { input: 'not json' })).toBeNull();
  });

  it('is the hook .claude/settings.json registers before every shell command', () => {
    const settings = JSON.parse(readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    const bash = settings.hooks.PreToolUse.find((entry) => entry.matcher === 'Bash');
    expect(bash.hooks).toEqual([
      { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/claude-guard.mjs"' },
    ]);
  });
});

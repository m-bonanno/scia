import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decide, hookOutput, splitCommand } from './claude-guard.mjs';

// The directories a command runs in, and the branch each one is on. Resolved, so the specs hold on
// Windows, where '/dev' is 'C:\dev'.
const DEV = path.resolve('/dev');
const MAIN = path.resolve('/main');
const WORK = path.resolve('/work');
const BRANCHES = {
  [DEV]: 'develop',
  [MAIN]: 'main',
  [WORK]: 'chore/1-work',
  [os.homedir()]: 'develop',
  [path.join(os.homedir(), 'scia-dev')]: 'develop',
};
const branchOf = (dir) => BRANCHES[dir] ?? '';
const inWork = (file) => path.join(WORK, file);

const verdict = (command, { cwd = WORK, files = {} } = {}) =>
  decide(command, { cwd, branchOf, readText: (file) => files[file] ?? null });

// Every refusal and every question says why, and what to do instead, in a sentence.
const expectDeny = (rule, command, options) => {
  const result = verdict(command, options);
  expect(result, command).toMatchObject({ kind: 'deny', rule });
  expect(result.reason, command).toMatch(/\w.*\.$/);
};
const expectAsk = (rule, command, options) => {
  const result = verdict(command, options);
  expect(result, command).toMatchObject({ kind: 'ask', rule });
  expect(result.reason, command).toMatch(/\w.*\.$/);
};
const expectAllow = (command, options) => {
  expect(verdict(command, options), command).toEqual({ kind: 'allow' });
};

// Built from parts, so no file of the repo holds a real trailer or a token's shape whole.
const trailer = ['Co-Authored-By', ': Claude Opus 5.5 <noreply@anthropic.com>'].join('');
const generatedLine = [
  '\u{1F916} Generated',
  ' with [Claude Code](https://claude.com/claude-code)',
].join('');
const githubToken = 'ghp_' + 'a1B2'.repeat(9);

describe('splitCommand', () => {
  const words = (text) => splitCommand(text).segments;
  const inner = (text) => splitCommand(text).inner;

  it('splits words on blanks, and keeps what quotes hold together', () => {
    expect(words(`a 'b c' "d e"\tf`)).toEqual([['a', 'b c', 'd e', 'f']]);
    expect(words('a \'\' ""')).toEqual([['a', '', '']]);
    expect(words('a b\\ c')).toEqual([['a', 'b c']]);
  });

  it('reads the escapes of a double-quoted word, and keeps any other backslash', () => {
    expect(words('a "x \\"y\\" \\\\ \\$z \\`w\\` \\n"')).toEqual([['a', 'x "y" \\ $z `w` \\n']]);
    expect(inner('a "\\`w\\`"')).toEqual([]);
  });

  it('joins a line continued by a backslash, and drops a comment', () => {
    expect(words('a \\\nb')).toEqual([['a', 'b']]);
    expect(words('a # b c\nd')).toEqual([['a'], ['d']]);
    expect(words('a#b')).toEqual([['a#b']]);
  });

  it('splits commands on the operators and newlines', () => {
    expect(words('a; b && c || d | e & f\ng (h)')).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
      ['f'],
      ['g'],
      ['h'],
    ]);
  });

  it('keeps a command substitution in its word and hands its command back', () => {
    expect(splitCommand('a $(b c) d')).toEqual({
      segments: [['a', '$(b c)', 'd']],
      inner: ['b c'],
    });
    expect(inner('a "$(b "c)" d)" e')).toEqual(['b "c)" d']);
    expect(inner("a $(b 'c)' d)")).toEqual(["b 'c)' d"]);
    expect(inner("a $(b 'c' d) e")).toEqual(["b 'c' d"]);
    expect(inner('a $(b "c" d) e')).toEqual(['b "c" d']);
    expect(inner("a $(b 'c\\' d) e")).toEqual(["b 'c\\' d"]);
    expect(inner('a $(b \\) c)')).toEqual(['b \\) c']);
    expect(inner('a $(b $(c) d)')).toEqual(['b $(c) d']);
    expect(splitCommand('a `b c` d')).toEqual({ segments: [['a', '`b c`', 'd']], inner: ['b c'] });
    expect(inner('a "x`y`z"')).toEqual(['y']);
  });

  it('reads a quote or a substitution left open to the end of the text', () => {
    expect(words("a 'b c")).toEqual([['a', 'b c']]);
    expect(words('a "b c')).toEqual([['a', 'b c']]);
    expect(inner('a $(b c')).toEqual(['b c']);
    expect(inner('a `b c')).toEqual(['b c']);
  });

  it('keeps a substitution whole in its word, quoted or not, and reads its quotes', () => {
    expect(words('a "x$(y)z"')).toEqual([['a', 'x$(y)z']]);
    expect(inner('a $(b "c\\")" d)')).toEqual(['b "c\\")" d']);
    expect(splitCommand('a "$x" b')).toEqual({ segments: [['a', '$x', 'b']], inner: [] });
  });

  it('reads a trailing backslash, a comment that runs to the end, and an ANSI-C quoted word', () => {
    expect(words("a $'b\\nc\\td\\\\e\\'f\\\"g\\x'")).toEqual([['a', 'b\nc\td\\e\'f"g\\x']]);
    expect(words("a $'b")).toEqual([['a', 'b']]);
    expect(words("a $'b\\rc'")).toEqual([['a', 'b\rc']]);
    expect(words("a $'b\\")).toEqual([['a', 'b\\']]);
    expect(words('a \\')).toEqual([['a', '']]);
    expect(words('a # b')).toEqual([['a']]);
  });
});

describe('protected branches', () => {
  it('refuses a commit, merge, rebase or reset on develop or main', () => {
    for (const command of [
      'git commit -m "chore: x"',
      'git merge chore/1-work',
      'git rebase main',
      'git cherry-pick abc123',
      'git revert abc123',
      'git am patch.mbox',
      'git reset --hard HEAD~1',
      'git pull',
    ]) {
      expectDeny('protected-branch', command, { cwd: DEV });
    }
    expectDeny('protected-branch', 'git commit -m "chore: x"', { cwd: MAIN });
  });

  it('follows cd, git -C, eval, bash -c and $(…) to the repository a command runs in', () => {
    expectDeny('protected-branch', 'cd /dev && git commit -m x');
    expectDeny('protected-branch', 'git -C /dev commit -m x');
    expectDeny('protected-branch', 'bash -c "cd /dev; git commit -m x"');
    expectDeny('protected-branch', 'eval git push origin develop');
    expectDeny('protected-branch', 'eval eval "git push origin develop"');
    expectDeny('protected-branch', 'echo "$(git push origin develop)"');
    expectDeny('protected-branch', 'echo `git push origin develop`');
    expectDeny('protected-branch', 'cd ~/scia-dev && git commit -m x');
    expectDeny('protected-branch', 'cd ~ && git commit -m x');
    expectDeny('protected-branch', 'cd && git commit -m x');
  });

  it('reads git under another name, and through a wrapper', () => {
    expectDeny('protected-branch', 'git.exe push origin develop');
    expectDeny('protected-branch', '/usr/bin/git push origin develop');
    for (const wrapper of ['builtin', 'command', 'env', 'exec', 'nohup', 'sudo', 'time', 'xargs']) {
      expectDeny('protected-branch', `${wrapper} git push origin develop`);
    }
  });

  it('reads the command a shell is handed with -c, and only that', () => {
    for (const shell of ['bash', 'dash', 'ksh', 'sh', 'zsh']) {
      expectDeny('protected-branch', `${shell} -c "git push origin develop"`);
    }
    expectDeny('protected-branch', 'bash -lc "git push origin develop"');
    expectAllow('bash -e "git push origin develop"');
    expectAllow('bash -c');
    expectAllow('printf pr review 1');
    expectAllow('bash "git push origin develop"');
    expectAllow('bash script-c "git push origin develop"');
    expectAllow('bash -c= "git push origin develop"');
    expectAllow('echo -c "git push origin develop"');
    expectDeny('protected-branch', 'bash -cl "git push origin develop"');
    expectAllow('echo push origin develop');
    expectAllow('a-b=1 git push origin develop');
  });

  it("reads git's own options and their values", () => {
    for (const option of ['--git-dir', '--work-tree', '--namespace']) {
      expectDeny('protected-branch', `git ${option} x push origin develop`);
    }
    expectDeny('protected-branch', 'git -c user.name=x commit -m y', { cwd: DEV });
    expectAllow('git -c user.name=x commit -m y');
    expectAllow('git --version');
    expectAllow('git -C');
    expectDeny('protected-branch', 'git --no-pager push origin develop');
    expectAllow('git -C core.hooksPath=x status');
  });

  it('lets develop be brought up to date with origin', () => {
    expectAllow('git pull --ff-only', { cwd: DEV });
    expectAllow('git merge --ff-only origin/develop', { cwd: DEV });
    expectAllow('git reset --hard origin/develop', { cwd: DEV });
    expectAllow('git reset --hard @{u}', { cwd: DEV });
    expectAllow('git reset --hard @{upstream}', { cwd: DEV });
    expectAllow('git fetch origin && git status', { cwd: DEV });
  });

  it('lets a branch be cut from develop and committed to in one command', () => {
    for (const [command, option] of [
      ['checkout', '-b'],
      ['checkout', '-B'],
      ['switch', '-c'],
      ['switch', '-C'],
      ['switch', '--create'],
      ['switch', '--force-create'],
    ]) {
      expectAllow(
        `git ${command} ${option} chore/2-next origin/develop && git commit -m "chore: next"`,
        {
          cwd: DEV,
        },
      );
    }
    expectAllow('git switch chore/2-next && git commit -m "chore: next"', { cwd: DEV });
    expectDeny('protected-branch', 'git add notes.txt && git commit -m x', { cwd: DEV });
    expectDeny('protected-branch', 'git checkout -- README.md && git commit -m x', { cwd: DEV });
    expectDeny('protected-branch', 'git checkout chore/2-next README.md && git commit -m x', {
      cwd: DEV,
    });
  });

  it('allows the work on a work branch', () => {
    expectAllow('git commit -m "chore: x"');
    expectAllow('git merge origin/develop');
    expectAllow('git push');
    expectAllow('git push -u origin chore/1-work');
    expectAllow('git push origin HEAD');
    expectAllow('git push main');
    expectAllow('git push origin chore/1-work', { cwd: DEV });
    expectAllow('git log develop && git diff main');
  });

  it('refuses a push that lands on develop or main', () => {
    for (const command of [
      'git push origin develop',
      'git push origin HEAD:develop',
      'git push origin +main',
      'git push --force origin chore/1-work:refs/heads/develop',
      'git push --delete origin develop',
      'git push --all origin',
      'git push --mirror',
    ]) {
      expectDeny('protected-branch', command);
    }
    expectDeny('protected-branch', 'git push', { cwd: DEV });
    expectDeny('protected-branch', 'git push origin HEAD', { cwd: DEV });
  });

  it("reads push's options that take a value as such", () => {
    for (const option of ['-o', '--push-option', '--repo', '--receive-pack', '--exec']) {
      expectDeny('protected-branch', `git push ${option} x origin`, { cwd: DEV });
    }
  });

  it('refuses moving develop or main by another road', () => {
    for (const option of [
      '-d',
      '-D',
      '-f',
      '-m',
      '-M',
      '-c',
      '-C',
      '--delete',
      '--force',
      '--move',
      '--copy',
    ]) {
      expectDeny('protected-branch', `git branch ${option} develop`);
    }
    expectAllow('git branch --list develop');
    expectAllow('git branch -d chore/0-old');
    expectDeny('protected-branch', 'git branch -f develop chore/1-work');
    expectAllow('git log -m develop');
    expectDeny('protected-branch', 'git update-ref refs/heads/main HEAD');
    expectDeny('protected-branch', 'git update-ref -- refs/heads/main HEAD');
    expectAllow('git update-ref refs/heads/chore/1-work HEAD');
  });

  it('reads a heredoc body as text, not as a command', () => {
    expectAllow("cat > note.md <<'EOF'\ngit push origin develop\nEOF");
  });

  it('reads the rest of the line that opens a heredoc', () => {
    expectDeny('protected-branch', "cat <<'EOF' | git commit -F -\nchore: x\nEOF", { cwd: DEV });
    expectDeny(
      'protected-branch',
      "git commit -F - <<'EOF' && git push origin develop\nchore: x\nEOF",
    );
    expectDeny('no-verify', "cat > b.md <<'EOF'; HUSKY=0 git commit -m x\nbody\nEOF");
  });
});

describe('the hooks of git', () => {
  it('refuses skipping them', () => {
    for (const command of [
      'git commit --no-verify -m "chore: x"',
      'git commit -nm "chore: x"',
      'git commit -an -m "chore: x"',
      'git push --no-verify origin chore/1-work',
      'HUSKY=0 git commit -m "chore: x"',
      'export HUSKY=0; git commit -m "chore: x"',
      'env HUSKY=0 git push',
      'git -c core.hooksPath=/dev/null commit -m x',
      'git -c core.hooksPath=/dev/null push origin chore/1-work',
      'git -c core.hooksPath=/dev/null merge chore/0-old',
      'git -c core.hooksPath=/dev/null pull',
      'git config core.hooksPath /tmp/none',
      'git config --unset core.hooksPath',
      'HUSKY=0',
    ]) {
      expectDeny('no-verify', command);
    }
  });

  it('does not read a value, a dry run or a near name as skipping them', () => {
    for (const letter of ['m', 'F', 'C', 'c', 't', 'u', 'S']) {
      expectAllow(`git commit -${letter}n`);
    }
    expectAllow('git commit --amend --no-edit');
    expectAllow('git push -n origin chore/1-work');
    expectAllow('HUSKY=1 git commit -m x');
    expectAllow('FOO=0 git commit -m x');
    expectAllow('export HUSKY=1');
    expectAllow('git -c alias.x=core.hooksPath commit -m y');
    expectAllow('git -c alias.x=core.hooksPath=y commit -m z');
    expectAllow('git -c core.hooksPath=/dev/null worktree add --detach /tmp/pr-1 abc123');
    expectAllow('git -c core.hooksPath=/dev/null checkout chore/1-work');
    expectAllow('git -C core.hooksPath=x commit -m y');
    expectAllow('git commit -m HUSKY=0');
    expectAllow('echo HUSKY=0');
    expectAllow('git config alias.core.hookspath x');
    expectAllow('git config core.hooksPathX y');
    expectAllow('git log -- core.hooksPath');
  });
});

describe('tags and releases', () => {
  it('refuses a tag pushed or deleted by hand, and a release written by hand', () => {
    for (const command of [
      'git push --tags',
      'git push --follow-tags origin chore/1-work',
      'git push origin v1.0.0',
      'git push origin v10.2.3',
      'git push origin v1.10.0',
      'git push origin v1.0.0:release-copy',
      'git push origin refs/tags/v1.0.0-beta.56',
      'gh api -X POST repos/m-bonanno/scia/git/tags -f tag=v9.9.9',
      'gh api -X POST repos/m-bonanno/scia/git/refs -f ref=refs/tags/v9.9.9 -f sha=abc',
      'gh api -X PATCH repos/m-bonanno/scia/releases/123 -f draft=false',
      'gh api -X POST repos/m-bonanno/scia/releases -f tag_name=v9.9.9',
    ]) {
      expectDeny('tags', command);
    }
    for (const action of ['create', 'edit', 'delete', 'upload', 'delete-asset']) {
      expectDeny('tags', `gh release ${action} v1.0.0`);
    }
  });

  it("asks the owner before a tag is deleted: only one semantic-release pushed and never released, on the owner's word", () => {
    for (const command of [
      'git push --delete origin v1.0.0-beta.57',
      'git push -d origin v1.0.0-beta.57',
      'git push origin :refs/tags/v1.0.0-beta.57',
      'git push origin --delete refs/tags/v1.0.0-beta.57',
      'git tag -d v1.0.0-beta.57',
      'git tag --delete v1.0.0-beta.57',
      'gh api -X DELETE repos/m-bonanno/scia/git/refs/tags/v1.0.0-beta.57',
    ]) {
      expectAsk('owner-tag', command);
    }
    expectDeny('tags', 'gh api -X PATCH repos/m-bonanno/scia/git/refs/tags/v1.0.0 -f sha=abc');
  });

  it('allows reading them, and a branch whose name only starts like one', () => {
    expectAllow('gh release view v1.0.0-beta.56');
    expectAllow('gh release list');
    expectAllow('git tag --list "v1.*"');
    expectAllow('git push origin v1-2-3');
    expectAllow('git push origin xv1.0.0');
    expectAllow(
      'gh api -X POST repos/m-bonanno/scia/git/refs -f ref=refs/heads/chore/1-work -f sha=abc',
    );
  });
});

describe('merging a pull request', () => {
  it('merges only the head the team approved', () => {
    expectDeny('merge-head', 'gh pr merge 375 --squash --admin --body "Closes #373"');
    expectAllow(
      'gh pr merge 375 --repo m-bonanno/scia --squash --admin --match-head-commit 1f3849a --body "Closes #373"',
    );
    expectAllow('gh pr merge 375 --squash --match-head-commit=1f3849a');
    expectDeny('merge-head', 'gh pr --repo=m-bonanno/scia merge 1 --squash');
    expectDeny('merge-head', 'gh pr -R m-bonanno/scia merge 1 --squash');
    expectDeny('pr-review', 'gh pr --repo m-bonanno/scia review 1 --approve');
    expectDeny('tags', 'gh release -R m-bonanno/scia create v9.9.9');
    expectDeny('issue-assignee', 'gh issue -R m-bonanno/scia create -t "fix: x"');
    expectDeny(
      'body-file',
      'gh pr -R m-bonanno/scia create --body text --assignee @me --label chore',
    );
  });

  it('asks the owner for a merge commit, which is a release or its way back', () => {
    expectAsk('owner-merge', 'gh pr merge 400 --merge --match-head-commit abc1234');
    expectAsk('owner-merge', 'gh pr merge 400 -m --match-head-commit abc1234');
    expectAsk('owner-merge', 'gh pr merge 400 --auto --squash --match-head-commit abc1234');
  });

  it('refuses a rebase merge, which Scia never makes', () => {
    expectDeny('merge-head', 'gh pr merge 375 --rebase --match-head-commit abc1234');
    expectDeny('merge-head', 'gh pr merge 375 -r --match-head-commit abc1234');
  });

  it("refuses a review on GitHub: the owner's approval is their own hand", () => {
    expectDeny('pr-review', 'gh pr review 375 --approve');
    expectDeny('pr-review', 'gh pr review 375 --comment -b "looks fine"');
  });

  it('asks the owner before a pull request is closed or reopened', () => {
    expectAsk('owner-close', 'gh pr close 400 --comment "Please open an issue first."');
    expectAsk('owner-close', 'gh pr reopen 400');
  });

  it('refuses rather than asks when a command holds both', () => {
    expectDeny(
      'protected-branch',
      'gh pr merge 400 --merge --match-head-commit abc1234 && git push origin develop',
    );
  });
});

describe('pull request and issue bodies', () => {
  it('refuses a body written in the command', () => {
    expectDeny(
      'body-file',
      'gh pr create --title "chore: x" --body "text" --assignee @me --label chore',
    );
    expectDeny('body-file', 'gh pr edit 375 -b "text"');
    expectDeny('body-file', 'gh pr edit 375 --body=text');
  });

  it('allows a body read from its file', () => {
    expectAllow('gh pr edit 375 --body-file .claude/pr-bodies/chore/1-work.md');
  });

  it('assigns every issue and pull request, and labels a pull request with its type', () => {
    expectDeny('issue-assignee', 'gh issue create --title "fix: x" --body-file b.md --label bug');
    expectAllow('gh issue create --title "fix: x" --body-file b.md --label bug --assignee @me');
    expectAllow('gh issue create -t "fix: x" -F b.md -l bug -a @me');
    expectDeny('pr-assignee', 'gh pr create --title "chore: x" --body-file b.md --label chore');
    expectDeny('pr-assignee', 'gh pr create --title "chore: x" --body-file b.md --assignee @me');
    expectDeny(
      'pr-assignee',
      'gh pr create --title "chore: x" --body-file b.md --assignee @me --label area:ci',
    );
    expectDeny(
      'pr-assignee',
      'gh pr create --title "chore: x" --body-file b.md --assignee @me --label',
    );
    expectAllow(
      'gh pr create --title "chore: x" --body-file b.md --assignee @me --label chore,area:ci',
    );
    expectAllow('gh pr create --title "chore: x" --body-file b.md -a @me -l "area:ci, chore"');
    expectAllow('gh pr create --title "chore: x" --body-file b.md --assignee=@me --label=chore');
    expectAllow('npm run pr:open -- "chore: x"');
  });

  it('allows the comments of the team and of an issue', () => {
    expectAllow('gh pr comment 375 --body-file review.md');
    expectAllow('gh issue comment 383 --body-file reading.md');
  });
});

describe('AI attribution', () => {
  it('refuses a trailer or a line that names the assistant as an author', () => {
    expectDeny('attribution', `git commit -m "chore: x" -m "${trailer}"`);
    expectDeny('attribution', `git commit -F - <<'EOF'\nchore: x\n\n${trailer}\nEOF`);
    expectDeny('attribution', `git commit -m "$(cat <<'EOF'\nchore: x\n\n${trailer}\nEOF\n)"`);
    expectDeny('attribution', `gh issue create -a @me --body "${trailer}"`);
    expectDeny('attribution', `cat <<'EOF' | git commit -F -\nchore: x\n\n${trailer}\nEOF`);
    expectDeny('attribution', `git commit -m x --trailer="${trailer}"`);
    expectDeny('attribution', `git commit -m $'chore: x\\n\\n${trailer}'`);
    expectDeny(
      'attribution',
      'gh pr create --title "chore: x" --body-file b.md --assignee @me --label chore',
      { files: { [inWork('b.md')]: `## What\n\nA change.\n\n${generatedLine}\n` } },
    );
    expectDeny(
      'attribution',
      'gh api -X POST repos/m-bonanno/scia/issues/1/comments -F body=@c.md',
      { files: { [inWork('c.md')]: `Done.\n\n${trailer}\n` } },
    );
    expectDeny('attribution', 'gh api repos/m-bonanno/scia/issues/1/comments --input c.json', {
      files: { [inWork('c.json')]: `{"body":"Done."}\n${trailer}\n` },
    });
  });

  it('reads each command that writes a message, and the files it hands over', () => {
    const body = { [inWork('c.md')]: `x\n${trailer}\n` };
    for (const command of [
      'gh pr create --title "chore: x" --assignee @me --label chore',
      'gh pr edit 1',
      'gh pr comment 1',
      'gh pr merge 1 --squash --match-head-commit abc1234',
      'gh pr close 1',
      'gh pr reopen 1',
      'gh issue create -a @me',
      'gh issue edit 1',
      'gh issue comment 1',
      'gh issue close 1',
      'gh issue reopen 1',
    ]) {
      expectDeny('attribution', `${command} --body-file c.md`, { files: body });
    }
    for (const sub of ['am', 'cherry-pick', 'commit', 'merge', 'notes', 'revert', 'tag']) {
      expectDeny('attribution', `git ${sub} -m "${trailer}"`);
    }
    const files = { [inWork('m.txt')]: `chore: x\n\n${trailer}\n` };
    for (const option of ['-F m.txt', '--file m.txt', '--file=m.txt']) {
      expectDeny('attribution', `git commit ${option}`, { files });
    }
    for (const option of ['-F m.txt', '--body-file m.txt', '--body-file=m.txt']) {
      expectDeny('attribution', `gh issue comment 1 ${option}`, { files });
    }
    for (const option of ['-F b=@m.txt', '--field b=@m.txt']) {
      expectDeny('attribution', `gh api repos/m-bonanno/scia/issues/1/comments ${option}`, {
        files,
      });
    }
  });

  it('knows every form of it', () => {
    for (const line of [
      `  ${trailer}`,
      `\t${trailer}`,
      'co-authored-by: claude <noreply@anthropic.com>',
      'Co-Authored-By: An Assistant <noreply@anthropic.com>',
      generatedLine,
      generatedLine.replace('\u{1F916}', '\u{1F916}\uFE0F'),
      'Generated by Claude',
      'Claude-Session: 3c6ee6ca',
      '\u{1F916}Generated by Claude',
      '\u{1F916}  Generated by Claude',
    ]) {
      expectDeny('attribution', 'gh issue comment 1 --body-file c.md', {
        files: { [inWork('c.md')]: `x\n${line}\n` },
      });
    }
  });

  it('lets a description of the rule, a near name, or a command that writes nothing through', () => {
    const description = `No AI attribution: no \`${trailer}\` line, and no "${generatedLine}".`;
    for (const text of [
      description,
      `- \`${trailer}\``,
      `> ${trailer}`,
      'Co-Authored-By: Claudette <claudette@example.com>',
      'Generated with Claudette',
    ]) {
      expectAllow('gh issue comment 382 --body-file c.md', {
        files: { [inWork('c.md')]: `${text}\n` },
      });
    }
    expectAllow(`git commit -m "docs: say that no ${trailer} line is written"`);
    expectAllow(`echo "${trailer}"`);
    expectAllow("git commit -m $'chore: x\\n\\nA body.'");
    expectAllow(`git log --grep "${trailer}"`);
    expectAllow(`gh pr view 388 --json body --jq .body | grep -c "${trailer}"`);
    expectAllow(`gh issue list --search "${trailer}"`);
    expectAllow(
      `gh api repos/m-bonanno/scia/issues/1/comments --jq '.[] | select(.body == "${trailer}")'`,
    );
  });
});

describe('heredocs', () => {
  it('refuses backticks in a heredoc whose delimiter is not quoted: the shell runs them', () => {
    expectDeny('heredoc', 'cat > b.md <<EOF\nRun `npm test` first.\nEOF');
    expectDeny('heredoc', 'cat > b.md << EOF\nRun `npm test` first.\nEOF');
    expectDeny('heredoc', 'cat > b.md <<-END\n\tRun `npm test` first.\n\tEND');
    expectDeny('heredoc', 'cat > b.md <<EOF\nEOFX `npm test`\nEOF');
  });

  it('allows them under a quoted delimiter, and a plain heredoc', () => {
    expectAllow("cat > b.md <<'EOF'\nRun `npm test` first.\nEOF");
    expectAllow('cat > b.md <<"EOF"\nRun `npm test` first.\nEOF');
    expectAllow('cat > b.md <<\\EOF\nRun `npm test` first.\nEOF');
    expectAllow('cat > b.md <<EOF\nRun npm test first.\nEOF');
    expectAllow('cat > b.md <<EOF\nEOF');
    expectAllow("cat <<'EOF' > note.md\ngit push origin develop\nEOF");
    expectAllow('cat > b.md <<EOF\nEOF\necho `date`\nEOF');
  });
});

describe('tokens', () => {
  it('refuses a literal token in a command', () => {
    for (const token of [
      githubToken,
      ...['o', 'u', 's', 'r'].map((kind) => `gh${kind}_${'a'.repeat(36)}`),
      `github_pat_${'b'.repeat(30)}`,
      `sk-ant-${'x7'.repeat(10)}`,
      `AKIA${'B'.repeat(16)}`,
      `xoxb-${'1'.repeat(10)}`,
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      expectDeny('token', `curl -H "Authorization: ${token}" https://example.com`);
    }
  });

  it('allows a token read from the environment, and a shape too short or inside a word', () => {
    expectAllow('curl -H "Authorization: token $GH_TOKEN" https://api.github.com/user');
    for (const near of [
      `ghp_${'a'.repeat(35)}`,
      `xghp_${'a'.repeat(36)}`,
      `ghx_${'a'.repeat(36)}`,
      `github_pat_${'b'.repeat(29)}`,
      `sk-ant-${'x'.repeat(19)}`,
      `AKIA${'B'.repeat(15)}`,
      `AKIA${'B'.repeat(17)}`,
      `xoxb-${'1'.repeat(9)}`,
      '-----BEGIN PUBLIC KEY-----',
    ]) {
      expectAllow(`echo ${near}`);
    }
  });
});

describe("the repository's settings", () => {
  it('asks the owner before a write to branch protection, the repository or an alert', () => {
    for (const command of [
      'gh api -X PUT repos/m-bonanno/scia/branches/develop/protection/required_status_checks --input c.json',
      'gh api -XPATCH repos/m-bonanno/scia/code-scanning/alerts/5 -f state=dismissed',
      'gh api --method=PUT repos/m-bonanno/scia/branches/develop/protection',
      'gh api -X put /repos/m-bonanno/scia/rulesets/1',
      'gh api -X PUT repos/m-bonanno/scia/collaborators/someone',
      'gh api --method PATCH repos/m-bonanno/scia -f description=x',
      'gh api -X PATCH repos/m-bonanno/scia/',
      'gh api -f state=dismissed repos/m-bonanno/scia/code-scanning/alerts/5',
      'gh api -XPATCH repos/m-bonanno/scia/rulesets/1',
    ]) {
      expectAsk('owner-settings', command);
    }
    for (const action of ['edit', 'rename', 'archive', 'unarchive', 'delete']) {
      expectAsk('owner-settings', `gh repo ${action}`);
    }
  });

  it("reads gh api's options that take a value as such", () => {
    for (const option of [
      '-H Accept:x',
      '--header Accept:x',
      '-f a=b',
      '--raw-field a=b',
      '-F a=b',
      '--field a=b',
      '--input c.json',
      '-q .x',
      '--jq .x',
      '-t x',
      '--template x',
      '--hostname github.com',
      '--cache 1h',
    ]) {
      expectAsk('owner-settings', `gh api -X PATCH ${option} repos/m-bonanno/scia/rulesets/1`);
    }
  });

  it('allows reading them, and a write elsewhere', () => {
    expectAllow('gh api repos/m-bonanno/scia/branches/develop/protection/required_status_checks');
    expectAllow("gh api 'repos/m-bonanno/scia/code-scanning/alerts?state=open' --jq length");
    expectAllow('gh api -X PATCH repos/m-bonanno/scia/issues/1?x=1 -f state=closed');
    expectAllow('gh repo view');
    expectAllow('gh api -XGET repos/m-bonanno/scia/rulesets/1 -f per_page=1');
    expectAllow('gh api -X PATCH');
    expectAllow("gh api repos/m-bonanno/scia/rulesets/1 --jq '.a-Xb'");
    expectAllow('gh api -X PATCH repos/m-bonanno/scia/git/refs/heads/chore -f note=refs/tags/x');
    expectAsk('owner-settings', 'gh api -X PATCH /repos/m-bonanno/scia -f description=x');
    for (const option of ['-f a=b', '--raw-field a=b', '-F a=b', '--field a=b', '--input c.json']) {
      expectAsk('owner-settings', `gh api ${option} repos/m-bonanno/scia/rulesets/1`);
    }
  });
});

describe('the rest', () => {
  it('allows the everyday commands', () => {
    expectAllow('npm run gates');
    expectAllow('git status && git log --oneline -5');
    expectAllow('gh pr view 375 --json state');
    expectAllow('gh __proto__ x');
    expectAllow('');
  });
});

describe('hookOutput', () => {
  it('says nothing for a command it allows', () => {
    expect(hookOutput({ kind: 'allow' })).toBe('');
  });

  it("answers Claude Code's PreToolUse decision, naming the rule", () => {
    for (const kind of ['deny', 'ask']) {
      const output = JSON.parse(
        hookOutput({ kind, rule: 'tags', reason: 'semantic-release owns them.' }),
      );
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: kind,
          permissionDecisionReason: "Scia's guard (tags): semantic-release owns them.",
        },
      });
    }
  });
});

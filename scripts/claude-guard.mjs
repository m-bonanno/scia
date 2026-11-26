import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TYPE_LABEL_NAMES } from './open-pr.mjs';

// Scia's guard. Claude Code runs it before each shell command of a session (.claude/settings.json):
// it refuses what docs/development/ forbids and asks the owner for what is the owner's to do. It reads
// a command the way the shell runs it: segments, `cd`, `git -C`, `bash -c`, `eval`, `$(…)`, and a
// heredoc's body as text, not as a command.

const REASONS = {
  'protected-branch':
    'develop and main move only by a merged pull request. Work on a branch cut from develop (git-flow.md).',
  'no-verify':
    'it skips the git hooks (husky): commitlint and the protected-branch guard. Fix what the hook refuses instead.',
  tags: 'semantic-release creates the tags and the releases, never a hand (release-flow.md).',
  'merge-head':
    'merge only the head the team approved, squashed: gh pr merge <n> --squash --admin --match-head-commit <head> (review-flow.md, "Merging").',
  'owner-merge':
    "a merge commit is a release into main or main back into develop, and --auto merges unseen: the owner's word (review-flow.md).",
  'pr-review':
    'the owner approves a pull request by their own hand (#76); the team posts its reviews as comments.',
  'owner-close': "closing or reopening a pull request is the owner's call.",
  'body-file':
    'write the body to .claude/pr-bodies/<branch>.md and pass --body-file (git-flow.md, "A pull request").',
  'issue-assignee':
    'an issue is assigned to whoever opens it: --assignee @me for one the team opens (git-flow.md, "A pull request").',
  'pr-assignee':
    'a pull request is assigned and labelled with its type when it opens: npm run pr:open -- "<title>" does both (git-flow.md).',
  attribution:
    'no AI attribution in a commit, a pull request or an issue, or a comment (CLAUDE.md). Take the trailer or the line out.',
  heredoc:
    "the shell runs backticks in a heredoc whose delimiter is not quoted: quote it (<<'EOF').",
  token:
    'a secret in a command stays in the transcript and the shell history: read it from the environment.',
  'owner-settings':
    "branch protection, the repository's settings and code-scanning alerts are the owner's to change.",
};

const PROTECTED = new Set(['develop', 'main']);
const isProtected = (name) => PROTECTED.has(name.replace(/^refs\/heads\//, ''));
const isTag = (name) => name.startsWith('refs/tags/') || /^v\d+\.\d+\.\d+/.test(name);

const TOKENS = [
  /\bgh[opusr]_[A-Za-z0-9]{36}/,
  /\bgithub_pat_[A-Za-z0-9_]{30}/,
  /\bsk-ant-[A-Za-z0-9_-]{20}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// A trailer or a line that names the assistant as an author, at the start of a line: a sentence that
// only describes the rule (in backticks, quotes or a list) is not one.
const ATTRIBUTION =
  /^[\t ]*(?:\p{Extended_Pictographic}\uFE0F?[\t ]*)?(?:co-authored-by:[^\n]*(?:\bclaude\b|anthropic\.com)|claude-session:|generated (?:with|by) \[?claude\b)/imu;

// Group 1, a backslash, or 2, a quote, makes the delimiter quoted; 3 is the delimiter, 4 the rest of
// the line that opens the heredoc, which is still a command, and 5 the body.
const HEREDOC =
  /<<-?[\t ]*(\\?)(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2([^\n]*)\n((?:[\s\S]*?\n)??)\t*\3(?=\n|$)/g;

// The escapes of an ANSI-C quoted word ($'…') that can make a line of a message; any other stays as written.
const ANSI_C = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
const WRAPPERS = new Set(['builtin', 'command', 'env', 'exec', 'nohup', 'sudo', 'time', 'xargs']);
const SHELLS = new Set(['bash', 'dash', 'ksh', 'sh', 'zsh']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const GIT_PUSH_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const GIT_WRITES_MESSAGE = new Set([
  'am',
  'cherry-pick',
  'commit',
  'merge',
  'notes',
  'revert',
  'tag',
]);
const GIT_ON_PROTECTED = new Set(['am', 'cherry-pick', 'commit', 'rebase', 'revert']);
const GIT_RUNS_HOOKS = new Set([...GIT_ON_PROTECTED, 'merge', 'pull', 'push']);
// Short options of `git commit` that take a value: an `n` after one of them is part of that value.
const COMMIT_SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't', 'u', 'S']);
const GH_API_WITH_VALUE = new Set([
  '-X',
  '--method',
  '-H',
  '--header',
  '-f',
  '--raw-field',
  '-F',
  '--field',
  '--input',
  '-q',
  '--jq',
  '-t',
  '--template',
  '--hostname',
  '--cache',
]);
const GH_WITH_VALUE = new Set(['-R', '--repo']);
const GH_PR_WRITES = new Set(['create', 'edit', 'comment', 'merge', 'close', 'reopen']);
const GH_ISSUE_WRITES = new Set(['create', 'edit', 'comment', 'close', 'reopen']);
const GH_RELEASE_WRITES = new Set(['create', 'edit', 'delete', 'upload', 'delete-asset']);
const GH_REPO_WRITES = new Set(['edit', 'rename', 'archive', 'unarchive', 'delete']);
const TAG_ENDPOINT = /\/git\/(refs\/)?tags(\/|$)|\/releases(\/|$)/;
const SETTINGS_ENDPOINT =
  /\/(protection|rulesets|collaborators)(\/|$)|\/code-scanning\/alerts|^repos\/[^/]+\/[^/]+\/?$/;

const resolveIn = (dir, file) => path.resolve(dir, file.replace(/^~(?=$|[/\\])/, os.homedir()));

// `--name value`, `--name=value` and `-n value`.
function valuesOf(args, ...names) {
  const values = [];
  args.forEach((arg, i) => {
    if (names.includes(arg) && i + 1 < args.length) values.push(args[i + 1]);
    const named = names.find((name) => arg.startsWith(`${name}=`));
    if (named) values.push(arg.slice(named.length + 1));
  });
  return values;
}

const hasFlag = (args, ...names) =>
  args.some((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)));

function positionals(args, withValue = new Set()) {
  const found = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('-')) found.push(args[i]);
    else if (withValue.has(args[i])) i++;
  }
  return found;
}

// Splits a command into the words of each simple command, the way the shell does: quotes, escapes,
// comments, `;` `&&` `||` `|` `&` and newlines. A `$(…)` or a backtick stays inside its word, and its
// own command is handed back in `inner`, to be read on its own.
export function splitCommand(text) {
  const segments = [];
  const inner = [];
  let words = [];
  let word = null;
  const add = (piece) => {
    word = (word ?? '') + piece;
  };
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  // The index past the `)` that closes the `(` at `open`.
  const closing = (open) => {
    let depth = 0;
    let quote = null;
    for (let j = open; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '\\' && quote === '"') j++;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === '\\') j++;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return j + 1;
    }
    return text.length + 1;
  };
  // Left open, both run to the end of the text, as if closed past it.
  const backtickEnd = (open) => {
    const end = text.indexOf('`', open + 1);
    return end === -1 ? text.length + 1 : end + 1;
  };
  // A `$(…)` at `start`, or a backtick: its command goes to `inner`, its text stays in the word.
  const substitution = (start) => {
    const end = text[start] === '`' ? backtickEnd(start) : closing(start + 1);
    inner.push(text.slice(start + (text[start] === '`' ? 1 : 2), end - 1));
    return end;
  };
  const opensSubstitution = (j) => text[j] === '`' || (text[j] === '$' && text[j + 1] === '(');

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      add(text.slice(i + 1, stop));
      i = stop + 1;
    } else if (c === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && '"\\$`'.includes(text[j + 1])) {
          value += text[j + 1];
          j += 2;
        } else if (opensSubstitution(j)) {
          const end = substitution(j);
          value += text.slice(j, end);
          j = end;
        } else {
          value += text[j];
          j++;
        }
      }
      add(value);
      i = j + 1;
    } else if (c === '\\') {
      if (text[i + 1] !== '\n') add(text[i + 1] ?? '');
      i += 2;
    } else if (c === '$' && text[i + 1] === "'") {
      let j = i + 2;
      let value = '';
      while (j < text.length && text[j] !== "'") {
        if (text[j] === '\\' && j + 1 < text.length) {
          value += ANSI_C[text[j + 1]] ?? `\\${text[j + 1]}`;
          j += 2;
        } else {
          value += text[j];
          j++;
        }
      }
      add(value);
      i = j + 1;
    } else if (opensSubstitution(i)) {
      const end = substitution(i);
      add(text.slice(i, end));
      i = end;
    } else if (c === '#' && word === null) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if ('\n;&|()'.includes(c)) {
      endSegment();
      i++;
    } else {
      add(c);
      i++;
    }
  }
  endSegment();
  return { segments, inner };
}

function checkGit(args, cwd, state) {
  let repo = cwd;
  let hooksOff = false;
  let i = 0;
  while (args[i]?.startsWith('-')) {
    if (GIT_GLOBAL_WITH_VALUE.has(args[i]) && i + 1 < args.length) {
      if (args[i] === '-C') repo = resolveIn(repo, args[i + 1]);
      if (args[i] === '-c' && /^core\.hookspath=/i.test(args[i + 1])) hooksOff = true;
      i += 2;
    } else i++;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (GIT_WRITES_MESSAGE.has(sub)) {
    state.writes = true;
    state.files.push(...valuesOf(rest, '-F', '--file').map((file) => [repo, file]));
  }

  const branch = state.branches.get(repo) ?? state.branchOf(repo);

  if (rest.includes('--no-verify') || (hooksOff && GIT_RUNS_HOOKS.has(sub)))
    state.deny('no-verify');
  if (sub === 'commit' && skipsHooks(rest)) state.deny('no-verify');
  if (sub === 'config' && positionals(rest).some((arg) => /^core\.hookspath$/i.test(arg))) {
    state.deny('no-verify');
  }

  if (sub === 'checkout' || sub === 'switch') {
    const created = valuesOf(rest, '-b', '-B', '-c', '-C', '--create', '--force-create');
    const named = positionals(rest);
    const plain = !rest.includes('--') && named.length === 1 ? named[0] : undefined;
    state.branches.set(repo, created[0] ?? plain);
  }
  if (sub === 'push') checkPush(rest, branch, state);
  if (sub === 'tag' && hasFlag(rest, '-d', '--delete')) state.deny('tags');
  const moves = hasFlag(
    rest,
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
  );
  if (sub === 'branch' && moves && positionals(rest).some(isProtected))
    state.deny('protected-branch');
  if (sub === 'update-ref' && positionals(rest).some(isProtected)) state.deny('protected-branch');

  if (!isProtected(branch)) return;
  if (GIT_ON_PROTECTED.has(sub)) state.deny('protected-branch');
  if ((sub === 'merge' || sub === 'pull') && !rest.includes('--ff-only'))
    state.deny('protected-branch');
  if (
    sub === 'reset' &&
    ![`origin/${branch}`, '@{u}', '@{upstream}'].includes(positionals(rest)[0])
  ) {
    state.deny('protected-branch');
  }
}

function skipsHooks(rest) {
  for (const arg of rest) {
    if (!/^-[^-]/.test(arg)) continue;
    for (const letter of arg.slice(1)) {
      if (letter === 'n') return true;
      if (COMMIT_SHORT_WITH_VALUE.has(letter)) break;
    }
  }
  return false;
}

function checkPush(rest, branch, state) {
  if (hasFlag(rest, '--all', '--mirror')) state.deny('protected-branch');
  if (hasFlag(rest, '--tags', '--follow-tags')) state.deny('tags');
  const refspecs = positionals(rest, GIT_PUSH_WITH_VALUE).slice(1);
  if (refspecs.length === 0 && isProtected(branch)) state.deny('protected-branch');
  for (const refspec of refspecs) {
    const plain = refspec.replace(/^\+/, '');
    const [source, target = source] = plain.split(':');
    if (isTag(source) || isTag(target)) state.deny('tags');
    if (isProtected(target === 'HEAD' ? branch : target)) state.deny('protected-branch');
  }
}

// A command that writes a message is read for attribution, with the files it hands over; a read
// (view, list, diff, a GET) writes nothing, whatever its words hold.
function noteBody(rest, cwd, state) {
  state.writes = true;
  state.files.push(...valuesOf(rest, '--body-file', '-F').map((file) => [cwd, file]));
}

function checkPr(rest, action, cwd, state) {
  if (GH_PR_WRITES.has(action)) noteBody(rest, cwd, state);
  if (action === 'merge') {
    if (hasFlag(rest, '--rebase', '-r') || !hasFlag(rest, '--match-head-commit'))
      state.deny('merge-head');
    if (hasFlag(rest, '--merge', '-m', '--auto')) state.ask('owner-merge');
  }
  if (action === 'review') state.deny('pr-review');
  if (action === 'close' || action === 'reopen') state.ask('owner-close');
  if ((action === 'create' || action === 'edit') && hasFlag(rest, '--body', '-b')) {
    state.deny('body-file');
  }
  if (action === 'create') {
    const labels = valuesOf(rest, '--label', '-l').flatMap((value) => value.split(','));
    const typed = labels.some((label) => TYPE_LABEL_NAMES.has(label.trim()));
    if (!hasFlag(rest, '--assignee', '-a') || !typed) state.deny('pr-assignee');
  }
}

function checkIssue(rest, action, cwd, state) {
  if (GH_ISSUE_WRITES.has(action)) noteBody(rest, cwd, state);
  if (action === 'create' && !hasFlag(rest, '--assignee', '-a')) state.deny('issue-assignee');
}

function checkApi(rest, action, cwd, state) {
  const typed = valuesOf(rest, '-F', '--field');
  const fields = [...valuesOf(rest, '-f', '--raw-field'), ...typed];
  // Without a method, gh sends a GET, or a POST when the request carries fields or an input.
  const named =
    valuesOf(rest, '-X', '--method')[0] ?? rest.find((arg) => /^-X\w/.test(arg))?.slice(2);
  const writes = named
    ? named.toUpperCase() !== 'GET'
    : fields.length > 0 || hasFlag(rest, '--input');
  if (!writes) return;

  state.writes = true;
  for (const field of typed) {
    const file = /=@(.+)$/.exec(field)?.[1];
    if (file) state.files.push([cwd, file]);
  }
  state.files.push(...valuesOf(rest, '--input').map((file) => [cwd, file]));
  const endpoint = positionals(rest, GH_API_WITH_VALUE)[0]?.split('?')[0];
  if (endpoint === undefined) return;

  // A tag made as a ref: POST …/git/refs with ref=refs/tags/….
  const tagRef =
    /\/git\/refs\/?$/.test(endpoint) && fields.some((field) => field.includes('refs/tags/'));
  if (TAG_ENDPOINT.test(endpoint) || tagRef) state.deny('tags');
  if (SETTINGS_ENDPOINT.test(endpoint.replace(/^\//, ''))) state.ask('owner-settings');
}

const GH = new Map([
  ['pr', checkPr],
  ['issue', checkIssue],
  [
    'release',
    (rest, action, cwd, state) => {
      if (GH_RELEASE_WRITES.has(action)) state.deny('tags');
    },
  ],
  [
    'repo',
    (rest, action, cwd, state) => {
      if (GH_REPO_WRITES.has(action)) state.ask('owner-settings');
    },
  ],
  ['api', checkApi],
]);

function analyze(command, cwd, state) {
  const { segments, inner } = splitCommand(command.replace(HEREDOC, (...match) => match[4]));
  for (const words of segments) {
    state.words.push(...words);
    const start = words.findIndex((word) => !ASSIGNMENT.test(word) && !WRAPPERS.has(word));
    if (words.slice(0, start === -1 ? words.length : start).includes('HUSKY=0'))
      state.deny('no-verify');
    if (start === -1) continue;
    const [first, ...args] = words.slice(start);
    const name = path.basename(first).replace(/\.exe$/i, '');
    if (name === 'cd') cwd = resolveIn(cwd, args[0] ?? '~');
    if (name === 'export' && args.includes('HUSKY=0')) state.deny('no-verify');
    if (name === 'eval') analyze(args.join(' '), cwd, state);
    if (name === 'git') checkGit(args, cwd, state);
    if (name === 'gh') {
      // `gh pr -R <repo> merge 1`: --repo's value is neither the group nor the action.
      const [group, action] = positionals(args, GH_WITH_VALUE);
      GH.get(group)?.(args.slice(args.indexOf(group) + 1), action, cwd, state);
    }
    const flag = args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
    if (SHELLS.has(name) && flag !== -1 && flag + 1 < args.length)
      analyze(args[flag + 1], cwd, state);
  }
  for (const command of inner) analyze(command, cwd, state);
}

export function decide(command, { cwd, branchOf, readText }) {
  const verdicts = [];
  const state = {
    branchOf,
    branches: new Map(),
    words: [],
    files: [],
    writes: false,
    deny: (rule) => verdicts.push({ kind: 'deny', rule }),
    ask: (rule) => verdicts.push({ kind: 'ask', rule }),
  };

  if (TOKENS.some((token) => token.test(command))) state.deny('token');
  for (const [, backslash, quote, , , body] of command.matchAll(HEREDOC)) {
    if (!backslash && !quote && body.includes('`')) state.deny('heredoc');
  }
  analyze(command, cwd, state);
  if (state.writes) {
    const files = state.files.map(([dir, file]) => readText(resolveIn(dir, file)));
    const values = state.words.map((word) => word.replace(/^--[\w-]+=/, ''));
    if ([command, ...state.words, ...values, ...files].some((text) => ATTRIBUTION.test(text))) {
      state.deny('attribution');
    }
  }

  // A refusal wins over a question.
  const chosen = verdicts.find((verdict) => verdict.kind === 'deny') ?? verdicts[0];
  return chosen ? { ...chosen, reason: REASONS[chosen.rule] } : { kind: 'allow' };
}

export function hookOutput(verdict) {
  if (verdict.kind === 'allow') return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: verdict.kind,
      permissionDecisionReason: `Scia's guard (${verdict.rule}): ${verdict.reason}`,
    },
  });
}

export function currentBranch(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  let data = null;
  try {
    data = JSON.parse(input);
  } catch {
    // Not a hook's input: nothing to guard.
  }
  const command = data?.tool_input?.command ?? '';
  const cwd = data?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let verdict;
  try {
    verdict = decide(command, { cwd, branchOf: currentBranch, readText });
  } catch (error) {
    verdict = {
      kind: 'ask',
      rule: 'unread',
      reason: `the guard could not read this command (${error.message}).`,
    };
  }
  const output = hookOutput(verdict);
  if (output) process.stdout.write(`${output}\n`);
}

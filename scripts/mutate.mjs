import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Mutation testing of the lines a branch changed (#381): Stryker mutates them in a copy of the
// repository (stryker.config.mjs) and runs the specs that cover each mutant there, through
// vitest.stryker.config.ts, behind the network guard. `npm run mutate -- --base <ref>` compares
// with another ref than origin/develop — a round's own lines, from the head of the round before;
// every other argument is Stryker's (`--concurrency 1`, `--disableBail`).

export const STRYKER = 'node_modules/@stryker-mutator/core/bin/stryker.js';

// The guard is seen refusing, on every road, from inside a spec of the run's own configuration,
// before a mutant is trusted with the network (.claude/gotchas.md, "Specs").
export const PROBE = {
  name: 'probe',
  bin: 'node_modules/vitest/vitest.mjs',
  args: ['run', '--config', 'vitest.stryker.config.ts', '--project', 'net-guard'],
};

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// The lines of each file that `git diff -U0` says a hunk adds or changes, numbered as in the new
// file.
export function changesOf(diff) {
  const changes = new Map();
  let file;
  let inHeader = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      inHeader = true;
      continue;
    }
    // A line of a hunk starts with its sign: an added line that reads `++ b/…` is no header. Git
    // ends a name that holds a space with a tab, and quotes one it cannot print as it is (`è`, a
    // quote): that file is left out rather than read under another file's name.
    if (inHeader && line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice('+++ b/'.length).replace(/\t$/, '') : undefined;
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk === null) continue;
    inHeader = false;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    // A hunk that only takes lines away leaves nothing to mutate; so does every hunk of a deleted
    // file, whose header names `/dev/null`.
    if (count === 0 || file === undefined) continue;
    changes.set(file, [...(changes.get(file) ?? []), [start, start + count - 1]]);
  }
  return [...changes].map(([name, lines]) => ({ file: name, lines }));
}

// What the branch changed since it left `base`: its commits, the tree's changes not committed,
// and its files git does not track yet, whole.
export function changesSince(base, { cwd }) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let diff;
  try {
    diff = git(
      'diff',
      '-U0',
      '--no-color',
      '--no-ext-diff',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--merge-base',
      base,
      '--',
    );
  } catch (error) {
    throw new Error(`git could not compare the branch with ${base}`, { cause: error });
  }
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter((name) => name !== '');
  return [...changesOf(diff), ...untracked.map((name) => ({ file: name, lines: undefined }))];
}

// Stryker's `--mutate`, one entry for each range: only the files the config's patterns take, read
// in order as Stryker reads them — a `!` takes back what the patterns before it took.
export function mutateArgsOf(changes, patterns) {
  const takes = (file) =>
    patterns.reduce((taken, pattern) => {
      const negated = pattern.startsWith('!');
      const matches = path.posix.matchesGlob(file, negated ? pattern.slice(1) : pattern);
      return matches ? !negated : taken;
    }, false);
  return changes
    .filter(({ file }) => takes(file))
    .flatMap(({ file, lines }) =>
      lines === undefined ? [file] : lines.map(([start, end]) => `${file}:${start}-${end}`),
    );
}

export function optionsOf(argv) {
  let base = 'origin/develop';
  const stryker = [];
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg !== '--base' && !arg.startsWith('--base=')) {
      stryker.push(arg);
      continue;
    }
    const ref = arg === '--base' ? argv[(at += 1)] : arg.slice('--base='.length);
    if (!ref) throw new Error('--base names the ref to compare the branch with: --base <ref>');
    base = ref;
  }
  return { base, stryker };
}

export async function mutate({ args, stryker, run, log = console.log }) {
  if (args.length === 0) {
    log(
      'Nothing to mutate: the branch changed no line of a file stryker.config.mjs lets Stryker mutate.',
    );
    return 0;
  }
  log(`Mutating ${String(args.length)} range(s): ${args.join(', ')}`);
  if ((await run(PROBE)) !== 0) {
    log('The network guard was not seen refusing a host outside this computer: no mutant was run.');
    return 1;
  }
  return run({
    name: 'stryker',
    bin: STRYKER,
    args: ['run', '--mutate', args.join(','), ...stryker],
  });
}

// Node runs each tool's own script: no shell between git's file names and the command.
export function runIn(root) {
  return (step) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(root, step.bin), ...step.args], {
        cwd: root,
        stdio: 'inherit',
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { base, stryker } = optionsOf(process.argv.slice(2));
  const { default: config } = await import(
    pathToFileURL(path.join(root, 'stryker.config.mjs')).href
  );
  console.log(`Comparing with ${base}.`);
  const args = mutateArgsOf(changesSince(base, { cwd: root }), config.mutate);
  process.exitCode = await mutate({ args, stryker, run: runIn(root) });
}

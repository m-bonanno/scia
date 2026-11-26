import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Opens the pull request of the current branch, as docs/development/git-flow.md, "A pull request",
// says: `npm run pr:open -- "<title>" [--label <name>]…`.

const BASE = 'develop';

const TYPE_LABELS = { feat: 'enhancement', fix: 'bug', hotfix: 'bug', docs: 'docs', test: 'test' };
const OTHER_TYPE_LABEL = 'chore';

const under =
  (...prefixes) =>
  (file) =>
    prefixes.some((prefix) => file.startsWith(prefix));

// A configuration of the tooling: every file at the root but its Markdown.
const isRootTooling = (file) => !file.includes('/') && !file.endsWith('.md');

// The area labels the paths tell. A label no path tells (`area:integrations`, `accessibility`) is
// given by hand.
const AREAS = [
  { label: 'area:engine', holds: under('apps/server/', 'packages/core/') },
  { label: 'area:desktop', holds: under('apps/desktop/') },
  { label: 'area:renderer', holds: under('apps/renderer/') },
  { label: 'area:extension', holds: under('apps/extension/') },
  {
    label: 'area:ci',
    holds: (file) =>
      isRootTooling(file) ||
      under(
        '.github/',
        '.husky/',
        'scripts/',
        'docs/development/',
        '.claude/agents/',
        '.claude/commands/',
      )(file),
  },
];

const typeOf = (title) => /^(\w+)/.exec(title)?.[1] ?? '';

export function labelsOf({ title, paths, extra = [] }) {
  const type = TYPE_LABELS[typeOf(title)] ?? OTHER_TYPE_LABEL;
  const areas = AREAS.filter((area) => paths.some(area.holds)).map((area) => area.label);
  return [...new Set([type, ...areas, ...extra])];
}

export function bodyFileOf(root, branch) {
  return path.join(root, '.claude', 'pr-bodies', `${branch}.md`);
}

export function createArgs({ title, bodyFile, labels }) {
  return [
    'pr',
    'create',
    '--base',
    BASE,
    '--title',
    title,
    '--body-file',
    bodyFile,
    '--assignee',
    '@me',
    '--label',
    labels.join(','),
  ];
}

// The commitlint of the repository, run as the `Conventional title` check runs it.
export function checkTitle(title, root) {
  const cli = createRequire(import.meta.url).resolve('@commitlint/cli/cli.js');
  const run = spawnSync(process.execPath, [cli], { cwd: root, input: title, encoding: 'utf8' });
  return { ok: run.status === 0, report: `${run.stdout}${run.stderr}`.trim() };
}

function refuse(reason) {
  console.error(reason);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { label: { type: 'string', multiple: true } },
  });
  if (positionals.length !== 1) refuse('Usage: npm run pr:open -- "<title>" [--label <name>]…');
  const [title] = positionals;
  const root = fileURLToPath(new URL('..', import.meta.url));

  const verdict = checkTitle(title, root);
  if (!verdict.ok) refuse(verdict.report);

  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const bodyFile = bodyFileOf(root, git('branch', '--show-current'));
  if (!existsSync(bodyFile)) refuse(`No body at ${bodyFile}: write it from the template first.`);

  git('fetch', '--quiet', 'origin', BASE);
  const paths = git('diff', '--name-only', `origin/${BASE}...HEAD`).split('\n').filter(Boolean);
  const labels = labelsOf({ title, paths, extra: values.label });
  execFileSync('gh', createArgs({ title, bodyFile, labels }), { cwd: root, stdio: 'inherit' });
}

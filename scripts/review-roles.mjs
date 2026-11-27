import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { typeOf } from './open-pr.mjs';

// The tier of a pull request and the roles that review it, from its paths and its title's type, as
// docs/development/review-flow.md, "The team", says: `npm run review:roles -- [<PR>] [--add <role>]…`.

export const ROLES = [
  'tech-lead',
  'backend-engineer',
  'frontend-engineer',
  'product-designer',
  'product-manager',
];

const FEW_LINES = 20;

const under =
  (...prefixes) =>
  (file) =>
    prefixes.some((prefix) => file.startsWith(prefix));

const among =
  (...files) =>
  (file) =>
    files.includes(file);

const isSpec = (file) =>
  /\.test\.[cm]?[jt]sx?$/.test(file) ||
  file.includes('/testing/') ||
  file.startsWith('apps/desktop/e2e/');

const isLight = (file) => isSpec(file) || file.endsWith('.md') || under('docs/', '.claude/')(file);

// The lockfile moves what the installer packs, so a chore of it is not light; it is not heavy,
// since the owner's answer on #397 made heavy two files of the installer, and not it.
const isRuntime = (file) =>
  !isLight(file) && (under('apps/', 'packages/')(file) || file === 'package-lock.json');

// Where a slip loses a download or its state, opens the app, or breaks a release: heavy at any size.
const HEAVY = [
  {
    what: 'code of the engine, the domain or the contracts',
    holds: under('apps/server/src/', 'packages/core/src/', 'packages/contracts/src/'),
  },
  { what: "the desktop's main or preload", holds: under('apps/desktop/src/') },
  { what: "the extension's manifest", holds: among('apps/extension/static/manifest.json') },
  {
    what: 'the release config',
    holds: (file) =>
      among('.releaserc.json', 'apps/desktop/electron-builder.yml')(file) ||
      under('apps/desktop/build/')(file),
  },
  {
    what: 'what the installer packs',
    holds: among('apps/desktop/package.json', 'apps/desktop/scripts/fetch-tools.ts'),
  },
  { what: 'a workflow', holds: under('.github/workflows/') },
];

const AREAS = [
  {
    role: 'backend-engineer',
    holds: under('packages/core/', 'packages/contracts/', 'apps/server/', 'apps/desktop/'),
  },
  { role: 'frontend-engineer', holds: under('apps/renderer/', 'apps/extension/') },
  { role: 'product-designer', holds: under('apps/renderer/src/', 'apps/extension/static/') },
];

// Not the evidence or the decisions log, which are the tech lead's, nor the root CLAUDE.md, whose
// principles the session adds by hand: the owner's answers on #397.
const PRODUCT = among(
  'docs/product/roadmap.md',
  'docs/product/vision.md',
  'docs/product/integrations.md',
  'README.md',
);

const isBreaking = (title) => /^\w+(\([^)]*\))?!:/.test(title);

const pathsOf = (file) => [file.path, file.previous].filter(Boolean);

function tierOf({ release, type, files }) {
  const paths = files.flatMap(pathsOf);
  if (release) return { tier: 'heavy', why: 'a release into main' };
  for (const { what, holds } of HEAVY) {
    const path = paths.find((file) => !isLight(file) && holds(file));
    if (path) return { tier: 'heavy', why: `${path} is ${what}` };
  }
  if (paths.every(isLight)) return { tier: 'light', why: 'docs, .claude/ and specs only' };
  if ((type === 'chore' || type === 'ci') && !paths.some(isRuntime))
    return { tier: 'light', why: `a ${type} that touches no runtime path` };
  return { tier: 'standard' };
}

// A role named twice keeps its first reason.
const inOrder = (roles) => ROLES.flatMap((name) => roles.find(({ role }) => role === name) ?? []);

export function reviewOf({ title, base, files, add = [] }) {
  const unknown = add.filter((role) => !ROLES.includes(role));
  if (unknown.length > 0)
    throw new Error(`No role ${unknown.join(', ')}. The roles: ${ROLES.join(', ')}.`);

  const type = typeOf(title);
  const release = base === 'main';
  const { tier, why } = tierOf({ release, type, files });
  const weighed = files.filter((file) => pathsOf(file).some((path) => !isLight(path)));
  const lines = weighed.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const weighedPaths = files.flatMap(pathsOf).filter((path) => !isLight(path));
  const byArea = AREAS.flatMap(({ role, holds }) => {
    const path = weighedPaths.find(holds);
    return path ? [{ role, why: path }] : [];
  });
  const few = tier === 'standard' && lines <= FEW_LINES;

  const product =
    (type === 'feat' && 'a feat') ||
    (isBreaking(title) && 'a breaking change') ||
    (release && 'a release into main') ||
    files.flatMap(pathsOf).find(PRODUCT);
  // No path of a light PR is in an area: every area is runtime.
  const all = inOrder([
    { role: 'tech-lead', why: 'always' },
    ...(few ? [] : byArea),
    ...(product ? [{ role: 'product-manager', why: product }] : []),
    ...add.map((role) => ({ role, why: 'added by hand' })),
  ]);

  const counted = `${lines} lines outside docs, .claude/ and specs`;
  return {
    tier,
    why: why ?? (few ? `${counted}, ${FEW_LINES} or fewer: the tech lead's alone` : counted),
    lines,
    roles: all,
    callIn: few ? byArea.filter(({ role }) => !all.some((taken) => taken.role === role)) : [],
  };
}

export function messageOf({ tier, why, roles, callIn }) {
  const list = roles.map(({ role, why: reason }) => `- ${role}: ${reason}`);
  const call =
    callIn.length > 0
      ? [
          `May be called in: ${callIn.map(({ role, why: path }) => `${role} (${path})`).join(', ')}.`,
        ]
      : [];
  return [`${tier}: ${why}.`, ...list, ...call].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { add: { type: 'string', multiple: true } },
  });
  // gh's own hints go to stderr; a failure carries its stderr in its message.
  const gh = (...args) =>
    execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    // `gh pr view` takes a number, a URL or a branch; the REST path takes the number alone.
    const pr = JSON.parse(gh('pr', 'view', ...positionals, '--json', 'number,title,baseRefName'));
    // The REST listing, unlike `gh pr view --json files`, goes past a hundred files.
    const files = gh(
      'api',
      '--paginate',
      `repos/{owner}/{repo}/pulls/${pr.number}/files`,
      '--jq',
      '.[] | {path: .filename, previous: .previous_filename, additions, deletions}',
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const review = reviewOf({ title: pr.title, base: pr.baseRefName, files, add: values.add });
    console.log(messageOf(review));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
